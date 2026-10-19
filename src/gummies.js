import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const GUMMY_SIZE = 0.31; // diameter ≈ 17.7 mm at the pouch's scale (101 mm wide = 1.77 units); 3 g gelatin gummy ≈ Ø16.5 mm
export const GUMMY_R = GUMMY_SIZE / 2;
const VARIANTS = 3; // distinct hand-made-looking shapes per flavor
const G = 9.8;
const WALL_BOUNCE = 0.5; // off-screen walls give back half the speed
const FLOOR_BOUNCE = 0.42;
const JAR_BOUNCE = 0.35;
const SPAWN_GAP = 0.013; // s between gummies squeezing out of the mouth
const BURST_RESTITUTION = 0.15; // first flight: gummies just slide off each other
const PLAY_RESTITUTION = 0.65; // later: lively bumps

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

// jar: { rimY, innerR } in jar-local units
// opts.lite: phone profile — fewer polys/crystals, no dispersion, opaque sugar
export async function createGummies(url, count, flavors, jar, { lite = false } = {}) {
  const { rimY, innerR } = jar;
  let playing = false; // set once the burst has settled — switches collisions to 'playful'
  let bursting = false; // collisions only run once the jar has opened
  const custom = url && (await loadGeometry(url));
  const shapes = Array.from({ length: VARIANTS }, () => custom || gummyGeometry(lite));

  const frost = frostNormalMap();
  const gloss = glossMap();

  // One InstancedMesh per flavor × shape so each flavor gets its own translucent tint
  const group = new THREE.Group();
  const meshes = [];
  flavors.forEach((f) => {
    const c = new THREE.Color(f.color);
    // Marmalade: fully transmissive body; colour comes from absorption through its thickness,
    // so thin edges glow light and the core goes deep. Real refraction (+ a touch of dispersion).
    const jelly = new THREE.MeshPhysicalMaterial({
      color: c.clone().lerp(new THREE.Color('#ffffff'), 0.35),
      // roughness also blurs what's seen through the jelly, so keep it moderate for clarity;
      // the lacquer look is killed via low specular + micro-bumps instead. × gloss map → ~0.1 … ~0.4
      roughness: 0.45,
      roughnessMap: gloss,
      transmission: 1,
      thickness: GUMMY_SIZE * 0.9,
      ior: 1.45,
      dispersion: lite ? 0 : 0.35, // dispersion triples transmission sampling — desktop only
      attenuationColor: c,
      attenuationDistance: GUMMY_SIZE * 1.05, // relative to size: same colour depth at any scale
      specularIntensity: 0.28, // weak surface reflection → no wet/lacquered look
      specularColor: new THREE.Color('#ffffff'),
      emissive: c,
      emissiveIntensity: 0.1, // a bit of internal scatter keeps the colour alive over the dark set
      sheen: 0.35, // soft sugar-dust bloom on the rims instead of mirror highlights
      sheenRoughness: 0.8,
      sheenColor: c.clone().lerp(new THREE.Color('#ffffff'), 0.5),
      normalMap: frost,
      normalScale: new THREE.Vector2(0.35, 0.35), // micro-bumps break up the remaining highlights
    });
    // sugar crystals: tiny clear grains that sparkle
    const sugarTint = c.clone().lerp(new THREE.Color('#ffffff'), 0.75);
    const sugar = lite
      ? new THREE.MeshStandardMaterial({ color: sugarTint, roughness: 0.2, emissive: c, emissiveIntensity: 0.08 })
      : new THREE.MeshPhysicalMaterial({
          color: sugarTint,
          roughness: 0.15,
          transmission: 0.85,
          thickness: 0.01,
          ior: 1.55,
          specularIntensity: 1,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
        });
    shapes.forEach((geo) => {
      const mesh = new THREE.InstancedMesh(geo, custom ? jelly : [jelly, sugar], Math.ceil(count / flavors.length));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      group.add(mesh);
      meshes.push(mesh);
    });
  });

  const items = Array.from({ length: count }, (_, i) => {
    const flavor = i % flavors.length;
    const mesh = meshes[flavor * VARIANTS + (Math.floor(i / flavors.length) % VARIANTS)];
    return {
      flavor,
      mesh,
      slot: mesh.count++,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      out: new THREE.Vector3(),
      drift: new THREE.Vector3(),
      kick: new THREE.Vector3(), // pushed by the user, simulated in real time
      kickSpin: 0,
      quat: new THREE.Quaternion(),
      axis: new THREE.Vector3(),
      spin: 0,
      delay: 0,
      kicked: false,
      phase: Math.random() * Math.PI * 2,
      scale: 1,
      scaleVel: 0,
      targetScale: 1,
    };
  });

  let floatK = 0;
  let time = 0;

  // Hanging bob — deliberately slow
  function offset(g, out) {
    return out
      .set(Math.sin(time * 0.23 + g.phase) * 0.05, Math.sin(time * 0.37 + g.phase * 1.7) * 0.07, 0)
      .multiplyScalar(floatK);
  }

  function writeMatrices() {
    for (const g of items) {
      _v.copy(g.pos).add(offset(g, _s));
      _s.setScalar(g.kicked ? Math.max(0.01, g.scale) : 0); // not out of the jar yet → not rendered
      g.mesh.setMatrixAt(g.slot, _m.compose(_v, g.quat, _s));
    }
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  }

  // The closed jar is opaque, so it holds no actual gummies: they are spawned right at the mouth
  // when it opens (squeezed small, popping to size). Nothing can ever poke through the glass.
  function spawn(g) {
    if (jar.spawnPoint) jar.spawnPoint(g.pos);
    else {
      const r = Math.sqrt(Math.random()) * innerR * 0.55;
      const a = Math.random() * Math.PI * 2;
      g.pos.set(Math.cos(a) * r, rimY + GUMMY_R * 0.4, Math.sin(a) * r);
    }
    g.vel.set(0, g.launch, 0).add(g.out);
    g.kicked = true;
    g.scale = 0.3;
    g.scaleVel = 9;
  }

  function reset() {
    items.forEach((g) => {
      g.pos.set(0, rimY - 0.3, 0);
      g.quat.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      g.vel.set(0, 0, 0);
      g.kick.set(0, 0, 0);
      g.kickSpin = 0;
      g.kicked = false;
      g.scale = g.targetScale = 1;
      g.scaleVel = 0;
    });
    floatK = 0;
    playing = bursting = false;
    writeMatrices();
  }

  // Chaotic burst: each gummy gets its own launch power, direction (incl. depth) and timing
  function burst(spread = 1) {
    bursting = true;
    const order = items.map((_, i) => i).sort(() => Math.random() - 0.5);
    order.forEach((idx, k) => {
      const g = items[idx];
      g.delay = 0.04 + k * SPAWN_GAP + Math.random() * 0.008; // one after another, like a fountain
      g.launch = 2 + Math.random() * 13; // vertical speed at the mouth → even spread along the line
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.pow(Math.random(), 0.8) * 4; // narrow-ish: a stream along the jar's axis
      g.out.set(Math.cos(a) * s * spread, Math.random() * 6 - 0.6, Math.sin(a) * s * 0.9 + 0.8); // up & out — never back into the jar
      g.drift.randomDirection().multiplyScalar(0.04 + Math.random() * 0.08);
      g.axis.randomDirection();
      g.spin = 3 + Math.random() * 12;
      g.kicked = false;
    });
  }

  // Invisible walls just outside the frame + the visible floor, in WORLD space (the jar is tilted).
  // b: { min, max (world), toWorld, toLocal (Matrix4), rot (Quaternion local→world) }. Reflect with energy loss.
  const _w = new THREE.Vector3(), _k = new THREE.Vector3(), _vl = new THREE.Vector3(), _d = new THREE.Vector3();
  const _qi = new THREE.Quaternion();
  function collide(g, b) {
    _w.copy(g.pos).applyMatrix4(b.toWorld);
    let hit = false;
    for (const k of ['x', 'y', 'z']) if (_w[k] < b.min[k] || _w[k] > b.max[k]) hit = true;
    if (!hit) return;
    _qi.copy(b.rot).invert();
    _k.copy(g.kick).applyQuaternion(b.rot);
    _vl.copy(g.vel).applyQuaternion(b.rot);
    _d.copy(g.drift).applyQuaternion(b.rot);
    for (const k of ['x', 'y', 'z']) {
      const floor = k === 'y';
      const e = floor ? FLOOR_BOUNCE : WALL_BOUNCE;
      if (_w[k] < b.min[k]) {
        _w[k] = b.min[k];
        if (_k[k] < 0) _k[k] *= -e;
        if (_vl[k] < 0) _vl[k] *= -e;
        if (_d[k] < 0) _d[k] *= -1;
        if (floor) {
          // friction + a roll on landing
          _k.x *= 0.8;
          _k.z *= 0.8;
          g.kickSpin = Math.max(g.kickSpin * 0.7, Math.hypot(_k.x, _k.z) * 4);
          if (Math.abs(_k.y) > 0.3) g.scaleVel -= 2.5; // squish
        }
      } else if (_w[k] > b.max[k]) {
        _w[k] = b.max[k];
        if (_k[k] > 0) _k[k] *= -e;
        if (_vl[k] > 0) _vl[k] *= -e;
        if (_d[k] > 0) _d[k] *= -1;
      }
    }
    g.pos.copy(_w).applyMatrix4(b.toLocal);
    g.kick.copy(_k).applyQuaternion(_qi);
    g.vel.copy(_vl).applyQuaternion(_qi);
    g.drift.copy(_d).applyQuaternion(_qi);
  }

  // --- collisions -----------------------------------------------------------------------
  const _n = new THREE.Vector3(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _o = new THREE.Vector3();

  // bounce a gummy's velocities off a surface with normal n
  function reflect(g, n, e) {
    for (const v of [g.vel, g.kick]) {
      const vn = v.dot(n);
      if (vn < 0) v.addScaledVector(n, -(1 + e) * vn);
    }
    const dn = g.drift.dot(n);
    if (dn < 0) g.drift.addScaledVector(n, -2 * dn);
  }

  // the jar as a solid cylinder (gummies live in its space, so the axis is local Y)
  function collideJar(g) {
    const pad = GUMMY_R * 0.92 * g.scale;
    if (jar.halfW) {
      // pouch: a box (slightly slimmer than its widest point)
      const hx = jar.halfW + pad, hz = jar.halfD * 0.85 + pad, top = rimY + pad, bottom = jar.baseY - pad;
      const ax = Math.abs(g.pos.x), az = Math.abs(g.pos.z);
      if (ax >= hx || az >= hz || g.pos.y >= top || g.pos.y <= bottom) return;
      const px = hx - ax, pz = hz - az, py = top - g.pos.y;
      if (py <= px && py <= pz) {
        _n.set(0, 1, 0);
        g.pos.y = top;
      } else if (px <= pz) {
        _n.set(Math.sign(g.pos.x) || 1, 0, 0);
        g.pos.x = _n.x * hx;
      } else {
        _n.set(0, 0, Math.sign(g.pos.z) || 1);
        g.pos.z = _n.z * hz;
      }
      reflect(g, _n, JAR_BOUNCE);
      if (playing) g.scaleVel -= 1.5;
      return;
    }
    const R = jar.radius + pad, top = rimY + pad, bottom = jar.baseY - pad;
    const r = Math.hypot(g.pos.x, g.pos.z);
    if (r >= R || g.pos.y >= top || g.pos.y <= bottom) return;
    if (R - r < top - g.pos.y) {
      _n.set(r > 1e-4 ? g.pos.x / r : 1, 0, r > 1e-4 ? g.pos.z / r : 0);
      g.pos.x = _n.x * R;
      g.pos.z = _n.z * R;
    } else {
      _n.set(0, 1, 0);
      g.pos.y = top;
    }
    reflect(g, _n, JAR_BOUNCE);
    if (playing) g.scaleVel -= 1.5;
  }

  // gummy ↔ gummy: separate overlaps and exchange the approaching part of their velocities.
  function collidePairs() {
    const e = playing ? PLAY_RESTITUTION : BURST_RESTITUTION;
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (!a.kicked) continue;
      _pa.copy(a.pos).add(offset(a, _o));
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (!b.kicked) continue;
        _pb.copy(b.pos).add(offset(b, _o));
        _n.subVectors(_pb, _pa);
        const dist = _n.length();
        const minD = GUMMY_R * (a.scale + b.scale) * 0.98;
        if (dist >= minD || dist < 1e-6) continue;
        _n.divideScalar(dist);
        const push = (minD - dist) / 2;
        a.pos.addScaledVector(_n, -push);
        b.pos.addScaledVector(_n, push);
        _pa.addScaledVector(_n, -push);
        let hit = 0;
        for (const k of ['vel', 'kick']) {
          const rel = _o.subVectors(b[k], a[k]).dot(_n);
          if (rel >= 0) continue;
          const imp = (-(1 + e) * rel) / 2;
          a[k].addScaledVector(_n, -imp);
          b[k].addScaledVector(_n, imp);
          if (k === 'kick') hit = imp;
        }
        const da = a.drift.dot(_n), db = b.drift.dot(_n);
        if (da > db) {
          a.drift.addScaledVector(_n, db - da);
          b.drift.addScaledVector(_n, da - db);
        }
        if (playing && hit > 0.05) {
          // a knock sets them tumbling and squishes them a bit
          for (const g of [a, b]) {
            g.axis.randomDirection();
            g.kickSpin = Math.min(25, g.kickSpin + hit * 4);
            g.scaleVel -= Math.min(3, hit * 2);
          }
        }
      }
    }
  }

  function setPlaying(v) {
    playing = v;
  }

  // simDt: time-scaled step; rotDt: rotation step; realDt: unscaled frame time
  // gravityK 1→0 and damp (per-frame multiplier) make gummies "hang"; bounds: {min,max} jar-local
  function update({ simDt, rotDt, realDt, gravityK, damp, t, hangK, bounds }) {
    time = t;
    floatK = hangK;
    const kickDamp = Math.exp(-realDt * 0.55); // low air drag so flicks reach the walls / floor
    for (const g of items) {
      // springy scale (pop when leaving the jar / highlight / impacts)
      g.scaleVel += ((g.targetScale - g.scale) * 140 - g.scaleVel * 9) * realDt;
      g.scale += g.scaleVel * realDt;
      if (g.delay > 0) {
        g.delay -= simDt;
        continue;
      }
      if (!g.kicked) {
        if (!bursting) continue; // still "in the jar" (not rendered)
        spawn(g);
      }
      g.vel.y -= G * gravityK * simDt;
      g.vel.multiplyScalar(damp);
      g.pos.addScaledVector(g.vel, simDt);
      // slow, independent drift while hanging
      g.pos.addScaledVector(g.drift, realDt * hangK);

      // user pushes
      if (g.kickSpin > 0.01 || g.kick.lengthSq() > 1e-6) {
        g.pos.addScaledVector(g.kick, realDt);
        g.kick.multiplyScalar(kickDamp);
        g.kickSpin *= kickDamp;
        g.quat.multiply(_q.setFromAxisAngle(g.axis, g.kickSpin * realDt));
      }
      if (g.kicked) collideJar(g);
      if (bounds && g.kicked) collide(g, bounds);

      if (g.kicked) g.quat.multiply(_q.setFromAxisAngle(g.axis, g.spin * rotDt));
    }
    if (bursting) for (let it = 0; it < 3; it++) collidePairs(); // a few passes so clusters fully separate
    writeMatrices();
  }

  // impulse: local-space velocity (units/s)
  function push(i, impulse) {
    const g = items[i];
    g.kick.add(impulse);
    g.kickSpin = Math.min(25, g.kickSpin + impulse.length() * 3);
    g.axis.randomDirection();
    g.scaleVel -= Math.min(4, impulse.length()) * 1.5; // little squish on hit
  }

  function worldPosition(i, out) {
    return out.copy(items[i].pos).add(offset(items[i], _s)).applyMatrix4(group.matrixWorld);
  }

  function highlight(indices) {
    items.forEach((g, i) => (g.targetScale = indices.includes(i) ? 1.3 : 1));
  }

  reset();
  return { mesh: group, items, reset, burst, update, push, worldPosition, highlight, setPlaying };
}

