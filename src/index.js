import '@matterport/webcomponent';

/* ------------------------ Defaults ------------------------ */
const CFG = {
  // Mount position
  position:   { x: 45.259, y: 4.0, z: -9.45 },

  // Optics
  aspect:     16 / 9,
  hFovDeg:    32,
  near:       0.12,
  far:        19,
  nearApertureScale: 0.22,   // 0.05..1 — shrink near plane for “bezel aperture”

  // Motion
  sweepDeg:   122,
  baseYawDeg: 93,
  tiltDeg:    10,
  yawSpeedDeg: 14,           // slower pan

  // FOV styling
  fovColor:      0x00ff00,
  fillOpacity:   0.08,
  edgeRadius:    0.016,
  baseEdgeRadius:0.010,

  // Projected highlight / depth-aware grid
  floorY: 0.4,
  footprintOpacity: 0.18,
  projectorGrid: { u: 20, v: 12 },

  // Stylized camera colors
  camTop:     0xbfe6f0,  // pale blue
  camBottom:  0xeeeeee,  // white-ish
  camStripe:  0xf59e0b,  // orange
  camText:    '#f59e0b', // canvas uses CSS color
  camWhite:   0xffffff,  // bracket/arm
  cableBlack: 0x111111,
};

const deg2rad = d => d * Math.PI/180;

/* ---------- frustum helpers (near/far truncated frustum) ---------- */
function frustumDims(THREE, hFovDeg, aspect, dist) {
  const h = deg2rad(hFovDeg);
  const v = 2 * Math.atan(Math.tan(h/2) / aspect);
  return { halfW: Math.tan(h/2)*dist, halfH: Math.tan(v/2)*dist, dist };
}

function tubeBetween(THREE, a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len <= 1e-6) return new THREE.Object3D();
  const geom = new THREE.CylinderGeometry(radius, radius, len, 12, 1, true);
  const mesh = new THREE.Mesh(geom, material);
  const up = new THREE.Vector3(0,1,0);
  mesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  return mesh;
}

/** Build a truncated frustum (near cap + far cap + side faces + tubes),
 *  with a shrunk near rectangle to simulate an aperture inside the bezel.
 */
