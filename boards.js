function save(){
  try{
    localStorage.setItem('miroclone-board-v1', JSON.stringify({objects, panX, panY, scale, gridStyle, gridColor, currentBoardName, activeBoardId, layers, activeLayerId}));
  }catch(e){ /* storage unavailable, fail silently */ }
}
function load(){
  try{
    const raw = localStorage.getItem('miroclone-board-v1');
    if(raw){
      const data = JSON.parse(raw);
      objects = data.objects || [];
      panX = (typeof data.panX === 'number' && isFinite(data.panX)) ? data.panX : 0;
      panY = (typeof data.panY === 'number' && isFinite(data.panY)) ? data.panY : 0;
      scale = (typeof data.scale === 'number' && isFinite(data.scale) && data.scale > 0)
        ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, data.scale))
        : 1;
      gridStyle = data.gridStyle || 'dots';
      gridColor = data.gridColor || null;
      currentBoardName = data.currentBoardName || 'Untitled board';
      activeBoardId = data.activeBoardId || null;
      layers = (Array.isArray(data.layers) && data.layers.length) ? data.layers : [{ id:'layer-1', name:'Layer 1', visible:true, locked:false }];
      activeLayerId = data.activeLayerId || layers[layers.length-1].id;
      nextLayerNum = layers.length + 1;
      objects.forEach(o => {
        if(o.type === 'line' && !o.points){
          o.points = [{x:o.x1, y:o.y1}, {x:o.x2, y:o.y2}];
          delete o.x1; delete o.y1; delete o.x2; delete o.y2;
        }
      });
      ensureLayerIntegrity();
      let maxId = 0;
      objects.forEach(o => { if(o.id > maxId) maxId = o.id; });
      nextId = maxId + 1;
    }
  }catch(e){ objects = []; }
}
// ---------- board name ----------
const boardNameInput = document.getElementById('boardNameInput');
boardNameInput.addEventListener('input', () => {
  currentBoardName = boardNameInput.value;
});
boardNameInput.addEventListener('blur', () => {
  if(!boardNameInput.value.trim()){
    boardNameInput.value = 'Untitled board';
  }
  currentBoardName = boardNameInput.value;
  save();
  // keep the library entry's name in sync if this board was opened from (or saved to) it
  if(activeBoardId){
    const entry = savedBoards.find(b => b.boardId === activeBoardId);
    if(entry && entry.name !== currentBoardName){
      entry.name = currentBoardName;
      persistBoardsLibrary();
    }
  }
});
boardNameInput.addEventListener('keydown', (e) => {
  e.stopPropagation(); // don't let tool shortcuts (P, R, etc.) fire while typing a name
  if(e.key === 'Enter') boardNameInput.blur();
  if(e.key === 'Escape') boardNameInput.blur();
});

// ---------- saved boards library ----------
let savedBoards = [];
function loadBoardsLibrary(){
  try{
    const raw = localStorage.getItem('miroclone-boards-v1');
    savedBoards = raw ? JSON.parse(raw) : [];
  }catch(e){ savedBoards = []; }
}
function persistBoardsLibrary(){
  try{ localStorage.setItem('miroclone-boards-v1', JSON.stringify(savedBoards)); }catch(e){ /* ignore */ }
}

// ---------- board file download / upload ----------
// `downloads` is a Claude-artifact-viewer capability (window.claude.use)
// and simply doesn't exist when this page is opened as a plain local
// file or on a normal web server — that's not an error, just a different
// environment. Either way, a standard Blob+<a download> works everywhere
// a real browser can run this page, so that's the fallback below.
let downloadsCap = null;
(async () => {
  try{
    if(window.claude && typeof window.claude.use === 'function'){
      downloadsCap = await window.claude.use('downloads');
    }
  }catch(e){ downloadsCap = null; }
  if(document.getElementById('boardsPanel').classList.contains('show')) renderBoardsPanel();
})();

function safeFileName(name){
  return (name || 'board').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'board';
}

