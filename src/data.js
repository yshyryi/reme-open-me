// All content & tuning lives here — edit freely.

// Brand palette (Notion "Packaging & Stickers")
export const BRAND = {
  orange: '#FF7500',
  beige: '#F2EBE7',
  gray: '#A69D9C',
  ink: '#382D2E',
};

// Real models: drop .glb files into /public/models and set the paths.
// null = use primitive placeholders. See README.md for naming/scale conventions.
export const MODELS = {
  jar: 'models/jar.glb', // (previous version) Re_ME_Line.blend → Jar_Jelly_60p_15 (nodes Body, Lid, Label)
  // zip pouch from reme-four-pouches.blend → "03 • Front hero" (nodes Body + Strip = tear-off top)
  pouch: 'models/pouch_L2.glb', // 46k + 10k tris (subdiv 2)
  pouchLite: 'models/pouch_L1.glb', // 11k + 2.5k tris (subdiv 1) — phones
  gummy: null, // e.g. 'models/gummy.glb' (first mesh is used, instanced)
};

export const OPEN_TAPS = 3; // fallback: taps needed to rip the strip (main gesture: swipe along the top edge)
export const GUMMY_COUNT = 30;

// Flavors & dyes — from the jar sticker / product page.
// Dye → flavor mapping is an assumption, double-check with the team.
export const FLAVORS = [
  { id: 'orange', name: 'Апельсин', color: '#FFA21F' },
  { id: 'strawberry', name: 'Полуниця', color: '#E8202E' },
  { id: 'kiwi', name: 'Ківі', color: '#46B03C' },
];

// Infographic cards. `anchor`: flavor id, 'any' gummy, or 'jar'.
// Order matters: matches screen slots in ui.js (left column top→bottom, then right).
// `short`: the compact one-liner shown on phones ({ title, sub }); tap a card to expand it.
export const CARDS = [
  {
    anchor: 'orange',
    kicker: 'Колір · смак',
    title: 'Апельсин',
    swatch: '#FFA21F',
    body: 'Бета-каротин E160<br>Куркумін E100',
    short: { title: 'Апельсин', sub: 'E160 · E100' },
  },
  {
    anchor: 'any',
    kicker: 'Активна речовина',
    big: '25',
    unit: 'мг CBD',
    body: 'в одній желейці<br>4 на день = 100 мг',
    short: { title: '25 мг CBD', sub: 'в одній желейці' },
  },
  {
    anchor: 'jar',
    kicker: 'У пакеті · mixed flavours',
    big: '30',
    unit: 'шт · 750 мг CBD',
    body: 'THC free · Lab certified · From Netherlands<br>Твій щоденний ритуал відновлення',
    short: { title: '30 шт · 750 мг', sub: 'THC free · lab certified' },
  },
  {
    anchor: 'strawberry',
    kicker: 'Колір · смак',
    title: 'Полуниця',
    swatch: '#E8202E',
    body: 'Кармін E120',
    short: { title: 'Полуниця', sub: 'E120' },
  },
  {
    anchor: 'kiwi',
    kicker: 'Колір · смак',
    title: 'Ківі',
    swatch: '#46B03C',
    body: 'Мідні комплекси хлорофілів E141',
    short: { title: 'Ківі', sub: 'E141' },
  },
  {
    anchor: 'any',
    kicker: 'Харчова цінність / 100 г',
    nutrition: [
      ['Білки', 6.42],
      ['Жири', 0.2],
      ['Вуглеводи', 81.67],
      ['з них цукор', 57.77],
    ],
    body: '354 ккал · 1505 кДж',
    short: { title: '354 ккал', sub: 'на 100 г' },
  },
];
