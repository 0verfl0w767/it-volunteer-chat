const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/);

    if (!match) {
      return;
    }

    const [, key, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
}

loadEnvFile(path.join(__dirname, ".env"));

const app = express();
app.disable("x-powered-by");

const MAX_MESSAGES = 200;
const MAX_TEXT_LENGTH = 30000;
const MAX_IMAGE_DATA_LENGTH = 4_500_000;
const MAX_PROJECT_FILES = 20;
const MAX_PROJECT_FILE_BYTES = 15 * 1024 * 1024;
const MAX_PROJECT_TOTAL_BYTES = 50 * 1024 * 1024;
const LOGIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX = 10;
const PROJECT_UPLOAD_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const PROJECT_UPLOAD_RATE_LIMIT_MAX = 12;
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "").trim();
const ADMIN_COOKIE_NAME = "admin_session";
const ADMIN_SESSION_TOKEN = crypto.randomBytes(24).toString("hex");
const ADMIN_SESSION_MAX_AGE_SEC = 12 * 60 * 60;
const SSL_CERT_PATH = String(process.env.SSL_CERT_PATH || "").trim();
const SSL_KEY_PATH = String(process.env.SSL_KEY_PATH || "").trim();
const HTTPS_PORT = Number(process.env.PORT || process.env.HTTPS_PORT) || 443;
const HTTP_PORT = Number(process.env.HTTP_PORT) || 80;
const PROJECTS_ROOT = path.join(__dirname, "projects");
const ALLOWED_REACTIONS = new Set(["👍", "👌", "❤️"]);
const RESERVED_PROJECT_FILE_NAMES = new Set(["submission.json"]);
const SANDBOXED_PROJECT_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".svg",
  ".xhtml",
]);
const PROJECT_PREVIEW_CSP =
  "sandbox allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const ALLOWED_IMAGE_PREFIXES = [
  "data:image/png;base64,",
  "data:image/jpeg;base64,",
  "data:image/jpg;base64,",
  "data:image/webp;base64,",
  "data:image/gif;base64,",
];

if (!ADMIN_PASSWORD) {
  throw new Error("Missing ADMIN_PASSWORD. Add it to .env before starting the server.");
}

fs.mkdirSync(PROJECTS_ROOT, { recursive: true });

const messages = [];
const rateLimitBuckets = new Map();

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeProfileText(value, maxLength) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeMessageText(value, maxLength) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .slice(0, maxLength);
}

function normalizeImageDataUrl(value) {
  const dataUrl = String(value || "").trim();
  const normalized = dataUrl.toLowerCase();
  const hasAllowedPrefix = ALLOWED_IMAGE_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );

  if (!hasAllowedPrefix || dataUrl.length > MAX_IMAGE_DATA_LENGTH) {
    return "";
  }

  const [, base64Payload = ""] = dataUrl.split(",", 2);

  if (!/^[a-z0-9+/=]+$/i.test(base64Payload)) {
    return "";
  }

  return dataUrl;
}

function normalizePathSegment(value, fallback = "student") {
  let output = String(value || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 80)
    .trim();

  if (!output) {
    output = fallback;
  }

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(output)) {
    output = `_${output}`;
  }

  return output;
}

