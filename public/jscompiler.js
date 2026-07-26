const compilerStateKey = "jscompiler-code-v4";
const monacoBaseUrl = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min";

const runControl = document.getElementById("runControl");
const runButton = document.getElementById("runButton");
const runStatus = document.getElementById("runStatus");
const consoleOutput = document.getElementById("consoleOutput");
const editorElement = document.getElementById("editor");

const defaultCode = `function add(a, b) {
  return a + b;
}

const total = add(12, 8);

if (total > 10) {
  console.log("total is bigger than 10");
}`;

let activeWorker = null;
let workerTimeoutId = null;
let editor = null;
let monacoLoaderPromise = null;
let monacoApi = null;

function updateStatus(label, tone = "idle") {
  const stateLabelMap = {
    Idle: "Idle",
    Loading: "Load",
    Running: "Run",
    Ready: "Done",
    Error: "Error",
  };
  const visibleLabel = stateLabelMap[label] || label;

  runControl.dataset.state = tone;
  runStatus.textContent = visibleLabel;
  runButton.setAttribute("aria-label", `${visibleLabel} code`);
  runButton.setAttribute("title", `${visibleLabel} code`);

  if (label === "Running" || label === "Loading") {
    runButton.disabled = true;
    window.requestAnimationFrame(updateRunButtonPosition);
    return;
  }

  runButton.disabled = false;
  window.requestAnimationFrame(updateRunButtonPosition);
}

