const canvas = document.getElementById('board');
let ctx = canvas.getContext('2d');
let dpr = Math.max(1, window.devicePixelRatio || 1);

// ---------- viewport ----------
let panX = 0, panY = 0, scale = 1;
const MIN_SCALE = 0.05, MAX_SCALE = 8;

function resize(){
  dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  render();
}
window.addEventListener('resize', resize);

function screenToWorld(sx, sy){
  return { x: (sx - panX) / scale, y: (sy - panY) / scale };
}

// ---------- state ----------
let objects = [];      // all board objects
let selectedId = null;
let multiSelectedIds = []; // ids selected via marquee drag, when more than one object is involved
let isMarqueeSelecting = false;
let marqueeStart = null;
let marqueeEnd = null;
let clipboardObjects = []; // deep-cloned copies from the last Ctrl+C
let pasteOffsetCount = 0;  // increments per paste so repeated Ctrl+V cascades outward
let editingObjectId = null; // hides an object's canvas-drawn text while its editor overlay is open
let history = ['[]'];
let historyIndex = 0;
let nextId = 1;
let gridStyle = 'dots';   // 'dots' | 'lines' | 'none'
let gridColor = null;     // null = use theme default
let bgMode = 'light';     // 'light' | 'dark' | 'custom'
let bgColor = null;       // the custom background color (hex), used when bgMode is 'custom'
let currentBoardName = 'Untitled board';
let activeBoardId = null; // set when the open board came from (or was saved to) the library

const PALETTE = ['#232428', '#f4f4f5', '#e5484d', '#f5a623', '#2fb344', '#4a5cf0', '#a855f7'];
let currentColor = PALETTE[0];
let currentThickness = 1.5;
let currentLineStyle = 'plain'; // 'plain' | 'arrow'
let currentDash = 'solid';      // 'solid' | 'dashed' | 'dotted' (lines, outlines, drawings)
let currentRadius = 0; // corner radius for new rectangles
let currentFill = null;        // interior color for rectangles/ellipses (null = no fill)
let currentFillOpacity = 0.6;  // interior transparency (1 = solid)

function snapshot(){
  return JSON.stringify(objects);
}
function pushHistory(){
  // drop any redo branch beyond the current point, then record the new state
  history = history.slice(0, historyIndex + 1);
  history.push(snapshot());
  historyIndex = history.length - 1;
  if(history.length > 80){ history.shift(); historyIndex--; }
  updateHistoryButtons();
  save();
}
function undo(){
  if(historyIndex <= 0) return;
  historyIndex--;
  objects = JSON.parse(history[historyIndex]);
  selectedId = null;
  updateHistoryButtons();
  save();
  render();
}
function redo(){
  if(historyIndex >= history.length - 1) return;
  historyIndex++;
  objects = JSON.parse(history[historyIndex]);
  selectedId = null;
  updateHistoryButtons();
  save();
  render();
}
function updateHistoryButtons(){
  document.getElementById('undoBtn').disabled = historyIndex <= 0;
  document.getElementById('redoBtn').disabled = historyIndex >= history.length - 1;
}


// ---------- tools ----------
let tool = 'select';
const TOOL_KEYS = { v:'select', h:'pan', p:'pen', e:'eraser', r:'rect', o:'ellipse', l:'line', f:'fill', n:'sticky', t:'text' };

function setTool(t){
  tool = t;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  canvas.className = 'tool-' + t;
  if(t !== 'fill'){
    // Fill deliberately depends on whatever is already selected, so
    // switching into it must not wipe that out the way every other tool does.
    selectedId = null;
    multiSelectedIds = [];
  }
  refreshStylePanel();
  render();
}

// Safe element accessors: a missing element (e.g. HTML/JS drifting out of
// sync, as just happened with groupBtn/ungroupBtn) logs a warning instead
// of throwing and silently breaking every caller downstream of it.
function bySelector(id){
  const el = document.getElementById(id);
  if(!el) console.warn('Expected element #' + id + ' not found in the page');
  return el;
}
function setDisabled(id, value){
  const el = bySelector(id);
  if(el) el.disabled = value;
}
function setDisplay(id, value){
  const el = bySelector(id);
  if(el) el.style.display = value;
}

function refreshStylePanel(){
  const panel = bySelector('stylePanel');
  const obj = (tool === 'select') ? objects.find(o => o.id === selectedId) : null;
  let showColor, showThickness, showLineStyle, showRadius, showFill, showDash;
  const showImageControls = !!(obj && obj.type === 'image');
  if(obj){
    showColor = ('color' in obj) || ('bg' in obj);
    showThickness = ('width' in obj);
    showLineStyle = (obj.type === 'line');
    showRadius = (obj.type === 'rect');
    showFill = (obj.type === 'rect' || obj.type === 'ellipse');
    showDash = ['line','rect','ellipse','path'].includes(obj.type);
    if(showDash) currentDash = obj.dash || 'solid';
    if(showFill){ currentFill = obj.fill || null; currentFillOpacity = typeof obj.fillOpacity === 'number' ? obj.fillOpacity : 0.6; }
    if('color' in obj) currentColor = obj.color;
    else if('bg' in obj) currentColor = obj.bg;
    if('width' in obj){ currentThickness = obj.width; thicknessSlider.value = obj.width; thicknessInput.value = obj.width; }
    if(obj.type === 'line') currentLineStyle = obj.arrow ? 'arrow' : 'plain';
    if(obj.type === 'rect'){ currentRadius = obj.radius || 0; radiusSlider.value = currentRadius; }
    updateThicknessPreview();
    document.querySelectorAll('.swatch').forEach(el => el.classList.toggle('selected', el.dataset.color === currentColor));
    const customColorEl = bySelector('customColor');
    if(customColorEl) customColorEl.value = currentColor;
    if(showImageControls){
      const opacityEl = bySelector('opacitySlider');
      if(opacityEl) opacityEl.value = typeof obj.opacity === 'number' ? obj.opacity : 0.6;
      const lockBtn = bySelector('lockToggleBtn');
      if(lockBtn){
        lockBtn.textContent = obj.locked ? '🔓 Unlock image' : '🔒 Lock image';
        lockBtn.classList.toggle('active', !!obj.locked);
      }
    }
  } else {
    showColor = ['pen','rect','ellipse','line','sticky','text','fill'].includes(tool);
    showThickness = ['pen','rect','ellipse','line'].includes(tool);
    showLineStyle = (tool === 'line');
    showRadius = (tool === 'rect');
    showFill = (tool === 'rect' || tool === 'ellipse');
    showDash = ['pen','rect','ellipse','line'].includes(tool);
  }
  if(panel) panel.classList.toggle('show', showColor || showThickness || showImageControls);
  setDisplay('colorRow', showColor ? 'flex' : 'none');
  setDisplay('thicknessRow', showThickness ? 'flex' : 'none');
  setDisplay('lineStyleRow', showLineStyle ? 'flex' : 'none');
  setDisplay('radiusRow', showRadius ? 'flex' : 'none');
  setDisplay('fillRow', showFill ? 'flex' : 'none');
  setDisplay('dashRow', showDash ? 'flex' : 'none');
  document.querySelectorAll('#dashToggle .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.value === currentDash));
  if(showFill){
    const fc = document.getElementById('fillColorInput');
    if(fc) fc.value = currentFill || fc.value;
    const fo = document.getElementById('fillOpacitySlider');
    if(fo) fo.value = currentFillOpacity;
    const fn = document.getElementById('fillNoneBtn');
    if(fn) fn.classList.toggle('active', !currentFill);
  }
  setDisplay('opacityRow', showImageControls ? 'flex' : 'none');
  setDisplay('lockRow', showImageControls ? 'flex' : 'none');
  document.querySelectorAll('#lineStyleToggle .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === currentLineStyle);
  });
  setDisabled('saveShapeBtn', !obj);

  setDisabled('groupBtn', multiSelectedIds.length < 2);
  const ungroupIds = multiSelectedIds.length > 1 ? multiSelectedIds : (selectedId ? [selectedId] : []);
  const canUngroup = ungroupIds.some(id => {
    const o = objects.find(x => x.id === id);
    return o && o.groupId;
  });
  setDisabled('ungroupBtn', !canUngroup);
}

// build swatches
const swatchesEl = document.getElementById('swatches');
PALETTE.forEach(c => {
  const s = document.createElement('div');
  s.className = 'swatch';
  s.style.background = c;
  s.dataset.color = c;
  if(c === currentColor) s.classList.add('selected');
  s.addEventListener('click', () => {
    currentColor = c;
    document.querySelectorAll('.swatch').forEach(el => el.classList.remove('selected'));
    s.classList.add('selected');
    if(selectedId){ applyStyleToSelection(); pushHistory(); }
  });
  swatchesEl.appendChild(s);
});
document.getElementById('customColor').addEventListener('input', (e) => {
  currentColor = e.target.value;
  document.querySelectorAll('.swatch').forEach(el => el.classList.remove('selected'));
  if(selectedId){ applyStyleToSelection(); }
});
document.getElementById('customColor').addEventListener('change', () => {
  if(selectedId){ pushHistory(); }
});

const thicknessSlider = document.getElementById('thicknessSlider');
const thicknessInput = document.getElementById('thicknessInput');
const thicknessPreview = document.getElementById('thicknessPreview').querySelector('.dot');
function updateThicknessPreview(){
  const sz = Math.max(2, Math.min(24, currentThickness));
  thicknessPreview.style.width = sz + 'px';
  thicknessPreview.style.height = sz + 'px';
  thicknessPreview.parentElement.style.color = currentColor;
}
function setThickness(val){
  const clamped = Math.max(0.5, Math.min(40, val));
  currentThickness = clamped;
  thicknessSlider.value = clamped;
  thicknessInput.value = clamped;
  updateThicknessPreview();
  if(selectedId){ applyStyleToSelection(); }
}
thicknessSlider.addEventListener('input', (e) => {
  setThickness(parseFloat(e.target.value));
});
thicknessSlider.addEventListener('change', () => {
  if(selectedId){ pushHistory(); }
});
thicknessInput.addEventListener('input', (e) => {
  if(e.target.value === '') return;
  const val = parseFloat(e.target.value);
  if(!isNaN(val)) setThickness(val);
});
thicknessInput.addEventListener('change', () => {
  thicknessInput.value = currentThickness;
  if(selectedId){ pushHistory(); }
});
thicknessInput.addEventListener('keydown', (e) => e.stopPropagation());
updateThicknessPreview();

