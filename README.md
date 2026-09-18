# SubtitleKit

Free, private, in-browser subtitle toolkit — **https://aiharryone.github.io/subtitle-tools/**

Convert, repair and QC subtitle files without uploading anything. There is no backend: the
page is static HTML/JS, files are read with the browser File API, and all parsing, conversion,
encoding repair and QC runs in the tab.

## What is in the site

- **90 format converters** — SRT, VTT (WebVTT), ASS, SSA, SBV, TTML, DFXP, LRC, CSV/TSV, TXT, in every direction.
- **11 workflow tools**
  - Batch converter (drop a whole season → one ZIP + `qc-report.md`)
  - Subtitle sync shifter (± seconds, presets)
  - Frame-rate converter (23.976 / 24 / 25 / 29.97 presets)
  - Caption compliance checker (CPS, CPL, line count, duration, overlap)
  - Encoding fixer (mojibake: UTF-8-as-Latin-1, GBK, Big5, Shift-JIS, EUC-KR, CP1251/1252)
  - Bilingual subtitle merger (pairs cues by timing, tolerance-based)
  - Subtitle merger (sequential join)
  - SRT/VTT cleaner (tags, hearing-impaired cues, spacing, empties)
  - Line breaker (enforce characters per line)
  - Duration/overlap fixer
  - Privacy FAQ page (how to verify that nothing is uploaded)

## Layout

```
src/subtitle-core.js   pure parsing/conversion/QC core (Node + browser, zero deps)
src/app.js             UI logic (drag & drop, options, batch ZIP, QC report)
src/styles.css         styles
build/gen.js           static-site generator: 102 pages + sitemap/robots/llms.txt/IndexNow key
build/deploy.js        pushes dist + sources to GitHub Pages via the Git Data API
tests/test-core.js     25 unit tests (round-trips, edge cases, encoding, ZIP, 10k-cue perf)
tests/browser_test.py  Chromium E2E: convert, batch ZIP (unzip-validated), QC, encoding, no-backend check, file:// offline
dist/                  the deployed site (repo root serves this)
```

## Build & test

```bash
node build/gen.js --base https://aiharryone.github.io/subtitle-tools --out dist   # build
node tests/test-core.js                                                          # unit tests
py -X utf8 tests/browser_test.py                                                 # E2E (needs python playwright)
node build/deploy.js                                                             # deploy (GH_TOKEN or git credential)
```

## Notes

- QC thresholds follow the common caption rules: CPS ≤ 20, CPL ≤ 42, ≤ 2 lines, duration 0.833–7 s, no overlaps.
- Deliberately out of scope: extracting embedded subtitle tracks from video, OCR of bitmap subtitles (VobSub/PGS), speech recognition — these need server-side compute and would break the "nothing is uploaded" guarantee.
- IndexNow key file (`<key>.txt`) is served at the site root and pinged by `traffic-ops`.
