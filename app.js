import { icon } from "./icons.js";
import { speak as speakVoice, stopSpeaking, voiceOptions, onVoicesChanged, getSettings, setSettings, RATES } from "./voice.js";
import { loadDict, lookup, readings, suggest, onlineSuggest } from "./suggest.js";

/* =========================================================
   Storage
   ========================================================= */
const KEY = "flipcards.v1";
const CUSTOM_KEY = "flipcards.custom";
const COUNTS = [10, 20, 30, 50, 0]; // 0 = all

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "{}");
    return Array.isArray(data.words) ? data.words : [];
  } catch {
    return [];
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, words }));
  } catch (e) {
    toast("Could not save. Storage may be full.");
  }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

let words = load();
const byId = (id) => words.find((w) => w.id === id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* =========================================================
   Pinyin, translation, speech
   ========================================================= */
const HAN = /[㐀-鿿豈-﫿]/;

// pinyin-pro on its own (can miss neutral tones)
function guessPinyin(text) {
  try {
    return window.pinyinPro.pinyin(text, { toneType: "symbol", nonZh: "consecutive" }).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}
// HSK dictionary first (correct neutral tones, e.g. 谢谢 xiè xie), pinyin-pro otherwise
const toPinyin = (text) => (lookup(text) || {}).pinyin || guessPinyin(text);

function withTimeout(ms) {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function translateGoogle(text) {
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&dt=bd&q=" +
    encodeURIComponent(text);
  const res = await fetch(url, { signal: withTimeout(8000) });
  if (!res.ok) throw new Error("google " + res.status);
  const data = await res.json();
  const main = (data[0] || []).map((s) => s && s[0]).filter(Boolean).join("").trim();
  const out = [];
  const add = (t) => {
    t = (t || "").trim();
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  add(main);
  // dictionary alternatives: [[partOfSpeech, [terms...]], ...]
  for (const entry of data[1] || []) {
    for (const term of (entry[1] || []).slice(0, 3)) add(term);
  }
  if (!out.length) throw new Error("empty");
  return out.slice(0, 4).join(", ");
}

async function translateMyMemory(text) {
  const url = "https://api.mymemory.translated.net/get?langpair=zh-CN|en&q=" + encodeURIComponent(text);
  const res = await fetch(url, { signal: withTimeout(8000) });
  if (!res.ok) throw new Error("mymemory " + res.status);
  const data = await res.json();
  const t = data && data.responseData && data.responseData.translatedText;
  if (!t || /MYMEMORY WARNING/i.test(t)) throw new Error("empty");
  return t.trim();
}

async function translate(text) {
  try {
    return await translateGoogle(text);
  } catch {
    return await translateMyMemory(text);
  }
}

const inflight = new Set();
async function fillTranslation(w) {
  if (!w || w.english || inflight.has(w.id)) return;
  inflight.add(w.id);
  w.pending = true;
  renderList();
  try {
    const en = await translate(w.hanzi);
    const cur = byId(w.id);
    if (cur && !cur.english) cur.english = en;
  } catch {
    /* offline or blocked: will retry later */
  } finally {
    inflight.delete(w.id);
    const cur = byId(w.id);
    if (cur) delete cur.pending;
    save();
    renderList();
    if (session && currentWord() && currentWord().id === w.id) renderTranslation();
  }
}

const speak = (text) => speakVoice(text, () => toast("Speech is not available"));

/* =========================================================
   Helpers
   ========================================================= */
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let toastTimer;
/** Short message at the top, or with `action` ({ label, run }) a message with a button near the bottom. */
function toast(msg, action) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("bottom", !!action);
  if (action) {
    const b = document.createElement("button");
    b.className = "toast-action";
    b.textContent = action.label;
    b.onclick = () => {
      t.hidden = true;
      action.run();
    };
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? 4000 : 2200);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* =========================================================
   Static icons
   ========================================================= */
$("#menuBtn").innerHTML = icon("ellipsis");
$("#closeSession").innerHTML = icon("x");
$("#missBtn").innerHTML = icon("x", 30, 2.4);
$("#knowBtn").innerHTML = icon("check", 30, 2.4);
$("#speakBtn").innerHTML = icon("volume-2", 24);
$("#doneIcon").innerHTML = icon("check", 34, 2.4);
$("#againBtn").innerHTML = icon("rotate-ccw", 18) + "Study again";
$("#backBtn").innerHTML = icon("arrow-left", 18) + "Word list";
$("#regenBtn").innerHTML = icon("refresh-cw", 18) + "Auto-fill";
$('[data-menu="export"]').innerHTML = icon("download", 20) + "Export backup";
$('[data-menu="import"]').innerHTML = icon("upload", 20) + "Import backup";
$('[data-menu="voice"]').innerHTML = icon("volume-2", 20) + "Voice";
$('[data-menu="theme"]').innerHTML = icon("palette", 20) + "Theme";

/* ---------- theme ---------- */
const THEME_KEY = "flipcards.theme";
const THEMES = [
  { id: "cinnabar", name: "Cinnabar", sub: "Seal red on cool grey", colors: ["#f5f6f8", "#ffffff", "#eceef2", "#d23b2f"] },
  { id: "sage", name: "Sage", sub: "Soft green on warm cream", colors: ["#faf1e6", "#fdfaf6", "#e4efe7", "#99bc85"] },
];
const currentTheme = () => document.documentElement.dataset.theme || "cinnabar";
function applyTheme(id) {
  if (id === "cinnabar") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {}
  // match the iPhone status bar area to the background
  $('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
}
function renderThemes() {
  $("#themeList").innerHTML = THEMES.map((t) => {
    const on = currentTheme() === t.id;
    return `<li><button type="button" class="voice-row ${on ? "on" : ""}" data-theme-id="${t.id}">
      <span class="voice-check">${on ? icon("check", 18, 2.4) : ""}</span>
      <span class="voice-text"><span class="voice-name">${t.name}</span><span class="voice-sub">${t.sub}</span></span>
      <span class="swatches">${t.colors.map((c) => `<i style="background:${c}"></i>`).join("")}</span>
    </button></li>`;
  }).join("");
}
$("#themeSheet").addEventListener("click", (e) => {
  const b = e.target.closest("[data-theme-id]");
  if (!b) return;
  applyTheme(b.dataset.themeId);
  renderThemes();
});
$('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
$("#clearPad").innerHTML = icon("eraser", 18) + "Clear";
$("#showAnswer").innerHTML = icon("eye", 18) + "Show answer";
$('[data-mode="flip"]').innerHTML = icon("book-open", 16) + "Vocabulary";
$('[data-mode="write"]').innerHTML = icon("pencil", 16) + "Handwriting";

/* ---------- study mode: flip cards or handwriting ---------- */
const MODE_KEY = "flipcards.mode";
let studyMode = "flip";
try {
  if (localStorage.getItem(MODE_KEY) === "write") studyMode = "write";
} catch {}
function renderMode() {
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === studyMode));
}
renderMode();
$("#modeSeg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mode]");
  if (!b) return;
  studyMode = b.dataset.mode;
  try {
    localStorage.setItem(MODE_KEY, studyMode);
  } catch {}
  renderMode();
});

/* =========================================================
   List view
   ========================================================= */
let tab = "active";

function activeWords() {
  return words.filter((w) => !w.archived);
}

function renderList() {
  const active = activeWords();
  const archived = words.filter((w) => w.archived);
  $("#countActive").textContent = active.length;
  $("#countArchived").textContent = archived.length;

  const shown = (tab === "active" ? active : archived).slice().sort((a, b) => b.createdAt - a.createdAt);
  const selectedCount = active.filter((w) => w.selected).length;

  // select row
  const allOn = active.length > 0 && selectedCount === active.length;
  $("#selectRow").hidden = tab !== "active" || active.length === 0;
  $("#selectAllBtn").innerHTML = icon(allOn ? "square-check" : "square", 18) + (allOn ? "Clear all" : "Select all");
  $("#selectedInfo").textContent = `${selectedCount} selected`;

  $("#wordList").innerHTML = shown
    .map((w) => {
      const check =
        tab === "active"
          ? `<button class="icon-btn check ${w.selected ? "on" : ""}" data-act="toggle" aria-label="Select">${icon(
              w.selected ? "square-check" : "square"
            )}</button>`
          : `<button class="icon-btn" data-act="restore" aria-label="Restore">${icon("archive-restore", 20)}</button>`;
      const en = w.english
        ? esc(w.english)
        : w.pending
        ? "Translating…"
        : '<span>No translation yet</span>';
      const off = tab === "active" && !w.selected ? "off" : "";
      return `<li class="word ${w.pending ? "pending" : ""} ${tab === "active" ? "" : "restore"} ${off}" data-id="${w.id}">
        <div class="swipe-bg" aria-hidden="true">${
          tab === "active" ? icon("archive", 20) + "Archive" : icon("archive-restore", 20) + "Restore"
        }</div>
        <div class="word-card">
        ${check}
        <div class="word-text" data-act="${tab === "active" ? "toggle" : ""}">
          <div class="word-zh" lang="zh-CN">${esc(w.hanzi)}</div>
          <div class="word-py">${esc(w.pinyin)}</div>
          <div class="word-en">${en}</div>
        </div>
        <button class="icon-btn ghost" data-act="speak" aria-label="Speak">${icon("volume-2", 20)}</button>
        <button class="icon-btn ghost" data-act="more" aria-label="More">${icon("ellipsis", 20)}</button>
        </div>
      </li>`;
    })
    .join("");

  const empty = $("#emptyState");
  empty.hidden = shown.length > 0;
  empty.textContent =
    tab === "active"
      ? words.length
        ? "Every word is archived. You can still study them with Custom."
        : "Add your first Chinese word above. Pinyin and English are filled in for you."
      : "Archived words show here. Archive a word you know well so it stops coming up in your selected sessions.";

  // start buttons
  $("#startSelected").innerHTML = `${icon("list-checks", 19)}Selected <small>${selectedCount}</small>`;
  $("#startSelected").disabled = selectedCount === 0;
  $("#startCustom").innerHTML = `${icon("sliders-horizontal", 19)}Custom`;
  $("#startCustom").disabled = words.length === 0;
}

function makeWord({ hanzi, pinyin, english }, offset = 0) {
  const d = lookup(hanzi);
  const w = {
    id: uid(),
    hanzi,
    pinyin: pinyin || toPinyin(hanzi),
    english: english || (d ? d.english : ""),
    selected: true,
    archived: false,
    createdAt: Date.now() + offset,
    known: 0,
    missed: 0,
  };
  words.push(w);
  if (!w.english) fillTranslation(w);
  return w;
}

const splitWords = (raw) =>
  raw
    .split(/[\s,，、;；\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

// new Chinese words with more than one dictionary reading: the user picks the reading
const ambiguous = (raw) =>
  [...new Set(splitWords(raw))].filter((h) => HAN.test(h) && !words.some((w) => w.hanzi === h) && readings(h).length > 1);

/** Adds the words; returns the ones left for the user to pick a reading for. */
function addWords(raw) {
  const parts = splitWords(raw);
  if (!parts.length) return [];
  const pick = ambiguous(raw);
  let added = 0;
  const skipped = [];
  for (const hanzi of parts) {
    if (pick.includes(hanzi)) continue;
    if (!HAN.test(hanzi)) {
      skipped.push(hanzi);
      continue;
    }
    if (words.some((w) => w.hanzi === hanzi)) {
      skipped.push(hanzi);
      continue;
    }
    makeWord({ hanzi }, added);
    added++;
  }
  save();
  if (tab !== "active") setTab("active");
  renderList();
  if (pick.length) toast(`${added ? `Added ${added}. ` : ""}Pick a reading for ${pick.join(" ")}`);
  else if (skipped.length) toast(added ? `Added ${added}. Skipped ${skipped.join(" ")}` : "Already in your list, or not Chinese");
  return pick;
}

$("#addForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#addInput");
  // pinyin or English typed: words are picked from the suggestion list instead
  if (input.value.trim() && !HAN.test(input.value)) {
    toast(sugItems.length ? "Tap a word in the list to add it" : "No matching Chinese word found");
    return;
  }
  const pick = addWords(input.value);
  input.value = pick.join(" ");
  if (pick.length) {
    input.focus();
    updateSuggest();
  } else hideSuggest();
});
// the button is + while the field is empty (tap = start typing) and x once there is text (tap = clear)
const addBtn = $("#addBtn");
function syncAddBtn() {
  const has = !!$("#addInput").value;
  if (addBtn.dataset.state === (has ? "clear" : "add")) return;
  addBtn.dataset.state = has ? "clear" : "add";
  addBtn.innerHTML = icon(has ? "x" : "plus");
  addBtn.setAttribute("aria-label", has ? "Clear" : "Add word");
}
// tapping the button must not take focus from the field (that would close the list)
addBtn.addEventListener("mousedown", (e) => e.preventDefault());
syncAddBtn();
// iPhone Safari only shows :active (press) styles when the page listens for touches
document.addEventListener("touchstart", () => {}, { passive: true });
addBtn.addEventListener("click", () => {
  const input = $("#addInput");
  if (input.value) {
    input.value = "";
    hideSuggest();
  }
  input.focus();
});

/* ---------- suggestions: type pinyin or English, pick a Chinese word ---------- */
const addInput = $("#addInput");
const sugEl = $("#suggest");
let sugItems = [];
let sugSeq = 0;
let sugTimer;

function hideSuggest() {
  sugSeq++;
  clearTimeout(sugTimer);
  sugItems = [];
  sugEl.hidden = true;
  sugEl.innerHTML = "";
  syncAddBtn();
}

function renderSuggest(items, loading, title = "", addAll = 0) {
  sugItems = items;
  const rows = items.map((it, i) => {
    const have = words.some((w) => w.hanzi === it.hanzi);
    const heading = it.heading ? `<li class="sug-title">${esc(it.heading)}</li>` : "";
    return `${heading}<li><button type="button" class="sug ${have ? "added" : ""}" data-i="${i}" ${have ? 'aria-disabled="true"' : ""}>
      <span class="sug-text">
        <span class="sug-line"><span class="sug-zh" lang="zh-CN">${esc(it.hanzi)}</span><span class="sug-py">${esc(it.pinyin)}</span></span>
        <span class="sug-en">${it.english ? esc(it.english) : "Translation added after you pick it"}</span>
      </span>
      ${it.level ? `<span class="sug-level">HSK ${it.level}</span>` : ""}
      <span class="sug-icon">${icon(have ? "check" : "plus", 20)}</span>
    </button></li>`;
  });
  if (addAll > 1)
    rows.unshift(`<li><button type="button" class="sug sug-all" data-all="1">
      <span class="sug-text"><span class="sug-name">Add all ${addAll} words</span></span>
      <span class="sug-icon">${icon("plus", 20)}</span></button></li>`);
  if (title) rows.unshift(`<li class="sug-title">${esc(title)}</li>`);
  if (loading) rows.push(`<li class="sug-status"><span class="spin">${icon("loader-circle", 16)}</span>Searching online</li>`);
  else if (!items.length) rows.push(`<li class="sug-status">No matching Chinese word</li>`);
  sugEl.innerHTML = rows.join("");
  sugEl.hidden = false;
  fitSuggest();
}

// keep the list above the iPhone keyboard
function fitSuggest() {
  if (sugEl.hidden) return;
  const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const top = sugEl.getBoundingClientRect().top;
  sugEl.style.maxHeight = Math.max(160, vh - top - 12) + "px";
}
window.visualViewport?.addEventListener("resize", fitSuggest);

async function updateSuggest() {
  const q = addInput.value;
  syncAddBtn();
  if (!q.trim()) return hideSuggest();
  const seq = ++sugSeq;
  await loadDict();
  if (seq !== sugSeq) return;
  if (HAN.test(q)) {
    // Chinese typed: list each word to tap; words with several readings list each reading
    const amb = ambiguous(q);
    const plain = [...new Set(splitWords(q))]
      .filter((h) => HAN.test(h) && !amb.includes(h))
      .map((h) => {
        const d = lookup(h);
        return { hanzi: h, pinyin: d ? d.pinyin : toPinyin(h), english: d ? d.english : "", level: d ? d.level : 0 };
      });
    const readingItems = amb.flatMap(readings);
    if (readingItems.length) readingItems[0] = { ...readingItems[0], heading: "More than one reading. Pick one:" };
    const items = [...plain, ...readingItems];
    if (!items.length) return hideSuggest();
    clearTimeout(sugTimer);
    const newPlain = plain.filter((it) => !words.some((w) => w.hanzi === it.hanzi)).length;
    return renderSuggest(items, false, plain.length ? "Tap to add" : "", newPlain);
  }
  const online = navigator.onLine && q.trim().length >= 2;
  renderSuggest(suggest(q), online);
  clearTimeout(sugTimer);
  if (!online) return;
  sugTimer = setTimeout(async () => {
    const extra = await onlineSuggest(q, guessPinyin);
    if (seq === sugSeq) renderSuggest(suggest(q, extra), false);
  }, 250);
}

addInput.addEventListener("input", updateSuggest);
addInput.addEventListener("focus", updateSuggest);
addInput.addEventListener("blur", () => setTimeout(() => document.activeElement !== addInput && hideSuggest(), 150));
addInput.addEventListener("keydown", (e) => e.key === "Escape" && hideSuggest());
// tapping the list must not close the keyboard
sugEl.addEventListener("mousedown", (e) => e.preventDefault());
sugEl.addEventListener("click", (e) => {
  const b = e.target.closest(".sug");
  if (!b) return;
  if (b.dataset.all) {
    // same as pressing Done: add every new word, keep any that still need a reading picked
    const pick = addWords(addInput.value);
    addInput.value = pick.join(" ");
    return pick.length ? updateSuggest() : hideSuggest();
  }
  const it = sugItems[+b.dataset.i];
  if (!it) return;
  if (words.some((w) => w.hanzi === it.hanzi)) return toast(`${it.hanzi} is already in your list`);
  makeWord(it);
  save();
  if (tab !== "active") setTab("active");
  renderList();
  toast(`Added ${it.hanzi} (${it.pinyin})`);
  // after picking a reading, keep any other words still waiting in the field
  if (HAN.test(addInput.value)) {
    addInput.value = splitWords(addInput.value).filter((h) => h !== it.hanzi).join(" ");
    updateSuggest();
  } else {
    addInput.value = "";
    hideSuggest();
  }
});

function setTab(t) {
  tab = t;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  renderList();
}
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

$("#selectAllBtn").addEventListener("click", () => {
  const active = activeWords();
  const allOn = active.every((w) => w.selected);
  active.forEach((w) => (w.selected = !allOn));
  save();
  renderList();
});

$("#wordList").addEventListener("click", (e) => {
  const li = e.target.closest(".word");
  const actEl = e.target.closest("[data-act]");
  if (!li || !actEl) return;
  const w = byId(li.dataset.id);
  if (!w) return;
  const act = actEl.dataset.act;
  if (act === "toggle") {
    w.selected = !w.selected;
    save();
    renderList();
  } else if (act === "speak") {
    speak(w.hanzi);
  } else if (act === "more") {
    openActions(w);
  } else if (act === "restore") {
    w.archived = false;
    save();
    renderList();
    toast("Moved back to Words");
  }
});

/* ---------- swipe right to archive (or restore in the Archived tab) ---------- */
const wordList = $("#wordList");
let swipe = null;
let swipedAt = 0;

wordList.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const li = e.target.closest(".word");
  if (!li || li.classList.contains("leaving")) return;
  swipe = { li, card: li.querySelector(".word-card"), id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, on: false, t: 0, lastX: e.clientX, v: 0 };
});

