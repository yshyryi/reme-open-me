# Re:Me — "Open me" WebGL jar

Three.js + Vite. Swipe along the zip pouch's top edge (or tap 3× — `OPEN_TAPS`) → the tear strip rips off, the mouth pops open with a flash →
gummies burst out → slow-mo → they hang in the air with infographic call-outs.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 and http://<your-LAN-IP>:5173 for the phone
```

Production build: `npm run build && npm run preview` → port 4173 (also on LAN).
If the phone can't connect, allow Node.js through Windows Firewall (Private networks).

Desktop shortcuts: **Space** = open instantly, **R** = reset.
After opening: flick a gummy (drag across it) to send it flying — one gummy per stroke; it ricochets off invisible walls just outside the frame and off the floor.
Tap a gummy to move the card of its flavor onto it.

## Content

Everything editable is in `src/data.js`: brand colors, flavors, card texts, gummy count, number of turns.
Nutrition, dyes and CBD data were taken from the product page reme.com.ua/product/gummies-750-mg-cbd-30-sht.
Which dye goes with which flavor is an assumption and needs checking.

## Models

**Current product: zip pouch.** `public/models/pouch_L2.glb` (desktop, 46k+10k tris) and `pouch_L1.glb` (phones, 11k+2.5k tris) are exported from `reme-four-pouches.blend` → `03 • Front hero` at subdivision 2 / 1 (the scene uses 3–4 → 220k tris). The mesh is cut 11 mm under the top seal into nodes `Body` and `Strip` (tear-off strip). `src/pouch.js` fits it, adds the inner foil, peels the strip and bows the mouth open. The jar version (`src/jar.js`, `jar.glb`) is kept but unused.


`public/models/jar.glb` is exported from `Re_ME_Line.blend` → collection `Jar_Jelly_60p_15`:
the simplified glass (`.001`), the lid (`_top`) and the sticker, relative to the jar's control object.
The loader auto-fits the jar by its Body bounding box and overrides materials (Blender node setups don't export).
The sticker is rebuilt in code as a clean cylinder using the exported texture, because the bent mesh had inward normals.

Logo PNGs in `public/` (`logo-wordmark.png`, `logo-icon.png`) were cut from the same sticker texture.

Gummies are procedural: 3 lumpy shapes with a flat foot, gloss/matte roughness patches and merged sugar crystals (one InstancedMesh per flavor × shape, see `src/gummies.js`).
Lighting is a procedural studio environment (`src/studio.js`); opening FX live in `src/juice.js`.

## Swapping placeholders for real models

1. Export from Blender as `.glb` (+Y up, Apply Transforms) to `public/models/`.
2. Set the paths in `src/data.js → MODELS`.

**jar.glb** — any scale, Y up. Nodes: `Body` (glass, used for fitting), `Lid` (pivot is computed
from its bounding box), optional `Label` (only its texture and height are used).

**gummy.glb** — the first mesh in the file is used. It's auto-centered and scaled to 0.3 units.
Color is set per instance from `FLAVORS[].color` (gray/white base works best).
If you need different shapes per flavor, that's a small change in `src/gummies.js` (one InstancedMesh per flavor).

## Fonts

Manrope from Google Fonts is a placeholder. For Denim INK: put the `.woff2` in `public/fonts/`
and add an `@font-face` (template at the top of `src/style.css`).
