const openProjectModalButton = document.getElementById("openProjectModalButton");
const projectModal = document.getElementById("projectModal");
const projectModalClose = document.getElementById("projectModalClose");
const projectFileInput = document.getElementById("projectFileInput");
const projectChooseButton = document.getElementById("projectChooseButton");
const projectUploadButton = document.getElementById("projectUploadButton");
const projectClearButton = document.getElementById("projectClearButton");
const projectSelectedSummary = document.getElementById("projectSelectedSummary");
const projectFileList = document.getElementById("projectFileList");
const projectProgress = document.getElementById("projectProgress");
const projectProgressBar = document.getElementById("projectProgressBar");
const projectProgressText = document.getElementById("projectProgressText");
const projectStatus = document.getElementById("projectStatus");

const PROJECT_MAX_FILES = 20;
const PROJECT_MAX_FILE_BYTES = 15 * 1024 * 1024;
const PROJECT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

let selectedProjectFiles = [];
let projectUploadBusy = false;
const projectFileStateMap = new Map();

function getProjectRelativePath(file) {
  return String(file?.webkitRelativePath || file?.name || "").replace(/\\/g, "/");
}

function buildProjectFileKey(file) {
  return [
    getProjectRelativePath(file),
    file.size,
    file.lastModified,
    file.type,
  ].join("::");
}

function formatProjectBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getProjectProfile() {
  const name = (localStorage.getItem("studentName") || nameInput.value || "").trim();
  const seatNumber = (
    localStorage.getItem("studentSeatNumber") ||
    seatInput.value ||
    ""
  ).trim();

  return { name, seatNumber };
}

function setProjectStatus(message, tone = "neutral", linkPath = "") {
  projectStatus.classList.remove("hidden", "is-success", "is-error", "is-loading");

  if (tone === "success") {
    projectStatus.classList.add("is-success");
  } else if (tone === "error") {
    projectStatus.classList.add("is-error");
  } else if (tone === "loading") {
    projectStatus.classList.add("is-loading");
  }

  projectStatus.innerHTML = "";

  const text = document.createElement("p");
  text.className = "submission-status-text";
  text.textContent = message;
  projectStatus.appendChild(text);

  if (linkPath) {
    const link = document.createElement("a");
    link.className = "submission-status-link";
    link.href = linkPath;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = `${window.location.origin}${linkPath}`;
    projectStatus.appendChild(link);
  }
}

function clearProjectStatus() {
  projectStatus.className = "submission-status hidden";
  projectStatus.innerHTML = "";
}

