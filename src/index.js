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

/* ================= Infrastructure ================= */
const rigs = new Map(); // id -> { id, label, type, cfg, refs, rebuild, applyTilt }
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
  const n = frustumDims(THREE, cfg.hFovDeg, cfg.aspect ?? 16/9, near);
  const f = frustumDims(THREE, cfg.hFovDeg, cfg.aspect ?? 16/9, far);
  const s = THREE.MathUtils.clamp(cfg.nearApertureScale ?? 1, 0.05, 1);
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
    color: cfg.fovColor ?? 0x00ff00, transparent: true, opacity: 0.95,
    depthTest: true, depthWrite: false
  });

  group.add(tubeBetween(THREE, n0, f0, cfg.edgeRadius ?? 0.016, edgeMat));
  group.add(tubeBetween(THREE, n1, f1, cfg.edgeRadius ?? 0.016, edgeMat));
  group.add(tubeBetween(THREE, n2, f2, cfg.edgeRadius ?? 0.016, edgeMat));
  group.add(tubeBetween(THREE, n3, f3, cfg.edgeRadius ?? 0.016, edgeMat));

  group.add(tubeBetween(THREE, n0, n1, cfg.baseEdgeRadius ?? 0.010, edgeMat));
  group.add(tubeBetween(THREE, n1, n2, cfg.baseEdgeRadius ?? 0.010, edgeMat));
  group.add(tubeBetween(THREE, n2, n3, cfg.baseEdgeRadius ?? 0.010, edgeMat));
  group.add(tubeBetween(THREE, n3, n0, cfg.baseEdgeRadius ?? 0.010, edgeMat));

  group.add(tubeBetween(THREE, f0, f1, cfg.baseEdgeRadius ?? 0.010, edgeMat));
  group.add(tubeBetween(THREE, f1, f2, cfg.baseEdgeRadius ?? 0.010, edgeMat));
  group.add(tubeBetween(THREE, f2, f3, cfg.baseEdgeRadius ?? 0.010, edgeMat));
  group.add(tubeBetween(THREE, f3, f0, cfg.baseEdgeRadius ?? 0.010, edgeMat));

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
    color: cfg.fovColor ?? 0x00ff00, transparent: true, opacity: cfg.fillOpacity ?? 0.08,
    side: THREE.DoubleSide, depthTest: true, depthWrite: false
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
  pan.rotation.y  = deg2rad(cfg.yawDeg ?? 0);
  tilt.rotation.x = -deg2rad(cfg.tiltDeg ?? 10);

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
  document.getElementById('fov-panel')?.remove();

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
      row('MaxDist', ()=>cfg.maxDistanceM ?? 25, v=>{ cfg.maxDistanceM=v; }, 1,'m',5,80);
    } else { // outdoor
      row('YAW',   ()=>cfg.yawDeg, v=>{ cfg.yawDeg=v; refs.pan.rotation.y = deg2rad(v); }, 1,'°',-180,180);
      row('TILT',  ()=>cfg.tiltDeg, v=>{ cfg.tiltDeg=v; rig.applyTilt(); }, 1,'°',0,85);
      row('MaxDist', ()=>cfg.maxDistanceM ?? 35, v=>{ cfg.maxDistanceM=v; }, 1,'m',5,100);
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

/* ============================ Main ============================ */
const main = async () => {
  const viewer = document.querySelector('matterport-viewer');
  viewer?.setAttribute('asset-base', '/Securitycam/');

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
      frustumGroup.traverse?.(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
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

  function pickNum(text, re, d) { const m = text?.match?.(re); return m ? parseFloat(m[1]) : d; }
  function parseOutdoorCfgFromTag(tag) {
    const txt = `${tag.label || ''}\n${tag.description || ''}`;
    return {
      position: { x: tag.anchorPosition.x, y: tag.anchorPosition.y, z: tag.anchorPosition.z },
      hFovDeg: pickNum(txt, /\bhfov\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 32),
      near:    pickNum(txt, /\bnear\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 0.12),
      far:     pickNum(txt, /\bfar\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 22),
      yawDeg:  pickNum(txt, /\byaw\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 0),
      tiltDeg: pickNum(txt, /\btilt\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 10),
      maxDistanceM: pickNum(txt, /\bmaxdist\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 35),
      aspect: 16/9,
    };
  }

  async function getTagsWithTimeout(ms = 1500) {
    // Try Tag.data first, but don't wait forever
    if (mpSdk.Tag?.data?.subscribe) {
      const tagDataPromise = new Promise(resolve => {
        const unsub = mpSdk.Tag.data.subscribe(tags => {
          try {
            const arr = Array.isArray(tags)
              ? tags
              : (tags?.toArray?.() ?? Object.values(tags ?? {}));
            if (arr) { unsub?.(); resolve(arr); }
          } catch { unsub?.(); resolve([]); }
        });
      });
      const timeout = new Promise(resolve => setTimeout(() => resolve(null), ms));
      const viaNew = await Promise.race([tagDataPromise, timeout]);
      if (viaNew) return viaNew;
    }
    // Fallback (deprecated)
    try { return await mpSdk.Mattertag.getData(); } catch { return []; }
  }

  async function initOutdoorGround(rig) {
    try {
      const origin = rig.node.obj3D.getWorldPosition(new THREE.Vector3());
      const hit = await mpSdk.Scene.raycast(
        { x: origin.x, y: origin.y, z: origin.z },
        { x: 0, y: -1, z: 0 },
        60
      );
      rig.groundY = (hit?.hit ? hit.position.y : 0.0);
      if (DEBUG) log('Outdoor rig groundY:', rig.groundY);
    } catch { rig.groundY = 0.0; }
  }

  async function spawnOutdoorCamsFromTags() {
    const tags = await getTagsWithTimeout();
    const camTags = tags.filter(t => OUTDOOR_TAG_MATCH.test(t.label || ''));
    for (const t of camTags) {
      const cfg = parseOutdoorCfgFromTag(t);
      const rig = makeFovOnlyRig(THREE, sceneObject, cfg, 0x00ff00);
      outdoorCams.push({ ...rig, cfg, tagSid: t.sid, label: t.label });
      await initOutdoorGround(rig);

      registerRig({
  id: t.sid || `out-${outdoorCams.length}`,
  label: t.label || `Outdoor ${outdoorCams.length}`,
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
  },
  rebuild: () => {
    const parent = rig.tilt;
    parent.remove(rig.frustum);
    rig.frustum?.traverse?.(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    rig.frustum = buildTruncatedFrustum(THREE, { ...CFG, ...cfg });
    parent.add(rig.frustum);
  },
  applyTilt: () => { rig.tilt.rotation.x = -deg2rad(cfg.tiltDeg); },
});

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
    // update outdoor rigs on movement
    // (we'll still do periodic checks in the animation loop)
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
    currentSweepRoomId = sw?.roomInfo?.id || null;
    if (DEBUG) log('Sweep.current room:', currentSweepRoomId, 'sweepId:', sw?.sid);
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
    const maxDist = rigs.get('cafeteria')?.cfg?.maxDistanceM ?? 25;
    if (DEBUG) log('Distance to cam (m):', dist.toFixed(2));
    if (dist > maxDist) { rootNode.obj3D.visible = false; return; }

    // LOS gate: aim at far-plane center
    const fr = frustumGroup?.userData?.farRect;
    if (fr) {
      const centerLocal = new THREE.Vector3().add(fr[0]).add(fr[1]).add(fr[2]).add(fr[3]).multiplyScalar(0.25);
      const target = tiltPivot.localToWorld(centerLocal.clone());
      const dir = new THREE.Vector3().subVectors(target, viewerPos);
      const len = dir.length();
      if (len > 0.001) {
        dir.normalize();
        const hit = await raycastFirst(viewerPos, dir, len);
        const hitDist = hit?.distance ?? Number.POSITIVE_INFINITY;
        const blocked = !!hit?.hit && hitDist < (len - 0.05);
        if (DEBUG) log('LOS blocked?', blocked, 'hitDist:', hitDist?.toFixed?.(2), 'len:', len.toFixed(2));
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

      if (hit?.hit) {
        worldPts[i] = new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z);
      } else {
        const t = ((CFG.floorY ?? 0) - nW.y) / (fW.y - nW.y);
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

  async function updateOutdoorCamVisibility(rig) {
  // rig may be refs
  const fr = (typeof rig.frustum === 'function' ? rig.frustum() : rig.frustum)?.userData?.farRect;
  if (!rig?.node || !rig?.tilt || !fr) return;

  const camPos = rig.node.obj3D.getWorldPosition(new THREE.Vector3());
  const dist = camPos.distanceTo(viewerPos);
  const maxD = (rig.maxDistanceM ?? 35); // optional per-rig override
  if (dist > maxD) { rig.node.obj3D.visible = false; return; }

  const centerLocal = new THREE.Vector3().add(fr[0]).add(fr[1]).add(fr[2]).add(fr[3]).multiplyScalar(0.25);
  const target = rig.tilt.localToWorld(centerLocal.clone());

  const dir = new THREE.Vector3().subVectors(target, viewerPos);
  const len = dir.length();
  if (len <= 0.001) { rig.node.obj3D.visible = false; return; }
  dir.normalize();

  let hit = null;
  try { hit = await mpSdk.Scene.raycast({ x: viewerPos.x, y: viewerPos.y, z: viewerPos.z }, { x: dir.x, y: dir.y, z: dir.z }, len); } catch (_){}

  const hitDist = hit?.distance ?? Number.POSITIVE_INFINITY;
  const blocked = !!hit?.hit && hitDist < (len - 0.05);
  rig.node.obj3D.visible = !blocked;
}

async function updateOutdoorProjector(rig) {
  const frustum = (typeof rig.frustum === 'function' ? rig.frustum() : rig.frustum);
  if (!rig?.node || !frustum || !rig?.projector) return;

  if (!rig.node.obj3D.visible) { rig.projector.visible = false; return; }

  const nearRect = frustum.userData.nearRect;
  const farRect  = frustum.userData.farRect;
  const u = rig.projectorU ?? 20, v = rig.projectorV ?? 12;

  const nearGrid = [], farGrid = [];
  for (let yi = 0; yi < v; yi++) {
    const ty = yi / (v - 1);
    const nA = new THREE.Vector3().lerpVectors(nearRect[0], nearRect[3], ty);
    const nB = new THREE.Vector3().lerpVectors(nearRect[1], nearRect[2], ty);
    const fA = new THREE.Vector3().lerpVectors(farRect[0],  farRect[3],  ty);
    const fB = new THREE.Vector3().lerpVectors(farRect[1],  farRect[2],  ty);
    for (let xi = 0; xi < u; xi++) {
      const tx = xi / (u - 1);
      nearGrid.push(new THREE.Vector3().lerpVectors(nA, nB, tx));
      farGrid .push(new THREE.Vector3().lerpVectors(fA, fB, tx));
    }
  }

  const worldPts = new Array(nearGrid.length);
  for (let i = 0; i < nearGrid.length; i++) {
    const nW = rig.tilt.localToWorld(nearGrid[i].clone());
    const fW = rig.tilt.localToWorld(farGrid[i].clone());
    const ray = new THREE.Vector3().subVectors(fW, nW);
    const len = ray.length(); ray.normalize();

    let hit = null;
    try { hit = await mpSdk.Scene.raycast({ x:nW.x, y:nW.y, z:nW.z }, { x:ray.x, y:ray.y, z:ray.z }, len); } catch(_){}
    if (hit?.hit) {
      worldPts[i] = new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z);
    } else {
      const floorY = (rig.groundY ?? 0.0);
      const t = (floorY - nW.y) / (fW.y - nW.y);
      if (t < 0 || t > 1 || !Number.isFinite(t)) { rig.projector.visible = false; return; }
      worldPts[i] = new THREE.Vector3().copy(nW).addScaledVector(new THREE.Vector3().subVectors(fW, nW), t);
    }
  }

  rig.projector.visible = true;
  const arr = rig.projector.geometry.attributes.position.array;
  let k = 0;
  for (let yi=0; yi<v-1; yi++){
    for (let xi=0; xi<u-1; xi++){
      const idx = yi*u + xi;
      const p00 = rig.node.obj3D.worldToLocal(worldPts[idx    ].clone());
      const p10 = rig.node.obj3D.worldToLocal(worldPts[idx + 1].clone());
      const p01 = rig.node.obj3D.worldToLocal(worldPts[idx + u].clone());
      const p11 = rig.node.obj3D.worldToLocal(worldPts[idx + u + 1].clone());
      const write = (p)=>{ arr[k++]=p.x; arr[k++]=p.y+0.003; arr[k++]=p.z; };
      write(p00); write(p10); write(p11);
      write(p00); write(p11); write(p01);
    }
  }
  rig.projector.geometry.attributes.position.needsUpdate = true;
  rig.projector.geometry.computeVertexNormals();
}


  // animate cafeteria sweep + all projectors + periodic vis checks
  let phase = 0, last = performance.now();
  let visFrame = 0;
  async function animate(now) {
  const dt = (now - last)/1000; last = now;

  // cafeteria pan sweep
  const yawCenter = deg2rad(CFG.baseYawDeg);
  const yawAmp    = deg2rad(CFG.sweepDeg) * 0.5;
  const yawSpeed  = deg2rad(CFG.yawSpeedDeg);
  phase += yawSpeed * dt;
  panPivot.rotation.y = yawCenter + Math.sin(phase) * yawAmp;

  await updateProjector();

  // Update outdoor rigs safely
  const tasks = [];
  for (const entry of rigs.values()) {
    if (entry.type === 'outdoor') {
      tasks.push(
        updateOutdoorProjector(entry.refs).catch(() => {}),
        updateOutdoorCamVisibility(entry.refs).catch(() => {})
      );
    }
  }
  await Promise.allSettled(tasks);

if ((visFrame = (visFrame + 1) % 30) === 0) updateVisibility();
requestAnimationFrame(animate);
} // <-- close animate() exactly here

// start the loop once
requestAnimationFrame(animate);

// kick first vis check
updateVisibility();
};

main().catch(console.error);