import '@matterport/webcomponent';

/* ========================= Config ========================= */
const CFG = {
  // Cafeteria cam position & optics
  position: { x: 45.259, y: 4.0, z: -9.45 },

  aspect: 16 / 9,
  hFovDeg: 32,
  near: 0.12,
  far: 19,
  nearApertureScale: 0.22,

  // Cafeteria sweep motion
  sweepDeg: 122,
  baseYawDeg: 93,
  tiltDeg: 10,
  yawSpeedDeg: 14,

  // FOV styling
  fovColor: 0x00ff00,
  fillOpacity: 0.08,
  edgeRadius: 0.016,
  baseEdgeRadius: 0.010,

  // Projector (indoor fallback floor)
  floorY: 0.4,
  footprintOpacity: 0.18,
  projectorGrid: { u: 20, v: 12 },

  // Stylized body colors
  camText: '#f59e0b',
  camWhite: 0xffffff,
  cableBlack: 0x111111,
};

const DEBUG = true;

// Cafeteria gating
const BOUND_ROOM_ID = 'cdz3fkt38kae7tapstpt0eaeb';
const USE_SWEEP_GATE = true;
const USE_ROOM_GATE  = true;
const SHOW_IN_FLOORPLAN = true;

// Outdoor tag labels look like “Security Camera …”
const OUTDOOR_TAG_MATCH = /^\s*security\s*camera\b/i;

// Choose outdoor LOS mode: 'cam' (recommended) | 'far' (old way) | 'off'
const USE_OUTDOOR_LOS = 'cam';

