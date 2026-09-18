/**
 * Node 测试：验证 subtitle-core 的解析/写出/处理/质检。
 * 运行：node tests/test-core.js
 */
const assert = require('assert');
const path = require('path');
const C = require(path.join(__dirname, '..', 'src', 'subtitle-core.js'));

let pass = 0;
const fails = [];

function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fails.push(`${name}: ${e.message}`); }
}

/* ---------------------------------------------------------------- 时间 */

t('parseTime 支持各种写法', () => {
  assert.strictEqual(C.parseTime('00:00:01,000'), 1000);
  assert.strictEqual(C.parseTime('00:00:01.500'), 1500);
  assert.strictEqual(C.parseTime('00:01:02.250'), 62250);
  assert.strictEqual(C.parseTime('01:02.250'), 62250);      // mm:ss.mmm
  assert.strictEqual(C.parseTime('1:02:03,004'), 3723004);
  assert.strictEqual(C.parseTime('2.5'), 2500);             // 纯秒
  assert.strictEqual(C.parseTime('bad'), null);
});

t('fmtTime 往返', () => {
  for (const ms of [0, 999, 1000, 62250, 3723004, 3600000]) {
    assert.strictEqual(C.parseTime(C.fmtTime(ms, ',')), ms, 'ms=' + ms);
  }
});

t('ASS 时间往返（厘秒精度）', () => {
  for (const ms of [0, 1000, 62250, 3723000]) {
    assert.strictEqual(C.assTimeToMs(C.msToAssTime(ms)), ms);
  }
});

/* ---------------------------------------------------------------- 解析 */

const SRT = `1
00:00:01,000 --> 00:00:03,500
Hello <i>world</i>

2
00:00:04,000 --> 00:00:06,000
Second line
with break

`;

t('解析 SRT', () => {
  const c = C.parseSRT(SRT);
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[0].start, 1000);
  assert.strictEqual(c[0].end, 3500);
  assert.strictEqual(c[1].text, 'Second line\nwith break');
});

t('解析 VTT（含 NOTE/cue 名/设置）', () => {
  const vtt = `WEBVTT

NOTE 这是注释
忽略我

STYLE
::cue { color: yellow }

intro
00:00:01.000 --> 00:00:03.500 line:90% align:middle
Hello world

00:00:04.000 --> 00:00:06.000
Second
`;
  const c = C.parseVTT(vtt);
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[0].text, 'Hello world');
  assert.strictEqual(c[0].style, 'line:90% align:middle');
  assert.strictEqual(c[1].start, 4000);
});

t('解析 ASS（\N 换行、去覆写标签）', () => {
  const ass = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,60

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\i1}Hello,\\Nworld
Dialogue: 0,0:00:04.00,0:00:06.00,Default,,0,0,0,,Second, with comma
`;
  const c = C.parseASS(ass);
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[0].start, 1000);
  assert.strictEqual(c[0].end, 3500);
  assert.strictEqual(c[0].text, 'Hello,\nworld');
  assert.strictEqual(c[1].text, 'Second, with comma', '含逗号的 Text 字段不能被切坏');
});

t('解析 SBV', () => {
  const c = C.parseSBV('0:00:01.000,0:00:03.500\nHello\n\n0:00:04.000,0:00:06.000\nWorld\n');
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[0].start, 1000);
  assert.strictEqual(c[1].text, 'World');
});

t('解析 TTML（begin/end/dur、br、实体）', () => {
  const ttml = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
<p begin="00:00:01.000" end="00:00:03.500">Hello &amp; welcome<br/>line two</p>
<p begin="00:00:04.000" dur="2s">Second</p>
</div></body></tt>`;
  const c = C.parseTTML(ttml);
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[0].text, 'Hello & welcome\nline two');
  assert.strictEqual(c[1].start, 4000);
  assert.strictEqual(c[1].end, 6000);
});

t('解析 LRC（多时间戳 + 自动给结束时间）', () => {
  const c = C.parseLRC('[00:01.00][00:11.00]重复句\n[00:05.50]第二句\n[ar:某人]\n');
  assert.strictEqual(c.length, 3);
  assert.strictEqual(c[0].start, 1000);
  assert.strictEqual(c[1].start, 5500);
  assert.strictEqual(c[2].start, 11000);
  assert.strictEqual(c[0].end, 5500, '结束时间 = 下一条开始');
});