const radiusSlider = document.getElementById('radiusSlider');
radiusSlider.addEventListener('input', (e) => {
  currentRadius = parseFloat(e.target.value);
  if(selectedId){ applyStyleToSelection(); }
});
radiusSlider.addEventListener('change', () => {
  if(selectedId){ pushHistory(); }
});

// shape fill (interior color + transparency)
const fillColorInput = document.getElementById('fillColorInput');
const fillNoneBtn = document.getElementById('fillNoneBtn');
const fillOpacitySlider = document.getElementById('fillOpacitySlider');
function applyFillToSelection(){
  const obj = objects.find(o => o.id === selectedId);
  if(obj && (obj.type === 'rect' || obj.type === 'ellipse')){
    obj.fill = currentFill;
    obj.fillOpacity = currentFillOpacity;
    render();
  }
}
fillColorInput.addEventListener('input', (e) => {
  currentFill = e.target.value;
  fillNoneBtn.classList.remove('active');
  applyFillToSelection();
});
fillColorInput.addEventListener('change', () => { if(selectedId) pushHistory(); });
fillNoneBtn.addEventListener('click', () => {
  currentFill = null;
  fillNoneBtn.classList.add('active');
  applyFillToSelection();
  if(selectedId) pushHistory();
});
fillOpacitySlider.addEventListener('input', (e) => {
  currentFillOpacity = parseFloat(e.target.value);
  applyFillToSelection();
});
fillOpacitySlider.addEventListener('change', () => { if(selectedId) pushHistory(); });

const opacitySlider = document.getElementById('opacitySlider');
opacitySlider.addEventListener('input', (e) => {
  const obj = objects.find(o => o.id === selectedId);
  if(obj && obj.type === 'image'){
    obj.opacity = parseFloat(e.target.value);
    render();
  }
});
opacitySlider.addEventListener('change', () => {
  if(selectedId) pushHistory();
});

document.getElementById('lockToggleBtn').addEventListener('click', () => {
  const obj = objects.find(o => o.id === selectedId);
  if(obj && obj.type === 'image'){
    obj.locked = !obj.locked;
    refreshStylePanel();
    pushHistory();
    render();
  }
});

document.querySelectorAll('#lineStyleToggle .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentLineStyle = btn.dataset.value;
    document.querySelectorAll('#lineStyleToggle .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    if(selectedId){ applyStyleToSelection(); pushHistory(); }
  });
});

document.querySelectorAll('#dashToggle .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentDash = btn.dataset.value;
    document.querySelectorAll('#dashToggle .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    if(selectedId){ applyStyleToSelection(); pushHistory(); }
  });
});

// Dashed / dotted strokes: the pattern scales with line thickness, and round
// caps turn the dotted pattern's zero-length dashes into actual round dots.
function applyDash(o){
  const w = o.width || 1;
  if(o.dash === 'dotted') ctx.setLineDash([0.01, Math.max(4, w * 2.2)]);
  else if(o.dash === 'dashed') ctx.setLineDash([Math.max(8, w * 4.5), Math.max(6, w * 3)]);
  else ctx.setLineDash([]);
}

function applyStyleToSelection(){
  const obj = objects.find(o => o.id === selectedId);
  if(!obj) return;
  if('color' in obj) obj.color = currentColor;
  else if('bg' in obj) obj.bg = currentColor;
  if('width' in obj) obj.width = currentThickness;
  if(obj.type === 'line') obj.arrow = (currentLineStyle === 'arrow');
  if(['line','rect','ellipse','path'].includes(obj.type)) obj.dash = currentDash;
  if(obj.type === 'rect') obj.radius = currentRadius;
  if(obj.type === 'rect' || obj.type === 'ellipse'){
    obj.fill = currentFill;
    obj.fillOpacity = currentFillOpacity;
  }
  render();
}

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

window.addEventListener('keydown', (e) => {
  if(document.activeElement && ['TEXTAREA','INPUT'].includes(document.activeElement.tagName)) return;
  if(e.ctrlKey || e.metaKey){
    if(e.key.toLowerCase() === 'z'){
      e.preventDefault();
      if(e.shiftKey) redo(); else undo();
    } else if(e.key.toLowerCase() === 'y'){
      e.preventDefault(); redo();
    } else if(e.key.toLowerCase() === 'c'){
      e.preventDefault();
      copySelection();
    } else if(e.key.toLowerCase() === 'v'){
      e.preventDefault();
      pasteClipboard();
    } else if(e.key.toLowerCase() === 'g'){
      e.preventDefault();
      if(e.shiftKey) ungroupSelection(); else groupSelection();
    }
    return;
  }
  if(e.code === 'Space'){ spaceHeld = true; canvas.style.cursor='grab'; return; }
  if(e.key === 'Delete' || e.key === 'Backspace'){
    if(multiSelectedIds.length > 1){
      objects = objects.filter(o => !multiSelectedIds.includes(o.id));
      multiSelectedIds = [];
      refreshStylePanel();
      pushHistory(); render();
      return;
    }
    if(selectedId){
      const selObj = objects.find(o => o.id === selectedId);
      if(selObj && isLayerLocked(selObj.layerId)) return;
      objects = objects.filter(o => o.id !== selectedId);
      selectedId = null;
      refreshStylePanel();
      pushHistory(); render();
    }
    return;
  }
  const t = TOOL_KEYS[e.key.toLowerCase()];
  if(t) setTool(t);
});
window.addEventListener('keyup', (e) => {
  if(e.code === 'Space'){ spaceHeld = false; canvas.className = 'tool-' + tool; }
});
let spaceHeld = false;

// ---------- zoom ----------
function zoomAt(sx, sy, factor){
  const before = screenToWorld(sx, sy);
  scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
  panX = sx - before.x * scale;
  panY = sy - before.y * scale;
  updateZoomLabel();
  save();
  render();
}
function updateZoomLabel(){
  document.getElementById('zoomPct').textContent = Math.round(scale * 100) + '%';
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  if(e.ctrlKey || e.metaKey){
    // trackpad pinch gesture also lands here; treat same as wheel-zoom
    zoomAt(sx, sy, Math.exp(-e.deltaY * 0.01));
  } else {
    zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0015));
  }
}, { passive: false });

document.getElementById('zoomIn').addEventListener('click', () => zoomAt(window.innerWidth/2, window.innerHeight/2, 1.2));
document.getElementById('zoomOut').addEventListener('click', () => zoomAt(window.innerWidth/2, window.innerHeight/2, 1/1.2));
document.getElementById('zoomPct').addEventListener('click', () => {
  scale = 1; panX = 0; panY = 0; updateZoomLabel(); save(); render();
});

// ---------- drawing state ----------
let isDrawing = false;
let isPanning = false;
let isDragging = false;
let dragOffset = {x:0,y:0};
let lastPointer = {x:0, y:0};
let currentPath = null;
let shapeStart = null;
let previewShape = null;
let isResizing = false;
let resizeObj = null;
let resizeHandleId = null;
let resizeAnchor = null;
let resizeStartBounds = null;
let resizeStartPoints = null;
let resizeStartFontSize = null;
let isRotating = false;
let rotateStartAngle = 0;
let rotateStartRotation = 0;
let isGroupRotating = false;
let groupRotatePivot = null;
let groupRotateStartAngle = 0;
let groupRotateSnapshot = [];
const HANDLE_RADIUS = 5;
const HANDLE_HIT_RADIUS = 11;
const ROTATE_HANDLE_DIST = 26; // fixed screen-pixel distance above the selection box

function idOf(){ return nextId++; }

// Rotation is a pure transform layered on top of an object's own (always
// axis-aligned) x/y/w/h or points — nothing else needs to know an object
// is rotated except: rendering (wraps the draw in a canvas rotate),
// hit-testing (converts the click into the object's unrotated local
// space first), and the resize drag (does the same for the mouse point).
function centerOf(o){
  const b = boundsOf(o);
  return { x: b.x + b.w/2, y: b.y + b.h/2 };
}
function toLocal(wx, wy, o){
  const rot = o.rotation || 0;
  if(!rot) return { x: wx, y: wy };
  const c = centerOf(o);
  const cos = Math.cos(-rot), sin = Math.sin(-rot);
  const dx = wx - c.x, dy = wy - c.y;
  return { x: c.x + dx*cos - dy*sin, y: c.y + dx*sin + dy*cos };
}

// Group rotation: the whole multi-selection revolves together around the
// center of their combined bounding box, while each member also keeps
// spinning individually by that same delta (its own o.rotation increases
// too) — so relative orientation within the group is preserved.
// The plain axis-aligned box around a rotated object's own (local) x/y/w/h
// doesn't reflect what it actually looks like on screen. This rotates the
// box's 4 corners around the object's center and re-encloses them, giving
// the true world-space footprint — used for the multi-select group box,
// never for a single object's own (correctly locally-rotated) outline.
function worldBoundsOf(o){
  const b = boundsOf(o);
  if(!o.rotation) return b;
  const c = centerOf(o);
  const cos = Math.cos(o.rotation), sin = Math.sin(o.rotation);
  const corners = [
    {x:b.x, y:b.y}, {x:b.x+b.w, y:b.y}, {x:b.x, y:b.y+b.h}, {x:b.x+b.w, y:b.y+b.h}
  ];
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  corners.forEach(p => {
    const dx = p.x-c.x, dy = p.y-c.y;
    const rx = c.x + dx*cos - dy*sin, ry = c.y + dx*sin + dy*cos;
    minX = Math.min(minX, rx); minY = Math.min(minY, ry);
    maxX = Math.max(maxX, rx); maxY = Math.max(maxY, ry);
  });
  return { x:minX, y:minY, w:maxX-minX, h:maxY-minY };
}
function combinedBoundsOf(ids){
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  ids.forEach(id => {
    const o = objects.find(x => x.id === id);
    if(!o) return;
    const b = worldBoundsOf(o);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x+b.w); maxY = Math.max(maxY, b.y+b.h);
  });
  return { x:minX, y:minY, w:maxX-minX, h:maxY-minY };
}
function groupRotateHandlePos(){
  const b = combinedBoundsOf(multiSelectedIds);
  return { x: b.x + b.w/2, y: b.y - ROTATE_HANDLE_DIST/scale };
}
function hitTestGroupRotateHandle(wx, wy){
  if(multiSelectedIds.length < 2) return false;
  const p = groupRotateHandlePos();
  return Math.hypot(wx-p.x, wy-p.y) < HANDLE_HIT_RADIUS/scale;
}
// Shift always hard-snaps to 15° steps (fine control). Otherwise, rotation
// is free — except within a few degrees of an exact quarter-turn (0/90/
// 180/270), where it snaps there, so squaring something up to 90 or
// flipping it 180 is easy without needing to hold anything down.
function applyRotationSnap(rotation, shiftHeld){
  if(shiftHeld){
    const step = Math.PI / 12; // 15 degrees
    return Math.round(rotation / step) * step;
  }
  const quarter = Math.PI / 2;
  const nearest = Math.round(rotation / quarter) * quarter;
  const tolerance = Math.PI / 45; // 4 degrees
  return Math.abs(rotation - nearest) < tolerance ? nearest : rotation;
}


