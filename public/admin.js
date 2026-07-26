const adminMessageList = document.getElementById("adminMessageList");
const adminMessageForm = document.getElementById("adminMessageForm");
const adminMessageInput = document.getElementById("adminMessageInput");
const adminMessageCount = document.getElementById("adminMessageCount");
const adminImagePreview = document.getElementById("adminImagePreview");
const adminPreviewImage = document.getElementById("adminPreviewImage");
const adminImageRemove = document.getElementById("adminImageRemove");
const reactionLayer = document.getElementById("reactionLayer");
const imageModal = document.getElementById("imageModal");
const imageModalClose = document.getElementById("imageModalClose");
const imageModalImage = document.getElementById("imageModalImage");
const adminProjectList = document.getElementById("adminProjectList");

const VIETNAM_TIMEZONE = "Asia/Ho_Chi_Minh";
const VIETNAMESE_LOCALE = "vi-VN";
const MAX_PASTE_IMAGE_BYTES = 3 * 1024 * 1024;
const CODE_PREVIEW_LINE_LIMIT = 50;
const PROJECT_REFRESH_INTERVAL_MS = 15000;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const socket = io();
const adminProfile = {
  name: "Quản trị",
  seatNumber: "-",
  role: "admin",
};

let pendingImage = null;
adminProfile.name = "운영자";

function openImageModal(src, alt = "Ảnh phóng to") {
  imageModalImage.src = src;
  imageModalImage.alt = alt;
  imageModal.classList.remove("hidden");
  imageModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeImageModal() {
  imageModal.classList.add("hidden");
  imageModal.setAttribute("aria-hidden", "true");
  imageModalImage.removeAttribute("src");
  document.body.classList.remove("modal-open");
}

function updateMessageCount() {
  adminMessageCount.textContent = `${adminMessageInput.value.length.toLocaleString(
    VIETNAMESE_LOCALE,
  )} / 30,000`;
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString(VIETNAMESE_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: VIETNAM_TIMEZONE,
  });
}

function formatProjectDateTime(value) {
  if (!value) {
    return "--";
  }

  return new Date(value).toLocaleString(VIETNAMESE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: VIETNAM_TIMEZONE,
  });
}

function renderAdminProjectList(projects) {
  if (!adminProjectList) {
    return;
  }

  adminProjectList.innerHTML = "";

  if (!Array.isArray(projects) || projects.length === 0) {
    const empty = document.createElement("p");
    empty.className = "admin-project-empty";
    empty.textContent = "Chưa có bài nộp nào.";
    adminProjectList.appendChild(empty);
    return;
  }

  projects.forEach((project) => {
    const link = document.createElement("a");
    link.className = "admin-project-card";
    link.href = project.projectUrl || project.previewUrl || "#";
    link.target = "_blank";
    link.rel = "noopener";

    const title = document.createElement("strong");
    title.className = "admin-project-name";
    title.textContent = project.displayName || project.folderName || "Student";

    const meta = document.createElement("p");
    meta.className = "admin-project-meta";
    meta.textContent = `Ghế ${project.seatNumber || "-"} • ${
      project.fileCount || 0
    } tệp • ${formatProjectDateTime(project.updatedAt)}`;

    const badge = document.createElement("span");
    badge.className = "admin-project-open";
    badge.textContent = "Mở thư mục";

    link.append(title, meta, badge);
    adminProjectList.appendChild(link);
  });
}

async function loadAdminProjects({ silent = false } = {}) {
  if (!adminProjectList) {
    return;
  }

  if (!silent) {
    adminProjectList.classList.add("is-loading");
  }

  try {
    const response = await fetch("/api/admin/projects", {
      credentials: "same-origin",
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "Không thể tải danh sách bài nộp.");
    }

    renderAdminProjectList(payload.projects);
  } catch (error) {
    adminProjectList.innerHTML = "";
    const empty = document.createElement("p");
    empty.className = "admin-project-empty";
    empty.textContent = error.message || "Không thể tải danh sách bài nộp.";
    adminProjectList.appendChild(empty);
  } finally {
    adminProjectList.classList.remove("is-loading");
  }
}

function buildAuthorText(user) {
  if (user.role === "admin") {
    return `${user.name} · Quản trị`;
  }

  return `${user.name} · Ghế ${user.seatNumber}`;
}

