# FlipCards

**Simple Chinese Vocabulary Flashcards**

A small, dependency-free flashcard web app for Chinese (Mandarin) vocabulary, made to be added to the iPhone home screen. Add a word in Chinese, pinyin or English, and FlipCards fills in the pinyin, meaning and audio. HSK 1-5 is built in and it works offline.

- Add a Chinese word (or several, separated by spaces or commas). Pinyin is generated on the device with pinyin-pro; English is fetched automatically (Google Translate free endpoint, MyMemory as fallback) and can be edited.
- Card front shows the characters, tap the empty card area to flip to pinyin. The Translate button on the pinyin side reveals the English. Speaker on both sides (Web Speech API, zh-CN).
- Know removes the card for the rest of the session (works before flipping too). Miss shuffles it back into the remaining deck.
- Two session types: **Selected** (every selected, non-archived word) and **Mix 20** (20 random words from everything, archived included).
- Archive known words from the list or straight from a card.
- Data lives in the browser's local storage. Use the menu for export/import backups.

## Run locally

    python3 -m http.server 8000

## Deploy

Static site, no build step.

- **Cloudflare Pages**: connect the repo, framework preset "None", build command empty, output directory `/`.
- **Vercel**: import the repo, framework "Other", no build command, output directory `.`.

Then on iPhone open the URL in Safari, tap Share, then Add to Home Screen.

## Adding words by pinyin or English

Type pinyin (`nihao`, `nǐhǎo`, `ni3hao3`, `nver` for nǚ ér) or English (`umbrella`) in the add field and pick a Chinese word from the list.

- Offline: searches the HSK 1-5 word list in `data/hsk.json` (about 2,600 entries with dictionary pinyin and English). Words typed in Chinese that are in this list also get its pinyin, which has the right neutral tones (谢谢 = xiè xie).
- Online: adds Google suggestions on top (pinyin input tools for pinyin, Google Translate's dictionary for English), so words outside HSK such as 你好 show up too.

`data/hsk.json` is built from the HSK 2.0 lists in [drkameleon/complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary) (MIT, see `data/hsk.LICENSE`). To rebuild it, download `wordlists/exclusive/old/1.json` to `5.json` into a folder and run `node tools/build-hsk.mjs <folder>`.

## Voice

Speech uses the voices installed on the device (Web Speech API). By default FlipCards picks the most natural Mandarin voice it finds (Premium, then Enhanced, then Standard) and skips novelty voices. Menu > Voice lets you preview and choose a voice and set the speed (Slow, Normal, Fast); the choice is saved on the device.

On iPhone, Safari and home-screen web apps only get the basic voices (Tingting, Meijia); Enhanced and Premium voices downloaded in Settings are not available to web apps. For a more natural voice there, choose Google Translate voice (online only). It is also used automatically if no Chinese voice is available.

## Third-party services

Translation, pinyin suggestions and the speech fallback use free, unofficial endpoints (Google Translate, Google Input Tools, Google Translate TTS, MyMemory). They need no API key, but they are not official APIs and can stop working or be rate limited at any time. If that happens, put a small proxy in front of them (for example a Cloudflare Pages Function) or switch to an offline dictionary such as CC-CEDICT. The HSK word list in `data/` keeps working offline either way.

## Licenses

- App code: MIT, see `LICENSE`.
- [pinyin-pro](https://github.com/zh-lx/pinyin-pro): MIT, see `vendor/pinyin-pro.LICENSE`.
- HSK word list from [complete-hsk-vocabulary](https://github.com/drkameleon/complete-hsk-vocabulary): MIT, see `data/hsk.LICENSE`.
- [Lucide](https://lucide.dev) icons: ISC, see `icons.LICENSE`.