function cornersFromBounds(b){
  return [
    {id:'tl', x:b.x,     y:b.y},
    {id:'tr', x:b.x+b.w, y:b.y},
    {id:'bl', x:b.x,     y:b.y+b.h},
    {id:'br', x:b.x+b.w, y:b.y+b.h},
  ];
}
function getHandles(o){
  let handles;
  if(o.type === 'rect' || o.type === 'ellipse' || o.type === 'sticky' || o.type === 'fill'){
    handles = cornersFromBounds({x:o.x, y:o.y, w:o.w, h:o.h});
  } else if(o.type === 'image'){
    handles = o.locked ? [] : cornersFromBounds({x:o.x, y:o.y, w:o.w, h:o.h});
  } else if(o.type === 'line'){
    handles = [];
    o.points.forEach((p, i) => handles.push({id:'pt:'+i, x:p.x, y:p.y, smooth: !!p.smooth}));
    for(let i = 0; i < o.points.length - 1; i++){
      const a = o.points[i], b = o.points[i+1];
      handles.push({id:'mid:'+i, x:(a.x+b.x)/2, y:(a.y+b.y)/2, mid:true});
    }
  } else if(o.type === 'path' || o.type === 'text'){
    handles = cornersFromBounds(boundsOf(o));
  } else {
    handles = [];
  }
  // every type that gets any handles at all also gets a rotate handle,
  // a fixed screen-distance above the (unrotated, local) bounding box
  if(handles.length){
    const b = boundsOf(o);
    handles.push({ id: 'rotate', x: b.x + b.w/2, y: b.y - ROTATE_HANDLE_DIST/scale, rotate: true });
  }
  return handles;
}
function cornerPoint(b, id){
  switch(id){
    case 'tl': return {x:b.x,     y:b.y};
    case 'tr': return {x:b.x+b.w, y:b.y};
    case 'bl': return {x:b.x,     y:b.y+b.h};
    case 'br': return {x:b.x+b.w, y:b.y+b.h};
  }
  return {x:b.x, y:b.y};
}
function anchorForHandle(b, id){
  switch(id){
    case 'tl': return {x:b.x+b.w, y:b.y+b.h};
    case 'tr': return {x:b.x,     y:b.y+b.h};
    case 'bl': return {x:b.x+b.w, y:b.y};
    case 'br': return {x:b.x,     y:b.y};
  }
  return {x:b.x, y:b.y};
}
function hitTestHandles(wx, wy){
  const obj = objects.find(o => o.id === selectedId);
  if(!obj || isLayerLocked(obj.layerId)) return null;
  const p = obj.rotation ? toLocal(wx, wy, obj) : {x:wx, y:wy};
  const hitR = HANDLE_HIT_RADIUS / scale;
  const handles = getHandles(obj);
  for(const h of handles){
    if(Math.hypot(p.x - h.x, p.y - h.y) < hitR) return { obj, id: h.id };
  }
  return null;
}

function hitTest(wx, wy){
  const order = getPaintOrder();
  for(let idx = order.length - 1; idx >= 0; idx--){
    const o = order[idx];
    if(!isLayerVisible(o.layerId) || isLayerLocked(o.layerId)) continue;
    const p = o.rotation ? toLocal(wx, wy, o) : {x:wx, y:wy};
    const lx = p.x, ly = p.y;
    if(o.type === 'path'){
      for(const pt of o.points){
        if(Math.hypot(pt.x - lx, pt.y - ly) < Math.max(8, o.width)) return o;
      }
    } else if(o.type === 'rect' || o.type === 'sticky' || o.type === 'image' || o.type === 'fill'){
      if(lx >= o.x && lx <= o.x + o.w && ly >= o.y && ly <= o.y + o.h) return o;
    } else if(o.type === 'ellipse'){
      const cx = o.x + o.w/2, cy = o.y + o.h/2;
      const rx = Math.abs(o.w/2) || 1, ry = Math.abs(o.h/2) || 1;
      if(((lx-cx)**2)/(rx*rx) + ((ly-cy)**2)/(ry*ry) <= 1) return o;
    } else if(o.type === 'line'){
      for(let i = 0; i < o.points.length - 1; i++){
        const a = o.points[i], b = o.points[i+1];
        if(distToSegment(lx, ly, a.x, a.y, b.x, b.y) < Math.max(8, o.width)) return o;
      }
    } else if(o.type === 'text'){
      const w = (o.text.length || 1) * o.fontSize * 0.55;
      if(lx >= o.x && lx <= o.x + w && ly >= o.y - o.fontSize && ly <= o.y + 6) return o;
    }
  }
  return null;
}
function distToSegment(px,py,x1,y1,x2,y2){
  const A = px-x1, B = py-y1, C = x2-x1, D = y2-y1;
  const dot = A*C+B*D; const lenSq = C*C+D*D;
  let t = lenSq !== 0 ? dot/lenSq : -1;
  t = Math.max(0, Math.min(1, t));
  const xx = x1 + t*C, yy = y1 + t*D;
  return Math.hypot(px-xx, py-yy);
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const w = screenToWorld(sx, sy);
  lastPointer = {x: sx, y: sy};

  if(tool === 'pan' || spaceHeld || e.button === 1 || e.button === 2){
    isPanning = true;
    canvas.classList.add('panning');
    return;
  }

  if(tool === 'select'){
    if(multiSelectedIds.length > 1 && hitTestGroupRotateHandle(w.x, w.y)){
      isGroupRotating = true;
      groupRotatePivot = (() => { const b = combinedBoundsOf(multiSelectedIds); return {x:b.x+b.w/2, y:b.y+b.h/2}; })();
      groupRotateStartAngle = Math.atan2(w.y - groupRotatePivot.y, w.x - groupRotatePivot.x);
      groupRotateSnapshot = multiSelectedIds.map(id => {
        const o = objects.find(x => x.id === id);
        return {
          id,
          rotation: o.rotation || 0,
          x: o.x, y: o.y,
          points: o.points ? JSON.parse(JSON.stringify(o.points)) : null,
          center: centerOf(o),
        };
      });
      return;
    }
    const handleHit = hitTestHandles(w.x, w.y);
    if(handleHit){
      if(handleHit.id === 'rotate'){
        isRotating = true;
        resizeObj = handleHit.obj;
        const c = centerOf(resizeObj);
        rotateStartAngle = Math.atan2(w.y - c.y, w.x - c.x);
        rotateStartRotation = resizeObj.rotation || 0;
        return;
      }
      if(handleHit.obj.type === 'line' && handleHit.id.startsWith('pt:') && e.altKey){
        const idx = parseInt(handleHit.id.split(':')[1], 10);
        const pt = handleHit.obj.points[idx];
        pt.smooth = !pt.smooth;
        pushHistory();
        render();
        return;
      }
      isResizing = true;
      resizeObj = handleHit.obj;
      resizeHandleId = handleHit.id;
      const lw = resizeObj.rotation ? toLocal(w.x, w.y, resizeObj) : w; // points/x/y are always stored unrotated
      if(resizeObj.type === 'line'){
        if(resizeHandleId.startsWith('mid:')){
          // subdividing: insert a real point at this midpoint, then drag it
          const segIdx = parseInt(resizeHandleId.split(':')[1], 10);
          resizeObj.points.splice(segIdx + 1, 0, {x:lw.x, y:lw.y});
          resizeHandleId = 'pt:' + (segIdx + 1);
        }
        return;
      }
      resizeStartBounds = boundsOf(resizeObj);
      resizeAnchor = anchorForHandle(resizeStartBounds, resizeHandleId);
      if(resizeObj.type === 'path'){
        resizeStartPoints = resizeObj.points.map(p => ({x:p.x, y:p.y}));
      } else if(resizeObj.type === 'text'){
        resizeStartFontSize = resizeObj.fontSize;
      }
      return;
    }
    const hit = hitTest(w.x, w.y);

    if(e.ctrlKey || e.metaKey){
      // Ctrl/Cmd+click: add to (or remove from) the current selection
      if(!hit) return; // keep the selection as-is when ctrl-clicking empty space
      const current = multiSelectedIds.length ? multiSelectedIds.slice() : (selectedId ? [selectedId] : []);
      const hitIds = hit.groupId ? objects.filter(o => o.groupId === hit.groupId).map(o => o.id) : [hit.id];
      const alreadyIn = hitIds.every(id => current.includes(id));
      const next = alreadyIn
        ? current.filter(id => !hitIds.includes(id))
        : current.concat(hitIds.filter(id => !current.includes(id)));
      if(next.length > 1){
        selectedId = null;
        multiSelectedIds = next;
      } else {
        multiSelectedIds = [];
        selectedId = next.length === 1 ? next[0] : null;
      }
      refreshStylePanel();
      render();
      return;
    }

    if(hit && multiSelectedIds.length > 1 && multiSelectedIds.includes(hit.id)){
      // clicked on a member of an existing multi-selection: drag the whole group
      isDragging = true;
      dragOffset = { x: w.x, y: w.y };
      return;
    }

    if(hit && hit.groupId){
      // clicking any member of a saved group selects (and drags) the whole group
      const groupIds = objects.filter(o => o.groupId === hit.groupId).map(o => o.id);
      if(groupIds.length > 1){
        selectedId = null;
        multiSelectedIds = groupIds;
        isDragging = true;
        dragOffset = { x: w.x, y: w.y };
        refreshStylePanel();
        render();
        return;
      }
    }

    if(hit){
      multiSelectedIds = [];
      selectedId = hit.id;
      if(!(hit.type === 'image' && hit.locked)){
        isDragging = true;
        dragOffset = { x: w.x, y: w.y };
      }
      refreshStylePanel();
      render();
      return;
    }

    // clicked empty space: begin a possible marquee drag (a plain click
    // with no movement just clears the selection, handled on pointerup)
    selectedId = null;
    multiSelectedIds = [];
    isMarqueeSelecting = true;
    marqueeStart = w;
    marqueeEnd = w;
    refreshStylePanel();
    render();
    return;
  }

  if(tool === 'pen'){
    isDrawing = true;
    currentPath = { id: idOf(), type:'path', color: currentColor, width: currentThickness, dash: currentDash, points: [{x:w.x,y:w.y}], layerId: activeLayerId };
    objects.push(currentPath);
    return;
  }

  if(tool === 'eraser'){
    isDrawing = true;
    eraseAt(w.x, w.y);
    return;
  }

  if(tool === 'fill'){
    tryFillAt(w.x, w.y);
    return;
  }

  if(tool === 'rect' || tool === 'ellipse'){
    isDrawing = true;
    shapeStart = w;
    previewShape = { id: null, type: tool, color: currentColor, width: currentThickness,
      x: w.x, y: w.y, w: 0, h: 0, layerId: activeLayerId, radius: currentRadius,
      fill: currentFill, fillOpacity: currentFillOpacity, dash: currentDash };
    return;
  }

  if(tool === 'line'){
    isDrawing = true;
    shapeStart = w;
    previewShape = { id: null, type: 'line', color: currentColor, width: currentThickness,
      points: [{x:w.x, y:w.y}, {x:w.x, y:w.y}], arrow: currentLineStyle === 'arrow', dash: currentDash, layerId: activeLayerId };
    return;
  }

  if(tool === 'sticky'){
    const colors = ['#fde68a','#fbcfe8','#bfdbfe','#bbf7d0'];
    const c = colors[Math.floor(Math.random()*colors.length)];
    objects.push({ id: idOf(), type:'sticky', x: w.x-80, y: w.y-80, w:160, h:160, bg:c, text:'', layerId: activeLayerId });
    pushHistory();
    setTool('select');
    selectedId = objects[objects.length-1].id;
    refreshStylePanel();
    render();
    openEditorForSelected();
    return;
  }

  if(tool === 'text'){
    objects.push({ id: idOf(), type:'text', x:w.x, y:w.y, text:'', fontSize: 20, color: currentColor, layerId: activeLayerId });
    pushHistory();
    setTool('select');
    selectedId = objects[objects.length-1].id;
    refreshStylePanel();
    render();
    openEditorForSelected();
    return;
  }
});

canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const w = screenToWorld(sx, sy);
  cursorScreen = { x: sx, y: sy }; // remembered so Ctrl+V can paste under the cursor

  if(isPanning){
    panX += (sx - lastPointer.x);
    panY += (sy - lastPointer.y);
    lastPointer = {x:sx, y:sy};
    render();
    return;
  }

  if(isRotating && resizeObj){
    const c = centerOf(resizeObj);
    const currentAngle = Math.atan2(w.y - c.y, w.x - c.x);
    let rotation = rotateStartRotation + (currentAngle - rotateStartAngle);
    rotation = applyRotationSnap(rotation, e.shiftKey);
    resizeObj.rotation = rotation;
    render();
    return;
  }

  if(isGroupRotating && groupRotatePivot){
    const currentAngle = Math.atan2(w.y - groupRotatePivot.y, w.x - groupRotatePivot.x);
    let delta = currentAngle - groupRotateStartAngle;
    delta = applyRotationSnap(delta, e.shiftKey);
    const cos = Math.cos(delta), sin = Math.sin(delta);
    groupRotateSnapshot.forEach(snap => {
      const o = objects.find(x => x.id === snap.id);
      if(!o) return;
      const dx = snap.center.x - groupRotatePivot.x, dy = snap.center.y - groupRotatePivot.y;
      const newCenterX = groupRotatePivot.x + dx*cos - dy*sin;
      const newCenterY = groupRotatePivot.y + dx*sin + dy*cos;
      const shiftX = newCenterX - snap.center.x, shiftY = newCenterY - snap.center.y;
      if(snap.points){
        o.points = snap.points.map(p => ({ ...p, x: p.x + shiftX, y: p.y + shiftY }));
      } else {
        o.x = snap.x + shiftX;
        o.y = snap.y + shiftY;
      }
      o.rotation = snap.rotation + delta;
    });
    render();
    return;
  }

  if(isResizing && resizeObj){
    // x/y/points are always stored unrotated, so the mouse point needs to
    // be converted into that same local space before any of this math
    let lw = resizeObj.rotation ? toLocal(w.x, w.y, resizeObj) : w;
    if(e.shiftKey && resizeStartBounds && resizeObj.type !== 'line' && resizeObj.type !== 'text'){
      // hold Shift: keep the original proportions while dragging a corner
      const w0 = Math.max(resizeStartBounds.w, 0.001), h0 = Math.max(resizeStartBounds.h, 0.001);
      const dx = lw.x - resizeAnchor.x, dy = lw.y - resizeAnchor.y;
      const k = Math.max(Math.abs(dx) / w0, Math.abs(dy) / h0);
      lw = {
        x: resizeAnchor.x + (dx < 0 ? -1 : 1) * k * w0,
        y: resizeAnchor.y + (dy < 0 ? -1 : 1) * k * h0,
      };
    }
    if(['rect','ellipse','sticky','image','fill'].includes(resizeObj.type)){
      const nx = Math.min(resizeAnchor.x, lw.x);
      const ny = Math.min(resizeAnchor.y, lw.y);
      resizeObj.x = nx;
      resizeObj.y = ny;
      resizeObj.w = Math.abs(lw.x - resizeAnchor.x);
      resizeObj.h = Math.abs(lw.y - resizeAnchor.y);
    } else if(resizeObj.type === 'line'){
      const idx = parseInt(resizeHandleId.split(':')[1], 10);
      resizeObj.points[idx].x = lw.x;
      resizeObj.points[idx].y = lw.y;
    } else if(resizeObj.type === 'path'){
      const orig = cornerPoint(resizeStartBounds, resizeHandleId);
      const scaleX = Math.abs(orig.x - resizeAnchor.x) > 0.001 ? (lw.x - resizeAnchor.x) / (orig.x - resizeAnchor.x) : 1;
      const scaleY = Math.abs(orig.y - resizeAnchor.y) > 0.001 ? (lw.y - resizeAnchor.y) / (orig.y - resizeAnchor.y) : 1;
      resizeObj.points = resizeStartPoints.map(p => ({
        x: resizeAnchor.x + (p.x - resizeAnchor.x) * scaleX,
        y: resizeAnchor.y + (p.y - resizeAnchor.y) * scaleY,
      }));
    } else if(resizeObj.type === 'text'){
      const orig = cornerPoint(resizeStartBounds, resizeHandleId);
      const scaleX = Math.abs(orig.x - resizeAnchor.x) > 0.001 ? (lw.x - resizeAnchor.x) / (orig.x - resizeAnchor.x) : 1;
      const scaleY = Math.abs(orig.y - resizeAnchor.y) > 0.001 ? (lw.y - resizeAnchor.y) / (orig.y - resizeAnchor.y) : 1;
      const scale = Math.max(Math.abs(scaleX), Math.abs(scaleY));
      resizeObj.fontSize = Math.max(8, Math.min(300, resizeStartFontSize * scale));
    }
    render();
    return;
  }

  if(isMarqueeSelecting){
    marqueeEnd = w;
    render();
    return;
  }

  if(isDragging && multiSelectedIds.length > 1){
    const dx = w.x - dragOffset.x, dy = w.y - dragOffset.y;
    multiSelectedIds.forEach(id => {
      const obj = objects.find(o => o.id === id);
      if(obj && !isLayerLocked(obj.layerId)) moveObject(obj, dx, dy);
    });
    dragOffset = w;
    render();
    return;
  }

  if(isDragging && selectedId){
    const obj = objects.find(o => o.id === selectedId);
    const dx = w.x - dragOffset.x, dy = w.y - dragOffset.y;
    moveObject(obj, dx, dy);
    dragOffset = w;
    render();
    return;
  }

  if(isDrawing && tool === 'pen' && currentPath){
    const pts = currentPath.points;
    const prev = pts[pts.length - 1];
    // light exponential smoothing: nudge the raw point toward the previous
    // one so small hand-jitter gets absorbed, while fast intentional
    // strokes still track the cursor closely
    const smoothed = prev
      ? { x: prev.x * 0.35 + w.x * 0.65, y: prev.y * 0.35 + w.y * 0.65 }
      : { x: w.x, y: w.y };
    pts.push(smoothed);
    render();
    return;
  }

  if(isDrawing && tool === 'eraser'){
    eraseAt(w.x, w.y);
    return;
  }

  if(isDrawing && previewShape){
    if(tool === 'line'){
      previewShape.points[1] = {x:w.x, y:w.y};
    } else {
      previewShape.x = Math.min(shapeStart.x, w.x);
      previewShape.y = Math.min(shapeStart.y, w.y);
      previewShape.w = Math.abs(w.x - shapeStart.x);
      previewShape.h = Math.abs(w.y - shapeStart.y);
    }
    render();
    return;
  }

  if(tool === 'select' && !isDragging){
    const h = hitTestHandles(w.x, w.y);
    if(h){
      const cursors = {tl:'nwse-resize', br:'nwse-resize', tr:'nesw-resize', bl:'nesw-resize', rotate:'grab'};
      canvas.style.cursor = cursors[h.id] || 'crosshair';
    } else if(multiSelectedIds.length > 1 && hitTestGroupRotateHandle(w.x, w.y)){
      canvas.style.cursor = 'grab';
    } else {
      canvas.style.cursor = 'default';
    }
  }
});

function moveObject(obj, dx, dy){
  if(obj.type === 'path' || obj.type === 'line'){
    obj.points.forEach(p => { p.x += dx; p.y += dy; });
  } else if(obj.type === 'text'){
    obj.x += dx; obj.y += dy;
  } else {
    obj.x += dx; obj.y += dy;
  }
}

