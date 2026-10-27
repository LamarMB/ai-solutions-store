/**
 * График «задержка от нагрузки» по результатам run-http.mjs (summary.json):
 * медиана повторов p50/p95/p99 по числу одновременных пациентов; оси —
 * логарифмические, линия — порог p95 = 2 с.
 *
 *   node scripts/load/chart.mjs --in=dir/summary.json --out=docs/load-test-latency.svg
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=")];
  }),
);
const runs = JSON.parse(readFileSync(args.in, "utf8"));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};
const levels = [...new Set(runs.map((r) => r.vus))].sort((a, b) => a - b);
const series = ["p50", "p95", "p99"].map((key) => ({
  key,
  points: levels.map((v) => [
    v,
    median(runs.filter((r) => r.vus === v).map((r) => r[key])),
  ]),
}));

const W = 720;
const H = 420;
const M = { l: 70, r: 110, t: 40, b: 56 };
const xMin = Math.log10(levels[0]);
const xMax = Math.log10(levels.at(-1));
const yMin = 0; // 1 мс
const yMax = Math.ceil(
  Math.log10(
    Math.max(2000, ...series.flatMap((s) => s.points.map((p) => p[1]))),
  ),
);
const x = (v) =>
  M.l + ((Math.log10(v) - xMin) / (xMax - xMin)) * (W - M.l - M.r);
const y = (ms) =>
  H -
  M.b -
  ((Math.log10(Math.max(ms, 1)) - yMin) / (yMax - yMin)) * (H - M.t - M.b);
const colors = { p50: "#2f7d5b", p95: "#c47a12", p99: "#b23b3b" };

const parts = [];
parts.push(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" font-size="12">`,
  `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
  `<text x="${M.l}" y="22" font-size="14" font-weight="600" fill="#1d2b25">Задержка HTTP API (Mini App + панель) от числа одновременных пациентов</text>`,
);
for (let p = yMin; p <= yMax; p++) {
  const v = 10 ** p;
  parts.push(
    `<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e3e8e5"/>`,
    `<text x="${M.l - 8}" y="${y(v) + 4}" text-anchor="end" fill="#5b6b63">${v >= 1000 ? `${v / 1000} с` : `${v} мс`}</text>`,
  );
}
let lastLabel = -Infinity;
for (const v of levels) {
  parts.push(
    `<line x1="${x(v)}" x2="${x(v)}" y1="${M.t}" y2="${H - M.b}" stroke="#eef2ef"/>`,
  );
  // Подписи близких уровней не накладываются: пропускаем слишком близкие.
  if (x(v) - lastLabel >= 34 || v === levels.at(-1)) {
    parts.push(
      `<text x="${x(v)}" y="${H - M.b + 18}" text-anchor="middle" fill="#5b6b63">${v}</text>`,
    );
    lastLabel = x(v);
  }
}
parts.push(
  `<text x="${(M.l + W - M.r) / 2}" y="${H - 14}" text-anchor="middle" fill="#1d2b25">одновременных пациентов (лог. шкала)</text>`,
  `<line x1="${M.l}" x2="${W - M.r}" y1="${y(2000)}" y2="${y(2000)}" stroke="#b23b3b" stroke-dasharray="6 4"/>`,
  `<text x="${W - M.r + 6}" y="${y(2000) + 4}" fill="#b23b3b">порог 2 с</text>`,
);
for (const s of series) {
  const d = s.points
    .map(
      ([v, ms], i) => `${i ? "L" : "M"}${x(v).toFixed(1)},${y(ms).toFixed(1)}`,
    )
    .join(" ");
  parts.push(
    `<path d="${d}" fill="none" stroke="${colors[s.key]}" stroke-width="2.5"/>`,
  );
  for (const [v, ms] of s.points)
    parts.push(
      `<circle cx="${x(v)}" cy="${y(ms)}" r="3.5" fill="${colors[s.key]}"><title>${s.key} при ${v}: ${ms.toFixed(0)} мс</title></circle>`,
    );
  const [lv, lms] = s.points.at(-1);
  parts.push(
    `<text x="${x(lv) + 8}" y="${y(lms) + 4}" fill="${colors[s.key]}" font-weight="600">${s.key}</text>`,
  );
}
parts.push("</svg>");
writeFileSync(args.out, parts.join("\n") + "\n");
console.log(`график: ${args.out}`);
