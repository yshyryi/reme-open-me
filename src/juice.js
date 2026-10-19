import * as THREE from 'three';
import { BRAND } from './data.js';

// Opening FX: hot flash at the mouth, shockwave ring, sugar sparkles that hang in slow-mo.
export function createJuice(scene) {
  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radial(['rgba(255,236,210,1)', 'rgba(255,150,40,0.55)', 'rgba(255,117,0,0)']),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    }),
  );
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1, 128),
    new THREE.MeshBasicMaterial({
      color: BRAND.orange,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      opacity: 0,
    }),
  );
  ring.rotation.x = -Math.PI / 2;

  const N = 260;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const vel = Array.from({ length: N }, () => new THREE.Vector3());
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const palette = ['#ffffff', '#ffd9b0', BRAND.orange, '#ffb35c'].map((c) => new THREE.Color(c));
  for (let i = 0; i < N; i++) palette[i % palette.length].toArray(col, i * 3);
  const sparkles = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.06,
      map: radial(['rgba(255,255,255,1)', 'rgba(255,255,255,0.4)', 'rgba(255,255,255,0)']),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  sparkles.frustumCulled = false;

  const root = new THREE.Group();
  root.add(flash, ring, sparkles);
  root.visible = false;
  scene.add(root);

  let t = -1;
  const origin = new THREE.Vector3();

  return {
    root,
    trigger(at, tilt) {
      origin.copy(at);
      flash.position.copy(at);
      ring.position.copy(at);
      // ring lies in the jar's mouth plane
      ring.quaternion.copy(tilt || new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      for (let i = 0; i < N; i++) {
        origin.toArray(pos, i * 3);
        const v = vel[i].randomDirection();
        v.y = Math.abs(v.y) * 1.6 + 0.3;
        v.multiplyScalar(2 + Math.random() * 10);
        if (tilt) v.applyQuaternion(tilt);
      }
      geo.attributes.position.needsUpdate = true;
      t = 0;
      root.visible = true;
    },
    reset() {
      t = -1;
      root.visible = false;
    },
    update(realDt, simDt, hangK, time) {
      if (t < 0) return;
      t += realDt;
      const f = Math.min(1, t / 0.5);
      flash.scale.setScalar(0.5 + Math.pow(f, 0.4) * 7);
      flash.material.opacity = Math.pow(1 - f, 2) * 1.2;
      const r = Math.min(1, t / 0.75);
      ring.scale.setScalar(0.4 + (1 - Math.pow(1 - r, 3)) * 6);
      ring.material.opacity = (1 - r) * 0.9;

      const damp = Math.exp(-realDt * hangK * 1.2);
      for (let i = 0; i < N; i++) {
        const v = vel[i];
        v.y -= 6 * (1 - hangK) * simDt;
        v.multiplyScalar(damp);
        pos[i * 3] += v.x * simDt + Math.sin(time * 0.4 + i) * 0.0006 * hangK;
        pos[i * 3 + 1] += v.y * simDt + Math.cos(time * 0.3 + i * 1.3) * 0.0006 * hangK;
        pos[i * 3 + 2] += v.z * simDt;
      }
      geo.attributes.position.needsUpdate = true;
      // twinkle
      sparkles.material.size = 0.05 + Math.sin(time * 2.1) * 0.01;
    },
  };
}

function radial(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach((s, i) => grd.addColorStop(i / (stops.length - 1), s));
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