function serializeLogValue(value) {
  if (value instanceof Error) {
    return value.stack || value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "undefined") {
    return "undefined";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function clearConsole() {
  consoleOutput.innerHTML = "";
}

function appendConsoleLine(level, values) {
  const line = document.createElement("div");
  line.className = `console-line is-${level}`;
  line.textContent = values.map(serializeLogValue).join(" ");
  consoleOutput.appendChild(line);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function getEditorValue() {
  return editor ? editor.getValue() : "";
}

function saveState() {
  localStorage.setItem(compilerStateKey, getEditorValue());
}

function getStoredCode() {
  return localStorage.getItem(compilerStateKey) || defaultCode;
}

function stopWorker() {
  if (workerTimeoutId) {
    clearTimeout(workerTimeoutId);
    workerTimeoutId = null;
  }

  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
  }
}

function createRunnerWorker() {
  const workerSource = `
    function serialize(value) {
      if (value instanceof Error) {
        return value.stack || value.message;
      }

      if (typeof value === "string") {
        return value;
      }

      if (typeof value === "undefined") {
        return "undefined";
      }

      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }

    ["log", "info", "warn", "error"].forEach((level) => {
      const original = console[level];
      console[level] = (...args) => {
        self.postMessage({
          type: "console",
          level,
          values: args.map(serialize),
        });
        original.apply(console, args);
      };
    });

    self.onmessage = async (event) => {
      const code = String(event.data?.code || "");

      try {
        let result = eval(code);

        if (result instanceof Promise) {
          result = await result;
        }

        self.postMessage({
          type: "result",
          hasValue: typeof result !== "undefined",
          value: serialize(result),
        });
      } catch (error) {
        self.postMessage({
          type: "error",
          value: serialize(error),
        });
      } finally {
        self.postMessage({ type: "done" });
      }
    };
  `;

  const blob = new Blob([workerSource], { type: "text/javascript" });
  const workerUrl = URL.createObjectURL(blob);
  const worker = new Worker(workerUrl);
  URL.revokeObjectURL(workerUrl);
  return worker;
}

function updateRunButtonPosition() {
  if (!editor || !monacoApi) {
    return;
  }

  const layoutInfo = editor.getLayoutInfo();
  const lineHeight = editor.getOption(monacoApi.editor.EditorOption.lineHeight);
  const lastLineNumber = editor.getModel()?.getLineCount() || 1;
  const controlWidth = runControl.offsetWidth || 52;
  const controlHeight = runControl.offsetHeight || 60;
  const left = Math.max(6, Math.round((layoutInfo.contentLeft - controlWidth) / 2));
  const rawTop =
    editor.getTopForLineNumber(lastLineNumber) -
    editor.getScrollTop() +
    lineHeight +
    6;
  const maxTop = Math.max(8, editorElement.clientHeight - controlHeight - 10);
  const top = Math.max(8, Math.min(maxTop, Math.round(rawTop)));

  runControl.style.left = `${left}px`;
  runControl.style.top = `${top}px`;
  runControl.classList.add("is-visible");
}

function runCode() {
  if (!editor) {
    return;
  }

  saveState();
  stopWorker();
  clearConsole();
  updateStatus("Running", "running");

  activeWorker = createRunnerWorker();

  activeWorker.addEventListener("message", (event) => {
    const data = event.data || {};

    if (data.type === "console") {
      appendConsoleLine(data.level || "info", data.values || []);
      return;
    }

    if (data.type === "result") {
      if (data.hasValue) {
        appendConsoleLine("result", [data.value]);
      }
      return;
    }

    if (data.type === "error") {
      appendConsoleLine("error", [data.value]);
      updateStatus("Error", "error");
      return;
    }

    if (data.type === "done") {
      if (runControl.dataset.state !== "error") {
        updateStatus("Ready", "ready");
      }
      stopWorker();
    }
  });

  activeWorker.addEventListener("error", (event) => {
    appendConsoleLine("error", [event.message || "Error"]);
    updateStatus("Error", "error");
    stopWorker();
  });

  workerTimeoutId = window.setTimeout(() => {
    appendConsoleLine("error", ["Execution timed out"]);
    updateStatus("Error", "error");
    stopWorker();
  }, 4000);

  activeWorker.postMessage({ code: getEditorValue() });
}

function configureMonacoWorkers() {
  window.MonacoEnvironment = {
    getWorkerUrl() {
      return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
        self.MonacoEnvironment = {
          baseUrl: "${monacoBaseUrl}/"
        };
        importScripts("${monacoBaseUrl}/vs/base/worker/workerMain.js");
      `)}`;
    },
  };
}

function loadMonaco() {
  if (window.monaco?.editor) {
    return Promise.resolve(window.monaco);
  }

  if (monacoLoaderPromise) {
    return monacoLoaderPromise;
  }

  monacoLoaderPromise = new Promise((resolve, reject) => {
    if (typeof window.require !== "function") {
      reject(new Error("Monaco loader not available"));
      return;
    }

    configureMonacoWorkers();
    window.require.config({
      paths: {
        vs: `${monacoBaseUrl}/vs`,
      },
    });

    window.require(["vs/editor/editor.main"], () => {
      resolve(window.monaco);
    }, reject);
  });

  return monacoLoaderPromise;
}

function createEditor(monaco) {
  monacoApi = monaco;
  editor = monaco.editor.create(editorElement, {
    value: getStoredCode(),
    language: "javascript",
    theme: "vs",
    automaticLayout: true,
    minimap: { enabled: false },
    fontFamily: "Cascadia Code, Consolas, monospace",
    fontSize: 14,
    lineHeight: 22,
    padding: {
      top: 16,
      bottom: 8,
    },
    roundedSelection: false,
    scrollBeyondLastLine: false,
    tabSize: 2,
    insertSpaces: true,
    formatOnPaste: true,
    formatOnType: true,
    wordWrap: "on",
    renderLineHighlight: "gutter",
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    wordBasedSuggestions: "off",
    inlineSuggest: {
      enabled: false,
    },
    parameterHints: {
      enabled: false,
    },
  });
  updateRunButtonPosition();

  editor.onDidChangeModelContent(() => {
    saveState();

    if (runControl.dataset.state !== "running" && runControl.dataset.state !== "loading") {
      updateStatus("Idle", "idle");
    }

    window.requestAnimationFrame(updateRunButtonPosition);
  });

  editor.onDidScrollChange(() => {
    window.requestAnimationFrame(updateRunButtonPosition);
  });

  editor.onDidLayoutChange(() => {
    window.requestAnimationFrame(updateRunButtonPosition);
  });

  editor.onDidContentSizeChange(() => {
    window.requestAnimationFrame(updateRunButtonPosition);
  });

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
    runCode();
  });
}

async function initializeCompiler() {
  updateStatus("Loading", "loading");

  try {
    const monaco = await loadMonaco();
    createEditor(monaco);
    clearConsole();
    updateStatus("Idle", "idle");
  } catch (error) {
    appendConsoleLine("error", [
      "Editor failed to load",
      error?.message || String(error),
    ]);
    updateStatus("Error", "error");
  }
}

runButton.addEventListener("click", () => {
  runCode();
});

clearConsole();
initializeCompiler();
