#!/usr/bin/env node
'use strict';
/**
 * check-oracles.cjs —— 判据检查的统一入口（纯程序）。
 *
 * 判据检查是三件事，缺一件就有一个方向的缺口看不见：
 *   ① 形式   这条判据写得合不合规范（字段、取值、层、锚点写法）   → check-oracle-format.cjs
 *   ② 关系   这条判据跟哪些判据绑在一起，索引是不是最新           → oracle-graph.cjs
 *   ③ 闭环   这条判据有没有人守（锚点真不真、通道在不在、缺口有主）→ check-oracle-closure.cjs
 *
 * 三个检查器各自也能单独跑（要单看一类信号时）。本入口只做三件事：
 * 依次调用、合并结果、给一个总账（有几条 P0、进度到哪一步）。
 * 它自己不解析判据，规则只在三个检查器里各写一份，避免两处口径漂移。
 *
 * 用法：
 *   node check-oracles.cjs [--root=<dir>] [--oracles=<dir>] [--requirements=<dir>]
 *        [--tests=<dirs>] [--expected=<files>] [--entries=<files>] [--exclude=<正则>]
 *        [--layer-dirs=90-journeys,91-seams] [--anchor-exts=.ets] [--test-exts=.ets]
 *        [--skip=format,graph,closure]
 *        [--strict] [--json] [--self-test]
 *
 * 退出码：0 = 报告；1 = --strict 且有 P0 命中；2 = 输入错误。
 * 只读（不写任何文件；索引由 oracle-graph.cjs --write 生成）。
 */

const fs = require('node:fs');
/**
 * 同步写 stdout。console.log 写管道是异步的，紧跟 process.exit() 会把没写完的输出丢掉
 * ——大 JSON（本仓判据库 100KB+）会从中途截断，消费方 JSON.parse 直接失败。用 fs.writeSync 才不会丢。
 */
function emit(s) { fs.writeSync(1, s); }
const path = require('node:path');
const cp = require('node:child_process');

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

const HERE = __dirname;
const ROOT = path.resolve(opt('root', process.cwd()));
const ORACLE_DIR = opt('oracles', 'docs/oracles');
const REQUIREMENTS_DIR = opt('requirements', 'docs/requirements');
const TEST_DIRS = opt('tests', 'entry/src/test,entry/src/ohosTest/ets/test,base,common');
const EXPECTED = opt('expected', '');
const ENTRIES = opt('entries', '');
const EXCLUDE = opt('exclude', '');
const LAYER_DIRS = opt('layer-dirs', '90-journeys,91-seams');
// 项目可声明自己的锚点/测试文件后缀（默认 `.ets`），转发给子检查器。
const ANCHOR_EXTS = opt('anchor-exts', '');
const TEST_EXTS = opt('test-exts', '');
const SKIP = new Set(opt('skip', '').split(',').map((s) => s.trim()).filter(Boolean));
const STRICT = flag('strict');
const AS_JSON = flag('json');

const PARTS = [
  { key: 'format', script: 'check-oracle-format.cjs', name: '① 形式', desc: '字段、取值、层、锚点写法、进度' },
  { key: 'graph', script: 'oracle-graph.cjs', name: '② 关系', desc: '判据之间的索引连接与反查' },
  { key: 'closure', script: 'check-oracle-closure.cjs', name: '③ 闭环', desc: '锚点真不真、通道在不在、缺口有没有主' },
];

function argsFor(key) {
  const a = [`--root=${ROOT}`, '--oracles=' + ORACLE_DIR, '--json'];
  if (ANCHOR_EXTS) a.push(`--anchor-exts=${ANCHOR_EXTS}`);
  if (key === 'format') a.push(`--layer-dirs=${LAYER_DIRS}`);
  if (key === 'closure') {
    if (TEST_EXTS) a.push(`--test-exts=${TEST_EXTS}`);
    a.push(`--tests=${TEST_DIRS}`);
    if (REQUIREMENTS_DIR) a.push(`--requirements=${REQUIREMENTS_DIR}`);
    if (EXPECTED) a.push(`--expected=${EXPECTED}`);
    if (ENTRIES) a.push(`--entries=${ENTRIES}`);
  }
  if (EXCLUDE) a.push(`--exclude=${EXCLUDE}`);
  return a;
}

/** 从子检查器的 JSON 里抽出「信号 → 条数」与「P0 条数」。各检查器的字段名不同，在这里归一。 */
function summarize(key, json) {
  const counts = {}; let p0 = 0;
  if (key === 'format') {
    for (const f of json.findings || []) {
      counts[f.code] = (counts[f.code] || 0) + 1;
      if (f.level === 'P0') p0 += 1;
    }
    return { counts, p0, progress: json.progress || null };
  }
  if (key === 'graph') {
    for (const f of json.findings || []) {
      counts[f.code] = (counts[f.code] || 0) + 1;
      if (f.level === 'P0') p0 += 1;
    }
    return { counts, p0, progress: null };
  }
  // closure：counts 是 {S1..S7: n}，findings 里带 level
  for (const [k, n] of Object.entries(json.counts || {})) counts[k] = n;
  for (const f of json.findings || []) if (f.level === 'P0') p0 += 1;
  const prog = (json.total != null) ? { total: json.total, closed: json.closed || 0 } : null;
  return { counts, p0, progress: prog };
}