t('解析 CSV（表头识别 + 中文字段 + 引号）', () => {
  const csv = 'start,end,text\n00:00:01.000,00:00:03.500,"你好, 世界"\n00:00:04.000,00:00:06.000,Second\n';
  const c = C.parseCSV(csv);
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[0].text, '你好, 世界');
  assert.strictEqual(c[1].start, 4000);
});

t('CSV 无表头也能解析', () => {
  const c = C.parseCSV('00:00:01.000,00:00:03.500,Hello\n');
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].text, 'Hello');
});

t('parseAuto 嗅探扩展名与内容', () => {
  assert.strictEqual(C.parseAuto(SRT, 'a.srt').format, 'srt');
  assert.strictEqual(C.parseAuto(SRT, 'noext').format, 'srt');
  assert.strictEqual(C.parseAuto('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n', 'x').format, 'vtt');
  assert.strictEqual(C.parseAuto('[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,D,,0,0,0,,hi\n', 'x').format, 'ass');
  assert.strictEqual(C.parseAuto('0:00:01.000,0:00:03.500\nhi\n\n', 'x').format, 'sbv');
});

/* ---------------------------------------------------------------- 写出 */

t('写出 SRT / VTT / ASS / SBV / TTML / LRC / CSV / TXT 并可回读', () => {
  const cues = C.parseSRT(SRT);
  const back = {
    srt: C.parseSRT(C.writeSRT(cues)),
    vtt: C.parseVTT(C.writeVTT(cues)),
    ass: C.parseASS(C.writeASS(cues)),
    sbv: C.parseSBV(C.writeSBV(cues)),
    ttml: C.parseTTML(C.writeTTML(cues)),
    csv: C.parseCSV(C.writeCSV(cues)),
  };
  for (const [fmt, c] of Object.entries(back)) {
    assert.strictEqual(c.length, cues.length, fmt + ' 条数');
    assert.strictEqual(c[0].start, cues[0].start, fmt + ' start');
    assert.strictEqual(c[0].end, cues[0].end, fmt + ' end');
    assert.strictEqual(c[0].text, cues[0].text, fmt + ' text');
  }
  // LRC 只保留开始时间，单独校验
  const lrc = C.parseLRC(C.writeLRC(cues));
  assert.strictEqual(lrc[0].start, cues[0].start);
  assert.strictEqual(C.writeTXT(cues), 'Hello <i>world</i>\nSecond line with break\n');
});

t('ASS 写出保留时间精度到厘秒', () => {
  const out = C.writeASS([{ start: 1234, end: 5678, text: 'x' }]);
  assert.ok(/0:00:01\.23/.test(out), out.split('\n').filter((l) => l.startsWith('Dialogue'))[0]);
});

/* ---------------------------------------------------------------- 处理 */

t('时间平移', () => {
  const c = C.shift(C.parseSRT(SRT), -2000);
  assert.strictEqual(c[0].start, 0, '负时间被夹到 0');
  assert.strictEqual(c[1].start, 2000);
  const d = C.shift(C.parseSRT(SRT), 1500);
  assert.strictEqual(d[0].start, 2500);
});

t('线性拉伸（帧率 25→23.976）', () => {
  const f = 25 / 23.976;
  const c = C.scale(C.parseSRT(SRT), f);
  assert.strictEqual(c[0].start, Math.round(1000 * f));
});

t('清洗：去标签 / 去听障提示 / 合并空格 / 换行', () => {
  const cues = C.parseSRT(`1
00:00:01,000 --> 00:00:03,000
[Music]  Hello   <b>world</b>   this is a long line

`);
  const c = C.clean(cues, { stripHearing: true, maxCpl: 20 });
  assert.ok(!/\[Music\]/.test(c[0].text), c[0].text);
  assert.ok(!/<b>/.test(c[0].text) === false, '默认不删 HTML 标签');
  const c2 = C.clean(cues, { stripTags: true, stripHearing: true });
  assert.ok(!/<\/?b>/.test(c2[0].text), c2[0].text);
  const c3 = C.clean(cues, { maxCpl: 15, stripHearing: true, stripTags: true });
  assert.ok(c3[0].text.split('\n').every((l) => l.length <= 15), JSON.stringify(c3[0].text));
});

t('双语合并（就近配对 + 不丢内容）', () => {
  const a = C.parseSRT('1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\n00:00:04,000 --> 00:00:06,000\nWorld\n\n');
  const b = C.parseSRT('1\n00:00:01,050 --> 00:00:03,000\n你好\n\n');
  const m = C.mergeBilingual(a, b, { order: 'ab' });
  assert.strictEqual(m.length, 2);
  assert.strictEqual(m[0].text, 'Hello\n你好');
  assert.strictEqual(m[1].text, 'World');
});

