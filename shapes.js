// ---------- saved shapes library ----------
let savedShapes = [];
function loadShapes(){
  try{
    const raw = localStorage.getItem('miroclone-shapes-v1');
    savedShapes = raw ? JSON.parse(raw) : [];
  }catch(e){ savedShapes = []; }
}
function saveShapesToStorage(){
  try{ localStorage.setItem('miroclone-shapes-v1', JSON.stringify(savedShapes)); }catch(e){ /* ignore */ }
}

// Renders an object into a small standalone thumbnail canvas by temporarily
// pointing the shared `ctx` at an offscreen canvas and reusing drawObject.
function makeThumbnail(obj){
  const size = 48;
  const cnv = document.createElement('canvas');
  cnv.width = size; cnv.height = size;
  const savedGlobalCtx = ctx;
  try{
    ctx = cnv.getContext('2d');
    ctx.fillStyle = '#f2f0ea';
    ctx.fillRect(0, 0, size, size);
    const b = boundsOf(obj);
    const bw = Math.max(b.w, 1), bh = Math.max(b.h, 1);
    const pad = 7;
    const availW = size - pad*2, availH = size - pad*2;
    const s = Math.min(availW/bw, availH/bh, 6);
    const ox = pad + (availW - bw*s)/2 - b.x*s;
    const oy = pad + (availH - bh*s)/2 - b.y*s;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    drawObject(obj, false, false);
    ctx.restore();
  } finally {
    ctx = savedGlobalCtx; // must always restore, even if drawObject throws
  }
  return cnv;
}

function renderShapesPanel(){
  const grid = document.getElementById('shapesGrid');
  grid.innerHTML = '';
  if(savedShapes.length === 0){
    const empty = document.createElement('div');
    empty.className = 'shapes-empty';
    empty.textContent = 'No saved shapes yet. Select something on the board and click the bookmark icon to save it here.';
    grid.appendChild(empty);
    return;
  }
  savedShapes.forEach(entry => {
    const cell = document.createElement('div');
    cell.className = 'shape-cell';
    cell.title = 'Click to add this shape to the board';
    cell.appendChild(makeThumbnail(entry.data));
    const del = document.createElement('button');
    del.className = 'shape-delete';
    del.textContent = '×';
    del.title = 'Delete this saved shape';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      savedShapes = savedShapes.filter(s => s.shapeId !== entry.shapeId);
      saveShapesToStorage();
      renderShapesPanel();
    });
    cell.appendChild(del);
    cell.addEventListener('click', () => stampShape(entry.data));
    grid.appendChild(cell);
  });
}

function stampShape(data){
  const clone = JSON.parse(JSON.stringify(data));
  const b = boundsOf(clone);
  const target = screenToWorld(window.innerWidth/2, window.innerHeight/2);
  const dx = target.x - (b.x + b.w/2);
  const dy = target.y - (b.y + b.h/2);
  moveObject(clone, dx, dy);
  clone.id = idOf();
  clone.layerId = activeLayerId;
  objects.push(clone);
  setTool('select');
  selectedId = clone.id;
  refreshStylePanel();
  pushHistory();
  closeShapesPanel();
  render();
}

const shapesBtn = document.getElementById('shapesBtn');
const shapesPanel = document.getElementById('shapesPanel');
function closeShapesPanel(){
  shapesPanel.classList.remove('show');
  shapesBtn.classList.remove('active');
}
shapesBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsPanel.classList.remove('show');
  settingsBtn.classList.remove('active');
  closeBoardsPanel();
  closeLayersPanel();
  const opening = !shapesPanel.classList.contains('show');
  shapesPanel.classList.toggle('show', opening);
  shapesBtn.classList.toggle('active', opening);
  if(opening) renderShapesPanel();
});
document.addEventListener('click', (e) => {
  if(!shapesPanel.contains(e.target) && e.target !== shapesBtn){
    closeShapesPanel();
  }
});

document.getElementById('saveShapeBtn').addEventListener('click', () => {
  const obj = objects.find(o => o.id === selectedId);
  if(!obj) return;
  const clone = JSON.parse(JSON.stringify(obj));
  delete clone.id;
  savedShapes.push({ shapeId: 'shape_' + Date.now() + '_' + Math.floor(Math.random()*1000), data: clone });
  saveShapesToStorage();
});