function showProjectProgress(label, percent) {
  projectProgress.classList.remove("hidden");
  projectProgressText.textContent = label;
  projectProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function hideProjectProgress() {
  projectProgress.classList.add("hidden");
  projectProgressBar.style.width = "0%";
  projectProgressText.textContent = "Đang chờ tệp...";
}

function setProjectUploadBusy(isBusy) {
  projectUploadBusy = isBusy;
  projectChooseButton.disabled = isBusy;
  projectUploadButton.disabled = isBusy;
  projectClearButton.disabled = isBusy;
  openProjectModalButton.disabled = isBusy;
}

function setProjectFileState(fileKey, label, tone = "neutral") {
  projectFileStateMap.set(fileKey, { label, tone });
  renderSelectedProjectFiles();
}

function resetProjectFileStates() {
  projectFileStateMap.clear();
  selectedProjectFiles.forEach((file) => {
    projectFileStateMap.set(buildProjectFileKey(file), {
      label: "Đã chọn",
      tone: "neutral",
    });
  });
}

function getSelectedProjectTotalBytes() {
  return selectedProjectFiles.reduce((total, file) => total + file.size, 0);
}

function renderSelectedProjectFiles() {
  const totalBytes = getSelectedProjectTotalBytes();
  const fileCount = selectedProjectFiles.length;

  if (fileCount === 0) {
    projectSelectedSummary.textContent = "Chưa chọn tệp nào.";
    projectClearButton.classList.add("hidden");
    projectFileList.innerHTML = "";
    return;
  }

  projectSelectedSummary.textContent = `${fileCount} tệp • ${formatProjectBytes(totalBytes)}`;
  projectClearButton.classList.remove("hidden");
  projectFileList.innerHTML = "";

  selectedProjectFiles.forEach((file) => {
    const fileKey = buildProjectFileKey(file);
    const state = projectFileStateMap.get(fileKey) || {
      label: "Đã chọn",
      tone: "neutral",
    };
    const item = document.createElement("li");
    item.className = "submission-file-item";
    item.dataset.fileKey = fileKey;

    const info = document.createElement("div");
    info.className = "submission-file-info";

    const name = document.createElement("strong");
    name.className = "submission-file-name";
    name.textContent = getProjectRelativePath(file);

    const meta = document.createElement("p");
    meta.className = "submission-file-meta";
    meta.textContent = formatProjectBytes(file.size);

    info.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "submission-file-actions";

    const badge = document.createElement("span");
    badge.className = `submission-file-badge is-${state.tone}`;
    badge.textContent = state.label;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "submission-file-remove";
    removeButton.textContent = "Xóa";
    removeButton.disabled = projectUploadBusy;

    actions.append(badge, removeButton);
    item.append(info, actions);
    projectFileList.appendChild(item);
  });
}

function clearSelectedProjectFiles() {
  selectedProjectFiles = [];
  projectFileInput.value = "";
  projectFileStateMap.clear();
  renderSelectedProjectFiles();
  hideProjectProgress();
}

function dedupeProjectFiles(fileList) {
  const map = new Map();

  [...selectedProjectFiles, ...fileList].forEach((file) => {
    map.set(buildProjectFileKey(file), file);
  });

  selectedProjectFiles = Array.from(map.values());
}

function openProjectModal() {
  clearProjectStatus();
  projectModal.classList.remove("hidden");
  projectModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  projectChooseButton.focus();
}

function closeProjectModal() {
  if (projectUploadBusy) {
    return;
  }

  projectModal.classList.add("hidden");
  projectModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function validateProjectSelection() {
  if (selectedProjectFiles.length === 0) {
    throw new Error("Hãy chọn ít nhất một tệp.");
  }

  if (selectedProjectFiles.length > PROJECT_MAX_FILES) {
    throw new Error(`Chỉ được tải lên tối đa ${PROJECT_MAX_FILES} tệp mỗi lần.`);
  }

  const totalBytes = getSelectedProjectTotalBytes();

  if (totalBytes > PROJECT_MAX_TOTAL_BYTES) {
    throw new Error("Tổng dung lượng tệp đã vượt quá 50MB.");
  }

  selectedProjectFiles.forEach((file) => {
    if (file.size > PROJECT_MAX_FILE_BYTES) {
      throw new Error(`Tệp ${file.name} vượt quá giới hạn 15MB.`);
    }
  });
}

function readFileAsBase64(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };

    reader.onerror = () => {
      reject(new Error(`Không thể đọc tệp ${file.name}.`));
    };

    reader.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === "function") {
        onProgress(event.loaded, event.total);
      }
    };

    reader.readAsDataURL(file);
  });
}

async function buildProjectUploadPayload() {
  const files = [];

  for (let index = 0; index < selectedProjectFiles.length; index += 1) {
    const file = selectedProjectFiles[index];
    const fileKey = buildProjectFileKey(file);
    showProjectProgress(
      `Đang đọc tệp ${index + 1}/${selectedProjectFiles.length}...`,
      Math.round((index / selectedProjectFiles.length) * 30),
    );
    setProjectFileState(fileKey, "Đang đọc", "loading");

    const base64 = await readFileAsBase64(file, (loaded, total) => {
      const percent = total ? Math.round((loaded / total) * 100) : 0;
      setProjectFileState(fileKey, `Đang đọc ${percent}%`, "loading");
    });

    setProjectFileState(fileKey, "Sẵn sàng", "ready");
    files.push({
      name: file.name,
      relativePath: getProjectRelativePath(file),
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      base64,
    });
  }

  return files;
}

