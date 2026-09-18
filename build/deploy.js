#!/usr/bin/env node
/**
 * deploy.js — 把站点构建产物 + 源码一次性推到 GitHub Pages 仓库
 *
 *   node build/deploy.js [owner/repo] [--dry]
 *
 * 为什么不用 git push：github.com 的 443 在本机被重置，只能走 api.github.com。
 * 做法：为每个文件建 blob → 建 tree（不带 base_tree，等价于全量同步）→ 建 commit → 移动 main 引用。
 * Token 来源：$GH_TOKEN > $GITHUB_TOKEN > `git credential fill`（Windows 凭据管理器）。
 *
 * 仓库根 = 已构建好的静态站（GitHub Pages 从 main 分支根目录发布），
 * 同时带上 src/ build/ tests/ package.json，便于以后在任何机器上重建。
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'AiHarryone/subtitle-tools';
const DRY = process.argv.includes('--dry');

function token() {
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN']) if (process.env[k]) return process.env[k];
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', shell: true,
    });
    const m = out.match(/^password=(.+)$/m);
    if (m) return m[1].trim();
  } catch (e) { /* fallthrough */ }
  throw new Error('no GitHub token: set GH_TOKEN or run `git credential approve`');
}

const PAT = token();

function api(method, url, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: 'api.github.com', path: url, method,
      headers: {
        Authorization: 'Bearer ' + PAT,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'subtitle-tools-deploy',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let j; try { j = JSON.parse(d); } catch { j = d; }
        if (res.statusCode >= 400) reject(new Error(`${res.statusCode} ${(j && j.message) || d}`));
        else resolve(j);
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** 收集要提交的文件：dist/* 放根目录，源码放 src|build|tests，外加 README/package.json */
function collect() {
  const files = [];
  const add = (full, repoPath) => files.push({ repoPath, full });
  const walk = (dir, prefix) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const full = path.join(dir, ent.name);
      const rel = prefix ? prefix + '/' + ent.name : ent.name;
      if (ent.isDirectory()) walk(full, rel);
      else add(full, rel);
    }
  };
  walk(path.join(ROOT, 'dist'), '');
  for (const d of ['src', 'build', 'tests']) walk(path.join(ROOT, d), d);
  for (const f of ['README.md', 'package.json']) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) add(p, f);
  }
  // 不发布私有素材（如果以后加了）
  return files.filter((f) => !/\.(bak|log|zip|mp4|png)$/i.test(f.repoPath) || f.repoPath.startsWith('assets/'));
}

async function main() {
  const files = collect();
  if (!files.length) throw new Error('nothing to deploy — run `npm run build` first');
  console.log(`deploy ${files.length} files -> ${REPO}/main`);
  if (DRY) { console.log(files.map((f) => '  ' + f.repoPath).join('\n')); return; }

  const blobs = [];
  for (const f of files) {
    const b = await api('POST', `/repos/${REPO}/git/blobs`, {
      content: fs.readFileSync(f.full).toString('base64'), encoding: 'base64',
    });
    blobs.push({ path: f.repoPath, sha: b.sha, mode: '100644', type: 'blob' });
  }

  const tree = await api('POST', `/repos/${REPO}/git/trees`, { tree: blobs });
  let parent = null;
  try { parent = (await api('GET', `/repos/${REPO}/git/ref/heads/main`)).object.sha; } catch (e) { /* 空仓库 */ }
  const commit = await api('POST', `/repos/${REPO}/git/commits`, {
    message: `deploy: SubtitleKit site (${new Date().toISOString().slice(0, 16)}Z, ${blobs.length} files)`,
    tree: tree.sha, ...(parent ? { parents: [parent] } : {}),
  });
  if (parent) await api('PATCH', `/repos/${REPO}/git/refs/heads/main`, { sha: commit.sha, force: false });
  else await api('POST', `/repos/${REPO}/git/refs`, { ref: 'refs/heads/main', sha: commit.sha });
  console.log(`ok: ${commit.sha.slice(0, 8)} — https://aiharryone.github.io/subtitle-tools/`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