wordList.addEventListener("pointermove", (e) => {
  const s = swipe;
  if (!s || e.pointerId !== s.id) return;
  const dx = e.clientX - s.x;
  const dy = e.clientY - s.y;
  if (!s.on) {
    // vertical first: it's a scroll, leave it alone
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return (swipe = null);
    if (dx < 12 || dx < Math.abs(dy) * 1.3) return;
    s.on = true;
    s.li.classList.add("swiping");
    document.body.classList.add("no-select");
    window.getSelection()?.removeAllRanges();
    s.card.style.transition = "none";
    try {
      s.li.setPointerCapture(e.pointerId);
    } catch {}
  }
  const now = performance.now();
  if (s.t) s.v = (e.clientX - s.lastX) / Math.max(1, now - s.t); // px per ms
  s.t = now;
  s.lastX = e.clientX;
  s.dx = Math.max(0, dx - 12);
  s.card.style.transform = `translateX(${s.dx}px)`;
  s.li.classList.toggle("armed", s.dx > s.li.offsetWidth * 0.35);
});

function endSwipe(e, cancelled) {
  const s = swipe;
  if (!s || e.pointerId !== s.id) return;
  swipe = null;
  if (!s.on) return;
  swipedAt = Date.now();
  document.body.classList.remove("no-select");
  const width = s.li.offsetWidth;
  const go = !cancelled && (s.dx > width * 0.35 || (s.v > 0.6 && s.dx > 40));
  s.card.style.transition = "transform 0.2s ease";
  if (!go) {
    s.card.style.transform = "";
    setTimeout(() => s.li.classList.remove("swiping", "armed"), 200);
    return;
  }
  s.card.style.transform = `translateX(${width}px)`;
  // then close the gap
  setTimeout(() => {
    s.li.style.height = s.li.offsetHeight + "px";
    s.li.classList.add("leaving");
    void s.li.offsetHeight;
    s.li.style.height = "0px";
    s.li.style.marginBottom = "-8px"; // swallow the list gap too
  }, 180);
  setTimeout(() => toggleArchived(byId(s.li.dataset.id)), 400);
}
wordList.addEventListener("pointerup", (e) => endSwipe(e, false));
wordList.addEventListener("pointercancel", (e) => endSwipe(e, true));
// iPhone: once a drag is clearly sideways, stop Safari from scrolling or rubber-banding the list,
// so only the row moves (pointer events keep coming)
let touch0 = null;
wordList.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  touch0 = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, lock: null } : null;
}, { passive: true });
wordList.addEventListener("touchmove", (e) => {
  if (!touch0) return;
  const t = e.touches[0];
  const dx = t.clientX - touch0.x;
  const dy = t.clientY - touch0.y;
  if (!touch0.lock && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) touch0.lock = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
  if (touch0.lock === "x" && e.cancelable) e.preventDefault();
}, { passive: false });
// a swipe should not also tick the checkbox or press a button
wordList.addEventListener("click", (e) => {
  if (Date.now() - swipedAt < 400) e.stopPropagation();
}, true);

