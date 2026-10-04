// Облик команды «Сонет»: рукописная земля, чернильный шлейф, сургучная печать на базе
// и Клякса — капля с пером, которая радуется захватам, зачёркивает соперников и пугается кляксой.
// Карточка перед матчем — страница рукописи; победа — сонет из четырнадцати строк, дописанный печатью.

const TAU = Math.PI * 2;
const FONT = '"Palatino Linotype","Book Antiqua",Palatino,Georgia,"Times New Roman",serif';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeOutBack = (t) => {
  t = clamp(t, 0, 1);
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const rand = (a, b) => a + Math.random() * (b - a);

function hexRgb(hex) {
  const h = String(hex || '#ffffff').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function mix(h1, h2, k) {
  const a = hexRgb(h1), b = hexRgb(h2);
  return `rgb(${Math.round(lerp(a[0], b[0], k))},${Math.round(lerp(a[1], b[1], k))},${Math.round(lerp(a[2], b[2], k))})`;
}

const INK = '#150a33';
const INK2 = '#2b1670';
const CRIMSON = '#ff3b5c';
const CREAM = '#fff3d6';
const LETTERS = 'абвгдежзиклмнопрстуфхцчшэюя';

// ---------- состояние между кадрами ----------
const S = {
  lastT: -1, parts: [], fx: [], ghost: null, prevLand: null,
  mood: 'calm', moodT: 0, featherAng: 0, lastHeading: null, turnVel: 0, dripAcc: 0,
  respMax: 1, tile: null, wasAlive: true, blink: 0, nextBlink: 2.5, glance: 0,
  poemSeed: null,
};
function resetState() {
  S.parts.length = 0;
  S.fx.length = 0;
  S.ghost = null;
  S.prevLand = null;
  S.mood = 'calm';
  S.moodT = 0;
  S.lastHeading = null;
  S.wasAlive = true;
  S.opened = false;
}
// Ошибка в одном слое не должна гасить весь облик; в тестах включаем строгий режим.
function guard(fn) {
  try {
    fn();
  } catch (e) {
    if (globalThis.__SKIN_STRICT) throw e;
  }
}
function setMood(m, dur) {
  S.mood = m;
  S.moodT = dur;
}

function pathRings(ctx, rings) {
  ctx.beginPath();
  if (!rings) return;
  for (const r of rings) {
    const n = r.length;
    if (n < 6) continue;
    ctx.moveTo(r[0], r[1]);
    for (let i = 2; i < n; i += 2) ctx.lineTo(r[i], r[i + 1]);
    ctx.closePath();
  }
}
function ringsArea(rings) {
  let sum = 0;
  for (const r of rings || []) {
    let a = 0;
    const n = r.length;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n;
      a += r[i] * r[j + 1] - r[j] * r[i + 1];
    }
    sum += a / 2;
  }
  return Math.abs(sum);
}
function ringsBox(rings) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const r of rings || []) {
    for (let i = 0; i < r.length; i += 2) {
      if (r[i] < x0) x0 = r[i];
      if (r[i] > x1) x1 = r[i];
      if (r[i + 1] < y0) y0 = r[i + 1];
      if (r[i + 1] > y1) y1 = r[i + 1];
    }
  }
  return { x0, y0, x1, y1 };
}
function randomRingPoint(rings) {
  if (!rings || !rings.length) return null;
  let total = 0;
  for (const r of rings) total += r.length;
  let k = Math.random() * total;
  for (const r of rings) {
    if (k < r.length) {
      const i = Math.floor(k / 2) * 2;
      return { x: r[i], y: r[i + 1] };
    }
    k -= r.length;
  }
  return null;
}

// ---------- текстура рукописного листа ----------
function makeTile() {
  const N = 256;
  const c = new OffscreenCanvas(N, N);
  const x = c.getContext('2d');
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  x.strokeStyle = 'rgba(200,182,255,0.17)';
  x.lineWidth = 1.2;
  x.beginPath();
  for (let y = 16; y < N; y += 32) {
    x.moveTo(0, y);
    x.lineTo(N, y);
  }
  x.stroke();
  x.strokeStyle = 'rgba(240,230,255,0.12)';
  x.lineWidth = 1.5;
  x.lineCap = 'round';
  x.lineJoin = 'round';
  for (let row = 0; row < 8; row++) {
    const base = row * 32 + 14;
    let px = r() * 18;
    while (px < N - 20) {
      const wlen = 16 + r() * 44;
      x.beginPath();
      const ph = r() * 6;
      const amp = 2 + r() * 3;
      for (let k = 0; k <= wlen; k += 2.5) {
        const yy = base - Math.abs(Math.sin(k * 0.55 + ph)) * amp * (0.6 + 0.4 * Math.sin(k * 0.13));
        if (k === 0) x.moveTo(px + k, yy);
        else x.lineTo(px + k, yy);
      }
      x.stroke();
      px += wlen + 8 + r() * 10;
    }
  }
  x.fillStyle = 'rgba(255,224,138,0.22)';
  for (let i = 0; i < 14; i++) {
    x.beginPath();
    x.arc(r() * N, r() * N, 0.9 + r() * 1.2, 0, TAU);
    x.fill();
  }
  return c;
}
try { S.tile = makeTile(); } catch (e) { S.tile = null; }
function getPattern(ctx) {
  if (S.pattern) return S.pattern;
  try {
    if (!S.tile) S.tile = makeTile();
    S.pattern = ctx.createPattern(S.tile, 'repeat');
  } catch {
    S.pattern = null;
  }
  return S.pattern;
}

