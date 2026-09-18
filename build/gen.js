/**
 * gen.js — 生成静态站（pSEO 矩阵）
 *
 *   node build/gen.js --base https://example.github.io/subtitle-tools --out dist
 *
 * 产出：
 *   dist/index.html                 主页（全功能工具台）
 *   dist/<from>-to-<to>.html        格式互转矩阵页（10×9 = 90）
 *   dist/<specialty>.html           专项工具页（批量/对齐/质检/编码/双语…）
 *   dist/sitemap.xml robots.txt llms.txt 404.html
 *   dist/assets/{subtitle-core.js,app.js,styles.css}
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/* ------------------------------------------------------------------ 参数 */

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const BASE = arg('base', 'https://aiharryone.github.io/subtitle-tools').replace(/\/$/, '');
const OUT = path.resolve(arg('out', path.join(ROOT, 'dist')));
const SITE = 'SubtitleKit';
const TAGLINE = 'Convert, fix and QC subtitle files in your browser — nothing is uploaded';
// IndexNow key（与 pixelfix / trendsnap / kdp-launch-kit 共用）；构建时写入 <key>.txt 供 Bing 校验
const INDEXNOW_KEY = '84138bba0f7d318e72dde6260fe3a762f45a337400b4709a';

/* ------------------------------------------------------------------ 格式知识库 */

const FMT = {
  srt: {
    name: 'SRT', full: 'SubRip Subtitle',
    ext: '.srt', time: '00:00:01,000 --> 00:00:03,000',
    about: 'SRT (SubRip) is the most widely supported subtitle format. It is plain text: an index number, a timestamp line with a comma before the milliseconds, then the caption text. Players, editors and social platforms all read it, but it carries no styling.',
    facts: [
      ['Timing separator', 'comma before milliseconds'],
      ['Styling', 'none (basic <i>/<b> tags are tolerated by most players)'],
      ['Read by', 'VLC, mpv, YouTube, Premiere, DaVinci, HandBrake, ffmpeg'],
      ['Best for', 'subtitles and captions that must work everywhere'],
    ],
  },
  vtt: {
    name: 'VTT', full: 'WebVTT',
    ext: '.vtt', time: '00:00:01.000 --> 00:00:03.000',
    about: 'WebVTT is the W3C standard for captions on the web, loaded by HTML5 <track> elements. It starts with a WEBVTT header, uses dots for milliseconds and can carry cue settings (position, alignment, line) plus inline tags such as <v Speaker> and <c.classname>.',
    facts: [
      ['Timing separator', 'dot before milliseconds'],
      ['Extras', 'cue settings, NOTE/STYLE blocks, speaker and class tags'],
      ['Read by', 'browsers, YouTube, JW Player, Video.js, hls.js'],
      ['Best for', 'web players, streaming, YouTube uploads'],
    ],
  },
  ass: {
    name: 'ASS', full: 'Advanced SubStation Alpha',
    ext: '.ass', time: '0:00:01.00,0:00:03.00',
    about: 'ASS (Advanced SubStation Alpha) is the fansub format. It is a script with [Script Info], [V4+ Styles] and [Events] sections, supports per-line styling, fonts, positioning, karaoke and drawing commands — far more control than SRT, at the cost of portability.',
    facts: [
      ['Timing separator', 'centiseconds (1/100 s), comma separated in Dialogue lines'],
      ['Extras', 'styles, fonts, positioning, karaoke, drawings'],
      ['Read by', 'VLC, mpv, PotPlayer, Aegisub, ffmpeg (with libass)'],
      ['Best for', 'fansubs, hardcoded-style releases, karaoke'],
    ],
  },
  ssa: {
    name: 'SSA', full: 'SubStation Alpha (legacy)',
    ext: '.ssa', time: '0:00:01.00,0:00:03.00',
    about: 'SSA is the older SubStation Alpha format that ASS replaced. Files still circulate from 2000s-era releases; the layout is nearly identical to ASS with a v4.00 script header and slightly different style fields.',
    facts: [
      ['Timing separator', 'centiseconds'],
      ['Relation', 'predecessor of ASS — usually converts 1:1'],
      ['Read by', 'VLC, mpv, Aegisub'],
      ['Best for', 'rescuing old releases into SRT/VTT'],
    ],
  },
  sbv: {
    name: 'SBV', full: 'YouTube SBV',
    ext: '.sbv', time: '0:00:01.000,0:00:03.000',
    about: 'SBV is the legacy YouTube caption format. Each block is a start/end pair separated by a comma, followed by the text — no index numbers and no arrow. Older YouTube downloads and some broadcast tools still emit it.',
    facts: [
      ['Timing separator', 'comma between start and end'],
      ['Index numbers', 'none'],
      ['Read by', 'YouTube (legacy), some broadcast encoders'],
      ['Best for', 'converting old YouTube caption exports'],
    ],
  },
  ttml: {
    name: 'TTML', full: 'Timed Text Markup Language (also .dfxp, .xml)',
    ext: '.ttml', time: 'begin="00:00:01.000" end="00:00:03.000"',
    about: 'TTML is the XML timed-text standard used by broadcasters and streaming services (Netflix ships IMSC, a TTML profile). Timings live in begin/end/dur attributes on <p> elements, and text can be styled with CSS-like attributes.',
    facts: [
      ['Timing separator', 'clock time or offsets (2s, 500ms) in attributes'],
      ['Extras', 'XML namespaces, styling, regions, ruby'],
      ['Read by', 'broadcast systems, Netflix (IMSC), video platforms'],
      ['Best for', 'broadcast / OTT deliverables and compliance work'],
    ],
  },
  dfxp: {
    name: 'DFXP', full: 'Distribution Format Exchange Profile (TTML)',
    ext: '.dfxp', time: 'begin="00:00:01.000" end="00:00:03.000"',
    about: 'DFXP is the old name for the TTML profile used when delivering captions to broadcasters and streaming platforms. The XML layout is the same as TTML — begin/end attributes on <p> elements — so a DFXP file converts like any other XML timed text.',
    facts: [
      ['Timing separator', 'clock time in attributes'],
      ['Relation', 'a TTML profile from the SMPTE/BBC world'],
      ['Read by', 'broadcast QC tools, OTT pipelines'],
      ['Best for', 'deliverable conversion to SRT for review'],
    ],
  },
  lrc: {
    name: 'LRC', full: 'Lyrics file',
    ext: '.lrc', time: '[00:01.00]',
    about: 'LRC is the lyrics format used by music players, karaoke apps and Chinese/Japanese media players. Each line carries one or more [mm:ss.xx] timestamps and there is no end time — the next timestamp ends the line.',
    facts: [
      ['Timing separator', 'bracketed [mm:ss.xx] at line start'],
      ['End times', 'implicit (next line)'],
      ['Read by', 'foobar2000, Poweramp, AIMP, QQ音乐, 网易云'],
      ['Best for', 'turning timed lyrics into subtitles (and back)'],
    ],
  },
  csv: {
    name: 'CSV', full: 'Comma-separated spreadsheet',
    ext: '.csv', time: '00:00:01.000,00:00:03.000,text',
    about: 'A CSV export of subtitles (start, end, text) is what translation and review teams work with: it opens in Excel, Google Sheets, Airtable or a CAT tool, survives git diffs, and can be handed to a translator who has no subtitle editor.',
    facts: [
      ['Timing separator', 'any consistent timestamp; dots or commas'],
      ['Extras', 'spreadsheet formulas, columns per language'],
      ['Read by', 'Excel, Google Sheets, CAT tools, scripts'],
      ['Best for', 'translation workflows, review, batch editing text'],
    ],
  },
  txt: {
    name: 'TXT', full: 'Plain text transcript',
    ext: '.txt', time: '(none)',
    about: 'A plain text transcript keeps only the words — no timings, no numbering. It is what you need for blog posts, articles, LLM prompts, summarisation or a quick read, and it is the smallest possible output.',
    facts: [
      ['Timing separator', 'none'],
      ['Extras', 'none'],
      ['Read by', 'everything'],
      ['Best for', 'transcripts, notes, feeding text to other tools'],
    ],
  },
};