function browserDownload(filename, textData){
  const blob = new Blob([textData], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportBoard(name, data){
  const payload = JSON.stringify({
    app: 'whiteboard',
    formatVersion: 1,
    name: name,
    exportedAt: new Date().toISOString(),
    gridStyle: data.gridStyle,
    gridColor: data.gridColor,
    layers: data.layers,
    activeLayerId: data.activeLayerId,
    objects: data.objects
  }, null, 2);
  const filename = safeFileName(name) + '.json';

  if(downloadsCap){
    try{
      await downloadsCap.save({ filename, data: payload });
      return;
    }catch(err){
      if(err && err.code === 'declined') return;
      console.error('Platform download failed, falling back to a plain browser download', err);
    }
  }
  try{
    browserDownload(filename, payload);
  }catch(err){
    console.error('Board download failed', err);
    alert("Couldn't download that board — please try again.");
  }
}

document.getElementById('exportBoardBtn').addEventListener('click', () => {
  exportBoard(currentBoardName, { objects, gridStyle, gridColor, layers, activeLayerId });
});

document.getElementById('importBoardBtn').addEventListener('click', () => {
  document.getElementById('importBoardFile').click();
});
document.getElementById('importBoardFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try{
      parsed = JSON.parse(reader.result);
    }catch(err){
      alert("That file isn't valid JSON.");
      e.target.value = '';
      return;
    }
    if(!parsed || !Array.isArray(parsed.objects)){
      alert("That file doesn't look like a board export.");
      e.target.value = '';
      return;
    }
    const importedName = (parsed.name && String(parsed.name).trim()) || file.name.replace(/\.json$/i, '') || 'Imported board';
    if(objects.length && !confirm('Import "' + importedName + '"? This replaces your current board — make sure anything you want to keep is already saved.')){
      e.target.value = '';
      return;
    }
    const importedObjects = parsed.objects;
    // migrate legacy line format (x1/y1/x2/y2) just in case an older export is loaded
    importedObjects.forEach(o => {
      if(o.type === 'line' && !o.points){
        o.points = [{x:o.x1, y:o.y1}, {x:o.x2, y:o.y2}];
        delete o.x1; delete o.y1; delete o.x2; delete o.y2;
      }
    });
    objects = importedObjects;
    gridStyle = parsed.gridStyle || 'dots';
    gridColor = parsed.gridColor || null;
    layers = (Array.isArray(parsed.layers) && parsed.layers.length) ? parsed.layers : [{ id:'layer-1', name:'Layer 1', visible:true, locked:false }];
    activeLayerId = parsed.activeLayerId || layers[layers.length-1].id;
    nextLayerNum = layers.length + 1;
    ensureLayerIntegrity();
    panX = 0; panY = 0; scale = 1;
    currentBoardName = importedName;
    activeBoardId = null; // not linked to any library entry until explicitly saved
    boardNameInput.value = currentBoardName;
    let maxId = 0;
    objects.forEach(o => { if(o.id > maxId) maxId = o.id; });
    nextId = maxId + 1;
    selectedId = null;
    history = [snapshot()];
    historyIndex = 0;
    updateHistoryButtons();
    syncGridUI();
    updateZoomLabel();
    refreshStylePanel();
    renderLayersPanel();
    save();
    render();
    closeBoardsPanel();
    e.target.value = '';
  };
  reader.onerror = () => {
    alert("Couldn't read that file.");
    e.target.value = '';
  };
  reader.readAsText(file);
});

// Renders a whole board's objects into one small thumbnail, reusing the
// same ctx-swap trick as makeThumbnail but fitting every object's combined bounds.
function makeBoardThumbnail(objs){
  const size = 48;
  const cnv = document.createElement('canvas');
  cnv.width = size; cnv.height = size;
  const savedGlobalCtx = ctx;
  try{
    ctx = cnv.getContext('2d');
    ctx.fillStyle = '#f2f0ea';
    ctx.fillRect(0, 0, size, size);
    if(objs.length){
      let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
      objs.forEach(o => {
        const b = boundsOf(o);
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x+b.w); maxY = Math.max(maxY, b.y+b.h);
      });
      const bw = Math.max(maxX-minX, 1), bh = Math.max(maxY-minY, 1);
      const pad = 5;
      const availW = size - pad*2, availH = size - pad*2;
      const s = Math.min(availW/bw, availH/bh);
      const ox = pad + (availW - bw*s)/2 - minX*s;
      const oy = pad + (availH - bh*s)/2 - minY*s;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(s, s);
      objs.forEach(o => drawObject(o, false, false));
      ctx.restore();
    }
  } finally {
    ctx = savedGlobalCtx; // must always restore, even if drawObject throws
  }
  return cnv;
}