function toggleArchived(w) {
  if (!w) return renderList();
  const was = w.archived;
  w.archived = !was;
  save();
  renderList();
  toast(w.archived ? `${w.hanzi} archived` : `${w.hanzi} moved back to Words`, {
    label: "Undo",
    run: () => {
      const cur = byId(w.id);
      if (!cur) return;
      cur.archived = was;
      save();
      renderList();
    },
  });
}

/* ---------- sheets ---------- */
let sheetWord = null;
function openSheet(id) {
  closeSheets();
  if ($("#toast").classList.contains("bottom")) $("#toast").hidden = true; // Undo toast would cover the sheet
  $("#backdrop").hidden = false;
  $(id).hidden = false;
}
function closeSheets() {
  $("#backdrop").hidden = true;
  document.querySelectorAll(".sheet").forEach((s) => (s.hidden = true));
}
$("#backdrop").addEventListener("click", closeSheets);

function openActions(w) {
  sheetWord = w;
  $("#actionTitle").textContent = w.hanzi;
  $('[data-sheet="edit"]').innerHTML = icon("pencil", 20) + "Edit";
  $('[data-sheet="archive"]').innerHTML = w.archived
    ? icon("archive-restore", 20) + "Restore"
    : icon("archive", 20) + "Archive";
  $('[data-sheet="delete"]').innerHTML = icon("trash-2", 20) + "Delete";
  openSheet("#actionSheet");
}

