// Builds data/hsk.json from the HSK 2.0 lists in drkameleon/complete-hsk-vocabulary (MIT).
// Usage: node tools/build-hsk.mjs <folder with 1.json … 5.json>
// Output rows: [hanzi, pinyin, english, level, numeric]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = process.argv[2];
const SKIP = /^(surname|variant of|old variant|unofficial variant|erroneous variant|archaic|abbr\. for|see |also written|used in|\(old\)|CL:)/i;
const rows = [];
const seen = new Set();

for (let level = 1; level <= 5; level++) {
  const list = JSON.parse(fs.readFileSync(path.join(src, `${level}.json`), "utf8"));
  for (const w of list) {
    // one row per distinct reading (e.g. 了 le / liǎo), merging meanings of forms with the same reading
    const byReading = new Map();
    for (const f of w.forms || []) {
      const py = f.transcriptions.pinyin.trim();
      if (!byReading.has(py)) byReading.set(py, { numeric: f.transcriptions.numeric.replace(/\s+/g, ""), meanings: [] });
      byReading.get(py).meanings.push(...f.meanings);
    }
    for (const [py, r] of byReading) {
      const key = w.simplified + "|" + py;
      if (seen.has(key)) continue;
      seen.add(key);
      const out = [];
      for (const m of r.meanings) {
        const t = m.replace(/\s*\bCL:.*$/, "").trim();
        if (!t || SKIP.test(t) || out.some((o) => o.toLowerCase() === t.toLowerCase())) continue;
        out.push(t);
        if (out.length === 3) break;
      }
      if (!out.length) continue;
      rows.push([w.simplified, py, out.join(", "), level, r.numeric.toLowerCase()]);
    }
  }
}

const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "hsk.json");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(rows));
console.log(`${rows.length} rows -> ${dest} (${fs.statSync(dest).size} bytes)`);
