import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BRAND } from './data.js';

// Jar-local units: base at y = -1.1, height ≈ 2.3. Real models are auto-fitted to that.
const BASE_Y = -1.1;
const HEIGHT = 2.3;
const PLACEHOLDER = { rimY: 1.22, innerR: 0.66, radius: 1.0, lidRadius: 0.9 };

// group: tilt / bob / squash — gummies live here too.
// spin:  the jar itself (glass, label, lid) — spins around its own axis without dragging the gummies along.
export async function createJar(url) {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);
  const lidPivot = new THREE.Group();
  spin.add(lidPivot);

  const dims = (url && (await loadJarModel(url, spin, lidPivot))) || buildPlaceholder(spin, lidPivot);

  // Point the "jar" infographic card is wired to
  const labelAnchor = new THREE.Object3D();
  labelAnchor.position.set(0, -0.2, dims.radius + 0.02);
  spin.add(labelAnchor);

  return { group, spin, lidPivot, lidRestY: lidPivot.position.y, labelAnchor, baseY: BASE_Y, ...dims };
}

// Expects nodes "Body" and "Lid" (optional "Label"). Any scale/units — fitted by Body's bounding box.
async function loadJarModel(url, group, lidPivot) {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    const body = root.getObjectByName('Body');
    const lid = root.getObjectByName('Lid');
    const label = root.getObjectByName('Label');
    if (!body || !lid) throw new Error('jar.glb needs nodes "Body" and "Lid"');

    root.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(body);
    const size = bb.getSize(new THREE.Vector3());
    const center = bb.getCenter(new THREE.Vector3());
    const s = HEIGHT / size.y;
    const fit = new THREE.Group();
    fit.scale.setScalar(s);
    fit.position.set(-center.x * s, BASE_Y - bb.min.y * s, -center.z * s);
    fit.add(root);
    group.add(fit);
    group.updateMatrixWorld(true);

    // Materials (Blender node setups don't survive glTF export)
    // Dark violet "miron" glass — lid uses the same material, as on the real jar
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#120c14',
      metalness: 0.15,
      roughness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      specularIntensity: 1,
      iridescence: 0.35,
      iridescenceIOR: 1.3,
      iridescenceThicknessRange: [200, 500],
      envMapIntensity: 1.4,
    });
    body.material = glass;
    lid.material = glass;
    if (label) {
      label.material.transparent = false;
      label.material.alphaTest = 0;
      label.material.roughness = 0.45;
      label.material.side = THREE.DoubleSide;
    }
    root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    if (label) {
      // The exported sticker (SimpleDeform bend) has inward normals and hugs the glass too tightly,
      // so rebuild it as a clean cylinder wrapped just outside the body, reusing its texture.
      const lb2 = new THREE.Box3().setFromObject(label, true);
      const br = maxRadius(body, group, label);
      const map = downscale(label.material.map, 2048); // 4000 px is ~4× the memory for no visible gain
      map.anisotropy = 8;
      map.repeat.y = -1;
      map.offset.y = 1;
      const cover = (175 / 191) * Math.PI * 2; // 175 mm sticker on a Ø60.8 mm jar
      const front = 0.22; // texture u that faces the viewer (brand side)
      const sticker = new THREE.Mesh(
        new THREE.CylinderGeometry(br + 0.006, br + 0.006, lb2.max.y - lb2.min.y, 96, 1, true, -front * cover, cover),
        new THREE.MeshPhysicalMaterial({ map, roughness: 0.62, sheen: 0.4, sheenRoughness: 0.8, sheenColor: new THREE.Color('#ffffff'), clearcoat: 0.08 }),
      );
      sticker.name = 'Label';
      sticker.position.y = (lb2.max.y + lb2.min.y) / 2;
      sticker.castShadow = true;
      group.add(sticker);
      label.removeFromParent();
    }

    // Lid rotates around its own axis: pivot at the center of its bottom face
    const lb = new THREE.Box3().setFromObject(lid);
    const lc = lb.getCenter(new THREE.Vector3());
    lidPivot.position.set(lc.x, lb.min.y, lc.z);
    lidPivot.attach(lid);

    const radius = maxRadius(body, group); // true glass radius (bbox of the rotated mesh overestimates)
    return {
      rimY: lb.min.y + 0.05,
      innerR: radius * 0.83,
      radius,
      lidRadius: ((lb.max.x - lb.min.x) / 2),
    };
  } catch (e) {
    console.warn('[jar] model failed, using placeholder:', e);
    return null;
  }
}
// Re-sample a texture to at most `max` px wide (keeps the ImageBitmap orientation: flipY off)
function downscale(tex, max) {
  const img = tex.image;
  if (!img || img.width <= max) return tex;
  const c = document.createElement('canvas');
  c.width = max;
  c.height = Math.round((img.height * max) / img.width);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  tex.dispose();
  return t;
}