function sanitizeFileName(originalName, index) {
  const parsed = path.parse(String(originalName || ""));
  const fallbackBase = `file-${index + 1}`;
  const baseName = normalizePathSegment(parsed.name, fallbackBase);
  const extension = String(parsed.ext || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .slice(0, 20);

  return `${baseName}${extension}`;
}

function sanitizeProjectRelativePath(value, index) {
  const rawSegments = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..");

  if (rawSegments.length === 0) {
    return sanitizeFileName("", index);
  }

  return rawSegments
    .map((segment, segmentIndex) => {
      const isLastSegment = segmentIndex === rawSegments.length - 1;

      if (isLastSegment) {
        return sanitizeFileName(segment, index);
      }

      return normalizePathSegment(segment, `folder-${segmentIndex + 1}`);
    })
    .join("/");
}

function resolveProjectOutputFileName(directoryPath, desiredName) {
  const parsed = path.parse(desiredName);
  let candidate = desiredName;
  let counter = 2;

  while (
    RESERVED_PROJECT_FILE_NAMES.has(candidate.toLowerCase()) ||
    (fs.existsSync(path.join(directoryPath, candidate)) &&
      fs.statSync(path.join(directoryPath, candidate)).isDirectory())
  ) {
    candidate = `${parsed.name}-${counter}${parsed.ext}`;
    counter += 1;
  }

  return candidate;
}

function isSandboxedProjectFile(filePath) {
  return SANDBOXED_PROJECT_EXTENSIONS.has(
    path.extname(String(filePath || "")).toLowerCase(),
  );
}

function normalizeStoredProjectPath(fileEntry) {
  return String(
    fileEntry?.path || fileEntry?.relativePath || fileEntry?.name || "",
  )
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function buildManifestProjectPathSet(manifest) {
  return new Set(
    Array.isArray(manifest?.files)
      ? manifest.files.map(normalizeStoredProjectPath).filter(Boolean)
      : [],
  );
}

function encodeProjectFileUrl(folderName, relativePath) {
  const encodedPath = String(relativePath || "")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `/projects/${encodeURIComponent(folderName)}/${encodedPath}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function buildId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildMessage({ type = "chat", text = "", user = null, image = null }) {
  return {
    id: buildId(),
    type,
    text,
    createdAt: new Date().toISOString(),
    user,
    image,
  };
}

function pushMessage(message) {
  messages.push(message);

  if (messages.length > MAX_MESSAGES) {
    messages.shift();
  }
}

function buildReaction(user, symbol) {
  return {
    id: buildId(),
    symbol,
    createdAt: new Date().toISOString(),
    user,
    x: Math.floor(Math.random() * 56) + 22,
    drift: Math.floor(Math.random() * 48) - 24,
    durationMs: 2600 + Math.floor(Math.random() * 1100),
    size: 22 + Math.floor(Math.random() * 10),
  };
}

function loadHttpsOptions() {
  if (!SSL_CERT_PATH || !SSL_KEY_PATH) {
    return null;
  }

  if (!fs.existsSync(SSL_CERT_PATH) || !fs.existsSync(SSL_KEY_PATH)) {
    return null;
  }

  return {
    cert: fs.readFileSync(SSL_CERT_PATH),
    key: fs.readFileSync(SSL_KEY_PATH),
  };
}

function readCookie(cookieHeader, cookieName) {
  const cookies = String(cookieHeader || "").split(";");

  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.trim().split("=");

    if (name === cookieName) {
      return decodeURIComponent(valueParts.join("="));
    }
  }

  return "";
}

function hasAdminAccess(cookieHeader) {
  return readCookie(cookieHeader, ADMIN_COOKIE_NAME) === ADMIN_SESSION_TOKEN;
}

function setAdminCookie(res, isSecure) {
  const cookieParts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(ADMIN_SESSION_TOKEN)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${ADMIN_SESSION_MAX_AGE_SEC}`,
  ];

  if (isSecure) {
    cookieParts.push("Secure");
  }

  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();

  return String(forwarded || req.socket?.remoteAddress || req.ip || "unknown")
    .slice(0, 100);
}

function takeRateLimitHit(scope, key, windowMs, maxRequests) {
  const now = Date.now();
  const bucketKey = `${scope}:${key}`;
  const existingBucket = rateLimitBuckets.get(bucketKey);
  const bucket =
    !existingBucket || existingBucket.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : existingBucket;

  bucket.count += 1;
  rateLimitBuckets.set(bucketKey, bucket);

  return {
    allowed: bucket.count <= maxRequests,
    retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

function setBasicSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

function readProjectManifest(folderPath) {
  const manifestPath = path.join(folderPath, "submission.json");

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

function removeLegacyGeneratedIndexIfNeeded(
  folderPath,
  knownProjectPaths,
  relativePath,
) {
  if (
    relativePath !== "index.html" ||
    knownProjectPaths.size === 0 ||
    knownProjectPaths.has("index.html")
  ) {
    return;
  }

  const legacyIndexPath = path.join(folderPath, "index.html");

  if (fs.existsSync(legacyIndexPath) && fs.statSync(legacyIndexPath).isFile()) {
    fs.rmSync(legacyIndexPath, { force: true });
  }
}

function collectProjectFiles(folderPath, manifest = null) {
  const knownProjectPaths = buildManifestProjectPathSet(manifest);
  const files = [];

  function walkDirectory(currentPath, relativeDirectory = "") {
    const entries = fs
      .readdirSync(currentPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "vi"));

    entries.forEach((entry) => {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;

      if (entry.isDirectory()) {
        walkDirectory(path.join(currentPath, entry.name), relativePath);
        return;
      }

      if (!entry.isFile() || relativePath === "submission.json") {
        return;
      }

      if (relativePath === "index.html" && !knownProjectPaths.has("index.html")) {
        return;
      }

      const filePath = path.join(currentPath, entry.name);
      const stats = fs.statSync(filePath);

      files.push({
        name: relativePath,
        size: stats.size,
      });
    });
  }

  walkDirectory(folderPath);

  return files.sort((left, right) => left.name.localeCompare(right.name, "vi"));
}

function collectProjectFolders() {
  return fs
    .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "vi"));
}

function buildProjectSummary(folderName) {
  const folderPath = path.join(PROJECTS_ROOT, folderName);
  const manifest = readProjectManifest(folderPath);
  const files = collectProjectFiles(folderPath, manifest);
  const stats = fs.statSync(folderPath);
  const previewPath =
    manifest?.files
      ?.map(normalizeStoredProjectPath)
      .find((storedPath) => /\.(html?|xhtml)$/i.test(storedPath)) ||
    files.find((file) => /\.(html?|xhtml)$/i.test(file.name))?.name ||
    "";
  const updatedAt =
    manifest?.updatedAt ||
    manifest?.createdAt ||
    stats.mtime.toISOString();

  return {
    displayName: manifest?.displayName || folderName,
    seatNumber: manifest?.seatNumber || "-",
    folderName,
    updatedAt,
    fileCount: files.length,
    projectUrl: `/projects/${encodeURIComponent(folderName)}`,
    previewUrl: previewPath ? encodeProjectFileUrl(folderName, previewPath) : "",
  };
}

function collectProjectSummaries() {
  return collectProjectFolders()
    .map(buildProjectSummary)
    .sort((left, right) => {
      return (
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      );
    });
}

function getProjectSubmissionStatus(name, seatNumber) {
  const normalizedName = normalizeProfileText(name, 40);
  const normalizedSeatNumber = normalizeProfileText(seatNumber, 20);

  if (!normalizedName || !normalizedSeatNumber) {
    return null;
  }

  const folderName = normalizePathSegment(normalizedName, "student");
  const folderPath = path.join(PROJECTS_ROOT, folderName);

  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    return null;
  }

  const manifest = readProjectManifest(folderPath);

  if (!manifest) {
    return null;
  }

  const manifestName = normalizeProfileText(manifest.displayName, 40);
  const manifestSeatNumber = normalizeProfileText(manifest.seatNumber, 20);

  if (
    manifestName !== normalizedName ||
    manifestSeatNumber !== normalizedSeatNumber
  ) {
    return null;
  }

  return buildProjectSummary(folderName);
}