function buildTruncatedFrustum(THREE, cfg) {
  const near = Math.max(0.01, cfg.near);
  const far  = Math.max(near + 0.01, cfg.far);

  const n = frustumDims(THREE, cfg.hFovDeg, cfg.aspect, near);
  const f = frustumDims(THREE, cfg.hFovDeg, cfg.aspect, far);

  const s = THREE.MathUtils.clamp(cfg.nearApertureScale ?? 1, 0.05, 1);
  const nHalfW = n.halfW * s;
  const nHalfH = n.halfH * s;

  const group = new THREE.Group();

  // corners (local; forward is -Z)
  const n0 = new THREE.Vector3(-nHalfW, -nHalfH, -near);
  const n1 = new THREE.Vector3( nHalfW, -nHalfH, -near);
  const n2 = new THREE.Vector3( nHalfW,  nHalfH, -near);
  const n3 = new THREE.Vector3(-nHalfW,  nHalfH, -near);

  const f0 = new THREE.Vector3(-f.halfW, -f.halfH, -far);
  const f1 = new THREE.Vector3( f.halfW, -f.halfH, -far);
  const f2 = new THREE.Vector3( f.halfW,  f.halfH, -far);
  const f3 = new THREE.Vector3(-f.halfW,  f.halfH, -far);

  // Depth ON so FOV is occluded by geometry
  const edgeMat = new THREE.MeshBasicMaterial({
    color: cfg.fovColor, transparent:true, opacity:0.95,
    depthTest:true, depthWrite:true
  });

  // four “rays”
  group.add(tubeBetween(THREE, n0, f0, cfg.edgeRadius, edgeMat));
  group.add(tubeBetween(THREE, n1, f1, cfg.edgeRadius, edgeMat));
  group.add(tubeBetween(THREE, n2, f2, cfg.edgeRadius, edgeMat));
  group.add(tubeBetween(THREE, n3, f3, cfg.edgeRadius, edgeMat));

  // near/far perimeters
  group.add(tubeBetween(THREE, n0, n1, cfg.baseEdgeRadius, edgeMat));
  group.add(tubeBetween(THREE, n1, n2, cfg.baseEdgeRadius, edgeMat));
  group.add(tubeBetween(THREE, n2, n3, cfg.baseEdgeRadius, edgeMat));
  group.add(tubeBetween(THREE, n3, n0, cfg.baseEdgeRadius, edgeMat));

  group.add(tubeBetween(THREE, f0, f1, cfg.baseEdgeRadius, edgeMat));
  group.add(tubeBetween(THREE, f1, f2, cfg.baseEdgeRadius, edgeMat));
  group.add(tubeBetween(THREE, f2, f3, cfg.baseEdgeRadius, edgeMat));
  group.add(tubeBetween(THREE, f3, f0, cfg.baseEdgeRadius, edgeMat));

  // faces (sides + small near cap)
  const pos = [];
  const quads = [
    [n0,n1,f1,f0], [n1,n2,f2,f1], [n2,n3,f3,f2], [n3,n0,f0,f3]
  ];
  for (const [a,b,c,d] of quads) {
    pos.push(a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z);
    pos.push(a.x,a.y,a.z, c.x,c.y,c.z, d.x,d.y,d.z);
  }
  // small near cap (aperture)
  pos.push(n0.x,n0.y,n0.z, n1.x,n1.y,n1.z, n2.x,n2.y,n2.z);
  pos.push(n0.x,n0.y,n0.z, n2.x,n2.y,n2.z, n3.x,n3.y,n3.z);

  const faces = new THREE.BufferGeometry();
  faces.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  faces.computeVertexNormals();
  const fillMat = new THREE.MeshBasicMaterial({
    color: cfg.fovColor, transparent:true, opacity: cfg.fillOpacity,
    side: THREE.DoubleSide, depthTest:true, depthWrite:true
  });
  const mesh = new THREE.Mesh(faces, fillMat);
  group.add(mesh);

  group.userData = { nearRect: [n0,n1,n2,n3], farRect: [f0,f1,f2,f3] };
  return group;
}

/* ---------------------- stylized camera head (tapered) ---------------------- */
function makeSideDecalTexture(THREE) {
  const w = 512, h = 256;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');

  // white base then pale-blue band for top look
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,w,h);
  ctx.fillStyle = '#bfe6f0'; ctx.fillRect(0,0,w,Math.round(h*0.62));

  // orange diagonal stripe
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath(); ctx.moveTo(70,0); ctx.lineTo(118,0); ctx.lineTo(54,h); ctx.lineTo(6,h); ctx.closePath(); ctx.fill();

  // label
  ctx.fillStyle = CFG.camText;
  ctx.font = 'bold 38px system-ui, Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText('Clowbus Security', 160, Math.round(h*0.38));

  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 8; tex.needsUpdate = true;
  return tex;
}