// Max distance from the jar axis (Y) in `space`; with `within`, only inside that object's height range
function maxRadius(mesh, space, within) {
  const inv = space.matrixWorld.clone().invert();
  const v = new THREE.Vector3();
  let yMin = -Infinity, yMax = Infinity;
  if (within) {
    const b = new THREE.Box3().setFromObject(within, true).applyMatrix4(inv);
    yMin = b.min.y;
    yMax = b.max.y;
  }
  const p = mesh.geometry.attributes.position;
  let r = 0;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
    if (v.y >= yMin && v.y <= yMax) r = Math.max(r, Math.hypot(v.x, v.z));
  }
  return r;
}

function buildPlaceholder(group, lidPivot) {
  // Glass body
  const profile = [
    [0, -1.1], [0.8, -1.1], [0.93, -1.06], [0.99, -0.95], [1.0, -0.8],
    [1.0, 0.7], [0.97, 0.86], [0.88, 0.96], [0.8, 1.0], [0.8, PLACEHOLDER.rimY],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.05,
    transmission: 1,
    thickness: 0.2,
    ior: 1.45,
    side: THREE.DoubleSide,
    attenuationColor: new THREE.Color('#fff2e6'),
    attenuationDistance: 3,
  });
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 96), glass);
  body.name = 'Body';
  group.add(body);

  // Label band
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(1.012, 1.012, 0.95, 96, 1, true, -Math.PI, Math.PI * 2),
    new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.55 }),
  );
  label.position.y = -0.15;
  label.castShadow = true;
  group.add(label);

  // Ridged lid
  const lidGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.36, 144, 4);
  lidGeo.translate(0, 0.18, 0);
  const p = lidGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 0.85) continue;
    const nr = 0.9 + 0.014 * Math.cos(Math.atan2(z, x) * 72);
    p.setXYZ(i, (x / r) * nr, p.getY(i), (z / r) * nr);
  }
  lidGeo.computeVertexNormals();
  const lidMat = new THREE.MeshPhysicalMaterial({ color: BRAND.orange, roughness: 0.38, clearcoat: 0.4 });
  const lidTop = lidMat.clone();
  lidTop.map = lidTexture();
  lidTop.color.set('#ffffff');
  const lid = new THREE.Mesh(lidGeo, [lidMat, lidTop, lidMat]);
  lid.name = 'Lid';
  lid.castShadow = true;
  lidPivot.position.y = 0.97;
  lidPivot.add(lid);
  return PLACEHOLDER;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function labelTexture() {
  return canvasTex(2048, 512, (g, w, h) => {
    g.fillStyle = BRAND.orange;
    g.fillRect(0, 0, w, h);
    g.fillStyle = BRAND.ink;
    g.fillRect(0, 36, w, 4);
    g.fillRect(0, h - 40, w, 4);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 200px Unbounded, sans-serif';
    g.fillText('RE:ME', w / 2, h / 2 + 8);
    g.font = '600 40px Manrope, sans-serif';
    g.fillText('C B D   G U M M I E S', w / 2, 110);
    g.fillText('7 5 0  M G   ·   3 0  P C S', w / 2, h - 108);
    // back side (wraps across the seam)
    g.font = '600 36px Manrope, sans-serif';
    for (const x of [0, w]) {
      g.fillText('ORANGE · STRAWBERRY · KIWI', x, h / 2 - 30);
      g.fillText('25 MG CBD / GUMMY', x, h / 2 + 30);
    }
  });
}

function lidTexture() {
  return canvasTex(512, 512, (g, w) => {
    g.fillStyle = BRAND.orange;
    g.fillRect(0, 0, w, w);
    g.translate(w / 2, w / 2);
    g.strokeStyle = BRAND.ink;
    g.lineWidth = 18;
    g.lineCap = 'round';
    // rough take on the Re:Me mark
    g.beginPath();
    g.arc(0, 0, 80, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(-170, 0);
    g.lineTo(170, 0);
    for (const s of [-1, 1]) {
      g.moveTo(s * 120, 0);
      g.lineTo(s * 165, -45);
      g.moveTo(s * 120, 0);
      g.lineTo(s * 165, 45);
    }
    g.stroke();
    g.fillStyle = BRAND.beige;
    g.fillRect(-50, -9, 22, 18);
    g.fillRect(28, -9, 22, 18);
  });
}