function renderProjectsLanding(folderNames) {
  const folderItems = folderNames.length
    ? folderNames
        .map(
          (folderName) => `
        <li class="folder-item">
          <a href="/projects/${encodeURIComponent(folderName)}">${escapeHtml(folderName)}</a>
        </li>`,
        )
        .join("")
    : '<li class="folder-item empty">Chưa có bài nộp nào.</li>';

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Danh sách bài nộp</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3f6fb;
        --panel: #ffffff;
        --line: #dde5f0;
        --text: #172033;
        --muted: #697488;
        --accent: #1769e0;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 24px 14px;
        font-family: "Segoe UI", "Noto Sans", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(23, 105, 224, 0.08), transparent 28%),
          linear-gradient(180deg, #fbfcff 0%, var(--bg) 100%);
      }
      .shell {
        width: min(860px, 100%);
        margin: 0 auto;
        padding: 24px;
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid var(--line);
        border-radius: 22px;
        box-shadow: 0 20px 54px rgba(27, 39, 61, 0.1);
      }
      .eyebrow {
        display: inline-block;
        margin-bottom: 10px;
        padding: 6px 10px;
        color: var(--accent);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        background: rgba(23, 105, 224, 0.08);
        border-radius: 999px;
      }
      h1 {
        margin: 0;
        font-size: clamp(28px, 5vw, 40px);
        letter-spacing: -0.04em;
      }
      .meta {
        margin: 10px 0 0;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.6;
      }
      .list {
        margin: 22px 0 0;
        padding: 0;
        list-style: none;
        border-top: 1px solid var(--line);
      }
      .folder-item {
        padding: 14px 0;
        border-bottom: 1px solid var(--line);
      }
      .folder-item a {
        color: var(--accent);
        font-weight: 700;
        text-decoration: none;
        word-break: break-all;
      }
      .folder-item a:hover {
        text-decoration: underline;
      }
      .folder-item.empty {
        color: var(--muted);
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <h1>Danh sách bài nộp</h1>
      <p class="meta">Mở từng thư mục để xem các tệp đã được tải lên.</p>
      <ul class="list">${folderItems}</ul>
    </main>
  </body>
</html>`;
}

function renderProjectNotFound(folderName) {
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Không tìm thấy bài nộp</title>
    <style>
      body {
        margin: 0;
        padding: 24px 14px;
        font-family: "Segoe UI", "Noto Sans", sans-serif;
        color: #172033;
        background: linear-gradient(180deg, #fbfcff 0%, #f3f6fb 100%);
      }
      .shell {
        width: min(760px, 100%);
        margin: 0 auto;
        padding: 24px;
        background: #fff;
        border: 1px solid #dde5f0;
        border-radius: 22px;
        box-shadow: 0 20px 54px rgba(27, 39, 61, 0.1);
      }
      h1 {
        margin: 0;
        font-size: clamp(28px, 5vw, 40px);
        letter-spacing: -0.04em;
      }
      p {
        margin: 12px 0 0;
        color: #697488;
        line-height: 1.7;
      }
      a {
        color: #1769e0;
        font-weight: 700;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      code {
        font-family: "Cascadia Code", "Consolas", monospace;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <h1>Không tìm thấy bài nộp</h1>
      <p>Không có thư mục nào khớp với <code>${escapeHtml(folderName)}</code>.</p>
      <p><a href="/projects">Quay lại danh sách bài nộp</a></p>
    </main>
  </body>
</html>`;
}

