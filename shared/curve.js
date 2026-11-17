// Smooth curves through control points [[x, y], …] — used for the XP needed per level.
// Monotone cubic interpolation (Fritsch–Carlson) on log(y) over log(x): the curve passes through every point,
// rises wherever the points rise (no dips or overshoots between them) and bends smoothly. Two points alone give
// an exact power curve (y = a·x^b) — the classic XP formula — so few points are enough for a natural curve.
// Beyond the first/last point it continues with the end slope.
export function makeCurve(points) {
  const pts = [];
  const lx = x => Math.log(Math.max(1e-9, x));
  for (const [x0, y] of [...(points || [])].filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0])) {
    const ly = Math.log(Math.max(1, y)), x = lx(x0);
    if (pts.length && pts[pts.length - 1][0] === x) pts[pts.length - 1][1] = ly; else pts.push([x, ly]);
  }
  const n = pts.length;
  if (!n) return () => 1;
  if (n === 1) return () => Math.exp(pts[0][1]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return x0 => {
    const x = lx(x0);
    if (x <= xs[0]) return Math.exp(ys[0] + m[0] * (x - xs[0]));
    if (x >= xs[n - 1]) return Math.exp(ys[n - 1] + m[n - 1] * (x - xs[n - 1]));
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    return Math.exp(y);
  };
}
