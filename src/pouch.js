import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Stand-up zip pouch. Exported from reme-four-pouches.blend → "03 • Front hero", cut just under the
// top heat-seal into two nodes: "Body" and "Strip" (the tear-off strip).
// Local space after fitting: width along X, height along Y (base at BASE_Y), printed front facing +Z.
const HEIGHT = 3.0;
const BASE_Y = -1.5;
const MOUTH_DEPTH = 1.0; // how far down from the cut the mouth flares open
const MOUTH_OPEN = 0.34; // how far each wall bows out when fully open
// Crumpled-foil normal map (ambientCG Foil001, CC0) — soft creases on the film, stronger on the foil
const WRINKLES = '/textures/foil001_normal.jpg';

export async function createPouch(url) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const bodySrc = root.getObjectByName('Body');
  const stripSrc = root.getObjectByName('Strip');
  if (!bodySrc || !stripSrc) throw new Error('pouch.glb needs nodes "Body" and "Strip"');

  // bake node transforms, then turn the printed front (+X in Blender/glTF) towards +Z
  const turn = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
  const bodyGeo = bodySrc.geometry.clone().applyMatrix4(bodySrc.matrixWorld).applyMatrix4(turn);
  const stripGeo = stripSrc.geometry.clone().applyMatrix4(stripSrc.matrixWorld).applyMatrix4(turn);

  // fit: total height = HEIGHT, base at BASE_Y, centred on X/Z
  bodyGeo.computeBoundingBox();
  stripGeo.computeBoundingBox();
  const bb = bodyGeo.boundingBox.clone().union(stripGeo.boundingBox);
  const c = bb.getCenter(new THREE.Vector3());
  const s = HEIGHT / (bb.max.y - bb.min.y);
  for (const g of [bodyGeo, stripGeo]) {
    g.translate(-c.x, -bb.min.y, -c.z);
    g.scale(s, s, s);
    g.translate(0, BASE_Y, 0);
    g.computeBoundingBox();
  }
  const bodyBB = bodyGeo.boundingBox.clone();
  const stripBB = stripGeo.boundingBox.clone(); // clone: computeBoundingBox() reuses the same Box3

  // tear strip pivots around its own bottom-centre (that's where it flies off from)
  const sc = stripBB.getCenter(new THREE.Vector3());
  stripGeo.translate(-sc.x, -stripBB.min.y, -sc.z);
  stripGeo.computeBoundingBox();

  // printed film outside, silver foil inside (seen through the open mouth)
  const map = bodySrc.material.map;
  if (map) map.anisotropy = 8;
  const wrinkle = await new THREE.TextureLoader().loadAsync(WRINKLES).catch(() => null);
  const wrinkleFor = (repeat) => {
    if (!wrinkle) return null;
    const t = wrinkle.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  const film = new THREE.MeshPhysicalMaterial({
    map,
    metalness: 0, // printed plastic film, not foil
    roughness: 0.42,
    clearcoat: 0.35,
    clearcoatRoughness: 0.28,
    envMapIntensity: 1.1,
    normalMap: wrinkleFor(0.6), // big, soft creases — strength is masked per zone below
    normalScale: new THREE.Vector2(0.45, 0.45),
  });
  // inner laminate: brushed aluminium foil, like the inside of a real zip pouch
  const foil = new THREE.MeshPhysicalMaterial({
    color: '#dcd8da',
    metalness: 1,
    roughness: 0.24,
    envMapIntensity: 1.6,
    side: THREE.BackSide,
    normalMap: wrinkleFor(2.4), // the foil laminate crinkles much more
    normalScale: new THREE.Vector2(0.75, 0.75),
  });

  const group = new THREE.Group(); // tilt / bob / squash — gummies live here too
  const spin = new THREE.Group(); // the pouch itself — spins without dragging the gummies along
  group.add(spin);

  const body = new THREE.Mesh(bodyGeo, film);
  body.name = 'Body';
  body.castShadow = true;
  const bodyInner = new THREE.Mesh(bodyGeo, foil);
  spin.add(body, bodyInner);

  const lidPivot = new THREE.Group(); // = the tear strip holder (same role the jar lid had)
  lidPivot.position.set(sc.x, stripBB.min.y, sc.z);
  const strip = new THREE.Mesh(stripGeo, film);
  strip.name = 'Strip';
  strip.castShadow = true;
  lidPivot.add(strip, new THREE.Mesh(stripGeo, foil));
  spin.add(lidPivot);

  const halfW = (bodyBB.max.x - bodyBB.min.x) / 2;
  const halfD = (bodyBB.max.z - bodyBB.min.z) / 2;
  const rimY = bodyBB.max.y; // the cut line = mouth

  // ---- where the film actually creases: by THICKNESS ----
  // The belly (where the gummies sit) is the most inflated part, so the film is stretched taut there;
  // thin parts — seams, the flat top band, edges, the bottom crease — are where it buckles.
  // Thickness ≈ how far the surface sits from the pouch's mid-plane (|z|), relative to the max bulge.
  {
    const p = bodyGeo.attributes.position;
    const w = new Float32Array(p.count);
    let maxZ = 0;
    for (let i = 0; i < p.count; i++) maxZ = Math.max(maxZ, Math.abs(p.getZ(i)));
    for (let i = 0; i < p.count; i++) {
      const t = Math.abs(p.getZ(i)) / maxZ; // 0 = flat/thin, 1 = fullest belly
      const thin = 1 - THREE.MathUtils.smoothstep(t, 0.1, 0.6); // fades out early — the belly is taut
      w[i] = 0.03 + 0.97 * Math.pow(thin, 1.8);
    }
    bodyGeo.setAttribute('wrinkle', new THREE.BufferAttribute(w, 1));
    const sw = new Float32Array(stripGeo.attributes.position.count).fill(0.9); // the seal strip is crinkly
    stripGeo.setAttribute('wrinkle', new THREE.BufferAttribute(sw, 1));
  }
  // scale the normal map by that mask in the film's shader
  film.onBeforeCompile = (sh) => {
    sh.vertexShader =
      'attribute float wrinkle;\nvarying float vWrinkle;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWrinkle = wrinkle;');
    // the #include isn't expanded yet here — inline the chunk with: a blurred (mip-biased) read so only
    // the big folds of the crumple survive, and the per-zone mask on the strength
    const chunk = THREE.ShaderChunk.normal_fragment_maps
      .replaceAll('texture2D( normalMap, vNormalMapUv )', 'texture2D( normalMap, vNormalMapUv, 2.5 )')
      .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * vWrinkle;');
    sh.fragmentShader = 'varying float vWrinkle;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>', chunk);
  };

  // Point the "pouch" infographic card is wired to (on the printed front)
  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.set(halfW * 0.35, -0.2, halfD * 0.95);
  spin.add(labelAnchor);

  // ---- mouth opening: walls bow out (lens shape), strongest mid-width, fading down the bag ----
  const bp = bodyGeo.attributes.position;
  const bn = bodyGeo.attributes.normal;
  const base = bp.array.slice();
  const weight = new Float32Array(bp.count);
  for (let i = 0; i < bp.count; i++) {
    const x = base[i * 3], y = base[i * 3 + 1];
    const u = THREE.MathUtils.clamp((x - bodyBB.min.x) / (2 * halfW), 0, 1);
    const side = THREE.MathUtils.clamp(bn.getZ(i) * 1.6, -1, 1); // front wall +, back wall −
    const h = Math.pow(THREE.MathUtils.smoothstep(y, rimY - MOUTH_DEPTH, rimY), 1.6);
    weight[i] = side * Math.pow(Math.sin(Math.PI * u), 0.7) * h;
  }
  let mouthK = -1;
  function setMouth(k) {
    if (Math.abs(k - mouthK) < 1e-4) return;
    mouthK = k;
    for (let i = 0; i < bp.count; i++) {
      bp.array[i * 3 + 2] = base[i * 3 + 2] + weight[i] * MOUTH_OPEN * k;
      bp.array[i * 3] = base[i * 3] * (1 - Math.abs(weight[i]) * 0.06 * k); // corners pull in a touch
    }
    bp.needsUpdate = true;
  }

  // ---- tear: the strip rips from the left notch along the cut line as progress goes 0 → 1 ----
  // The torn-off part doesn't stay parallel to the line: it curls up around the tear front
  // (more the further it is from the front), bows towards the viewer and twists a little.
  const sp = stripGeo.attributes.position;
  const sBase = sp.array.slice();
  const sMinX = stripGeo.boundingBox.min.x, sW = stripGeo.boundingBox.max.x - sMinX;
  // like peeling tape: the torn flap folds back over the strip in the pull direction (~130°),
  // lifted off towards the viewer so it never cuts through what's still attached
  const FLAP_ANGLE = 2.25;
  const BEND = 0.22; // length over which the film bends at the tear front
  let tearK = -1;
  function setTear(p) {
    if (Math.abs(p - tearK) < 1e-4) return;
    tearK = p;
    const xf = sMinX + sW * THREE.MathUtils.clamp(p * 1.06, 0, 1); // tear front
    for (let i = 0; i < sp.count; i++) {
      const x = sBase[i * 3], y = sBase[i * 3 + 1], z = sBase[i * 3 + 2];
      const d = xf - x; // how far behind the tear front
      if (d <= 0 || p <= 0) {
        sp.array[i * 3] = x;
        sp.array[i * 3 + 1] = y;
        sp.array[i * 3 + 2] = z;
        continue;
      }
      const th = FLAP_ANGLE * (1 - Math.exp(-d / BEND)); // bend at the front, then a straight angled flap
      const c = Math.cos(th), s = Math.sin(th);
      const rx = -d * c + y * s; // rotate (−d, y) clockwise → lifts the free end
      const ry = d * s + y * c;
      const tw = th * 0.3; // twist: the free end turns its face towards the viewer
      sp.array[i * 3] = xf + rx;
      sp.array[i * 3 + 1] = ry * Math.cos(tw);
      const lift = Math.min(1, d / BEND) * 0.05 + d * 0.06; // off the strip, towards the viewer
      sp.array[i * 3 + 2] = z + ry * Math.sin(tw) + lift;
    }
    sp.needsUpdate = true;
  }

  // where gummies appear: inside the open mouth
  function spawnPoint(out) {
    return out.set((Math.random() - 0.5) * halfW * 1.1, rimY + 0.06, (Math.random() - 0.5) * halfD * 0.35);
  }

  // screen-space tear guide: exactly on the cut line (the tear notches), on the front face
  const stripY = 0.004;
  function stripEnds(a, b) {
    lidPivot.localToWorld(a.set(sMinX + sW * 0.02, stripY, 0.02));
    lidPivot.localToWorld(b.set(sMinX + sW * 0.98, stripY, 0.02));
  }

  setMouth(0);
  setTear(0);

  return {
    kind: 'pouch',
    group,
    spin,
    lidPivot,
    lidRestY: lidPivot.position.y,
    labelAnchor,
    strip,
    rimY,
    baseY: BASE_Y,
    halfW,
    halfD,
    innerR: halfW * 0.5,
    radius: halfW, // used for rough occlusion tests
    lidRadius: halfW,
    setMouth,
    setTear,
    spawnPoint,
    stripEnds,
  };
}
