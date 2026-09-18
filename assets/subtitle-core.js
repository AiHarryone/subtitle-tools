/**
 * subtitle-core.js — 字幕格式互转 + 质检内核（纯函数，零依赖）
 * 同时支持 Node（module.exports）与浏览器（globalThis.SubCore）。
 *
 * 支持读：srt / vtt / ass|ssa / sbv / ttml|dfxp|xml / lrc / csv / txt
 * 支持写：srt / vtt / ass / sbv / ttml / lrc / csv / txt
 *
 * 设计原则：
 *  1) 不丢数据：解析时保留原始样式标签与位置信息（能带就带）
 *  2) 时间用毫秒整数，避免浮点误差
 *  3) 所有函数纯函数，方便测试
 */
(function (root) {
  'use strict';

  const NL = /\r\n|\r|\n/;

  /* ---------------------------------------------------------------- 时间 */

  function parseTime(str) {
    // 支持 00:00:01,000 / 00:00:01.000 / 0:00:01.00 / 00:01.000 / 1:02:03:04 (frames 忽略)
    if (str == null) return null;
    const s = String(str).trim().replace(',', '.');
    const m = s.match(/^(?:(\d+):)?(?:(\d+):)?(\d+)(?:\.(\d{1,3}))?$/);
    if (!m) return null;
    // 用「从右往左」解释：最后一段永远是秒（可带小数）
    const parts = s.split(':');
    const sec = parseFloat(parts.pop());
    let h = 0, min = 0;
    if (parts.length === 2) { h = +parts[0]; min = +parts[1]; }
    else if (parts.length === 1) { min = +parts[0]; }
    else if (parts.length > 2) { return null; }
    if ([h, min, sec].some((v) => !isFinite(v))) return null;
    return Math.round(((h * 60 + min) * 60 + sec) * 1000);
  }

  function fmtTime(ms, sep) {
    ms = Math.max(0, Math.round(ms));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const f = ms % 1000;
    const p2 = (n) => String(n).padStart(2, '0');
    return `${p2(h)}:${p2(m)}:${p2(s)}${sep || ','}${String(f).padStart(3, '0')}`;
  }

  /* ---------------------------------------------------------------- 解析 */

  function cuesFromRows(rows) {
    // rows: [{start, end, text, style?}]
    return rows
      .filter((r) => r && r.start != null && r.end != null && isFinite(r.start))
      .map((r) => ({
        start: r.start,
        end: r.end == null || !isFinite(r.end) ? r.start : r.end,
        text: (r.text || '').replace(/\s+$/g, ''),
        style: r.style || null,            // VTT cue 设置（line:/align:/position:）
        assTags: r.assTags || null,        // ASS 覆写标签
        styleName: r.styleName || null,    // ASS 样式名
        layer: r.layer || null,
        raw: r.raw || null,
      }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
  }

  function parseSRT(text) {
    const blocks = String(text).replace(/^\uFEFF/, '').split(/\r?\n\r?\n+/);
    const rows = [];
    for (const b of blocks) {
      const lines = b.split(NL).filter((l) => l !== '');
      if (!lines.length) continue;
      let i = 0;
      if (/^\d+$/.test(lines[0].trim())) i = 1;
      const tl = lines[i] && lines[i].match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}|\d{1,2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}|\d{1,2}:\d{2}[,.]\d{1,3})/);
      if (!tl) continue;
      rows.push({
        start: parseTime(tl[1]),
        end: parseTime(tl[2]),
        text: lines.slice(i + 1).join('\n'),
      });
    }
    return cuesFromRows(rows);
  }

  function parseVTT(text) {
    let s = String(text).replace(/^\uFEFF/, '');
    // 去掉 WEBVTT 头与 NOTE/STYLE/REGION 块
    s = s.replace(/^WEBVTT[^\n]*\n/, '');
    s = s.replace(/(?:^|\n)(NOTE|STYLE|REGION)[^\n]*\n(?:[^\n]+\n)*/g, '\n');
    const blocks = s.split(/\r?\n\r?\n+/);
    const rows = [];
    for (const b of blocks) {
      const lines = b.split(NL).filter((l) => l !== '');
      if (!lines.length) continue;
      let i = 0;
      if (!/-->/.test(lines[0])) i = 1; // 有 cue 名
      const tl = lines[i] && lines[i].match(/([\d:.]+)\s*-->\s*([\d:.]+)(.*)$/);
      if (!tl) continue;
      const style = (tl[3] || '').trim() || null;
      rows.push({
        start: parseTime(tl[1]),
        end: parseTime(tl[2]),
        text: lines.slice(i + 1).join('\n').replace(/<\/?v[^>]*>/g, ''),
        style,
      });
    }
    return cuesFromRows(rows);
  }

  function assTimeToMs(t) {
    const m = String(t).trim().match(/^(\d+):(\d{2}):(\d{2})[.:](\d{1,2})$/);
    if (!m) return null;
    return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + Math.round(+m[4] * 10);
  }

  function msToAssTime(ms) {
    ms = Math.max(0, Math.round(ms));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${h}:${p2(m)}:${p2(s)}.${p2(cs)}`;
  }

  function parseASS(text) {
    const lines = String(text).replace(/^\uFEFF/, '').split(NL);
    let inEvents = false;
    let fields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    const rows = [];
    for (const line of lines) {
      const t = line.trim();
      if (/^\[events\]/i.test(t)) { inEvents = true; continue; }
      if (/^\[/.test(t)) { inEvents = false; continue; }
      if (!inEvents) continue;
      if (/^format\s*:/i.test(t)) {
        fields = t.slice(t.indexOf(':') + 1).split(',').map((x) => x.trim().toLowerCase());
        continue;
      }
      if (!/^dialogue\s*:/i.test(t)) continue;
      const body = t.slice(t.indexOf(':') + 1);
      // 按字段数切分，最后一段（text）保留逗号
      const parts = body.split(',');
      const n = fields.length;
      const vals = parts.slice(0, n - 1);
      vals.push(parts.slice(n - 1).join(','));
      const rec = {};
      fields.forEach((f, i) => { rec[f] = (vals[i] || '').trim(); });
      const start = assTimeToMs(rec.start);
      const end = assTimeToMs(rec.end);
      if (start == null) continue;
      // 去掉 ASS 覆写标签 {\...}，保留 \N 换行
      const raw = rec.text || '';
      const styleTags = (raw.match(/\{[^}]*\}/g) || []).join('');
      const plain = raw.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').replace(/\\h/g, ' ');
      rows.push({
        start, end, text: plain,
        assTags: styleTags || null,        // 仅 ASS 用：{\i1} 之类覆写标签
        styleName: rec.style || null,      // 仅 ASS 用：样式名
        layer: rec.layer || '0',
      });
    }
    return cuesFromRows(rows);
  }

  function parseSBV(text) {
    const blocks = String(text).replace(/^\uFEFF/, '').split(/\r?\n\r?\n+/);
    const rows = [];
    for (const b of blocks) {
      const lines = b.split(NL).filter((l) => l !== '');
      if (!lines.length) continue;
      const tl = lines[0].match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*,\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})/);
      if (!tl) continue;
      rows.push({ start: parseTime(tl[1]), end: parseTime(tl[2]), text: lines.slice(1).join('\n') });
    }
    return cuesFromRows(rows);
  }

  function parseTTML(text) {
    const doc = String(text).replace(/^\uFEFF/, '');
    const rows = [];
    const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    let m;
    while ((m = re.exec(doc))) {
      const attrs = m[1];
      const begin = (attrs.match(/\bbegin\s*=\s*"([^"]+)"/i) || [])[1];
      const end = (attrs.match(/\bend\s*=\s*"([^"]+)"/i) || [])[1];
      const dur = (attrs.match(/\bdur\s*=\s*"([^"]+)"/i) || [])[1];
      const start = ttmlTime(begin);
      let stop = ttmlTime(end);
      if (stop == null && dur != null) stop = start + (ttmlTime(dur) || 0);
      const body = m[2]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
      if (start == null) continue;
      rows.push({ start, end: stop, text: body });
    }
    return cuesFromRows(rows);
  }

  function ttmlTime(t) {
    if (t == null) return null;
    const s = String(t).trim();
    if (/^\d+(\.\d+)?(ms|s|m|h)$/.test(s)) {
      const v = parseFloat(s);
      const u = s.replace(/[\d.]/g, '');
      return Math.round(v * ({ ms: 1, s: 1000, m: 60000, h: 3600000 })[u]);
    }
    const ticks = s.match(/^(\d+):(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?$/);
    if (ticks) {
      const ms = (((+ticks[1] * 60 + +ticks[2]) * 60 + +ticks[3]) * 1000)
        + (ticks[4] ? +ticks[4] * (1000 / 25) : 0)
        + (ticks[5] ? Math.round(parseFloat('0.' + ticks[5]) * 1000) : 0);
      return Math.round(ms);
    }
    return null;
  }

  function parseLRC(text) {
    const rows = [];
    const lines = String(text).replace(/^\uFEFF/, '').split(NL);
    const stamps = [];
    const re = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
    const items = [];
    for (const line of lines) {
      stamps.length = 0;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(line))) stamps.push(m[0]);
      if (!stamps.length) continue;
      const body = line.replace(/\[[^\]]*\]/g, '').trim();
      if (!body) continue;
      for (const st of stamps) {
        const mm = st.match(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/);
        const sec = parseFloat(mm[2].replace(':', '.'));
        items.push({ start: Math.round((+mm[1] * 60 + sec) * 1000), text: body });
      }
    }
    items.sort((a, b) => a.start - b.start);
    for (let i = 0; i < items.length; i++) {
      const next = items[i + 1];
      const dur = next ? Math.max(800, next.start - items[i].start) : 3000;
      rows.push({ start: items[i].start, end: items[i].start + dur, text: items[i].text });
    }
    return cuesFromRows(rows);
  }

  function parseCSV(text) {
    const lines = String(text).replace(/^\uFEFF/, '').split(NL).filter((l) => l.trim() !== '');
    if (!lines.length) return [];
    const split = (l) => {
      const out = [];
      let cur = '', q = false;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (q) {
          if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; }
          else if (c === '"') q = false;
          else cur += c;
        } else if (c === '"') q = true;
        else if (c === ',' || c === '\t' || c === ';') { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out.map((x) => x.trim());
    };
    let header = split(lines[0]).map((h) => h.toLowerCase());
    let body = lines.slice(1);
    const looksHeader = header.some((h) => /start|begin|from|时间|time/.test(h));
    if (!looksHeader) {
      header = ['start', 'end', 'text'];
      body = lines;
    }
    const idx = (...names) => {
      for (const n of names) {
        const i = header.findIndex((h) => h === n || h.includes(n));
        if (i >= 0) return i;
      }
      return -1;
    };
    const iS = idx('start', 'begin', 'from', 'in', '开始', '时间');
    const iE = idx('end', 'stop', 'to', 'out', '结束');
    const iDur = idx('duration', 'dur', '时长');
    const iT = idx('text', 'subtitle', 'content', 'caption', 'line', '字幕', '内容');
    const rows = [];
    for (const l of body) {
      const c = split(l);
      if (!c.length) continue;
      const start = iS >= 0 ? parseTime(c[iS]) : null;
      let end = iE >= 0 ? parseTime(c[iE]) : null;
      if (end == null && iDur >= 0) end = (start || 0) + (parseTime(c[iDur]) || 0);
      const text = iT >= 0 ? (c[iT] || '') : c.slice(Math.max(iS, iE, iDur) + 1).join(' ');
      if (start == null) continue;
      rows.push({ start, end, text });
    }
    return cuesFromRows(rows);
  }

  function parseTXT(text) {
    // 裸文本：一行一句，按 2 秒/句均分（用于 txt→srt 场景）
    const lines = String(text).replace(/^\uFEFF/, '').split(NL).map((l) => l.trim()).filter(Boolean);
    const rows = [];
    let t = 0;
    for (const l of lines) {
      const dur = Math.max(1200, Math.min(6000, l.length * 90));
      rows.push({ start: t, end: t + dur, text: l });
      t += dur;
    }
    return cuesFromRows(rows);
  }

  const PARSERS = {
    srt: parseSRT,
    vtt: parseVTT,
    webvtt: parseVTT,
    ass: parseASS,
    ssa: parseASS,
    sbv: parseSBV,
    ttml: parseTTML,
    dfxp: parseTTML,
    xml: parseTTML,
    lrc: parseLRC,
    csv: parseCSV,
    tsv: parseCSV,
    txt: parseTXT,
  };

  function extOf(name) {
    const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function parse(text, format) {
    const f = String(format || '').toLowerCase().replace(/^\./, '');
    const fn = PARSERS[f];
    if (!fn) throw new Error('unsupported input format: ' + format);
    return fn(text);
  }

  function parseAuto(text, filename) {
    const ext = extOf(filename);
    if (PARSERS[ext]) return { format: ext, cues: PARSERS[ext](text) };
    // 嗅探
    const head = String(text).slice(0, 400);
    if (/^WEBVTT/.test(head)) return { format: 'vtt', cues: parseVTT(text) };
    if (/\[Script Info\]|\[Events\]/i.test(head)) return { format: 'ass', cues: parseASS(text) };
    if (/<tt\b|<\?xml/i.test(head)) return { format: 'ttml', cues: parseTTML(text) };
    if (/^\s*\[\d{1,3}:\d{1,2}/m.test(head)) return { format: 'lrc', cues: parseLRC(text) };
    if (/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(head)) {
      return /,/.test(head.slice(head.indexOf('-->'), head.indexOf('-->') + 20))
        ? { format: 'srt', cues: parseSRT(text) }
        : { format: 'vtt', cues: parseVTT(text) };
    }
    if (/^\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*,/m.test(head)) return { format: 'sbv', cues: parseSBV(text) };
    return { format: 'txt', cues: parseTXT(text) };
  }

  /* ---------------------------------------------------------------- 编码 */

  function looksMojibake(s) {
    // 典型 mojibake：大量 Ã Â ã å ä 与「æ ½」类组合
    const bad = (s.match(/[ÃÂãåäæ][\u0080-\u00BF\u2018-\u203A]/g) || []).length;
    const weird = (s.match(/[\uFFFD]/g) || []).length;
    return bad > 2 || weird > 0;
  }

  function decodeBytes(buf, encoding) {
    const dec = new TextDecoder(encoding || 'utf-8', { fatal: false });
    return dec.decode(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  }

  /**
   * 修复常见中文/日文乱码：
   *  - UTF-8 被当 Latin-1/CP1252 读 → 反向还原
   *  - 实际是 GBK/Shift-JIS → 直接用对应解码器
   */
  function fixEncoding(text) {
    if (!looksMojibake(text)) return { text, changed: false, how: 'none' };
    // 1) Latin-1 → bytes → UTF-8
    try {
      const bytes = new Uint8Array([...text].map((c) => c.charCodeAt(0) & 0xff));
      const utf8 = decodeBytes(bytes, 'utf-8');
      if (!looksMojibake(utf8) && !/\uFFFD/.test(utf8)) {
        return { text: utf8, changed: true, how: 'latin1->utf8' };
      }
      for (const enc of ['gbk', 'big5', 'shift_jis', 'euc-kr', 'windows-1251']) {
        try {
          const alt = decodeBytes(bytes, enc);
          if (!looksMojibake(alt) && !/\uFFFD/.test(alt)) {
            return { text: alt, changed: true, how: 'latin1->' + enc };
          }
        } catch (e) { /* 浏览器不支持该编码就跳过 */ }
      }
      // 2) 直接按 CJK 编码解释原始字节（文件本身就是 GBK 的情况）
    } catch (e) { /* ignore */ }
    return { text, changed: false, how: 'detected-but-unfixed' };
  }

  /* ---------------------------------------------------------------- 写出 */

  function writeSRT(cues) {
    return cues
      .map((c, i) => `${i + 1}\n${fmtTime(c.start, ',')} --> ${fmtTime(c.end, ',')}\n${c.text}`)
      .join('\n\n') + '\n';
  }

  function writeVTT(cues) {
    const head = 'WEBVTT\n\n';
    return head + cues
      .map((c, i) => {
        const st = c.style ? ' ' + c.style : '';
        return `${i + 1}\n${fmtTime(c.start, '.')} --> ${fmtTime(c.end, '.')}${st}\n${c.text}`;
      })
      .join('\n\n') + '\n';
  }

  function writeASS(cues, opts) {
    const o = opts || {};
    const head = `[Script Info]
Title: ${o.title || 'Exported'}
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: ${o.width || 1920}
PlayResY: ${o.height || 1080}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${o.font || 'Arial'},${o.fontSize || 60},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    const body = cues
      .map((c) => {
        // ASS → ASS 时保留原样式名与覆写标签（{\i1}、{\pos(...)} 等）
        const text = (c.assTags || '') + String(c.text).replace(/\n/g, '\\N');
        return `Dialogue: ${c.layer || 0},${msToAssTime(c.start)},${msToAssTime(c.end)},${c.styleName || 'Default'},,0,0,0,,${text}`;
      })
      .join('\n');
    return head + body + '\n';
  }

  function writeSBV(cues) {
    return cues
      .map((c) => `${fmtTime(c.start, ',')},${fmtTime(c.end, ',')}\n${c.text}`)
      .join('\n\n') + '\n';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function writeTTML(cues) {
    const body = cues
      .map((c) => `      <p begin="${fmtTime(c.start, '.').slice(0, -1)}" end="${fmtTime(c.end, '.').slice(0, -1)}">${esc(c.text).replace(/\n/g, '<br/>')}</p>`)
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xml:lang="en">
  <head><styling><style xml:id="s1" tts:fontSize="100%" tts:textAlign="center"/></styling></head>
  <body><div>
${body}
  </div></body>
</tt>
`;
  }

  function writeLRC(cues) {
    return cues
      .map((c) => {
        const ms = c.start;
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        const cs = Math.floor((ms % 1000) / 10);
        const p2 = (n) => String(n).padStart(2, '0');
        return `[${p2(m)}:${p2(s)}.${p2(cs)}]${String(c.text).replace(/\n/g, ' ')}`;
      })
      .join('\n') + '\n';
  }

  function csvCell(s) {
    s = String(s == null ? '' : s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function writeCSV(cues) {
    const head = 'start,end,duration,text';
    const rows = cues.map((c) => [fmtTime(c.start, '.'), fmtTime(c.end, '.'), fmtTime(c.end - c.start, '.'), csvCell(c.text.replace(/\n/g, ' '))].join(','));
    return [head, ...rows].join('\n') + '\n';
  }

  function writeTXT(cues) {
    return cues.map((c) => String(c.text).replace(/\n/g, ' ')).join('\n') + '\n';
  }

  const WRITERS = {
    srt: writeSRT,
    vtt: writeVTT,
    webvtt: writeVTT,
    ass: writeASS,
    ssa: writeASS,
    sbv: writeSBV,
    ttml: writeTTML,
    dfxp: writeTTML,
    lrc: writeLRC,
    csv: writeCSV,
    txt: writeTXT,
  };

  function write(cues, format, opts) {
    const f = String(format || '').toLowerCase().replace(/^\./, '');
    const fn = WRITERS[f];
    if (!fn) throw new Error('unsupported output format: ' + format);
    return fn(cues, opts);
  }

  /* ---------------------------------------------------------------- 处理 */

  function shift(cues, ms) {
    return cues
      .map((c) => ({ ...c, start: c.start + ms, end: c.end + ms }))
      .filter((c) => c.end > 0)
      .map((c) => ({ ...c, start: Math.max(0, c.start) }))
      .sort((a, b) => a.start - b.start);
  }

  /** 以第一个 cue 为锚点线性拉伸（修帧率错配，如 25→23.976） */
  function scale(cues, factor) {
    return cues.map((c) => ({ ...c, start: Math.round(c.start * factor), end: Math.round(c.end * factor) }));
  }

  function clean(cues, opts) {
    const o = Object.assign({ collapseSpaces: true, stripTags: false, stripHearing: false, trimEmpty: true, maxCpl: 0 }, opts);
    let out = cues.map((c) => {
      let t = c.text;
      if (o.stripTags) t = t.replace(/<\/?[a-z][^>]*>/gi, '');
      if (o.stripHearing) t = t.replace(/^\s*[[(][^\])]*[\])]\s*/gm, '');
      if (o.collapseSpaces) t = t.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n');
      if (o.maxCpl > 0) t = wrapLines(t, o.maxCpl);
      return { ...c, text: t.trim() };
    });
    if (o.trimEmpty) out = out.filter((c) => c.text !== '');
    return out;
  }

  function wrapLines(text, maxCpl) {
    return text
      .split('\n')
      .map((line) => {
        if (line.length <= maxCpl) return line;
        const words = line.split(/(\s+)/);
        const out = [];
        let cur = '';
        for (const w of words) {
          if ((cur + w).trim().length > maxCpl && cur.trim()) { out.push(cur.trim()); cur = w; }
          else cur += w;
        }
        if (cur.trim()) out.push(cur.trim());
        return out.join('\n');
      })
      .join('\n');
  }

  /** 双语合并：主字幕 A + 译文 B，按时间就近配对 */
  function mergeBilingual(a, b, opts) {
    const o = Object.assign({ toleranceMs: 900, order: 'ab' }, opts);
    const used = new Set();
    const out = a.map((ca) => {
      let best = -1, bestDiff = Infinity;
      b.forEach((cb, i) => {
        if (used.has(i)) return;
        const d = Math.abs(cb.start - ca.start);
        if (d < bestDiff) { bestDiff = d; best = i; }
      });
      let text = ca.text;
      if (best >= 0 && bestDiff <= o.toleranceMs) {
        used.add(best);
        text = o.order === 'ab' ? ca.text + '\n' + b[best].text : b[best].text + '\n' + ca.text;
      }
      return { ...ca, text };
    });
    // B 里没配上的，追加到末尾（避免丢内容）
    b.forEach((cb, i) => {
      if (!used.has(i)) out.push(cb);
    });
    return out.sort((x, y) => x.start - y.start);
  }

  /**
   * 顺序拼接多个字幕（分段字幕合成整片），可选每段之间留 gap 毫秒。
   */
  function concatCues(parts, opts) {
    const o = Object.assign({ gapMs: 0 }, opts);
    const out = [];
    let offset = 0;
    for (const cues of parts) {
      if (!cues || !cues.length) continue;
      const base = cues[0].start;
      const last = cues[cues.length - 1].end;
      for (const c of cues) {
        out.push({ ...c, start: c.start - base + offset, end: c.end - base + offset });
      }
      offset += (last - base) + o.gapMs;
    }
    return out.sort((a, b) => a.start - b.start);
  }

  function fixOverlaps(cues, opts) {
    const o = Object.assign({ minGapMs: 40, minDurMs: 500 }, opts);
    const out = cues.map((c) => ({ ...c }));
    for (let i = 0; i < out.length; i++) {
      if (out[i].end - out[i].start < o.minDurMs) out[i].end = out[i].start + o.minDurMs;
      const next = out[i + 1];
      if (next && out[i].end > next.start - o.minGapMs) {
        out[i].end = Math.max(out[i].start + 200, next.start - o.minGapMs);
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------- 质检 */

  /**
   * 字幕质检（对齐 Netflix/YouTube 常见规范）：
   *  - CPS: characters per second（阅读速度），成人上限 17–20，儿童 13–17
   *  - CPL: characters per line（每行字数），上限 42
   *  - 时长：最短 5/6 秒（Netflix）或 1 秒；最长 7 秒
   *  - 行数：最多 2 行
   *  - 重叠、间隔过短、空字幕
   */
  function qc(cues, opts) {
    const o = Object.assign({
      maxCps: 20, maxCpl: 42, maxLines: 2, maxDurMs: 7000,
      minDurMs: 833, minGapMs: 80, maxGapMs: 0, targetCps: 17,
    }, opts);
    const issues = [];
    const push = (i, level, code, msg) => issues.push({ index: i, level, code, msg });

    cues.forEach((c, i) => {
      const dur = (c.end - c.start) / 1000;
      const lines = c.text.split('\n');
      const chars = c.text.replace(/\s/g, '').length;
      const cps = dur > 0 ? chars / dur : 999;

      if (!c.text.trim()) push(i, 'error', 'EMPTY', '空字幕');
      if (dur <= 0) push(i, 'error', 'NEG_DUR', `时长 ≤ 0（${dur.toFixed(2)}s）`);
      if (dur > 0 && dur * 1000 < o.minDurMs) push(i, 'warn', 'SHORT_DUR', `时长偏短 ${dur.toFixed(2)}s（建议 ≥ ${(o.minDurMs / 1000).toFixed(2)}s）`);
      if (dur * 1000 > o.maxDurMs) push(i, 'warn', 'LONG_DUR', `时长偏长 ${dur.toFixed(1)}s（建议 ≤ ${o.maxDurMs / 1000}s）`);
      if (cps > o.maxCps) push(i, 'warn', 'HIGH_CPS', `阅读速度 ${cps.toFixed(1)} CPS 超限（≤ ${o.maxCps}）`);
      if (lines.length > o.maxLines) push(i, 'warn', 'TOO_MANY_LINES', `${lines.length} 行（建议 ≤ ${o.maxLines}）`);
      lines.forEach((l, li) => {
        if (l.length > o.maxCpl) push(i, 'warn', 'LONG_LINE', `第 ${li + 1} 行 ${l.length} 字符（建议 ≤ ${o.maxCpl}）`);
      });
      const next = cues[i + 1];
      if (next) {
        if (c.end > next.start) push(i, 'error', 'OVERLAP', `与下一条重叠 ${((c.end - next.start) / 1000).toFixed(2)}s`);
        else if ((next.start - c.end) < o.minGapMs) push(i, 'warn', 'TINY_GAP', `间隔仅 ${next.start - c.end}ms`);
        if (o.maxGapMs > 0 && (next.start - c.end) > o.maxGapMs) push(i, 'info', 'BIG_GAP', `间隔 ${((next.start - c.end) / 1000).toFixed(1)}s 偏大`);
      }
    });

    const errs = issues.filter((x) => x.level === 'error').length;
    const warns = issues.filter((x) => x.level === 'warn').length;
    const penalty = Math.min(1, (errs * 3 + warns) / Math.max(4, cues.length * 4));
    return {
      cues: cues.length,
      durationMs: cues.length ? cues[cues.length - 1].end - cues[0].start : 0,
      totalChars: cues.reduce((n, c) => n + c.text.replace(/\s/g, '').length, 0),
      errors: errs,
      warnings: warns,
      score: cues.length ? Math.round((1 - penalty) * 100) : 0,
      issues,
    };
  }

  function qcReport(cues, opts) {
    const r = qc(cues, opts);
    const head = [
      `# 字幕质检报告`,
      ``,
      `- 条目数：${r.cues}`,
      `- 总时长：${(r.durationMs / 1000).toFixed(1)}s`,
      `- 总字符：${r.totalChars}`,
      `- 平均每条：${r.cues ? (r.totalChars / r.cues).toFixed(1) : 0} 字`,
      `- 错误：${r.errors}　警告：${r.warnings}　**评分：${r.score}/100**`,
      ``,
    ];
    if (!r.issues.length) head.push('✅ 未发现问题。');
    else {
      head.push('| # | 级别 | 问题 | 说明 |', '|---|---|---|---|');
      r.issues.slice(0, 300).forEach((i) => head.push(`| ${i.index + 1} | ${i.level} | ${i.code} | ${i.msg} |`));
      if (r.issues.length > 300) head.push(`| … | | | 仅显示前 300 条，共 ${r.issues.length} 条 |`);
    }
    return head.join('\n') + '\n';
  }

  /* ---------------------------------------------------------------- ZIP */

  /** 极简 ZIP（store 模式，无压缩）——用于批量下载，避免引入依赖 */
  function zipStore(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const crcTable = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })();
    const crc32 = (bytes) => {
      let c = 0xffffffff;
      for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    files.forEach((f) => {
      const nameBytes = enc.encode(f.name);
      const data = typeof f.content === 'string' ? enc.encode(f.content) : f.content;
      const crc = crc32(data);
      const local = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true); // UTF-8 flag
      dv.setUint16(8, 0, true); // store
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      local.set(nameBytes, 30);
      chunks.push(local, data);

      const cd = new Uint8Array(46 + nameBytes.length);
      const dv2 = new DataView(cd.buffer);
      dv2.setUint32(0, 0x02014b50, true);
      dv2.setUint16(4, 20, true);
      dv2.setUint16(6, 20, true);
      dv2.setUint16(8, 0x0800, true);
      dv2.setUint16(10, 0, true);
      dv2.setUint32(16, crc, true);
      dv2.setUint32(20, data.length, true);
      dv2.setUint32(24, data.length, true);
      dv2.setUint16(28, nameBytes.length, true);
      dv2.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);
      offset += local.length + data.length;
    });
    const cdSize = central.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const dv3 = new DataView(end.buffer);
    dv3.setUint32(0, 0x06054b50, true);
    dv3.setUint16(8, files.length, true);
    dv3.setUint16(10, files.length, true);
    dv3.setUint32(12, cdSize, true);
    dv3.setUint32(16, offset, true);
    const all = [...chunks, ...central, end];
    const total = all.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    all.forEach((c) => { out.set(c, p); p += c.length; });
    return out;
  }

  /* ---------------------------------------------------------------- 导出 */

  const api = {
    // 时间
    parseTime, fmtTime, msToAssTime, assTimeToMs, ttmlTime,
    // 读
    parse, parseAuto, parseSRT, parseVTT, parseASS, parseSBV, parseTTML, parseLRC, parseCSV, parseTXT,
    // 写
    write, writeSRT, writeVTT, writeASS, writeSBV, writeTTML, writeLRC, writeCSV, writeTXT,
    // 处理
    shift, scale, clean, wrapLines, mergeBilingual, concatCues, fixOverlaps,
    // 质检
    qc, qcReport,
    // 编码
    fixEncoding, looksMojibake, decodeBytes,
    // 工具
    zipStore, extOf,
    FORMATS: Object.keys(PARSERS).filter((f) => f !== 'webvtt' && f !== 'ssa' && f !== 'dfxp' && f !== 'tsv' && f !== 'xml'),
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SubCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