$("#actionSheet").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sheet]");
  if (!b || !sheetWord) return;
  const w = sheetWord;
  const a = b.dataset.sheet;
  if (a === "edit") return openEdit(w);
  closeSheets();
  if (a === "archive") {
    w.archived = !w.archived;
    toast(w.archived ? "Archived" : "Moved back to Words");
  } else if (a === "delete") {
    if (!confirm(`Delete ${w.hanzi}?`)) return;
    words = words.filter((x) => x.id !== w.id);
  }
  save();
  renderList();
});

function openEdit(w) {
  sheetWord = w;
  $("#editHanzi").value = w.hanzi;
  $("#editPinyin").value = w.pinyin;
  $("#editEnglish").value = w.english;
  openSheet("#editSheet");
}

$("#regenBtn").addEventListener("click", async () => {
  const hz = $("#editHanzi").value.trim();
  if (!hz) return;
  $("#editPinyin").value = toPinyin(hz);
  const d = lookup(hz);
  if (d) {
    $("#editEnglish").value = d.english;
    return;
  }
  const btn = $("#regenBtn");
  btn.innerHTML = `<span class="spin">${icon("loader-circle", 18)}</span>Translating`;
  try {
    $("#editEnglish").value = await translate(hz);
  } catch {
    toast("Translation failed. Check your connection.");
  }
  btn.innerHTML = icon("refresh-cw", 18) + "Auto-fill";
});

