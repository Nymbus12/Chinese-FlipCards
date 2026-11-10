import { icon } from "./icons.js";
import { speak as speakVoice, stopSpeaking, voiceOptions, onVoicesChanged, getSettings, setSettings, RATES } from "./voice.js";
import { loadDict, lookup, readings, suggest, onlineSuggest } from "./suggest.js";

/* =========================================================
   Storage
   ========================================================= */
const KEY = "flipcards.v1";
const MIX_SIZE = 20;

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
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
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
$("#addBtn").innerHTML = icon("plus");
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
      return `<li class="word ${w.pending ? "pending" : ""}" data-id="${w.id}">
        ${check}
        <div class="word-text" data-act="${tab === "active" ? "toggle" : ""}">
          <div class="word-zh" lang="zh-CN">${esc(w.hanzi)}</div>
          <div class="word-py">${esc(w.pinyin)}</div>
          <div class="word-en">${en}</div>
        </div>
        <button class="icon-btn ghost" data-act="speak" aria-label="Speak">${icon("volume-2", 20)}</button>
        <button class="icon-btn ghost" data-act="more" aria-label="More">${icon("ellipsis", 20)}</button>
      </li>`;
    })
    .join("");

  const empty = $("#emptyState");
  empty.hidden = shown.length > 0;
  empty.textContent =
    tab === "active"
      ? words.length
        ? "Every word is archived. You can still study them with Mix 20."
        : "Add your first Chinese word above. Pinyin and English are filled in for you."
      : "Archived words show here. Archive a word you know well so it stops coming up in your selected sessions.";

  // start buttons
  $("#startSelected").innerHTML = `${icon("layers", 19)}Selected <small>${selectedCount}</small>`;
  $("#startSelected").disabled = selectedCount === 0;
  $("#startMix").innerHTML = `${icon("shuffle", 19)}Mix ${Math.min(MIX_SIZE, words.length) || MIX_SIZE}`;
  $("#startMix").disabled = words.length === 0;
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
// tapping + must not take focus from the field (that would close the reading list)
$("#addBtn").addEventListener("mousedown", (e) => e.preventDefault());

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
}

function renderSuggest(items, loading, title = "") {
  sugItems = items;
  const rows = items.map((it, i) => {
    const have = words.some((w) => w.hanzi === it.hanzi);
    return `<li><button type="button" class="sug ${have ? "added" : ""}" data-i="${i}" ${have ? 'aria-disabled="true"' : ""}>
      <span class="sug-text">
        <span class="sug-line"><span class="sug-zh" lang="zh-CN">${esc(it.hanzi)}</span><span class="sug-py">${esc(it.pinyin)}</span></span>
        <span class="sug-en">${it.english ? esc(it.english) : "Translation added after you pick it"}</span>
      </span>
      ${it.level ? `<span class="sug-level">HSK ${it.level}</span>` : ""}
      <span class="sug-icon">${icon(have ? "check" : "plus", 20)}</span>
    </button></li>`;
  });
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
  if (!q.trim()) return hideSuggest();
  const seq = ++sugSeq;
  await loadDict();
  if (seq !== sugSeq) return;
  if (HAN.test(q)) {
    // Chinese typed: only show a list when a word has several readings to choose from
    const items = ambiguous(q).flatMap(readings);
    if (!items.length) return hideSuggest();
    clearTimeout(sugTimer);
    return renderSuggest(items, false, "More than one reading. Pick one:");
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

/* ---------- sheets ---------- */
let sheetWord = null;
function openSheet(id) {
  closeSheets();
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

/* ---------- backup ---------- */
$("#menuBtn").addEventListener("click", () => openSheet("#menuSheet"));
$("#menuSheet").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-menu]");
  if (!b) return;
  if (b.dataset.menu === "import") return $("#importFile").click();
  if (b.dataset.menu === "voice") return openVoice();
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

function startSession(mode) {
  let ids;
  if (mode === "selected") {
    ids = shuffle(activeWords().filter((w) => w.selected).map((w) => w.id));
  } else {
    ids = shuffle(words.map((w) => w.id)).slice(0, MIX_SIZE);
  }
  if (!ids.length) return;
  session = { mode, deck: ids, total: ids.length, known: 0, misses: 0, busy: false };
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
  $("#knownCount").innerHTML = `${icon("check", 16, 2.6)}${s.known}`;
  $("#progressFill").style.width = `${(s.known / s.total) * 100}%`;
}

function renderTranslation() {
  const w = currentWord();
  if (!w) return;
  const btn = $("#translateBtn");
  const out = $("#translation");
  if (session.revealed) {
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

card.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) {
    const w = currentWord();
    if (!w) return;
    const act = b.dataset.act;
    if (act === "translate") {
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
  const hasWords = mode === "selected" ? activeWords().some((w) => w.selected) : words.length > 0;
  if (hasWords) startSession(mode);
  else endSession();
});
$("#startSelected").addEventListener("click", () => startSession("selected"));
$("#startMix").addEventListener("click", () => startSession("mix"));

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