function getLanguageMeta(rawLanguage) {
  const normalized = String(rawLanguage || "").trim().toLowerCase();

  if (normalized === "js" || normalized === "javascript") {
    return { key: "javascript", label: "JavaScript" };
  }

  if (normalized === "html") {
    return { key: "html", label: "HTML" };
  }

  if (normalized === "css") {
    return { key: "css", label: "CSS" };
  }

  if (normalized === "json") {
    return { key: "json", label: "JSON" };
  }

  if (normalized) {
    return {
      key: normalized,
      label: normalized.charAt(0).toUpperCase() + normalized.slice(1),
    };
  }

  return { key: "code", label: "Code" };
}

function countMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function inferCodeLanguage(text) {
  const trimmed = text.trim();

  if (!trimmed) {
    return getLanguageMeta("");
  }

  if (/<\/?[a-z][^>]*>/i.test(trimmed)) {
    return getLanguageMeta("html");
  }

  if (
    (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
    /"[^"]+"\s*:/.test(trimmed)
  ) {
    try {
      JSON.parse(trimmed);
      return getLanguageMeta("json");
    } catch {
      // Ignore parse failure and continue scoring.
    }
  }

  const jsScore =
    countMatches(
      trimmed,
      /\b(const|let|var|function|return|if|else|for|while|import|export|class|async|await|new|try|catch|switch|case|break|continue|throw)\b/g,
    ) *
      4 +
    countMatches(
      trimmed,
      /\b(console|document|window|addEventListener|querySelector|getElementById|setTimeout|setInterval|fetch|map|filter|reduce)\b/g,
    ) *
      3 +
    countMatches(trimmed, /=\s*\{/g) * 4 +
    countMatches(trimmed, /(^|\n)\s*[A-Za-z_$][\w$]*\s*:\s*.+,\s*$/gm) * 2 +
    countMatches(trimmed, /=>/g) * 4 +
    countMatches(trimmed, /\b[A-Za-z_$][\w$]*\s*\(/g);

  const cssScore =
    countMatches(trimmed, /(^|\n)\s*[@.#]?[a-zA-Z][^={\n]*\{/gm) * 3 +
    countMatches(trimmed, /(^|\n)\s*[\w-]+\s*:\s*[^;}{\n]+;?/gm) * 2 +
    countMatches(trimmed, /#[0-9a-fA-F]{3,8}\b/g) +
    countMatches(trimmed, /\b(px|rem|em|vh|vw|%|rgba?|hsla?)\b/g);

  if (jsScore > 0 && jsScore >= cssScore) {
    return getLanguageMeta("javascript");
  }

  if (cssScore > 0) {
    return getLanguageMeta("css");
  }

  return getLanguageMeta("");
}

function parseCodeMessage(text) {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/^```([\w-]+)?\r?\n([\s\S]*?)\r?\n?```$/);

  if (fencedMatch) {
    const explicitLanguage = getLanguageMeta(fencedMatch[1]);
    const inferredLanguage = inferCodeLanguage(fencedMatch[2]);
    const language = fencedMatch[1] ? explicitLanguage : inferredLanguage;

    return {
      languageKey: language.key,
      languageLabel: language.label,
      code: fencedMatch[2].replace(/\n$/, ""),
    };
  }

  const lines = trimmed.split(/\r?\n/);
  const htmlLike = /<\/?[a-z][^>]*>/i.test(trimmed);
  const jsonLike =
    lines.length >= 2 &&
    (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
    /[:[\]{}]/.test(trimmed);
  const jsLike =
    /\b(const|let|var|function|return|if|else|for|while|import|export|class|async|await|document\.|window\.|addEventListener)\b/.test(
      trimmed,
    ) || trimmed.includes("=>");
  const cssLike =
    /(^|\n)\s*[@.#]?[a-zA-Z][^{\n]*\{\s*[\w-]+\s*:/m.test(trimmed) ||
    /(^|\n)\s*[\w-]+\s*:\s*[^;}{\n]+;?/m.test(trimmed);
  const genericCodeLike =
    lines.length >= 2 &&
    /[{};<>:=]/.test(trimmed) &&
    /(^|\n)( {2,}|\t)/.test(text);

  if (!htmlLike && !jsonLike && !jsLike && !cssLike && !genericCodeLike) {
    return null;
  }

  const language = inferCodeLanguage(trimmed);

  return {
    languageKey: language.key,
    languageLabel: language.label,
    code: text.replace(/^\n+|\n+$/g, ""),
  };
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stashTokens(text, matcher, className, tokens) {
  return text.replace(matcher, (match) => {
    const token = `__CODE_TOKEN_${tokens.length}__`;
    tokens.push(`<span class="${className}">${escapeHtml(match)}</span>`);
    return token;
  });
}

function restoreTokens(text, tokens) {
  let output = text;

  tokens.forEach((value, index) => {
    output = output.replaceAll(`__CODE_TOKEN_${index}__`, value);
  });

  return output;
}

function highlightJavaScript(code) {
  const tokens = [];
  let text = code;

  text = stashTokens(
    text,
    /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    "token-comment",
    tokens,
  );
  text = stashTokens(
    text,
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,
    "token-string",
    tokens,
  );

  let html = escapeHtml(text);
  html = html.replace(
    /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|async|await|new|try|catch|switch|case|break|continue|throw|default)\b/g,
    '<span class="token-keyword">$1</span>',
  );
  html = html.replace(
    /\b(true|false|null|undefined)\b/g,
    '<span class="token-literal">$1</span>',
  );
  html = html.replace(
    /\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi,
    '<span class="token-number">$1</span>',
  );
  html = html.replace(
    /\b([A-Za-z_$][\w$]*)(?=\s*\()/g,
    '<span class="token-function">$1</span>',
  );

  return restoreTokens(html, tokens);
}

function highlightCss(code) {
  const tokens = [];
  let text = code;

  text = stashTokens(text, /\/\*[\s\S]*?\*\//g, "token-comment", tokens);
  text = stashTokens(
    text,
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    "token-string",
    tokens,
  );

  let html = escapeHtml(text);
  html = html.replace(
    /(^|})([^{}]+)\{/g,
    (_, brace, selector) =>
      `${brace}<span class="token-selector">${selector.trim()}</span>{`,
  );
  html = html.replace(
    /(^|[\s{;])([a-z-]+)(\s*:)/gi,
    '$1<span class="token-property">$2</span>$3',
  );
  html = html.replace(
    /(@[a-z-]+)/gi,
    '<span class="token-keyword">$1</span>',
  );
  html = html.replace(
    /(#[0-9a-fA-F]{3,8}\b|\b-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|s|ms)?\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\))/gi,
    '<span class="token-number">$1</span>',
  );

  return restoreTokens(html, tokens);
}

function highlightJson(code) {
  let html = escapeHtml(code);

  html = html.replace(
    /&quot;([^&]|&(amp|lt|gt|quot);)*&quot;(?=\s*:)/g,
    '<span class="token-property">$&</span>',
  );
  html = html.replace(
    /&quot;([^&]|&(amp|lt|gt|quot);)*&quot;/g,
    '<span class="token-string">$&</span>',
  );
  html = html.replace(
    /\b(true|false|null)\b/g,
    '<span class="token-literal">$1</span>',
  );
  html = html.replace(
    /\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi,
    '<span class="token-number">$1</span>',
  );

  return html;
}

function highlightHtml(code) {
  const escaped = escapeHtml(code);
  const tagPattern = /(&lt;\/?)([\w:-]+)([^&]*?)(&gt;)/g;

  return escaped.replace(tagPattern, (_, open, tag, attrs, close) => {
    const highlightedAttrs = attrs.replace(
      /([\w:-]+)(=)(&quot;.*?&quot;|&apos;.*?&apos;)?/g,
      (_attrMatch, name, equals, value = "") =>
        `<span class="token-attr">${name}</span>${equals}${
          value ? `<span class="token-string">${value}</span>` : ""
        }`,
    );

    return `${open}<span class="token-tag">${tag}</span>${highlightedAttrs}${close}`;
  });
}

function highlightCode(code, languageKey) {
  if (languageKey === "html") {
    return highlightHtml(code);
  }

  if (languageKey === "css") {
    return highlightCss(code);
  }

  if (languageKey === "json") {
    return highlightJson(code);
  }

  if (languageKey === "javascript") {
    return highlightJavaScript(code);
  }

  return escapeHtml(code);
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "absolute";
    helper.style.left = "-9999px";
    document.body.appendChild(helper);
    helper.select();

    const success = document.execCommand("copy");
    helper.remove();
    return success;
  }
}

function createCodeBlock(codeInfo) {
  const wrapper = document.createElement("div");
  wrapper.className = "message-code";

  const header = document.createElement("div");
  header.className = "message-code-header";

  const language = document.createElement("span");
  language.className = "message-code-language";
  language.textContent = codeInfo.languageLabel || "Code";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "message-code-copy";
  copyButton.textContent = "Copy";

  const lines = codeInfo.code.split(/\r?\n/);
  const shouldCollapse = lines.length > CODE_PREVIEW_LINE_LIMIT;
  let expanded = !shouldCollapse;

  const pre = document.createElement("pre");
  pre.className = "message-code-content";

  const codeElement = document.createElement("code");
  pre.appendChild(codeElement);

  const footer = document.createElement("div");
  footer.className = "message-code-footer hidden";

  const ellipsis = document.createElement("span");
  ellipsis.className = "message-code-ellipsis";
  ellipsis.textContent = "...";

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "message-code-toggle";

  function renderVisibleCode() {
    const visibleCode = expanded
      ? codeInfo.code
      : lines.slice(0, CODE_PREVIEW_LINE_LIMIT).join("\n");
    codeElement.innerHTML = highlightCode(visibleCode, codeInfo.languageKey);

    if (!shouldCollapse) {
      footer.classList.add("hidden");
      return;
    }

    footer.classList.remove("hidden");
    ellipsis.classList.toggle("hidden", expanded);
    toggleButton.textContent = expanded ? "Thu gọn" : "Xem toàn bộ";
  }

  let resetTimer = null;

  copyButton.addEventListener("click", async () => {
    const copied = await copyTextToClipboard(codeInfo.code);

    copyButton.textContent = copied ? "Copied" : "Failed";
    copyButton.classList.toggle("is-copied", copied);
    copyButton.classList.toggle("is-failed", !copied);
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      copyButton.textContent = "Copy";
      copyButton.classList.remove("is-copied", "is-failed");
    }, 1200);
  });

  toggleButton.addEventListener("click", () => {
    expanded = !expanded;
    renderVisibleCode();
  });

  footer.append(ellipsis, toggleButton);
  header.append(language, copyButton);
  wrapper.append(header, pre, footer);
  renderVisibleCode();
  return wrapper;
}

function createTextContentNode(text) {
  const codeInfo = parseCodeMessage(text);

  if (codeInfo) {
    return createCodeBlock(codeInfo);
  }

  const plain = document.createElement("pre");
  plain.className = "message-text";
  plain.textContent = text;
  return plain;
}

function renderImagePreview() {
  if (!pendingImage?.dataUrl) {
    adminPreviewImage.removeAttribute("src");
    adminImagePreview.classList.add("hidden");
    return;
  }

  adminPreviewImage.src = pendingImage.dataUrl;
  adminImagePreview.classList.remove("hidden");
}

function clearPendingImage() {
  pendingImage = null;
  renderImagePreview();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Không thể đọc hình ảnh."));
    reader.readAsDataURL(file);
  });
}

function renderLikeReaction(reaction) {
  if (!reactionLayer) {
    return;
  }

  const item = document.createElement("div");
  item.className = "floating-like";
  item.dataset.symbol = reaction.symbol || "👍";
  item.style.left = `${reaction.x || 50}%`;
  item.style.setProperty("--drift", `${reaction.drift || 0}px`);
  item.style.setProperty("--duration", `${reaction.durationMs || 1800}ms`);
  item.title = reaction.user?.name ? `${reaction.user.name}` : "reaction";

  const icon = document.createElement("span");
  icon.className = "floating-like-icon";
  icon.textContent = reaction.symbol || "👍";
  icon.style.fontSize = `${reaction.size || 24}px`;

  const label = document.createElement("span");
  label.className = "floating-like-label";
  label.textContent = reaction.user?.name || "";

  item.append(icon, label);
  reactionLayer.appendChild(item);
  item.addEventListener("animationend", () => {
    item.remove();
  });
}

function appendMessageImage(container, message) {
  if (!message.image?.dataUrl) {
    return;
  }

  const block = document.createElement("div");
  block.className = "message-image-block";

  const image = document.createElement("img");
  image.className = "message-image";
  image.src = message.image.dataUrl;
  image.alt = "Hình ảnh do quản trị gửi";
  image.loading = "lazy";
  image.addEventListener("click", () => {
    openImageModal(message.image.dataUrl, image.alt);
  });

  const note = document.createElement("p");
  note.className = "message-image-note";
  note.textContent = "Bấm vào ảnh để phóng to.";

  block.append(image, note);
  container.appendChild(block);
}

function renderMessage(message) {
  const item = document.createElement("article");
  item.className = `message-item ${message.type === "system" ? "system" : ""} ${
    message.user?.role === "admin" ? "admin" : ""
  }`.trim();

  const meta = document.createElement("span");
  meta.className = "message-meta";
  meta.textContent =
    message.type === "system"
      ? `Lớp học · ${formatTime(message.createdAt)}`
      : `${buildAuthorText(message.user)} · ${formatTime(message.createdAt)}`;

  item.appendChild(meta);
  appendMessageImage(item, message);

  if (message.text) {
    item.appendChild(createTextContentNode(message.text));
  }

  adminMessageList.appendChild(item);
  adminMessageList.scrollTop = adminMessageList.scrollHeight;
}

function renderHistory(messages) {
  adminMessageList.innerHTML = "";
  messages.forEach(renderMessage);
}

buildAuthorText = function buildAuthorTextKo(user) {
  if (user.role === "admin") {
    return `${user.name} · 관리자`;
  }

  return `${user.name} · ${user.seatNumber}번 좌석`;
};

renderAdminProjectList = function renderAdminProjectListKo(projects) {
  if (!adminProjectList) {
    return;
  }

  adminProjectList.innerHTML = "";

  if (!Array.isArray(projects) || projects.length === 0) {
    const empty = document.createElement("p");
    empty.className = "admin-project-empty";
    empty.textContent = "제출된 과제가 없습니다.";
    adminProjectList.appendChild(empty);
    return;
  }

  projects.forEach((project) => {
    const link = document.createElement("a");
    link.className = "admin-project-card";
    link.href = project.projectUrl || project.previewUrl || "#";
    link.target = "_blank";
    link.rel = "noopener";

    const title = document.createElement("strong");
    title.className = "admin-project-name";
    title.textContent = project.displayName || project.folderName || "Student";

    const meta = document.createElement("p");
    meta.className = "admin-project-meta";
    meta.textContent = `${project.seatNumber || "-"}번 좌석 · ${
      project.fileCount || 0
    }개 파일 · ${formatProjectDateTime(project.updatedAt)}`;

    const badge = document.createElement("span");
    badge.className = "admin-project-open";
    badge.textContent = "폴더 열기";

    link.append(title, meta, badge);
    adminProjectList.appendChild(link);
  });
};

loadAdminProjects = async function loadAdminProjectsKo({ silent = false } = {}) {
  if (!adminProjectList) {
    return;
  }

  if (!silent) {
    adminProjectList.classList.add("is-loading");
  }

  try {
    const response = await fetch("/api/admin/projects", {
      credentials: "same-origin",
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "제출 목록을 불러오지 못했습니다.");
    }

    renderAdminProjectList(payload.projects);
  } catch (error) {
    adminProjectList.innerHTML = "";
    const empty = document.createElement("p");
    empty.className = "admin-project-empty";
    empty.textContent = error.message || "제출 목록을 불러오지 못했습니다.";
    adminProjectList.appendChild(empty);
  } finally {
    adminProjectList.classList.remove("is-loading");
  }
};

appendMessageImage = function appendMessageImageKo(container, message) {
  if (!message.image?.dataUrl) {
    return;
  }

  const block = document.createElement("div");
  block.className = "message-image-block";

  const image = document.createElement("img");
  image.className = "message-image";
  image.src = message.image.dataUrl;
  image.alt = "관리자가 보낸 이미지";
  image.loading = "lazy";
  image.addEventListener("click", () => {
    openImageModal(message.image.dataUrl, image.alt);
  });

  const note = document.createElement("p");
  note.className = "message-image-note";
  note.textContent = "사진을 누르면 크게 볼 수 있습니다.";

  block.append(image, note);
  container.appendChild(block);
};

renderMessage = function renderMessageKo(message) {
  const item = document.createElement("article");
  item.className = `message-item ${message.type === "system" ? "system" : ""} ${
    message.user?.role === "admin" ? "admin" : ""
  }`.trim();

  const meta = document.createElement("span");
  meta.className = "message-meta";
  meta.textContent =
    message.type === "system"
      ? `안내 · ${formatTime(message.createdAt)}`
      : `${buildAuthorText(message.user)} · ${formatTime(message.createdAt)}`;

  item.appendChild(meta);
  appendMessageImage(item, message);

  if (message.text) {
    item.appendChild(createTextContentNode(message.text));
  }

  adminMessageList.appendChild(item);
  adminMessageList.scrollTop = adminMessageList.scrollHeight;
};

renderAdminProjectList = function renderAdminProjectListFolderOnly(projects) {
  if (!adminProjectList) {
    return;
  }

  adminProjectList.innerHTML = "";

  if (!Array.isArray(projects) || projects.length === 0) {
    const empty = document.createElement("p");
    empty.className = "admin-project-empty";
    empty.textContent = "제출된 과제가 없습니다.";
    adminProjectList.appendChild(empty);
    return;
  }

  projects.forEach((project) => {
    const link = document.createElement("a");
    link.className = "admin-project-card";
    link.href = project.projectUrl || project.previewUrl || "#";
    link.target = "_blank";
    link.rel = "noopener";

    const title = document.createElement("strong");
    title.className = "admin-project-name";
    title.textContent = project.displayName || project.folderName || "Student";

    const meta = document.createElement("p");
    meta.className = "admin-project-meta";
    meta.textContent = `${project.seatNumber || "-"}번 좌석 · ${
      project.fileCount || 0
    }개 파일 · ${formatProjectDateTime(project.updatedAt)}`;

    const badge = document.createElement("span");
    badge.className = "admin-project-open";
    badge.textContent = "폴더 열기";

    link.append(title, meta, badge);
    adminProjectList.appendChild(link);
  });
};

adminMessageInput.addEventListener("input", updateMessageCount);

adminMessageInput.addEventListener("paste", async (event) => {
  const items = Array.from(event.clipboardData?.items || []);
  const imageItem = items.find((item) => item.type.startsWith("image/"));

  if (!imageItem) {
    return;
  }

  event.preventDefault();

  const file = imageItem.getAsFile();

  if (!file) {
    return;
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    window.alert("Chỉ hỗ trợ ảnh PNG, JPG, WEBP hoặc GIF.");
    return;
  }

  if (file.size > MAX_PASTE_IMAGE_BYTES) {
    window.alert("Ảnh quá lớn. Hãy dùng ảnh nhỏ hơn khoảng 3MB.");
    return;
  }

  try {
    pendingImage = {
      dataUrl: await readFileAsDataUrl(file),
    };
    renderImagePreview();
  } catch (error) {
    window.alert(error.message);
  }
});

adminImageRemove.addEventListener("click", () => {
  clearPendingImage();
  adminMessageInput.focus();
});

adminPreviewImage.addEventListener("click", () => {
  if (!pendingImage?.dataUrl) {
    return;
  }

  openImageModal(pendingImage.dataUrl, "Ảnh xem trước");
});

socket.on("connect", () => {
  socket.emit("join", adminProfile);
});

socket.on("chat:history", (payload) => {
  renderHistory(payload.messages);
});

socket.on("chat:message", renderMessage);

socket.on("chat:error", (message) => {
  window.alert(message);
});

adminMessageForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = adminMessageInput.value;

  if (!text.trim() && !pendingImage) {
    return;
  }

  socket.emit("chat:message", {
    text,
    image: pendingImage,
  });

  adminMessageInput.value = "";
  updateMessageCount();
  clearPendingImage();
  adminMessageInput.focus();
});

imageModalClose.addEventListener("click", closeImageModal);

imageModal.addEventListener("click", (event) => {
  if (event.target === imageModal) {
    closeImageModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !imageModal.classList.contains("hidden")) {
    closeImageModal();
  }
});

loadAdminProjects();
window.setInterval(() => {
  loadAdminProjects({ silent: true });
}, PROJECT_REFRESH_INTERVAL_MS);

updateMessageCount();