let cursorScreen = null; // last known pointer position over the board (screen px)

function copySelection(){
  let ids = [];
  if(multiSelectedIds.length > 1) ids = multiSelectedIds;
  else if(selectedId) ids = [selectedId];
  if(!ids.length) return;
  clipboardObjects = ids
    .map(id => objects.find(o => o.id === id))
    .filter(Boolean)
    .map(o => JSON.parse(JSON.stringify(o)));
  pasteOffsetCount = 0;
}

function pasteClipboard(){
  if(!clipboardObjects.length) return;
  pasteOffsetCount++;
  const newIds = [];
  const clones = [];
  const groupIdMap = {}; // pasted copies form their own group, separate from the source
  clipboardObjects.forEach(src => {
    const clone = JSON.parse(JSON.stringify(src));
    clone.id = idOf();
    clone.layerId = activeLayerId;
    if(clone.groupId){
      if(!groupIdMap[clone.groupId]) groupIdMap[clone.groupId] = newGroupId();
      clone.groupId = groupIdMap[clone.groupId];
    }
    clones.push(clone);
  });
  // center the pasted copies on the cursor (falls back to a small diagonal
  // offset if the pointer hasn't been over the board yet)
  let dx, dy;
  if(cursorScreen){
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    clones.forEach(c => {
      const b = worldBoundsOf(c);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x+b.w); maxY = Math.max(maxY, b.y+b.h);
    });
    const target = screenToWorld(cursorScreen.x, cursorScreen.y);
    dx = target.x - (minX+maxX)/2;
    dy = target.y - (minY+maxY)/2;
  } else {
    dx = dy = 24 * pasteOffsetCount;
  }
  clones.forEach(c => {
    moveObject(c, dx, dy);
    objects.push(c);
    newIds.push(c.id);
  });
  setTool('select');
  if(newIds.length === 1){
    selectedId = newIds[0];
  } else {
    multiSelectedIds = newIds;
  }
  refreshStylePanel();
  pushHistory();
  render();
}

function newGroupId(){
  return 'group_' + Date.now() + '_' + Math.floor(Math.random()*100000);
}

function groupSelection(){
  if(multiSelectedIds.length < 2) return;
  const gid = newGroupId();
  multiSelectedIds.forEach(id => {
    const obj = objects.find(o => o.id === id);
    if(obj) obj.groupId = gid;
  });
  refreshStylePanel();
  pushHistory();
  render();
}

function ungroupSelection(){
  let ids = [];
  if(multiSelectedIds.length > 1) ids = multiSelectedIds;
  else if(selectedId) ids = [selectedId];
  if(!ids.length) return;
  const groupIds = new Set();
  ids.forEach(id => {
    const obj = objects.find(o => o.id === id);
    if(obj && obj.groupId) groupIds.add(obj.groupId);
  });
  if(!groupIds.size) return;
  objects.forEach(o => {
    if(o.groupId && groupIds.has(o.groupId)) delete o.groupId;
  });
  refreshStylePanel();
  pushHistory();
  render();
}

canvas.addEventListener('pointerup', (e) => {
  if(isPanning){ isPanning = false; canvas.classList.remove('panning'); }
  if(isMarqueeSelecting){
    isMarqueeSelecting = false;
    const x1 = Math.min(marqueeStart.x, marqueeEnd.x), x2 = Math.max(marqueeStart.x, marqueeEnd.x);
    const y1 = Math.min(marqueeStart.y, marqueeEnd.y), y2 = Math.max(marqueeStart.y, marqueeEnd.y);
    // ignore near-zero drags so a plain click still just deselects
    if((x2-x1) > 3/scale || (y2-y1) > 3/scale){
      let found = getPaintOrder().filter(o => {
        if(!isLayerVisible(o.layerId) || isLayerLocked(o.layerId)) return false;
        const b = boundsOf(o);
        return b.x < x2 && b.x+b.w > x1 && b.y < y2 && b.y+b.h > y1;
      }).map(o => o.id);
      // if the marquee only caught part of a group, pull in the rest of that group too
      const expanded = new Set(found);
      found.forEach(id => {
        const obj = objects.find(o => o.id === id);
        if(obj && obj.groupId){
          objects.forEach(o => { if(o.groupId === obj.groupId) expanded.add(o.id); });
        }
      });
      found = [...expanded];
      if(found.length === 1){ selectedId = found[0]; multiSelectedIds = []; }
      else if(found.length > 1){ selectedId = null; multiSelectedIds = found; }
      else { selectedId = null; multiSelectedIds = []; }
    }
    marqueeStart = null; marqueeEnd = null;
    refreshStylePanel();
    render();
    return;
  }
  if(isRotating){ isRotating = false; resizeObj = null; pushHistory(); }
  if(isGroupRotating){ isGroupRotating = false; groupRotatePivot = null; groupRotateSnapshot = []; pushHistory(); }
  if(isResizing){
    isResizing = false; resizeObj = null; resizeHandleId = null; resizeAnchor = null;
    resizeStartBounds = null; resizeStartPoints = null; resizeStartFontSize = null;
    pushHistory();
  }
  if(isDragging){ isDragging = false; pushHistory(); }
  if(isDrawing && tool === 'pen'){
    isDrawing = false;
    if(currentPath && currentPath.points.length < 2){
      objects = objects.filter(o => o !== currentPath);
    }
    currentPath = null;
    pushHistory();
  }
  if(isDrawing && tool === 'eraser'){
    isDrawing = false;
    pushHistory();
  }
  if(isDrawing && previewShape){
    isDrawing = false;
    const hasSize = tool === 'line'
      ? Math.hypot(previewShape.points[1].x-previewShape.points[0].x, previewShape.points[1].y-previewShape.points[0].y) > 2
      : (previewShape.w > 2 && previewShape.h > 2);
    if(hasSize){
      previewShape.id = idOf();
      objects.push(previewShape);
      pushHistory();
    }
    previewShape = null;
  }
  render();
});

function eraseAt(wx, wy){
  const hit = hitTest(wx, wy);
  if(hit){
    objects = objects.filter(o => o !== hit);
    render();
  }
}

// ---------- text / sticky editing ----------
function openEditorForSelected(){
  const obj = objects.find(o => o.id === selectedId);
  if(!obj) return;
  editingObjectId = obj.id;
  render();
  if(obj.type === 'sticky'){
    const ta = document.createElement('textarea');
    ta.className = 'edit-input';
    positionEditor(ta, obj.x+8, obj.y+8, obj.w-16, obj.h-16);
    ta.style.background = 'transparent';
    ta.style.fontSize = (15*scale) + 'px';
    ta.value = obj.text;
    document.body.appendChild(ta);
    setTimeout(() => ta.focus(), 0);
    const finish = () => {
      obj.text = ta.value;
      document.body.removeChild(ta);
      editingObjectId = null;
      pushHistory();
      render();
    };
    ta.addEventListener('blur', finish);
    ta.addEventListener('keydown', (ev) => { if(ev.key === 'Escape') ta.blur(); ev.stopPropagation(); });
  } else if(obj.type === 'text'){
    const inp = document.createElement('textarea');
    inp.className = 'edit-input';
    inp.style.border = '2px solid var(--accent)';
    positionEditor(inp, obj.x, obj.y - obj.fontSize, 260, obj.fontSize + 16);
    inp.style.fontSize = (obj.fontSize*scale) + 'px';
    inp.style.color = obj.color;
    inp.value = obj.text;
    document.body.appendChild(inp);
    setTimeout(() => inp.focus(), 0);
    const finish = () => {
      obj.text = inp.value;
      editingObjectId = null;
      if(!obj.text.trim()){ objects = objects.filter(o => o.id !== obj.id); }
      document.body.removeChild(inp);
      pushHistory();
      render();
    };
    inp.addEventListener('blur', finish);
    inp.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if(ev.key === 'Enter' && !ev.shiftKey){ ev.preventDefault(); inp.blur(); }
      if(ev.key === 'Escape') inp.blur();
    });
  } else if(obj.type === 'rect' || obj.type === 'ellipse'){
    const marginX = obj.w * 0.15, marginY = obj.h * 0.3;
    const ta = document.createElement('textarea');
    ta.className = 'edit-input';
    ta.style.textAlign = 'center';
    positionEditor(ta, obj.x+marginX, obj.y+marginY, Math.max(20, obj.w-marginX*2), Math.max(20, obj.h-marginY*2));
    ta.style.background = 'transparent';
    ta.style.fontSize = (14*scale) + 'px';
    ta.style.color = obj.color;
    ta.value = obj.label || '';
    document.body.appendChild(ta);
    setTimeout(() => ta.focus(), 0);
    const finish = () => {
      obj.label = ta.value;
      editingObjectId = null;
      document.body.removeChild(ta);
      pushHistory();
      render();
    };
    ta.addEventListener('blur', finish);
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if(ev.key === 'Escape') ta.blur();
    });
  } else {
    editingObjectId = null; // no editor branch matched; don't leave text hidden
  }
}
function positionEditor(el, wx, wy, ww, wh){
  const rect = canvas.getBoundingClientRect();
  el.style.left = (rect.left + panX + wx*scale) + 'px';
  el.style.top = (rect.top + panY + wy*scale) + 'px';
  el.style.width = (ww*scale) + 'px';
  el.style.height = (wh*scale) + 'px';
}