function renderProjectIndex({
  displayName,
  seatNumber,
  folderName,
  createdAt,
  files,
}) {
  const fileItems = files
    .map(
      (file) => `
        <li class="file-item">
          <a href="${encodeProjectFileUrl(folderName, file.name)}" target="_blank" rel="noopener">${escapeHtml(file.name)}</a>
          <span>${escapeHtml(formatFileSize(file.size))}</span>
        </li>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(displayName)} | Bài đã nộp</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3f6fb;
        --panel: #ffffff;
        --line: #dde5f0;
        --text: #172033;
        --muted: #697488;
        --accent: #1769e0;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 24px 14px;
        font-family: "Segoe UI", "Noto Sans", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(23, 105, 224, 0.08), transparent 28%),
          linear-gradient(180deg, #fbfcff 0%, var(--bg) 100%);
      }
      .shell {
        width: min(860px, 100%);
        margin: 0 auto;
        padding: 24px;
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid var(--line);
        border-radius: 22px;
        box-shadow: 0 20px 54px rgba(27, 39, 61, 0.1);
      }
      .eyebrow {
        display: inline-block;
        margin-bottom: 10px;
        padding: 6px 10px;
        color: var(--accent);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        background: rgba(23, 105, 224, 0.08);
        border-radius: 999px;
      }
      h1 {
        margin: 0;
        font-size: clamp(28px, 5vw, 40px);
        letter-spacing: -0.04em;
      }
      .meta {
        margin: 10px 0 0;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.6;
      }
      .path {
        margin: 18px 0 0;
        padding: 12px 14px;
        color: var(--muted);
        font-size: 13px;
        background: #f7f9fc;
        border: 1px solid var(--line);
        border-radius: 14px;
      }
      .path code {
        color: var(--text);
        font-family: "Cascadia Code", "Consolas", monospace;
      }
      .list {
        margin: 22px 0 0;
        padding: 0;
        list-style: none;
        border-top: 1px solid var(--line);
      }
      .file-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 0;
        border-bottom: 1px solid var(--line);
      }
      .file-item a {
        color: var(--accent);
        font-weight: 700;
        text-decoration: none;
        word-break: break-all;
      }
      .file-item a:hover {
        text-decoration: underline;
      }
      .file-item span {
        color: var(--muted);
        font-size: 13px;
        white-space: nowrap;
      }
      @media (max-width: 640px) {
        body { padding: 12px 10px; }
        .shell { padding: 18px 16px; border-radius: 18px; }
        .file-item {
          flex-direction: column;
          align-items: flex-start;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <h1>${escapeHtml(displayName)}</h1>
      <p class="meta">Số ghế: ${escapeHtml(seatNumber)}<br />Cập nhật lúc: ${escapeHtml(
        new Date(createdAt).toLocaleString("vi-VN", {
          timeZone: "Asia/Ho_Chi_Minh",
        }),
      )}</p>
      <div class="path">Đường dẫn: <code>/projects/${escapeHtml(folderName)}</code></div>
      <ul class="list">${fileItems}</ul>
    </main>
  </body>
</html>`;
}

function parseSubmissionFiles(filesPayload) {
  if (!Array.isArray(filesPayload) || filesPayload.length === 0) {
    throw new Error("Vui lòng chọn ít nhất một tệp.");
  }

  if (filesPayload.length > MAX_PROJECT_FILES) {
    throw new Error(`Chỉ được tải lên tối đa ${MAX_PROJECT_FILES} tệp.`);
  }

  let totalBytes = 0;

  return filesPayload.map((file, index) => {
    const relativePath = sanitizeProjectRelativePath(
      file?.relativePath || file?.name,
      index,
    );
    const mimeType = String(file?.mimeType || "application/octet-stream").slice(
      0,
      100,
    );
    const base64 = String(file?.base64 || "").trim();

    if (!/^[a-z0-9+/=]+$/i.test(base64)) {
      throw new Error(`Tệp ${relativePath} không hợp lệ.`);
    }

    const buffer = Buffer.from(base64, "base64");

    if (buffer.length > MAX_PROJECT_FILE_BYTES) {
      throw new Error(`Tệp ${relativePath} vượt quá dung lượng cho phép.`);
    }

    totalBytes += buffer.length;

    if (totalBytes > MAX_PROJECT_TOTAL_BYTES) {
      throw new Error("Tổng dung lượng tệp đã vượt quá giới hạn.");
    }

    return {
      relativePath,
      mimeType,
      size: buffer.length,
      buffer,
    };
  });
}

const httpsOptions = loadHttpsOptions();
const appServer = httpsOptions
  ? https.createServer(httpsOptions, app)
  : http.createServer(app);
const io = new Server(appServer);
const APP_PORT = httpsOptions ? HTTPS_PORT : HTTP_PORT;

app.use(express.urlencoded({ extended: false }));
app.use((req, res, next) => {
  setBasicSecurityHeaders(res);
  next();
});
app.use((req, res, next) => {
  if (req.path === "/admin.html" || req.path === "/admin-login.html") {
    res.redirect("/admin");
    return;
  }

  next();
});
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    storedMessages: messages.length,
  });
});