function buildStylizedCamera(THREE) {
  const group = new THREE.Group();

  // Dimensions tuned to match the Matterport demo silhouette
  const L = 0.44;                 // body length (Z)
  const wBack = 0.26,  hBack = 0.16;
  const wFront= 0.20,  hFront= 0.13;    // slightly smaller front → tapered body
  const zF = -L/2, zB = L/2;

  // Materials
  const mWhite = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  const mTop   = new THREE.MeshLambertMaterial({ color: 0xbfe6f0 });
  const mDecal = new THREE.MeshBasicMaterial({ map: makeSideDecalTexture(THREE) });

  // helper to build a quad
  const quad = (a,b,c,d,mat) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array([
      a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z,
      a.x,a.y,a.z, c.x,c.y,c.z, d.x,d.y,d.z
    ]),3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  };

  // front & back faces (white)
  group.add(quad(
    new THREE.Vector3(-wFront/2,-hFront/2,zF),
    new THREE.Vector3( wFront/2,-hFront/2,zF),
    new THREE.Vector3( wFront/2, hFront/2,zF),
    new THREE.Vector3(-wFront/2, hFront/2,zF),
    mWhite
  ));
  group.add(quad(
    new THREE.Vector3(-wBack/2,-hBack/2,zB),
    new THREE.Vector3( wBack/2,-hBack/2,zB),
    new THREE.Vector3( wBack/2, hBack/2,zB),
    new THREE.Vector3(-wBack/2, hBack/2,zB),
    mWhite
  ));

  // top (blue), bottom (white), right (white)
  group.add(quad(
    new THREE.Vector3(-wBack/2, hBack/2, zB),
    new THREE.Vector3( wBack/2, hBack/2, zB),
    new THREE.Vector3( wFront/2, hFront/2, zF),
    new THREE.Vector3(-wFront/2, hFront/2, zF),
    mTop
  ));
  group.add(quad(
    new THREE.Vector3(-wBack/2,-hBack/2, zB),
    new THREE.Vector3( wBack/2,-hBack/2, zB),
    new THREE.Vector3( wFront/2,-hFront/2, zF),
    new THREE.Vector3(-wFront/2,-hFront/2, zF),
    mWhite
  ));
  group.add(quad(
    new THREE.Vector3( wBack/2,-hBack/2, zB),
    new THREE.Vector3( wBack/2, hBack/2, zB),
    new THREE.Vector3( wFront/2, hFront/2, zF),
    new THREE.Vector3( wFront/2,-hFront/2, zF),
    mWhite
  ));

  // left side with UVs for decal
  {
    const a = new THREE.Vector3(-wBack/2,-hBack/2, zB);
    const b = new THREE.Vector3(-wBack/2, hBack/2, zB);
    const c = new THREE.Vector3(-wFront/2, hFront/2, zF);
    const d = new THREE.Vector3(-wFront/2,-hFront/2, zF);
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array([
      a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z,
      a.x,a.y,a.z, c.x,c.y,c.z, d.x,d.y,d.z
    ]);
    const uv = new Float32Array([
      0,1, 0,0, 1,0,
      0,1, 1,0, 1,1
    ]);
    g.setAttribute('position', new THREE.BufferAttribute(pos,3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv,2));
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, mDecal));
  }

  // slim white “lip” under body
  const lip = new THREE.Mesh(
    new THREE.BoxGeometry((wBack+wFront)/2*0.98, 0.014, L*0.88),
    new THREE.MeshLambertMaterial({ color: 0xffffff })
  );
  lip.position.y = -Math.min(hBack,hFront)*0.40;
  lip.position.z = -L*0.05;
  group.add(lip);

  // bezel + housing + lens + glow
  const bezel = new THREE.Mesh(
    new THREE.RingGeometry(0.058, 0.082, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent:true, opacity:0.95 })
  );
  bezel.rotation.y = Math.PI;
  bezel.position.z = zF - 0.002;
  group.add(bezel);

  const housing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.062, 0.062, 0.022, 24),
    new THREE.MeshLambertMaterial({ color: 0x222222 })
  );
  housing.rotation.x = Math.PI/2; housing.rotation.z = Math.PI/2;
  housing.position.z = zF - 0.018;
  group.add(housing);

  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052, 0.052, 0.055, 24),
    new THREE.MeshBasicMaterial({ color: 0x76ff76, transparent:true, opacity:0.35 })
  );
  lens.rotation.x = Math.PI/2; lens.rotation.z = Math.PI/2;
  lens.position.z = zF - 0.045;
  group.add(lens);

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 18, 14),
    new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent:true, opacity:0.28 })
  );
  glow.position.z = zF - 0.028;
  group.add(glow);

  // bracket / arm / base (white), plus cable
  const white = new THREE.MeshLambertMaterial({ color: CFG.camWhite });

  const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.06), white);
  hinge.position.set(0, -hBack*0.60, -L*0.12);
  group.add(hinge);

  const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 16), white);
  arm1.rotation.z = -0.35;
  arm1.position.set(0.06, -hBack*0.95, -L*0.14);
  group.add(arm1);

  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), white);
  joint.position.set(0.11, -hBack*1.15, -L*0.12);
  group.add(joint);

  const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 16), white);
  arm2.rotation.z = 0.25;
  arm2.position.set(0.17, -hBack*1.30, -L*0.10);
  group.add(arm2);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.012, 24), white);
  base.position.set(0.20, -hBack*1.40, -L*0.08);
  group.add(base);

  // cable
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0.00, -hBack*0.30, -L*0.12),
    new THREE.Vector3(0.08, -hBack*0.95, -L*0.14),
    new THREE.Vector3(0.20, -hBack*1.37, -L*0.08)
  );
  const tube = new THREE.TubeGeometry(curve, 18, 0.0045, 10, false);
  const cable = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: CFG.cableBlack }));
  group.add(cable);

  return group;
}

