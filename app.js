const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const colorPicker = document.getElementById("colorPicker");
const sizePicker = document.getElementById("sizePicker");
const clearBtn = document.getElementById("clearBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const lockBtn = document.getElementById("lockBtn");
const exportBtn = document.getElementById("exportBtn");
const shareBtn = document.getElementById("shareBtn");
const imageInput = document.getElementById("imageInput");
const bgToggleBtn = document.getElementById("bgToggleBtn");
const textModal = document.getElementById("textModal");
const textInput = document.getElementById("textInput");
const menuToggle = document.getElementById("menuToggle");
const controls = document.querySelector(".controls");
const toolButtons = document.querySelectorAll(".tool-button");
const zoomIn = document.getElementById("zoomIn");
const zoomOut = document.getElementById("zoomOut");
const zoomLevelText = document.getElementById("zoomLevel");
const curveToggle = document.getElementById("curveToggle");
const colorPreview = document.getElementById("colorPreview");
const sizeValueDisplay = document.getElementById("sizeValueDisplay");

const Tools = {
  SELECT: "select",
  PEN: "pen",
  LINE: "line",
  RECTANGLE: "rectangle",
  ELLIPSE: "ellipse",
  TEXT: "text",
  IMAGE: "image",
  ERASER: "eraser",
  ERASER_AREA: "eraser_area",
  ARROW: "arrow",
};

let currentTool = Tools.PEN;
let elements = [];
let undoStack = [];
let redoStack = [];
let isDrawing = false;
let activeElementId = null;
let dragStart = null;
let resizeStart = null;
let pointerDownPos = null;
let nextIdValue = 1;
let pendingImagePosition = null;
let currentTextPosition = null;
let selectionRect = null;
let isBoardLocked = false;
let isBending = false;
let isCurveModeEnabled = false;
let canvasScale = 1;
let activePointers = new Map();
let initialPinchDistance = null;
let initialPinchScale = 1;
const imageCache = new Map();

// LocalStorage management
const STORAGE_KEY = "whiteboard_drawing";

function saveToLocalStorage() {
  try {
    const data = {
      elements,
      nextIdValue,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error("Failed to save to localStorage:", err);
  }
}

function loadFromLocalStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      elements = parsed.elements || [];
      nextIdValue = parsed.nextIdValue || 1;
      return true;
    }
  } catch (err) {
    console.error("Failed to load from localStorage:", err);
  }
  return false;
}

function nextId() {
  return nextIdValue++;
}

function deepClone(value) {
  if (window.structuredClone) return window.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function pushHistory() {
  undoStack.push(deepClone(elements));
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(deepClone(elements));
  elements = undoStack.pop();
  activeElementId = null;
  render();
  updateLockButton();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(deepClone(elements));
  elements = redoStack.pop();
  activeElementId = null;
  render();
  updateLockButton();
}

function getCanvasPos(evt) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (evt.clientX - rect.left) / canvasScale,
    y: (evt.clientY - rect.top) / canvasScale,
  };
}

function setCanvasSize() {
  const minWidth = 1300;
  const minHeight = 800; // Define a minimum height threshold

  const wrapper = canvas.parentElement;
  const wrapperRect = wrapper.getBoundingClientRect();

  // Dynamically set board dimensions based on viewport/wrapper
  if (window.innerWidth < minWidth) {
    canvas.style.width = `${minWidth}px`;
  } else {
    canvas.style.width = "100%";
  }

  // Vertical dimension always fits the container now
  canvas.style.height = "100%";
  canvas.style.touchAction = "none";

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr * canvasScale, 0, 0, dpr * canvasScale, 0, 0);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  render();
}

window.addEventListener("resize", setCanvasSize);
window.addEventListener("orientationchange", () => {
  // Small delay to ensure innerWidth/Height are updated after orientation change
  setTimeout(setCanvasSize, 100);
});

function getActiveElement() {
  return elements.find((el) => el.id === activeElementId) || null;
}

function updateLockButton() {
  const icon = lockBtn.querySelector("i");
  if (icon) {
    icon.setAttribute("data-lucide", isBoardLocked ? "unlock" : "lock");
  }
  lockBtn.title = isBoardLocked ? "Unlock board" : "Lock board";
  lockBtn.classList.toggle("active", isBoardLocked);
  canvas.classList.toggle("locked", isBoardLocked);

  if (window.lucide) lucide.createIcons();
}

function distancePointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));
  const cx = x1 + clampedT * dx;
  const cy = y1 + clampedT * dy;
  return Math.hypot(px - cx, py - cy);
}

function hitTest(pos) {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const el = elements[i];
    if (isPointInElement(pos, el)) return el;
  }
  return null;
}

function isPointInElement(pos, el) {
  const { x, y } = pos;
  switch (el.type) {
    case "rectangle": {
      const x1 = Math.min(el.x, el.x + el.w);
      const y1 = Math.min(el.y, el.y + el.h);
      const x2 = Math.max(el.x, el.x + el.w);
      const y2 = Math.max(el.y, el.y + el.h);
      return x >= x1 && x <= x2 && y >= y1 && y <= y2;
    }
    case "ellipse": {
      const rx = Math.abs(el.w) / 2;
      const ry = Math.abs(el.h) / 2;
      if (rx === 0 || ry === 0) return false;
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      return nx * nx + ny * ny <= 1;
    }
    case "line":
    case "arrow": {
      if (el.cp) {
        // Approximate curve distance by sampling
        const steps = 10;
        for (let i = 0; i < steps; i++) {
          const t1 = i / steps;
          const t2 = (i + 1) / steps;
          const getQ = (t) => ({
            x:
              (1 - t) * (1 - t) * el.x1 +
              2 * (1 - t) * t * el.cp.x +
              t * t * el.x2,
            y:
              (1 - t) * (1 - t) * el.y1 +
              2 * (1 - t) * t * el.cp.y +
              t * t * el.y2,
          });
          const p1 = getQ(t1);
          const p2 = getQ(t2);
          if (
            distancePointToSegment(x, y, p1.x, p1.y, p2.x, p2.y) <=
            (el.size || 4) + 3
          )
            return true;
        }
        return false;
      }
      return (
        distancePointToSegment(x, y, el.x1, el.y1, el.x2, el.y2) <=
        (el.size || 4) + 3
      );
    }
    case "pen": {
      const pts = el.points;
      for (let i = 0; i < pts.length - 1; i += 1) {
        const p1 = pts[i];
        const p2 = pts[i + 1];
        if (
          distancePointToSegment(x, y, p1.x, p1.y, p2.x, p2.y) <=
          (el.size || 4) + 3
        ) {
          return true;
        }
      }
      return false;
    }
    case "text": {
      const { x1, y1, x2, y2 } = elementBounds(el);
      return x >= x1 && x <= x2 && y >= y1 && y <= y2;
    }
    case "image":
      return (
        x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height
      );
    default:
      return false;
  }
}