function sendProjectPayload(payload) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/projects");
    xhr.setRequestHeader("Content-Type", "application/json");

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) {
        showProjectProgress("Đang tải tệp lên máy chủ...", 65);
        return;
      }

      const uploadPercent = Math.round((event.loaded / event.total) * 100);
      showProjectProgress(
        `Đang tải tệp lên máy chủ... ${uploadPercent}%`,
        30 + Math.round(uploadPercent * 0.7),
      );
    });

    xhr.addEventListener("load", () => {
      try {
        const response = JSON.parse(xhr.responseText || "{}");

        if (xhr.status >= 200 && xhr.status < 300 && response.ok) {
          resolve(response);
          return;
        }

        reject(new Error(response.message || "Không thể tải lên bài tập."));
      } catch {
        reject(new Error("Phản hồi máy chủ không hợp lệ."));
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Không thể kết nối tới máy chủ."));
    });

    xhr.send(JSON.stringify(payload));
  });
}

async function handleProjectUpload() {
  try {
    const profile = getProjectProfile();

    if (!profile.name || !profile.seatNumber) {
      throw new Error("Hãy vào phòng chat trước khi nộp bài.");
    }

    validateProjectSelection();
    clearProjectStatus();
    setProjectUploadBusy(true);
    resetProjectFileStates();

    const files = await buildProjectUploadPayload();
    selectedProjectFiles.forEach((file) => {
      setProjectFileState(buildProjectFileKey(file), "Đang tải lên", "loading");
    });

    const response = await sendProjectPayload({
      name: profile.name,
      seatNumber: profile.seatNumber,
      files,
    });

    showProjectProgress("Đã tải lên thành công.", 100);
    selectedProjectFiles.forEach((file) => {
      setProjectFileState(buildProjectFileKey(file), "Hoàn tất", "success");
    });
    setProjectStatus(
      `${response.message} Bạn có thể mở thư mục bài nộp ở đường dẫn dưới đây.`,
      "success",
      response.projectUrl || "",
    );
    if (typeof window.setStudentSubmissionNotice === "function") {
      window.setStudentSubmissionNotice({
        submitted: true,
        projectUrl: response.projectUrl || "",
        folderName: response.folderName || "",
        updatedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    setProjectStatus(error.message || "Không thể tải lên bài tập.", "error");
  } finally {
    setProjectUploadBusy(false);
  }
}

openProjectModalButton.addEventListener("click", openProjectModal);
projectModalClose.addEventListener("click", closeProjectModal);
projectChooseButton.addEventListener("click", () => {
  projectFileInput.click();
});
projectUploadButton.addEventListener("click", handleProjectUpload);
projectClearButton.addEventListener("click", () => {
  if (projectUploadBusy) {
    return;
  }

  clearProjectStatus();
  clearSelectedProjectFiles();
});

projectModal.addEventListener("click", (event) => {
  if (event.target === projectModal) {
    closeProjectModal();
  }
});

projectFileInput.addEventListener("change", () => {
  const incomingFiles = Array.from(projectFileInput.files || []);

  if (incomingFiles.length === 0) {
    return;
  }

  dedupeProjectFiles(incomingFiles);
  resetProjectFileStates();
  clearProjectStatus();
  hideProjectProgress();
  renderSelectedProjectFiles();
  projectFileInput.value = "";
});

projectFileList.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".submission-file-remove");

  if (!removeButton || projectUploadBusy) {
    return;
  }

  const item = removeButton.closest(".submission-file-item");
  const targetKey = item?.dataset.fileKey;

  if (!targetKey) {
    return;
  }

  selectedProjectFiles = selectedProjectFiles.filter(
    (file) => buildProjectFileKey(file) !== targetKey,
  );
  projectFileStateMap.delete(targetKey);
  clearProjectStatus();
  hideProjectProgress();
  renderSelectedProjectFiles();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !projectModal.classList.contains("hidden")) {
    closeProjectModal();
  }
});

renderSelectedProjectFiles();
