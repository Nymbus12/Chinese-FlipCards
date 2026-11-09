// Word suggestions for the add field: type pinyin (nihao, nǐhǎo, ni3hao3) or English,
// get Chinese words to pick from. Local HSK 1-5 list first (offline), online candidates on top.

const HAN = /[㐀-鿿豈-﫿]/;
let dict = []; // { hanzi, pinyin, english, level, key, numeric, marked }
const byHanzi = new Map(); // hanzi -> all readings
const syllables = new Set();
const syllablePrefixes = new Set();
let ready = null;

/** toneless, lowercase, letters only: "Nǚ ér" -> "nuer" */
export const plainKey = (s) =>
  String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/v/g, "u").replace(/[^a-z]/g, "");
const numericKey = (s) => String(s).toLowerCase().replace(/[üv]/g, "u").replace(/[^a-z0-9]/g, "");
const markedKey = (s) => String(s).toLowerCase().normalize("NFC").replace(/[\s'’-]/g, "");
const hasToneMarks = (s) => /[̀-ͯ]/.test(String(s).normalize("NFD"));

export function loadDict() {
  if (!ready) {
    ready = fetch("data/hsk.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        for (const [hanzi, pinyin, english, level, numeric] of rows) {
          const e = { hanzi, pinyin, english, level, key: plainKey(pinyin), numeric: numericKey(numeric), marked: markedKey(pinyin) };
          dict.push(e);
          if (!byHanzi.has(hanzi)) byHanzi.set(hanzi, []);
          byHanzi.get(hanzi).push(e);
          for (const syl of numericKey(numeric).split(/\d+/)) {
            if (!syl) continue;
            syllables.add(syl);
            for (let i = 1; i <= syl.length; i++) syllablePrefixes.add(syl.slice(0, i));
          }
        }
      })
      .catch(() => {});
  }
  return ready;
}

/** Dictionary entry for a Chinese word (first/main reading), or null. */
export const lookup = (hanzi) => (byHanzi.get(hanzi) || [])[0] || null;

/** Every dictionary reading of a Chinese word, e.g. 东西: dōng xī (east and west), dōng xi (thing). */
export const readings = (hanzi) => (byHanzi.get(hanzi) || []).map(toItem);

