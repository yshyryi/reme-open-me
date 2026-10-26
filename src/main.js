import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BRAND, MODELS, OPEN_TAPS, GUMMY_COUNT, FLAVORS, CARDS } from './data.js';
import { createPouch } from './pouch.js';
import { createGummies, GUMMY_R } from './gummies.js';
import { createUI } from './ui.js';
import { createJuice } from './juice.js';
import { studioEnvironment, backdrop } from './studio.js';
import './style.css';

const SLOW_AT = 0.6; // s after opening when slow-mo kicks in
const SLOW_DUR = 0.45; // ramp duration
const SLOW_SCALE = 0.012; // final time scale
const HANG_SPIN = 0.023; // rotation speed while hanging (fraction of real time)
const REVEAL_AT = 1.5; // infographics appear
const PUSH_FORCE = 0.8;
const TAP_MAX_MOVE = 14; // px
const TILT = -0.26; // jar leans ~15° to the right → gummies stream out along a diagonal
const PULLBACK_DELAY = 0.06; // s: hold the close-up for the first frames of the burst
const PULLBACK_DUR = 1.7;
// depth of field (BokehShader): blur ≈ |depth − focus| · aperture, in UV units
const DOF_APERTURE_CLOSE = 0.0006;
const DOF_APERTURE_OPEN = 0.0015;
const DOF_MAXBLUR = 0.009;
const TAP_MAX_MS = 450;

// Quality: phones get a lighter profile; ?q=high / ?q=lite overrides for testing.
const qParam = new URLSearchParams(location.search).get('q');
const LITE = qParam ? qParam === 'lite' : matchMedia('(pointer: coarse)').matches;
const Q = LITE
  ? { dprMax: 1.6, dprMin: 0.85, msaa: 0, shadow: 512, transmissionScale: 0.5 }
  : { dprMax: 2, dprMin: 1, msaa: 4, shadow: 1024, transmissionScale: 1 };

const lerp = THREE.MathUtils.lerp;
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const smoothstep = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);

main();