/* ================= Infrastructure ================= */
const rigs = new Map(); window._rigs = rigs; // id -> { id, label, type, cfg, refs, rebuild, applyTilt }
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
  const n = frustumDims(THREE, cfg.hFovDeg, (cfg.aspect != null ? cfg.aspect : 16/9), near);
  const f = frustumDims(THREE, cfg.hFovDeg, (cfg.aspect != null ? cfg.aspect : 16/9), far);
  const s = THREE.MathUtils.clamp((cfg.nearApertureScale != null ? cfg.nearApertureScale : 1), 0.05, 1);
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
    color: (cfg.fovColor != null ? cfg.fovColor : 0x00ff00), transparent: true, opacity: 0.95,
    depthTest: true, depthWrite: false
  ,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
  });

  group.add(tubeBetween(THREE, n0, f0, (cfg.edgeRadius != null ? cfg.edgeRadius : 0.016), edgeMat));
  group.add(tubeBetween(THREE, n1, f1, (cfg.edgeRadius != null ? cfg.edgeRadius : 0.016), edgeMat));
  group.add(tubeBetween(THREE, n2, f2, (cfg.edgeRadius != null ? cfg.edgeRadius : 0.016), edgeMat));
  group.add(tubeBetween(THREE, n3, f3, (cfg.edgeRadius != null ? cfg.edgeRadius : 0.016), edgeMat));

  group.add(tubeBetween(THREE, n0, n1, (cfg.baseEdgeRadius != null ? cfg.baseEdgeRadius : 0.010), edgeMat));
  group.add(tubeBetween(THREE, n1, n2, (cfg.baseEdgeRadius != null ? cfg.baseEdgeRadius : 0.010), edgeMat));
  group.add(tubeBetween(THREE, n2, n3, (cfg.baseEdgeRadius != null ? cfg.baseEdgeRadius : 0.010), edgeMat));
  group.add(tubeBetween(THREE, n3, n0, (cfg.baseEdgeRadius != null ? cfg.baseEdgeRadius : 0.010), edgeMat));

  group.add(tubeBetween(THREE, f0, f1, (cfg.baseEdgeRadius != null ? cfg.baseEdgeRadius : 0.010), edgeMat));
  group.add(tubeBetween(THREE, f1, f2, (cfg.baseEdgeRadius != null ? cfg.baseEdgeRadius : 0.010), edgeMat));
  group.add(tubeBetween(THREE, f2, f3, (cfg.baseEdgeRadius != null ? cfg.baseEdgeRadius : 0.010), edgeMat));
  group.add(tubeBetween(THREE, f3, f0, (cfg.baseEdgeRadius != null ? cfg.baseEdgeRadius : 0.010), edgeMat));

  const pos = [];
  const quads = [[n0,n1,f1,f0],[n1,n2,f2,f1],[n2,n3,f3,f2],[n3,n0,f0,f3]];
  for (const [a,b,c,d] of quads) {
    pos.push(a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z);
    pos.push(a.x,a.y,a.z, c.x,c.y,c.z, d.x,d.y,d.z);
  }
  pos.push(n0.x,n0.y,n0.z, n1.x,n1.y,n1.z, n2.x,n2.y,n2.z);
  pos.push(n0.x,n0.y,n0.z, n2.x,n2.y,n2.z, n3.x,n3.y,n3.z);

  const faces = new THREE.BufferGeometry();
  faces.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  faces.computeVertexNormals();
  const fillMat = new THREE.MeshBasicMaterial({
    color: (cfg.fovColor != null ? cfg.fovColor : 0x00ff00), transparent: true, opacity: (cfg.fillOpacity != null ? cfg.fillOpacity : 0.08),
    side: THREE.DoubleSide, depthTest: true, depthWrite: false
  ,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
  });
  const mesh = new THREE.Mesh(faces, fillMat);
  group.add(mesh);

  // expose materials for distance-fade & remember base opacities
  edgeMat.userData = { baseOpacity: edgeMat.opacity };
  fillMat.userData = { baseOpacity: fillMat.opacity };
  group.userData = { nearRect: [n0,n1,n2,n3], farRect: [f0,f1,f2,f3], materials: { edge: edgeMat, fill: fillMat } };
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
  ctx.textBaseline = 'middle'; ctx.fillText('Clowbus Security', 160, Math.round(h*0.38));
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

  // details
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
function makeFovOnlyRig(THREE, sceneObject, cfg, color = CFG.fovColor) {
  const node = sceneObject.addNode();
  node.obj3D.visible = false;

  const pan = new THREE.Object3D();
  const tilt = new THREE.Object3D();
  pan.add(tilt); node.obj3D.add(pan);

  node.obj3D.position.set(cfg.position.x, cfg.position.y, cfg.position.z);
  pan.rotation.y  = deg2rad((cfg.yawDeg != null ? cfg.yawDeg : 0));
  tilt.rotation.x = -deg2rad((cfg.tiltDeg != null ? cfg.tiltDeg : 10));

  const frustum = buildTruncatedFrustum(THREE, { ...CFG, ...cfg, fovColor: color });
  tilt.add(frustum);

  // projector mesh
  const u = 20, v = 12, tris = (u-1)*(v-1)*2;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(tris*9), 3));
  const mat = new THREE.MeshBasicMaterial({
    color, transparent:true, opacity: CFG.footprintOpacity,
    side: THREE.DoubleSide, depthTest:true, depthWrite:false
  });
  const projector = new THREE.Mesh(geom, mat);
  node.obj3D.add(projector);

  return { node, pan, tilt, frustum, projector, projectorU: u, projectorV: v };
}