/** Can the text be read as pinyin syllables (the last one may be half typed)? */
export function looksLikePinyin(q) {
  const s = plainKey(q);
  if (!s || /[^a-zA-Z0-9\s'’ǖǘǚǜüāáǎàēéěèīíǐìōóǒòūúǔù-]/i.test(q)) return false;
  if (!syllables.size) return /^[a-z]+$/.test(s);
  const ok = new Array(s.length + 1).fill(false);
  ok[0] = true;
  for (let i = 0; i < s.length; i++) {
    if (!ok[i]) continue;
    for (let j = i + 1; j <= Math.min(s.length, i + 6); j++) {
      if (syllables.has(s.slice(i, j))) ok[j] = true;
      if (j === s.length && syllablePrefixes.has(s.slice(i, j))) return true;
    }
  }
  return ok[s.length];
}

function localPinyin(q) {
  const key = plainKey(q);
  if (!key) return { exact: [], prefix: [] };
  const numQ = /\d/.test(q) ? numericKey(q) : "";
  const markQ = hasToneMarks(q) ? markedKey(q) : "";
  const exact = [];
  const prefix = [];
  for (const e of dict) {
    if (!e.key.startsWith(key)) continue;
    // with tones typed, the tones must match too
    if (numQ && !e.numeric.startsWith(numQ)) continue;
    if (markQ && !e.marked.startsWith(markQ)) continue;
    (e.key === key ? exact : prefix).push(e);
  }
  const order = (a, b) => a.level - b.level || a.hanzi.length - b.hanzi.length;
  return { exact: exact.sort(order), prefix: prefix.sort(order) };
}

function localEnglish(q) {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  const re = new RegExp("(^|[^a-z])" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const scored = [];
  for (const e of dict) {
    const en = e.english.toLowerCase();
    if (!re.test(en)) continue;
    const parts = en.split(/,\s*/);
    const exact = parts.some((p) => p === t || p === "to " + t || p === "a " + t || p === "the " + t);
    scored.push([exact ? 0 : 1, e]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].level - b[1].level || a[1].english.length - b[1].english.length)
    .map(([score, e]) => Object.assign(Object.create(e), { exactMeaning: score === 0 }));
}

const toItem = (e) => ({ hanzi: e.hanzi, pinyin: e.pinyin, english: e.english, level: e.level });

/** Build the suggestion list. `online` is the list from onlineSuggest() or null while it loads. */
export function suggest(q, online = null) {
  const out = [];
  const seen = new Set();
  const push = (it, max = Infinity) => {
    const k = it.hanzi + "|" + it.pinyin;
    if (seen.has(k) || out.length >= max) return;
    // an online item that is in the HSK list gets the dictionary data
    if (seen.has(it.hanzi + "|*")) return;
    seen.add(k);
    seen.add(it.hanzi + "|*");
    out.push(it);
  };
  if (looksLikePinyin(q)) {
    // some English words also read as pinyin ("tea" = te + a): show real meanings before guesses
    const { exact, prefix } = localPinyin(q);
    const english = plainKey(q).length >= 3 ? localEnglish(q) : [];
    exact.slice(0, 8).forEach((e) => push(toItem(e)));
    english.filter((e) => e.exactMeaning).forEach((e) => push(toItem(e), out.length + 4));
    (online || []).forEach((it) => push(it, out.length + 6));
    prefix.forEach((e) => push(toItem(e), 14));
    english.forEach((e) => push(toItem(e), 18));
  } else {
    localEnglish(q).forEach((e) => push(toItem(e), 10));
    (online || []).forEach((it) => push(it, 16));
  }
  return out;
}

function withTimeout(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

const fromOnline = (hanzi, english, toPinyin) => {
  const e = lookup(hanzi);
  return e ? toItem(e) : { hanzi, pinyin: toPinyin(hanzi), english: english || "", level: 0 };
};

/** Online candidates: Google pinyin input for pinyin, Google dictionary (en -> zh) for English. */
export async function onlineSuggest(q, toPinyin) {
  const text = q.trim();
  if (!navigator.onLine || text.length < 2) return [];
  try {
    if (looksLikePinyin(text)) {
      const key = plainKey(text);
      const url =
        "https://inputtools.google.com/request?itc=zh-t-i0-pinyin&num=10&cp=0&cs=1&ie=utf-8&oe=utf-8&text=" +
        encodeURIComponent(key);
      const data = await (await fetch(url, { signal: withTimeout(5000) })).json();
      const [, [[, cands = [], , meta = {}] = []] = []] = data;
      const lens = meta.matched_length || [];
      return cands
        .filter((c, i) => HAN.test(c) && (lens[i] == null || lens[i] === key.length))
        .slice(0, 6)
        .map((c) => fromOnline(c, "", toPinyin));
    }
    const url =
      "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&dt=bd&q=" + encodeURIComponent(text);
    const data = await (await fetch(url, { signal: withTimeout(6000) })).json();
    const clean = (s) => String(s || "").replace(/[!！。.?？,，]+$/g, "").trim();
    const items = [];
    const main = clean((data[0] || []).map((s) => s && s[0]).join(""));
    if (HAN.test(main)) items.push(fromOnline(main, text, toPinyin));
    for (const pos of data[1] || []) {
      for (const entry of pos[2] || []) {
        const hz = clean(entry[0]);
        if (!HAN.test(hz) || items.some((x) => x.hanzi === hz)) continue;
        items.push(fromOnline(hz, (entry[1] || []).slice(0, 3).join(", "), toPinyin));
      }
    }
    return items.slice(0, 6);
  } catch {
    return [];
  }
}