/* ---------------------------- UI panel ---------------------------- */
function makePanel() {
  const id = 'fov-panel';
  document.getElementById(id)?.remove();

  const wrap = document.createElement('div');
  wrap.id = id;
  wrap.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:rgba(0,0,0,.68);' +
    'color:#fff;padding:12px;border-radius:12px;font:14px/1.15 system-ui,Arial;width:220px;' +
    'box-shadow:0 6px 18px rgba(0,0,0,.35);user-select:none;pointer-events:auto;';
  wrap.innerHTML = `<div style="font-weight:700;margin-bottom:10px;text-align:center;">Camera FOV Controls</div>`;
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;gap:8px;';
  wrap.appendChild(grid);

  function row(label, get, set, step, unit, min, max, decimals=0) {
    const name = document.createElement('div'); name.textContent = label; name.style.cssText='align-self:center;';
    const mk=(t,d)=>{const b=document.createElement('button');b.textContent=t;b.style.cssText='background:#14b8a6;border:none;color:#001;font-weight:800;border-radius:10px;padding:10px 12px;cursor:pointer;';
      const act=(e)=>{e.preventDefault();const v=Math.max(min,Math.min(max,+(get()+d).toFixed(decimals)));set(v);val.textContent=`${get().toFixed(decimals)}${unit}`;};
      b.addEventListener('click',act,{passive:false});b.addEventListener('touchstart',act,{passive:false});return b;};
    const minus=mk('−',-step), plus=mk('+',step);
    const val=document.createElement('div'); val.style.cssText='grid-column:1 / span 3;text-align:center;font-weight:700;'; val.textContent=`${get().toFixed(decimals)}${unit}`;
    grid.appendChild(name); grid.appendChild(minus); grid.appendChild(plus); grid.appendChild(val);
  }

  const footer=document.createElement('div'); footer.style.cssText='display:flex;gap:8px;margin-top:10px;';
  const reset=document.createElement('button'); reset.textContent='Reset'; reset.style.cssText='flex:1;background:#f59e0b;border:none;border-radius:10px;padding:10px;color:#111;font-weight:800;';
  const hide=document.createElement('button'); hide.textContent='Hide'; hide.style.cssText='flex:1;background:#64748b;border:none;border-radius:10px;padding:10px;color:#fff;font-weight:800;';
  footer.appendChild(reset); footer.appendChild(hide); wrap.appendChild(footer); document.body.appendChild(wrap);

  return { wrap, grid, row, reset, hide };
}

