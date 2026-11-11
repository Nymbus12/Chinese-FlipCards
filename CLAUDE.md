# CLAUDE.md

FlipCards ("FlipCards | Simple Chinese Vocabulary Flashcards") is a dependency-free PWA for
studying Chinese vocabulary, built to be installed on the iPhone home screen. Plain HTML, CSS
and ES modules; no build step, no framework, no package.json.

## Hard rules

- **No emoji** anywhere in UI, code or docs. Icons are Lucide only, inlined as SVG path data in
  `icons.js` (ISC, see `icons.LICENSE`). To add one, copy the path data from lucide.dev into the
  `ICONS` map.
- **Never rename localStorage keys** — users' data lives there:
  `flipcards.v1` (words), `flipcards.voice`, `flipcards.theme`, `flipcards.custom` (custom
  session), `flipcards.mode` (study mode).
- **Bump `VERSION` in `sw.js`** on every user-visible change, or installed apps keep the old files.
- `index.html` has **CRLF line endings** — edit it with the Edit tool, never `sed -i` (that
  rewrites every line ending and makes a 300-line diff).
- Font: Inter (Google Fonts) + system Chinese fonts (`--font-zh`). Minimal colour palette.
- English copy, plain words, no jargon.

## Files

- `app.js` — all app logic: storage, word list, swipe-to-archive, suggestions, sheets, themes,
  guided tour, sessions (flip + handwriting canvas), backup import/export.
- `suggest.js` — HSK dictionary load/lookup (`data/hsk.json`, ~2,600 words, built by
  `tools/build-hsk.mjs`), pinyin segmentation, local + online suggestions.
- `voice.js` — speech: ranks device voices (Premium > Enhanced > Standard, novelty voices
  excluded, Mandarin only, no zh-HK/Cantonese), Google Translate TTS fallback.
- `icons.js` — Lucide SVG map. `styles.css` — all styles. `sw.js` — offline cache.
- `icons/logo.svg` — brand source (cinnabar seal, 卡 drawn as strokes); the PNGs were rendered
  from it (Playwright screenshot at 512/192/180, plus a frameless maskable variant).
- `vendor/pinyin-pro.js` — pinyin fallback; dictionary pinyin wins (correct neutral tones).

## Layout and iOS quirks (do not regress)

- **The page never scrolls.** `html, body { overflow: hidden }`; `#listView` is an app shell
  where only `.list-scroll` scrolls. No `position: fixed` bottom bars — iOS misplaces them after
  the keyboard closes. A `focusout` handler also resets stray page scroll.
- Text selection is disabled app-wide except `input, textarea`.
- Google `translate_tts` returns 404 when a referrer is sent — `<meta name="referrer"
  content="no-referrer">` must stay.
- The service worker never intercepts translation/speech requests, caches only
  `ok && !redirected` (Cloudflare 307s `/index.html` → `/`), navigation fallback is `./`.
- iPhone web apps only get the basic voices (Tingting/Meijia); downloaded Premium voices like
  Lili are not exposed. Don't tell users to download voices.
- Buttons use mousedown `preventDefault` where focus must stay in the add field.

## Theming

Every colour is a token on `:root`; the Sage theme overrides them under
`:root[data-theme="sage"]`. Add new colours as tokens in both themes, never hard-coded.
Canvas (writing pad) colours are read at draw time via `cssVar()`. The theme is applied before
first paint by an inline script in `index.html`; `meta[name=theme-color]` follows `--bg`.

## External services (free, unofficial — may break anytime)

Google Translate `translate_a/single` (zh→en and en→zh suggestions), Google Input Tools
(pinyin → hanzi), Google `translate_tts` (speech), MyMemory (translation fallback).
No API keys. If a key is ever needed (e.g. Azure TTS), it goes in a Cloudflare Worker secret,
never in this public repo.

## Testing

Playwright (iPhone 13 profile) scripts live in the session scratchpad, not the repo: a local
`node:http` static server per test on ports 184xx, external endpoints mocked/aborted, checks
printed as PASS/FAIL lines. Cover: add/suggest flows, readings picker, voice ranking (faked
iOS voice list), layout (start bar stays put), swipe/archive, custom sessions, handwriting
canvas ink, themes, tour, text selection. Rebuild in that style if they are gone.

## Deployment and git

- GitHub `Nymbus12/Chinese-FlipCards` (public, MIT). Cloudflare auto-deploys `main` as a Worker:
  https://chinese-flipcards.scutum12l.workers.dev — no build, output `/`. `_headers` keeps
  `sw.js` at `no-cache`.
- Commits use the **repo-local** git identity (already configured); never change the user's
  global git config.
- `plan.md` and `flipcards.tar.gz` in the parent folder are private — never commit or push them.
- Data is local-only by design: no accounts, no server storage, no analytics. Keep it that way.