app.get("/admin", (req, res) => {
  setNoStore(res);
  const target = hasAdminAccess(req.headers.cookie)
    ? "admin.html"
    : "admin-login.html";

  res.sendFile(path.join(__dirname, "public", target));
});

app.get("/jscompiler", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "jscompiler.html"));
});

app.get("/api/admin/projects", (req, res) => {
  if (!hasAdminAccess(req.headers.cookie)) {
    res.status(403).json({
      ok: false,
      message: "Forbidden",
    });
    return;
  }

  res.json({
    ok: true,
    projects: collectProjectSummaries(),
  });
});

app.get("/api/projects/status", (req, res) => {
  const summary = getProjectSubmissionStatus(
    req.query?.name,
    req.query?.seatNumber,
  );

  if (!summary) {
    res.json({
      ok: true,
      submitted: false,
    });
    return;
  }

  res.json({
    ok: true,
    submitted: true,
    ...summary,
  });
});

app.get("/projects", (_req, res) => {
  res.type("html").send(renderProjectsLanding(collectProjectFolders()));
});

app.get("/projects/:folderName", (req, res, next) => {
  const folderName = normalizePathSegment(req.params.folderName, "");

  if (!folderName) {
    next();
    return;
  }

  const folderPath = path.join(PROJECTS_ROOT, folderName);

  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    res.status(404).type("html").send(renderProjectNotFound(folderName));
    return;
  }

  const manifest = readProjectManifest(folderPath);
  const files = collectProjectFiles(folderPath, manifest);
  const stats = fs.statSync(folderPath);
  const createdAt =
    manifest?.updatedAt ||
    manifest?.createdAt ||
    stats.birthtime.toISOString();

  res.type("html").send(
    renderProjectIndex({
      displayName: manifest?.displayName || folderName,
      seatNumber: manifest?.seatNumber || "-",
      folderName,
      createdAt,
      files,
    }),
  );
});

