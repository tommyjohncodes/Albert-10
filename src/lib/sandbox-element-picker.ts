import { Sandbox } from "@e2b/code-interpreter";

const SCRIPT_DIR = "/home/user/public/__albert";
const SCRIPT_PATH = `${SCRIPT_DIR}/element-picker.js`;
const LAYOUT_PATH = "/home/user/app/layout.tsx";
const DOCUMENT_PATH = "/home/user/pages/_document.tsx";
const SCRIPT_MARKER = "data-albert-element-picker";
const SCRIPT_TAG = `<script src=\"/__albert/element-picker.js\" ${SCRIPT_MARKER}></script>`;

const ELEMENT_PICKER_SCRIPT = `(() => {
  if (window.__albertElementPicker) return;
  window.__albertElementPicker = true;

  const overlay = document.createElement("div");
  overlay.setAttribute("data-albert-picker-ui", "1");
  overlay.style.position = "fixed";
  overlay.style.zIndex = "2147483647";
  overlay.style.border = "2px solid #6366f1";
  overlay.style.background = "rgba(99, 102, 241, 0.18)";
  overlay.style.borderRadius = "6px";
  overlay.style.pointerEvents = "none";
  overlay.style.transition = "all 80ms ease";
  overlay.style.display = "none";
  document.documentElement.appendChild(overlay);

  let active = false;
  let lastTarget = null;

  const escapeSelector = (value) => {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => {
      const hex = char.charCodeAt(0).toString(16);
      return \`\\\\\${hex} \`;
    });
  };

  const buildSelector = (element) => {
    if (!element || !(element instanceof Element)) return "";
    if (element.id) {
      return \`#\${escapeSelector(element.id)}\`;
    }
    const path = [];
    let current = element;
    let depth = 0;
    while (current && current.nodeType === 1 && depth < 5) {
      let selector = current.tagName.toLowerCase();
      const classList = Array.from(current.classList || []).filter(Boolean);
      if (classList.length) {
        selector += "." + classList.slice(0, 3).map(escapeSelector).join(".");
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += \`:nth-of-type(\${index})\`;
        }
      }
      path.unshift(selector);
      current = parent;
      depth += 1;
    }
    return path.join(" > ");
  };

  const isPickerUi = (element) =>
    Boolean(element && element.closest && element.closest("[data-albert-picker-ui='1']"));

  const getTargetFromEvent = (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const nodes = path.length ? path : [event.target];
    for (const node of nodes) {
      if (node instanceof Element && !isPickerUi(node)) {
        return node;
      }
    }
    if (event.target instanceof Element && !isPickerUi(event.target)) {
      return event.target;
    }
    return null;
  };

  const updateOverlay = (element) => {
    if (!element) {
      overlay.style.display = "none";
      return;
    }
    const rect = element.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.top = \`\${rect.top}px\`;
    overlay.style.left = \`\${rect.left}px\`;
    overlay.style.width = \`\${rect.width}px\`;
    overlay.style.height = \`\${rect.height}px\`;
  };

  const sendPick = (element) => {
    if (!element) return;
    const text = (element.innerText || element.textContent || "").trim();
    window.parent?.postMessage(
      {
        type: "ALBERT_ELEMENT_PICKED",
        selector: buildSelector(element),
        tagName: element.tagName ? element.tagName.toLowerCase() : "",
        text,
      },
      "*"
    );
  };

  const onMove = (event) => {
    if (!active) return;
    const target = getTargetFromEvent(event);
    lastTarget = target;
    updateOverlay(target);
  };

  const onClick = (event) => {
    if (!active) return;
    event.preventDefault();
    event.stopPropagation();
    const target = getTargetFromEvent(event) || lastTarget;
    if (target) {
      sendPick(target);
    }
    stop();
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      stop();
    }
  };

  const onScroll = () => {
    if (active && lastTarget) {
      updateOverlay(lastTarget);
    }
  };

  const start = () => {
    if (active) return;
    active = true;
    document.body.style.cursor = "crosshair";
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
  };

  const stop = () => {
    if (!active) return;
    active = false;
    document.body.style.cursor = "";
    overlay.style.display = "none";
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", onScroll, true);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const data = event.data || {};
    if (data.type === "ALBERT_ELEMENT_PICKER_START") {
      start();
    }
    if (data.type === "ALBERT_ELEMENT_PICKER_STOP") {
      stop();
    }
  });

  window.parent?.postMessage({ type: "ALBERT_ELEMENT_PICKER_READY" }, "*");
})();`;

const injectScriptTag = (content: string) => {
  if (content.includes(SCRIPT_MARKER)) {
    return { updated: false, content };
  }
  if (content.includes("</body>")) {
    return {
      updated: true,
      content: content.replace("</body>", `  ${SCRIPT_TAG}\n</body>`),
    };
  }
  if (content.includes("</html>")) {
    return {
      updated: true,
      content: content.replace("</html>", `  ${SCRIPT_TAG}\n</html>`),
    };
  }
  return {
    updated: true,
    content: `${content}\n${SCRIPT_TAG}\n`,
  };
};

const tryReadFile = async (sandbox: Sandbox, path: string) => {
  try {
    return await sandbox.files.read(path);
  } catch {
    return null;
  }
};

export async function ensureSandboxElementPicker(
  sandbox: Sandbox,
): Promise<{ updated: boolean }> {
  let updated = false;

  await sandbox.commands.run(`mkdir -p ${SCRIPT_DIR}`);
  const existingScript = await tryReadFile(sandbox, SCRIPT_PATH);
  if (existingScript !== ELEMENT_PICKER_SCRIPT) {
    await sandbox.files.write(SCRIPT_PATH, ELEMENT_PICKER_SCRIPT);
    updated = true;
  }

  const layout = await tryReadFile(sandbox, LAYOUT_PATH);
  if (layout) {
    const result = injectScriptTag(layout);
    if (result.updated) {
      await sandbox.files.write(LAYOUT_PATH, result.content);
      updated = true;
    }
    return { updated };
  }

  const document = await tryReadFile(sandbox, DOCUMENT_PATH);
  if (document) {
    const result = injectScriptTag(document);
    if (result.updated) {
      await sandbox.files.write(DOCUMENT_PATH, result.content);
      updated = true;
    }
  }

  return { updated };
}