// A lumpy, slightly irregular sphere with a flat side (it set on a tray while still soft),
// plus sugar crumbs merged in as a second material group.
function gummyGeometry(lite) {
  const r = GUMMY_R;
  const lumps = Array.from({ length: 5 }, () => ({
    d: new THREE.Vector3().randomDirection(),
    a: 0.015 + Math.random() * 0.035,
    f: 2 + Math.random() * 3,
    ph: Math.random() * 6.28,
  }));
  const stretch = new THREE.Vector3(1 + Math.random() * 0.1, 0.93 + Math.random() * 0.06, 1 + Math.random() * 0.1);
  const flatY = -r * (0.78 + Math.random() * 0.08);

  // displaced surface point for a unit direction
  const surface = (n, out) => {
    let k = 1;
    for (const l of lumps) k += l.a * Math.sin(l.f * n.dot(l.d) + l.ph);
    out.copy(n).multiplyScalar(r * k).multiply(stretch);
    if (out.y < flatY) {
      // squash the bottom into a soft-edged flat foot, spreading a little sideways
      const under = (flatY - out.y) / r;
      out.y = flatY - under * r * 0.12;
      out.x *= 1 + under * 0.1;
      out.z *= 1 + under * 0.1;
    }
    return out;
  };

  const body = lite ? new THREE.SphereGeometry(1, 40, 28) : new THREE.SphereGeometry(1, 72, 48);
  const p = body.attributes.position;
  const n = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    n.fromBufferAttribute(p, i).normalize();
    surface(n, v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  body.computeVertexNormals();
  weldSeamNormals(body);

  // sugar crumbs: tiny tumbled crystals, sparser on the flat foot
  const crumbs = [];
  const box = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let i = 0, crumbs_n = lite ? 70 : 170; i < crumbs_n; i++) {
    n.randomDirection();
    if (n.y < -0.5 && Math.random() < 0.85) continue;
    // crystal size / lift are relative to the gummy so the look doesn't change with GUMMY_SIZE
    // (tuned at r = 0.19: 0.0035 + 0.008·rnd³, lift 0.002)
    surface(n, v).addScaledVector(n, r * 0.0105);
    const size = r * (0.0184 + Math.pow(Math.random(), 3) * 0.042);
    s.set(size, size * (0.6 + Math.random() * 0.8), size * (0.6 + Math.random() * 0.8));
    q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    crumbs.push(box.clone().applyMatrix4(m.compose(v, q, s)));
  }
  const sugar = mergeGeometries(crumbs);
  return mergeGeometries([body, sugar], true); // groups: 0 = jelly, 1 = sugar
}