app.get("/projects/:folderName/*", (req, res, next) => {
  const folderName = normalizePathSegment(req.params.folderName, "");
  const relativePath = sanitizeProjectRelativePath(req.params[0], 0);

  if (!folderName || !relativePath || relativePath === "submission.json") {
    next();
    return;
  }

  const folderPath = path.join(PROJECTS_ROOT, folderName);
  const targetPath = path.join(folderPath, ...relativePath.split("/"));

  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    next();
    return;
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  if (isSandboxedProjectFile(relativePath)) {
    res.setHeader("Content-Security-Policy", PROJECT_PREVIEW_CSP);
  }

  res.sendFile(targetPath);
});

app.post("/admin/login", (req, res) => {
  const limitState = takeRateLimitHit(
    "admin-login",
    getClientIp(req),
    LOGIN_RATE_LIMIT_WINDOW_MS,
    LOGIN_RATE_LIMIT_MAX,
  );

  if (!limitState.allowed) {
    res.setHeader("Retry-After", String(limitState.retryAfterSec));
    res.status(429).type("text/plain; charset=utf-8").send(
      "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.",
    );
    return;
  }

  if (String(req.body?.password || "") !== ADMIN_PASSWORD) {
    res.redirect("/admin?error=1");
    return;
  }

  setAdminCookie(res, Boolean(httpsOptions));
  res.redirect("/admin");
});

app.post("/api/projects", (req, res, next) => {
  const limitState = takeRateLimitHit(
    "project-upload",
    getClientIp(req),
    PROJECT_UPLOAD_RATE_LIMIT_WINDOW_MS,
    PROJECT_UPLOAD_RATE_LIMIT_MAX,
  );

  if (!limitState.allowed) {
    res.setHeader("Retry-After", String(limitState.retryAfterSec));
    res.status(429).json({
      ok: false,
      message: "업로드 요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
    });
    return;
  }

  next();
});