/* ------------------------------ main ------------------------------ */
const main = async () => {
  const viewer = document.querySelector('matterport-viewer');
  const mpSdk = await viewer.playingPromise;
  const THREE = window.THREE;

  await mpSdk.Mode.moveTo(mpSdk.Mode.Mode.INSIDE);

  const [sceneObject] = await mpSdk.Scene.createObjects(1);
  const node = sceneObject.addNode();

  // Soft lighting so Lambert materials shade nicely
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.6);
  const dir  = new THREE.DirectionalLight(0xffffff, 0.5);
  dir.position.set(1, 2, 1);
  node.obj3D.add(hemi, dir);

  // Rig: yaw parent, tilt child
  const panPivot  = new THREE.Object3D();
  const tiltPivot = new THREE.Object3D();
  panPivot.add(tiltPivot);
  node.obj3D.add(panPivot);

  node.obj3D.position.set(CFG.position.x, CFG.position.y, CFG.position.z);

  // Styled camera head + internal THREE camera
  const head = buildStylizedCamera(THREE);
  tiltPivot.add(head);

  const dimsFar = frustumDims(THREE, CFG.hFovDeg, CFG.aspect, CFG.far);
  const vFovDeg = THREE.MathUtils.radToDeg(2 * Math.atan(dimsFar.halfH / CFG.far));
  const cam = new THREE.PerspectiveCamera(vFovDeg, CFG.aspect, Math.max(0.01, CFG.near), CFG.far);
  cam.position.set(0,0,0);
  cam.lookAt(new THREE.Vector3(0,0,-1));
  tiltPivot.add(cam);
  tiltPivot.userData.frustumCam = cam;

  // Truncated frustum
  let frustumGroup = buildTruncatedFrustum(THREE, CFG);
  tiltPivot.add(frustumGroup);

  // Projector (depth-aware via raycast; falls back to floor)
  const projector = {
    u: CFG.projectorGrid.u, v: CFG.projectorGrid.v,
    geom: new THREE.BufferGeometry(),
    mat:  new THREE.MeshBasicMaterial({
      color: CFG.fovColor, transparent: true, opacity: CFG.footprintOpacity,
      side: THREE.DoubleSide, depthTest:true, depthWrite:true
    }),
    mesh: null,
  };
  (function initProjector(){
    const {u,v} = projector;
    const tris  = (u-1)*(v-1)*2;
    projector.geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(tris*9), 3));
    projector.mesh = new THREE.Mesh(projector.geom, projector.mat);
    node.obj3D.add(projector.mesh);
  })();

  function applyTilt(){ tiltPivot.rotation.x = -deg2rad(CFG.tiltDeg); }
  applyTilt();
  node.start();

  /* ------------------ VISIBILITY GATING (mode + room + LoS + distance) ------------------ */
  const BOUND_ROOM_ID = 'cdz3fkt38kae7tapstpt0eaeb'; // cafeteria room

  const VIS = {
    allowModes: new Set([mpSdk.Mode.Mode.INSIDE /*, mpSdk.Mode.Mode.FLOORPLAN*/]),
    maxDistance: 18,      // meters (tighten to kill far-away visibility)
    losIntervalMs: 240,   // LoS throttle
    useRooms: true
  };

  let currentMode = mpSdk.Mode.current?.value ?? mpSdk.Mode.Mode.INSIDE;
  let currentRooms = new Set();

  mpSdk.Mode.current.subscribe(mode => { currentMode = mode; updateVisibility(); });

  mpSdk.Room.current.subscribe(ids => {
    // Helpful for debugging; you should see this when moving.
    console.log('Room.current IDs:', ids);
    currentRooms = new Set(ids || []);
    updateVisibility();
  });

  const rigWorld = new THREE.Vector3();

  async function getViewerPosition() {
    if (typeof mpSdk.Camera.getPosition === 'function') {
      return mpSdk.Camera.getPosition();
    }
    const pose = mpSdk.Camera.pose?.value;
    return pose?.position ?? null;
  }

  async function updateVisibility() {
    // Mode gate
    if (!VIS.allowModes.has(currentMode)) { node.obj3D.visible = false; return; }

    // Room gate (presence in the set is enough; distance/LoS will tighten it)
    if (VIS.useRooms && !currentRooms.has(BOUND_ROOM_ID)) {
      node.obj3D.visible = false; return;
    }

    try {
      const camPos = await getViewerPosition();
      if (!camPos) { node.obj3D.visible = true; return; }

      const viewer = new THREE.Vector3(camPos.x, camPos.y, camPos.z);
      rigWorld.setFromMatrixPosition(node.obj3D.matrixWorld);

      // Distance gate
      const seg = new THREE.Vector3().subVectors(rigWorld, viewer);
      const len = seg.length();
      if (len > VIS.maxDistance) { node.obj3D.visible = false; return; }

      // Line-of-sight gate
      const dir = seg.clone().normalize();
      const hit = await mpSdk.Scene.raycast(
        { x: viewer.x, y: viewer.y, z: viewer.z },
        { x: dir.x,    y: dir.y,    z: dir.z },
        Math.max(0, len - 0.05)
      );

      const blocked = hit?.hit && (hit.distance ?? len) < (len - 0.05);
      node.obj3D.visible = !blocked;
    } catch {
      // Fail-open if raycast not available
      node.obj3D.visible = true;
    }
  }

  setInterval(updateVisibility, VIS.losIntervalMs);
  updateVisibility();
  /* -------------------------------------------------------------------------------------- */

  async function raycastFirst(origin, direction, maxDist) {
    try {
      if (typeof mpSdk.Scene.raycast === 'function') {
        const hit = await mpSdk.Scene.raycast(
          { x: origin.x, y: origin.y, z: origin.z },
          { x: direction.x, y: direction.y, z: direction.z },
          maxDist
        );
        if (hit?.hit) return new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z);
      } else if (mpSdk.Camera?.rayCast) {
        const res = await mpSdk.Camera.rayCast(
          { x: origin.x, y: origin.y, z: origin.z },
          { x: direction.x, y: direction.y, z: direction.z },
          maxDist
        );
        if (res?.hit) return new THREE.Vector3(res.position.x, res.position.y, res.position.z);
      }
    } catch(_) {}
    return null;
  }

  let projectorFrame = 0;
  async function updateProjector() {
    // throttle ~10 fps
    projectorFrame = (projectorFrame + 1) % 6;
    if (projectorFrame !== 0) return;

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
      let hit = await raycastFirst(nW, dir, len);
      if (!hit) {
        // floor fallback to your FLOOR value
        const t = (CFG.floorY - nW.y) / (fW.y - nW.y);
        if (t < 0 || t > 1 || !Number.isFinite(t)) { projector.mesh.visible = false; return; }
        hit = new THREE.Vector3().copy(nW).addScaledVector(new THREE.Vector3().subVectors(fW, nW), t);
      }
      worldPts[i] = hit;
    }
    projector.mesh.visible = true;

    const arr = projector.geom.attributes.position.array;
    let k = 0;
    for (let yi=0; yi<v-1; yi++){
      for (let xi=0; xi<u-1; xi++){
        const idx = yi*u + xi;
        const p00 = node.obj3D.worldToLocal(worldPts[idx    ].clone());
        const p10 = node.obj3D.worldToLocal(worldPts[idx + 1].clone());
        const p01 = node.obj3D.worldToLocal(worldPts[idx + u].clone());
        const p11 = node.obj3D.worldToLocal(worldPts[idx + u + 1].clone());

        const write = (p)=>{ arr[k++]=p.x; arr[k++]=p.y+0.003; arr[k++]=p.z; };
        write(p00); write(p10); write(p11);
        write(p00); write(p11); write(p01);
      }
    }
    projector.geom.attributes.position.needsUpdate = true;
    projector.geom.computeVertexNormals();
  }

  // animate pan + projector
  let phase = 0, last = performance.now();
  async function animate(now) {
    const dt = (now - last)/1000; last = now;
    const yawCenter = deg2rad(CFG.baseYawDeg);
    const yawAmp    = deg2rad(CFG.sweepDeg)*0.5;
    const yawSpeed  = deg2rad(CFG.yawSpeedDeg);
    phase += yawSpeed*dt;
    panPivot.rotation.y = yawCenter + Math.sin(phase)*yawAmp;

    await updateProjector();
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  // rebuild frustum + sync THREE camera
  function rebuildFrustum() {
    tiltPivot.remove(frustumGroup);
    frustumGroup.traverse?.(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
    frustumGroup = buildTruncatedFrustum(THREE, CFG);
    tiltPivot.add(frustumGroup);

    const dimsFar2 = frustumDims(THREE, CFG.hFovDeg, CFG.aspect, CFG.far);
    const cam = tiltPivot.userData.frustumCam;
    if (cam) {
      cam.fov   = THREE.MathUtils.radToDeg(2 * Math.atan(dimsFar2.halfH / CFG.far));
      cam.aspect= CFG.aspect;
      cam.near  = Math.max(0.01, CFG.near);
      cam.far   = CFG.far;
      cam.updateProjectionMatrix();
    }
    // Visibility can change when optics move
    updateVisibility();
  }

  /* --------------------------- Controls --------------------------- */
  const ui = makePanel();
  ui.row('HFOV',     () => CFG.hFovDeg,           v => { CFG.hFovDeg=v;   rebuildFrustum(); }, 1,    '°', 10,120);
  ui.row('NEAR',     () => CFG.near,              v => { CFG.near=v;      rebuildFrustum(); }, 0.01, '',  0.02, 1, 2);
  ui.row('FAR',      () => CFG.far,               v => { CFG.far=v;       rebuildFrustum(); }, 1,    '',  5,120);
  ui.row('APERTURE', () => CFG.nearApertureScale, v => { CFG.nearApertureScale=v; rebuildFrustum(); }, 0.01, '', 0.05, 1, 2);
  ui.row('SWEEP',    () => CFG.sweepDeg,          v => { CFG.sweepDeg=v; }, 2,  '°', 10,170);
  ui.row('YAW',      () => CFG.baseYawDeg,        v => { CFG.baseYawDeg=v; }, 1, '°', -180,180);
  ui.row('TILT',     () => CFG.tiltDeg,           v => { CFG.tiltDeg=v; applyTilt(); }, 1, '°', 0,85);
  ui.row('HEIGHT',   () => node.obj3D.position.y, v => { node.obj3D.position.y=v; CFG.position.y=v; updateVisibility(); }, 0.1,'', -100,100,1);
  ui.row('FLOOR',    () => CFG.floorY ?? 0,       v => { CFG.floorY=v; }, 0.1,'', -100,100,1);

  ui.reset.addEventListener('click', e => {
    e.preventDefault();
    Object.assign(CFG, {
      position:{...CFG.position, y:4.0}, aspect:16/9, hFovDeg:32, near:0.12, far:19,
      nearApertureScale:0.22,
      sweepDeg:122, baseYawDeg:93, tiltDeg:10, yawSpeedDeg:14,
      fovColor:0x00ff00, fillOpacity:0.08, edgeRadius:0.016, baseEdgeRadius:0.010,
      camTop:0xbfe6f0, camBottom:0xeeeeee, camStripe:0xf59e0b, camText:'#f59e0b', camWhite:0xffffff, cableBlack:0x111111,
      floorY: 0.4, footprintOpacity:0.18, projectorGrid:{u:20,v:12},
    });
    node.obj3D.position.y = CFG.position.y;
    rebuildFrustum(); applyTilt(); updateVisibility();
  });

  ui.hide.addEventListener('click', e => {
    e.preventDefault();
    ui.wrap.style.display = (ui.wrap.style.display==='none') ? 'block':'none';
  });
};

main().catch(console.error);