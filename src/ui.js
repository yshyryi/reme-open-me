// DOM overlay: "Open me" text ring, tap progress bar, infographic cards glued to their gummies.

// Preferred screen regions for the initial card → gummy assignment (same order as CARDS)
const SLOTS_LANDSCAPE = [[0.13, 0.2], [0.13, 0.5], [0.13, 0.8], [0.87, 0.2], [0.87, 0.5], [0.87, 0.8]];
const SLOTS_PORTRAIT = [[0.26, 0.12], [0.26, 0.3], [0.26, 0.88], [0.74, 0.12], [0.74, 0.3], [0.74, 0.88]];
const SVG_NS = 'http://www.w3.org/2000/svg';
const MARGIN = 12;
const TOP = 64; // keep clear of the header

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createUI(cards, steps) {
  const ring = document.querySelector('#ring');
  const hint = document.querySelector('#hint');
  const bar = document.querySelector('#bar');
  const cardsEl = document.querySelector('#cards');
  const linesEl = document.querySelector('#lines');
  const replay = document.querySelector('#replay');
  const flashEl = document.querySelector('#flash');
  const tearEl = document.querySelector('#tear');
  const tearTrack = tearEl.querySelector('.track'), tearDone = tearEl.querySelector('.done'), tearDot = tearEl.querySelector('.dot');

  const segs = Array.from({ length: steps }, () => bar.appendChild(document.createElement('i')));

  const items = cards.map((c, i) => {
    const el = document.createElement('div');
    el.className = 'card';
    el.style.setProperty('--d', `${i * 110}ms`);
    el.innerHTML = `<div class="in">${renderCompact(c)}<div class="f">${renderCard(c)}</div></div>`;
    cardsEl.appendChild(el);
    // phones show compact one-liners; a tap expands one card (and collapses the rest)
    el.addEventListener('click', () => {
      const open = !el.classList.contains('open');
      items.forEach((it) => it.el.classList.remove('open'));
      el.classList.toggle('open', open);
      measure();
    });
    const line = svg('line');
    const halo = svg('circle', { r: 13, class: 'halo' });
    const dot = svg('circle', { r: 3.5, class: 'dot' });
    linesEl.append(line, halo, dot);
    return { el, line, halo, dot, w: 0, h: 0, x: 0, y: 0, side: null, snap: true };
  });

  function svg(tag, attrs = {}) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function slots() {
    const W = innerWidth, H = innerHeight;
    return (W < H * 0.9 ? SLOTS_PORTRAIT : SLOTS_LANDSCAPE).map(([x, y]) => ({ x: x * W, y: y * H }));
  }

  function measure() {
    for (const it of items) {
      it.w = it.el.offsetWidth;
      it.h = it.el.offsetHeight;
    }
  }

  const overlap = (a, b) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

  // Pick the side of its gummy where the card fits best: inside the screen,
  // not over other cards, other anchored gummies or the product (obstacles); sticky to avoid flicker.
  function place(it, a, placed, anchors, obstacles = []) {
    const W = innerWidth, H = innerHeight, gap = 26, lift = 16;
    const cands = {
      r: { x: a.x + gap, y: a.y - it.h / 2 - lift },
      l: { x: a.x - gap - it.w, y: a.y - it.h / 2 - lift },
      t: { x: a.x - it.w / 2, y: a.y - gap - it.h },
      b: { x: a.x - it.w / 2, y: a.y + gap },
      // further out — lets a card anchored on the product step off it
      rr: { x: a.x + gap + it.w * 0.6, y: a.y - it.h / 2 - lift },
      ll: { x: a.x - gap - it.w * 1.6, y: a.y - it.h / 2 - lift },
    };
    let best = null;
    for (const side in cands) {
      const c = cands[side];
      const x = clamp(c.x, MARGIN, W - it.w - MARGIN);
      const y = clamp(c.y, TOP, H - it.h - MARGIN);
      const r = { x, y, w: it.w, h: it.h };
      let score = Math.hypot(x - c.x, y - c.y) * 3; // had to be pushed inside the screen
      for (const p of placed) score += overlap(r, p) * 0.05;
      for (const o of obstacles) score += overlap(r, o) * 0.07; // don't hide the pouch
      for (const o of anchors)
        if (o !== a && o.x > x - 10 && o.x < x + it.w + 10 && o.y > y - 10 && o.y < y + it.h + 10) score += 60;
      if (a.x > x - 6 && a.x < x + it.w + 6 && a.y > y - 6 && a.y < y + it.h + 6) score += 400; // covers its own gummy
      if (side !== it.side) score += 40;
      if (!best || score < best.score) best = { side, x, y, score };
    }
    it.side = best.side;
    return best;
  }

  return {
    slots,
    measure,

    setRing(x, y, radiusPx, visible) {
      const size = (radiusPx * 200) / 80; // lid edge = r 80 in the viewBox → text hugs the lid
      ring.style.width = ring.style.height = `${size}px`;
      ring.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`;
      ring.style.opacity = visible ? 1 : 0;
      hint.style.opacity = visible ? 1 : 0;
    },

    // dashed guide along the tear strip; the solid part is what's already ripped, the dot shows where to swipe
    setTearGuide(a, b, p, visible) {
      tearEl.style.opacity = visible ? 1 : 0;
      if (!visible) return;
      const mx = a.x + (b.x - a.x) * p, my = a.y + (b.y - a.y) * p;
      set(tearTrack, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      set(tearDone, { x1: a.x, y1: a.y, x2: mx, y2: my });
      const k = (performance.now() / 1400) % 1; // the dot keeps sliding ahead to invite the swipe
      const q = p + (1 - p) * k;
      set(tearDot, { cx: a.x + (b.x - a.x) * q, cy: a.y + (b.y - a.y) * q });
      tearDot.style.opacity = String(1 - k);
    },

    setProgress(p) {
      const n = Math.round(p * steps);
      segs.forEach((s, i) => s.classList.toggle('on', i < n));
    },

    bump() {
      for (const el of [ring, bar]) {
        el.classList.remove('bump');
        void el.getBoundingClientRect();
        el.classList.add('bump');
      }
    },

    flash() {
      flashEl.classList.remove('go');
      void flashEl.offsetWidth;
      flashEl.classList.add('go');
    },

    showCards() {
      measure();
      items.forEach((it) => (it.snap = true));
      document.body.classList.add('revealed');
    },

    hideCards() {
      document.body.classList.remove('revealed');
      items.forEach((it) => it.el.classList.remove('open'));
      items.forEach((it) => (it.side = null));
    },

    // card moved to another gummy — replay its pop-in
    retarget(i) {
      const el = items[i].el;
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    },

    onReplay(fn) {
      replay.addEventListener('click', fn);
    },

    // anchors: [{x, y}] in screen px, one per card
    layout(anchors, dt, obstacles = []) {
      const W = innerWidth, H = innerHeight;
      const k = 1 - Math.exp(-dt * 9);
      // 1) best side per card
      const placed = [];
      const targets = items.map((it, i) => {
        const t = place(it, anchors[i], placed, anchors, obstacles);
        const r = { x: t.x, y: t.y, w: it.w, h: it.h };
        placed.push(r);
        return r;
      });
      // 2) relax remaining overlaps (crowded phone screens): push pairs apart along the cheaper axis
      for (let iter = 0; iter < 12; iter++) {
        let moved = false;
        for (let a = 0; a < targets.length; a++)
          for (let b = a + 1; b < targets.length; b++) {
            const A = targets[a], B = targets[b];
            const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) + 8;
            const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) + 8;
            if (ox <= 0 || oy <= 0) continue;
            moved = true;
            if (oy < ox * 1.5) {
              const s = A.y + A.h / 2 < B.y + B.h / 2 ? -1 : 1;
              A.y += (s * oy) / 2;
              B.y -= (s * oy) / 2;
            } else {
              const s = A.x + A.w / 2 < B.x + B.w / 2 ? -1 : 1;
              A.x += (s * ox) / 2;
              B.x -= (s * ox) / 2;
            }
          }
        for (const r of targets) {
          r.x = clamp(r.x, MARGIN, W - r.w - MARGIN);
          r.y = clamp(r.y, TOP, H - r.h - MARGIN);
        }
        if (!moved) break;
      }
      // 3) ease towards targets, draw leader lines
      items.forEach((it, i) => {
        const a = anchors[i];
        const t = targets[i];
        if (it.snap) {
          it.x = t.x;
          it.y = t.y;
          it.snap = false;
        } else {
          it.x += (t.x - it.x) * k;
          it.y += (t.y - it.y) * k;
        }
        it.el.style.transform = `translate(${it.x}px, ${it.y}px)`;
        const px = clamp(a.x, it.x, it.x + it.w);
        const py = clamp(a.y, it.y, it.y + it.h);
        set(it.line, { x1: px, y1: py, x2: a.x, y2: a.y });
        set(it.dot, { cx: a.x, cy: a.y });
        set(it.halo, { cx: a.x, cy: a.y });
      });
    },
  };
}

function set(n, attrs) {
  for (const k in attrs) n.setAttribute(k, attrs[k].toFixed(1));
}

function renderCompact(c) {
  if (!c.short) return '';
  const sw = c.swatch ? `<i class="sw" style="background:${c.swatch}"></i>` : '';
  return `<div class="c"><b>${sw}${c.short.title}</b><span>${c.short.sub}</span></div>`;
}

function renderCard(c) {
  let html = `<div class="kicker">${c.kicker}</div>`;
  if (c.swatch) {
    html += `<div class="title"><i class="sw" style="background:${c.swatch}"></i>${c.title}</div>`;
    html += `<div class="hex">${c.swatch.toUpperCase()}</div>`;
  }
  if (c.big) html += `<div class="big">${c.big}<span>${c.unit}</span></div>`;
  if (c.nutrition) {
    html += `<ul class="bars">${c.nutrition
      .map(([k, v]) => `<li><span>${k}</span><b><i style="width:${v}%"></i></b><em>${v}&nbsp;г</em></li>`)
      .join('')}</ul>`;
  }
  if (c.body) html += `<div class="body">${c.body}</div>`;
  return html;
}
