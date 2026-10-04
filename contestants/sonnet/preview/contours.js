// Построение гладких контуров из маски клеток (для стенда: арена даёт свои контуры).
export function ringsFromCells(isIn, cols, rows, cell, smooth = 2) {
  const W1 = cols + 1;
  const out = new Map(); // вершина -> [вершина...]
  const addEdge = (a, b) => {
    if (!out.has(a)) out.set(a, []);
    out.get(a).push(b);
  };
  const v = (x, y) => y * W1 + x;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!isIn(cy * cols + cx)) continue;
      if (cy === 0 || !isIn((cy - 1) * cols + cx)) addEdge(v(cx, cy), v(cx + 1, cy));
      if (cx === cols - 1 || !isIn(cy * cols + cx + 1)) addEdge(v(cx + 1, cy), v(cx + 1, cy + 1));
      if (cy === rows - 1 || !isIn((cy + 1) * cols + cx)) addEdge(v(cx + 1, cy + 1), v(cx, cy + 1));
      if (cx === 0 || !isIn(cy * cols + cx - 1)) addEdge(v(cx, cy + 1), v(cx, cy));
    }
  }
  const rings = [];
  for (const [start] of out) {
    while (out.get(start)?.length) {
      const pts = [];
      let cur = start;
      for (let guard = 0; guard < 200000; guard++) {
        const list = out.get(cur);
        if (!list || !list.length) break;
        const nxt = list.pop();
        pts.push(cur);
        cur = nxt;
        if (cur === start) break;
      }
      if (pts.length >= 4) rings.push(pts);
    }
  }
  return rings.map((pts) => {
    let xy = [];
    for (const p of pts) xy.push((p % W1) * cell, Math.floor(p / W1) * cell);
    // убрать коллинеарные
    const n = xy.length / 2;
    const keep = [];
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n, b = (i + 1) % n;
      const dx1 = xy[i * 2] - xy[a * 2], dy1 = xy[i * 2 + 1] - xy[a * 2 + 1];
      const dx2 = xy[b * 2] - xy[i * 2], dy2 = xy[b * 2 + 1] - xy[i * 2 + 1];
      if (dx1 * dy2 - dy1 * dx2 !== 0) keep.push(xy[i * 2], xy[i * 2 + 1]);
    }
    xy = keep;
    for (let it = 0; it < smooth; it++) {
      const m = xy.length / 2;
      const nx = new Array(m * 4);
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const x0 = xy[i * 2], y0 = xy[i * 2 + 1], x1 = xy[j * 2], y1 = xy[j * 2 + 1];
        nx[i * 4] = 0.75 * x0 + 0.25 * x1;
        nx[i * 4 + 1] = 0.75 * y0 + 0.25 * y1;
        nx[i * 4 + 2] = 0.25 * x0 + 0.75 * x1;
        nx[i * 4 + 3] = 0.25 * y0 + 0.75 * y1;
      }
      xy = nx;
    }
    return Float32Array.from(xy);
  });
}
