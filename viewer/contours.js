// Smooth outlines of a raster mask: marching squares over cell centres, then Chaikin smoothing.
// Result: closed rings in world units, each a Float32Array [x0, y0, x1, y1, ...].
// Fill all rings of a shape in one path with the 'evenodd' rule: holes come out right.
import { COLS, ROWS, CELL } from '/kit/arena/engine.js';

// Segment table: corners tl=8, tr=4, br=2, bl=1; edges 0 top, 1 right, 2 bottom, 3 left.
const SEG = {
  1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 5: [[3, 0], [2, 1]], 6: [[0, 2]], 7: [[3, 0]],
  8: [[3, 0]], 9: [[0, 2]], 10: [[0, 1], [3, 2]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]],
};

export function maskRings(mask, smooth = 2, iso = 0.42) {
  // Soft field: 3x3 weighted blur of the mask, contoured at `iso` with interpolation along edges.
  // This turns raster staircases into straight diagonals and round corners.
  const B = new Float32Array(COLS * ROWS);
  const W3 = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      let v = 0;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++, k++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < COLS && yy < ROWS && mask[yy * COLS + xx]) v += W3[k];
        }
      }
      B[y * COLS + x] = v / 16;
    }
  }
  // Padded corner grid: corner (i, j) is the centre of cell (i-1, j-1); outside is 0.
  const GW = COLS + 2;
  const GH = ROWS + 2;
  const val = (i, j) => (i < 1 || j < 1 || i > COLS || j > ROWS ? 0 : B[(j - 1) * COLS + (i - 1)]);
  const at = (i, j) => (val(i, j) >= iso ? 1 : 0);
  // Edge ids: horizontal edge from corner (i,j) to (i+1,j) -> 2*(j*GW+i); vertical (i,j)-(i,j+1) -> 2*(j*GW+i)+1.
  const edgeId = (i, j, e) => (e === 0 ? 2 * (j * GW + i) : e === 2 ? 2 * ((j + 1) * GW + i) : e === 3 ? 2 * (j * GW + i) + 1 : 2 * (j * GW + i + 1) + 1);
  const ends = (i, j, e) => (e === 0 ? [i, j, i + 1, j] : e === 1 ? [i + 1, j, i + 1, j + 1] : e === 2 ? [i, j + 1, i + 1, j + 1] : [i, j, i, j + 1]);
  const pos = new Map();
  const links = new Map();
  const link = (a, b) => {
    (links.get(a) || links.set(a, []).get(a)).push(b);
    (links.get(b) || links.set(b, []).get(b)).push(a);
  };
  for (let j = 0; j < GH - 1; j++) {
    for (let i = 0; i < GW - 1; i++) {
      const c = (at(i, j) << 3) | (at(i + 1, j) << 2) | (at(i + 1, j + 1) << 1) | at(i, j + 1);
      const segs = SEG[c];
      if (!segs) continue;
      for (const [e1, e2] of segs) {
        const a = edgeId(i, j, e1);
        const b = edgeId(i, j, e2);
        for (const [id, e] of [[a, e1], [b, e2]]) {
          if (pos.has(id)) continue;
          const [ai, aj, bi, bj] = ends(i, j, e);
          const va = val(ai, aj);
          const vb = val(bi, bj);
          const tt = Math.abs(vb - va) > 1e-6 ? Math.max(0, Math.min(1, (iso - va) / (vb - va))) : 0.5;
          const x = ai + (bi - ai) * tt;
          const y = aj + (bj - aj) * tt;
          // corner (i, j) is at world ((i - 1 + 0.5) * CELL, (j - 1 + 0.5) * CELL)
          pos.set(id, [(x - 0.5) * CELL, (y - 0.5) * CELL]);
        }
        link(a, b);
      }
    }
  }
  const used = new Set();
  const rings = [];
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    const pts = [];
    let prev = -1;
    let cur = start;
    while (cur !== undefined && !used.has(cur)) {
      used.add(cur);
      pts.push(pos.get(cur));
      const nb = links.get(cur);
      const next = nb[0] !== prev && !used.has(nb[0]) ? nb[0] : nb[1] !== prev && !used.has(nb[1]) ? nb[1] : undefined;
      prev = cur;
      cur = next;
    }
    if (pts.length >= 3) rings.push(chaikin(pts, smooth));
  }
  return rings;
}

function chaikin(pts, iterations) {
  let p = pts;
  for (let k = 0; k < iterations; k++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = q;
  }
  const out = new Float32Array(p.length * 2);
  p.forEach(([x, y], i) => {
    out[2 * i] = x;
    out[2 * i + 1] = y;
  });
  return out;
}

export function sideRings(land, side) {
  const mask = new Uint8Array(land.length);
  for (let i = 0; i < land.length; i++) mask[i] = land[i] === side ? 1 : 0;
  return maskRings(mask);
}

export function cellsRings(cells) {
  const mask = new Uint8Array(COLS * ROWS);
  for (const i of cells) mask[i] = 1;
  return maskRings(mask);
}

// Smooth an open polyline (trail) with Chaikin, keeping its ends.
export function smoothLine(pts, iterations = 2) {
  let p = pts;
  for (let k = 0; k < iterations && p.length > 2; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}
