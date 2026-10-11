// ---------- standard shapes ----------
// Every non-rectangle/ellipse shape is just a polygon in unit coordinates
// (0..1 across its bounding box). They are stored on the board as
// { type:'shape', kind:'star', x, y, w, h, ... } so resizing, rotating,
// fills, dashes and text labels all work exactly like rectangles do.
// To add a new shape: add one line to SHAPE_DEFS below. Nothing else needed.

function normalizePoly(pts){
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  pts.forEach(p => { minX=Math.min(minX,p[0]); minY=Math.min(minY,p[1]); maxX=Math.max(maxX,p[0]); maxY=Math.max(maxY,p[1]); });
  const w = (maxX-minX) || 1, h = (maxY-minY) || 1;
  return pts.map(p => [(p[0]-minX)/w, (p[1]-minY)/h]);
}
function regularPoly(n, startDeg){
  const pts = [];
  for(let i = 0; i < n; i++){
    const a = (startDeg + 360*i/n) * Math.PI/180;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return normalizePoly(pts);
}
function starPoly(points, innerRatio){
  const pts = [];
  for(let i = 0; i < points*2; i++){
    const r = i % 2 === 0 ? 1 : innerRatio;
    const a = (-90 + 180*i/points) * Math.PI/180;
    pts.push([r*Math.cos(a), r*Math.sin(a)]);
  }
  return normalizePoly(pts);
}
function heartPoly(){
  const pts = [];
  for(let i = 0; i < 60; i++){
    const t = Math.PI*2*i/60;
    pts.push([16*Math.pow(Math.sin(t),3),
      -(13*Math.cos(t) - 5*Math.cos(2*t) - 2*Math.cos(3*t) - Math.cos(4*t))]);
  }
  return normalizePoly(pts);
}

// kind: id stored on the object · label: tooltip · pts: unit polygon
// (rect and ellipse are real object types with their own drawing code)
const SHAPE_DEFS = [
  { kind:'rect',          label:'Rectangle' },
  { kind:'ellipse',       label:'Ellipse' },
  { kind:'triangle',      label:'Triangle',        pts:[[.5,0],[1,1],[0,1]] },
  { kind:'rtriangle',     label:'Right triangle',  pts:[[0,0],[1,1],[0,1]] },
  { kind:'diamond',       label:'Diamond',         pts:[[.5,0],[1,.5],[.5,1],[0,.5]] },
  { kind:'parallelogram', label:'Parallelogram',   pts:[[.25,0],[1,0],[.75,1],[0,1]] },
  { kind:'trapezoid',     label:'Trapezoid',       pts:[[.2,0],[.8,0],[1,1],[0,1]] },
  { kind:'pentagon',      label:'Pentagon',        pts:regularPoly(5, -90) },
  { kind:'hexagon',       label:'Hexagon',         pts:regularPoly(6, 0) },
  { kind:'octagon',       label:'Octagon',         pts:regularPoly(8, 22.5) },
  { kind:'star',          label:'Star',            pts:starPoly(5, 0.4) },
  { kind:'heart',         label:'Heart',           pts:heartPoly() },
  { kind:'plus',          label:'Cross',           pts:[[.35,0],[.65,0],[.65,.35],[1,.35],[1,.65],[.65,.65],[.65,1],[.35,1],[.35,.65],[0,.65],[0,.35],[.35,.35]] },
  { kind:'arrow',         label:'Block arrow',     pts:[[0,.3],[.6,.3],[.6,0],[1,.5],[.6,1],[.6,.7],[0,.7]] },
  { kind:'chevron',       label:'Chevron',         pts:[[0,0],[.6,0],[1,.5],[.6,1],[0,1],[.4,.5]] },
  { kind:'bubble',        label:'Speech bubble',   pts:[[0,0],[1,0],[1,.75],[.45,.75],[.2,1],[.25,.75],[0,.75]] },
];
const SHAPE_POLYS = {};
SHAPE_DEFS.forEach(d => { if(d.pts) SHAPE_POLYS[d.kind] = d.pts; });
const SHAPE_LABELS = {};
SHAPE_DEFS.forEach(d => { SHAPE_LABELS[d.kind] = d.label; });
const SHAPE_TOOLS = ['rect', 'ellipse', 'shape']; // tools that belong to the Shapes tab

// even-odd point-in-polygon test, in the shape's unit space
function pointInUnitPoly(pts, u, v){
  let inside = false;
  for(let i = 0, j = pts.length - 1; i < pts.length; j = i++){
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    if(((yi > v) !== (yj > v)) && (u < (xj - xi) * (v - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pointInShape(o, lx, ly){
  const pts = SHAPE_POLYS[o.kind];
  if(!pts || !o.w || !o.h) return false;
  return pointInUnitPoly(pts, (lx - o.x) / o.w, (ly - o.y) / o.h);
}

// ---------- the "Shapes" toolbar tab + flyout ----------
let currentShapeKind = 'triangle'; // the polygon kind used when tool === 'shape'
let shapeChoice = 'rect';          // what the Shapes button currently represents

function shapeIconSVG(kind){
  const S = 18, O = 3;
  let inner;
  if(kind === 'rect') inner = '<rect x="3.5" y="6" width="17" height="12" rx="1.5"/>';
  else if(kind === 'ellipse') inner = '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>';
  else {
    const pts = (SHAPE_POLYS[kind] || []).map(p => (O + p[0]*S).toFixed(2) + ',' + (O + p[1]*S).toFixed(2)).join(' ');
    inner = '<polygon points="' + pts + '"/>';
  }
  return '<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">' + inner + '</g>';
}

const shapeToolBtn = document.getElementById('shapeToolBtn');
const shapeFlyout = document.createElement('div');
shapeFlyout.className = 'shape-flyout';
shapeFlyout.id = 'shapeFlyout';
SHAPE_DEFS.forEach(d => {
  const b = document.createElement('button');
  b.className = 'shape-pick';
  b.dataset.kind = d.kind;
  b.title = d.label;
  b.innerHTML = '<svg viewBox="0 0 24 24">' + shapeIconSVG(d.kind) + '</svg>';
  b.addEventListener('click', (e) => { e.stopPropagation(); chooseShape(d.kind); });
  shapeFlyout.appendChild(b);
});
document.body.appendChild(shapeFlyout);

function refreshShapeButton(){
  const icon = document.getElementById('shapeToolIcon');
  if(icon) icon.innerHTML = shapeIconSVG(shapeChoice);
  shapeFlyout.querySelectorAll('.shape-pick').forEach(b => b.classList.toggle('active', b.dataset.kind === shapeChoice));
}
function closeShapeFlyout(){ shapeFlyout.classList.remove('show'); }
function openShapeFlyout(){
  const r = shapeToolBtn.getBoundingClientRect();
  shapeFlyout.style.left = (r.right + 10) + 'px';
  shapeFlyout.style.top = Math.max(8, Math.min(r.top - 8, window.innerHeight - 200)) + 'px';
  shapeFlyout.classList.add('show');
}
function chooseShape(kind){
  shapeChoice = kind;
  if(kind === 'rect' || kind === 'ellipse'){
    setTool(kind);
  } else {
    currentShapeKind = kind;
    setTool('shape');
  }
  refreshShapeButton();
  closeShapeFlyout();
}
// called from setTool so keyboard shortcuts (R / O) keep the button in sync
function noteShapeTool(t){
  if(t === 'rect' || t === 'ellipse'){ shapeChoice = t; refreshShapeButton(); }
  else if(t === 'shape'){ shapeChoice = currentShapeKind; refreshShapeButton(); }
  if(!SHAPE_TOOLS.includes(t)) closeShapeFlyout();
}

shapeToolBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if(shapeFlyout.classList.contains('show')){ closeShapeFlyout(); return; }
  // activate the last-used shape right away, and offer the rest
  if(!SHAPE_TOOLS.includes(tool)) chooseShapeNoClose(shapeChoice);
  openShapeFlyout();
});
function chooseShapeNoClose(kind){
  if(kind === 'rect' || kind === 'ellipse') setTool(kind);
  else { currentShapeKind = kind; setTool('shape'); }
  refreshShapeButton();
}
document.addEventListener('click', (e) => {
  if(!shapeFlyout.contains(e.target) && e.target !== shapeToolBtn && !shapeToolBtn.contains(e.target)) closeShapeFlyout();
});
window.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeShapeFlyout(); });
refreshShapeButton();