function elementBounds(el) {
  switch (el.type) {
    case "rectangle": {
      const x1 = Math.min(el.x, el.x + el.w);
      const y1 = Math.min(el.y, el.y + el.h);
      const x2 = Math.max(el.x, el.x + el.w);
      const y2 = Math.max(el.y, el.y + el.h);
      return { x1, y1, x2, y2 };
    }
    case "ellipse": {
      const x1 = Math.min(el.x, el.x + el.w);
      const y1 = Math.min(el.y, el.y + el.h);
      const x2 = Math.max(el.x, el.x + el.w);
      const y2 = Math.max(el.y, el.y + el.h);
      return { x1, y1, x2, y2 };
    }
    case "line":
    case "arrow": {
      let x1 = Math.min(el.x1, el.x2);
      let y1 = Math.min(el.y1, el.y2);
      let x2 = Math.max(el.x1, el.x2);
      let y2 = Math.max(el.y1, el.y2);
      if (el.cp) {
        x1 = Math.min(x1, el.cp.x);
        y1 = Math.min(y1, el.cp.y);
        x2 = Math.max(x2, el.cp.x);
        y2 = Math.max(y2, el.cp.y);
      }
      return { x1, y1, x2, y2 };
    }
    case "pen": {
      let x1 = Infinity;
      let y1 = Infinity;
      let x2 = -Infinity;
      let y2 = -Infinity;
      el.points.forEach((p) => {
        x1 = Math.min(x1, p.x);
        y1 = Math.min(y1, p.y);
        x2 = Math.max(x2, p.x);
        y2 = Math.max(y2, p.y);
      });
      if (!Number.isFinite(x1)) {
        x1 = 0;
        y1 = 0;
        x2 = 0;
        y2 = 0;
      }
      return { x1, y1, x2, y2 };
    }
    case "text": {
      const fontSize = el.size || 16;
      ctx.save();
      ctx.font = `${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
      const lines = (el.text || "").split("\n");
      let maxWidth = 0;
      lines.forEach((line) => {
        maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
      });
      ctx.restore();
      const height = fontSize * 1.2 * lines.length;
      return { x1: el.x, y1: el.y, x2: el.x + maxWidth, y2: el.y + height };
    }
    case "image":
      return {
        x1: el.x,
        y1: el.y,
        x2: el.x + el.width,
        y2: el.y + el.height,
      };
    default:
      return { x1: 0, y1: 0, x2: 0, y2: 0 };
  }
}

function drawElement(el) {
  ctx.strokeStyle = el.color || "#e5e7eb";
  ctx.lineWidth = el.size || 2;

  switch (el.type) {
    case "rectangle": {
      ctx.beginPath();
      ctx.rect(el.x, el.y, el.w, el.h);
      ctx.stroke();
      break;
    }
    case "ellipse": {
      const cx = el.x + el.w / 2;
      const cy = el.y + el.h / 2;
      const rx = Math.abs(el.w) / 2;
      const ry = Math.abs(el.h) / 2;
      if (rx === 0 || ry === 0) break;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "line": {
      ctx.beginPath();
      ctx.moveTo(el.x1, el.y1);
      if (el.cp) {
        ctx.quadraticCurveTo(el.cp.x, el.cp.y, el.x2, el.y2);
      } else {
        ctx.lineTo(el.x2, el.y2);
      }
      ctx.stroke();
      break;
    }
    case "arrow": {
      ctx.beginPath();
      ctx.moveTo(el.x1, el.y1);
      if (el.cp) {
        ctx.quadraticCurveTo(el.cp.x, el.cp.y, el.x2, el.y2);
      } else {
        ctx.lineTo(el.x2, el.y2);
      }
      ctx.stroke();

      // Draw arrowhead
      const headLength = Math.max(10, el.size * 2.5);
      const angle = el.cp
        ? Math.atan2(el.y2 - el.cp.y, el.x2 - el.cp.x)
        : Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
      ctx.beginPath();
      ctx.moveTo(el.x2, el.y2);
      ctx.lineTo(
        el.x2 - headLength * Math.cos(angle - Math.PI / 6),
        el.y2 - headLength * Math.sin(angle - Math.PI / 6),
      );
      ctx.moveTo(el.x2, el.y2);
      ctx.lineTo(
        el.x2 - headLength * Math.cos(angle + Math.PI / 6),
        el.y2 - headLength * Math.sin(angle + Math.PI / 6),
      );
      ctx.stroke();
      break;
    }
    case "pen": {
      const pts = el.points;
      if (pts.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
      break;
    }
    case "text": {
      ctx.save();
      const fontSize = el.size || 16;
      ctx.font = `${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
      ctx.fillStyle = el.color || "#0f172a";
      ctx.textBaseline = "top";
      const lines = (el.text || "").split("\n");
      lines.forEach((line, i) => {
        ctx.fillText(line, el.x, el.y + i * fontSize * 1.2);
      });
      ctx.restore();
      break;
    }
    case "image": {
      let img = imageCache.get(el.src);
      if (!img) {
        img = new Image();
        img.src = el.src;
        img.onload = () => render();
        imageCache.set(el.src, img);
      }
      if (img.complete && img.naturalWidth) {
        ctx.drawImage(img, el.x, el.y, el.width, el.height);
      }
      break;
    }
    default:
      break;
  }
}

function drawSelectionOutline(el) {
  if (!el) return;
  const { x1, y1, x2, y2 } = elementBounds(el);
  const pad = 4;
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#3b82f6";
  ctx.strokeRect(x1 - pad, y1 - pad, x2 - x1 + pad * 2, y2 - y1 + pad * 2);
  ctx.setLineDash([]);

  // Resize handle for all shapes (bottom-right corner)
  const size = 10;
  const handleX = x2 - size;
  const handleY = y2 - size;
  ctx.fillStyle = "#3b82f6";
  ctx.fillRect(handleX, handleY, size, size);
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 1;
  ctx.strokeRect(handleX, handleY, size, size);

  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  elements.forEach((el) => drawElement(el));
  const active = getActiveElement();
  if (active) drawSelectionOutline(active);

  if (selectionRect) {
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = "rgba(59, 130, 246, 0.8)";
    ctx.fillStyle = "rgba(59, 130, 246, 0.1)";
    const { x, y, w, h } = selectionRect;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  saveToLocalStorage();
}

function startDrawing(pos) {
  pushHistory();
  isDrawing = true;
  pointerDownPos = pos;

  const common = {
    id: nextId(),
    color: colorPicker.value,
    size: Number(sizePicker.value) || 2,
    locked: false,
  };

  let el = null;
  switch (currentTool) {
    case Tools.PEN:
      el = {
        ...common,
        type: "pen",
        points: [pos],
      };
      break;
    case Tools.LINE:
    case Tools.ARROW:
      el = {
        ...common,
        type: currentTool,
        x1: pos.x,
        y1: pos.y,
        x2: pos.x,
        y2: pos.y,
      };
      break;
    case Tools.RECTANGLE:
      el = {
        ...common,
        type: "rectangle",
        x: pos.x,
        y: pos.y,
        w: 0,
        h: 0,
      };
      break;
    case Tools.ELLIPSE:
      el = {
        ...common,
        type: "ellipse",
        x: pos.x,
        y: pos.y,
        w: 0,
        h: 0,
      };
      break;
    default:
      break;
  }

  if (!el) return;
  elements.push(el);
  activeElementId = el.id;
  render();
}

function updateDrawing(pos, e) {
  if (!isDrawing) return;
  const el = getActiveElement();
  if (!el) return;

  switch (el.type) {
    case "pen":
      el.points.push({ x: pos.x, y: pos.y });
      break;
    case "line":
    case "arrow":
      if (e && (e.ctrlKey || e.metaKey)) {
        // Bending logic enabled while dragging
        el.cp = {
          x: 2 * pos.x - 0.5 * el.x1 - 0.5 * el.x2,
          y: 2 * pos.y - 0.5 * el.y1 - 0.5 * el.y2,
        };
      } else {
        el.x2 = pos.x;
        el.y2 = pos.y;
        delete el.cp;
      }
      break;
    case "rectangle":
      el.w = pos.x - el.x;
      el.h = pos.y - el.y;
      break;
    case "ellipse":
      el.w = pos.x - el.x;
      el.h = pos.y - el.y;
      break;
    default:
      break;
  }

  render();
}

function stopDrawing() {
  isDrawing = false;
  pointerDownPos = null;
}

function startDraggingSelection(pos) {
  const el = hitTest(pos);
  if (!el) {
    activeElementId = null;
    dragStart = null;
    render();
    updateLockButton();
    return;
  }

  activeElementId = el.id;
  dragStart = {
    mouse: pos,
    elementSnapshot: deepClone(el),
  };
  render();
  updateLockButton();
}

function updateDragging(pos) {
  if (!dragStart) return;
  const el = getActiveElement();
  if (!el) return;

  const dx = pos.x - dragStart.mouse.x;
  const dy = pos.y - dragStart.mouse.y;
  const snap = dragStart.elementSnapshot;

  switch (el.type) {
    case "rectangle":
    case "ellipse":
      el.x = snap.x + dx;
      el.y = snap.y + dy;
      break;
    case "line":
    case "arrow":
      el.x1 = snap.x1 + dx;
      el.y1 = snap.y1 + dy;
      el.x2 = snap.x2 + dx;
      el.y2 = snap.y2 + dy;
      if (snap.cp) {
        el.cp = { x: snap.cp.x + dx, y: snap.cp.y + dy };
      }
      break;
    case "pen":
      el.points = snap.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      break;
    case "text":
      el.x = snap.x + dx;
      el.y = snap.y + dy;
      break;
    case "image":
      el.x = snap.x + dx;
      el.y = snap.y + dy;
      break;
    default:
      break;
  }

  render();
}

function stopDragging() {
  if (dragStart && getActiveElement()) {
    pushHistory();
  }
  dragStart = null;
}

function updateResizing(pos) {
  if (!resizeStart) return;
  const el = getActiveElement();
  if (!el) return;

  const dx = pos.x - resizeStart.mouse.x;
  const dy = pos.y - resizeStart.mouse.y;
  const snap = resizeStart.elementSnapshot;
  const minSize = 20;

  switch (el.type) {
    case "image": {
      let newWidth = snap.width + dx;
      if (newWidth < minSize) newWidth = minSize;
      const scale = newWidth / snap.width;
      const newHeight = snap.height * scale;
      el.width = newWidth;
      el.height = newHeight;
      break;
    }
    case "rectangle": {
      const newW = snap.w + dx;
      const newH = snap.h + dy;
      el.w = Math.abs(newW) < minSize ? (newW >= 0 ? minSize : -minSize) : newW;
      el.h = Math.abs(newH) < minSize ? (newH >= 0 ? minSize : -minSize) : newH;
      break;
    }
    case "ellipse": {
      const newW = snap.w + dx;
      const newH = snap.h + dy;
      el.w = Math.abs(newW) < minSize ? (newW >= 0 ? minSize : -minSize) : newW;
      el.h = Math.abs(newH) < minSize ? (newH >= 0 ? minSize : -minSize) : newH;
      break;
    }
    case "line":
    case "arrow": {
      const dx2 = pos.x - resizeStart.mouse.x;
      const dy2 = pos.y - resizeStart.mouse.y;
      el.x2 = snap.x2 + dx2;
      el.y2 = snap.y2 + dy2;

      if (snap.cp) {
        // Scale control point relative to x1, y1
        const originalW = snap.x2 - snap.x1;
        const originalH = snap.y2 - snap.y1;
        const currentW = el.x2 - el.x1;
        const currentH = el.y2 - el.y1;

        const sw = originalW === 0 ? 1 : currentW / originalW;
        const sh = originalH === 0 ? 1 : currentH / originalH;

        el.cp = {
          x: snap.x1 + (snap.cp.x - snap.x1) * sw,
          y: snap.y1 + (snap.cp.y - snap.y1) * sh,
        };
      }
      break;
    }
    case "pen": {
      const bounds = elementBounds(snap);
      const originalW = bounds.x2 - bounds.x1;
      const originalH = bounds.y2 - bounds.y1;
      const dx2 = pos.x - resizeStart.mouse.x;
      const dy2 = pos.y - resizeStart.mouse.y;

      const sw = originalW <= 0 ? 1 : (originalW + dx2) / originalW;
      const sh = originalH <= 0 ? 1 : (originalH + dy2) / originalH;

      el.points = snap.points.map((p) => ({
        x: bounds.x1 + (p.x - bounds.x1) * sw,
        y: bounds.y1 + (p.y - bounds.y1) * sh,
      }));
      break;
    }
    case "text": {
      const dx2 = pos.x - resizeStart.mouse.x;
      const newSize = Math.max(8, snap.size + Math.round(dx2 / 5));
      el.size = newSize;
      sizePicker.value = Math.round(newSize / 2);
      break;
    }
  }

  render();
}

function stopResizing() {
  if (resizeStart && getActiveElement()) {
    pushHistory();
  }
  resizeStart = null;
}

function openTextModal(evt) {
  const pos = getCanvasPos(evt);
  currentTextPosition = { x: pos.x, y: pos.y };
  textInput.value = "";
  textModal.classList.add("active");
  textInput.focus();
}

function closeTextModal() {
  textModal.classList.remove("active");
}

function commitText() {
  const text = textInput.value.trim();
  closeTextModal();
  if (!text || !currentTextPosition) return;
  pushHistory();
  const rawSize = Number(sizePicker.value) || 16;
  const fontSize = Math.max(12, rawSize * 2);

  const el = {
    id: nextId(),
    type: "text",
    text,
    x: currentTextPosition.x,
    y: currentTextPosition.y,
    color: colorPicker.value,
    size: fontSize,
    locked: false,
  };
  elements.push(el);
  activeElementId = el.id;
  currentTextPosition = null;
  render();
  updateLockButton();
}

function handlePointerDown(e) {
  if (isBoardLocked) return;
  // e.button === 0 is left click. Touch events have button 0.
  if (e.pointerType === "mouse" && e.button !== 0) return;

  activePointers.set(e.pointerId, e);

  if (activePointers.size === 2) {
    const pts = Array.from(activePointers.values());
    initialPinchDistance = Math.hypot(
      pts[0].clientX - pts[1].clientX,
      pts[0].clientY - pts[1].clientY,
    );
    initialPinchScale = canvasScale;
    return;
  }

  const pos = getCanvasPos(e);
  pointerDownPos = pos;

  if (currentTool === Tools.SELECT) {
    const el = hitTest(pos);
    if (!el) {
      activeElementId = null;
      dragStart = null;
      resizeStart = null;
      render();
      updateLockButton();
      return;
    }

    activeElementId = el.id;

    // Update pickers to match selected element
    if (!el.locked) {
      if (el.color) {
        colorPicker.value = el.color;
        if (colorPreview) colorPreview.style.backgroundColor = el.color;
      }
      if (el.type === "text") {
        const val = Math.round((el.size || 16) / 2);
        sizePicker.value = val;
        if (sizeValueDisplay) sizeValueDisplay.textContent = val;
      } else {
        const val = el.size || 2;
        sizePicker.value = val;
        if (sizeValueDisplay) sizeValueDisplay.textContent = val;
      }
    }

    // Prevent dragging or resizing locked elements
    if (el.locked) {
      render();
      updateLockButton();
      return;
    }

    const { x1, y1, x2, y2 } = elementBounds(el);
    const handleSize = 20; // Larger handle for touch
    const inHandle =
      pos.x >= x2 - handleSize &&
      pos.x <= x2 &&
      pos.y >= y2 - handleSize &&
      pos.y <= y2;

    if (inHandle) {
      resizeStart = {
        mouse: pos,
        elementSnapshot: deepClone(el),
      };
    } else {
      dragStart = {
        mouse: pos,
        elementSnapshot: deepClone(el),
      };
    }

    render();
    updateLockButton();
    return;
  }

  if (currentTool === Tools.ERASER) {
    const el = hitTest(pos);
    if (el) {
      pushHistory();
      elements = elements.filter((item) => item.id !== el.id);
      if (activeElementId === el.id) activeElementId = null;
      render();
      updateLockButton();
    }
    return;
  }

  if (currentTool === Tools.TEXT) {
    openTextModal(e);
    return;
  }

  if (currentTool === Tools.IMAGE) {
    pendingImagePosition = pos;
    imageInput.click();
    return;
  }

  if (currentTool === Tools.ERASER_AREA) {
    isDrawing = true;
    pointerDownPos = pos;
    selectionRect = { x: pos.x, y: pos.y, w: 0, h: 0 };
    return;
  }

  if (isBending) {
    isBending = false;
    stopDrawing();
    return;
  }

  startDrawing(pos);
}

function handlePointerMove(e) {
  // Update state for pinch
  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, e);
  }

  if (activePointers.size === 2 && initialPinchDistance) {
    const pts = Array.from(activePointers.values());
    const currentDist = Math.hypot(
      pts[0].clientX - pts[1].clientX,
      pts[0].clientY - pts[1].clientY,
    );
    const scaleFactor = currentDist / initialPinchDistance;
    updateZoom(initialPinchScale * scaleFactor);
    return;
  }

  const pos = getCanvasPos(e);
  const isCtrl = e.ctrlKey || e.metaKey || isCurveModeEnabled;

  if (isBending) {
    const el = getActiveElement();
    if (el) {
      if (isCtrl) {
        // To make the quadratic curve pass through the mouse pos (M) at t=0.5:
        // M = 0.25*P1 + 0.5*CP + 0.25*P2
        // CP = 2*M - 0.5*P1 - 0.5*P2
        el.cp = {
          x: 2 * pos.x - 0.5 * el.x1 - 0.5 * el.x2,
          y: 2 * pos.y - 0.5 * el.y1 - 0.5 * el.y2,
        };
      } else {
        delete el.cp;
      }
      render();
    }
    return;
  }

  if (isDrawing) {
    if (currentTool === Tools.ERASER_AREA) {
      selectionRect.w = pos.x - pointerDownPos.x;
      selectionRect.h = pos.y - pointerDownPos.y;
      render();
    } else {
      updateDrawing(pos, { ...e, ctrlKey: isCtrl });
    }
    return;
  }

  if (resizeStart) {
    updateResizing(pos);
    return;
  }

  if (dragStart) {
    updateDragging(pos);
  }
}