const FACT_LABELS = ['Timing separator', 'Extras / styling', 'Read by', 'Best for'];

const MATRIX_FROM = ['srt', 'vtt', 'ass', 'ssa', 'sbv', 'ttml', 'dfxp', 'lrc', 'csv', 'txt'];
const MATRIX_TO = ['srt', 'vtt', 'ass', 'sbv', 'ttml', 'lrc', 'csv', 'txt', 'ssa', 'dfxp'];

/* ------------------------------------------------------------------ 文案 */

function whyBits(from, to) {
  const bits = [];
  const f = FMT[from], t = FMT[to];
  if (from === 'ass' || from === 'ssa') bits.push('strip the styling so the text works in players and platforms that ignore ASS');
  if (to === 'ass' || to === 'ssa') bits.push('keep styling, position and font information for a fan release or a styled upload');
  if (to === 'vtt') bits.push('load the captions in a browser player or upload them to YouTube');
  if (to === 'srt') bits.push('get the one format that every player, editor and platform accepts');
  if (to === 'csv') bits.push('hand the captions to a translator or reviewer working in a spreadsheet');
  if (to === 'lrc') bits.push('sync the same text as timed lyrics in a music player');
  if (to === 'txt') bits.push('get a clean transcript for a blog post, notes or an LLM');
  if (to === 'ttml' || to === 'dfxp') bits.push('produce an XML timed-text deliverable for broadcast or OTT pipelines');
  if (from === 'lrc') bits.push('turn timed lyrics into real subtitles with proper end times');
  if (from === 'csv') bits.push('rebuild a real subtitle file from a spreadsheet that came back from a translator');
  if (from === 'ttml' || from === 'dfxp') bits.push('get a readable, editable file out of an XML deliverable');
  if (from === 'sbv') bits.push('rescue legacy YouTube caption exports');
  if (from === 'txt') bits.push('add timings to a plain transcript');
  return bits.length ? bits : [`move between ${f.name} and ${t.name} without installing an editor`];
}

function converterPage(from, to) {
  const f = FMT[from], t = FMT[to];
  const slug = `${from}-to-${to}`;
  const bits = whyBits(from, to);
  const title = `${f.name} to ${t.name} Converter — Free & Private (No Upload)`;
  const desc = `Convert ${f.name} to ${t.name} in your browser: batch conversion, optional timing shift, cleanup and a QC report. Files never leave your device.`;
  const faq = [
    [`How do I convert ${f.name} to ${t.name}?`,
      `Drag your ${f.ext} files onto the box above, pick ${t.name.toUpperCase()} as the output format and press Convert. Everything runs in JavaScript in your browser tab — there is no upload step, no queue and no file size limit.`],
    [`Does converting ${f.name} to ${t.name} keep my timings?`,
      `Yes. Timings are parsed into integer milliseconds, then written back with the precision ${t.name.toUpperCase()} expects (${t.time}). Only the container changes: cue order, start times and end times are preserved unless you turn on the timing shift or stretch options.`],
    [`Is my subtitle file uploaded to a server?`,
      `No. This tool has no backend. The conversion, cleanup and QC code is JavaScript that runs locally, so confidential or pre-release material never leaves your machine. You can even disconnect from the network after the page loads.`],
    [`What happens to ${f.name} styling${f.name === 'SRT' || f.name === 'VTT' ? ' tags' : ''} when I convert?`,
      from === 'ass' || from === 'ssa'
        ? `ASS override tags such as {\\i1} and {\\pos(...)} are stripped for formats that cannot carry them (${t.name}), and kept when the output is ASS/SSA. The words themselves are never dropped.`
        : `${t.name === 'ASS' || t.name === 'SSA' ? 'SRT/VTT inline tags are carried into the text of the Dialogue lines; ASS-specific styling can then be re-applied in Aegisub.' : 'Inline tags that the target format supports are preserved; ones it does not support are kept as plain text so nothing is silently lost.'}`],
    [`Can I convert several ${f.name} files at once?`,
      'Yes — drop a whole season on the page and every file is converted in one pass, then downloaded as a single ZIP with an optional QC report.'],
  ];
  const body = `
  <article class="prose">
    <h2>What ${f.name} → ${t.name} conversion actually changes</h2>
    <p>${f.about}</p>
    <p>${t.about}</p>
    <p>Converting <b>${f.name}</b> to <b>${t.name}</b> means repackaging the same cues: ${bits.join(', ')}.
    Timing precision, line breaks and characters are kept; only the container and the features that the target format supports are rewritten.</p>

    <h2>Format comparison</h2>
    <table class="tbl">
      <tr><th></th><th>${f.name} (${f.full})</th><th>${t.name} (${t.full})</th></tr>
      <tr><td>Extension</td><td><code>${f.ext}</code></td><td><code>${t.ext}</code></td></tr>
      <tr><td>Timing sample</td><td><code>${f.time}</code></td><td><code>${t.time}</code></td></tr>
      ${f.facts.map((row, i) => `<tr><td>${row[0]}</td><td>${row[1]}</td><td>${t.facts[i] ? t.facts[i][1] : ''}</td></tr>`).join('\n      ')}
    </table>

    <h2>How to convert ${f.name} to ${t.name}</h2>
    <ol>
      <li>Drop your <code>${f.ext}</code> file(s) into the box at the top of this page — or click it to browse.</li>
      <li>The format is detected automatically; the output is pre-set to <b>${t.name}</b>. Change it if you need another target.</li>
      <li>Optional: shift the timing (± seconds), stretch it (frame-rate mismatch), rewrap long lines, strip styling, or fix overlaps.</li>
      <li>Press <b>Convert</b>, check the QC score, then download each file or the whole batch as a ZIP.</li>
    </ol>

    <h2>Batch and QC in the same pass</h2>
    <p>Most converters stop at "here is your file". This one also audits it: every converted cue is checked for reading speed (CPS), characters per line, line count, minimum/maximum duration, overlaps and gaps — the same rules Netflix, broadcasters and streaming platforms apply. You get a per-file score plus a downloadable <code>qc-report.md</code>, so a batch of 40 files can be verified in one pass instead of one at a time.</p>

    <h2>Privacy</h2>
    <p>Nothing is uploaded. This page is static files on a CDN; all parsing, conversion, encoding repair and QC run in your browser with the File API. Unreleased trailers, client work and personal recordings stay on your device — which is also why the tool works offline once loaded.</p>
  </article>`;
  return {
    slug, title, desc, h1: `${f.name} to ${t.name} Converter`,
    lede: `Drop ${f.name} files, get ${t.name} back — batch conversion, timing tools, cleanup and a QC report, all running locally in your browser.`,
    cfg: { from, to, zipName: `${f.name.toLowerCase()}-to-${t.name.toLowerCase()}.zip`, autoRun: false },
    body, faq, related: 'converters',
  };
}

/* ------------------------------------------------------------------ 专项页 */

