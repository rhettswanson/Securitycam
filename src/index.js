import '@matterport/webcomponent';

/* ========================= Branding ========================= */
document.title = 'Ark Camera ID';
const BRAND_NAME  = 'ARK Security';
const PANEL_TITLE = 'Ark Camera Controls';

/* ========================= Config ========================= */
const CFG = {
  // Cafeteria cam position & optics
  position: { x: 45.259, y: 4.0, z: -9.45 },

  aspect: 16 / 9,
  hFovDeg: 32,
  near: 0.12,
  far: 19,
  nearApertureScale: 0.22,

  // Cafeteria sweep motion (indoor only)
  sweepDeg: 122,
  baseYawDeg: 93,
  tiltDeg: 10,
  yawSpeedDeg: 14,

  // FOV styling (shared)
  fovColor: 0x00ff00,
  fillOpacity: 0.08,
  edgeRadius: 0.016,
  baseEdgeRadius: 0.010,

  // Projector (indoor fallback floor)
  floorY: 0.4,
  footprintOpacity: 0.18,
  // ↓↓↓ BIG WIN: fewer rays
  projectorGrid: { u: 12, v: 8 },

  // Stylized body colors
  camText: '#f59e0b',
  camWhite: 0xffffff,
  cableBlack: 0x111111,
};

const DEBUG = true;

/* ===== Cafeteria gating ===== */
const BOUND_ROOM_ID = 'cdz3fkt38kae7tapstpt0eaeb';
const USE_SWEEP_GATE = true;
const USE_ROOM_GATE  = true;
const SHOW_IN_FLOORPLAN = true;

/* ===== Outdoor tag labels look like “Security Camera …” ===== */
const OUTDOOR_TAG_MATCH = /^\s*security\s*camera\b/i;

/* ================= Infrastructure ================= */
const rigs = new Map();           // id -> { id, label, type, cfg, refs, rebuild, applyTilt }
window._rigs = rigs;
function registerRig(entry) { rigs.set(entry.id, entry); }
const log = (...a) => { if (DEBUG) console.log('[SECAM]', ...a); };
const deg2rad = d => d * Math.PI / 180;

/* =================== Geometry helpers =================== */
function frustumDims(THREE, hFovDeg, aspect, dist) {
  const h = deg2rad(hFovDeg);
  const v = 2 * Math.atan(Math.tan(h / 2) / aspect);
  return { halfW: Math.tan(h / 2) * dist, halfH: Math.tan(v / 2) * dist, dist };
}

function tubeBetween(THREE, a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len <= 1e-6) return new THREE.Object3D();
  const geom = new THREE.CylinderGeometry(radius, radius, len, 12, 1, true);
  const mesh = new THREE.Mesh(geom, material);
  const up = new THREE.Vector3(0, 1, 0);
  mesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  return mesh;
}