function run() {
  const results = [];
  for (const p of PARTS) {
    if (SKIP.has(p.key)) { results.push({ ...p, skipped: true }); continue; }
    const script = path.join(HERE, p.script);
    if (!fs.existsSync(script)) { results.push({ ...p, error: `找不到 ${p.script}` }); continue; }
    const r = cp.spawnSync(process.execPath, [script, ...argsFor(p.key)], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status === 2) { results.push({ ...p, error: (r.stderr || '').trim().split('\n')[0] || '输入错误' }); continue; }
    let json = null;
    try { json = JSON.parse(r.stdout); } catch (e) { results.push({ ...p, error: `输出不是 JSON：${(r.stdout || r.stderr || '').slice(0, 200)}` }); continue; }
    results.push({ ...p, ...summarize(p.key, json) });
  }

  const totalP0 = results.reduce((s, r) => s + (r.p0 || 0), 0);
  const progress = results.find((r) => r.progress)?.progress || null;

  if (AS_JSON) {
    emit(JSON.stringify({ root: ROOT, oracles: ORACLE_DIR, parts: results, totalP0, progress }, null, 2) + '\n');
  } else {
    console.log(`判据检查总账（${path.relative(process.cwd(), path.join(ROOT, ORACLE_DIR)) || '.'}）\n`);
    for (const r of results) {
      if (r.skipped) { console.log(`${r.name} ${r.desc}\n    （已跳过）\n`); continue; }
      if (r.error) { console.log(`${r.name} ${r.desc}\n    ⚠️ 没跑成：${r.error}\n`); continue; }
      const items = Object.entries(r.counts).sort();
      const hit = items.filter(([, n]) => n > 0);
      console.log(`${r.name} ${r.desc}`);
      console.log(hit.length ? '    ' + hit.map(([k, n]) => `${k} ${n}`).join(' · ') : '    ✅ 无命中');
      console.log('');
    }
    if (progress) {
      const rate = progress.total ? ((progress.closed || 0) / progress.total * 100).toFixed(1) : '0';
      console.log(`进度：判据 ${progress.total} 条 · 状态 closed ${progress.closed || 0}（闭环率 ${rate}%）`);
    }
    console.log(`P0 合计 ${totalP0} 条${totalP0 ? '（必须清零，或写进明确不依赖它的后续范围并留移交依据）' : ' ✅'}`);
    if (results.some((r) => r.error)) console.log('有检查器没跑成，上面的总账不完整。');
  }

  if (STRICT && (totalP0 > 0 || results.some((r) => r.error))) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// 自测：三个检查器自测 + 模板实例必须能过形式化检查
// ---------------------------------------------------------------------------

function selfTest() {
  const os = require('node:os');
  const bad = [];
  for (const p of PARTS) {
    const r = cp.spawnSync(process.execPath, [path.join(HERE, p.script), '--self-test'], { encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${p.script} --self-test 失败：${(r.stdout || r.stderr || '').trim().split('\n').slice(-3).join(' / ')}`);
    else console.log(`  ${p.script} 自测通过`);
  }

  // 文档与工具互锁：templates.md 里「判据实例」的每个代码块，都要能过形式化检查。
  // 这一条防止模板和检查器各走各的——模板改了但检查器不认，或者检查器加了规则但模板没跟上。
  const tpl = path.join(HERE, '..', 'references', 'templates.md');
  if (!fs.existsSync(tpl)) {
    bad.push(`找不到模板文件 ${tpl}`);
  } else {
    const src = fs.readFileSync(tpl, 'utf8');
    const sec = src.split(/^##\s+判据实例/m)[1];
    if (!sec) {
      bad.push('templates.md 里没有「## 判据实例」小节——统一入口的自测靠它做文档与工具的互锁');
    } else {
      const blocks = [...sec.matchAll(/```markdown\n([\s\S]*?)```/g)].map((m) => m[1]);
      if (!blocks.length) bad.push('「判据实例」小节里没有 ```markdown 代码块');
      else {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-tpl-'));
        fs.mkdirSync(path.join(dir, 'docs/oracles/01-mod'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'docs/oracles/01-mod/oracles.md'), blocks.join('\n'));
        const r = cp.spawnSync(process.execPath, [path.join(HERE, 'check-oracle-format.cjs'), `--root=${dir}`, '--json'],
          { encoding: 'utf8' });
        try {
          const j = JSON.parse(r.stdout);
          if (j.findings.length) {
            const kinds = [...new Set(j.findings.map((f) => f.code))].join(',');
            bad.push(`模板实例没通过形式化检查（${j.findings.length} 处：${kinds}）—— 模板与检查器口径不一致`);
          } else {
            const ids = blocks.join('\n').match(/^#{1,6}\s+(?:[^\p{L}\p{N}\s]{1,4}\s*)?(O-[A-Z]+-\d+[A-Z]?)/gmu) || [];
            console.log(`  templates.md 的 ${blocks.length} 个代码块（${ids.length} 条判据）通过形式化检查`);
          }
        } catch (e) { bad.push('模板实例检查没能解析出 JSON'); }
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }

  if (bad.length) { console.error('自测失败：\n  ' + bad.join('\n  ')); process.exitCode = 1; return; }
  console.log('自测通过：三个检查器可用，模板实例与检查器口径一致。');
}

if (flag('self-test')) selfTest();
else run();