/* ============================= UI ============================= */
function makePanel(selectedId = 'cafeteria') {
  var _oldPanel = document.getElementById('fov-panel'); if (_oldPanel) _oldPanel.remove();

  const wrap = document.createElement('div');
  wrap.id = 'fov-panel';
  wrap.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:rgba(0,0,0,.68);' +
    'color:#fff;padding:12px;border-radius:12px;font:14px/1.15 system-ui,Arial;width:240px;box-shadow:0 6px 18px rgba(0,0,0,.35);';
  document.body.appendChild(wrap);

  const title = document.createElement('div');
  title.style.cssText='font-weight:700;margin-bottom:8px;text-align:center;';
  title.textContent='Camera FOV Controls';
  wrap.appendChild(title);

  const pick = document.createElement('select');
  pick.style.cssText='width:100%;margin:0 0 8px 0;padding:6px;border-radius:8px;border:none;';
  for (const r of rigs.values()) {
    const o = document.createElement('option');
    o.value = r.id; o.textContent = r.label || r.id;
    if (r.id === selectedId) o.selected = true;
    pick.appendChild(o);
  }

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
    const { cfg, type, refs } = rig;

    const row = (label, get, set, step, unit, min, max, decimals=0) => {
      const name = document.createElement('div'); name.textContent=label; name.style.cssText='align-self:center;';
      const mk=(txt,delta)=>{const b=document.createElement('button');b.textContent=txt;
        b.style.cssText='background:#14b8a6;border:none;color:#001;font-weight:800;border-radius:10px;padding:8px 10px;cursor:pointer;';
        b.onclick=(e)=>{e.preventDefault(); const v=Math.max(min,Math.min(max,+(get()+delta).toFixed(decimals))); set(v); val.textContent=`${get().toFixed(decimals)}${unit}`;};
        return b;};
      const minus=mk('−',-step), plus=mk('+',step);
      const val = valLine(`${get().toFixed(decimals)}${unit}`);
      grid.appendChild(name); grid.appendChild(minus); grid.appendChild(plus);
    };

    row('HFOV',  ()=>cfg.hFovDeg, v=>{cfg.hFovDeg=v; rig.rebuild();}, 1,'°',10,120);
    row('NEAR',  ()=>cfg.near,    v=>{cfg.near=v;    rig.rebuild();}, 0.01,'',0.02,1,2);
    row('FAR',   ()=>cfg.far,     v=>{cfg.far=v;     rig.rebuild();}, 1,'',5,120);

    if (type === 'indoor') { // cafeteria
      row('SWEEP', ()=>CFG.sweepDeg, v=>{CFG.sweepDeg=v;}, 2,'°',10,170);
      row('YAW',   ()=>CFG.baseYawDeg, v=>{ CFG.baseYawDeg=v; }, 1,'°',-180,180);
      row('TILT',  ()=>CFG.tiltDeg,    v=>{ CFG.tiltDeg=v; rig.applyTilt(); }, 1,'°',0,85);
      row('MaxDist', ()=> (cfg.maxDistanceM != null ? cfg.maxDistanceM : 25), v=>{ cfg.maxDistanceM=v; }, 1,'m',5,80);
    } else { // outdoor
      row('SWEEP', ()=> (cfg.sweepDeg != null ? cfg.sweepDeg : CFG.sweepDeg), v=>{ cfg.sweepDeg=v; }, 2,'°',10,170);
      row('YawSpd', ()=> (cfg.yawSpeedDeg != null ? cfg.yawSpeedDeg : (CFG.yawSpeedDeg != null ? CFG.yawSpeedDeg : 10)), v=>{ cfg.yawSpeedDeg=v; }, 1,'°/s',1,60);

      row('YAW',   ()=>cfg.yawDeg, v=>{ cfg.yawDeg=v; refs.pan.rotation.y = deg2rad(v); }, 1,'°',-180,180);
      row('TILT',  ()=>cfg.tiltDeg, v=>{ cfg.tiltDeg=v; rig.applyTilt(); }, 1,'°',0,85);
      // update cfg AND refs proxy so the gates react immediately
      row('MaxDist',
          ()=> (cfg.maxDistanceM != null ? cfg.maxDistanceM : 35),
          v=>{ cfg.maxDistanceM=v; if (refs && 'maxDistanceM' in refs) refs.maxDistanceM = v; },
          1,'m',5,100);
    }
  }

  let current = rigs.get(selectedId) || Array.from(rigs.values())[0];
  mountControls(current);
  pick.onchange = () => { current = rigs.get(pick.value); mountControls(current); };

  const footer=document.createElement('div'); footer.style.cssText='display:flex;gap:8px;margin-top:10px;';
  const hide=document.createElement('button'); hide.textContent='Hide'; hide.style.cssText='flex:1;background:#64748b;border:none;border-radius:10px;padding:10px;color:#fff;font-weight:800;';
  hide.onclick=(e)=>{e.preventDefault(); wrap.style.display = (wrap.style.display==='none')?'block':'none'; };
  footer.appendChild(hide); wrap.appendChild(footer);

  return { wrap, pick };
}

// Expose the panel builder
window._makePanel = makePanel;

