/* app.js — 字幕工具台 UI 逻辑（100% 浏览器本地运行，不上传任何文件） */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const S = window.SubCore;
  const CFG = window.PAGE_CFG || {};

  const state = {
    files: [],       // {file, name, size, text, from, cues, out, result, qc}
    second: null,    // 双语合并用的第二组文件
    busy: false,
  };

  const EXTS = ['srt', 'vtt', 'ass', 'ssa', 'sbv', 'ttml', 'dfxp', 'xml', 'lrc', 'csv', 'tsv', 'txt'];

  /* ------------------------------------------------------------ 工具 */

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function toast(msg, ok) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (ok ? ' ok' : '');
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.className = 'toast'; }, 3200);
  }

  /* ------------------------------------------------------------ 读取文件 */

  async function readFile(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    // 编码探测：先按 UTF-8 解，失败/乱码再尝试 GBK、Big5、Shift-JIS
    let text = S.decodeBytes(buf, 'utf-8');
    const encSel = $('#opt-encoding') && $('#opt-encoding').value;
    if (encSel && encSel !== 'auto') {
      try { text = S.decodeBytes(buf, encSel); } catch (e) { /* 保持 utf-8 */ }
    } else if (/[\uFFFD]/.test(text)) {
      for (const enc of ['gbk', 'big5', 'shift_jis', 'windows-1251', 'windows-1252']) {
        try {
          const alt = S.decodeBytes(buf, enc);
          if (!/[\uFFFD]/.test(alt)) { text = alt; break; }
        } catch (e) { /* 跳过不支持的编码 */ }
      }
    }
    return text;
  }

  async function addFiles(fileList, target) {
    const files = Array.from(fileList).filter((f) => {
      const e = S.extOf(f.name);
      return EXTS.includes(e) || f.size < 5 * 1024 * 1024;
    });
    if (!files.length) { toast('No subtitle files recognised'); return; }
    for (const f of files) {
      const item = { file: f, name: f.name, size: f.size, status: 'reading' };
      (target || state.files).push(item);
    }
    render();
    for (const item of state.files.concat(state.second || [])) {
      if (item.status !== 'reading') continue;
      try {
        item.text = await readFile(item.file);
        const p = S.parseAuto(item.text, item.name);
        item.from = p.format;
        item.cues = p.cues;
        item.status = 'ready';
      } catch (e) {
        item.status = 'error';
        item.error = String(e.message || e);
      }
    }
    render();
    if (!CFG.autoRun) toast(files.length + ' file(s) read — press Convert', true);
  }

  /* ------------------------------------------------------------ 转换 */

  function opts() {
    const o = {};
    const target = $('#target-format').value;
    o.target = target;
    o.shiftSec = parseFloat($('#opt-shift').value || '0') || 0;
    o.scale = parseFloat($('#opt-scale').value || '1') || 1;
    o.clean = $('#opt-clean').checked;
    o.stripTags = $('#opt-striptags').checked;
    o.stripHearing = $('#opt-hearing').checked;
    o.maxCpl = parseInt($('#opt-maxcpl').value || '0', 10) || 0;
    o.fixOverlaps = $('#opt-overlaps').checked;
    o.mergeSecond = $('#opt-merge').checked && (state.second || []).length > 0;
    o.mergeMode = ($('#opt-mergemode') || {}).value || 'pair';
    o.mergeOrder = $('#opt-mergeorder').value;
    o.qc = $('#opt-qc').checked;
    o.outNameSuffix = $('#opt-suffix').value || '';
    o.assFont = $('#opt-assfont') ? $('#opt-assfont').value : 'Arial';
    o.assSize = parseInt(($('#opt-asssize') || {}).value || '60', 10);
    return o;
  }

  function convertOne(item, o, secondCues) {
    let cues = item.cues.map((c) => ({ ...c }));
    const second = o.mergeSecond && secondCues && secondCues.length ? secondCues.map((c) => ({ ...c })) : null;
    const secondScaled = second && o.scale && o.scale !== 1 ? S.scale(second, o.scale) : second;
    if (o.mergeSecond && second && o.mergeMode === 'concat') {
      // 顺序拼接：先把两组时间各自归零再首尾相接（拉伸在后面统一做一次，避免重复缩放）
      cues = S.concatCues([cues, second], { gapMs: 200 });
    }
    if (o.scale && o.scale !== 1) cues = S.scale(cues, o.scale);
    if (o.shiftSec) cues = S.shift(cues, Math.round(o.shiftSec * 1000));
    if (o.clean) {
      cues = S.clean(cues, {
        stripTags: o.stripTags, stripHearing: o.stripHearing,
        collapseSpaces: true, maxCpl: o.maxCpl, trimEmpty: true,
      });
    }
    if (o.fixOverlaps) cues = S.fixOverlaps(cues);
    if (o.mergeSecond && secondScaled && o.mergeMode !== 'concat') {
      const shifted = o.shiftSec ? S.shift(secondScaled, Math.round(o.shiftSec * 1000)) : secondScaled;
      cues = S.mergeBilingual(cues, shifted, { order: o.mergeOrder });
    }
    cues = cues.sort((a, b) => a.start - b.start);
    const out = S.write(cues, o.target, { font: o.assFont, fontSize: o.assSize });
    const report = o.qc ? S.qc(cues) : null;
    return { cues, out, report };
  }

  function baseName(name) {
    return String(name).replace(/\.[a-z0-9]+$/i, '');
  }

  function run() {
    const o = opts();
    const targets = state.files.filter((f) => f.status === 'ready');
    if (!targets.length) { toast('Add a subtitle file first'); return; }
    const secondCues = o.mergeSecond ? S.clean((state.second[0] || {}).cues || [], {}) : null;
    let ok = 0;
    for (const item of targets) {
      try {
        const r = convertOne(item, o, secondCues);
        item.cuesOut = r.cues;
        item.out = r.out;
        item.report = r.report;
        item.outName = baseName(item.name) + (o.outNameSuffix || '') + '.' + o.target;
        item.status = 'done';
        ok++;
      } catch (e) {
        item.status = 'error';
        item.error = String(e.message || e);
      }
    }
    render();
    toast(`Converted ${ok}/${targets.length} file(s)`, true);
    if (!state.files.some((f) => f.status === 'done')) return;
  }

  function download(name, content, mime) {
    const blob = content instanceof Uint8Array
      ? new Blob([content], { type: mime || 'application/octet-stream' })
      : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  function downloadZip() {
    const done = state.files.filter((f) => f.status === 'done');
    if (!done.length) { toast('Nothing to download yet'); return; }
    const report = buildReport(done);
    const files = done.map((f) => ({ name: f.outName, content: f.out }));
    if (report) files.push({ name: 'qc-report.md', content: report });
    const zip = S.zipStore(files);
    download(CFG.zipName || 'subtitles-converted.zip', zip, 'application/zip');
  }

  function buildReport(done) {
    const withQc = done.filter((f) => f.report);
    if (!withQc.length) return null;
    const lines = ['# Subtitle QC report', '', `Generated: ${new Date().toISOString()}`, '', '| File | Cues | Duration | Errors | Warnings | Score |', '|---|---|---|---|---|---|'];
    for (const f of withQc) {
      const r = f.report;
      lines.push(`| ${f.outName} | ${r.cues} | ${(r.durationMs / 1000).toFixed(1)}s | ${r.errors} | ${r.warnings} | ${r.score}/100 |`);
    }
    for (const f of withQc) {
      if (!f.report.issues.length) continue;
      lines.push('', `## ${f.outName}`, '', '| # | Level | Issue | Detail |', '|---|---|---|---|');
      f.report.issues.slice(0, 200).forEach((i) => lines.push(`| ${i.index + 1} | ${i.level} | ${i.code} | ${i.msg} |`));
    }
    return lines.join('\n') + '\n';
  }

  /* ------------------------------------------------------------ 渲染 */

  function render() {
    const list = $('#filelist');
    list.innerHTML = '';
    const total = state.files.length;
    $('#count').textContent = total ? `${total} file${total > 1 ? 's' : ''}` : '';
    if (!total) {
      list.appendChild(el('div', 'empty', 'Drop subtitle files here, or click to choose.<br><span>SRT · VTT · ASS/SSA · SBV · TTML/DFXP · LRC · CSV · TXT</span>'));
    }
    state.files.forEach((f, i) => {
      const card = el('div', 'card ' + f.status);
      const head = el('div', 'card-head');
      head.appendChild(el('div', 'fname', `<b>${f.name}</b><span class="meta">${fmtSize(f.size)}${f.from ? ' · detected ' + f.from.toUpperCase() : ''}${f.cues ? ' · ' + f.cues.length + ' cues' : ''}</span>`));
      const tools = el('div', 'tools');
      if (f.status === 'done') {
        const r = f.report;
        if (r) {
          const sc = el('span', 'score ' + (r.score >= 90 ? 'good' : r.score >= 70 ? 'mid' : 'bad'), `QC ${r.score}`);
          sc.title = `${r.errors} errors / ${r.warnings} warnings`;
          tools.appendChild(sc);
        }
        const b = el('button', 'btn small', 'Download');
        b.onclick = () => download(f.outName, f.out);
        tools.appendChild(b);
      }
      if (f.status === 'error') tools.appendChild(el('span', 'err', '⚠ ' + (f.error || 'parse failed')));
      if (f.status === 'reading') tools.appendChild(el('span', 'meta', 'reading…'));
      const del = el('button', 'btn ghost small', '✕');
      del.title = 'Remove';
      del.onclick = () => { state.files.splice(i, 1); render(); };
      tools.appendChild(del);
      head.appendChild(tools);
      card.appendChild(head);

      if (f.status === 'done' && f.report && f.report.issues.length) {
        const det = el('details', 'issues');
        det.appendChild(el('summary', null, `${f.report.issues.length} QC issue${f.report.issues.length > 1 ? 's' : ''}`));
        const ul = el('ul');
        f.report.issues.slice(0, 60).forEach((is) => {
          ul.appendChild(el('li', is.level, `<span class="idx">#${is.index + 1}</span> <span class="code">${is.code}</span> ${is.msg}`));
        });
        if (f.report.issues.length > 60) ul.appendChild(el('li', 'more', `… ${f.report.issues.length - 60} more (see qc-report.md in the ZIP)`));
        det.appendChild(ul);
        card.appendChild(det);
      }
      if (f.status === 'done' && f.cuesOut && f.cuesOut.length) {
        const prev = el('details', 'preview');
        prev.appendChild(el('summary', null, 'Preview first cues'));
        const pre = el('pre', null, f.cuesOut.slice(0, 3).map((c) =>
          `${S.fmtTime(c.start, ',')} --> ${S.fmtTime(c.end, ',')}\n${c.text}`).join('\n\n'));
        prev.appendChild(pre);
        card.appendChild(prev);
      }
      list.appendChild(card);
    });

    const sec = state.second || [];
    const secBox = $('#secondbox');
    if (secBox) {
      secBox.style.display = $('#opt-merge') && $('#opt-merge').checked ? 'block' : 'none';
      $('#secondlist').innerHTML = sec.length
        ? sec.map((f) => `<span class="chip">${f.name} ${f.cues ? '· ' + f.cues.length + ' cues' : '· …'}</span>`).join('')
        : '<span class="meta">No translation file selected yet.</span>';
    }

    const ready = state.files.filter((f) => f.status === 'ready').length;
    const done = state.files.filter((f) => f.status === 'done').length;
    $('#run').disabled = !ready && !done;
    $('#run').textContent = ready ? `Convert ${ready} file${ready > 1 ? 's' : ''}` : 'Convert';
    $('#download-all').disabled = !done;
    $('#clear').style.display = state.files.length ? 'inline-flex' : 'none';
  }

  /* ------------------------------------------------------------ 事件 */

  function init() {
    const dz = $('#drop');
    const input = $('#file');
    dz.onclick = () => input.click();
    input.onchange = () => addFiles(input.files);
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', (e) => {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      if (e.target.closest && e.target.closest('#drop')) return;
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length && !state.files.length) addFiles(e.dataTransfer.files);
    });

    const sin = $('#secondfile');
    if (sin) {
      sin.onchange = async () => {
        state.second = [];
        await addFiles(sin.files, state.second);
        render();
      };
    }

    if (CFG.from) {
      const sel = $('#target-format');
      if (sel && CFG.to) sel.value = CFG.to;
    }

    $$('.preset').forEach((b) => {
      b.onclick = () => {
        const val = b.dataset.shift;
        if (val != null) { $('#opt-shift').value = val; }
        const sc = b.dataset.scale;
        if (sc != null) { $('#opt-scale').value = sc; }
        render();
      };
    });
    $$('.fmtbtn').forEach((b) => {
      b.onclick = () => {
        $('#target-format').value = b.dataset.to;
        $$('.fmtbtn').forEach((x) => x.classList.toggle('active', x === b));
        if (state.files.length && !CFG.noAutoRun) run();
      };
    });
    const ms = $('#opt-merge');
    if (ms) ms.onchange = render;

    $('#run').onclick = run;
    $('#download-all').onclick = downloadZip;
    $('#clear').onclick = () => { state.files = []; if (state.second) state.second = []; render(); };
    $('#report-only').onclick = () => {
      const done = state.files.filter((f) => f.status === 'done');
      if (!done.length) {
        // 允许不转换直接质检
        const ready = state.files.filter((f) => f.status === 'ready');
        if (!ready.length) { toast('Add a subtitle file first'); return; }
        const lines = ['# Subtitle QC report', '', `Generated: ${new Date().toISOString()}`, ''];
        for (const f of ready) {
          const r = S.qc(f.cues);
          lines.push(`## ${f.name}`, '', `- Cues: ${r.cues}`, `- Duration: ${(r.durationMs / 1000).toFixed(1)}s`,
            `- Errors: ${r.errors}`, `- Warnings: ${r.warnings}`, `- Score: ${r.score}/100`, '');
          if (r.issues.length) {
            lines.push('| # | Level | Issue | Detail |', '|---|---|---|---|');
            r.issues.slice(0, 200).forEach((i) => lines.push(`| ${i.index + 1} | ${i.level} | ${i.code} | ${i.msg} |`));
            lines.push('');
          }
        }
        download('qc-report.md', lines.join('\n') + '\n');
        return;
      }
      download('qc-report.md', buildReport(done));
    };

    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
