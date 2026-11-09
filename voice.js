// Speech: picks the most natural Chinese voice on the device, or the one the user chose.
// iPhone: better voices are downloaded in Settings > Accessibility > Spoken Content > Voices > Chinese.

const KEY = "flipcards.voice";
const GOOGLE = "google"; // Google Translate voice (online), used as fallback too
export const RATES = [
  { id: "slow", label: "Slow", rate: 0.7 },
  { id: "normal", label: "Normal", rate: 0.9 },
  { id: "fast", label: "Fast", rate: 1.0 },
];

const hasTTS = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
let settings = { voice: "", rate: "normal" }; // voice "" = automatic
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || "{}"));
} catch {}

let voices = [];
const listeners = new Set();

// Novelty voices that ship with iOS/macOS for every language; they sound robotic.
const NOVELTY = /eloquence|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox/i;

function quality(v) {
  const id = `${v.voiceURI} ${v.name}`;
  if (/premium/i.test(id)) return { rank: 4, label: "Premium" };
  if (/enhanced|neural|natural|online/i.test(id)) return { rank: 3, label: "Enhanced" };
  if (/^Google/i.test(v.name)) return { rank: 3, label: "Google" };
  if (NOVELTY.test(id)) return { rank: 0, label: "Novelty" };
  return { rank: 1, label: "Standard" };
}

const region = (lang) =>
  /CN|Hans/i.test(lang) ? "Mainland" : /TW|Hant/i.test(lang) ? "Taiwan accent" : "Mandarin";

function loadVoices() {
  if (!hasTTS) return;
  voices = speechSynthesis
    .getVoices()
    // Mandarin only: zh-CN first, zh-TW allowed; Cantonese (zh-HK, yue) left out
    .filter((v) => /^(zh|cmn)/i.test(v.lang) && !/HK|yue/i.test(v.lang))
    .map((v) => ({ v, id: v.voiceURI || v.name, name: v.name.replace(/\s*\((Enhanced|Premium)\)/i, ""), ...quality(v), region: region(v.lang), mainland: /CN|Hans/i.test(v.lang) }))
    .sort((a, b) => b.mainland - a.mainland || b.rank - a.rank || /tingting|lili/i.test(b.name) - /tingting|lili/i.test(a.name) || a.name.localeCompare(b.name));
  listeners.forEach((fn) => fn());
}
if (hasTTS) {
  loadVoices();
  speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
  // some browsers fill the list late without firing the event
  setTimeout(loadVoices, 1000);
}

/** Voices for the picker: [{ id, name, label, region, auto }] with the automatic choice first. */
export function voiceOptions() {
  const best = bestVoice();
  return [
    { id: "", name: "Automatic", label: best ? `Best available: ${best.name}` : "Google voice (online)" },
    ...voices.map(({ id, name, label, region }) => ({ id, name, label: `${label} · ${region}` })),
    { id: GOOGLE, name: "Google Translate voice", label: "Online only" },
  ];
}
export const onVoicesChanged = (fn) => listeners.add(fn);
export const getSettings = () => ({ ...settings });
export function setSettings(patch) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}

function bestVoice() {
  const usable = voices.filter((x) => x.rank > 0);
  return usable[0] || null;
}

let audioEl = null;
function speakGoogle(text, onFail) {
  if (!audioEl) audioEl = new Audio();
  audioEl.src = "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=zh-CN&q=" + encodeURIComponent(text);
  audioEl.playbackRate = Math.max(0.5, (RATES.find((r) => r.id === settings.rate) || RATES[1]).rate);
  audioEl.play().catch(() => onFail && onFail());
}

/** Speak Chinese text. Must be called from a tap (iOS blocks speech otherwise). */
export function speak(text, onFail) {
  if (!text) return;
  if (audioEl) audioEl.pause();
  const chosen = settings.voice && settings.voice !== GOOGLE ? voices.find((x) => x.id === settings.voice) : null;
  const pick = chosen || bestVoice();
  if (settings.voice === GOOGLE || !hasTTS || !pick) {
    if (hasTTS) speechSynthesis.cancel();
    return speakGoogle(text, onFail);
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = pick.v.lang || "zh-CN";
  u.voice = pick.v;
  u.rate = (RATES.find((r) => r.id === settings.rate) || RATES[1]).rate;
  u.onerror = (e) => {
    if (e.error !== "interrupted" && e.error !== "canceled") speakGoogle(text, onFail);
  };
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (hasTTS) speechSynthesis.cancel();
  if (audioEl) audioEl.pause();
}