app.post("/api/projects", express.json({ limit: "80mb" }), (req, res) => {
  try {
    const displayName = normalizeProfileText(req.body?.name, 40);
    const seatNumber = normalizeProfileText(req.body?.seatNumber, 20);

    if (!displayName || !seatNumber) {
      res.status(400).json({
        ok: false,
        message: "Vui lòng nhập đầy đủ tên và số ghế.",
      });
      return;
    }

    const folderName = normalizePathSegment(displayName, "student");
    const folderPath = path.join(PROJECTS_ROOT, folderName);
    const incomingFiles = parseSubmissionFiles(req.body?.files);
    const existingManifest = readProjectManifest(folderPath);
    const knownProjectPaths = buildManifestProjectPathSet(existingManifest);

    fs.mkdirSync(folderPath, { recursive: true });

    const savedFiles = incomingFiles.map((file) => {
      removeLegacyGeneratedIndexIfNeeded(
        folderPath,
        knownProjectPaths,
        file.relativePath,
      );

      const relativeDirectory = path.posix.dirname(file.relativePath);
      const desiredFileName = path.posix.basename(file.relativePath);
      const outputDirectory =
        relativeDirectory === "."
          ? folderPath
          : path.join(folderPath, ...relativeDirectory.split("/"));

      fs.mkdirSync(outputDirectory, { recursive: true });

      const finalFileName = resolveProjectOutputFileName(
        outputDirectory,
        desiredFileName,
      );
      const finalRelativePath =
        relativeDirectory === "."
          ? finalFileName
          : `${relativeDirectory}/${finalFileName}`;
      const outputPath = path.join(outputDirectory, finalFileName);

      fs.writeFileSync(outputPath, file.buffer);

      return {
        name: path.posix.basename(finalRelativePath),
        path: finalRelativePath,
        size: file.size,
        mimeType: file.mimeType,
      };
    });

    const allKnownPaths = new Set([
      ...knownProjectPaths,
      ...savedFiles.map((file) => file.path),
    ]);
    const allFiles = collectProjectFiles(folderPath, {
      files: Array.from(allKnownPaths).map((storedPath) => ({ path: storedPath })),
    });
    const createdAt = existingManifest?.createdAt || new Date().toISOString();
    const updatedAt = new Date().toISOString();
    const manifest = {
      displayName,
      seatNumber,
      folderName,
      createdAt,
      updatedAt,
      files: allFiles.map((file) => ({
        name: path.posix.basename(file.name),
        path: file.name,
        size: file.size,
      })),
    };
    const previewFile = manifest.files.find((file) =>
      /\.(html?|xhtml)$/i.test(file.path),
    );

    fs.writeFileSync(
      path.join(folderPath, "submission.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );

    res.json({
      ok: true,
      message: "Nộp bài thành công.",
      folderName,
      projectUrl: `/projects/${encodeURIComponent(folderName)}`,
      previewUrl: previewFile
        ? encodeProjectFileUrl(folderName, previewFile.path)
        : "",
      files: manifest.files.map((file) => ({
        name: file.name,
        path: file.path,
        size: file.size,
        url: encodeProjectFileUrl(folderName, file.path),
      })),
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error.message || "Không thể tải lên bài tập.",
    });
  }
});

io.on("connection", (socket) => {
  socket.on("join", (payload = {}) => {
    if (socket.data.user) {
      return;
    }

    const role = payload.role === "admin" ? "admin" : "student";

    if (role === "admin" && !hasAdminAccess(socket.handshake.headers.cookie)) {
      socket.disconnect(true);
      return;
    }

    const defaultName = role === "admin" ? "Quản trị" : "";
    const defaultSeat = role === "admin" ? "-" : "";
    const name = normalizeProfileText(payload.name || defaultName, 20);
    const seatNumber = normalizeProfileText(payload.seatNumber || defaultSeat, 20);

    if (!name || !seatNumber) {
      socket.emit("chat:error", "Vui lòng nhập tên và số ghế.");
      return;
    }

    socket.data.user = { name, seatNumber, role };
    socket.emit("chat:history", { messages });
  });

  socket.on("chat:message", (payload = {}) => {
    const user = socket.data.user;

    if (!user) {
      socket.emit("chat:error", "Hãy vào phòng chat trước khi gửi tin nhắn.");
      return;
    }

    const text = normalizeMessageText(payload.text, MAX_TEXT_LENGTH);
    const imageDataUrl = normalizeImageDataUrl(payload.image?.dataUrl);
    const image = imageDataUrl ? { dataUrl: imageDataUrl } : null;

    if (image && user.role !== "admin") {
      socket.emit("chat:error", "Chỉ quản trị mới có thể gửi hình ảnh.");
      return;
    }

    if (!text.trim() && !image) {
      return;
    }

    const message = buildMessage({
      text,
      user,
      image,
    });

    pushMessage(message);
    io.emit("chat:message", message);
  });

  socket.on("reaction:send", (payload = {}) => {
    const user = socket.data.user;

    if (!user) {
      socket.emit("chat:error", "Hãy vào phòng chat trước khi gửi cảm xúc.");
      return;
    }

    const symbol = ALLOWED_REACTIONS.has(payload.symbol)
      ? payload.symbol
      : "👍";
    io.emit("reaction:send", buildReaction(user, symbol));
  });
});

appServer.listen(APP_PORT, () => {
  const protocol = httpsOptions ? "https" : "http";
  console.log(`Server listening on ${protocol}://localhost:${APP_PORT}`);
});

if (httpsOptions && HTTP_PORT !== HTTPS_PORT) {
  http
    .createServer((req, res) => {
      const host = req.headers.host || "vchat.kro.kr";
      const hostname = host.split(":")[0];
      const httpsPortSegment = HTTPS_PORT === 443 ? "" : `:${HTTPS_PORT}`;
      const location = `https://${hostname}${httpsPortSegment}${req.url || "/"}`;

      res.writeHead(301, { Location: location });
      res.end();
    })
    .listen(HTTP_PORT, () => {
      console.log(`HTTP redirect listening on http://localhost:${HTTP_PORT}`);
    });
}