$("#editForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const w = sheetWord;
  if (!w) return;
  const hz = $("#editHanzi").value.trim();
  if (!HAN.test(hz)) return toast("Please enter Chinese characters");
  if (words.some((x) => x !== w && x.hanzi === hz)) return toast("That word is already in your list");
  w.hanzi = hz;
  w.pinyin = $("#editPinyin").value.trim() || toPinyin(hz);
  w.english = $("#editEnglish").value.trim();
  save();
  closeSheets();
  renderList();
});

/* ---------- voice picker ---------- */
const SAMPLE = "你好，我们一起学习中文吧。";

function renderVoice() {
  const cur = getSettings();
  $("#rateSeg").innerHTML = RATES.map(
    (r) => `<button type="button" class="seg-btn ${cur.rate === r.id ? "on" : ""}" data-rate="${r.id}">${r.label}</button>`
  ).join("");
  $("#voiceList").innerHTML = voiceOptions()
    .map((o) => {
      const on = (cur.voice || "") === o.id;
      return `<li><button type="button" class="voice-row ${on ? "on" : ""}" data-voice="${esc(o.id)}">
        <span class="voice-check">${on ? icon("check", 18, 2.4) : ""}</span>
        <span class="voice-text"><span class="voice-name">${esc(o.name)}</span><span class="voice-sub">${esc(o.label)}</span></span>
        <span class="voice-play">${icon("volume-2", 18)}</span>
      </button></li>`;
    })
    .join("");
}
function openVoice() {
  renderVoice();
  openSheet("#voiceSheet");
}
onVoicesChanged(() => !$("#voiceSheet").hidden && renderVoice());
$("#voiceSheet").addEventListener("click", (e) => {
  const rate = e.target.closest("[data-rate]");
  const row = e.target.closest("[data-voice]");
  if (rate) setSettings({ rate: rate.dataset.rate });
  else if (row) setSettings({ voice: row.dataset.voice });
  else return;
  renderVoice();
  speak(SAMPLE); // preview with the new choice
});

/* ---------- guided tour (Menu > How to use) ---------- */
$('[data-menu="help"]').innerHTML = icon("circle-help", 20) + "How to use";
$('[data-menu="about"]').innerHTML = icon("info", 20) + "About this app";
$("#tourClose").innerHTML = icon("x", 18);

