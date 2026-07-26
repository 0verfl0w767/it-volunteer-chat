const joinScreen = document.getElementById("joinScreen");
const chatScreen = document.getElementById("chatScreen");
const joinForm = document.getElementById("joinForm");
const messageForm = document.getElementById("messageForm");
const nameInput = document.getElementById("nameInput");
const seatInput = document.getElementById("seatInput");
const messageInput = document.getElementById("messageInput");
const messageCount = document.getElementById("messageCount");
const messageList = document.getElementById("messageList");
const submissionNotice = document.getElementById("submissionNotice");
const reactionLayer = document.getElementById("reactionLayer");
const reactionButtons = document.querySelectorAll(".reaction-button");
const imageModal = document.getElementById("imageModal");
const imageModalClose = document.getElementById("imageModalClose");
const imageModalImage = document.getElementById("imageModalImage");

const VIETNAM_TIMEZONE = "Asia/Ho_Chi_Minh";
const VIETNAMESE_LOCALE = "vi-VN";
const CODE_PREVIEW_LINE_LIMIT = 100;

const savedName = localStorage.getItem("studentName");
const savedSeat = localStorage.getItem("studentSeatNumber");

if (savedName) {
  nameInput.value = savedName;
}

if (savedSeat) {
  seatInput.value = savedSeat;
}

let socket = null;
let currentUser = null;

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
  messageCount.textContent = `${messageInput.value.length.toLocaleString(
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

function formatSubmissionDateTime(value) {
  if (!value) {
    return "";
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

function setStudentSubmissionNotice(status) {
  if (!submissionNotice) {
    return;
  }

  if (!status) {
    submissionNotice.className = "submission-notice hidden";
    submissionNotice.innerHTML = "";
    return;
  }

  const isSubmitted = Boolean(status.submitted && status.projectUrl);
  submissionNotice.className = `submission-notice ${
    isSubmitted ? "is-submitted" : "is-pending"
  }`;
  submissionNotice.innerHTML = "";

  const text = document.createElement("p");
  text.className = "submission-notice-text";
  text.textContent = isSubmitted
    ? "Bạn đã nộp bài rồi."
    : "Bạn vẫn chưa nộp bài.";

  const meta = document.createElement("p");
  meta.className = "submission-notice-meta";
  meta.textContent = isSubmitted
    ? status.updatedAt
      ? `Cập nhật lúc ${formatSubmissionDateTime(status.updatedAt)}`
      : "Bài nộp của bạn đã được lưu."
    : "Hạn nộp file: đến hết Chủ nhật, ngày 19 tháng 7 năm 2026.";

  const hint = document.createElement("p");
  hint.className = "submission-notice-hint";
  hint.append(
    isSubmitted ? "Bạn vẫn có thể dùng nút " : "Hãy dùng nút ",
  );

  const buttonName = document.createElement("span");
  buttonName.className = "submission-notice-pill";
  buttonName.textContent = "Nộp bài";

  hint.append(
    buttonName,
    isSubmitted
      ? " bên dưới để tải lại file đã sửa."
      : " bên dưới để gửi file trước thời hạn.",
  );

  submissionNotice.append(text, meta, hint);

  if (isSubmitted) {
    const actions = document.createElement("div");
    actions.className = "submission-notice-actions";

    const link = document.createElement("a");
    link.className = "submission-notice-link";
    link.href = status.projectUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Mở thư mục bài nộp";

    const path = document.createElement("code");
    path.className = "submission-notice-path";
    path.textContent = status.projectUrl;

    actions.append(link, path);
    submissionNotice.append(actions);
  }

  submissionNotice.classList.remove("hidden");
}

async function checkStudentSubmissionStatus(name, seatNumber) {
  if (!name || !seatNumber) {
    setStudentSubmissionNotice(null);
    return;
  }

  try {
    const params = new URLSearchParams({ name, seatNumber });
    const response = await fetch(`/api/projects/status?${params.toString()}`, {
      credentials: "same-origin",
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      setStudentSubmissionNotice(null);
      return;
    }

    setStudentSubmissionNotice(payload);
  } catch {
    setStudentSubmissionNotice(null);
  }
}

window.setStudentSubmissionNotice = setStudentSubmissionNotice;

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
    /\b(const|let|var|function|return|if|else|for|while|import|export|class|async|await|document\.|window\.|addEventListener|=>)\b/.test(
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

function renderLikeReaction(reaction) {
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
  const isSelf =
    message.user &&
    currentUser &&
    message.user.name === currentUser.name &&
    message.user.seatNumber === currentUser.seatNumber &&
    message.user.role === currentUser.role;

  item.className = `message-item ${message.type === "system" ? "system" : ""} ${
    isSelf ? "self" : message.user?.role === "admin" ? "admin" : ""
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

  messageList.appendChild(item);
  messageList.scrollTop = messageList.scrollHeight;
}

function showHistory(history) {
  messageList.innerHTML = "";
  history.forEach(renderMessage);
}

function attachSocket(name, seatNumber) {
  if (socket) {
    return;
  }

  socket = io();
  currentUser = { name, seatNumber, role: "student" };

  socket.on("connect", () => {
    socket.emit("join", currentUser);
  });

  socket.on("chat:history", (payload) => {
    showHistory(payload.messages);
    joinScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");
    checkStudentSubmissionStatus(name, seatNumber);
    messageInput.focus();
  });

  socket.on("chat:message", renderMessage);
  socket.on("reaction:send", renderLikeReaction);

  socket.on("chat:error", (message) => {
    window.alert(message);
  });
}

messageInput.addEventListener("input", updateMessageCount);

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = nameInput.value.trim();
  const seatNumber = seatInput.value.trim();

  if (!name || !seatNumber) {
    window.alert("Vui lòng nhập tên và số ghế.");
    return;
  }

  localStorage.setItem("studentName", name);
  localStorage.setItem("studentSeatNumber", seatNumber);
  attachSocket(name, seatNumber);
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!socket) {
    return;
  }

  const text = messageInput.value;

  if (!text.trim()) {
    return;
  }

  socket.emit("chat:message", { text });
  messageInput.value = "";
  updateMessageCount();
  messageInput.focus();
});

reactionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (!socket) {
      return;
    }

    socket.emit("reaction:send", {
      symbol: button.dataset.symbol || "👍",
    });
  });
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

updateMessageCount();