async function main() {
  await document.fonts.load('600 40px Manrope').catch(() => {});
  document.body.classList.toggle('lite', LITE);
  if (!LITE) addGrain();

  // ---------- renderer / scene ----------
  const canvas = document.querySelector('#scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  let dpr = Math.min(devicePixelRatio, Q.dprMax);
  renderer.setPixelRatio(dpr);
  if ('transmissionResolutionScale' in renderer) renderer.transmissionResolutionScale = Q.transmissionScale;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = backdrop(renderer.toneMappingExposure);
  scene.environment = studioEnvironment(renderer);
  scene.environmentIntensity = 1;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

  scene.add(new THREE.HemisphereLight('#fff3ea', '#382d2e', 0.25));
  const key = new THREE.DirectionalLight('#fff3e8', 1.8);
  key.position.set(-3, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(Q.shadow, Q.shadow);
  Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 22 });
  key.shadow.radius = 8;
  key.shadow.bias = -0.0005;
  scene.add(key);
  // rim lights to separate the dark jar from the dark background
  const rimA = new THREE.DirectionalLight(BRAND.orange, 2.2);
  rimA.position.set(5, 3, -5);
  const rimB = new THREE.DirectionalLight('#f2ebe7', 1.2);
  rimB.position.set(-5, 2, -4);
  scene.add(rimA, rimB);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ color: '#0a0607', opacity: 0.45 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2.2;
  ground.receiveShadow = true;
  scene.add(ground);

  // the product: a stand-up zip pouch (variable is still called `jar` — same role in the scene)
  const jar = await createPouch(LITE ? MODELS.pouchLite : MODELS.pouch);
  jar.group.rotation.x = 0.08; // tip the top slightly towards the viewer
  jar.group.rotation.z = TILT;
  scene.add(jar.group);
  const lidRest = jar.lidPivot.position.clone();

  const gummies = await createGummies(MODELS.gummy, GUMMY_COUNT, FLAVORS, jar, { lite: LITE });
  gummies.mesh.visible = false; // nothing to draw until the jar opens (saves the transmission pass)
  jar.group.add(gummies.mesh);

  const juice = createJuice(scene);

  // ---------- post: MSAA render → bokeh DOF → tone mapping / sRGB ----------
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Q.msaa }),
  );
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new BokehPass(scene, camera, { focus: 6, aperture: DOF_APERTURE_CLOSE, maxblur: DOF_MAXBLUR });
  composer.addPass(bokeh);
  composer.addPass(new OutputPass());
  const focusPoint = new THREE.Vector3(), jarFocus = new THREE.Vector3();
  const ui = createUI(CARDS, OPEN_TAPS);
  // Warm-up: draw one frame with the gummies + FX enabled so their shaders (transmission, shadows,
  // DOF depth) compile behind the loader instead of hitching the very first frame of the burst.
  gummies.mesh.visible = true;
  juice.root.visible = true;
  composer.render(0);
  gummies.mesh.visible = false;
  juice.root.visible = false;
  document.querySelector('#loader').classList.add('done');

  // ---------- camera framing ----------
  const views = {
    // close-up on the pouch's top (tear strip in view) until it pops
    closed: { target: new THREE.Vector3(0.15, 0.55, 0), dir: new THREE.Vector3(0.1, 0.18, 1).normalize(), w: 3.2, wPortrait: 3.4, h: 4.4 },
    // wide shot, shifted along the tilt so the diagonal stream sits in frame
    open: { target: new THREE.Vector3(-Math.sin(TILT) * 3.4, 2.9, 0), dir: new THREE.Vector3(0, 0.1, 1).normalize(), w: 8.6, wPortrait: 6.4, h: 11 },
  };
  const tanHalf = () => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  function viewPos(v, out) {
    const w = camera.aspect < 0.9 ? v.wPortrait : v.w;
    const d = Math.max(v.h / 2 / tanHalf(), w / 2 / (tanHalf() * camera.aspect));
    return out.copy(v.dir).multiplyScalar(d).add(v.target);
  }
  const camA = new THREE.Vector3(), camB = new THREE.Vector3(), lookAt = new THREE.Vector3();
  let camK = 0, camGoal = 0;
  const parallax = new THREE.Vector2(), parallaxGoal = new THREE.Vector2();

  // ---------- state ----------
  let state = 'idle'; // idle → burst → reveal
  let taps = 0;
  let tear = 0, tearGoal = 0; // how much of the tear strip is ripped (0..1)
  let mouth = 0, mouthVel = 0; // mouth opening spring
  let squash = 0, squashVel = 0; // jar squash & stretch spring
  let shake = 0, punch = 0; // camera shake / fov punch
  let tOpen = 0;
  let hangK = 0;
  const lidVel = new THREE.Vector3();
  let lidSpin = 0;
  let anchors = [];

  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const invQ = new THREE.Quaternion();

  function toScreen(world) {
    const p = tmp2.copy(world).project(camera);
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight, z: p.z };
  }
  function lidScreen() {
    jar.lidPivot.localToWorld(tmp.set(0, 0.3, 0)); // centre of the lid's top, follows the tilt
    const c = toScreen(tmp);
    right.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(jar.lidRadius).add(tmp);
    const e = toScreen(right);
    return { x: c.x, y: c.y, r: Math.hypot(e.x - c.x, e.y - c.y) };
  }

  // ---------- input ----------
  // A stroke = one press. Tap (no movement) opens the jar / moves a card; a drag flicks ONE gummy.
  let stroke = null;
  // a drag that starts on the jar spins it around its own axis (with inertia)
  let spinVel = 0;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function onJar(x, y) {
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(jar.spin, true)[0];
    if (!hit) return null;
    // near the top edge (while still closed) the drag tears the strip; elsewhere it spins the pouch
    const local = jar.spin.worldToLocal(hit.point.clone());
    return state === 'idle' && local.y > jar.rimY - 0.5 ? 'tear' : 'spin';
  }
  // screen length of the tear strip, for converting a swipe into tear progress
  const _ea = new THREE.Vector3(), _eb = new THREE.Vector3();
  function stripScreen() {
    jar.stripEnds(_ea, _eb);
    const a = toScreen(_ea), b = toScreen(_eb);
    return { a: { x: a.x, y: a.y }, b: toScreen(_eb), len: Math.max(80, Math.hypot(b.x - a.x, b.y - a.y)) };
  }
  canvas.addEventListener('pointerdown', (e) => {
    const now = performance.now();
    const hit = onJar(e.clientX, e.clientY);
    stroke = { x0: e.clientX, y0: e.clientY, t0: now, x: e.clientX, y: e.clientY, t: now, hit: false, spin: hit === 'spin', tear: hit === 'tear' };
    if (stroke.spin) spinVel = 0;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
  });
  canvas.addEventListener('pointerup', (e) => {
    if (stroke && stroke.tear && state === 'idle' && tearGoal >= 0.7) tearGoal = 1; // let go late → it rips through
    if (stroke && !stroke.hit) {
      const moved = Math.hypot(e.clientX - stroke.x0, e.clientY - stroke.y0);
      if (moved < TAP_MAX_MOVE && performance.now() - stroke.t0 < TAP_MAX_MS) {
        if (state === 'idle') tap();
        else if (state === 'reveal') tapGummy(e.clientX, e.clientY);
      }
    }
    stroke = null;
  });
  canvas.addEventListener('pointercancel', () => (stroke = null));
  addEventListener('pointermove', (e) => {
    parallaxGoal.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
    if (!stroke) return;
    const now = performance.now();
    if (stroke.tear && state === 'idle') {
      // swipe along the top edge rips the strip off
      // progress = finger travel projected onto the (tilted) strip direction
      const st = stripScreen();
      const ux = (st.b.x - st.a.x) / st.len, uy = (st.b.y - st.a.y) / st.len;
      const along = Math.abs((e.clientX - stroke.x) * ux + (e.clientY - stroke.y) * uy);
      const before = tearGoal;
      tearGoal = Math.min(1, tearGoal + along / st.len);
      if (tearGoal > 0.85) tearGoal = 1; // close enough — finish the rip
      if (Math.floor(before * 6) !== Math.floor(tearGoal * 6)) navigator.vibrate?.(8);
      stroke.x = e.clientX;
      stroke.y = e.clientY;
      stroke.t = now;
      return;
    }
    if (stroke.spin) {
      // angle ≈ arc length / screen radius of the jar
      const k = 1 / Math.max(30, lidScreen().r);
      const dx = e.clientX - stroke.x;
      jar.spin.rotation.y += dx * k;
      spinVel = THREE.MathUtils.lerp(spinVel, (dx * k * 1000) / Math.max(8, now - stroke.t), 0.5);
      stroke.x = e.clientX;
      stroke.y = e.clientY;
      stroke.t = now;
      return;
    }
    if (state === 'idle') return;
    if (!stroke.hit) {
      const dtMs = Math.max(8, now - stroke.t);
      stroke.hit = flick(e.clientX, e.clientY, e.clientX - stroke.x, e.clientY - stroke.y, dtMs);
    }
    stroke.x = e.clientX;
    stroke.y = e.clientY;
    stroke.t = now;
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Space' && state === 'idle') open();
    if (e.code === 'KeyR') reset();
  });
  ui.onReplay(reset);

  // Taps are the fallback: each one rips another third of the strip with a squishy bounce
  function tap() {
    taps++;
    tearGoal = Math.max(tearGoal, Math.min(1, taps / OPEN_TAPS));
    squashVel += 7;
    punch = Math.max(punch, 0.35);
    ui.bump();
    navigator.vibrate?.(12);
  }
  // Gummy under a screen point: the nearest one whose projected disc contains it (with some slack)
  function gummyAt(x, y, slack = 14) {
    const H = innerHeight / (2 * tanHalf());
    let best = -1, bestD = Infinity;
    gummies.items.forEach((g, i) => {
      gummies.worldPosition(i, tmp);
      const dist = tmp.distanceTo(camera.position);
      const s = toScreen(tmp);
      if (s.z > 1) return;
      const rPx = (GUMMY_R * g.scale * H) / dist;
      const d = Math.hypot(s.x - x, s.y - y);
      // prefer closer-to-camera gummies when overlapping
      if (d < rPx + slack && d / rPx + dist * 0.01 < bestD) (bestD = d / rPx + dist * 0.01), (best = i);
    });
    return best;
  }

  // Flick a single gummy along the finger's motion; returns true once one is hit
  function flick(x, y, dx, dy, dtMs) {
    if (hangK < 0.3) return false;
    const pxSpeed = Math.min(4000, Math.hypot(dx, dy) / (dtMs / 1000));
    if (pxSpeed < 30) return false;
    const i = gummyAt(x, y, 22);
    if (i < 0) return false;
    right.setFromMatrixColumn(camera.matrixWorld, 0);
    up.setFromMatrixColumn(camera.matrixWorld, 1);
    jar.group.getWorldQuaternion(invQ).invert();
    const worldPerPx = (2 * camera.position.distanceTo(lookAt) * tanHalf()) / innerHeight;
    const k = PUSH_FORCE * worldPerPx * (1000 / dtMs);
    const impulse = tmp
      .copy(right)
      .multiplyScalar(dx * k)
      .addScaledVector(up, -dy * k)
      .addScaledVector(camera.getWorldDirection(tmp2), (Math.random() - 0.3) * pxSpeed * worldPerPx * 0.2)
      .applyQuaternion(invQ);
    gummies.push(i, impulse);
    navigator.vibrate?.(6);
    return true;
  }

  // Tap a gummy → the card of its flavor moves onto it (only one card per kind on screen)
  function tapGummy(x, y) {
    const i = gummyAt(x, y);
    if (i < 0) return;
    const f = FLAVORS[gummies.items[i].flavor].id;
    const ci = CARDS.findIndex((c) => c.anchor === f);
    if (ci < 0) return;
    const prev = anchors[ci];
    if (prev.type === 'gummy' && prev.i === i) return;
    // if another card sits on the tapped gummy, swap it onto the previous one
    const other = anchors.findIndex((a) => a.type === 'gummy' && a.i === i);
    if (other >= 0) anchors[other] = prev;
    anchors[ci] = { type: 'gummy', i };
    ui.retarget(ci);
    gummies.highlight(usedGummies());
    gummies.items[i].scaleVel -= 6; // little squish
    navigator.vibrate?.(8);
  }

  const progress = () => Math.min(1, tear);

  function open() {
    if (state !== 'idle') return;
    state = 'burst';
    taps = OPEN_TAPS;
    tOpen = 0;
    camGoal = 1;
    gummies.mesh.visible = true;
    gummies.burst(THREE.MathUtils.clamp(camera.aspect, 0.7, 1));
    tear = tearGoal = 1;
    jar.setTear(1);
    lidVel.set(2.6, 7.5, 1.4); // the ripped strip flies off
    lidSpin = -9;
    squashVel -= 16; // stretch up as it pops
    shake = 1;
    punch = 1;
    jar.lidPivot.getWorldPosition(tmp);
    juice.trigger(tmp, jar.group.getWorldQuaternion(new THREE.Quaternion()));
    ui.flash();
    navigator.vibrate?.([30, 20, 60]);
  }

  function reset() {
    state = 'idle';
    taps = tear = tearGoal = mouth = mouthVel = tOpen = hangK = 0;
    jar.setTear(0);
    jar.setMouth(0);
    juice.reset();
    camGoal = 0;
    gummies.reset();
    gummies.mesh.visible = false;
    jar.lidPivot.position.copy(lidRest);
    jar.lidPivot.rotation.set(0, 0, 0);
    jar.lidPivot.visible = true;
    ui.hideCards();
  }

  // ---------- infographic anchors ----------
  const offscreen = (s) => s.z > 1 || s.x < 30 || s.x > innerWidth - 30 || s.y < 70 || s.y > innerHeight - 30;

  function pickAnchor(ci, used) {
    const c = CARDS[ci];
    if (c.anchor === 'jar') return { type: 'jar' };
    const slot = ui.slots()[ci];
    const f = c.anchor === 'any' ? -1 : FLAVORS.findIndex((x) => x.id === c.anchor);
    let best = -1, bestScore = Infinity;
    gummies.items.forEach((g, i) => {
      if (used.includes(i) || (f >= 0 && g.flavor !== f)) return;
      // behind / inside the jar
      if (g.pos.y < jar.rimY + 0.4 && Math.abs(g.pos.x) < jar.radius + 0.2 && g.pos.z < jar.radius + 0.2) return;
      const s = toScreen(gummies.worldPosition(i, tmp));
      if (offscreen(s)) return;
      // prefer gummies ~150px from the card
      const score = Math.abs(Math.hypot(s.x - slot.x, s.y - slot.y) - 150);
      if (score < bestScore) (bestScore = score), (best = i);
    });
    return best < 0 ? { type: 'jar' } : { type: 'gummy', i: best };
  }
  const usedGummies = () => anchors.filter((a) => a.type === 'gummy').map((a) => a.i);

  // Initial assignment; afterwards cards stay glued to their gummy until the user taps another one
  function pickAnchors() {
    anchors = [];
    CARDS.forEach((_, ci) => anchors.push(pickAnchor(ci, usedGummies())));
    gummies.highlight(usedGummies());
  }

  // Invisible walls just outside the visible frame + the floor, in jar-local space
  const bounds = { min: new THREE.Vector3(), max: new THREE.Vector3(), toWorld: new THREE.Matrix4(), toLocal: new THREE.Matrix4(), rot: new THREE.Quaternion() };
  function updateBounds() {
    const d = camera.position.distanceTo(lookAt);
    const halfH = d * tanHalf(), halfW = halfH * camera.aspect;
    bounds.min.set(lookAt.x - halfW - 1.2, ground.position.y + GUMMY_R * 0.85, -4);
    bounds.max.set(lookAt.x + halfW + 1.2, lookAt.y + halfH + 1.2, d * 0.45);
    // gummies live in the (tilted) jar's space; collisions are resolved in world space
    jar.group.updateMatrixWorld();
    bounds.toWorld.copy(jar.group.matrixWorld);
    bounds.toLocal.copy(jar.group.matrixWorld).invert();
    jar.group.getWorldQuaternion(bounds.rot);
  }

  if (import.meta.env.DEV) window.__reme = { scene, jar, camera, gummies, anchors: () => anchors, toScreen, composer, bokeh, renderer, dbg: () => ({ state, tear, tearGoal, taps }) };

  // the pouch's on-screen bounding box (cards try not to sit on it)
  const _corner = new THREE.Vector3();
  function pouchScreenRect() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) {
      jar.spin.localToWorld(_corner.set(sx * jar.halfW, sy ? jar.rimY : jar.baseY, sz * jar.halfD));
      const s = toScreen(_corner);
      x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // ---------- resize ----------
  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    if (state === 'reveal') ui.measure();
  }
  addEventListener('resize', resize);
  resize();

  // ---------- loop ----------
  const clock = new THREE.Clock();
  // FPS HUD: average fps + worst frame over the last half second, render size
  const fpsEl = document.querySelector('#fps');
  // perf HUD: always in dev, on the public build only with ?fps in the URL
  if (!import.meta.env.DEV && !new URLSearchParams(location.search).has('fps')) fpsEl.style.display = 'none';
  let fpsFrames = 0, fpsTime = 0, fpsWorst = 0, frameTris = 0, frameCalls = 0;
  renderer.info.autoReset = false;
  function fpsTick(raw) {
    fpsFrames++;
    fpsTime += raw;
    fpsWorst = Math.max(fpsWorst, raw);
    if (fpsTime < 0.5) return;
    const fps = fpsFrames / fpsTime;
    const px = renderer.getDrawingBufferSize(new THREE.Vector2());
    fpsEl.textContent = `${fps.toFixed(0)} fps · worst ${(fpsWorst * 1000).toFixed(0)} ms · ${px.x}×${px.y} · ${LITE ? 'lite' : 'high'} ${dpr.toFixed(2)}x\n${(frameTris / 1000).toFixed(0)}k tris · ${frameCalls} calls / frame (all passes)`;
    fpsEl.className = fps < 30 ? 'bad' : fps < 50 ? 'warn' : '';
    fpsFrames = fpsTime = fpsWorst = 0;
    adaptResolution(fps);
  }

  // Dynamic resolution: drop render scale quickly when slow, raise it back slowly when there's headroom
  let goodWindows = 0;
  function adaptResolution(fps) {
    let next = dpr;
    if (fps < 48) {
      next = Math.max(Q.dprMin, dpr * (fps < 30 ? 0.8 : 0.9));
      goodWindows = 0;
    } else if (fps > 57) {
      if (++goodWindows >= 4) {
        next = Math.min(Math.min(devicePixelRatio, Q.dprMax), dpr * 1.1);
        goodWindows = 0;
      }
    } else goodWindows = 0;
    if (Math.abs(next - dpr) < 0.01) return;
    dpr = next;
    renderer.setPixelRatio(dpr);
    composer.setPixelRatio(dpr);
    resize();
  }
  renderer.setAnimationLoop(() => {
    const raw = clock.getDelta();
    fpsTick(raw);
    const dt = Math.min(raw, 1 / 30);
    const t = clock.elapsedTime;

    // free spin with light friction (feels like a jar turning on a smooth surface)
    if (!(stroke && stroke.spin)) {
      jar.spin.rotation.y += spinVel * dt;
      spinVel *= Math.exp(-dt * 0.9);
    }

    // squash & stretch spring on the whole jar
    squashVel += (-squash * 260 - squashVel * 13) * dt;
    squash += squashVel * dt;
    const sq = THREE.MathUtils.clamp(squash, -0.6, 0.6) * 0.18;
    jar.group.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);

    if (state === 'idle') {
      jar.group.position.y = Math.sin(t * 1.2) * 0.07;
      jar.group.rotation.y = Math.sin(t * 0.45) * 0.2;
      jar.group.rotation.z = TILT + Math.sin(t * 0.8) * 0.025;
      tear += (tearGoal - tear) * Math.min(1, dt * 14);
      jar.setTear(tear);
      if (tearGoal >= 1 && tear > 0.97) open(); // fully ripped → pop
      gummies.update({ simDt: 0, rotDt: 0, realDt: 0, gravityK: 0, damp: 1, t, hangK: 0 });
    } else {
      tOpen += dt;
      const ts = tOpen < SLOW_AT ? 1 : lerp(1, SLOW_SCALE, easeOutCubic(Math.min(1, (tOpen - SLOW_AT) / SLOW_DUR)));
      hangK = smoothstep(SLOW_AT + 0.3, SLOW_AT + 1.6, tOpen);
      juice.update(dt, dt * ts, hangK, t);
      // mouth springs open as the strip comes off
      mouthVel += ((1 - mouth) * 160 - mouthVel * 8) * dt;
      mouth += mouthVel * dt;
      jar.setMouth(mouth);
      gummies.update({
        simDt: dt * ts,
        rotDt: dt * Math.max(ts, HANG_SPIN),
        realDt: dt,
        gravityK: 1 - hangK,
        damp: Math.exp(-dt * hangK * 1.5),
        t,
        hangK,
        bounds: hangK > 0 ? (updateBounds(), bounds) : null,
      });

      // lid flies off, only partly slowed so it leaves the frame
      if (jar.lidPivot.visible) {
        const lts = Math.max(ts, 0.6) * dt;
        lidVel.y -= 9.8 * lts;
        jar.lidPivot.position.addScaledVector(lidVel, lts);
        jar.lidPivot.rotation.y += lidSpin * lts;
        jar.lidPivot.rotation.z += 2.5 * lts;
        if (jar.lidPivot.position.y < -8 || jar.lidPivot.position.length() > 14) jar.lidPivot.visible = false;
      }
      jar.group.position.y = lerp(jar.group.position.y, Math.sin(t * 0.2) * 0.05, 0.05);

      if (state === 'burst' && tOpen > REVEAL_AT) {
        state = 'reveal';
        gummies.setPlaying(true);
        pickAnchors();
        ui.showCards();
      }
    }

    // camera
    if (state === 'idle') camK += (camGoal - camK) * (1 - Math.exp(-dt * 2.2));
    else camK = easeInOutCubic(THREE.MathUtils.clamp((tOpen - PULLBACK_DELAY) / PULLBACK_DUR, 0, 1)); // pull back out of the close-up
    parallax.lerp(state === 'idle' ? parallaxGoal.clone().multiplyScalar(0.25) : parallaxGoal, 1 - Math.exp(-dt * 2));
    viewPos(views.closed, camA);
    viewPos(views.open, camB);
    camera.position.lerpVectors(camA, camB, camK);
    camera.position.x += parallax.x * lerp(0.3, 0.6, camK);
    camera.position.y -= parallax.y * lerp(0.2, 0.35, camK);
    shake *= Math.exp(-dt * 4.5);
    punch *= Math.exp(-dt * 5);
    camera.position.x += (Math.random() - 0.5) * shake * 0.25;
    camera.position.y += (Math.random() - 0.5) * shake * 0.25;
    camera.fov = 35 - punch * 2.5;
    camera.updateProjectionMatrix();
    lookAt.lerpVectors(views.closed.target, views.open.target, camK);
    camera.lookAt(lookAt);
    camera.updateMatrixWorld();

    // overlay
    const lid = lidScreen();
    ui.setRing(lid.x, lid.y, lid.r, state === 'idle'); // ring itself is hidden in CSS; this drives the hint
    const st = stripScreen();
    ui.setTearGuide(st.a, st.b, progress(), state === 'idle');
    ui.setProgress(progress());
    if (state === 'reveal') {
      const points = anchors.map((a) =>
        toScreen(a.type === 'jar' ? jar.labelAnchor.getWorldPosition(tmp) : gummies.worldPosition(a.i, tmp)),
      );
      ui.layout(points, dt, [pouchScreenRect()]);
    }

    // depth of field: focus on the jar in the close-up, on the middle of the cloud once open
    focusPoint.lerpVectors(jarFocus.setFromMatrixPosition(jar.group.matrixWorld), lookAt, camK);
    bokeh.uniforms.focus.value = camera.position.distanceTo(focusPoint);
    bokeh.uniforms.aperture.value = lerp(DOF_APERTURE_CLOSE, DOF_APERTURE_OPEN, camK);
    renderer.info.reset(); // count every pass of this frame (main, shadow, transmission, DOF depth, post)
    composer.render(dt);
    frameTris = renderer.info.render.triangles;
    frameCalls = renderer.info.render.calls;
  });
}

function addGrain() {
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = c.getContext('2d');
  const img = g.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  document.querySelector('.grain').style.backgroundImage = `url(${c.toDataURL()})`;
}