function handlePointerUp(e) {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) {
    initialPinchDistance = null;
  }

  if (isDrawing) {
    const isCtrl = e.ctrlKey || e.metaKey || isCurveModeEnabled;
    if (currentTool === Tools.ERASER_AREA && selectionRect) {
      // ... existing deletion logic ...
      const x1 = Math.min(selectionRect.x, selectionRect.x + selectionRect.w);
      const y1 = Math.min(selectionRect.y, selectionRect.y + selectionRect.h);
      const x2 = Math.max(selectionRect.x, selectionRect.x + selectionRect.w);
      const y2 = Math.max(selectionRect.y, selectionRect.y + selectionRect.h);

      const toDelete = elements.filter((el) => {
        const bounds = elementBounds(el);
        return !(
          bounds.x2 < x1 ||
          bounds.x1 > x2 ||
          bounds.y2 < y1 ||
          bounds.y1 > y2
        );
      });

      if (toDelete.length > 0) {
        pushHistory();
        const deleteIds = new Set(toDelete.map((el) => el.id));
        elements = elements.filter((el) => !deleteIds.has(el.id));
        if (activeElementId && deleteIds.has(activeElementId)) {
          activeElementId = null;
        }
      }
      selectionRect = null;
      render();
    } else {
      const el = getActiveElement();
      if (el && (el.type === "line" || el.type === "arrow") && isCtrl) {
        isBending = true;
      } else {
        stopDrawing();
      }
    }
  }
  if (dragStart) {
    stopDragging();
  }
  if (resizeStart) {
    stopResizing();
  }
}