/* ============================ Main ============================ */
const main = async () => {
  const viewer = document.querySelector('matterport-viewer');
  if (viewer) viewer.setAttribute('asset-base', '/Securitycam/');

  const mpSdk = await viewer.playingPromise;
  const THREE = window.THREE;

  await mpSdk.Mode.moveTo(mpSdk.Mode.Mode.INSIDE);

  const [sceneObject] = await mpSdk.Scene.createObjects(1);
  const rootNode = sceneObject.addNode();
  rootNode.obj3D.visible = false;

  // lights (for stylized body)
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

  // projector for cafeteria rig
  const projector = {
    u: CFG.projectorGrid.u, v: CFG.projectorGrid.v,
    geom: new THREE.BufferGeometry(),
    mat:  new THREE.MeshBasicMaterial({
      color: CFG.fovColor, transparent: true, opacity: CFG.footprintOpacity,
      side: THREE.DoubleSide, depthTest: true, depthWrite: false
    }),
    mesh: null,
  };
  (function initProjector(){
    const {u,v} = projector;
    const tris  = (u-1)*(v-1)*2;
    projector.geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(tris*9), 3));
    projector.mesh = new THREE.Mesh(projector.geom, projector.mat);
    rootNode.obj3D.add(projector.mesh);
  })();

  // register cafeteria rig
  const cafeteriaCfg = { hFovDeg: CFG.hFovDeg, near: CFG.near, far: CFG.far, maxDistanceM: 25 };
  registerRig({
    id: 'cafeteria',
    label: 'Cafeteria Cam',
    type: 'indoor',
    cfg: cafeteriaCfg,
    refs: { panPivot, tiltPivot, frustum: () => frustumGroup },
    rebuild: () => {
      tiltPivot.remove(frustumGroup);
      if (frustumGroup && frustumGroup.traverse) frustumGroup.traverse(function(o){ if (o.geometry && o.geometry.dispose) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
      Object.assign(CFG, { hFovDeg: cafeteriaCfg.hFovDeg, near: cafeteriaCfg.near, far: cafeteriaCfg.far });
      frustumGroup = buildTruncatedFrustum(THREE, CFG);
      tiltPivot.add(frustumGroup);
      updateVisibility();
    },
    applyTilt: () => applyTilt(),
  });

  // Start cafeteria visuals & UI immediately (don’t block on tags)
  rootNode.start();
  makePanel('cafeteria');

  /* -------- Outdoor rigs from Mattertags (robust) -------- */
  const outdoorCams = [];

  function pickNum(text, re, d) { try { var m = (text && text.match) ? text.match(re) : null; return m ? parseFloat(m[1]) : d; } catch (e) { return d; } }
  function parseOutdoorCfgFromTag(tag) {
    const txt = `${tag.label || ''}\n${tag.description || ''}`;
    return {
            position: { x: tag.anchorPosition.x, y: tag.anchorPosition.y, z: tag.anchorPosition.z },
      hFovDeg: pickNum(txt, /\bhfov\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 32),
      near:    pickNum(txt, /\bnear\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 0.12),
      far:     pickNum(txt, /\bfar\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 22),
      yawDeg:  pickNum(txt, /\byaw\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 0),
      tiltDeg: pickNum(txt, /\btilt\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 10),
      sweepDeg: pickNum(txt, /\bsweep\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, (CFG.sweepDeg != null ? CFG.sweepDeg : 90)),
      yawSpeedDeg: pickNum(txt, /\byawspeed\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, (CFG.yawSpeedDeg != null ? CFG.yawSpeedDeg : 10)),
      maxDistanceM: pickNum(txt, /\bmaxdist\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 35),
      fadeStartM: pickNum(txt, /\bfadestart\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, null),
      aspect: 16/9,

    };
  }

  async function getTagsWithTimeout(ms = 1500) {
    // Try Tag.data first, but don't wait forever
    if (mpSdk.Tag && mpSdk.Tag.data && mpSdk.Tag.data.subscribe) {
      const tagDataPromise = new Promise(function(resolve){
        const unsub = mpSdk.Tag.data.subscribe(function(tags){
          try {
            var arr;
            if (Array.isArray(tags)) { arr = tags; }
            else if (tags && typeof tags.toArray === 'function') { arr = tags.toArray(); }
            else { arr = Object.values(tags || {}); }
            if (arr) { if (unsub) unsub(); resolve(arr); }
          } catch (e) { if (unsub) unsub(); resolve([]); }
        });
      });
      const timeout = new Promise(function(resolve){ setTimeout(function(){ resolve(null); }, ms); });
      const viaNew = await Promise.race([tagDataPromise, timeout]);
      if (viaNew) return viaNew;
    }
    // Fallback (deprecated)
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
      rig.groundY = (hit && hit.hit ? hit.position.y : 0.0);
      if (DEBUG) log('Outdoor rig groundY:', rig.groundY);
    } catch (e) { rig.groundY = 0.0; }
  }

  async function spawnOutdoorCamsFromTags() {
    const tags = await getTagsWithTimeout();
    const camTags = tags.filter(t => OUTDOOR_TAG_MATCH.test(t.label || ''));
    for (const t of camTags) {
      const cfg = parseOutdoorCfgFromTag(t);
      const rig = makeFovOnlyRig(THREE, sceneObject, cfg, 0x00ff00);
      outdoorCams.push({ ...rig, cfg, tagSid: t.sid, label: t.label });
      await initOutdoorGround(rig);

      // 👈 start outdoor node so it actually renders
      rig.node.start();

      const id = t.sid || `out-${outdoorCams.length}`;
      const label = t.label || `Outdoor ${outdoorCams.length}`;

      registerRig({
        id,
        label,
        type: 'outdoor',
        cfg,
        // Put everything the updater needs into refs
        refs: {
          node: rig.node,
          pan: rig.pan,
          tilt: rig.tilt,
          frustum: () => rig.frustum,       // return latest frustum
          projector: rig.projector,
          projectorU: rig.projectorU,
          projectorV: rig.projectorV,
          get groundY() { return rig.groundY; },
          // Proxy so UI & gates use per-rig distance
          get maxDistanceM() { return (cfg.maxDistanceM != null ? cfg.maxDistanceM : 35); },
          set maxDistanceM(v) { cfg.maxDistanceM = v; },
        },
        rebuild: () => {
          const parent = rig.tilt;
          parent.remove(rig.frustum);
          if (rig.frustum && rig.frustum.traverse) rig.frustum.traverse(function(o){ if (o.geometry && o.geometry.dispose) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
          rig.frustum = buildTruncatedFrustum(THREE, { ...CFG, ...cfg });
          parent.add(rig.frustum);
        },
        applyTilt: () => { rig.tilt.rotation.x = -deg2rad(cfg.tiltDeg); },
      });

      // 👈 add to UI dropdown immediately
      try {
        const pick = document.querySelector('#fov-panel select');
        if (pick && ![...pick.options].some(o => o.value === id)) {
          const o = document.createElement('option');
          o.value = id; o.textContent = label;
          pick.appendChild(o);
        }
      } catch (e) {}
    }
    log(`Spawned ${outdoorCams.length} outdoor FOV rig(s)`);
  }
  // fire-and-forget; don't block UI
  spawnOutdoorCamsFromTags().catch(e => console.warn('[SECAM] outdoor spawn error', e));

  /* --------------- Visibility + projectors --------------- */
  let viewerPos = new THREE.Vector3();
  const scheduleVisCheck = (() => {
    let pending = false;
    return () => { if (pending) return; pending = true; setTimeout(() => { pending = false; updateVisibility(); }, 80); };
  })();

  mpSdk.Camera.pose.subscribe(p => {
    viewerPos.set(p.position.x, p.position.y, p.position.z);
    scheduleVisCheck();
  });

  let mode = mpSdk.Mode.Mode.INSIDE;
  mpSdk.Mode.current.subscribe(m => { mode = m; updateVisibility(); });

  // Room.current (robust)
  let currentRooms = new Set();
  mpSdk.Room.current.subscribe((payload) => {
    try {
      const list =
        Array.isArray(payload) ? payload :
        (payload && typeof payload[Symbol.iterator] === 'function') ? Array.from(payload) :
        (payload && Array.isArray(payload.ids)) ? payload.ids :
        [];
      currentRooms = new Set(list);
      if (DEBUG) log('Room.current IDs:', [...currentRooms]);
      updateVisibility();
    } catch (err) {
      console.warn('[SECAM] Room.current handler error', err, payload);
    }
  });

  let currentSweepRoomId = null;
  mpSdk.Sweep.current.subscribe((sw) => {
    currentSweepRoomId = (sw && sw.roomInfo && sw.roomInfo.id) ? sw.roomInfo.id : null;
    if (DEBUG) log('Sweep.current room:', currentSweepRoomId, 'sweepId:', (sw && sw.sid));
    updateVisibility();
  });

  async function raycastFirst(origin, direction, maxDist) {
    try {
      if (typeof mpSdk.Scene.raycast === 'function') {
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

    // room / sweep gating
    let inTargetRoom = true;
    if (USE_SWEEP_GATE && currentSweepRoomId) {
      inTargetRoom = (currentSweepRoomId === BOUND_ROOM_ID);
    } else if (USE_ROOM_GATE) {
      inTargetRoom = currentRooms.has(BOUND_ROOM_ID);
    }
    if (!inTargetRoom) { rootNode.obj3D.visible = false; return; }

    const camPos = rootNode.obj3D.getWorldPosition(new THREE.Vector3());
    const dist = camPos.distanceTo(viewerPos);
    var _r = rigs.get('cafeteria'); const maxDist = (_r && _r.cfg && _r.cfg.maxDistanceM != null ? _r.cfg.maxDistanceM : 25);
    if (DEBUG) log('Distance to cam (m):', dist.toFixed(2));
    if (dist > maxDist) { rootNode.obj3D.visible = false; return; }

    // LOS gate: aim at far-plane center
    const fr = (frustumGroup && frustumGroup.userData) ? frustumGroup.userData.farRect : undefined;
    if (fr) {
      const centerLocal = new THREE.Vector3().add(fr[0]).add(fr[1]).add(fr[2]).add(fr[3]).multiplyScalar(0.25);
      const target = tiltPivot.localToWorld(centerLocal.clone());
      const dir = new THREE.Vector3().subVectors(target, viewerPos);
      const len = dir.length();
      if (len > 0.001) {
        dir.normalize();
        const hit = await raycastFirst(viewerPos, dir, len);
        const hitDist = ((hit && hit.distance != null) ? hit.distance : Number.POSITIVE_INFINITY);
        const blocked = !!(hit && hit.hit) && hitDist < (len - 0.05);
        if (DEBUG) log('LOS blocked?', blocked, 'hitDist:', (hitDist!=null && hitDist.toFixed ? hitDist.toFixed(2) : hitDist), 'len:', len.toFixed(2));
        if (blocked) { rootNode.obj3D.visible = false; return; }
      }
    }

    rootNode.obj3D.visible = true;
  }

  async function updateProjector() {
    if (!rootNode.obj3D.visible) { projector.mesh.visible = false; return; }

    const nearRect = frustumGroup.userData.nearRect;
    const farRect  = frustumGroup.userData.farRect;
    const { u, v } = projector;

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
      const len = dir.length(); dir.normalize();

      let hit = null;
      try { hit = await mpSdk.Scene.raycast({ x:nW.x, y:nW.y, z:nW.z }, { x:dir.x, y:dir.y, z:dir.z }, len); } catch(_){}

      if (hit && hit.hit) {
        worldPts[i] = new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z);
      } else {
        const t = (((CFG.floorY != null ? CFG.floorY : 0) - nW.y) / (fW.y - nW.y));
        if (t < 0 || t > 1 || !Number.isFinite(t)) { projector.mesh.visible = false; return; }
        worldPts[i] = new THREE.Vector3().copy(nW).addScaledVector(new THREE.Vector3().subVectors(fW, nW), t);
      }
    }
    projector.mesh.visible = true;

    const arr = projector.geom.attributes.position.array;
    let k = 0;
    for (let yi=0; yi<v-1; yi++){
      for (let xi=0; xi<u-1; xi++){
        const idx = yi*u + xi;
        const p00 = rootNode.obj3D.worldToLocal(worldPts[idx    ].clone());
        const p10 = rootNode.obj3D.worldToLocal(worldPts[idx + 1].clone());
        const p01 = rootNode.obj3D.worldToLocal(worldPts[idx + u].clone());
        const p11 = rootNode.obj3D.worldToLocal(worldPts[idx + u + 1].clone());
        const write = (p)=>{ arr[k++]=p.x; arr[k++]=p.y+0.003; arr[k++]=p.z; };
        write(p00); write(p10); write(p11);
        write(p00); write(p11); write(p01);
      }
    }
    projector.geom.attributes.position.needsUpdate = true;
    projector.geom.computeVertexNormals();
  }

  // === UPDATED: friendlier outdoor LOS visibility (ES2018-safe) ===
  async function updateOutdoorCamVisibility(rig) {
    if (!rig || !rig.node || !rig.tilt) return;

    // Show in FLOORPLAN no matter what (parity with cafeteria)
    if (mode === mpSdk.Mode.Mode.FLOORPLAN && SHOW_IN_FLOORPLAN) {
      rig.node.obj3D.visible = true;
      return;
    }

    // throttle checks to ~6–7 Hz per rig
    const now = performance.now();
    if (rig._visBusy || (rig._nextVis && now < rig._nextVis)) return;
    rig._visBusy = true;
    rig._nextVis = now + 150;

    // Distance + soft fade
    const camPos = rig.node.obj3D.getWorldPosition(new THREE.Vector3());
    const d = camPos.distanceTo(viewerPos);
    const maxD = (rig.maxDistanceM != null ? rig.maxDistanceM : 35);
    const fadeStart = Math.max(0, (rig.fadeStartM != null ? rig.fadeStartM : (maxD - 8)));

    // fade edges/fill as you approach max distance
    var frustum = (typeof rig.frustum === 'function' ? rig.frustum() : rig.frustum);
    var mats = frustum && frustum.userData ? frustum.userData.materials : undefined;
    var edgeMat = mats && mats.edge;
    var fillMat = mats && mats.fill;
    if (edgeMat && fillMat) {
      var t = (d <= fadeStart) ? 0 : (d >= maxD ? 1 : (d - fadeStart) / Math.max(1e-6, (maxD - fadeStart)));
      var clamp = function(x) { return Math.min(1, Math.max(0, x)); };
      var eBase = (edgeMat.userData && edgeMat.userData.baseOpacity != null) ? edgeMat.userData.baseOpacity : 0.95;
      var fBase = (fillMat.userData && fillMat.userData.baseOpacity != null) ? fillMat.userData.baseOpacity : ((CFG.fillOpacity != null ? CFG.fillOpacity : 0.08));
      edgeMat.opacity = THREE.MathUtils.lerp(eBase, 0.0, clamp(t));
      fillMat.opacity = THREE.MathUtils.lerp(fBase, 0.0, clamp(t));
    }

    // hard cutoff
    if (d > maxD) { rig.node.obj3D.visible = false; rig._visBusy = false; return; }

    // LOS gating
    if (USE_OUTDOOR_LOS === 'off') { rig.node.obj3D.visible = true; rig._visBusy = false; return; }

    var target;
    if (USE_OUTDOOR_LOS === 'cam') {
      target = camPos; // require visibility of the head itself
    } else {
      var fr = frustum && frustum.userData ? frustum.userData.farRect : undefined;
      if (!fr) { rig.node.obj3D.visible = true; rig._visBusy = false; return; }
      var centerLocal = new THREE.Vector3().add(fr[0]).add(fr[1]).add(fr[2]).add(fr[3]).multiplyScalar(0.25);
      target = rig.tilt.localToWorld(centerLocal.clone());
    }

    var dir = new THREE.Vector3().subVectors(target, viewerPos);
    var len = dir.length();
    if (len <= 1e-3) { rig.node.obj3D.visible = false; rig._visBusy = false; return; }
    dir.normalize();

    try {
      var hit = await raycastFirst(viewerPos, dir, len);
      rig.node.obj3D.visible = !(hit && hit.hit && hit.distance < (len - 0.05));
    } catch (e) {
      rig.node.obj3D.visible = true;
    }

    rig._visBusy = false;
  }
}
main().catch(console.error);