const SPECIAL = [
  {
    slug: 'batch-subtitle-converter',
    title: 'Batch Subtitle Converter — Convert 100 Files at Once, Free',
    h1: 'Batch Subtitle Converter',
    desc: 'Convert a whole folder of SRT, VTT, ASS, SBV, TTML, LRC or CSV subtitles in one pass, in your browser, and download everything as a ZIP with a QC report.',
    lede: 'Drop an entire season, convert every file in one pass, audit them and download a single ZIP. No upload, no queue, no per-file limit.',
    cfg: { zipName: 'subtitle-batch.zip' },
    body: `<article class="prose">
      <h2>Convert many subtitle files without a desktop editor</h2>
      <p>Desktop tools such as Subtitle Edit, Aegisub or ffmpeg handle batch conversion, but they need an install, a script or a folder walk — and they are not an option on a locked-down work laptop, a Chromebook or an iPad. This page does the same job in a browser tab: drop 1 file or 200, choose the target format, press Convert, get a ZIP.</p>
      <h2>What is in the ZIP</h2>
      <ul>
        <li>Every converted file, keeping its original name with the new extension.</li>
        <li><code>qc-report.md</code> — per-file cue count, duration, errors, warnings and a 0–100 score, plus a table of every problem found.</li>
      </ul>
      <h2>Bulk fixes that usually come with a batch</h2>
      <ul>
        <li><b>Timing shift</b> — everything is 2.5 s late because of an intro you removed: shift the whole batch at once.</li>
        <li><b>Frame-rate stretch</b> — 25 fps subtitles on a 23.976 fps master: multiply once instead of re-timing by hand.</li>
        <li><b>Encoding repair</b> — a folder of GBK / Shift-JIS / CP1252 files that render as mojibake.</li>
        <li><b>Cleanup</b> — strip <code>[Music]</code> style hearing-impaired cues, HTML tags, double spaces and empty cues.</li>
        <li><b>Rewrap</b> — enforce a maximum characters-per-line so long lines stop overflowing the player.</li>
        <li><b>Overlap repair</b> — remove overlaps and micro-gaps that make players flicker.</li>
      </ul>
      <h2>Why local processing matters for batches</h2>
      <p>A batch means the whole project: every unreleased episode, every client deliverable, every recording of a class. Sites that upload your ZIP to a server to convert it make that material part of their storage. Here the files never leave the machine — the page is static HTML and JavaScript.</p>
    </article>`,
    faq: [
      ['How many files can I convert at once?', 'There is no fixed limit — the conversion is a local JavaScript loop, so the practical ceiling is your browser memory. Batches of a few hundred small files are fine; a 10,000-cue file converts in well under a second.'],
      ['Can I convert each file to a different format in one batch?', 'One batch converts to one target format. If you need two targets, run the same drop twice and switch the output format — the files stay in the page.'],
      ['Does it keep the original filenames?', 'Yes. Each output keeps the input name and gets the new extension, so ordering and matching with video files stays intact.'],
      ['Is there a size or paywall limit?', 'No. Free, no account, no watermark, no file-size ceiling.'],
    ],
  },
  {
    slug: 'subtitle-sync-shifter',
    title: 'Subtitle Sync Shifter — Fix Out-of-Sync Subtitles (Online, Free)',
    h1: 'Subtitle Sync Shifter',
    desc: 'Shift subtitle timing forward or backward by seconds or milliseconds to fix subtitles that are early or late. Batch, in-browser, nothing uploaded.',
    lede: 'Subtitles 2.4 seconds late? Shift every cue at once — forwards or backwards — and check the result before you commit.',
    cfg: { to: 'srt', zipName: 'resynced-subtitles.zip' },
    body: `<article class="prose">
      <h2>When a constant shift is the fix</h2>
      <p>If every line is wrong by the <i>same</i> amount, the subtitle file was timed against a different edit: an intro was added, a recap removed, a different release was used, or the source was converted between frame rates. That is a constant offset, and shifting the whole file is the correct fix — no need to retime cue by cue.</p>
      <h2>Positive or negative, and by how much</h2>
      <p>Negative shift = subtitles appear earlier; positive shift = later. Seconds and milliseconds are both accepted (enter <code>-2.4</code> or <code>2400ms</code> as <code>-2.4</code>). Because the whole file moves together, the amount is the same as the constant error you can measure on the first cue: play the file, note how early or late line one is, enter that number.</p>
      <h2>Shift vs stretch</h2>
      <ul>
        <li><b>Shift</b> — the drift is the same at the beginning and the end of the file.</li>
        <li><b>Stretch</b> — the first cue is fine but the last one is off by seconds: that is a frame-rate mismatch (23.976 / 24 / 25 / 29.97) and needs a multiplier, not an offset. The presets below the options handle the common ratios.</li>
      </ul>
      <h2>Verify before you ship</h2>
      <p>After shifting, the QC pass flags cues that became too short, too long or overlapping, and the preview shows the first cues with the new timings. Subtitle files that have been shifted by hand tend to accumulate exactly those defects.</p>
    </article>`,
    faq: [
      ['How do I know how much to shift?', 'Read the offset off the first line: if a cue should appear at 00:00:12 but shows at 00:00:09.5, shift +2.5 s. Then verify the last cue — if it is also +2.5 s off, a shift is the right fix.'],
      ['Can I shift subtitles to start later without breaking the end?', 'Yes, the whole file moves as a rigid block: start times and end times both move by the same amount, so durations never change.'],
      ['What if the subtitles drift progressively?', 'That is a stretch, not a shift. Use the frame-rate presets (23.976 → 25, 25 → 23.976, …) which multiply every timestamp by the correct ratio.'],
      ['Does it work for VTT and ASS too?', 'Yes — any supported input can be shifted, and the output format is selected separately, so you can also use it to fix timing while converting.'],
    ],
  },
  {
    slug: 'subtitle-frame-rate-converter',
    title: 'Frame Rate Converter for Subtitles — 23.976 / 24 / 25 / 29.97 Fix',
    h1: 'Subtitle Frame-Rate Converter',
    desc: 'Fix subtitles that drift because of a frame-rate mismatch (23.976, 24, 25, 29.97 fps). Multiply every timestamp by the right ratio in your browser.',
    lede: 'PAL/NTSC, 23.976 vs 25 — subtitle drift from a frame-rate mismatch is fixed with one multiplier. Pick a preset and convert.',
    cfg: { to: 'srt', zipName: 'fps-fixed-subtitles.zip' },
    body: `<article class="prose">
      <h2>Why frame-rate mismatches break subtitles</h2>
      <p>Subtitle timestamps are wall-clock times, but they are authored while watching a specific transfer. When a film is converted between 23.976 and 25 fps (PAL speedup) the runtime changes by about 4.27% — the audio is pitched up, the video is shorter, and subtitles that were correct for the original run <i>progressively</i> drift out of sync.</p>
      <h2>The ratios</h2>
      <table class="tbl">
        <tr><th>Case</th><th>Multiplier</th></tr>
        <tr><td>23.976 fps subs on a 25 fps master</td><td><code>23.976 / 25 = 0.95904</code></td></tr>
        <tr><td>25 fps subs on a 23.976 fps master</td><td><code>25 / 23.976 = 1.04271</code></td></tr>
        <tr><td>24 fps subs on a 25 fps master</td><td><code>24 / 25 = 0.96</code></td></tr>
        <tr><td>25 fps subs on a 24 fps master</td><td><code>25 / 24 = 1.04167</code></td></tr>
        <tr><td>23.976 ↔ 29.97 (film → NTSC video)</td><td><code>23.976 / 29.97 = 0.8</code></td></tr>
      </table>
      <p>Pick the multiplier that describes <b>where the subtitles came from</b> divided by <b>where they are going</b>. If the file is a minute late at the end of a 24-minute episode, that is ~4%, which points at a PAL/NTSC mismatch rather than an offset.</p>
      <h2>Combine with a shift</h2>
      <p>Real-world fixes usually need both: stretch to remove the drift, then a small constant shift to line up the first cue. Both options are on the page and can be applied in the same pass — stretch is applied first.</p>
    </article>`,
    faq: [
      ['What is the difference between 23.976 and 24 fps?', '23.976 (24000/1001) is the NTSC-compatible film rate, 24 is the integer rate. The 0.1% difference is small but adds up over a feature film: about 4 seconds over 90 minutes.'],
      ['How do I know the source frame rate of my subtitle file?', 'Subtitle files rarely record it. Infer it from the drift: measure the offset at the start and at the end, divide the difference by the elapsed time and compare with the ratios above.'],
      ['Will stretching change cue durations?', 'Yes, proportionally — a 2 s cue becomes 2.085 s at 1.04271. The QC pass tells you if any cue crosses the duration limits afterwards.'],
      ['Does it fix PAL speedup audio?', 'It aligns the subtitles with the sped-up video; the audio pitch is a separate problem handled by the player (pitch correction) or by re-encoding.'],
    ],
  },
  {
    slug: 'caption-compliance-checker',
    title: 'Caption Compliance Checker — CPS, CPL, Duration & Overlap QC',
    h1: 'Caption & Subtitle Compliance Checker',
    desc: 'Check subtitles against Netflix/YouTube-style rules: reading speed (CPS), characters per line (CPL), line count, min/max duration, overlaps and gaps. Free, private, batch.',
    lede: 'Audit subtitles against the rules platforms and broadcasters actually enforce — reading speed, line length, durations, overlaps — and get a score per file.',
    cfg: { to: 'srt', zipName: 'qc-checked.zip' },
    body: `<article class="prose">
      <h2>The checks</h2>
      <table class="tbl">
        <tr><th>Check</th><th>Default threshold</th><th>Why it matters</th></tr>
        <tr><td>Reading speed (CPS)</td><td>≤ 20 characters/second</td><td>Above this most viewers cannot finish the line before it disappears. Netflix requires ≤ 20 for adult content, lower for children's programming.</td></tr>
        <tr><td>Characters per line (CPL)</td><td>≤ 42</td><td>Longer lines wrap unpredictably or overflow the safe area on phones.</td></tr>
        <tr><td>Lines per cue</td><td>≤ 2</td><td>Three-line cues cover too much of the frame.</td></tr>
        <tr><td>Minimum duration</td><td>≥ 0.833 s (5/6 s)</td><td>Shorter cues flash; several standards also require 2 frames of gap.</td></tr>
        <tr><td>Maximum duration</td><td>≤ 7 s</td><td>Very long cues usually mean a missing line break or a stuck cue.</td></tr>
        <tr><td>Overlaps</td><td>0</td><td>Overlapping cues cause flicker or doubled text in most players.</td></tr>
        <tr><td>Empty cues</td><td>0</td><td>Empty blocks confuse players and strict QC deliveries.</td></tr>
      </table>
      <h2>What you get</h2>
      <ul>
        <li>A per-cue issue list with cue number, level (error/warning) and the measured value.</li>
        <li>A 0–100 score per file, and a summary table for the whole batch.</li>
        <li><code>qc-report.md</code> in the ZIP — paste it into a delivery note or a client email.</li>
      </ul>
      <h2>Fix while you check</h2>
      <p>The same pass can repair the mechanical defects: rewrite long lines to a chosen CPL, remove overlaps and enforce a minimum duration. Reading-speed problems are reported but not "fixed" automatically, because the honest fix is shortening the text, not displaying it faster.</p>
    </article>`,
    faq: [
      ['What CPS limit should I use?', '20 characters/second is the common ceiling for adult programming; 17 is a comfortable target and 13–15 is typical for children\'s content. The default here is 20 (warning level).'],
      ['Is this the same as Netflix\'s TIMED TEXT STYLE GUIDE?', 'The checks mirror the published rules that matter most (CPS, CPL, duration, line count, overlap). It is a fast pre-flight check, not a certified delivery QC.'],
      ['Will it check every file in a batch?', 'Yes — each file gets its own score and issue list, and the ZIP contains the combined report.'],
      ['Does it work for VTT and ASS?', 'Yes, all supported formats are parsed to the same internal model, so the checks are format-independent.'],
    ],
  },
  {
    slug: 'subtitle-encoding-fixer',
    title: 'Subtitle Encoding Fixer — Repair Mojibake (GBK, Shift-JIS, CP1252)',
    h1: 'Subtitle Encoding Fixer',
    desc: 'Fix garbled subtitle text: mojibake from GBK, Big5, Shift-JIS, Windows-1251/1252 mis-decoded as UTF-8 or Latin-1. In-browser, no upload.',
    lede: 'Subtitle text showing as ����� or Ã¤Â¸Â? Paste or drop the file — the encoding is detected and repaired in the browser.',
    cfg: { to: 'srt', zipName: 'encoding-fixed.zip' },
    body: `<article class="prose">
      <h2>Why subtitles end up garbled</h2>
      <p>Subtitle files are just text, with no reliable declaration of which encoding was used. Chinese releases are often GBK or Big5, Japanese ones Shift-JIS, older Western ones Windows-1252. When a player, editor or a server assumes UTF-8, the bytes are reinterpreted and the text becomes mojibake — the classic <code>ä¸æ–‡</code> or <code>�����</code> you see in VLC.</p>
      <h2>What this page does</h2>
      <ul>
        <li><b>Byte-level round trip</b> — text that was UTF-8 read as Latin-1/CP1252 is converted back to bytes and re-decoded as UTF-8.</li>
        <li><b>Legacy code page recovery</b> — if the bytes really are GBK, Big5, Shift-JIS, EUC-KR or Windows-1251, the file is decoded with those code pages instead.</li>
        <li><b>Output normalised to UTF-8</b> — the fixed file is written as UTF-8 so it stops breaking everywhere else.</li>
      </ul>
      <h2>Manual fallback</h2>
      <p>If a file is beyond automatic repair, the encoding selector lets you force a specific code page for the input, and the preview shows the decoded text immediately so you can try them in order: UTF-8, GBK, Big5, Shift-JIS, Windows-1252.</p>
      <h2>Why not use an online converter?</h2>
      <p>Encoding repair needs the original bytes. Uploading them to a server means the file — often unreleased or client material — sits in someone else's storage. This tool never sends the file anywhere; the decoding happens in the tab.</p>
    </article>`,
    faq: [
      ['My file shows ��� in VLC. What encoding is it?', 'U+FFFD replacement characters mean the bytes were already lost when the file was decoded — usually the file is GBK or Shift-JIS being read as UTF-8. Try the encoding selector with GBK or Shift-JIS; if the file still shows replacement characters, the damage happened when it was originally saved.'],
      ['Why does the classic ä¸æ–‡ pattern appear?', 'That is UTF-8 Chinese text that was decoded as Latin-1 or Windows-1252. The characters are recoverable: each Latin-1 character maps back to one original byte.'],
      ['Can I convert a whole folder of GBK subtitles at once?', 'Yes — batch processing applies the same detection and repair to every file and returns them as UTF-8 in a ZIP.'],
      ['Does it fix wrong characters inside ASS styling?', 'Yes, decoding happens on the bytes before parsing, so styling and text are repaired together.'],
    ],
  },
  {
    slug: 'bilingual-subtitle-merger',
    title: 'Bilingual Subtitle Merger — Combine Two Languages Into One File',
    h1: 'Bilingual Subtitle Merger',
    desc: 'Merge two subtitle files (e.g. English + Chinese) into one bilingual file by matching timings, in your browser. Free, batch, no upload.',
    lede: 'Two files, one bilingual subtitle: original on top, translation below — paired by timing with a tolerance you control, not by line order.',
    cfg: { to: 'srt', zipName: 'bilingual.zip' },
    body: `<article class="prose">
      <h2>How the pairing works</h2>
      <p>A bilingual subtitle is two translations of the same cue, stacked. The naive approach — line 1 of file A with line 1 of file B — breaks as soon as one file has a merged cue, a missing line or a different offset. This tool pairs by <b>start time</b>: for each cue in the primary file it looks for the nearest unused cue in the second file within a tolerance window (default 900 ms), so a one-cue drift or a missing line does not shift everything after it.</p>
      <h2>Things to check before merging</h2>
      <ul>
        <li><b>Fix the timing of both files first.</b> Merging two files that are each out of sync by a different amount produces alternating wrong lines.</li>
        <li><b>Match the cue splits.</b> If one language splits a sentence into two cues and the other keeps it in one, bilingual output looks ragged. Merging tolerates it; viewers notice it.</li>
        <li><b>Order matters.</b> Original-on-top is the convention for language learning; translated-on-top is more readable for general audiences — both are a click.</li>
      </ul>
      <h2>No cue is silently dropped</h2>
      <p>Second-language cues that never found a partner are appended with their own timing instead of being discarded, so a missing line is visible in the output rather than invisible. The QC pass then flags the resulting overlaps or short cues.</p>
    </article>`,
    faq: [
      ['Can I merge an SRT with an ASS file?', 'Yes, both are parsed to the same cue model, so any supported pair of formats can be merged into any supported output format.'],
      ['How tight should the timing tolerance be?', '900 ms is a good default for files timed against the same video. Lower it to 200–300 ms if both files are precise and you want strict one-to-one pairing.'],
      ['Which language goes on top?', 'Your choice with the order option: primary-on-top suits language learning, secondary-on-top suits general audiences who read the translation first.'],
      ['Can I merge a whole folder?', 'The merger works on one pair at a time (primary + translation). For folder-wide operations use the batch page and convert everything to a common format first.'],
    ],
  },
  {
    slug: 'subtitle-merger',
    title: 'Subtitle Merger — Join Multiple Subtitle Files End to End',
    h1: 'Subtitle Merger (Sequential)',
    desc: 'Join two or more subtitle files into one continuous file, shifting later parts to follow the previous ones. In-browser, free.',
    lede: 'Subtitles for part 1 and part 2 in a single file: each part is rebased to start where the previous one ended.',
    cfg: { to: 'srt', zipName: 'merged.zip' },
    body: `<article class="prose">
      <h2>Sequential merge vs bilingual merge</h2>
      <p>This page <b>concatenates</b>: the first cue of part 2 starts right after the last cue of part 1, with a configurable gap. That is what you need when a video was delivered in two files, when a lecture was recorded in two takes, or when an episode plus its trailer share one subtitle track. For two languages of the same cues, use the bilingual merger instead.</p>
      <h2>Rebasing, not re-timing</h2>
      <p>Each part keeps its internal rhythm — gaps between cues inside a part are preserved — but the part is shifted so it begins after the previous part. A 200 ms gap is inserted between parts by default to avoid an overlap at the join; the QC pass then confirms the seam is clean.</p>
    </article>`,
    faq: [
      ['How many files can I join?', 'Two parts at a time (primary + second file). Join the result with the third part if you have more — the operation is associative and each pass preserves the internal timings.'],
      ['Can I control the gap between parts?', 'A 200 ms default gap is applied at the join; larger values are useful when the second part has a title card or a hard cut.'],
      ['Will cue numbering be fixed?', 'Yes — the output is renumbered from 1 so players that rely on sequential indices are happy.'],
      ['Does it work with VTT?', 'Yes, and the output format is chosen separately, so parts in different formats can be joined into one.'],
    ],
  },
  {
    slug: 'srt-cleaner',
    title: 'SRT Cleaner — Strip Tags, Hearing-Impaired Cues & Double Spaces',
    h1: 'SRT / VTT Cleaner',
    desc: 'Clean subtitle files: remove HTML and ASS tags, [Music] style hearing-impaired cues, double spaces, empty cues, and rewrap long lines. In-browser.',
    lede: 'Tidy a messy subtitle file before delivery: strip tags, drop [Sound effect] cues, collapse spaces, rewrap lines, remove empties.',
    cfg: { to: 'srt', zipName: 'cleaned.zip' },
    body: `<article class="prose">
      <h2>What "cleaning" means here</h2>
      <ul>
        <li><b>Strip tags</b> — <code>&lt;i&gt;</code>, <code>&lt;b&gt;</code>, <code>&lt;font&gt;</code>, <code>{\\an8}</code> and friends, for platforms that render them literally.</li>
        <li><b>Drop hearing-impaired cues</b> — lines that are only a sound description, such as <code>[Music]</code>, <code>(laughs)</code> or <code>♪♪</code>, which look wrong in a translated subtitle.</li>
        <li><b>Collapse spacing</b> — double spaces, trailing spaces and tabs inside a cue.</li>
        <li><b>Rewrap</b> — enforce a maximum characters per line so nothing overflows.</li>
        <li><b>Remove empty cues</b> — blocks that contain no text at all.</li>
      </ul>
      <h2>Order of operations</h2>
      <p>Cleaning happens after the timing options and before overlap repair, so a line that gets rewrapped into two lines is still checked for duration and reading speed afterwards. That order matters: rewrapping to a shorter CPL usually lowers the reading-speed problem, which is one of the cheapest ways to make a QC report pass.</p>
    </article>`,
    faq: [
      ['Does it remove the text of sound effects that are part of the dialogue?', 'Only lines that consist entirely of a bracketed or parenthesised description are removed, so "I heard a [gunshot] behind us" survives.'],
      ['Can it fix ALL-CAPS subtitles?', 'Not in this version — case conversion is on the roadmap. Cleaning currently covers tags, spacing, hearing-impaired cues, wrapping and empty cues.'],
      ['Is it safe on a big file?', 'Yes, 10,000-cue files are processed in well under a second in a browser tab.'],
      ['Can I clean without converting?', 'Yes — set the output format to the same as the input and only the cleanup options apply.'],
    ],
  },
  {
    slug: 'subtitle-line-breaker',
    title: 'Subtitle Line Breaker — Enforce Characters Per Line (CPL)',
    h1: 'Subtitle Line Breaker (CPL)',
    desc: 'Rewrap subtitle cues to a maximum characters-per-line limit (42, 40, 35…) so text fits the safe area on phones and TVs. In-browser, batch.',
    lede: 'Set a maximum characters per line and every cue is rewrapped — the fastest way to stop subtitles overflowing on mobile.',
    cfg: { to: 'srt', zipName: 'rewrapped.zip' },
    body: `<article class="prose">
      <h2>Why 42 characters</h2>
      <p>Netflix's timed-text style guide allows a maximum of 42 characters per line for most Latin-script languages, and two lines per cue. The number comes from the safe area of a 16:9 frame: beyond that, text either runs into the edge or gets scaled down by the player. On a phone in portrait, the effective limit is lower — 32 to 38 characters is a practical target for social video.</p>
      <h2>Where the breaks go</h2>
      <p>Wrapping happens at word boundaries (spaces), never inside a word, and only when a line exceeds the limit. Existing manual line breaks are respected, which matters for subtitles where the break carries meaning — poems, song lyrics, two speakers in one cue.</p>
      <h2>Check the reading speed after</h2>
      <p>Wrapping does not change timing, so a cue that was over the reading-speed limit stays over it. The QC pass reports CPS separately: the honest fix for a too-fast cue is fewer words, not a smaller font.</p>
    </article>`,
    faq: [
      ['Does rewrapping change the timings?', 'No, only the text layout inside each cue changes. Start and end times are untouched.'],
      ['What value should I use?', '42 for broadcast/streaming deliverables, 38 for YouTube, 32–35 for vertical social video.'],
      ['Will it break CJK subtitles?', 'CJK text has no spaces, so line breaking falls back to a character count for languages without word separators — the result is a hard wrap at the limit.'],
      ['Can it also join lines that are too short?', 'It can rewrap an over-long line into two, and it never merges existing lines, so manual two-line cues are preserved as authored.'],
    ],
  },
  {
    slug: 'subtitle-duration-fixer',
    title: 'Subtitle Duration Fixer — Remove Overlaps & Flash-Frame Cues',
    h1: 'Subtitle Duration & Overlap Fixer',
    desc: 'Repair subtitle timing defects: overlapping cues, too-short flash cues and zero-duration lines, with a configurable minimum duration and gap.',
    lede: 'Overlaps, zero-duration cues and single-frame flashes — the mechanical timing defects that make players flicker or drop text — repaired in one pass.',
    cfg: { to: 'srt', zipName: 'timing-fixed.zip' },
    body: `<article class="prose">
      <h2>The three defects that break playback</h2>
      <ul>
        <li><b>Overlap</b> — cue A ends after cue B starts. Players either stack both lines or drop one; some platforms reject the file outright.</li>
        <li><b>Too short</b> — a cue shorter than about 0.8 s (5/6 s, the Netflix minimum) is not readable, and very short cues flicker.</li>
        <li><b>Zero or negative duration</b> — a common bug after a bad shift or a stretch, and the cue usually disappears entirely.</li>
      </ul>
      <h2>How the repair works</h2>
      <p>Each cue is pushed to at least the minimum duration (default 500 ms, adjustable), then overlaps are resolved by pulling the earlier cue's end back to leave a gap (default 40 ms) before the next one starts. Nothing is deleted and cue order is preserved, so the repair is reversible by shifting the whole file back if you disagree with it.</p>
      <h2>After a repair, re-check</h2>
      <p>Fixing overlaps shortens some cues, which can push them under the minimum duration again — the QC pass runs after the repair and reports anything left over, so the two options are meant to be used together.</p>
    </article>`,
    faq: [
      ['Will fixing overlaps delete lines?', 'No. Durations are trimmed, text is never removed.'],
      ['What minimum duration is correct?', '0.833 s (5/6 of a second) is the common broadcast minimum; 500 ms is the default here because it is a safe floor for web video.'],
      ['Can it fix gaps that are too long?', 'Long gaps are reported, not silently closed — a long gap is often intentional (a scene change) so closing it automatically would be wrong.'],
      ['Does it work on VTT and ASS?', 'Yes, the repair works on the internal cue model, so any input format benefits.'],
    ],
  },
  {
    slug: 'privacy-subtitle-converter',
    title: 'Private Subtitle Converter — No Upload, Works Offline',
    h1: 'A Subtitle Converter That Never Uploads Your Files',
    desc: 'Why this subtitle converter runs entirely in your browser: no uploads, no queue, no storage — safe for unreleased and confidential material.',
    lede: 'Every other online converter uploads your file to a server. This one cannot: there is no server. Here is what that changes.',
    cfg: { to: 'srt', zipName: 'converted.zip' },
    body: `<article class="prose">
      <h2>What "client-side" means</h2>
      <p>This site is a set of static files — HTML, CSS and JavaScript — served from a CDN. When you drop a subtitle file on the page, the browser reads it with the File API and the conversion runs in the same tab. There is no API call with your file in it, no upload progress bar, no temporary storage, no server log that could contain your content.</p>
      <h2>Who this matters for</h2>
      <ul>
        <li><b>Studios and agencies</b> — unreleased trailers, screeners and client deliverables under NDA.</li>
        <li><b>Translators and subtitlers</b> — paid work that belongs to a client.</li>
        <li><b>Researchers and journalists</b> — interview recordings and transcripts.</li>
        <li><b>Anyone on a metered or slow connection</b> — a 40 KB subtitle file does not need a round trip.</li>
      </ul>
      <h2>How to verify it</h2>
      <p>Load the page, then open your browser's DevTools → Network tab and convert a file. No request carries the file: the only requests are for the page itself. You can also disconnect from the network after the page loads — conversion keeps working, because nothing needs a server.</p>
      <h2>The trade-off</h2>
      <p>Some conversions genuinely need a server: extracting subtitles from a <i>video</i> file, OCR of bitmap subtitles (VobSub, PGS), or speech recognition from audio. Those are deliberately not on this site. Anything that is pure text — format conversion, timing, cleanup, QC, encoding repair — runs locally.</p>
    </article>`,
    faq: [
      ['Do you store or log my subtitle files?', 'No. There is no backend, so there is nowhere for a file to be stored. The site is static files on a CDN.'],
      ['Can I use it offline?', 'After the page has loaded once, yes — the conversion is local JavaScript and does not need the network.'],
      ['Is it safe for client work under NDA?', 'The file never leaves your machine, which is the strongest guarantee available in a browser tool. Verifying with DevTools takes about ten seconds.'],
      ['Why is there no video or audio input?', 'Extracting or recognising speech requires compute that cannot run in a tab. Keeping those features out is what allows everything else to stay local.'],
    ],
  },
];