// SphereGeometry duplicates vertices along its UV seam — average normals there so no line shows
function weldSeamNormals(geo) {
  const p = geo.attributes.position, nrm = geo.attributes.normal;
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(i);
  }
  const acc = new THREE.Vector3(), t = new THREE.Vector3();
  for (const ids of map.values()) {
    if (ids.length < 2) continue;
    acc.set(0, 0, 0);
    for (const i of ids) acc.add(t.fromBufferAttribute(nrm, i));
    acc.normalize();
    for (const i of ids) nrm.setXYZ(i, acc.x, acc.y, acc.z);
  }
}

// Blotchy roughness: glossy, freshly-set patches (dark) vs matte dusted zones (light)
function glossMap(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(185,185,185)'; // matte base ≈ 0.72
  g.fillRect(0, 0, size, size);
  for (let k = 0; k < 26; k++) {
    const x = Math.random() * size, y = Math.random() * size, r = 12 + Math.random() * 40;
    const v = Math.random() < 0.6 ? 55 : 230; // glossy ≈ 0.22 or extra matte
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) {
        const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grd.addColorStop(0, `rgba(${v},${v},${v},0.9)`);
        grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
        g.fillStyle = grd;
        g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Fine sugar-frost bumps as a tiling normal map
function frostNormalMap(size = 256) {
  const h = new Float32Array(size * size);
  for (let k = 0; k < 2200; k++) {
    const cx = Math.random() * size, cy = Math.random() * size, r = 1.5 + Math.random() * 4, a = Math.random() * 0.8 + 0.2;
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y) / r;
        if (d > 1) continue;
        const px = (Math.floor(cx + x) + size) % size, py = (Math.floor(cy + y) + size) % size;
        h[py * size + px] += a * (1 - d * d);
      }
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = at(x + 1, y) - at(x - 1, y), dy = at(x, y + 1) - at(x, y - 1);
      const n = new THREE.Vector3(-dx, -dy, 2).normalize();
      const i = (y * size + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  return t;
}

async function loadGeometry(url) {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    let src = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!src && o.isMesh) src = o;
    });
    if (!src) throw new Error('gummy.glb: no mesh');
    const geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
    geo.center();
    geo.computeBoundingBox();
    const size = geo.boundingBox.getSize(new THREE.Vector3());
    geo.scale(...Array(3).fill(GUMMY_SIZE / Math.max(size.x, size.y, size.z)));
    return geo;
  } catch (e) {
    console.warn('[gummy] model failed, using placeholder:', e);
    return null;
  }
}