canvas.addEventListener('dblclick', (e) => {
  const rect = canvas.getBoundingClientRect();
  const w = screenToWorld(e.clientX-rect.left, e.clientY-rect.top);

  // double-click a line's point handle (not a midpoint) to delete that vertex
  if(tool === 'select' && selectedId){
    const handleHit = hitTestHandles(w.x, w.y);
    if(handleHit && handleHit.obj.type === 'line' && handleHit.id.startsWith('pt:')){
      const line = handleHit.obj;
      if(line.points.length > 2){
        const idx = parseInt(handleHit.id.split(':')[1], 10);
        line.points.splice(idx, 1);
        pushHistory();
        render();
      }
      return;
    }
  }

  const hit = hitTest(w.x, w.y);
  if(hit && ['sticky', 'text', 'rect', 'ellipse'].includes(hit.type)){
    setTool('select');
    selectedId = hit.id;
    refreshStylePanel();
    openEditorForSelected();
  }
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- rendering ----------
function render(){
  ctx.save();
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // background
  const styles = getComputedStyle(document.documentElement);
  ctx.fillStyle = styles.getPropertyValue('--bg').trim();
  ctx.fillRect(0,0,window.innerWidth, window.innerHeight);

  // grid
  drawGrid(gridColor || styles.getPropertyValue('--dot').trim());

  ctx.translate(panX, panY);
  ctx.scale(scale, scale);

  getPaintOrder().forEach(o => {
    if(!isLayerVisible(o.layerId)) return;
    drawObject(o, o.id === selectedId);
  });
  if(previewShape) drawObject(previewShape, false, true);

  if(multiSelectedIds.length > 1){
    // one dashed box around the whole selection's combined bounds, rather
    // than a separate box per object
    const gb = combinedBoundsOf(multiSelectedIds);
    ctx.save();
    ctx.strokeStyle = '#4a5cf0';
    ctx.lineWidth = 1.5/scale;
    ctx.setLineDash([5/scale, 4/scale]);
    ctx.strokeRect(gb.x-6, gb.y-6, gb.w+12, gb.h+12);
    ctx.restore();

    const handlePos = { x: gb.x + gb.w/2, y: gb.y - ROTATE_HANDLE_DIST/scale };
    ctx.save();
    ctx.strokeStyle = 'rgba(74,92,240,0.6)';
    ctx.lineWidth = 1/scale;
    ctx.setLineDash([3/scale, 3/scale]);
    ctx.beginPath();
    ctx.moveTo(gb.x + gb.w/2, gb.y);
    ctx.lineTo(handlePos.x, handlePos.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const r = HANDLE_RADIUS/scale;
    ctx.beginPath();
    ctx.arc(handlePos.x, handlePos.y, r, 0, Math.PI*2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5/scale;
    ctx.strokeStyle = '#4a5cf0';
    ctx.stroke();
    ctx.restore();
  }

  if(isMarqueeSelecting && marqueeStart && marqueeEnd){
    const x1 = Math.min(marqueeStart.x, marqueeEnd.x), x2 = Math.max(marqueeStart.x, marqueeEnd.x);
    const y1 = Math.min(marqueeStart.y, marqueeEnd.y), y2 = Math.max(marqueeStart.y, marqueeEnd.y);
    ctx.save();
    ctx.fillStyle = 'rgba(74,92,240,0.10)';
    ctx.strokeStyle = 'rgba(74,92,240,0.8)';
    ctx.lineWidth = 1/scale;
    ctx.setLineDash([4/scale, 3/scale]);
    ctx.fillRect(x1, y1, x2-x1, y2-y1);
    ctx.strokeRect(x1, y1, x2-x1, y2-y1);
    ctx.restore();
  }

  ctx.restore();
}

function drawGrid(color){
  if(gridStyle === 'none') return;
  let gridSize = 48;
  while(gridSize * scale < 18) gridSize *= 2;
  while(gridSize * scale > 140) gridSize /= 2;
  const startX = Math.floor((-panX/scale) / gridSize) * gridSize;
  const endX = (window.innerWidth - panX) / scale;
  const startY = Math.floor((-panY/scale) / gridSize) * gridSize;
  const endY = (window.innerHeight - panY) / scale;

  if(gridStyle === 'lines'){
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(let x = startX; x < endX; x += gridSize){
      const sx = Math.round(x*scale + panX) + 0.5;
      ctx.moveTo(sx, 0); ctx.lineTo(sx, window.innerHeight);
    }
    for(let y = startY; y < endY; y += gridSize){
      const sy = Math.round(y*scale + panY) + 0.5;
      ctx.moveTo(0, sy); ctx.lineTo(window.innerWidth, sy);
    }
    ctx.stroke();
    return;
  }

  // dots (default)
  ctx.fillStyle = color;
  const r = Math.max(1, 1.4);
  for(let x = startX; x < endX; x += gridSize){
    for(let y = startY; y < endY; y += gridSize){
      const sx = x*scale + panX, sy = y*scale + panY;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI*2);
      ctx.fill();
    }
  }
}

function drawObject(o, selected, isPreview){
  const rotated = !!o.rotation;
  if(rotated){
    ctx.save();
    const c = centerOf(o);
    ctx.translate(c.x, c.y);
    ctx.rotate(o.rotation);
    ctx.translate(-c.x, -c.y);
  }
 try{
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if(o.type === 'image'){
    const entry = getCachedImage(o);
    ctx.save();
    ctx.globalAlpha = typeof o.opacity === 'number' ? o.opacity : 0.6;
    if(entry.loaded){
      ctx.drawImage(entry.img, o.x, o.y, o.w, o.h);
    } else {
      ctx.fillStyle = '#d8d5cc';
      ctx.fillRect(o.x, o.y, o.w, o.h);
    }
    ctx.restore();
  } else if(o.type === 'fill'){
    const entry = getCachedImage({ src: o.maskSrc });
    if(entry.loaded){
      const tinted = getTintedFillCanvas(o, entry.img);
      ctx.drawImage(tinted, o.x, o.y, o.w, o.h);
    }
  } else if(o.type === 'path'){
    if(o.points.length < 2) return;
    ctx.strokeStyle = o.color; ctx.lineWidth = o.width;
    applyDash(o);
    ctx.beginPath();
    const pts = o.points;
    ctx.moveTo(pts[0].x, pts[0].y);
    if(pts.length === 2){
      ctx.lineTo(pts[1].x, pts[1].y);
    } else {
      for(let i = 1; i < pts.length - 1; i++){
        const xc = (pts[i].x + pts[i+1].x) / 2;
        const yc = (pts[i].y + pts[i+1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
      }
      const last = pts[pts.length-1];
      ctx.lineTo(last.x, last.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  } else if(o.type === 'rect'){
    ctx.strokeStyle = o.color; ctx.lineWidth = o.width;
    const r = Math.min(o.radius || 0, Math.abs(o.w)/2, Math.abs(o.h)/2);
    if(o.fill){
      ctx.save();
      ctx.globalAlpha = typeof o.fillOpacity === 'number' ? o.fillOpacity : 0.6;
      ctx.fillStyle = o.fill;
      if(r > 0){ roundRect(o.x, o.y, o.w, o.h, r); ctx.fill(); }
      else ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.restore();
    }
    applyDash(o);
    if(r > 0){
      roundRect(o.x, o.y, o.w, o.h, r);
      ctx.stroke();
    } else {
      ctx.strokeRect(o.x, o.y, o.w, o.h);
    }
    ctx.setLineDash([]);
    if(o.label && o.id !== editingObjectId) drawShapeLabel(o, o.x+o.w/2, o.y+o.h/2, Math.max(10, o.w-16));
  } else if(o.type === 'ellipse'){
    ctx.strokeStyle = o.color; ctx.lineWidth = o.width;
    ctx.beginPath();
    ctx.ellipse(o.x+o.w/2, o.y+o.h/2, Math.abs(o.w/2), Math.abs(o.h/2), 0, 0, Math.PI*2);
    if(o.fill){
      ctx.save();
      ctx.globalAlpha = typeof o.fillOpacity === 'number' ? o.fillOpacity : 0.6;
      ctx.fillStyle = o.fill;
      ctx.fill();
      ctx.restore();
    }
    applyDash(o);
    ctx.stroke();
    ctx.setLineDash([]);
    if(o.label && o.id !== editingObjectId) drawShapeLabel(o, o.x+o.w/2, o.y+o.h/2, Math.max(10, Math.abs(o.w)*0.8));
  } else if(o.type === 'line'){
    ctx.strokeStyle = o.color; ctx.lineWidth = o.width;
    applyDash(o);
    ctx.beginPath();
    const pts = o.points;
    ctx.moveTo(pts[0].x, pts[0].y);
    for(let i = 1; i < pts.length - 1; i++){
      const p = pts[i];
      if(p.smooth){
        const next = pts[i+1];
        const xc = (p.x + next.x) / 2, yc = (p.y + next.y) / 2;
        ctx.quadraticCurveTo(p.x, p.y, xc, yc);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    if(pts.length > 1) ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
    ctx.stroke();
    ctx.setLineDash([]); // the arrowhead is always solid
    if(o.arrow){
      const p1 = pts[pts.length-2], p2 = pts[pts.length-1];
      const angle = Math.atan2(p2.y-p1.y, p2.x-p1.x);
      const ah = Math.max(10, o.width*2.5);
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p2.x - ah*Math.cos(angle-0.4), p2.y - ah*Math.sin(angle-0.4));
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p2.x - ah*Math.cos(angle+0.4), p2.y - ah*Math.sin(angle+0.4));
      ctx.stroke();
    }
  } else if(o.type === 'sticky'){
    ctx.fillStyle = o.bg;
    ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
    roundRect(o.x, o.y, o.w, o.h, 4);
    ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    if(o.id !== editingObjectId){
      ctx.fillStyle = '#1f2430';
      ctx.font = '15px Inter, sans-serif';
      wrapText(o.text || '', o.x+12, o.y+24, o.w-24, 19);
    }
  } else if(o.type === 'text'){
    if(o.id !== editingObjectId){
      ctx.fillStyle = o.color;
      ctx.font = `${o.fontSize}px Inter, sans-serif`;
      ctx.fillText(o.text || '', o.x, o.y);
    }
  }

  if(selected){
    ctx.save();
    const handles = getHandles(o);
    const b = boundsOf(o);
    if(handles.length === 0){
      // no handles (fallback case): a clear dashed box
      ctx.strokeStyle = '#4a5cf0';
      ctx.lineWidth = 1.5 / scale;
      ctx.setLineDash([5/scale, 4/scale]);
      ctx.strokeRect(b.x-6, b.y-6, b.w+12, b.h+12);
    } else {
      if(o.type !== 'line'){
        // dim dotted footprint so the bounding rectangle is visible even for
        // non-rectangular shapes (ellipses)
        ctx.strokeStyle = 'rgba(74,92,240,0.35)';
        ctx.lineWidth = 1 / scale;
        ctx.setLineDash([3/scale, 3/scale]);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.setLineDash([]);
      }
      // a dashed line connecting the top of the box to the rotate handle
      const rotateHandle = handles.find(h => h.rotate);
      if(rotateHandle){
        ctx.strokeStyle = 'rgba(74,92,240,0.6)';
        ctx.lineWidth = 1 / scale;
        ctx.setLineDash([3/scale, 3/scale]);
        ctx.beginPath();
        ctx.moveTo(b.x + b.w/2, b.y);
        ctx.lineTo(rotateHandle.x, rotateHandle.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // draggable handles: full-size solid dots for real points (diamonds
      // for ones set to "curve"), smaller translucent dots for midpoints
      // you can drag to subdivide, a plain circle for rotate
      handles.forEach(h => {
        if(h.rotate){
          const r = HANDLE_RADIUS / scale;
          ctx.beginPath();
          ctx.arc(h.x, h.y, r, 0, Math.PI*2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.lineWidth = 1.5/scale;
          ctx.strokeStyle = '#4a5cf0';
          ctx.stroke();
          return;
        }
        const r = (h.mid ? HANDLE_RADIUS*0.6 : HANDLE_RADIUS) / scale;
        ctx.beginPath();
        if(h.smooth){
          ctx.moveTo(h.x, h.y-r); ctx.lineTo(h.x+r, h.y);
          ctx.lineTo(h.x, h.y+r); ctx.lineTo(h.x-r, h.y);
          ctx.closePath();
        } else {
          ctx.arc(h.x, h.y, r, 0, Math.PI*2);
        }
        ctx.fillStyle = h.mid ? 'rgba(255,255,255,0.6)' : '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.5/scale;
        ctx.strokeStyle = h.mid ? 'rgba(74,92,240,0.6)' : (h.smooth ? '#2fb344' : '#4a5cf0');
        ctx.stroke();
      });
    }
    ctx.restore();
  }
 } finally {
   if(rotated) ctx.restore();
 }
}

function boundsOf(o){
  if(o.type === 'path' || o.type === 'line'){
    const xs = o.points.map(p=>p.x), ys = o.points.map(p=>p.y);
    return { x:Math.min(...xs), y:Math.min(...ys), w:Math.max(...xs)-Math.min(...xs), h:Math.max(...ys)-Math.min(...ys) };
  } else if(o.type === 'text'){
    const w = (o.text.length||1)*o.fontSize*0.55;
    return { x:o.x, y:o.y-o.fontSize, w:w, h:o.fontSize+6 };
  }
  return { x:o.x, y:o.y, w:o.w, h:o.h };
}

function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

function wrapText(text, x, y, maxWidth, lineHeight){
  const words = text.split(/\s+/);
  let line = '';
  let curY = y;
  for(let n=0; n<words.length; n++){
    const test = line + words[n] + ' ';
    if(ctx.measureText(test).width > maxWidth && line){
      ctx.fillText(line, x, curY);
      line = words[n] + ' ';
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, curY);
}

function wrapLines(text, maxWidth){
  const words = text.split(/\s+/);
  let line = '';
  const lines = [];
  for(let n=0; n<words.length; n++){
    const test = line + words[n] + ' ';
    if(ctx.measureText(test).width > maxWidth && line){
      lines.push(line.trim());
      line = words[n] + ' ';
    } else {
      line = test;
    }
  }
  lines.push(line.trim());
  return lines;
}

function drawShapeLabel(o, cx, cy, maxWidth){
  if(!o.label) return;
  ctx.save();
  ctx.fillStyle = o.color;
  ctx.font = '14px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapLines(o.label, maxWidth);
  const lineHeight = 17;
  const startY = cy - ((lines.length-1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, cx, startY + i*lineHeight));
  ctx.restore();
}

// ---------- clear ----------
document.getElementById('clearBtn').addEventListener('click', () => {
  if(objects.length && confirm('Clear the whole board? This can\'t be undone once you navigate away.')){
    objects = [];
    selectedId = null;
    pushHistory();
    render();
  }
});
document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('redoBtn').addEventListener('click', redo);
document.getElementById('groupBtn').addEventListener('click', groupSelection);
document.getElementById('ungroupBtn').addEventListener('click', ungroupSelection);

// ---------- reference images ----------
const imageCache = {}; // src -> HTMLImageElement, so drawObject doesn't reload every frame
function getCachedImage(o){
  let entry = imageCache[o.src];
  if(!entry){
    const img = new Image();
    entry = { img, loaded: false };
    img.onload = () => { entry.loaded = true; render(); };
    img.src = o.src;
    imageCache[o.src] = entry;
  }
  return entry;
}

document.getElementById('imageToolBtn').addEventListener('click', () => {
  document.getElementById('imageFileInput').click();
});
document.getElementById('imageFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const probe = new Image();
    probe.onload = () => {
      const MAX_DIM = 900;
      let w = probe.naturalWidth || 600, h = probe.naturalHeight || 400;
      const scaleDown = Math.min(1, MAX_DIM / Math.max(w, h));
      w *= scaleDown; h *= scaleDown;
      const center = screenToWorld(window.innerWidth/2, window.innerHeight/2);
      const obj = { id: idOf(), type:'image', x: center.x - w/2, y: center.y - h/2, w, h, src: dataUrl, opacity: 0.6, locked: false, layerId: activeLayerId };
      objects.unshift(obj); // reference images sit behind everything already on the board
      setTool('select');
      selectedId = obj.id;
      refreshStylePanel();
      pushHistory();
      render();
    };
    probe.onerror = () => alert("Couldn't load that image.");
    probe.src = dataUrl;
  };
  reader.onerror = () => alert("Couldn't read that file.");
  reader.readAsDataURL(file);
  e.target.value = '';
});

// ---------- fill tool ----------
// Fill only ever operates on whatever is already selected: a single shape,
// or a real saved group (via Ctrl+G) — never the whole board. It renders
// just that scope's own objects to a small offscreen raster and flood-fills
// from the clicked pixel within it. A stroke inside the scope (e.g. a line
// grouped with a rectangle it crosses) still splits it into separate
// fillable regions; anything outside the scope simply isn't part of the
// render, so it can never leak into or be confused with unrelated shapes
// elsewhere on the board. If the flood reaches the edge of that raster,
// the region wasn't actually enclosed, so nothing is filled.
const FILL_MAX_RASTER_DIM = 2000;
const FILL_SCOPE_MARGIN = 40; // world units of padding around the scope's own bounds
const FILLABLE_TYPES = ['rect', 'ellipse', 'line', 'path'];
const tintCache = {}; // "id|color" -> tinted canvas, so recoloring a fill doesn't require a full retint every frame

function showToast(msg, isWarning){
  const el = document.createElement('div');
  el.className = 'toast' + (isWarning ? ' toast-warn' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3400);
}

// In-app replacement for window.prompt(): Electron doesn't support the native
// one at all, and this looks consistent everywhere. Resolves to the entered
// text, or null if cancelled.
function askText(message, defaultValue){
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal-box">' +
        '<div class="modal-msg"></div>' +
        '<input type="text" class="modal-input" spellcheck="false">' +
        '<div class="modal-actions">' +
          '<button class="modal-btn" data-act="cancel">Cancel</button>' +
          '<button class="modal-btn primary" data-act="ok">OK</button>' +
        '</div>' +
      '</div>';
    overlay.querySelector('.modal-msg').textContent = message;
    const input = overlay.querySelector('.modal-input');
    input.value = defaultValue || '';
    // clicks inside the dialog must not reach the document-level handlers
    // that close the popover panels
    overlay.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(overlay);
    setTimeout(() => { input.focus(); input.select(); }, 0);
    const finish = (value) => { overlay.remove(); resolve(value); };
    overlay.querySelector('[data-act="ok"]').addEventListener('click', () => finish(input.value));
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(null));
    overlay.addEventListener('mousedown', (e) => { if(e.target === overlay) finish(null); });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if(e.key === 'Enter') finish(input.value);
      else if(e.key === 'Escape') finish(null);
    });
  });
}

function isNearWhitePixel(data, idx){
  return data[idx+3] > 250 && data[idx] > 250 && data[idx+1] > 250 && data[idx+2] > 250;
}

function getTintedFillCanvas(o, maskImg){
  const key = o.id + '|' + o.color;
  let cnv = tintCache[key];
  if(cnv) return cnv;
  cnv = document.createElement('canvas');
  cnv.width = maskImg.naturalWidth;
  cnv.height = maskImg.naturalHeight;
  const tctx = cnv.getContext('2d');
  tctx.drawImage(maskImg, 0, 0);
  tctx.globalCompositeOperation = 'source-in';
  tctx.fillStyle = o.color;
  tctx.fillRect(0, 0, cnv.width, cnv.height);
  tintCache[key] = cnv;
  return cnv;
}

function rectsOverlap(a, b){
  return !(a.x+a.w <= b.x || b.x+b.w <= a.x || a.y+a.h <= b.y || b.y+b.h <= a.y);
}

// Fill's target is whatever the Select tool currently has selected: a
// single object, or — only if it's a genuine saved group, not just an
// ad-hoc marquee selection — every member of that group.
function resolveFillScope(){
  if(multiSelectedIds.length > 1){
    const first = objects.find(o => o.id === multiSelectedIds[0]);
    const gid = first && first.groupId;
    const isRealGroup = gid && multiSelectedIds.every(id => {
      const o = objects.find(x => x.id === id);
      return o && o.groupId === gid;
    });
    return isRealGroup ? objects.filter(o => o.groupId === gid) : null;
  }
  if(selectedId){
    const obj = objects.find(o => o.id === selectedId);
    if(!obj) return null;
    if(obj.groupId) return objects.filter(o => o.groupId === obj.groupId);
    return [obj];
  }
  return null;
}

function tryFillAt(worldX, worldY){
 try{
  const scopeObjects = resolveFillScope();
  if(!scopeObjects){
    showToast('Select a shape or a grouped shape first, then click inside it to fill.', true);
    return;
  }
  if(!scopeObjects.some(o => FILLABLE_TYPES.includes(o.type))){
    showToast("Fill only works on shapes and lines, not this kind of object.", true);
    return;
  }

  // A lone rectangle/ellipse stores its fill as part of the shape itself
  // (it then moves, resizes, rotates and copies with it).
  if(scopeObjects.length === 1 && (scopeObjects[0].type === 'rect' || scopeObjects[0].type === 'ellipse')){
    const so = scopeObjects[0];
    const p = so.rotation ? toLocal(worldX, worldY, so) : {x:worldX, y:worldY};
    let inside;
    if(so.type === 'rect'){
      inside = p.x >= so.x && p.x <= so.x+so.w && p.y >= so.y && p.y <= so.y+so.h;
    } else {
      const rx = Math.abs(so.w/2) || 1, ry = Math.abs(so.h/2) || 1;
      inside = ((p.x-(so.x+so.w/2))**2)/(rx*rx) + ((p.y-(so.y+so.h/2))**2)/(ry*ry) <= 1;
    }
    if(!inside){ showToast('Click inside the selected shape to fill it.', true); return; }
    so.fill = currentColor;
    so.fillOpacity = currentFillOpacity;
    pushHistory();
    refreshStylePanel();
    render();
    return;
  }

  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  scopeObjects.forEach(o => {
    const b = boundsOf(o);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x+b.w); maxY = Math.max(maxY, b.y+b.h);
  });
  const bx = minX - FILL_SCOPE_MARGIN, by = minY - FILL_SCOPE_MARGIN;
  const bw = (maxX-minX) + FILL_SCOPE_MARGIN*2, bh = (maxY-minY) + FILL_SCOPE_MARGIN*2;

  if(worldX < bx || worldX > bx+bw || worldY < by || worldY > by+bh){
    showToast('Click inside the selected shape to fill it.', true);
    return;
  }

  let pxPerUnit = Math.min(FILL_MAX_RASTER_DIM/bw, FILL_MAX_RASTER_DIM/bh, 6);
  pxPerUnit = Math.max(pxPerUnit, 0.4);
  const rw = Math.max(1, Math.ceil(bw*pxPerUnit)), rh = Math.max(1, Math.ceil(bh*pxPerUnit));

  const off = document.createElement('canvas');
  off.width = rw; off.height = rh;
  const octx = off.getContext('2d');
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, rw, rh);
  octx.translate(-bx*pxPerUnit, -by*pxPerUnit);
  octx.scale(pxPerUnit, pxPerUnit);

  const savedCtx = ctx;
  try{
    ctx = octx;
    scopeObjects.forEach(o => {
      if(o.type === 'fill' || o.type === 'image') return; // don't let existing fills or reference images block a new fill
      drawObject(o, false, false);
    });
  } finally {
    ctx = savedCtx; // must always restore, even if a draw call above throws
  }

  const imgData = octx.getImageData(0, 0, rw, rh);
  const data = imgData.data;

  const startPx = Math.floor((worldX-bx)*pxPerUnit);
  const startPy = Math.floor((worldY-by)*pxPerUnit);
  if(startPx < 0 || startPx >= rw || startPy < 0 || startPy >= rh){
    showToast('Click inside the selected shape to fill it.', true);
    return;
  }
  if(!isNearWhitePixel(data, (startPy*rw+startPx)*4)){
    showToast("Click inside a shape to fill it, not on its outline.", true);
    return;
  }

  const visited = new Uint8Array(rw*rh);
  const stack = [startPx, startPy];
  visited[startPy*rw+startPx] = 1;
  let minPX=startPx, maxPX=startPx, minPY=startPy, maxPY=startPy;
  let touchedEdge = false;

  while(stack.length){
    const py = stack.pop(), px = stack.pop();
    if(px === 0 || px === rw-1 || py === 0 || py === rh-1) touchedEdge = true;
    if(px < minPX) minPX = px; if(px > maxPX) maxPX = px;
    if(py < minPY) minPY = py; if(py > maxPY) maxPY = py;
    const candidates = [px+1,py, px-1,py, px,py+1, px,py-1];
    for(let i = 0; i < candidates.length; i += 2){
      const nx = candidates[i], ny = candidates[i+1];
      if(nx < 0 || nx >= rw || ny < 0 || ny >= rh) continue;
      const vIdx = ny*rw+nx;
      if(visited[vIdx]) continue;
      if(isNearWhitePixel(data, vIdx*4)){
        visited[vIdx] = 1;
        stack.push(nx, ny);
      }
    }
  }

  if(touchedEdge){
    showToast("This shape isn't fully closed, so it won't fill — check for a small gap in its outline.", true);
    return;
  }

  const pw = maxPX-minPX+1, ph = maxPY-minPY+1;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = pw; maskCanvas.height = ph;
  const mctx = maskCanvas.getContext('2d');
  const maskData = mctx.createImageData(pw, ph);
  for(let y = 0; y < ph; y++){
    for(let x = 0; x < pw; x++){
      if(visited[(minPY+y)*rw + (minPX+x)]){
        const pi = (y*pw+x)*4;
        maskData.data[pi] = 255; maskData.data[pi+1] = 255; maskData.data[pi+2] = 255; maskData.data[pi+3] = 255;
      }
    }
  }
  mctx.putImageData(maskData, 0, 0);

  const fillObj = {
    id: idOf(), type: 'fill',
    x: bx + minPX/pxPerUnit, y: by + minPY/pxPerUnit,
    w: pw/pxPerUnit, h: ph/pxPerUnit,
    maskSrc: maskCanvas.toDataURL('image/png'),
    color: currentColor,
    layerId: activeLayerId
  };
  // make the fill part of the shape: same group as what it fills
  let fillGid = scopeObjects.find(o => o.groupId)?.groupId;
  if(!fillGid){ fillGid = newGroupId(); scopeObjects.forEach(o => { o.groupId = fillGid; }); }
  fillObj.groupId = fillGid;
  // remove any earlier fill occupying (roughly) the same area, so re-filling
  // a region cleanly replaces the old color instead of stacking under it
  objects = objects.filter(o => !(o.type === 'fill' && rectsOverlap(o, fillObj)));
  objects.push(fillObj); // on top of everything — the mask has no pixels where a stroke was, so outlines still show through
  // deliberately leave the current selection and the Fill tool active, so
  // filling several regions of the same shape/group in a row needs no reselecting
  pushHistory();
  render();
 } catch(err){
   console.error('Fill failed', err);
   showToast("Something went wrong while filling — please try again.", true);
 }
}

// ---------- background ----------
const BG_PRESETS = {
  light: { bg: '#eeece6', dot: '#c9c6bc' },
  dark:  { bg: '#1c1d21', dot: '#35363c' }
};
function hexToRgbArr(hex){
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbArrToHex(a){
  return '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
// Grid dots for a custom background: nudge the background toward black (if it's
// light) or white (if it's dark) so they stay visible but subtle.
function dotColorFor(hex){
  const [r, g, b] = hexToRgbArr(hex);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  const mix = (c) => lum > 0.5 ? c * 0.86 : c + (255 - c) * 0.14;
  return rgbArrToHex([mix(r), mix(g), mix(b)]);
}
function effectiveBackground(){
  if(bgMode === 'custom' && bgColor) return { bg: bgColor, dot: dotColorFor(bgColor) };
  return BG_PRESETS[bgMode] || BG_PRESETS.light;
}
function applyBackground(){
  const { bg, dot } = effectiveBackground();
  const root = document.documentElement;
  root.style.setProperty('--bg', bg);
  root.style.setProperty('--dot', dot);
  root.setAttribute('data-theme', bgMode === 'dark' ? 'dark' : 'light');
}
// Used whenever a board's saved data is loaded (autosave, library, file import).
// Anything missing or malformed falls back to the light preset.
function setBackgroundFrom(data){
  const mode = (data && ['light', 'dark', 'custom'].includes(data.bgMode)) ? data.bgMode : 'light';
  const color = (data && typeof data.bgColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(data.bgColor)) ? data.bgColor : null;
  bgMode = (mode === 'custom' && !color) ? 'light' : mode;
  bgColor = color;
  applyBackground();
  syncBackgroundUI();
}

const bgColorInput = document.getElementById('bgColorInput');
function syncBackgroundUI(){
  document.querySelectorAll('#bgModeToggle .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === bgMode);
  });
  bgColorInput.value = effectiveBackground().bg;
}
document.querySelectorAll('#bgModeToggle .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.value;
    // first time on Custom: start from whatever is showing now, so nothing jumps
    if(mode === 'custom' && !bgColor) bgColor = effectiveBackground().bg;
    bgMode = mode;
    applyBackground();
    syncBackgroundUI();
    syncGridUI();
    save();
    render();
  });
});
bgColorInput.addEventListener('input', (e) => {
  // picking any color switches to Custom automatically
  bgColor = e.target.value;
  bgMode = 'custom';
  applyBackground();
  document.querySelectorAll('#bgModeToggle .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === 'custom');
  });
  syncGridUI();
  save();
  render();
});