canvas.addEventListener("pointerdown", handlePointerDown);
window.addEventListener("pointermove", handlePointerMove);
window.addEventListener("pointerup", handlePointerUp);
window.addEventListener("pointercancel", handlePointerUp);

clearBtn.addEventListener("click", () => {
  if (!elements.length) return;
  pushHistory();
  elements = [];
  activeElementId = null;
  render();
  updateLockButton();
});

undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);

lockBtn.addEventListener("click", () => {
  isBoardLocked = !isBoardLocked;
  updateLockButton();
});

bgToggleBtn.addEventListener("click", () => {
  document.body.classList.toggle("is-transparent");
  const icon = bgToggleBtn.querySelector("i");
  if (icon) {
    const isTrans = document.body.classList.contains("is-transparent");
    icon.setAttribute("data-lucide", isTrans ? "eye-off" : "layers");
    if (window.lucide) lucide.createIcons();
  }
});

const toolGroupWrapper = document.querySelector(".tool-group-wrapper");
menuToggle.addEventListener("click", () => {
  toolGroupWrapper.classList.toggle("active");
});

// Close menu when clicking outside
document.addEventListener("click", (e) => {
  if (!menuToggle.contains(e.target) && !toolGroupWrapper.contains(e.target)) {
    toolGroupWrapper.classList.remove("active");
  }
});