/* ------------------------------------------------------------------ 模板 */

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function attr(s) { return esc(s).replace(/"/g, '&quot;'); }

const ALL_LINKS = () => {
  const conv = [];
  for (const f of MATRIX_FROM) for (const t of MATRIX_TO) { if (f !== t) conv.push({ href: `${f}-to-${t}.html`, label: `${FMT[f].name} → ${FMT[t].name}` }); }
  return conv;
};

function toolHTML(cfg, compact) {
  const targets = MATRIX_TO.concat(['ssa', 'dfxp'].filter((x) => !MATRIX_TO.includes(x)));
  const uniq = [...new Set(targets)];
  const fmtBtns = uniq.map((f) => `<button class="fmtbtn${cfg.to === f ? ' active' : ''}" data-to="${f}">${f}</button>`).join('');
  return `
<section class="panel" id="tool">
  <div id="drop" role="button" tabindex="0" aria-label="Add subtitle files">
    <b>Drop subtitle files here</b>
    <div class="hint">or click to browse · SRT · VTT · ASS · SSA · SBV · TTML · DFXP · LRC · CSV · TXT · files are processed locally</div>
    <input type="file" id="file" multiple accept=".srt,.vtt,.ass,.ssa,.sbv,.ttml,.dfxp,.xml,.lrc,.csv,.tsv,.txt" hidden>
  </div>

  <div class="grid">
    <div>
      <label class="field"><b>Output format</b>
        <select id="target-format">
          ${uniq.map((f) => `<option value="${f}"${cfg.to === f ? ' selected' : ''}>${f.toUpperCase()} — ${FMT[f] ? FMT[f].full : f}</option>`).join('')}
        </select>
      </label>
      <div class="fmtbtns">${fmtBtns}</div>

      <label class="field" style="margin-top:16px"><b>Timing shift (seconds)</b>
        <input type="text" id="opt-shift" value="0" inputmode="decimal" placeholder="e.g. -2.4 to make subtitles earlier">
      </label>
      <div class="presets">
        <button class="preset" data-shift="-2.5">−2.5 s</button>
        <button class="preset" data-shift="-1">−1 s</button>
        <button class="preset" data-shift="0">0</button>
        <button class="preset" data-shift="1">+1 s</button>
        <button class="preset" data-shift="2.5">+2.5 s</button>
      </div>

      <label class="field" style="margin-top:14px"><b>Frame-rate stretch (multiplier)</b>
        <input type="text" id="opt-scale" value="1" inputmode="decimal">
      </label>
      <div class="presets">
        <button class="preset" data-scale="1">none</button>
        <button class="preset" data-scale="0.95904">23.976→25</button>
        <button class="preset" data-scale="1.04271">25→23.976</button>
        <button class="preset" data-scale="0.96">24→25</button>
        <button class="preset" data-scale="1.04167">25→24</button>
        <button class="preset" data-scale="0.8">23.976→29.97</button>
      </div>

      <label class="field" style="margin-top:14px"><b>Filename suffix</b>
        <input type="text" id="opt-suffix" value="" placeholder="e.g. -en">
      </label>
    </div>

    <div>
      <label class="field"><b>Cleanup</b></label>
      <div class="checks">
        <label class="check"><input type="checkbox" id="opt-clean" checked><span>Clean text<small>collapse double spaces, drop empty cues</small></span></label>
        <label class="check"><input type="checkbox" id="opt-striptags"><span>Strip HTML / ASS tags<small>&lt;i&gt;, &lt;font&gt;, {\\an8} …</small></span></label>
        <label class="check"><input type="checkbox" id="opt-hearing"><span>Remove hearing-impaired cues<small>[Music], (laughs), ♪♪</small></span></label>
        <label class="check"><input type="checkbox" id="opt-overlaps" checked><span>Repair overlaps &amp; short cues<small>min 500 ms, 40 ms gap</small></span></label>
        <label class="check"><input type="checkbox" id="opt-qc" checked><span>Run QC (CPS / CPL / duration)<small>score + issue list + qc-report.md</small></span></label>
      </div>

      <label class="field" style="margin-top:14px"><b>Max characters per line</b>
        <input type="number" id="opt-maxcpl" value="0" min="0" max="120">
        <small class="note">0 = keep as authored. 42 = broadcast standard, 35 = social video.</small>
      </label>

      <label class="field"><b>Input encoding</b>
        <select id="opt-encoding">
          <option value="auto">Auto-detect (UTF-8 → GBK → Big5 → Shift-JIS → 1252)</option>
          <option value="utf-8">UTF-8</option>
          <option value="gbk">GBK / GB18030 (Chinese)</option>
          <option value="big5">Big5 (Traditional Chinese)</option>
          <option value="shift_jis">Shift-JIS (Japanese)</option>
          <option value="euc-kr">EUC-KR (Korean)</option>
          <option value="windows-1252">Windows-1252 / Latin-1</option>
          <option value="windows-1251">Windows-1251 (Cyrillic)</option>
        </select>
      </label>

      <label class="field"><b>Second file (merge)</b></label>
      <div class="checks">
        <label class="check"><input type="checkbox" id="opt-merge"><span>Use a second file<small>bilingual pairing or sequential join</small></span></label>
      </div>
      <div id="secondbox" style="display:none;margin-top:8px">
        <input type="file" id="secondfile" multiple accept=".srt,.vtt,.ass,.ssa,.sbv,.ttml,.dfxp,.xml,.lrc,.csv,.tsv,.txt">
        <div class="row" style="margin-top:8px">
          <label class="field" style="margin:0"><b>Merge mode</b>
            <select id="opt-mergemode">
              <option value="pair">Bilingual — pair cues by timing</option>
              <option value="concat">Sequential — join one after another</option>
            </select>
          </label>
          <label class="field" style="margin:0"><b>Line order</b>
            <select id="opt-mergeorder">
              <option value="ab">Primary on top</option>
              <option value="ba">Second on top</option>
            </select>
          </label>
        </div>
        <div id="secondlist" style="margin-top:8px"></div>
      </div>
    </div>
  </div>

  <div class="actions">
    <button class="btn" id="run">Convert</button>
    <button class="btn ghost" id="download-all" disabled>Download all as ZIP</button>
    <button class="btn ghost" id="report-only">QC report only</button>
    <button class="btn ghost" id="clear" style="display:none">Clear</button>
    <span class="meta" id="count" style="color:var(--mut);font-size:13.5px"></span>
  </div>
  <div id="filelist"></div>
  <p class="note">100% local: your files are read with the browser File API and never uploaded. No account, no watermark, no file-size limit.</p>
</section>`;
}

function pageShell(p) {
  const cfg = Object.assign({ from: null, to: 'srt', autoRun: false }, p.cfg || {});
  const canonical = `${BASE}/${p.slug === 'index' ? '' : p.slug + '.html'}`;
  const faqLd = p.faq && p.faq.length ? {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: p.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  } : null;
  const appLd = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: `${SITE} — ${p.h1}`,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Any (browser)',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    description: p.desc,
    url: canonical,
    featureList: ['subtitle format conversion', 'batch processing', 'timing shift', 'frame-rate stretch', 'caption QC (CPS/CPL)', 'encoding repair', 'bilingual merge'],
  };
  const bcLd = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Subtitle tools', item: BASE + '/' },
      { '@type': 'ListItem', position: 2, name: p.h1, item: canonical },
    ],
  };
  const links = ALL_LINKS();
  const footerCols = [
    ['Popular converters', links.filter((l) => /SRT →|→ SRT|VTT →|ASS →/.test(l.label)).slice(0, 14)],
    ['Tools', SPECIAL.map((s) => ({ href: `${s.slug}.html`, label: s.h1 }))],
    ['More formats', links.filter((l) => /LRC|CSV|TTML|SBV|DFXP|SSA|TXT/.test(l.label)).slice(0, 16)],
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${attr(p.desc)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large">
<meta name="msvalidate.01" content="E62785F51D89A3BD3AFBB2BC2BB07BF9">
<meta name="theme-color" content="#0b0f19">
<meta property="og:type" content="website">
<meta property="og:title" content="${attr(p.title)}">
<meta property="og:description" content="${attr(p.desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="${SITE}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="assets/styles.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='%235b8cff'/><text x='50' y='68' font-size='54' text-anchor='middle' fill='white' font-family='sans-serif'>S</text></svg>">
${p.faq && p.faq.length ? `<script type="application/ld+json">${JSON.stringify(faqLd)}</script>` : ''}
<script type="application/ld+json">${JSON.stringify(appLd)}</script>
<script type="application/ld+json">${JSON.stringify(bcLd)}</script>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="index.html">Subtitle<span>Kit</span></a>
  <nav>
    <a href="batch-subtitle-converter.html">Batch</a>
    <a href="subtitle-sync-shifter.html">Sync fix</a>
    <a href="caption-compliance-checker.html">QC check</a>
    <a href="bilingual-subtitle-merger.html">Bilingual</a>
    <a href="subtitle-encoding-fixer.html">Encoding</a>
  </nav>
</div></header>

<main class="wrap">
  <div class="hero">
    <h1>${esc(p.h1)}</h1>
    <p class="lede">${esc(p.lede)}</p>
    <div class="badges">
      <span class="badge">No upload — 100% in-browser</span>
      <span class="badge">Batch + ZIP</span>
      <span class="badge b">Free, no account</span>
      <span class="badge b">QC report included</span>
    </div>
  </div>

  ${toolHTML(cfg)}

  ${p.body || ''}

  ${p.faq && p.faq.length ? `<section class="faq prose"><h2>FAQ</h2>${p.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n')}</section>` : ''}

  <section>
    <h2 style="font-size:20px">Related tools</h2>
    <div class="links">
      ${links.filter((l) => l.href !== p.slug + '.html').slice(0, 12).map((l) => `<a href="${l.href}">${l.label}</a>`).join('')}
    </div>
  </section>
</main>

<footer><div class="wrap">
  <div class="cols">
    ${footerCols.map(([h, ls]) => `<div><h4>${h}</h4>${ls.map((l) => `<a href="${l.href}">${l.label}</a>`).join('')}</div>`).join('')}
  </div>
  <p style="margin-top:22px">${SITE} — ${TAGLINE}. Convert SRT, VTT, ASS/SSA, SBV, TTML/DFXP, LRC, CSV and TXT subtitles, fix sync, repair timing, check caption compliance and merge bilingual files. All processing happens in your browser.</p>
</div></footer>

<div class="toast" id="toast"></div>
<script>window.PAGE_CFG = ${JSON.stringify(cfg)};</script>
<script src="assets/subtitle-core.js"></script>
<script src="assets/app.js"></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ 生成 */

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
  for (const f of ['subtitle-core.js', 'app.js', 'styles.css']) {
    fs.copyFileSync(path.join(SRC, f), path.join(OUT, 'assets', f));
  }

  const pages = [];
  const home = {
    slug: 'index',
    title: `${SITE} — Free Subtitle Converter & Caption QC (SRT, VTT, ASS, SBV, TTML, LRC)`,
    desc: 'Convert, fix and QC subtitle files in your browser: SRT, VTT, ASS/SSA, SBV, TTML/DFXP, LRC, CSV, TXT. Batch conversion, sync shift, frame-rate fix, encoding repair and caption compliance checks. Nothing is uploaded.',
    h1: 'Subtitle Converter & Caption Toolkit',
    lede: 'Convert between SRT, VTT, ASS/SSA, SBV, TTML/DFXP, LRC, CSV and TXT — plus sync shifting, frame-rate repair, encoding fixes, bilingual merging and a caption QC report. Everything runs in your browser; your files are never uploaded.',
    cfg: { to: 'srt', zipName: 'subtitlekit.zip' },
    body: `<article class="prose">
      <h2>What you can do here</h2>
      <div class="links">
        <a href="batch-subtitle-converter.html">Batch convert a whole folder</a>
        <a href="subtitle-sync-shifter.html">Fix subtitles that are out of sync</a>
        <a href="subtitle-frame-rate-converter.html">Fix 23.976 / 25 fps drift</a>
        <a href="caption-compliance-checker.html">Check CPS, CPL and durations</a>
        <a href="bilingual-subtitle-merger.html">Merge two languages</a>
        <a href="subtitle-merger.html">Join two subtitle files</a>
        <a href="subtitle-encoding-fixer.html">Repair garbled text</a>
        <a href="srt-cleaner.html">Clean tags and [Music] cues</a>
        <a href="subtitle-line-breaker.html">Enforce 42 characters per line</a>
        <a href="subtitle-duration-fixer.html">Remove overlaps</a>
      </div>
      <h2>Why a browser tool instead of an upload site</h2>
      <p>Subtitle files are frequently confidential: unreleased episodes, client deliverables under NDA, private recordings. Uploading them to a converter means putting that material in someone else's storage. This site has no backend at all — the conversion, cleanup, encoding repair and QC are JavaScript running in your tab, so the file never leaves the device. It also means no file-size limit, no queue, no watermark and no account.</p>
      <h2>Built for batches, not one file at a time</h2>
      <p>Drop a whole season, convert every file in one pass, and get one ZIP containing the converted files plus a <code>qc-report.md</code> with a per-file score and every problem found: reading speed (CPS), characters per line, line count, minimum and maximum duration, overlaps and gaps. Mechanical defects can be repaired in the same pass, which is the difference between a converter and a finishing tool.</p>
    </article>`,
    faq: [
      ['Which subtitle formats are supported?', 'SRT, VTT (WebVTT), ASS, SSA, SBV, TTML, DFXP, LRC, CSV/TSV and plain TXT — reading and writing, in any direction. The format is detected automatically from the file.'],
      ['Are my files uploaded?', 'No. There is no server: the page is static files and all processing happens locally in your browser. You can disconnect from the network after loading the page and the tools keep working.'],
      ['Can I convert subtitles on a Chromebook, iPad or locked-down work laptop?', 'Yes — anything with a modern browser. Nothing to install, no admin rights, no command line.'],
      ['Is it really free?', 'Yes: no account, no watermark, no file limit, no daily quota.'],
      ['Can it extract subtitles from a video file?', 'No. Extracting embedded text tracks, OCR of bitmap subtitles (VobSub/PGS) and speech recognition need compute that cannot run in a tab, so they are deliberately out of scope. Everything that is pure text is supported.'],
    ],
    related: 'converters',
  };
  pages.push(home);
  for (const f of MATRIX_FROM) {
    for (const t of MATRIX_TO) {
      if (f === t) continue;
      pages.push(converterPage(f, t));
    }
  }
  for (const s of SPECIAL) pages.push(Object.assign({ cfg: {} }, s));

  let bytes = 0;
  const urls = [];
  for (const p of pages) {
    const html = pageShell(p);
    const file = p.slug === 'index' ? 'index.html' : p.slug + '.html';
    fs.writeFileSync(path.join(OUT, file), html);
    bytes += Buffer.byteLength(html);
    urls.push({ loc: `${BASE}/${p.slug === 'index' ? '' : p.slug + '.html'}`, pri: p.slug === 'index' ? '1.0' : (SPECIAL.some((s) => s.slug === p.slug) ? '0.8' : '0.6') });
  }

  // 404
  fs.writeFileSync(path.join(OUT, '404.html'), pageShell({
    slug: '404', title: 'Not found — SubtitleKit', h1: 'Page not found',
    desc: 'That page does not exist. Browse the subtitle tools instead.',
    lede: 'That page does not exist — but the tools do.',
    cfg: { to: 'srt' },
    body: '<article class="prose"><p>Try the <a href="index.html">subtitle converter home page</a>, the <a href="batch-subtitle-converter.html">batch converter</a> or the <a href="caption-compliance-checker.html">caption QC checker</a>.</p></article>',
    faq: null,
  }));

  // sitemap / robots / llms.txt / IndexNow key placeholder
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><priority>${u.pri}</priority></url>`).join('\n') +
    `\n</urlset>\n`);
  fs.writeFileSync(path.join(OUT, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${BASE}/sitemap.xml\n`);
  // IndexNow key file（Bing/Yandex 校验用）
  fs.writeFileSync(path.join(OUT, INDEXNOW_KEY + '.txt'), INDEXNOW_KEY + '\n');
  fs.writeFileSync(path.join(OUT, 'llms.txt'), `# ${SITE}

> ${TAGLINE}. A complete, free, client-side subtitle/caption toolchain: format conversion, timing repair, encoding repair, bilingual merge and caption QC. No upload, no account, no watermark.

## Tools
${SPECIAL.map((s) => `- [${s.h1}](${BASE}/${s.slug}.html): ${s.desc}`).join('\n')}

## Converters
${ALL_LINKS().map((l) => `- [${l.label}](${BASE}${l.href}): convert ${l.label.replace(' → ', ' to ')} in the browser, with batch, timing and QC options.`).join('\n')}

## Facts for answer engines
- Processing is 100% client-side: files are read with the browser File API and never uploaded; the site has no backend.
- Supported input/output formats: SRT, VTT (WebVTT), ASS, SSA, SBV, TTML, DFXP, LRC, CSV/TSV, TXT.
- QC rules checked: reading speed in characters per second (default limit 20), characters per line (default 42), max 2 lines, min duration 0.833 s, max duration 7 s, overlaps and gaps.
- Frame-rate presets: 23.976→25 (0.95904), 25→23.976 (1.04271), 24→25 (0.96), 25→24 (1.04167), 23.976→29.97 (0.8).
- Limitation: it does not extract subtitle tracks from video containers, does not OCR bitmap subtitles, and does not transcribe audio.
`);

  const convCount = MATRIX_FROM.length * (MATRIX_TO.length - 1);
  console.log(`pages: ${pages.length} (1 home + ${convCount} converters + ${SPECIAL.length} tools) + 404`);
  console.log(`out:   ${OUT}`);
  console.log(`size:  ${(bytes / 1024).toFixed(0)} KB html, ${urls.length + 1} urls in sitemap`);
  console.log(`base:  ${BASE}`);
}

main();