function buildTruncatedFrustum(THREE, cfg) {
  const near = Math.max(0.01, cfg.near);
  const far = Math.max(near + 0.01, cfg.far);
  const n = frustumDims(THREE, cfg.hFovDeg, (cfg.aspect || 16/9), near);
  const f = frustumDims(THREE, cfg.hFovDeg, (cfg.aspect || 16/9), far);
  const s = THREE.MathUtils.clamp((cfg.nearApertureScale || 1), 0.05, 1);
  const nHalfW = n.halfW * s, nHalfH = n.halfH * s;

  const group = new THREE.Group();

  const n0 = new THREE.Vector3(-nHalfW, -nHalfH, -near);
  const n1 = new THREE.Vector3( nHalfW, -nHalfH, -near);
  const n2 = new THREE.Vector3( nHalfW,  nHalfH, -near);
  const n3 = new THREE.Vector3(-nHalfW,  nHalfH, -near);

  const f0 = new THREE.Vector3(-f.halfW, -f.halfH, -far);
  const f1 = new THREE.Vector3( f.halfW, -f.halfH, -far);
  const f2 = new THREE.Vector3( f.halfW,  f.halfH, -far);
  const f3 = new THREE.Vector3(-f.halfW,  f.halfH, -far);

  const edgeMat = new THREE.MeshBasicMaterial({
    color: (cfg.fovColor != null ? cfg.fovColor : 0x00ff00),
    transparent: true,
    opacity: 0.95,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  group.add(tubeBetween(THREE, n0, f0, (cfg.edgeRadius || 0.016), edgeMat));
  group.add(tubeBetween(THREE, n1, f1, (cfg.edgeRadius || 0.016), edgeMat));
  group.add(tubeBetween(THREE, n2, f2, (cfg.edgeRadius || 0.016), edgeMat));
  group.add(tubeBetween(THREE, n3, f3, (cfg.edgeRadius || 0.016), edgeMat));

  group.add(tubeBetween(THREE, n0, n1, (cfg.baseEdgeRadius || 0.010), edgeMat));
  group.add(tubeBetween(THREE, n1, n2, (cfg.baseEdgeRadius || 0.010), edgeMat));
  group.add(tubeBetween(THREE, n2, n3, (cfg.baseEdgeRadius || 0.010), edgeMat));
  group.add(tubeBetween(THREE, n3, n0, (cfg.baseEdgeRadius || 0.010), edgeMat));

  group.add(tubeBetween(THREE, f0, f1, (cfg.baseEdgeRadius || 0.010), edgeMat));
  group.add(tubeBetween(THREE, f1, f2, (cfg.baseEdgeRadius || 0.010), edgeMat));
  group.add(tubeBetween(THREE, f2, f3, (cfg.baseEdgeRadius || 0.010), edgeMat));
  group.add(tubeBetween(THREE, f3, f0, (cfg.baseEdgeRadius || 0.010), edgeMat));

  // side faces
  const pos = [];
  const quads = [[n0,n1,f1,f0],[n1,n2,f2,f1],[n2,n3,f3,f2],[n3,n0,f0,f3]];
  for (var i=0;i<quads.length;i++){
    const q = quads[i], a=q[0], b=q[1], c=q[2], d=q[3];
    pos.push(a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z);
    pos.push(a.x,a.y,a.z, c.x,c.y,c.z, d.x,d.y,d.z);
  }
  // near cap
  pos.push(n0.x,n0.y,n0.z, n1.x,n1.y,n1.z, n2.x,n2.y,n2.z);
  pos.push(n0.x,n0.y,n0.z, n2.x,n2.y,n2.z, n3.x,n3.y,n3.z);

  const faces = new THREE.BufferGeometry();
  faces.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  faces.computeVertexNormals();
  const fillMat = new THREE.MeshBasicMaterial({
    color: (cfg.fovColor != null ? cfg.fovColor : 0x00ff00),
    transparent: true,
    opacity: (cfg.fillOpacity != null ? cfg.fillOpacity : 0.08),
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(faces, fillMat);
  group.add(mesh);

  group.userData = { nearRect: [n0,n1,n2,n3], farRect: [f0,f1,f2,f3] };
  return group;
}

/* ============ Stylized camera body (cafeteria) ============ */
function makeSideDecalTexture(THREE) {
  const w = 512, h = 256;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,w,h);
  ctx.fillStyle = '#bfe6f0'; ctx.fillRect(0,0,w,Math.round(h*0.62));
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath(); ctx.moveTo(70,0); ctx.lineTo(118,0); ctx.lineTo(54,h); ctx.lineTo(6,h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = CFG.camText; ctx.font = 'bold 38px system-ui, Arial, sans-serif';
  ctx.textBaseline = 'middle'; ctx.fillText(BRAND_NAME, 160, Math.round(h*0.38));
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 8; tex.needsUpdate = true;
  return tex;
}

function buildStylizedCamera(THREE) {
  const g = new THREE.Group();
  const L = 0.44, wBack = 0.26, hBack = 0.16, wFront = 0.20, hFront = 0.13;
  const zF = -L/2, zB = L/2;
  const quad = (a,b,c,d,mat) => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array([
      a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z, a.x,a.y,a.z, c.x,c.y,c.z, d.x,d.y,d.z
    ]),3));
    geom.computeVertexNormals(); return new THREE.Mesh(geom, mat);
  };
  const mWhite = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  const mBlue  = new THREE.MeshLambertMaterial({ color: 0xbfe6f0 });
  const mDecal = new THREE.MeshBasicMaterial({ map: makeSideDecalTexture(THREE) });

  g.add(quad(new THREE.Vector3(-wFront/2,-hFront/2,zF), new THREE.Vector3(wFront/2,-hFront/2,zF),
             new THREE.Vector3(wFront/2,hFront/2,zF),  new THREE.Vector3(-wFront/2,hFront/2,zF), mWhite));
  g.add(quad(new THREE.Vector3(-wBack/2,-hBack/2,zB),  new THREE.Vector3(wBack/2,-hBack/2,zB),
             new THREE.Vector3(wBack/2,hBack/2,zB),   new THREE.Vector3(-wBack/2,hBack/2,zB),  mWhite));
  g.add(quad(new THREE.Vector3(-wBack/2,hBack/2,zB),   new THREE.Vector3(wBack/2,hBack/2,zB),
             new THREE.Vector3(wFront/2,hFront/2,zF),  new THREE.Vector3(-wFront/2,hFront/2,zF), mBlue));
  g.add(quad(new THREE.Vector3(-wBack/2,-hBack/2,zB),  new THREE.Vector3(wBack/2,-hBack/2,zB),
             new THREE.Vector3(wFront/2,-hFront/2,zF), new THREE.Vector3(-wFront/2,-hFront/2,zF), mWhite));
  g.add(quad(new THREE.Vector3(wBack/2,-hBack/2,zB),   new THREE.Vector3(wBack/2,hBack/2,zB),
             new THREE.Vector3(wFront/2,hFront/2,zF),  new THREE.Vector3(wFront/2,-hFront/2,zF), mWhite));

  // left decal
  {
    const a = new THREE.Vector3(-wBack/2,-hBack/2, zB);
    const b = new THREE.Vector3(-wBack/2, hBack/2, zB);
    const c = new THREE.Vector3(-wFront/2, hFront/2, zF);
    const d = new THREE.Vector3(-wFront/2,-hFront/2, zF);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array([
      a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z, a.x,a.y,a.z, c.x,c.y,c.z, d.x,d.y,d.z
    ]),3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array([0,1, 0,0, 1,0, 0,1, 1,0, 1,1]),2));
    geom.computeVertexNormals(); g.add(new THREE.Mesh(geom, mDecal));
  }

  // details…
  const lip = new THREE.Mesh(new THREE.BoxGeometry((wBack+wFront)/2*0.98, 0.014, L*0.88),
                             new THREE.MeshLambertMaterial({ color: 0xffffff }));
  lip.position.y = -Math.min(hBack,hFront)*0.40; lip.position.z = -L*0.05; g.add(lip);

  const bezel = new THREE.Mesh(new THREE.RingGeometry(0.058, 0.082, 32),
                               new THREE.MeshBasicMaterial({ color: 0xffffff, transparent:true, opacity:0.95 }));
  bezel.rotation.y = Math.PI; bezel.position.z = zF - 0.002; g.add(bezel);

  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.022, 24),
                                 new THREE.MeshLambertMaterial({ color: 0x222222 }));
  housing.rotation.x = Math.PI/2; housing.rotation.z = Math.PI/2; housing.position.z = zF - 0.018; g.add(housing);

  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.055, 24),
                              new THREE.MeshBasicMaterial({ color: 0x76ff76, transparent:true, opacity:0.35 }));
  lens.rotation.x = Math.PI/2; lens.rotation.z = Math.PI/2; lens.position.z = zF - 0.045; g.add(lens);

  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.04, 18, 14),
                              new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent:true, opacity:0.28 }));
  glow.position.z = zF - 0.028; g.add(glow);

  // arm + mount
  const white = new THREE.MeshLambertMaterial({ color: CFG.camWhite });
  const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.06), white);
  hinge.position.set(0, -hBack*0.60, -L*0.12); g.add(hinge);

  const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 16), white);
  arm1.rotation.z = -0.35; arm1.position.set(0.06, -hBack*0.95, -L*0.14); g.add(arm1);

  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), white);
  joint.position.set(0.11, -hBack*1.15, -L*0.12); g.add(joint);

  const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 16), white);
  arm2.rotation.z = 0.25; arm2.position.set(0.17, -hBack*1.30, -L*0.10); g.add(arm2);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.012, 24), white);
  base.position.set(0.20, -hBack*1.40, -L*0.08); g.add(base);

  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0.00, -hBack*0.30, -L*0.12),
    new THREE.Vector3(0.08, -hBack*0.95, -L*0.14),
    new THREE.Vector3(0.20, -hBack*1.37, -L*0.08)
  );
  const tube = new THREE.TubeGeometry(curve, 18, 0.0045, 10, false);
  const cable = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: CFG.cableBlack }));
  g.add(cable);

  return g;
}