// ---------- частицы ----------
function spawnLetter(x, y, vx, vy, color, size, life) {
  if (S.parts.length > 420) return;
  S.parts.push({ k: 'ch', x, y, vx, vy, life, max: life, c: LETTERS[Math.floor(Math.random() * LETTERS.length)], size, color, rot: rand(-0.6, 0.6), vr: rand(-1.2, 1.2) });
}
function spawnDrop(x, y, vx, vy, color, size, life, drag = 2.2) {
  if (S.parts.length > 420) return;
  S.parts.push({ k: 'dr', x, y, vx, vy, life, max: life, size, color, drag });
}
function spawnSpark(x, y, vx, vy, color, size, life) {
  if (S.parts.length > 420) return;
  S.parts.push({ k: 'sp', x, y, vx, vy, life, max: life, size, color, drag: 1.2 });
}
function updateParts(dt, u) {
  const ps = S.parts;
  let w = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    p.life -= dt;
    if (p.life <= 0) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.k === 'ch') {
      p.vy -= 10 * u * dt;
      p.rot += p.vr * dt;
      p.vx *= 1 - 0.6 * dt;
    } else {
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d;
      p.vy *= d;
    }
    ps[w++] = p;
  }
  ps.length = w;
}
function drawParts(ctx, u) {
  for (const p of S.parts) {
    const a = clamp(p.life / p.max, 0, 1);
    if (p.k === 'ch') {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.font = `italic 700 ${p.size * u}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = p.color;
      ctx.fillText(p.c, 0, 0);
      ctx.restore();
    } else if (p.k === 'dr') {
      ctx.globalAlpha = Math.min(1, a * 1.5);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.3, p.size * u * (0.4 + 0.6 * a)), 0, TAU);
      ctx.fill();
    } else {
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const s = p.size * u * (0.5 + 0.8 * a);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - s * 1.6);
      ctx.lineTo(p.x + s * 0.4, p.y - s * 0.4);
      ctx.lineTo(p.x + s * 1.6, p.y);
      ctx.lineTo(p.x + s * 0.4, p.y + s * 0.4);
      ctx.lineTo(p.x, p.y + s * 1.6);
      ctx.lineTo(p.x - s * 0.4, p.y + s * 0.4);
      ctx.lineTo(p.x - s * 1.6, p.y);
      ctx.lineTo(p.x - s * 0.4, p.y - s * 0.4);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// ---------- перо ----------
function drawFeather(ctx, L, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  const g = ctx.createLinearGradient(0, 0, L, 0);
  g.addColorStop(0, '#fff6dc');
  g.addColorStop(0.55, '#ffd987');
  g.addColorStop(1, '#d9902f');
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(L * 0.22, -L * 0.3, L * 0.7, -L * 0.24, L, 0);
  ctx.bezierCurveTo(L * 0.7, L * 0.2, L * 0.25, L * 0.27, 0, 0);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(0.6, L * 0.02);
  ctx.strokeStyle = 'rgba(120,70,15,0.55)';
  ctx.beginPath();
  for (let i = 1; i <= 6; i++) {
    const x = L * (0.12 + i * 0.12);
    const w = L * 0.2 * Math.sin((x / L) * Math.PI) * 0.95;
    ctx.moveTo(x, 0);
    ctx.lineTo(x + L * 0.1, -w);
    ctx.moveTo(x, 0);
    ctx.lineTo(x + L * 0.1, w * 0.85);
  }
  ctx.stroke();
  ctx.strokeStyle = '#8a5a1a';
  ctx.lineWidth = Math.max(0.8, L * 0.035);
  ctx.beginPath();
  ctx.moveTo(-L * 0.12, 0);
  ctx.lineTo(L * 0.98, 0);
  ctx.stroke();
  ctx.restore();
}

// Клякса: капля с глазами и пером. (x, y) — центр, heading — куда смотрит, R — радиус тела.
// o.upright — глаза и рот рисуются «по экрану» (для карточек), иначе поворачиваются вместе с телом.
function drawMascot(ctx, x, y, headingDeg, R, o) {
  const mood = o.mood || 'calm';
  const t = o.t || 0;
  const up = o.upright ? (-headingDeg * Math.PI) / 180 : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((headingDeg * Math.PI) / 180);
  const pulse = mood === 'happy' ? 1 + 0.1 * Math.sin(t * 22) : mood === 'smug' ? 1.06 : 1;
  ctx.scale(pulse * (o.stretch || 1), pulse / (o.stretch || 1));
  // ореол
  const halo = ctx.createRadialGradient(0, 0, R * 0.4, 0, 0, R * 2.1);
  halo.addColorStop(0, rgba(o.accent, o.home ? 0.26 : 0.16));
  halo.addColorStop(1, rgba(o.accent, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, R * 2.1, 0, TAU);
  ctx.fill();
  // перо (сзади, под телом)
  ctx.save();
  ctx.translate(-R * 0.35, R * 0.35);
  ctx.rotate(Math.PI - 0.55 + o.sway);
  drawFeather(ctx, R * 2.5);
  ctx.restore();
  // тело-капля
  ctx.beginPath();
  ctx.moveTo(-R * 2.1, 0);
  ctx.bezierCurveTo(-R * 1.4, -R * 0.12, -R * 0.95, -R * 0.95, 0, -R);
  ctx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2);
  ctx.bezierCurveTo(-R * 0.95, R * 0.95, -R * 1.4, R * 0.12, -R * 2.1, 0);
  ctx.closePath();
  const body = ctx.createRadialGradient(R * 0.2, -R * 0.35, R * 0.1, 0, 0, R * 1.15);
  body.addColorStop(0, '#cdbbff');
  body.addColorStop(0.45, o.color);
  body.addColorStop(1, INK2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = Math.max(1, R * 0.09);
  ctx.strokeStyle = rgba(o.accent, 0.9);
  ctx.stroke();
  // блик
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.ellipse(R * 0.05, -R * 0.62, R * 0.3, R * 0.14, -0.4, 0, TAU);
  ctx.fill();
  // глаза
  const ex = R * 0.34, ey = R * 0.4, er = R * 0.36;
  const blink = o.blink > 0 ? 0.12 : 1;
  const px = Math.cos(o.look) * er * 0.38, py = Math.sin(o.look) * er * 0.38;
  for (let s = -1; s <= 1; s += 2) {
    ctx.save();
    ctx.translate(ex, ey * s);
    ctx.rotate(up);
    if (mood === 'dead') {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = R * 0.12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-er * 0.6, -er * 0.6); ctx.lineTo(er * 0.6, er * 0.6);
      ctx.moveTo(er * 0.6, -er * 0.6); ctx.lineTo(-er * 0.6, er * 0.6);
      ctx.stroke();
    } else if (mood === 'happy') {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = R * 0.14;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, er * 0.3, er * 0.62, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(0, 0, er, er * blink * (mood === 'scared' ? 1.25 : 1), 0, 0, TAU);
      ctx.fill();
      if (blink > 0.5) {
        ctx.fillStyle = INK;
        const pr = er * (mood === 'scared' ? 0.32 : 0.52);
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(px - pr * 0.3, py - pr * 0.3, pr * 0.28, 0, TAU);
        ctx.fill();
      }
      if (mood === 'smug') {
        ctx.fillStyle = INK2;
        ctx.beginPath();
        ctx.rect(-er * 1.05, -er * 1.1, er * 2.1, er * 1.05);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  // рот
  ctx.save();
  ctx.translate(R * 0.66, 0);
  ctx.rotate(up);
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = R * 0.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (mood === 'happy' || mood === 'grin') {
    ctx.arc(0, -R * 0.02, R * 0.2, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ff7f9a';
    ctx.beginPath();
    ctx.ellipse(0, R * 0.12, R * 0.09, R * 0.05, 0, 0, TAU);
    ctx.fill();
  } else if (mood === 'scared' || mood === 'surprised') {
    ctx.ellipse(0, 0, R * 0.12, R * 0.16, 0, 0, TAU);
    ctx.fill();
  } else if (mood === 'dead') {
    ctx.moveTo(-R * 0.1, -R * 0.12); ctx.lineTo(R * 0.1, R * 0.12);
    ctx.stroke();
  } else if (mood === 'smug') {
    ctx.moveTo(-R * 0.14, R * 0.1);
    ctx.quadraticCurveTo(R * 0.2, -R * 0.06, R * 0.1, -R * 0.2);
    ctx.stroke();
  } else {
    ctx.moveTo(-R * 0.1, -R * 0.13);
    ctx.quadraticCurveTo(R * 0.12, 0, -R * 0.1, R * 0.13);
    ctx.stroke();
  }
  ctx.restore();
  if (mood === 'scared') {
    ctx.fillStyle = 'rgba(160,220,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(R * 0.1, -R * 1.25);
    ctx.quadraticCurveTo(R * 0.34, -R * 0.95, R * 0.1, -R * 0.82);
    ctx.quadraticCurveTo(-R * 0.14, -R * 0.95, R * 0.1, -R * 1.25);
    ctx.fill();
  }
  ctx.restore();
}

// ---------- сургучная печать на базе ----------
function drawSeal(ctx, cx, cy, r, o) {
  const t = o.t;
  const breathe = 1 + 0.012 * Math.sin(t * 2.4) + (o.stamp || 0);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(breathe, breathe);
  if (o.home) {
    const gl = ctx.createRadialGradient(0, 0, r * 0.8, 0, 0, r * 1.6);
    gl.addColorStop(0, rgba(o.accent, 0.28));
    gl.addColorStop(1, rgba(o.accent, 0));
    ctx.fillStyle = gl;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.6, 0, TAU);
    ctx.fill();
  }
  // тень
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(r * 0.06, r * 0.1, r * 0.98, r * 0.94, 0, 0, TAU);
  ctx.fill();
  // зубчатый край воска
  const lobes = 28;
  ctx.beginPath();
  for (let i = 0; i <= lobes * 4; i++) {
    const a = (i / (lobes * 4)) * TAU;
    const rr = r * (0.9 + 0.045 * Math.sin(a * lobes) + 0.02 * Math.sin(a * 5 + 1.3));
    const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const wax = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r);
  wax.addColorStop(0, '#e0506f');
  wax.addColorStop(0.6, '#b3264f');
  wax.addColorStop(1, '#6e0f33');
  ctx.fillStyle = wax;
  ctx.fill();
  ctx.lineWidth = r * 0.03;
  ctx.strokeStyle = 'rgba(255,200,210,0.35)';
  ctx.stroke();
  // золотое кольцо и 14 точек — по числу строк сонета
  ctx.strokeStyle = rgba(o.accent, 0.95);
  ctx.lineWidth = r * 0.04;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.72, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = rgba(o.accent, 0.95);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU - Math.PI / 2 + t * 0.15;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.81, Math.sin(a) * r * 0.81, r * 0.032, 0, TAU);
    ctx.fill();
  }
  // перо в центре
  if (!o.noEmblem) {
    ctx.save();
    ctx.rotate(-0.6);
    ctx.translate(-r * 0.36, r * 0.02);
    ctx.globalAlpha = 0.95;
    drawFeather(ctx, r * 0.78);
    ctx.restore();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(r * 0.3, r * 0.22, r * 0.07, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ---------- земля ----------
function drawLand(ctx, f, u, t) {
  const rings = f.land;
  if (!rings || !rings.length) return;
  pathRings(ctx, rings);
  const g = ctx.createLinearGradient(0, 0, 0, f.height);
  g.addColorStop(0, 'rgba(46,26,120,0.82)');
  g.addColorStop(1, 'rgba(84,50,188,0.82)');
  ctx.fillStyle = g;
  ctx.fill('evenodd');
  ctx.save();
  ctx.clip('evenodd');
  // внутреннее свечение у края
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(f.color, 0.3);
  ctx.lineWidth = 26 * u;
  ctx.stroke();
  ctx.strokeStyle = rgba(f.color, 0.28);
  ctx.lineWidth = 12 * u;
  ctx.stroke();
  // рукописные строки
  const patt = getPattern(ctx);
  if (patt) {
    ctx.save();
    ctx.scale(u, u);
    ctx.fillStyle = patt;
    ctx.fillRect(0, 0, f.width / u, f.height / u);
    ctx.restore();
  }
  // свет печати растекается по листу
  if (f.base) {
    const bg = ctx.createRadialGradient(f.base.x, f.base.y, 0, f.base.x, f.base.y, 520 * u);
    bg.addColorStop(0, rgba(f.color, 0.22));
    bg.addColorStop(1, rgba(f.color, 0));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, f.width, f.height);
  }
  // бегущий блик
  const D = f.width + f.height;
  const pos = ((t * 0.12) % 1.7 - 0.35) * D;
  const gl = ctx.createLinearGradient(pos - 140 * u, pos * 0.6 - 140 * u, pos + 140 * u, pos * 0.6 + 140 * u);
  gl.addColorStop(0, 'rgba(255,240,200,0)');
  gl.addColorStop(0.5, 'rgba(255,240,200,0.11)');
  gl.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = gl;
  ctx.fillRect(0, 0, f.width, f.height);
  ctx.restore();
  // кромка: чернильная кайма с золотым контуром
  ctx.strokeStyle = rgba(f.accent, 0.16);
  ctx.lineWidth = 8 * u;
  ctx.stroke();
  ctx.strokeStyle = rgba(f.accent, 0.92);
  ctx.lineWidth = 1.8 * u;
  ctx.stroke();
  // бегущие по кромке золотые точки — как чернильная строчка по краю листа
  ctx.save();
  ctx.setLineDash([0.01, 22 * u]);
  ctx.lineDashOffset = -t * 14 * u;
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba('#fff4cf', 0.95);
  ctx.lineWidth = 3.6 * u;
  ctx.stroke();
  ctx.restore();
}

// ---------- шлейф ----------
function drawTrail(ctx, f, u, t, dt) {
  const tr = f.trail;
  if (!tr || tr.length < 4) return;
  const n = tr.length;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tr[0], tr[1]);
  for (let i = 2; i < n; i += 2) ctx.lineTo(tr[i], tr[i + 1]);
  ctx.strokeStyle = rgba(f.color, 0.26);
  ctx.lineWidth = 15 * u;
  ctx.stroke();
  ctx.strokeStyle = INK2;
  ctx.lineWidth = 8.5 * u;
  ctx.stroke();
  ctx.strokeStyle = '#b9a3ff';
  ctx.lineWidth = 5.4 * u;
  ctx.stroke();
  ctx.strokeStyle = '#efe6ff';
  ctx.lineWidth = 2.4 * u;
  ctx.stroke();
  // бусины чернил и золотая искра у головы
  const pts = n / 2;
  ctx.fillStyle = rgba(f.accent, 0.9);
  for (let k = 3; k < pts; k += 7) {
    const i = k * 2;
    const tw = 0.55 + 0.45 * Math.sin(t * 6 + k);
    ctx.beginPath();
    ctx.arc(tr[i], tr[i + 1], 1.5 * u * tw + 0.8 * u, 0, TAU);
    ctx.fill();
  }
  // капли с кончика пера
  S.dripAcc += dt;
  if (S.dripAcc > 0.09 && pts > 3) {
    S.dripAcc = 0;
    const j = Math.max(0, pts - 1 - Math.floor(Math.random() * 6)) * 2;
    spawnDrop(tr[j] + rand(-3, 3) * u, tr[j + 1] + rand(-3, 3) * u, rand(-14, 14) * u, rand(-14, 14) * u, Math.random() < 0.4 ? rgba(f.accent, 0.9) : '#b9a3ff', rand(1.4, 3) * u / u, rand(0.5, 0.9));
  }
}

// ---------- эффекты событий ----------
function textOutlined(ctx, s, x, y, size, fill, stroke, u, align = 'center') {
  ctx.font = `italic 700 ${size * u}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * u * 0.16;
  ctx.strokeStyle = stroke;
  ctx.strokeText(s, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
}

function addEvents(f, u) {
  for (const e of f.events || []) {
    if (e.type === 'capture') {
      const area = e.area || [];
      let gain = ringsArea(area) / (u * u) / 1600000 * 100;
      if (!(gain > 0)) gain = e.cells ? e.cells / 160 : 0;
      const box = ringsBox(area);
      S.fx.push({ k: 'cap', t: 0, dur: 1.6, area, x: e.x, y: e.y, gain, box });
      const n = clamp(Math.round(5 + gain * 2.6), 5, 44);
      for (let i = 0; i < n; i++) {
        const p = randomRingPoint(area) || { x: e.x, y: e.y };
        spawnLetter(p.x, p.y, rand(-30, 30) * u, -rand(30, 95) * u, Math.random() < 0.55 ? f.accent : '#efe6ff', rand(13, 24), rand(1.0, 2.0));
        if (i % 2 === 0) spawnSpark(p.x, p.y, rand(-40, 40) * u, rand(-60, 10) * u, f.accent, rand(1.2, 2.4), rand(0.6, 1.2));
      }
      setMood('happy', 1.5);
    } else if (e.type === 'kill') {
      S.fx.push({ k: 'kill', t: 0, dur: 1.9, x: e.x, y: e.y, rot: rand(-0.25, 0.1) });
      for (let i = 0; i < 34; i++) {
        const a = rand(0, TAU), v = rand(60, 260) * u;
        spawnDrop(e.x, e.y, Math.cos(a) * v, Math.sin(a) * v, Math.random() < 0.6 ? CRIMSON : '#7a3cff', rand(2, 5.5), rand(0.5, 1.2));
      }
      setMood('smug', 1.9);
    } else if (e.type === 'death') {
      S.fx.push({ k: 'blot', t: 0, dur: 2.4, x: e.x, y: e.y, cause: e.cause, seed: Math.random() * 100 });
      S.ghost = { t: 0, dur: 1.7, rings: S.prevLand, x: e.x, y: e.y };
      for (let i = 0; i < 44; i++) {
        const a = rand(0, TAU), v = rand(40, 300) * u;
        spawnDrop(e.x, e.y, Math.cos(a) * v, Math.sin(a) * v, Math.random() < 0.7 ? INK : '#5b32d6', rand(2, 6.5), rand(0.7, 1.6));
      }
      setMood('dead', 3);
    } else if (e.type === 'respawn') {
      S.fx.push({ k: 'resp', t: 0, dur: 1.7, x: e.x, y: e.y });
      for (let i = 0; i < 26; i++) {
        const a = rand(0, TAU), v = rand(50, 190) * u;
        spawnSpark(e.x, e.y, Math.cos(a) * v, Math.sin(a) * v, Math.random() < 0.5 ? f.accent : '#efe6ff', rand(1.3, 2.6), rand(0.7, 1.3));
      }
      setMood('surprised', 1.1);
    }
  }
}

function capTitle(g) {
  return g >= 14 ? 'Поэма!' : g >= 8 ? 'Песнь!' : g >= 4 ? 'Строфа!' : g >= 1.6 ? 'Катрен' : '';
}

function drawFx(ctx, f, u, dt, layer) {
  const fx = S.fx;
  for (const e of fx) {
    const k = clamp(e.t / e.dur, 0, 1);
    if (e.k === 'cap' && layer === 'under') {
      const a = Math.pow(1 - k, 1.4);
      if (e.area && e.area.length) {
        pathRings(ctx, e.area);
        ctx.save();
        ctx.clip('evenodd');
        const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, Math.max(40, Math.hypot(e.box.x1 - e.box.x0, e.box.y1 - e.box.y0)));
        g.addColorStop(0, rgba('#ffc860', 0.55 * a));
        g.addColorStop(1, rgba('#ff9a50', 0.28 * a));
        ctx.fillStyle = g;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillRect(e.box.x0 - 4, e.box.y0 - 4, e.box.x1 - e.box.x0 + 8, e.box.y1 - e.box.y0 + 8);
        ctx.globalCompositeOperation = 'source-over';
        // золотая волна расходится от точки замыкания
        const R = easeOut(k * 1.25) * Math.hypot(e.box.x1 - e.box.x0, e.box.y1 - e.box.y0);
        ctx.strokeStyle = rgba('#ffffff', 0.75 * (1 - k));
        ctx.lineWidth = (7 + 10 * (1 - k)) * u;
        ctx.beginPath();
        ctx.arc(e.x, e.y, R, 0, TAU);
        ctx.stroke();
        ctx.restore();
        pathRings(ctx, e.area);
        ctx.strokeStyle = rgba('#fff4cf', 0.9 * (1 - k));
        ctx.lineWidth = (2 + 4 * (1 - k)) * u;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    } else if (e.k === 'cap' && layer === 'top') {
      const title = capTitle(e.gain);
      if (e.gain >= 0.4) {
        const rise = easeOut(Math.min(1, e.t / 0.9)) * 46 * u;
        const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        const sc = 0.7 + 0.3 * easeOutBack(Math.min(1, e.t / 0.35));
        ctx.globalAlpha = clamp(alpha, 0, 1);
        const size = (title ? 38 : 28) * sc * (0.9 + Math.min(0.5, e.gain / 24));
        textOutlined(ctx, `+${e.gain.toFixed(e.gain >= 10 ? 0 : 1)}%`, e.x, e.y - rise, size, '#fff4cf', INK, u);
        if (title) {
          textOutlined(ctx, title, e.x, e.y - rise + size * 0.95 * u, size * 0.62, f.accent, INK, u);
          // чернильный росчерк под словом
          ctx.strokeStyle = rgba(f.accent, 0.9);
          ctx.lineWidth = 2.6 * u;
          ctx.lineCap = 'round';
          const w = (e.t > 0.2 ? Math.min(1, (e.t - 0.2) / 0.45) : 0) * size * 1.7 * u;
          const yy = e.y - rise + size * 1.45 * u;
          ctx.beginPath();
          ctx.moveTo(e.x - w / 2, yy);
          ctx.quadraticCurveTo(e.x, yy + 7 * u, e.x + w / 2, yy - 3 * u);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    } else if (e.k === 'kill' && layer === 'top') {
      const grow = easeOut(e.t / 0.28);
      const alpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.globalAlpha = clamp(alpha, 0, 1);
      // шок-кольцо
      ctx.strokeStyle = rgba(CRIMSON, 0.9 * (1 - k));
      ctx.lineWidth = 6 * u * (1 - k) + u;
      ctx.beginPath();
      ctx.arc(0, 0, easeOut(k * 1.6) * 120 * u, 0, TAU);
      ctx.stroke();
      // брызги-звезда под крестом
      ctx.fillStyle = rgba(CRIMSON, 0.55);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + 0.3;
        const len = (30 + ((i * 37) % 5) * 9) * u * grow;
        const wdt = 5.5 * u;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 8 * u - Math.sin(a) * wdt, Math.sin(a) * 8 * u + Math.cos(a) * wdt);
        ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
        ctx.lineTo(Math.cos(a) * 8 * u + Math.sin(a) * wdt, Math.sin(a) * 8 * u - Math.cos(a) * wdt);
        ctx.closePath();
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 16 * u * grow, 0, TAU);
      ctx.fill();
      // зачёркивание: две кисти крест-накрест
      ctx.lineCap = 'round';
      const L = 38 * u * grow;
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? INK : CRIMSON;
        ctx.lineWidth = (pass === 0 ? 17 : 10.5) * u;
        const p1 = clamp((e.t - 0.0) / 0.16, 0, 1), p2 = clamp((e.t - 0.12) / 0.16, 0, 1);
        ctx.beginPath();
        ctx.moveTo(-L, -L);
        ctx.lineTo(-L + 2 * L * p1, -L + 2 * L * p1);
        ctx.moveTo(L, -L * 0.9);
        ctx.lineTo(L - 2 * L * p2, -L * 0.9 + 1.9 * L * p2);
        ctx.stroke();
      }
      ctx.rotate(e.rot);
      const ty = -62 * u - easeOut(e.t / 0.8) * 22 * u;
      textOutlined(ctx, 'Зачёркнуто!', 0, ty, 34 * (0.8 + 0.2 * easeOutBack(e.t / 0.3)), '#ffe9ee', '#7a0f2a', u);
      ctx.restore();
    } else if (e.k === 'blot' && layer === 'under2') {
      const grow = easeOut(e.t / 0.4);
      const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.fillStyle = INK;
      ctx.strokeStyle = rgba('#7a54ff', 0.8);
      ctx.lineWidth = 2.4 * u;
      ctx.beginPath();
      const lobes = 11;
      for (let i = 0; i <= lobes * 6; i++) {
        const a = (i / (lobes * 6)) * TAU;
        const rr = (30 + 6 * Math.sin(a * 2 + e.seed) + 5 * Math.sin(a * 3 + e.seed * 2) + 3 * Math.sin(a * 5 + e.seed * 3)) * u * grow;
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // блик на кляксе
      ctx.fillStyle = 'rgba(190,170,255,0.55)';
      ctx.beginPath();
      ctx.ellipse(-8 * u * grow, -9 * u * grow, 9 * u * grow, 4 * u * grow, -0.5, 0, TAU);
      ctx.fill();
      ctx.restore();
    } else if (e.k === 'blot' && layer === 'top') {
      const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.globalAlpha = clamp(alpha, 0, 1);
      const word = e.cause === 'cut' ? 'Срезали!' : e.cause === 'self' ? 'Сам себя…' : e.cause === 'wall' ? 'За край листа!' : 'Лоб в лоб!';
      textOutlined(ctx, 'Клякса!', e.x, e.y - 62 * u - easeOut(e.t / 0.7) * 16 * u, 30 * (0.85 + 0.15 * easeOutBack(e.t / 0.3)), '#e8deff', INK, u);
      textOutlined(ctx, word, e.x, e.y - 34 * u - easeOut(e.t / 0.7) * 16 * u, 18, rgba(f.accent, 1), INK, u);
      // сломанное перо
      const fall = easeOut(e.t / 1.1);
      for (let s = -1; s <= 1; s += 2) {
        ctx.save();
        ctx.translate(e.x + s * (12 + 40 * fall) * u, e.y - 6 * u + (24 * fall - 30 * fall * fall * 0.0) * u);
        ctx.rotate(s * (0.5 + 1.8 * fall));
        ctx.globalAlpha = clamp(alpha * (1 - fall * 0.35), 0, 1);
        drawFeather(ctx, 30 * u);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    } else if (e.k === 'resp' && layer === 'top') {
      const alpha = 1 - k;
      ctx.save();
      ctx.translate(e.x, e.y);
      for (let i = 0; i < 2; i++) {
        const kk = clamp(k * 1.5 - i * 0.25, 0, 1);
        ctx.strokeStyle = rgba(i ? '#efe6ff' : f.accent, 0.85 * (1 - kk));
        ctx.lineWidth = (6 - 4 * kk) * u;
        ctx.beginPath();
        ctx.arc(0, 0, (20 + easeOut(kk) * 150) * u, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = clamp(alpha * 1.5, 0, 1);
      textOutlined(ctx, e.label || 'Новая страница', 0, -76 * u - easeOut(e.t / 1.0) * 14 * u, 22, '#fff4cf', INK, u);
      ctx.restore();
    }
  }
}

function stepFx(dt) {
  let w = 0;
  for (let i = 0; i < S.fx.length; i++) {
    const e = S.fx[i];
    e.t += dt;
    if (e.t < e.dur) S.fx[w++] = e;
  }
  S.fx.length = w;
}

// сгорающая земля после гибели
function drawGhost(ctx, f, u, dt) {
  const g = S.ghost;
  if (!g) return;
  g.t += dt;
  if (g.t >= g.dur || !g.rings) { S.ghost = null; return; }
  const k = g.t / g.dur;
  const D = Math.hypot(f.width, f.height);
  const r = easeOut(k) * D * 0.9;
  ctx.save();
  // оставить видимой только часть вне круга выгорания
  ctx.beginPath();
  ctx.rect(0, 0, f.width, f.height);
  ctx.arc(g.x, g.y, r, 0, TAU, true);
  ctx.clip('evenodd');
  pathRings(ctx, g.rings);
  ctx.fillStyle = `rgba(${Math.round(lerp(60, 20, k))},${Math.round(lerp(40, 10, k))},${Math.round(lerp(130, 40, k))},${0.8 * (1 - k * 0.6)})`;
  ctx.fill('evenodd');
  ctx.strokeStyle = rgba(f.accent, 0.5 * (1 - k));
  ctx.lineWidth = 1.6 * u;
  ctx.stroke();
  ctx.restore();
  // кромка выгорания
  ctx.strokeStyle = rgba(CRIMSON, 0.55 * (1 - k));
  ctx.lineWidth = (10 * (1 - k) + 2) * u;
  ctx.beginPath();
  ctx.arc(g.x, g.y, r, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = rgba('#ffe08a', 0.8 * (1 - k));
  ctx.lineWidth = 2.5 * u;
  ctx.stroke();
}

// ---------- кадр арены ----------
function drawArena(ctx, f) {
  const u = f.unit || 1;
  if (f.t < S.lastT - 0.5) resetState();
  S.lastT = f.t;
  const dt = clamp(f.dt || 1 / 60, 0, 0.1);
  const t = f.t;
  guard(() => addEvents(f, u));
  guard(() => {
    if (!S.opened && f.t < 0.3 && f.base) {
      S.opened = true;
      S.fx.push({ k: 'resp', t: 0, dur: 1.9, x: f.base.x, y: f.base.y, label: 'Первая строка' });
      for (let i = 0; i < 26; i++) {
        const a = rand(0, TAU), v = rand(50, 190) * u;
        spawnSpark(f.base.x, f.base.y, Math.cos(a) * v, Math.sin(a) * v, Math.random() < 0.5 ? f.accent : '#efe6ff', rand(1.3, 2.6), rand(0.7, 1.3));
      }
      setMood('surprised', 1.0);
    }
  });
  const head = f.head || { x: 0, y: 0, heading: 0, alive: false, respawnIn: 0, home: false };

  // настроение
  if (S.moodT > 0) {
    S.moodT -= dt;
    if (S.moodT <= 0) S.mood = 'calm';
  }
  let mood = S.mood;
  const en = f.enemy && f.enemy.head;
  let enemyDist = 1e9, look = 0;
  if (head && head.alive && en && en.alive) {
    const dx = en.x - head.x, dy = en.y - head.y;
    enemyDist = Math.hypot(dx, dy) / u;
    look = Math.atan2(dy, dx) - (head.heading * Math.PI) / 180;
  }
  if (mood === 'calm' && enemyDist < 150 && !head.home) mood = 'scared';
  // перо покачивается при поворотах
  if (head && S.lastHeading != null) {
    let d = head.heading - S.lastHeading;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    S.turnVel = lerp(S.turnVel, d / Math.max(dt, 1e-3), 0.25);
  }
  if (head) S.lastHeading = head.heading;
  S.featherAng = lerp(S.featherAng, clamp(-S.turnVel * 0.004, -0.6, 0.6), 0.2);
  S.nextBlink -= dt;
  if (S.nextBlink < 0) { S.blink = 0.13; S.nextBlink = rand(2, 4.5); }
  if (S.blink > 0) S.blink -= dt;

  guard(() => updateParts(dt, u));
  ctx.save();
  guard(() => drawGhost(ctx, f, u, dt));
  guard(() => drawLand(ctx, f, u, t));
  guard(() => drawFx(ctx, f, u, dt, 'under'));
  guard(() => drawFx(ctx, f, u, dt, 'under2'));
  // печать
  guard(() => {
    const b = f.base;
    const resp = head && !head.alive;
    if (resp) S.respMax = Math.max(S.respMax, head.respawnIn);
    let stamp = 0;
    for (const e of S.fx) if (e.k === 'resp') stamp = Math.max(stamp, 0.08 * Math.sin(Math.min(1, e.t / 0.5) * Math.PI));
    drawSeal(ctx, b.x, b.y, b.r * u > 0 ? b.r : 60 * u, { t, accent: f.accent, home: head && head.alive && head.home, stamp });
    if (resp) {
      const frac = 1 - clamp(head.respawnIn / Math.max(1, S.respMax), 0, 1);
      ctx.strokeStyle = rgba(f.accent, 0.95);
      ctx.lineWidth = 5 * u;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 1.12, -Math.PI / 2, -Math.PI / 2 + frac * TAU);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 1.12, 0, TAU);
      ctx.stroke();
      // призрак Кляксы над печатью
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 5);
      drawMascot(ctx, b.x, b.y - 4 * u + Math.sin(t * 3) * 3 * u, -90, 14 * u, { mood: 'calm', color: f.color, accent: f.accent, sway: Math.sin(t * 3) * 0.2, look: 0, blink: 0, t });
      ctx.globalAlpha = 1;
      const sec = Math.ceil(clamp(head.respawnIn / Math.max(1, S.respMax), 0, 1) * 3);
      textOutlined(ctx, String(sec), b.x, b.y + b.r * 1.5, 24, '#fff4cf', INK, u);
    }
  });
  guard(() => drawTrail(ctx, f, u, t, dt));
  guard(() => drawParts(ctx, u));
  guard(() => {
    if (head && head.alive) {
      const R = 19 * u;
      const stretch = 1 + clamp(S.turnVel * 0.0006, -0.05, 0.05);
      drawMascot(ctx, head.x, head.y, head.heading, R, {
        mood, color: f.color, accent: f.accent, home: head.home, t,
        sway: S.featherAng + Math.sin(t * 7) * 0.12, look, blink: S.blink, stretch,
      });
    }
  });
  guard(() => drawFx(ctx, f, u, dt, 'top'));
  ctx.restore();
  guard(() => stepFx(dt));
  if (!S.ghostSkip) S.prevLand = f.land && f.land.length ? f.land : S.prevLand;
}

// ---------- карточка перед матчем ----------
function fitText(ctx, text, maxW, size, weight = '700') {
  ctx.font = `italic ${weight} ${size}px ${FONT}`;
  const w = ctx.measureText(text).width;
  return w > maxW ? Math.floor((size * maxW) / w) : size;
}
function wrapLines(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}
function paperBackground(ctx, w, h, color, accent, t) {
  const g = ctx.createRadialGradient(w / 2, h * 0.38, 40, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, '#2a1a63');
  g.addColorStop(0.6, '#150d3a');
  g.addColorStop(1, '#09061c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const patt = (function () {
    try {
      if (!S.tile) S.tile = makeTile();
      return ctx.createPattern(S.tile, 'repeat');
    } catch {
      return null;
    }
  })();
  if (patt) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = patt;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}
function frame(ctx, x, y, w, h, accent, k) {
  ctx.save();
  ctx.strokeStyle = rgba(accent, 0.85 * k);
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 9, y + 9, w - 18, h - 18);
  // уголки-завитки
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  const corners = [[x + 9, y + 9, 1, 1], [x + w - 9, y + 9, -1, 1], [x + 9, y + h - 9, 1, -1], [x + w - 9, y + h - 9, -1, -1]];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * 4, cy + sy * 46);
    ctx.bezierCurveTo(cx + sx * 4, cy + sy * 14, cx + sx * 14, cy + sy * 4, cx + sx * 46, cy + sy * 4);
    ctx.moveTo(cx + sx * 12, cy + sy * 30);
    ctx.bezierCurveTo(cx + sx * 12, cy + sy * 18, cx + sx * 18, cy + sy * 12, cx + sx * 30, cy + sy * 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + sx * 20, cy + sy * 20, 3, 0, TAU);
    ctx.fillStyle = rgba(accent, 0.9 * k);
    ctx.fill();
  }
  ctx.restore();
}
function flourish(ctx, cx, y, w, prog, accent) {
  // росчерк с завитками, прорисовывается по мере prog
  const pts = [];
  const N = 90;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const xx = cx + (s - 0.5) * w;
    const env = Math.sin(s * Math.PI);
    const yy = y + Math.sin(s * TAU * 3) * 5 * env + Math.sin(s * TAU * 7) * 1.5 * env;
    pts.push([xx, yy]);
  }
  const n = Math.floor(pts.length * clamp(prog, 0, 1));
  if (n < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const grad = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
  grad.addColorStop(0, rgba(accent, 0));
  grad.addColorStop(0.2, rgba(accent, 1));
  grad.addColorStop(0.8, rgba(accent, 1));
  grad.addColorStop(1, rgba(accent, 0));
  ctx.strokeStyle = grad;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  // ромб посередине
  if (prog > 0.55) {
    ctx.fillStyle = rgba(accent, 1);
    ctx.beginPath();
    ctx.moveTo(cx, y - 8); ctx.lineTo(cx + 7, y); ctx.lineTo(cx, y + 8); ctx.lineTo(cx - 7, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  return pts[n - 1];
}
function goldText(ctx, text, cx, cy, size, accent, alpha = 1, glow = 0) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `italic 800 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (glow > 0) {
    ctx.shadowColor = rgba(accent, 0.8);
    ctx.shadowBlur = glow;
  }
  ctx.lineWidth = size * 0.13;
  ctx.strokeStyle = INK;
  ctx.strokeText(text, cx, cy);
  ctx.shadowBlur = 0;
  const g = ctx.createLinearGradient(0, cy - size * 0.5, 0, cy + size * 0.5);
  g.addColorStop(0, '#fffbe8');
  g.addColorStop(0.45, accent);
  g.addColorStop(1, '#c4862a');
  ctx.fillStyle = g;
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

function drawIntro(ctx, f) {
  const { width: w, height: h, t } = f;
  const dt = clamp(f.dt || 1 / 60, 0, 0.1);
  if (t < S.lastT - 0.5) { resetState(); S.introSparks = 0; }
  S.lastT = t;
  paperBackground(ctx, w, h, f.color, f.accent, t);
  frame(ctx, 22, 22, w - 44, h - 44, f.accent, easeOut(t / 0.8));
  // искры, поднимающиеся вверх
  S.introSparks = (S.introSparks || 0) + dt;
  while (S.introSparks > 0.07) {
    S.introSparks -= 0.07;
    spawnSpark(rand(60, w - 60), h - 40, rand(-8, 8), -rand(30, 80), Math.random() < 0.6 ? f.accent : '#efe6ff', rand(1.2, 2.2), rand(2.5, 4.5));
  }
  updateParts(dt, 1);
  drawParts(ctx, 1);

  // Клякса на авансцене
  const k0 = easeOutBack(clamp(t / 0.7, 0, 1));
  const bob = Math.sin(t * 2.2) * 8;
  const R = 80 * k0;
  const cx = w / 2 + 6, cy = 286 + bob;
  // лужа чернил под ней
  ctx.fillStyle = 'rgba(8,4,24,0.6)';
  ctx.beginPath();
  ctx.ellipse(cx, 395, 120 * k0 * (1 - bob * 0.01), 20 * k0, 0, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(0);
  // лицом к зрителю: поворот так, чтобы глаза смотрели вперёд-вниз
  ctx.restore();
  const look = Math.sin(t * 1.3) * 0.5;
  if (S.nextBlink > 100) S.nextBlink = 0;
  const blink = Math.sin(t * 1.9) > 0.985 ? 0.12 : (t % 3.3) < 0.12 ? 0.12 : 1;
  const happyBlink = t > 1.5 ? 'grin' : 'calm';
  drawMascot(ctx, cx, cy, 90 + Math.sin(t * 1.4) * 7, R, { mood: happyBlink, color: f.color, accent: f.accent, home: true, t, sway: Math.sin(t * 2.3) * 0.25, look: Math.PI / 2 + look * 0.5 - Math.PI / 2 + 0.3 * Math.sin(t * 1.3), blink: blink < 1 ? 1 : 0, upright: true });

  // название
  const title = String(f.name || '').toUpperCase();
  const size = fitText(ctx, title, w - 150, 118, '800');
  const letters = [...title];
  ctx.save();
  ctx.font = `italic 800 ${size}px ${FONT}`;
  const totalW = ctx.measureText(title).width;
  ctx.restore();
  let x = w / 2 - totalW / 2;
  const ty = 498;
  for (let i = 0; i < letters.length; i++) {
    ctx.save();
    ctx.font = `italic 800 ${size}px ${FONT}`;
    const lw = ctx.measureText(letters[i]).width;
    ctx.restore();
    const lt = clamp((t - 0.7 - i * 0.09) / 0.45, 0, 1);
    if (lt > 0) {
      const rise = (1 - easeOut(lt)) * 36;
      goldText(ctx, letters[i], x + lw / 2, ty + rise, size, f.accent, easeOut(lt), 18 * lt * (1 - lt) * 3);
      if (lt < 1) {
        // капли с каждой буквы при «написании»
        if (Math.random() < 0.5) spawnDrop(x + lw / 2 + rand(-12, 12), ty + rand(20, 60), rand(-10, 10), rand(10, 40), '#b9a3ff', rand(1.5, 3.5), rand(0.5, 1));
      }
    }
    x += lw;
  }
  // росчерк
  const tip = flourish(ctx, w / 2, ty + size * 0.62 + 20, Math.min(w - 170, totalW + 120), (t - 1.3) / 0.8, f.accent);
  if (tip && t < 2.15) {
    ctx.save();
    ctx.translate(tip[0], tip[1]);
    ctx.rotate(-0.9);
    drawFeather(ctx, 52);
    ctx.restore();
  }
  // девиз
  const mt = clamp((t - 1.9) / 0.7, 0, 1);
  if (mt > 0) {
    ctx.save();
    ctx.globalAlpha = easeOut(mt);
    const msize = fitText(ctx, f.motto || '', w - 160, 34, '600') > 34 ? 34 : 34;
    ctx.font = `italic 600 ${msize}px ${FONT}`;
    const lines = wrapLines(ctx, '«' + (f.motto || '') + '»', w - 160);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = CREAM;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(10,5,30,0.85)';
    const y0 = ty + size * 0.62 + 90;
    for (let i = 0; i < lines.length; i++) {
      const yy = y0 + i * (msize * 1.3) + (1 - easeOut(mt)) * 14;
      ctx.strokeText(lines[i], w / 2, yy);
      ctx.fillText(lines[i], w / 2, yy);
    }
    ctx.restore();
  }
  // 14 строк внизу, пишутся друг за другом (4 + 4 + 3 + 3)
  const baseY = h - 118;
  const groups = [4, 4, 3, 3];
  let li = 0;
  ctx.save();
  ctx.lineCap = 'round';
  for (let gi = 0; gi < groups.length; gi++) {
    for (let j = 0; j < groups[gi]; j++, li++) {
      const lt = clamp((t - 2.0 - li * 0.07) / 0.35, 0, 1);
      const col = gi * 188 + 74;
      const wl = 140 - ((li * 37) % 5) * 12;
      const yy = baseY + j * 14 - (gi >= 2 ? 0 : 0);
      ctx.strokeStyle = rgba(f.accent, 0.55 * (gi === 3 && j === 2 ? 1 : 0.75));
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(col, yy);
      for (let s = 1; s <= 14 * lt; s++) ctx.lineTo(col + (s / 14) * wl, yy + Math.sin(s * 1.9 + li) * 1.8);
      ctx.stroke();
    }
  }
  ctx.restore();
  // подпись
  ctx.save();
  ctx.globalAlpha = easeOut(clamp((t - 3.1) / 0.6, 0, 1)) * 0.9;
  ctx.font = `italic 600 20px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = rgba(f.accent, 1);
  ctx.fillText('четырнадцать строк — одна команда', w / 2, h - 52);
  ctx.restore();
}

// ---------- победа ----------
const POEM = [
  'Был чистый лист — ни слова, ни следа.',
  'Я вышел в поле с пером на ветру,',
  'И росчерк лёг, как первая звезда,',
  'И строчка вьётся, словно по шнуру.',
  'Соперник ждёт, но тонок мой пунктир,',
  'А я иду, не глядя назад.',
  'Замкнуть петлю — и вот он, целый мир,',
  'Где каждый шаг уложен в стройный ряд.',
  'Земля растёт, как рифма за строкой,',
  'И враг уже не вырвет из-под рук',
  'Мой замысел, мой выстроенный строй,',
  'И в тишине лишь слышен пера стук.',
  'Что написано пером —',
  'того не вырубишь топором.',
];
function drawVictory(ctx, f) {
  const { width: w, height: h, t } = f;
  const dt = clamp(f.dt || 1 / 60, 0, 0.1);
  if (t < S.lastT - 0.5) { resetState(); S.stamped = false; }
  S.lastT = t;
  paperBackground(ctx, w, h, f.color, f.accent, t);
  frame(ctx, 14, 14, w - 28, h - 28, f.accent, easeOut(t / 0.5));
  // прожектор на печать
  const stampT = 2.75;
  const sx = w * 0.79, sy = h * 0.52;
  const sp = ctx.createRadialGradient(sx, sy, 10, sx, sy, 300);
  sp.addColorStop(0, rgba(f.accent, 0.20 * easeOut((t - 1.5) / 1.2)));
  sp.addColorStop(1, rgba(f.accent, 0));
  ctx.fillStyle = sp;
  ctx.fillRect(0, 0, w, h);

  // поэма
  const x0 = 62;
  const lineH = 35;
  const y0 = 66;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const per = 0.15;
  let cursor = null;
  for (let i = 0; i < POEM.length; i++) {
    const ls = 0.25 + i * per;
    const lp = clamp((t - ls) / (per * 1.5), 0, 1);
    if (lp <= 0) continue;
    const couplet = i >= 12;
    const gap = i >= 12 ? 18 : i >= 8 ? 8 : i >= 4 ? 4 : 0;
    const yy = y0 + i * lineH + gap;
    const size = couplet ? 33 : 27;
    ctx.font = `italic ${couplet ? 800 : 600} ${size}px ${FONT}`;
    const full = POEM[i];
    const nChars = Math.floor(full.length * lp);
    const txt = full.slice(0, nChars);
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(8,4,24,0.9)';
    ctx.strokeText(txt, x0, yy);
    if (couplet) {
      const g = ctx.createLinearGradient(x0, yy - 14, x0, yy + 14);
      g.addColorStop(0, '#fffbe8');
      g.addColorStop(1, f.accent);
      ctx.fillStyle = g;
    } else ctx.fillStyle = i % 2 ? '#d9ccff' : '#efe8ff';
    ctx.fillText(txt, x0, yy);
    if (lp < 1) cursor = { x: x0 + ctx.measureText(txt).width, y: yy };
    // номера строк слева, как в изданиях
    ctx.font = `italic 600 13px ${FONT}`;
    ctx.fillStyle = rgba(f.accent, 0.5);
    ctx.textAlign = 'right';
    ctx.fillText(String(i + 1), x0 - 12, yy);
    ctx.textAlign = 'left';
  }
  if (cursor) {
    ctx.save();
    ctx.translate(cursor.x + 6, cursor.y + 4);
    ctx.rotate(-0.95);
    drawFeather(ctx, 46);
    ctx.restore();
  }
  ctx.restore();

  // печать «ПОБЕДА» и Клякса
  const st = t - stampT;
  if (st > -0.05 && !S.stamped) {
    S.stamped = true;
    for (let i = 0; i < 36; i++) {
      const a = rand(0, TAU), v = rand(120, 420);
      spawnDrop(sx, sy, Math.cos(a) * v, Math.sin(a) * v, Math.random() < 0.5 ? CRIMSON : INK2, rand(2, 6), rand(0.6, 1.4));
    }
    for (let i = 0; i < 40; i++) {
      const a = rand(0, TAU), v = rand(80, 360);
      spawnSpark(sx, sy, Math.cos(a) * v, Math.sin(a) * v, Math.random() < 0.5 ? f.accent : '#fffbe8', rand(1.5, 3.2), rand(0.8, 1.6));
    }
  }
  if (st > 0) {
    // конфетти из букв
    if (Math.random() < 0.8) {
      spawnLetter(rand(w * 0.54, w - 24), -10, rand(-20, 20), rand(60, 140), Math.random() < 0.5 ? f.accent : '#efe6ff', rand(16, 30), rand(2.5, 4));
    }
    S.parts.forEach((p) => { if (p.k === 'ch' && p.vy > 0) p.vy += 0; });
  }
  updateParts(dt, 1);
  const sk = st > 0 ? easeOutBack(clamp(st / 0.45, 0, 1)) : 0;
  if (sk > 0) {
    const R = 128;
    // тяжёлый удар: кольцо
    if (st < 0.7) {
      ctx.strokeStyle = rgba('#fffbe8', 0.8 * (1 - st / 0.7));
      ctx.lineWidth = 10 * (1 - st / 0.7) + 1;
      ctx.beginPath();
      ctx.arc(sx, sy, R * (0.9 + easeOut(st / 0.7) * 1.2), 0, TAU);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(sx, sy);
    const sc = 0.12 + 0.88 * sk + (st < 0.45 ? 0 : 0.015 * Math.sin(st * 3));
    ctx.rotate((1 - Math.min(1, st / 0.5)) * 0.5 - 0.08);
    ctx.scale(sc * 1.15, sc * 1.15);
    drawSeal(ctx, 0, 0, R, { t, accent: f.accent, home: true, stamp: 0, noEmblem: true });
    // надпись по центру печати
    ctx.restore();
    ctx.save();
    ctx.translate(sx, sy + 6);
    ctx.rotate(-0.08);
    ctx.scale(sc, sc);
    goldText(ctx, 'ПОБЕДА', 0, -22, 40, f.accent, 1, 0);
    ctx.font = `italic 800 38px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(60,5,25,0.9)';
    const ptxt = (f.percent != null ? Number(f.percent).toFixed(1) : '') + '% поля';
    ctx.strokeText(ptxt, 0, 24);
    ctx.fillStyle = '#fff4cf';
    ctx.fillText(ptxt, 0, 24);
    ctx.restore();
    // Клякса прыгает над печатью
    const jump = Math.abs(Math.sin(st * 4.2)) * 22;
    drawMascot(ctx, sx, sy - 162 - jump, 90 + Math.sin(st * 3) * 12, 40, { mood: 'happy', color: f.color, accent: f.accent, home: true, t, sway: Math.sin(st * 9) * 0.35, look: 0, blink: 0, stretch: 1 + (jump > 18 ? 0.06 : -0.03), upright: true });
  } else {
    // до удара — Клякса сидит и ждёт
    drawMascot(ctx, sx, sy - 40 + Math.sin(t * 2) * 4, 90, 40, { mood: 'calm', color: f.color, accent: f.accent, home: true, t, sway: Math.sin(t * 2) * 0.2, look: -0.4 + Math.sin(t) * 0.4, blink: (t % 2.7) < 0.12 ? 1 : 0, upright: true });
  }
  drawParts(ctx, 1);
  // подпись
  ctx.save();
  ctx.globalAlpha = easeOut((t - 3.4) / 0.6);
  ctx.font = `italic 600 22px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(f.accent, 1);
  ctx.fillText('— ' + (f.name || ''), w - 66, h - 52);
  ctx.restore();
}

// Карточка и победа рассчитаны на 840×860 и 1152×648 логических пикселей; на 4K холст вдвое больше,
// поэтому рисуем в логических координатах и растягиваем.
function scaled(ctx, f, w0, h0, fn) {
  const k = Math.max(0.2, Math.min((f.width || w0) / w0, (f.height || h0) / h0));
  ctx.save();
  ctx.scale(k, k);
  try {
    fn(ctx, { ...f, width: f.width / k, height: f.height / k });
  } finally {
    ctx.restore();
  }
}

export default {
  draw(ctx, f) {
    if (f.mode === 'intro') scaled(ctx, f, 840, 860, drawIntro);
    else if (f.mode === 'victory') scaled(ctx, f, 1152, 648, drawVictory);
    else drawArena(ctx, f);
  },
};
