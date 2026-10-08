let layers = [{ id: 'layer-1', name: 'Layer 1', visible: true, locked: false }]; // array order = stacking order, index 0 = back
let activeLayerId = 'layer-1'; // new objects are tagged with this layer
let nextLayerNum = 2;
function layerOf(layerId){ return layers.find(l => l.id === layerId); }
function isLayerVisible(layerId){
  const l = layerOf(layerId);
  return l ? l.visible : true; // an orphaned layerId (shouldn't happen) stays visible rather than vanishing
}
function isLayerLocked(layerId){
  const l = layerOf(layerId);
  return l ? l.locked : false;
}
// Objects are drawn (and hit-tested) in layer order first, then their
// original relative order within that layer — without physically
// reordering the `objects` array itself.
function getPaintOrder(){
  return objects.slice().sort((a, b) => {
    const ia = layers.findIndex(l => l.id === a.layerId);
    const ib = layers.findIndex(l => l.id === b.layerId);
    return ia - ib;
  });
}
// Ensures every object has a valid layerId, for boards saved/imported
// before layers existed (or referencing a layer that's since been deleted).
function ensureLayerIntegrity(){
  if(!layers.length){
    layers = [{ id: 'layer-1', name: 'Layer 1', visible: true, locked: false }];
  }
  const validIds = new Set(layers.map(l => l.id));
  objects.forEach(o => {
    if(!o.layerId || !validIds.has(o.layerId)) o.layerId = layers[0].id;
  });
  if(!validIds.has(activeLayerId)) activeLayerId = layers[layers.length-1].id;
}
// ---------- layers panel ----------
const layersBtn = document.getElementById('layersBtn');
const layersPanel = document.getElementById('layersPanel');
function closeLayersPanel(){
  layersPanel.classList.remove('show');
  layersBtn.classList.remove('active');
}
layersBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsPanel.classList.remove('show');
  settingsBtn.classList.remove('active');
  closeShapesPanel();
  closeBoardsPanel();
  const opening = !layersPanel.classList.contains('show');
  layersPanel.classList.toggle('show', opening);
  layersBtn.classList.toggle('active', opening);
  if(opening) renderLayersPanel();
});
document.addEventListener('click', (e) => {
  if(!layersPanel.contains(e.target) && e.target !== layersBtn){
    closeLayersPanel();
  }
});

function renderLayersPanel(){
  const list = document.getElementById('layersList');
  list.innerHTML = '';
  const reversed = layers.slice().reverse(); // front-most layer shown at top of the list
  reversed.forEach((layer) => {
    const realIdx = layers.indexOf(layer);
    const row = document.createElement('div');
    row.className = 'layer-row' + (layer.id === activeLayerId ? ' active' : '') + (!layer.visible ? ' dimmed' : '');
    row.title = 'Click to make this the active layer — new shapes will be added here';

    const eyeBtn = document.createElement('button');
    eyeBtn.className = 'layer-icon-btn';
    eyeBtn.textContent = layer.visible ? '👁' : '🚫';
    eyeBtn.title = layer.visible ? 'Hide this layer' : 'Show this layer';
    eyeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      layer.visible = !layer.visible;
      deselectIfOnLayer(layer.id);
      pushHistory();
      renderLayersPanel();
      render();
    });
    row.appendChild(eyeBtn);

    const lockBtn = document.createElement('button');
    lockBtn.className = 'layer-icon-btn';
    lockBtn.textContent = layer.locked ? '🔒' : '🔓';
    lockBtn.title = layer.locked ? 'Unlock this layer' : 'Lock this layer';
    lockBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      layer.locked = !layer.locked;
      if(layer.locked) deselectIfOnLayer(layer.id);
      pushHistory();
      renderLayersPanel();
      render();
    });
    row.appendChild(lockBtn);

    const nameEl = document.createElement('div');
    nameEl.className = 'layer-name';
    nameEl.textContent = layer.name;
    nameEl.title = 'Double-click to rename';
    nameEl.addEventListener('dblclick', async (ev) => {
      ev.stopPropagation();
      const newName = await askText('Rename layer', layer.name);
      if(newName && newName.trim()){
        layer.name = newName.trim();
        save();
        renderLayersPanel();
      }
    });
    row.appendChild(nameEl);

    const reorder = document.createElement('div');
    reorder.className = 'layer-reorder';
    const upBtn = document.createElement('button');
    upBtn.textContent = '▲';
    upBtn.title = 'Move toward the front';
    upBtn.disabled = realIdx === layers.length - 1;
    upBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if(realIdx < layers.length - 1){
        [layers[realIdx], layers[realIdx+1]] = [layers[realIdx+1], layers[realIdx]];
        pushHistory();
        renderLayersPanel();
        render();
      }
    });
    const downBtn = document.createElement('button');
    downBtn.textContent = '▼';
    downBtn.title = 'Move toward the back';
    downBtn.disabled = realIdx === 0;
    downBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if(realIdx > 0){
        [layers[realIdx], layers[realIdx-1]] = [layers[realIdx-1], layers[realIdx]];
        pushHistory();
        renderLayersPanel();
        render();
      }
    });
    reorder.appendChild(upBtn);
    reorder.appendChild(downBtn);
    row.appendChild(reorder);

    const delBtn = document.createElement('button');
    delBtn.className = 'layer-icon-btn';
    delBtn.textContent = '×';
    delBtn.title = 'Delete this layer and everything on it';
    delBtn.disabled = layers.length <= 1;
    delBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if(layers.length <= 1) return;
      const count = objects.filter(o => o.layerId === layer.id).length;
      const msg = count > 0
        ? 'Delete "' + layer.name + '" and its ' + count + ' object' + (count === 1 ? '' : 's') + '? This can\'t be undone once you navigate away.'
        : 'Delete empty layer "' + layer.name + '"?';
      if(!confirm(msg)) return;
      objects = objects.filter(o => o.layerId !== layer.id);
      layers = layers.filter(l => l.id !== layer.id);
      if(activeLayerId === layer.id) activeLayerId = layers[layers.length-1].id;
      deselectIfMissing();
      pushHistory();
      renderLayersPanel();
      render();
    });
    row.appendChild(delBtn);

    row.addEventListener('click', () => {
      activeLayerId = layer.id;
      save();
      renderLayersPanel();
    });

    list.appendChild(row);
  });
}

function deselectIfOnLayer(layerId){
  if(multiSelectedIds.length){
    multiSelectedIds = multiSelectedIds.filter(id => {
      const obj = objects.find(o => o.id === id);
      return obj && obj.layerId !== layerId;
    });
  }
  if(!selectedId) return;
  const obj = objects.find(o => o.id === selectedId);
  if(obj && obj.layerId === layerId){
    selectedId = null;
    refreshStylePanel();
  }
}
function deselectIfMissing(){
  if(multiSelectedIds.length){
    multiSelectedIds = multiSelectedIds.filter(id => objects.find(o => o.id === id));
  }
  if(selectedId && !objects.find(o => o.id === selectedId)){
    selectedId = null;
    refreshStylePanel();
  }
}

document.getElementById('addLayerBtn').addEventListener('click', () => {
  const newLayer = { id: 'layer-' + Date.now() + '-' + Math.floor(Math.random()*1000), name: 'Layer ' + nextLayerNum++, visible: true, locked: false };
  layers.push(newLayer); // new layers arrive at the front
  activeLayerId = newLayer.id;
  pushHistory();
  renderLayersPanel();
  render();
});