/* =========== FOV-only rig (for outdoor cameras) =========== */
function makeFovOnlyRig(THREE, sceneObject, cfg, color) {
  const node = sceneObject.addNode();
  node.obj3D.visible = true; // always visible

  const pan = new THREE.Object3D();
  const tilt = new THREE.Object3D();
  pan.add(tilt); node.obj3D.add(pan);

  node.obj3D.position.set(cfg.position.x, cfg.position.y, cfg.position.z);
  pan.rotation.y  = deg2rad(cfg.yawDeg || 0);
  tilt.rotation.x = -deg2rad(cfg.tiltDeg || 10);

  const frustum = buildTruncatedFrustum(THREE, { ...CFG, ...cfg, fovColor: (color != null ? color : CFG.fovColor) });
  tilt.add(frustum);

  // projector mesh — BIG WIN: 12×8
  const u = 12, v = 8, tris = (u-1)*(v-1)*2;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(tris*9), 3));
  const mat = new THREE.MeshBasicMaterial({
    color: (color != null ? color : CFG.fovColor),
    transparent: true,
    opacity: CFG.footprintOpacity,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const projector = new THREE.Mesh(geom, mat);
  node.obj3D.add(projector);

  return { node, pan, tilt, frustum, projector, projectorU: u, projectorV: v };
}

/* ============================= UI ============================= */
function makePanel(selectedId) {
  var old = document.getElementById('fov-panel');
  if (old) old.remove();

  const wrap = document.createElement('div');
  wrap.id = 'fov-panel';
  wrap.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:rgba(0,0,0,.68);' +
    'color:#fff;padding:12px;border-radius:12px;font:14px/1.15 system-ui,Arial;width:240px;box-shadow:0 6px 18px rgba(0,0,0,.35);';
  document.body.appendChild(wrap);

  const title = document.createElement('div');
  title.style.cssText='font-weight:700;margin-bottom:8px;text-align:center;';
  title.textContent = PANEL_TITLE;
  wrap.appendChild(title);

  const pick = document.createElement('select');
  pick.style.cssText='width:100%;margin:0 0 8px 0;padding:6px;border-radius:8px;border:none;';
  rigs.forEach(r => {
    const o = document.createElement('option');
    o.value = r.id; o.textContent = r.label || r.id;
    if (selectedId && r.id === selectedId) o.selected = true;
    pick.appendChild(o);
  });
  wrap.appendChild(pick);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;gap:8px;';
  wrap.appendChild(grid);

  const valLine = (text) => {
    const d = document.createElement('div');
    d.textContent = text;
    d.style.cssText='grid-column:1 / span 3;text-align:center;font-weight:700;';
    grid.appendChild(d);
    return d;
  };

  function mountControls(rig) {
    grid.innerHTML = '';
    const cfg = rig.cfg;

    const row = (label, get, set, step, unit, min, max, decimals) => {
      decimals = (decimals == null ? 0 : decimals);
      const name = document.createElement('div'); name.textContent=label; name.style.cssText='align-self:center;';
      const mk=(txt,delta)=>{
        const b=document.createElement('button'); b.textContent=txt;
        b.style.cssText='background:#14b8a6;border:none;color:#001;font-weight:800;border-radius:10px;padding:8px 10px;cursor:pointer;';
        b.onclick=(e)=>{
          e.preventDefault();
          const v = Math.max(min, Math.min(max, +(get()+delta).toFixed(decimals)));
          set(v);
          val.textContent = get().toFixed(decimals) + unit;
        };
        return b;
      };
      const minus=mk('−',-step), plus=mk('+',step);
      const val = valLine(get().toFixed(decimals) + unit);
      grid.appendChild(name); grid.appendChild(minus); grid.appendChild(plus);
    };

    // shared optics
    row('HFOV',  ()=>cfg.hFovDeg, v=>{cfg.hFovDeg=v; rig.rebuild(); rig.refs.dirty = true;}, 1,'°',10,120);
    row('NEAR',  ()=>cfg.near,    v=>{cfg.near=v;    rig.rebuild(); rig.refs.dirty = true;}, 0.01,'',0.02,1,2);
    row('FAR',   ()=>cfg.far,     v=>{cfg.far=v;     rig.rebuild(); rig.refs.dirty = true;}, 1,'',5,120);

    if (rig.type === 'indoor') {
      row('SWEEP', ()=>CFG.sweepDeg,     v=>{CFG.sweepDeg=v;}, 2,'°',10,170);
      row('YAW',   ()=>CFG.baseYawDeg,   v=>{CFG.baseYawDeg=v;}, 1,'°',-180,180);
      row('TILT',  ()=>CFG.tiltDeg,      v=>{CFG.tiltDeg=v; rig.applyTilt();}, 1,'°',0,85);
      row('MaxDist', ()=>cfg.maxDistanceM || 25, v=>{ cfg.maxDistanceM=v; }, 1,'m',5,80);
    } else {
      // Outdoor: fixed position (no auto-pan), but aim with YAW/TILT
      row('YAW',   ()=>cfg.yawDeg || 0,  v=>{ cfg.yawDeg=v; rig.refs.pan.rotation.y = deg2rad(v); rig.refs.dirty = true; }, 1,'°',-180,180);
      row('TILT',  ()=>cfg.tiltDeg||10,  v=>{ cfg.tiltDeg=v; rig.applyTilt(); rig.refs.dirty = true; }, 1,'°',0,85);
      row('MaxDist', ()=>cfg.maxDistanceM || 35,
          v=>{ cfg.maxDistanceM=v; if ('maxDistanceM' in rig.refs) rig.refs.maxDistanceM = v; }, 1,'m',5,100);
    }
  }

  let current = rigs.get(selectedId) || rigs.values().next().value;
  if (current) mountControls(current);
  pick.onchange = () => { current = rigs.get(pick.value); if (current) mountControls(current); };

  const footer=document.createElement('div'); footer.style.cssText='display:flex;gap:8px;margin-top:10px;';
  const hide=document.createElement('button'); hide.textContent='Hide';
  hide.style.cssText='flex:1;background:#64748b;border:none;border-radius:10px;padding:10px;color:#fff;font-weight:800;';
  hide.onclick=(e)=>{e.preventDefault(); wrap.style.display = (wrap.style.display==='none')?'block':'none'; };
  footer.appendChild(hide); wrap.appendChild(footer);

  return { wrap, pick };
}
window._makePanel = makePanel;

/* ============================ Main ============================ */
const main = async () => {
  const viewer = document.querySelector('matterport-viewer');
  if (viewer) viewer.setAttribute('asset-base', '/Securitycam/');

  const mpSdk = await viewer.playingPromise;
  const THREE = window.THREE;

  await mpSdk.Mode.moveTo(mpSdk.Mode.Mode.INSIDE);

  const sceneObjs = await mpSdk.Scene.createObjects(1);
  const sceneObject = sceneObjs[0];

  const rootNode = sceneObject.addNode();
  rootNode.obj3D.visible = false;

  // lights for stylized head
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.6);
  const dir  = new THREE.DirectionalLight(0xffffff, 0.5);
  dir.position.set(1, 2, 1);
  rootNode.obj3D.add(hemi, dir);

  /* -------- Cafeteria rig (stylized) -------- */
  const panPivot  = new THREE.Object3D();
  const tiltPivot = new THREE.Object3D();
  panPivot.add(tiltPivot); rootNode.obj3D.add(panPivot);
  rootNode.obj3D.position.set(CFG.position.x, CFG.position.y, CFG.position.z);

  const head = buildStylizedCamera(THREE);
  tiltPivot.add(head);

  let frustumGroup = buildTruncatedFrustum(THREE, CFG);
  tiltPivot.add(frustumGroup);

  const applyTilt = () => { tiltPivot.rotation.x = -deg2rad(CFG.tiltDeg); };
  applyTilt();

  // indoor projector
  const projector = {
    u: CFG.projectorGrid.u, v: CFG.projectorGrid.v,
    geom: new THREE.BufferGeometry(),
    mat:  new THREE.MeshBasicMaterial({
      color: CFG.fovColor, transparent: true, opacity: CFG.footprintOpacity,
      side: THREE.DoubleSide, depthTest: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    }),
    mesh: null,
  };
  (function initProjector(){
    const tris  = (projector.u-1)*(projector.v-1)*2;
    projector.geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(tris*9), 3));
    projector.mesh = new THREE.Mesh(projector.geom, projector.mat);
    rootNode.obj3D.add(projector.mesh);
  })();

  // register cafeteria rig
  const cafeteriaCfg = { hFovDeg: CFG.hFovDeg, near: CFG.near, far: CFG.far, maxDistanceM: 25 };
  registerRig({
    id: 'cafeteria',
    label: 'Ark Cafeteria Cam',
    type: 'indoor',
    cfg: cafeteriaCfg,
    refs: { panPivot, tiltPivot, frustum: () => frustumGroup },
    rebuild: () => {
      tiltPivot.remove(frustumGroup);
      frustumGroup.traverse && frustumGroup.traverse(o => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
      CFG.hFovDeg = cafeteriaCfg.hFovDeg; CFG.near = cafeteriaCfg.near; CFG.far = cafeteriaCfg.far;
      frustumGroup = buildTruncatedFrustum(THREE, CFG);
      tiltPivot.add(frustumGroup);
      updateVisibility();
    },
    applyTilt: () => applyTilt(),
  });

  // start cafeteria node + panel immediately
  rootNode.start();
  makePanel('cafeteria');

  /* -------- Outdoor rigs from Mattertags -------- */
  function pickNum(text, re, d) {
    const m = text && text.match ? text.match(re) : null;
    return m ? parseFloat(m[1]) : d;
  }
  function parseOutdoorCfgFromTag(tag) {
    const label = (tag.label || '');
    const desc  = (tag.description || '');
    const txt = label + '\n' + desc;
    return {
      position: { x: tag.anchorPosition.x, y: tag.anchorPosition.y, z: tag.anchorPosition.z },
      hFovDeg:  pickNum(txt, /\bhfov\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 32),
      near:     pickNum(txt, /\bnear\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 0.12),
      far:      pickNum(txt, /\bfar\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 22),
      yawDeg:   pickNum(txt, /\byaw\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 0),
      tiltDeg:  pickNum(txt, /\btilt\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 10),
      maxDistanceM: pickNum(txt, /\bmaxdist\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 35),
      aspect: 16/9,
    };
  }

  async function getTagsWithTimeout(ms) {
    ms = (ms || 1500);
    try {
      if (mpSdk.Tag && mpSdk.Tag.data && mpSdk.Tag.data.subscribe) {
        const tagDataPromise = new Promise(resolve => {
          const unsub = mpSdk.Tag.data.subscribe(tags => {
            try {
              let arr = [];
              if (Array.isArray(tags)) arr = tags;
              else if (tags && typeof tags.toArray === 'function') arr = tags.toArray();
              else if (tags) arr = Object.values(tags);
              if (arr) { if (unsub) unsub(); resolve(arr); }
            } catch (e) { if (unsub) unsub(); resolve([]); }
          });
        });
        const timeout = new Promise(resolve => setTimeout(() => resolve(null), ms));
        const viaNew = await Promise.race([tagDataPromise, timeout]);
        if (viaNew) return viaNew;
      }
    } catch (e) {}
    try { return await mpSdk.Mattertag.getData(); } catch (e) { return []; }
  }

  async function initOutdoorGround(rig) {
    try {
      const origin = rig.node.obj3D.getWorldPosition(new THREE.Vector3());
      const hit = await mpSdk.Scene.raycast(
        { x: origin.x, y: origin.y, z: origin.z },
        { x: 0, y: -1, z: 0 },
        60
      );
      rig.groundY = (hit && hit.hit) ? hit.position.y : 0.0;
    } catch { rig.groundY = 0.0; }
  }

  async function spawnOutdoorCamsFromTags() {
    const tags = await getTagsWithTimeout();
    const camTags = tags.filter(t => OUTDOOR_TAG_MATCH.test(t.label || ''));
    let count = 0;
    for (let i=0;i<camTags.length;i++) {
      const t = camTags[i];
      const cfg = parseOutdoorCfgFromTag(t);
      const rig = makeFovOnlyRig(THREE, sceneObject, cfg, CFG.fovColor);
      await initOutdoorGround(rig);
      rig.node.start();

      const id = (t.sid || ('out-' + (i+1)));
      const label = (t.label || ('Outdoor ' + (i+1)));

      registerRig({
        id, label, type:'outdoor', cfg,
        refs: {
          node: rig.node, pan: rig.pan, tilt: rig.tilt,
          frustum: () => rig.frustum,
          projector: rig.projector,
          projectorU: rig.projectorU, projectorV: rig.projectorV,
          get groundY(){ return rig.groundY; },
          get maxDistanceM(){ return cfg.maxDistanceM || 35; },
          set maxDistanceM(v){ cfg.maxDistanceM = v; },
          dirty: true,   // compute once after spawn
          _busy: false,  // throttle async updates
        },
        rebuild: () => {
          const parent = rig.tilt;
          parent.remove(rig.frustum);
          if (rig.frustum && rig.frustum.traverse) {
            rig.frustum.traverse(o => { if (o.geometry && o.geometry.dispose) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
          }
          rig.frustum = buildTruncatedFrustum(THREE, { ...CFG, ...cfg });
          parent.add(rig.frustum);
        },
        applyTilt: () => { rig.tilt.rotation.x = -deg2rad(cfg.tiltDeg || 10); },
      });

      // add to UI dropdown
      try {
        const pick = document.querySelector('#fov-panel select');
        if (pick) {
          let exists = false;
          for (let j=0;j<pick.options.length;j++) if (pick.options[j].value === id) { exists = true; break; }
          if (!exists) {
            const o = document.createElement('option');
            o.value = id; o.textContent = label;
            pick.appendChild(o);
          }
        }
      } catch (e) {}

      count++;
    }
    log('Spawned', count, 'outdoor FOV rig(s)');
  }
  spawnOutdoorCamsFromTags().catch(e => console.warn('[SECAM] outdoor spawn error', e));

  /* --------------- Visibility + projectors --------------- */
  const viewerPos = new THREE.Vector3();
  mpSdk.Camera.pose.subscribe(p => {
    viewerPos.set(p.position.x, p.position.y, p.position.z);
  });

  let mode = mpSdk.Mode.Mode.INSIDE;
  mpSdk.Mode.current.subscribe(m => { mode = m; updateVisibility(); });

  // Room.current (for cafeteria gating)
  let currentRooms = new Set();
  mpSdk.Room.current.subscribe((payload) => {
    try {
      let list = [];
      if (Array.isArray(payload)) list = payload;
      else if (payload && typeof payload[Symbol.iterator] === 'function') list = Array.from(payload);
      else if (payload && Array.isArray(payload.ids)) list = payload.ids;
      currentRooms = new Set(list);
      updateVisibility();
    } catch (err) {
      console.warn('[SECAM] Room.current handler error', err);
    }
  });

  let currentSweepRoomId = null;
  mpSdk.Sweep.current.subscribe((sw) => {
    currentSweepRoomId = (sw && sw.roomInfo ? sw.roomInfo.id : null);
    updateVisibility();
  });

  async function raycastFirst(origin, direction, maxDist) {
    try {
      if (mpSdk.Scene && typeof mpSdk.Scene.raycast === 'function') {
        return await mpSdk.Scene.raycast(
          { x: origin.x, y: origin.y, z: origin.z },
          { x: direction.x, y: direction.y, z: direction.z },
          maxDist
        );
      }
    } catch (_) {}
    return null;
  }

  async function updateVisibility() {
    // Floorplan always allowed for cafeteria rig
    if (mode === mpSdk.Mode.Mode.FLOORPLAN && SHOW_IN_FLOORPLAN) {
      rootNode.obj3D.visible = true; return;
    }

    // room / sweep gating for cafeteria
    let inTargetRoom = true;
    if (USE_SWEEP_GATE && currentSweepRoomId) {
      inTargetRoom = (currentSweepRoomId === BOUND_ROOM_ID);
    } else if (USE_ROOM_GATE) {
      inTargetRoom = currentRooms.has(BOUND_ROOM_ID);
    }
    if (!inTargetRoom) { rootNode.obj3D.visible = false; return; }

    // distance gate (cafeteria)
    const camPos = rootNode.obj3D.getWorldPosition(new THREE.Vector3());
    const dist = camPos.distanceTo(viewerPos);
    const maxDist = rigs.get('cafeteria') && rigs.get('cafeteria').cfg ? (rigs.get('cafeteria').cfg.maxDistanceM || 25) : 25;
    if (dist > maxDist) { rootNode.obj3D.visible = false; return; }

    // simple LOS check toward far-plane center
    const fr = frustumGroup && frustumGroup.userData ? frustumGroup.userData.farRect : null;
    if (fr) {
      const centerLocal = new THREE.Vector3().add(fr[0]).add(fr[1]).add(fr[2]).add(fr[3]).multiplyScalar(0.25);
      const target = tiltPivot.localToWorld(centerLocal.clone());
      const dir = new THREE.Vector3().subVectors(target, viewerPos);
      const len = dir.length();
      if (len > 0.001) {
        dir.normalize();
        const hit = await raycastFirst(viewerPos, dir, len);
        const hitDist = (hit && typeof hit.distance === 'number') ? hit.distance : Number.POSITIVE_INFINITY;
        const blocked = (hit && hit.hit) && hitDist < (len - 0.05);
        if (blocked) { rootNode.obj3D.visible = false; return; }
      }
    }
    rootNode.obj3D.visible = true;
  }

  // --- Cafeteria projector (throttled ~6–7 Hz) ---
  let cafTimer = 0;
  let cafBusy = false;
  async function updateProjector() {
    if (cafBusy || !rootNode.obj3D.visible) { if (projector.mesh) projector.mesh.visible = rootNode.obj3D.visible; return; }
    cafBusy = true;

    const nearRect = frustumGroup.userData.nearRect;
    const farRect  = frustumGroup.userData.farRect;
    const u = projector.u, v = projector.v;

    const nearGrid = [], farGrid = [];
    for (let yi=0; yi<v; yi++){
      const ty = yi/(v-1);
      const nA = new THREE.Vector3().lerpVectors(nearRect[0], nearRect[3], ty);
      const nB = new THREE.Vector3().lerpVectors(nearRect[1], nearRect[2], ty);
      const fA = new THREE.Vector3().lerpVectors(farRect[0],  farRect[3],  ty);
      const fB = new THREE.Vector3().lerpVectors(farRect[1],  farRect[2],  ty);
      for (let xi=0; xi<u; xi++){
        const tx = xi/(u-1);
        nearGrid.push(new THREE.Vector3().lerpVectors(nA, nB, tx));
        farGrid .push(new THREE.Vector3().lerpVectors(fA, fB, tx));
      }
    }

    const worldPts = new Array(nearGrid.length);
    for (let i=0;i<nearGrid.length;i++){
      const nW = tiltPivot.localToWorld(nearGrid[i].clone());
      const fW = tiltPivot.localToWorld(farGrid[i].clone());
      const dir = new THREE.Vector3().subVectors(fW, nW);
      const len = dir.length(); if (len <= 1e-4) { projector.mesh.visible=false; cafBusy=false; return; }
      dir.normalize();

      let hit = null;
      try { hit = await mpSdk.Scene.raycast({ x:nW.x, y:nW.y, z:nW.z }, { x:dir.x, y:dir.y, z:dir.z }, len); } catch(_){}

      if (hit && hit.hit) {
        worldPts[i] = new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z);
      } else {
        const t = ((CFG.floorY || 0) - nW.y) / (fW.y - nW.y);
        if (!(t >= 0 && t <= 1 && isFinite(t))) { projector.mesh.visible = false; cafBusy=false; return; }
        worldPts[i] = new THREE.Vector3().copy(nW).addScaledVector(new THREE.Vector3().subVectors(fW, nW), t);
      }
    }
    projector.mesh.visible = true;

    const arr = projector.geom.attributes.position.array;
    let k = 0; // floats written
    const write = (p)=>{ arr[k++]=p.x; arr[k++]=p.y+0.003; arr[k++]=p.z; };

    for (let yi=0; yi<v-1; yi++){
      for (let xi=0; xi<u-1; xi++){
        const idx = yi*u + xi;
        const p00 = rootNode.obj3D.worldToLocal(worldPts[idx    ].clone());
        const p10 = rootNode.obj3D.worldToLocal(worldPts[idx + 1].clone());
        const p01 = rootNode.obj3D.worldToLocal(worldPts[idx + u].clone());
        const p11 = rootNode.obj3D.worldToLocal(worldPts[idx + u + 1].clone());
        write(p00); write(p10); write(p11);
        write(p00); write(p11); write(p01);
      }
    }
    projector.geom.setDrawRange(0, (k/3)); // vertices
    projector.geom.attributes.position.needsUpdate = true;
    // no normals for MeshBasicMaterial

    cafBusy = false;
  }

  // --- Outdoor projector: recompute only when dirty ---
  async function updateOutdoorProjector(entry) {
    const rig = entry.refs;
    if (!rig || !rig.node || !rig.frustum || !rig.projector) return;
    if (rig._busy || !rig.dirty) return;
    rig._busy = true;

    const frustum = (typeof rig.frustum === 'function' ? rig.frustum() : rig.frustum);
    const nearRect = frustum.userData.nearRect;
    const farRect  = frustum.userData.farRect;
    const u = rig.projectorU || 12, v = rig.projectorV || 8;

    const nearGrid = [], farGrid = [];
    for (let yi=0; yi<v; yi++){
      const ty = yi/(v-1);
      const nA = new THREE.Vector3().lerpVectors(nearRect[0], nearRect[3], ty);
      const nB = new THREE.Vector3().lerpVectors(nearRect[1], nearRect[2], ty);
      const fA = new THREE.Vector3().lerpVectors(farRect[0],  farRect[3],  ty);
      const fB = new THREE.Vector3().lerpVectors(farRect[1],  farRect[2],  ty);
      for (let xi=0; xi<u; xi++){
        const tx = xi/(u-1);
        nearGrid.push(new THREE.Vector3().lerpVectors(nA, nB, tx));
        farGrid .push(new THREE.Vector3().lerpVectors(fA, fB, tx));
      }
    }

    const worldPts = new Array(nearGrid.length);
    for (let i=0;i<nearGrid.length;i++){
      const nW = rig.tilt.localToWorld(nearGrid[i].clone());
      const fW = rig.tilt.localToWorld(farGrid[i].clone());
      const seg = new THREE.Vector3().subVectors(fW, nW);
      const len = seg.length(); if (len <= 1e-4) continue;
      const dir = seg.clone().normalize();

      let hit = null;
      try { hit = await mpSdk.Scene.raycast({ x:nW.x, y:nW.y, z:nW.z }, { x:dir.x, y:dir.y, z:dir.z }, len); } catch(_){}

      let wp = null;
      if (hit && hit.hit) {
        wp = new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z);
      } else {
        const floorY = (rig.groundY != null ? rig.groundY : 0.0);
        const t = (floorY - nW.y) / (fW.y - nW.y);
        if (isFinite(t) && t >= 0 && t <= 1) wp = nW.clone().addScaledVector(seg, t);
      }
      if (wp) worldPts[i] = wp;
    }

    const geo = rig.projector.geometry;
    const pos = geo.attributes.position.array;
    let k = 0; // floats written
    const write = (p)=>{ pos[k++]=p.x; pos[k++]=p.y+0.003; pos[k++]=p.z; };

    for (let yi=0; yi<v-1; yi++){
      for (let xi=0; xi<u-1; xi++){
        const idx = yi*u + xi;
        const p00 = worldPts[idx];
        const p10 = worldPts[idx + 1];
        const p01 = worldPts[idx + u];
        const p11 = worldPts[idx + u + 1];
        if (!p00 || !p10 || !p01 || !p11) continue;

        const toLocal = p => rig.node.obj3D.worldToLocal(p.clone());
        write(toLocal(p00)); write(toLocal(p10)); write(toLocal(p11));
        write(toLocal(p00)); write(toLocal(p11)); write(toLocal(p01));
      }
    }
    geo.setDrawRange(0, (k/3));               // vertices actually written
    geo.attributes.position.needsUpdate = true;
    rig.projector.visible = (k > 0);          // hide if nothing drawn
    rig.dirty = false;
    rig._busy = false;
  }

  // animate cafeteria sweep + throttled updates
  let phase = 0, last = performance.now();
  async function animate(now) {
    const dt = (now - last)/1000; last = now;

    // cafeteria pan sweep (outdoor cams are fixed)
    const yawCenter = deg2rad(CFG.baseYawDeg);
    const yawAmp    = deg2rad(CFG.sweepDeg) * 0.5;
    const yawSpeed  = deg2rad(CFG.yawSpeedDeg);
    phase += yawSpeed * dt;
    panPivot.rotation.y = yawCenter + Math.sin(phase) * yawAmp;

    // cafeteria footprint at ~6–7 Hz
    cafTimer += dt;
    if (cafTimer >= 0.15) { cafTimer = 0; updateProjector(); }

    // outdoor footprints only when dirty
    rigs.forEach(entry => {
      if (entry.type === 'outdoor') updateOutdoorProjector(entry);
    });

    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  // first visibility pass
  updateVisibility();
};

main().catch(console.error);