// ---------- grid settings ----------
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const gridColorInput = document.getElementById('gridColorInput');

settingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  closeShapesPanel();
  closeBoardsPanel();
  closeLayersPanel();
  settingsPanel.classList.toggle('show');
  settingsBtn.classList.toggle('active', settingsPanel.classList.contains('show'));
});
document.addEventListener('click', (e) => {
  if(!settingsPanel.contains(e.target) && e.target !== settingsBtn){
    settingsPanel.classList.remove('show');
    settingsBtn.classList.remove('active');
  }
});

function syncGridUI(){
  document.querySelectorAll('#gridStyleToggle .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === gridStyle);
  });
  const styles = getComputedStyle(document.documentElement);
  gridColorInput.value = gridColor || rgbToHex(styles.getPropertyValue('--dot').trim());
}
function rgbToHex(c){
  // accepts an already-hex value or falls back to a neutral gray
  if(/^#/.test(c)) return c;
  return '#c9c6bc';
}

document.querySelectorAll('#gridStyleToggle .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    gridStyle = btn.dataset.value;
    syncGridUI();
    save();
    render();
  });
});
gridColorInput.addEventListener('input', (e) => {
  gridColor = e.target.value;
  save();
  render();
});



// fade hint after a bit
setTimeout(() => {
  const h = document.getElementById('hint');
  if(!h){ console.warn('hint element missing when trying to fade it'); return; }
  h.style.transition = 'opacity .6s';
  h.style.opacity = '0';
  setTimeout(()=> h.remove(), 700);
}, 6000);

// ---------- init ----------
applyBackground();   // default (light) in case there's no saved board yet
load();              // restores a saved board's background, if it has one
loadShapes();
loadBoardsLibrary();
boardNameInput.value = currentBoardName;
updateTitle();
history = [snapshot()];
historyIndex = 0;
resize();
setTool('select');
updateZoomLabel();
updateHistoryButtons();
syncGridUI();
syncBackgroundUI();