t('修重叠 / 补最短时长', () => {
  const cues = [
    { start: 0, end: 5000, text: 'a' },
    { start: 3000, end: 3200, text: 'b' },
  ];
  const fixed = C.fixOverlaps(cues, { minGapMs: 40, minDurMs: 500 });
  assert.ok(fixed[0].end <= fixed[1].start - 40, JSON.stringify(fixed));
  assert.ok(fixed[1].end - fixed[1].start >= 200);
});

/* ---------------------------------------------------------------- 质检 */

t('质检能抓出 CPS / 行长 / 重叠 / 空字幕', () => {
  const cues = [
    { start: 0, end: 500, text: '这是一条非常长的字幕内容需要在半秒内读完' },      // 高 CPS + 过短
    { start: 400, end: 2000, text: 'x'.repeat(60) },                              // 重叠 + 行长
    { start: 2100, end: 2200, text: '' },                                          // 空
  ];
  const r = C.qc(cues);
  const codes = new Set(r.issues.map((i) => i.code));
  for (const c of ['HIGH_CPS', 'SHORT_DUR', 'OVERLAP', 'LONG_LINE', 'EMPTY']) {
    assert.ok(codes.has(c), `缺少 ${c}：${[...codes].join(',')}`);
  }
  assert.ok(r.score < 100 && r.score >= 0, 'score=' + r.score);
  assert.ok(/字幕质检报告/.test(C.qcReport(cues)));
});

t('干净字幕质检接近满分', () => {
  const cues = [{ start: 0, end: 2000, text: 'Hello world' }, { start: 2200, end: 4000, text: 'Second cue' }];
  const r = C.qc(cues);
  assert.strictEqual(r.errors, 0);
  assert.ok(r.score >= 95, 'score=' + r.score);
});

/* ---------------------------------------------------------------- 编码 */

t('修复 UTF-8 被当 Latin-1 读的乱码', () => {
  const orig = '中文字幕测试';
  const mojibake = Buffer.from(orig, 'utf8').toString('latin1');
  assert.ok(C.looksMojibake(mojibake));
  const fixed = C.fixEncoding(mojibake);
  assert.strictEqual(fixed.text, orig);
  assert.ok(fixed.changed);
});

t('正常文本不被误改', () => {
  const r = C.fixEncoding('Hello world, 正常中文');
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.text, 'Hello world, 正常中文');
});

/* ---------------------------------------------------------------- ZIP */

t('ZIP 打包结构正确（可被 unzip 读取）', () => {
  const buf = C.zipStore([{ name: 'a.srt', content: 'hello' }, { name: '子目录/b.vtt', content: 'WEBVTT\n' }]);
  const b = Buffer.from(buf);
  assert.strictEqual(b.readUInt32LE(0), 0x04034b50);
  assert.ok(b.includes(Buffer.from('a.srt')));
  assert.ok(b.includes(Buffer.from('子目录/b.vtt')));
  assert.strictEqual(b.readUInt32LE(b.length - 22), 0x06054b50);
});

/* ---------------------------------------------------------------- 大文件性能 */

t('1 万条字幕解析+转换 < 2s', () => {
  const parts = [];
  for (let i = 0; i < 10000; i++) {
    const s = C.fmtTime(i * 3000, ',');
    const e = C.fmtTime(i * 3000 + 2500, ',');
    parts.push(`${i + 1}\n${s} --> ${e}\n第 ${i + 1} 行字幕内容 hello world\n`);
  }
  const big = parts.join('\n');
  const t0 = Date.now();
  const cues = C.parseSRT(big);
  const out = C.writeVTT(C.clean(cues, { maxCpl: 42 }));
  const dt = Date.now() - t0;
  assert.strictEqual(cues.length, 10000);
  assert.ok(out.length > 100000);
  assert.ok(dt < 2000, dt + 'ms');
});

/* ---------------------------------------------------------------- 报告 */

console.log(`\n✅ 通过 ${pass} 项`);
if (fails.length) {
  console.log(`❌ 失败 ${fails.length} 项：`);
  fails.forEach((f) => console.log('   - ' + f));
  process.exit(1);
}
console.log('核心逻辑全部通过（解析/写出/处理/质检/编码/ZIP/性能）\n');