function renderBoardsPanel(){
  const list = document.getElementById('boardsList');
  list.innerHTML = '';
  if(savedBoards.length === 0){
    const empty = document.createElement('div');
    empty.className = 'boards-empty';
    empty.textContent = 'No saved boards yet. Click "Save current board…" above to store this one.';
    list.appendChild(empty);
    return;
  }
  const sorted = [...savedBoards].sort((a,b) => b.updatedAt - a.updatedAt);
  sorted.forEach(entry => {
    const row = document.createElement('div');
    row.className = 'board-row';
    row.title = 'Click to open this board';
    const thumb = makeBoardThumbnail(entry.data.objects || []);
    thumb.className = 'board-thumb';
    row.appendChild(thumb);
    const name = document.createElement('div');
    name.className = 'board-name';
    name.textContent = entry.name;
    row.appendChild(name);
    const actions = document.createElement('div');
    actions.className = 'board-actions';
    const dlBtn = document.createElement('button');
    dlBtn.className = 'board-icon-btn';
    dlBtn.title = 'Download this board as a file';
    dlBtn.textContent = '⬇';
    dlBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      exportBoard(entry.name, entry.data);
    });
    actions.appendChild(dlBtn);
    const renameBtn = document.createElement('button');
    renameBtn.className = 'board-icon-btn';
    renameBtn.title = 'Rename';
    renameBtn.textContent = '✎';
    renameBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const newName = prompt('Rename board', entry.name);
      if(newName && newName.trim()){
        entry.name = newName.trim();
        persistBoardsLibrary();
        renderBoardsPanel();
      }
    });
    actions.appendChild(renameBtn);
    const delBtn = document.createElement('button');
    delBtn.className = 'board-icon-btn';
    delBtn.title = 'Delete';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if(confirm('Delete "' + entry.name + '"? This can\'t be undone.')){
        savedBoards = savedBoards.filter(b => b.boardId !== entry.boardId);
        persistBoardsLibrary();
        renderBoardsPanel();
      }
    });
    actions.appendChild(delBtn);
    row.appendChild(actions);
    row.addEventListener('click', () => openSavedBoard(entry));
    list.appendChild(row);
  });
}

function openSavedBoard(entry){
  if(objects.length && !confirm('Open "' + entry.name + '"? This replaces your current board — make sure anything you want to keep is already saved.')) return;
  objects = JSON.parse(JSON.stringify(entry.data.objects || []));
  gridStyle = entry.data.gridStyle || 'dots';
  gridColor = entry.data.gridColor || null;
  layers = (Array.isArray(entry.data.layers) && entry.data.layers.length) ? JSON.parse(JSON.stringify(entry.data.layers)) : [{ id:'layer-1', name:'Layer 1', visible:true, locked:false }];
  activeLayerId = entry.data.activeLayerId || layers[layers.length-1].id;
  nextLayerNum = layers.length + 1;
  ensureLayerIntegrity();
  panX = 0; panY = 0; scale = 1;
  currentBoardName = entry.name;
  activeBoardId = entry.boardId;
  boardNameInput.value = currentBoardName;
  let maxId = 0;
  objects.forEach(o => { if(o.id > maxId) maxId = o.id; });
  nextId = maxId + 1;
  selectedId = null;
  history = [snapshot()];
  historyIndex = 0;
  updateHistoryButtons();
  syncGridUI();
  updateZoomLabel();
  refreshStylePanel();
  renderLayersPanel();
  save();
  render();
  closeBoardsPanel();
}

const boardsBtn = document.getElementById('boardsBtn');
const boardsPanel = document.getElementById('boardsPanel');
function closeBoardsPanel(){
  boardsPanel.classList.remove('show');
  boardsBtn.classList.remove('active');
}
boardsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsPanel.classList.remove('show');
  settingsBtn.classList.remove('active');
  closeShapesPanel();
  closeLayersPanel();
  const opening = !boardsPanel.classList.contains('show');
  boardsPanel.classList.toggle('show', opening);
  boardsBtn.classList.toggle('active', opening);
  if(opening) renderBoardsPanel();
});
document.addEventListener('click', (e) => {
  if(!boardsPanel.contains(e.target) && e.target !== boardsBtn){
    closeBoardsPanel();
  }
});

document.getElementById('saveBoardBtn').addEventListener('click', () => {
  const name = prompt('Name this board:', currentBoardName || 'My board');
  if(!name || !name.trim()) return;
  const trimmed = name.trim();
  const data = { objects: JSON.parse(JSON.stringify(objects)), gridStyle, gridColor, layers: JSON.parse(JSON.stringify(layers)), activeLayerId };
  const existing = savedBoards.find(b => b.name === trimmed);
  if(existing){
    if(!confirm('A board named "' + trimmed + '" already exists. Overwrite it?')) return;
    existing.data = data;
    existing.updatedAt = Date.now();
    activeBoardId = existing.boardId;
  } else {
    const newEntry = { boardId: 'board_' + Date.now() + '_' + Math.floor(Math.random()*1000), name: trimmed, updatedAt: Date.now(), data };
    savedBoards.push(newEntry);
    activeBoardId = newEntry.boardId;
  }
  currentBoardName = trimmed;
  boardNameInput.value = trimmed;
  save();
  persistBoardsLibrary();
  renderBoardsPanel();
});