// each step points at a real element; steps whose element is missing are skipped
const TOUR = [
  { sel: ".add-form", text: "Add words here: type Chinese, pinyin or English, then tap a word in the list." },
  { sel: ".tabs", text: "Your study words on the left, the ones you archived on the right." },
  { sel: ".word", text: "Tick a word to study it. Swipe it right to archive. The speaker reads it aloud." },
  { sel: "#modeSeg", text: "Two ways to study: flip cards, or write the characters by hand." },
  { sel: ".start-row", text: "Selected studies every ticked word. Custom picks random cards for you." },
  { sel: "#menuBtn", text: "The menu customises the sound of the voice and the colour theme." },
  { sel: "#menuBtn", text: "Words are saved only on this device, so they can be lost. Export backup in the menu saves your progress to a file." },
];
let tourSteps = [];
let tourIndex = 0;

function renderTour() {
  const st = tourSteps[tourIndex];
  const el = document.querySelector(st.sel);
  if (!el) return endTour();
  if (st.sel === ".word") $("#listScroll").scrollTop = 0; // the row must be in view
  const pad = 6;
  const r = el.getBoundingClientRect();
  const hole = $("#tourHole");
  hole.style.left = r.left - pad + "px";
  hole.style.top = r.top - pad + "px";
  hole.style.width = r.width + pad * 2 + "px";
  hole.style.height = r.height + pad * 2 + "px";
  $("#tourText").textContent = st.text;
  $("#tourStep").textContent = `${tourIndex + 1} of ${tourSteps.length}`;
  $("#tourBack").hidden = tourIndex === 0;
  $("#tourNext").textContent = tourIndex === tourSteps.length - 1 ? "Done" : "Next";
  // the bubble goes under the element when there is room, above it otherwise
  const tip = $("#tourTip");
  const w = Math.min(320, innerWidth - 24);
  tip.style.width = w + "px";
  const below = r.bottom + pad + 10;
  const top = below + tip.offsetHeight + 12 <= innerHeight ? below : r.top - pad - 10 - tip.offsetHeight;
  tip.style.top = Math.max(12, top) + "px";
  tip.style.left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), innerWidth - 12 - w) + "px";
}
function openTutorial() {
  closeSheets();
  if (tab !== "active") setTab("active");
  tourSteps = TOUR.filter((st) => document.querySelector(st.sel));
  tourIndex = 0;
  $("#tour").hidden = false;
  renderTour();
}
function endTour() {
  $("#tour").hidden = true;
}
function stepTour(dir) {
  tourIndex += dir;
  if (tourIndex < 0) tourIndex = 0;
  if (tourIndex >= tourSteps.length) return endTour();
  renderTour();
}
$("#tourClose").addEventListener("click", endTour);
$("#tourBack").addEventListener("click", () => stepTour(-1));
$("#tourNext").addEventListener("click", () => stepTour(1));
// tapping the dimmed part also moves on
$("#tour").addEventListener("click", (e) => {
  if (!e.target.closest(".tour-tip")) stepTour(1);
});
window.addEventListener("resize", () => !$("#tour").hidden && renderTour());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#tour").hidden) endTour();
});