exportBtn.addEventListener("click", () => {
  const dataUrl = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = "whiteboard.png";
  link.click();
});

shareBtn.addEventListener("click", async () => {
  const dataUrl = canvas.toDataURL("image/png");
  try {
    if (navigator.share && window.Blob && window.File && navigator.canShare) {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], "whiteboard.png", { type: "image/png" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Whiteboard" });
        return;
      }
    }

    if (navigator.share) {
      await navigator.share({ title: "Whiteboard", url: dataUrl });
      return;
    }

    window.prompt("Copy this image URL to share:", dataUrl);
  } catch (err) {
    window.prompt("Copy this image URL to share:", dataUrl);
  }
});

imageInput.addEventListener("change", (e) => {
  const [file] = e.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const src = reader.result;
    const img = new Image();
    img.onload = () => {
      const maxWidth = canvas.clientWidth * 0.6;
      const maxHeight = canvas.clientHeight * 0.6;
      let { width, height } = img;
      const scale = Math.min(1, maxWidth / width, maxHeight / height);
      width *= scale;
      height *= scale;

      const pos = pendingImagePosition || {
        x: (canvas.clientWidth - width) / 2,
        y: (canvas.clientHeight - height) / 2,
      };

      pushHistory();
      const el = {
        id: nextId(),
        type: "image",
        x: pos.x,
        y: pos.y,
        width,
        height,
        src,
        locked: false,
      };
      elements.push(el);
      imageCache.set(src, img);
      activeElementId = el.id;
      pendingImagePosition = null;
      render();
      updateLockButton();
    };
    img.src = src;
  };
  reader.readAsDataURL(file);
  e.target.value = "";
});

textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    commitText();
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeTextModal();
    currentTextPosition = null;
  }
});

textModal.addEventListener("click", (e) => {
  if (e.target === textModal) {
    closeTextModal();
    currentTextPosition = null;
  }
});

function setTool(tool) {
  currentTool = tool;
  toolButtons.forEach((b) => {
    const bTool = b.dataset.tool;
    b.classList.toggle("active", bTool === tool);
  });
  if (tool !== Tools.TEXT) {
    closeTextModal();
    currentTextPosition = null;
  }
  isBending = false;
}

toolButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tool = btn.dataset.tool;
    setTool(tool);
  });
});

colorPicker.addEventListener("input", () => {
  if (colorPreview) colorPreview.style.backgroundColor = colorPicker.value;
  const el = getActiveElement();
  if (el && !el.locked) {
    el.color = colorPicker.value;
    render();
  }
});

sizePicker.addEventListener("input", () => {
  const val = Number(sizePicker.value);
  if (sizeValueDisplay) sizeValueDisplay.textContent = val;
  const el = getActiveElement();
  if (el && !el.locked) {
    if (el.type === "text") {
      el.size = Math.max(12, val * 2);
    } else {
      el.size = val;
    }
    render();
  }
});

function updateZoom(newScale) {
  canvasScale = Math.max(0.1, Math.min(5, newScale));
  if (zoomLevelText) {
    zoomLevelText.textContent = `${Math.round(canvasScale * 100)}%`;
  }
  setCanvasSize();
}

