import * as THREE from 'three';

// Procedural photo-studio environment: dark cyc + big softboxes and strip lights.
// Gives long, clean reflections on the glossy glass — reads as "product shot".
export function studioEnvironment(renderer) {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: '#16110f', side: THREE.BackSide }),
  );
  room.scale.set(24, 14, 24);
  s.add(room);

  const panel = (w, h, pos, color, intensity) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(7, 5, [-6, 6, 5], '#fff4ea', 6); // key softbox, front-left high
  panel(1.2, 10, [7, 1, -1], '#ffffff', 5); // strip right → long vertical highlight
  panel(1.2, 10, [-7, 1, -3], '#ffe9d8', 3.5); // strip left
  panel(10, 1.5, [0, 8, -5], '#ffffff', 2); // top rim
  panel(5, 4, [5, 1, 7], '#ff8a3d', 1.6); // warm brand fill
  panel(14, 3, [0, -6, 0], '#3a2b27', 1); // floor bounce

  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(s, 0.02).texture;
  pmrem.dispose();
  return tex;
}

// Radial brand gradient used as scene.background (transmission needs a real background)
export function backdrop(exposure = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(512, 430, 40, 512, 512, 760);
  grd.addColorStop(0, '#54423f');
  grd.addColorStop(0.45, '#382d2e');
  grd.addColorStop(1, '#1d1617');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 1024);
  // Warm backlight glow on the seamless, high behind the gummy cloud —
  // transmission refracts it, so the marmalade glows instead of showing the dark set.
  const glow = g.createRadialGradient(512, 330, 0, 512, 330, 520);
  glow.addColorStop(0, 'rgba(255, 196, 150, 0.55)');
  glow.addColorStop(0.35, 'rgba(230, 140, 90, 0.28)');
  glow.addColorStop(0.7, 'rgba(120, 70, 50, 0.08)');
  glow.addColorStop(1, 'rgba(56, 45, 46, 0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 1024, 1024);
  return compensateToneMapping(c, exposure);
}

// The post chain (OutputPass) tone-maps everything, background included — Neutral tone mapping
// crushes and reddens dark brand tones. Pre-apply its inverse (and exposure) so the screen shows
// the designed colours exactly. Stored as linear float to avoid banding in the darks.
function compensateToneMapping(canvas, exposure, size = 512) {
  const s = document.createElement('canvas');
  s.width = s.height = size;
  const sg = s.getContext('2d');
  sg.drawImage(canvas, 0, 0, size, size);
  const src = sg.getImageData(0, 0, size, size).data;
  const out = new Float32Array(size * size * 4);
  const toLinear = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const o = ((size - 1 - y) * size + x) * 4; // DataTexture rows go bottom-up
      const r = toLinear(src[i]), gr = toLinear(src[i + 1]), b = toLinear(src[i + 2]);
      // inverse of Neutral's toe: out = in − offset, offset = m − 6.25m² (m = min channel, m < 0.08) else 0.04
      const mOut = Math.min(r, gr, b);
      const mIn = mOut < 0.04 ? Math.sqrt(mOut / 6.25) : mOut + 0.04;
      const off = mIn - mOut;
      out[o] = (r + off) / exposure;
      out[o + 1] = (gr + off) / exposure;
      out[o + 2] = (b + off) / exposure;
      out[o + 3] = 1;
    }
  const t = new THREE.DataTexture(out, size, size, THREE.RGBAFormat, THREE.FloatType);
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