/* ---------- backup ---------- */
$("#menuBtn").addEventListener("click", () => openSheet("#menuSheet"));
$("#menuSheet").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-menu]");
  if (!b) return;
  if (b.dataset.menu === "import") return $("#importFile").click();
  if (b.dataset.menu === "voice") return openVoice();
  if (b.dataset.menu === "help") return openTutorial();
  if (b.dataset.menu === "about") return openSheet("#aboutSheet");
  if (b.dataset.menu === "theme") {
    renderThemes();
    return openSheet("#themeSheet");
  }
  closeSheets();
  const json = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), words }, null, 2);
  const name = `flipcards-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "FlipCards backup" });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

$("#importFile").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  closeSheets();
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const list = Array.isArray(data) ? data : data.words;
    if (!Array.isArray(list)) throw new Error();
    let n = 0;
    for (const x of list) {
      if (!x || !x.hanzi || words.some((w) => w.hanzi === x.hanzi)) continue;
      words.push({
        id: uid(),
        hanzi: String(x.hanzi),
        pinyin: x.pinyin || toPinyin(x.hanzi),
        english: x.english || "",
        selected: x.selected !== false,
        archived: !!x.archived,
        createdAt: x.createdAt || Date.now(),
        known: x.known || 0,
        missed: x.missed || 0,
      });
      n++;
    }
    save();
    renderList();
    toast(`Imported ${n} word${n === 1 ? "" : "s"}`);
    words.filter((w) => !w.english).forEach(fillTranslation);
  } catch {
    toast("That file is not a valid backup");
  }
});

/* =========================================================
   Session
   ========================================================= */
let session = null;
const card = $("#card");
const wrap = $("#cardWrap");

function currentWord() {
  return session && session.deck.length ? byId(session.deck[0]) : null;
}

/* ---------- custom session ---------- */
let custom = { count: 20, archived: true };
try {
  Object.assign(custom, JSON.parse(localStorage.getItem(CUSTOM_KEY) || "{}"));
} catch {}
const customPool = () => (custom.archived ? words : activeWords());

function renderCustom() {
  const pool = customPool().length;
  $("#countSeg").innerHTML = COUNTS.map(
    (n) =>
      `<button type="button" class="seg-btn ${custom.count === n ? "on" : ""}" data-count="${n}" ${
        n && n > pool ? "disabled" : ""
      }>${n || "All"}</button>`
  ).join("");
  const nArch = words.length - activeWords().length;
  $("#archToggle").setAttribute("aria-checked", String(custom.archived));
  $("#archSub").textContent = `${nArch} archived word${nArch === 1 ? "" : "s"}`;
  const n = custom.count ? Math.min(custom.count, pool) : pool;
  const go = $("#customGo");
  go.disabled = n === 0;
  go.innerHTML = n ? `${icon("shuffle", 19)}Start ${n} card${n === 1 ? "" : "s"}` : "No words to study";
}
function setCustom(patch) {
  Object.assign(custom, patch);
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
  } catch {}
  renderCustom();
}
$("#startCustom").addEventListener("click", () => {
  renderCustom();
  openSheet("#customSheet");
});
$("#customSheet").addEventListener("click", (e) => {
  const c = e.target.closest("[data-count]");
  if (c && !c.disabled) setCustom({ count: Number(c.dataset.count) });
  else if (e.target.closest("#archToggle")) setCustom({ archived: !custom.archived });
  else if (e.target.closest("#customGo")) {
    closeSheets();
    startSession("custom");
  }
});

function startSession(mode) {
  let ids;
  if (mode === "selected") {
    ids = shuffle(activeWords().filter((w) => w.selected).map((w) => w.id));
  } else {
    ids = shuffle(customPool().map((w) => w.id));
    if (custom.count) ids = ids.slice(0, custom.count);
  }
  if (!ids.length) return;
  const write = studyMode === "write";
  session = { mode, write, deck: ids, total: ids.length, known: 0, misses: 0, busy: false };
  card.classList.toggle("write", write);
  $("#frontHanzi").hidden = write;
  $("#writeFront").hidden = !write;
  $("#frontLabel").textContent = write ? "Write" : "Chinese";
  $("#backLabel").textContent = write ? "Answer" : "Pinyin";
  $("#frontHint").textContent = write ? "Write it, then Show answer" : "Tap card to flip";
  $("#backHint").textContent = write ? "Tap card to see your writing" : "Tap card to flip back";
  $("#listView").classList.remove("active");
  $("#sessionView").classList.add("active");
  showCard(false);
}

function endSession() {
  session = null;
  stopSpeaking();
  $("#sessionView").classList.remove("active");
  $("#listView").classList.add("active");
  renderList();
}

function renderProgress() {
  const s = session;
  $("#progressText").textContent = s.deck.length ? `${s.deck.length} left` : "Done";
  $("#progressFill").style.width = `${(s.known / s.total) * 100}%`;
}

function renderTranslation() {
  const w = currentWord();
  if (!w) return;
  const btn = $("#translateBtn");
  const out = $("#translation");
  if (session.write) {
    // the meaning is the prompt, so it is always shown
    const pending = inflight.has(w.id);
    $("#writeEnglish").textContent = w.english || (pending ? "Translating…" : "");
    if (!w.english && !pending) fillTranslation(w);
  }
  if (session.revealed || session.write) {
    if (w.english) {
      out.textContent = w.english;
      btn.hidden = true;
    } else {
      out.textContent = "";
      btn.hidden = false;
      btn.innerHTML = inflight.has(w.id)
        ? `<span class="spin">${icon("loader-circle", 18)}</span>Translating`
        : `${icon("refresh-cw", 18)}Try again`;
    }
  } else {
    out.textContent = "";
    btn.hidden = false;
    btn.innerHTML = `${icon("languages", 18)}Translate`;
  }
}

function showCard(animate = true) {
  const w = currentWord();
  renderProgress();
  const done = !w;
  wrap.hidden = done;
  $("#answerRow").hidden = done;
  $("#doneView").hidden = !done;
  if (done) {
    $("#doneStats").textContent = `You knew ${session.total} word${session.total === 1 ? "" : "s"}${
      session.misses ? ` with ${session.misses} miss${session.misses === 1 ? "" : "es"}` : " with no misses"
    }.`;
    return;
  }

  // reset to front without showing the next card's back
  card.classList.add("no-anim");
  card.classList.remove("flipped");
  session.revealed = false;

  const fh = $("#frontHanzi");
  fh.textContent = w.hanzi;
  fh.classList.toggle("long", w.hanzi.length > 3);
  $("#backHanzi").textContent = w.hanzi;
  $("#backHanzi").classList.toggle("long", w.hanzi.length > 3);
  if (session.write) {
    $("#writePinyin").textContent = w.pinyin;
    requestAnimationFrame(() => sizePad(w.hanzi)); // also wipes the last card's writing
  }
  const py = $("#backPinyin");
  py.textContent = w.pinyin;
  py.classList.toggle("long", w.pinyin.length > 14);
  document.querySelectorAll('[data-act="archive"]').forEach((b) => {
    b.innerHTML = icon("archive", 20);
    b.hidden = !!w.archived;
  });
  renderTranslation();

  wrap.classList.remove("out-know", "out-miss");
  if (animate) {
    wrap.classList.add("in");
    void wrap.offsetWidth;
    wrap.classList.remove("in");
  }
  void card.offsetWidth;
  card.classList.remove("no-anim");
}

function answer(kind) {
  const s = session;
  if (!s || s.busy || !s.deck.length) return;
  const w = currentWord();
  s.busy = true;
  const id = s.deck.shift();
  if (kind === "know") {
    s.known++;
    if (w) w.known = (w.known || 0) + 1;
  } else {
    s.misses++;
    if (w) w.missed = (w.missed || 0) + 1;
    // put it back somewhere later in the deck (not the very next card when others remain)
    const pos = s.deck.length ? 1 + Math.floor(Math.random() * s.deck.length) : 0;
    s.deck.splice(pos, 0, id);
  }
  save();
  renderProgress();
  wrap.classList.add(kind === "know" ? "out-know" : "out-miss");
  setTimeout(() => {
    s.busy = false;
    if (session === s) showCard(true);
  }, 220);
}

/* ---------- writing box ---------- */
const pad = $("#pad");
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const pctx = pad.getContext("2d");
let padChars = 1;
let stroke = null;

function sizePad(hanzi) {
  if (hanzi) padChars = Array.from(hanzi).length;
  const r = pad.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const d = window.devicePixelRatio || 1;
  pad.width = Math.round(r.width * d);
  pad.height = Math.round(r.height * d);
  pctx.setTransform(d, 0, 0, d, 0, 0);
  clearPad();
}

// one guide square per character (up to 4), with dashed centre lines like exercise paper
function padCell() {
  const w = pad.clientWidth;
  const h = pad.clientHeight;
  const n = Math.min(padChars, 4);
  const size = Math.min(h - 16, (w - 16) / n);
  return { n, size, x: (w - size * n) / 2, y: (h - size) / 2 };
}
function clearPad() {
  pctx.clearRect(0, 0, pad.clientWidth, pad.clientHeight);
  if (padChars > 4) return;
  const { n, size, x, y } = padCell();
  pctx.save();
  pctx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const cx = x + i * size;
    pctx.strokeStyle = cssVar("--pad-line");
    pctx.setLineDash([]);
    pctx.strokeRect(cx + 0.5, y + 0.5, size - 1, size - 1);
    pctx.strokeStyle = cssVar("--pad-dash");
    pctx.setLineDash([5, 5]);
    pctx.beginPath();
    pctx.moveTo(cx + size / 2, y);
    pctx.lineTo(cx + size / 2, y + size);
    pctx.moveTo(cx, y + size / 2);
    pctx.lineTo(cx + size, y + size / 2);
    pctx.stroke();
  }
  pctx.restore();
}
const padPoint = (e) => {
  const r = pad.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
pad.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  try {
    pad.setPointerCapture(e.pointerId);
  } catch {}
  const p = padPoint(e);
  const { size } = padCell();
  stroke = { id: e.pointerId, last: p, width: Math.max(4, Math.min(12, (padChars > 4 ? 120 : size) * 0.05)) };
  pctx.fillStyle = cssVar("--text");
  pctx.beginPath();
  pctx.arc(p.x, p.y, stroke.width / 2, 0, Math.PI * 2);
  pctx.fill();
});
pad.addEventListener("pointermove", (e) => {
  if (!stroke || e.pointerId !== stroke.id) return;
  const pts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  pctx.strokeStyle = cssVar("--text");
  pctx.lineWidth = stroke.width;
  pctx.lineCap = "round";
  pctx.lineJoin = "round";
  pctx.beginPath();
  pctx.moveTo(stroke.last.x, stroke.last.y);
  for (const pe of pts.length ? pts : [e]) {
    const p = padPoint(pe);
    pctx.lineTo(p.x, p.y);
    stroke.last = p;
  }
  pctx.stroke();
});
const endStroke = (e) => {
  if (stroke && e.pointerId === stroke.id) stroke = null;
};
pad.addEventListener("pointerup", endStroke);
pad.addEventListener("pointercancel", endStroke);
window.addEventListener("resize", () => session && session.write && sizePad());

card.addEventListener("click", (e) => {
  if (e.target.closest(".pad-wrap")) return; // writing never flips the card
  const b = e.target.closest("button");
  if (b) {
    const w = currentWord();
    if (!w) return;
    const act = b.dataset.act;
    if (act === "clear") clearPad();
    else if (act === "flip") card.classList.add("flipped");
    else if (act === "translate") {
      session.revealed = true;
      if (!w.english) fillTranslation(w);
      renderTranslation();
    } else if (act === "archive") {
      w.archived = true;
      save();
      toast(`${w.hanzi} archived`);
      answer("know");
    }
    return;
  }
  if (session && !session.busy) card.classList.toggle("flipped");
});

$("#knowBtn").addEventListener("click", () => answer("know"));
$("#missBtn").addEventListener("click", () => answer("miss"));
$("#speakBtn").addEventListener("click", () => {
  const w = currentWord();
  if (w) speak(w.hanzi);
});
$("#closeSession").addEventListener("click", endSession);
$("#backBtn").addEventListener("click", endSession);
$("#againBtn").addEventListener("click", () => {
  const mode = session.mode;
  const hasWords = mode === "selected" ? activeWords().some((w) => w.selected) : customPool().length > 0;
  if (hasWords) startSession(mode);
  else endSession();
});
$("#startSelected").addEventListener("click", () => startSession("selected"));

// keyboard (handy on a computer)
document.addEventListener("keydown", (e) => {
  if (!session || e.target.matches("input, textarea")) return;
  if (e.key === " ") {
    e.preventDefault();
    if (currentWord()) card.classList.toggle("flipped");
  } else if (e.key === "ArrowRight") answer("know");
  else if (e.key === "ArrowLeft") answer("miss");
  else if (e.key === "Escape") endSession();
});

/* =========================================================
   Boot
   ========================================================= */
renderList();
loadDict();

// splash: a short welcome while the app starts, then fade out
setTimeout(() => {
  const sp = $("#splash");
  sp.classList.add("done");
  setTimeout(() => (sp.hidden = true), 400);
}, 1000);

// retry any translations that failed while offline
words.filter((w) => !w.english).forEach(fillTranslation);
window.addEventListener("online", () => words.filter((w) => !w.english).forEach(fillTranslation));

// iOS can leave the page scrolled after the keyboard closes, which shifts the layout
document.addEventListener("focusout", () =>
  setTimeout(() => {
    if (!document.activeElement || !document.activeElement.matches("input, textarea")) window.scrollTo(0, 0);
  }, 50)
);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