if (zoomIn)
  zoomIn.addEventListener("click", () => updateZoom(canvasScale + 0.1));
if (zoomOut)
  zoomOut.addEventListener("click", () => updateZoom(canvasScale - 0.1));
if (zoomLevelText) zoomLevelText.addEventListener("click", () => updateZoom(1));

if (curveToggle) {
  curveToggle.addEventListener("click", () => {
    isCurveModeEnabled = !isCurveModeEnabled;
    curveToggle.classList.toggle("active", isCurveModeEnabled);
  });
}

canvas.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      updateZoom(canvasScale + delta);
    }
  },
  { passive: false },
);

document.addEventListener("keydown", (e) => {
  const activeTag =
    document.activeElement && document.activeElement.tagName.toLowerCase();

  // Allow Ctrl/Cmd undo/redo even when typing, but avoid other shortcuts
  if (activeTag === "input" || activeTag === "textarea") {
    if (!(e.ctrlKey || e.metaKey)) return;
  }

  // Undo / redo
  if (e.ctrlKey || e.metaKey) {
    const key = e.key.toLowerCase();
    if (key === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
      return;
    }
    if (key === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (key === "s") {
      e.preventDefault();
      exportBtn.click();
      return;
    }
  }

  if (e.altKey || e.ctrlKey || e.metaKey) return;

  // Escape key to select tool or finish draw
  if (e.key === "Escape") {
    e.preventDefault();
    if (isDrawing || isBending) {
      isDrawing = false;
      isBending = false;
      pointerDownPos = null;
      render();
    } else {
      setTool(Tools.SELECT);
    }
    return;
  }

  const key = e.key.toLowerCase();
  switch (key) {
    case "v":
      setTool(Tools.SELECT);
      break;
    case "p":
    case "b":
      setTool(Tools.PEN);
      break;
    case "l":
      setTool(Tools.LINE);
      break;
    case "r":
      setTool(Tools.RECTANGLE);
      break;
    case "o":
      setTool(Tools.ELLIPSE);
      break;
    case "t":
      setTool(Tools.TEXT);
      break;
    case "a":
      setTool(Tools.ARROW);
      break;
    case "i": {
      const el = getActiveElement();
      if (!el) break;
      e.preventDefault();
      el.locked = !el.locked;
      updateLockButton();
      render();
      break;
    }
    case "e":
      if (e.shiftKey) {
        setTool(Tools.ERASER_AREA);
      } else {
        setTool(Tools.ERASER);
      }
      break;
    case "delete":
    case "backspace": {
      const el = getActiveElement();
      if (!el || el.locked) return;
      e.preventDefault();
      pushHistory();
      elements = elements.filter((item) => item.id !== el.id);
      activeElementId = null;
      render();
      updateLockButton();
      break;
    }
    case "[":
    case "]": {
      e.preventDefault();
      const delta = key === "[" ? -5 : 5;
      const newVal = Math.max(
        1,
        Math.min(100, Number(sizePicker.value) + delta),
      );
      sizePicker.value = newVal;
      if (sizeValueDisplay) sizeValueDisplay.textContent = newVal;
      // Trigger the input event logic manually
      const el = getActiveElement();
      if (el && !el.locked) {
        if (el.type === "text") {
          el.size = Math.max(12, newVal * 2);
        } else {
          el.size = newVal;
        }
        render();
      }
      break;
    }
    default:
      break;
  }
});

const defaultToolButton = document.querySelector(
  '.tool-button[data-tool="pen"]',
);
if (defaultToolButton) {
  defaultToolButton.classList.add("active");
}

// Load saved drawing from localStorage
loadFromLocalStorage();

setCanvasSize();
