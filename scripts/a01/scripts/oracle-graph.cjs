#!/usr/bin/env node
'use strict';
/**
 * oracle-graph.cjs —— 判据之间的索引连接：建图、写索引、双向反查（通用版，纯程序）。
 *
 * 为什么需要它：
 *   判据不是一条条孤立的断言。改一条判据之前，必须能机械地找到「还有哪些判据跟它绑在一起」，
 *   否则漏改一处，两处判据就开始互相矛盾，而且没有任何程序会发现。
 *   光靠 grep 搜 ID 不够：关系有好几种（父子、上游需求、共用用例、共用承载件、互相引用），
 *   而且方向是双向的——A 引用了 B，改 B 时必须能从 B 找到 A。
 *
 * 本工具从判据文件里抽出节点与边，生成一份索引，并提供反向查询：
 *
 *   节点: 每条判据（ID、标题、位置、层、状态）
 *   边:   parent         `父判据:` 字段点名的判据
 *         upstream       上游需求 `R-XXX-NN`，以及 `J-xx` / `S-xx` / `契约 N` 标记
 *         mentions       本判据正文里提到的别的判据 ID（跨模块指路）
 *         shared-anchor  共用同一个测试锚点（同文件::describe 或同一个用例）
 *         shared-carrier 共用同一个承载件（同一个生产 `.ets` 文件）
 *         shared-batch   同一个 `接收批次`（同一位接收人领走的同一批）
 *
 * 用法：
 *   node oracle-graph.cjs [--root=<dir>] [--oracles=<dir>] [--out=<file>]
 *   node oracle-graph.cjs --write              # 生成索引文件
 *   node oracle-graph.cjs --check              # 索引是否最新（过期 exit 1）
 *   node oracle-graph.cjs --related=O-XXX-001  # 查这条判据的相关判据（双向）
 *   node oracle-graph.cjs --json [--write]
 *   node oracle-graph.cjs --self-test
 *
 * 检查项（G 系列）：
 *   G1 悬空引用    本判据点名的判据 ID 在现行判据库里不存在（区分：只存在于 `_legacy/` ⇒ 待迁移）
 *   G2 索引过期    索引文件与判据库不一致（`--check` 用）
 *   G3 父子成环    沿 `父判据` 走回自己
 *   G4 层序颠倒    父判据的层比子判据更低（单点 → 接缝 → 旅程 才是合法方向）
 *   G5 孤立判据    没有父判据、没有上游需求、也没有人引用它
 *
 * 退出码：0 = 报告；1 = `--check` 过期或 `--strict` 有 G1/G3；2 = 输入错误。
 * 只读（`--write` 除外，只写 `--out` 指定的那一个文件）。
 */

const fs = require('node:fs');
/**
 * 同步写 stdout。console.log 写管道是异步的，紧跟 process.exit() 会把没写完的输出丢掉
 * ——大 JSON（本仓判据库 100KB+）会从中途截断，消费方 JSON.parse 直接失败。用 fs.writeSync 才不会丢。
 */
function emit(s) { fs.writeSync(1, s); }
const path = require('node:path');

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

const ROOT = path.resolve(opt('root', process.cwd()));
const ORACLE_DIR = opt('oracles', 'docs/oracles');
const OUT = opt('out', path.join(ORACLE_DIR, '_ref-index.md'));
const WRITE = flag('write');
const CHECK = flag('check');
const AS_JSON = flag('json');
const STRICT = flag('strict');
const RELATED = opt('related', '');
const EXCLUDE = opt('exclude', '');
const LAYER_DIRS = opt('layer-dirs', '90-journeys,91-seams').split(',').map((s) => s.trim()).filter(Boolean);

const LAYER_RANK = { '单点': 0, '接缝': 1, '旅程': 2 };
const LAYER_ALIAS = { '旅程': '旅程', 'journey': '旅程', '接缝': '接缝', 'seam': '接缝', '单点': '单点', 'point': '单点', 'unit': '单点' };

const CHECKS = {
  G1: { level: 'P1', name: '悬空引用', desc: '点名的判据 ID 在现行判据库里不存在' },
  G2: { level: 'P1', name: '索引过期', desc: '索引文件与判据库不一致' },
  G3: { level: 'P0', name: '父子成环', desc: '沿「父判据」能走回自己' },
  G4: { level: 'P1', name: '层序颠倒', desc: '父判据的层比子判据更低' },
  G5: { level: 'P1', name: '孤立判据', desc: '没有父判据、没有上游需求、也没有人引用它' },
};

const HEADING_RE = /^(#{1,6})\s+(?:[^\p{L}\p{N}\s]{1,4}\s*)?(O-[A-Z]+-\d+[A-Z]?)(?![0-9A-Za-z-])\s*(.*)$/u;
const FIELD_RE = /^\s*[-*]\s*([^:：]{1,60})\s*[:：]\s*(.*)$/;
const ID_RE = /\bO-[A-Z]+-\d+[A-Z]?(?![0-9A-Za-z-])/g;
const REQ_RE = /\bR-[A-Z]+-\d+[A-Z]?(?![0-9A-Za-z-])/g;
const JOURNEY_RE = /\bJ-\d+[A-Z]?(?![0-9A-Za-z-])/g;
const SEAM_RE = /\bS-\d+[A-Z]?(?![0-9A-Za-z-])/g;
const ETS_RE = /[A-Za-z0-9_][A-Za-z0-9_./@-]*\.ets/g;

// 锚点后缀由项目声明（默认 `.ets`），与 check-oracle-format/closure 同一套口径。
// 承载件仍只看 `.ets`：承载件是生产文件，本项目的生产文件就是 ArkTS。
const ANCHOR_EXTS = (opt('anchor-exts', '.ets') || '.ets').split(',').map((s) => s.trim()).filter(Boolean);
const EXT_ALT = ANCHOR_EXTS.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const ANCHOR_FILE_SRC = `[A-Za-z0-9_./@-]+(?:${EXT_ALT})`;
const ANCHOR_TOKEN_RE = new RegExp(`^(${ANCHOR_FILE_SRC})(?:::(.*))?$`);
const STRUCT_LINE_RE = /^\s*(#{1,6}\s|>|\||<|---\s*$)/;

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['build', 'oh_modules', '.test', '.git'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, filter, out); continue; }
    if (filter(e.name)) out.push(full);
  }
  return out;
}

function parseFile(abs) {
  const rel = path.relative(ROOT, abs);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  const out = [];
  let cur = null;
  const flush = () => { if (cur) { out.push(cur); cur = null; } };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADING_RE);
    if (m) {
      flush();
      cur = { id: m[2], title: (m[3] || '').trim(), file: rel, line: i + 1, fields: new Map(), body: [] };
      continue;
    }
    if (!cur) continue;
    cur.body.push(lines[i]);
    const fm = lines[i].match(FIELD_RE);
    if (fm) {
      const k = fm[1].trim().replace(/[（(][^（()）]*[)）]\s*$/u, '').trim();
      const v = fm[2].trim();
      cur.fields.set(k, cur.fields.has(k) ? `${cur.fields.get(k)}\n${v}` : v);
    } else if (lines[i].trim() && cur.fields.size > 0 && !STRUCT_LINE_RE.test(lines[i])) {
      const last = [...cur.fields.keys()].pop();
      cur.fields.set(last, `${cur.fields.get(last)}\n${lines[i].trim()}`);
    }
  }
  flush();
  return out;
}

function layerOf(o) {
  for (const a of ['层级']) {
    if (!o.fields.has(a)) continue;
    const raw = o.fields.get(a).split('\n')[0].replace(/[[\]]/g, '').trim();
    const key = Object.keys(LAYER_ALIAS).find((k) => raw.startsWith(k) || raw.toLowerCase().startsWith(k));
    if (key) return LAYER_ALIAS[key];
  }
  const top = path.relative(path.join(ROOT, ORACLE_DIR), path.join(ROOT, o.file)).split(path.sep)[0];
  if (top === LAYER_DIRS[0]) return '旅程';
  if (top === LAYER_DIRS[1]) return '接缝';
  if (/^(\d{2}|[A-Za-z])/.test(top)) return '单点';
  return null;
}

function collectAll(re, text, into) {
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text || '')) !== null) into.add(m[0]);
  return into;
}

/** 拆锚点 token（与 check-oracle-format.cjs 同口径）。 */
const ANCHOR_START_RE = new RegExp(`^[\\s\x60]*((::)|(${ANCHOR_FILE_SRC})|(#))`);
function splitAnchorTokens(text) {
  const parts = []; let cur = '';
  const chars = [...(text || '')];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/[、,，;；\n]/.test(ch)) {
      const rest = chars.slice(i + 1).join('');
      if (ANCHOR_START_RE.test(rest)) { parts.push(cur); cur = ''; continue; }
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** 从锚点栏抽出 {file::describe, file::describe#case} 两级键。 */
function anchorsOf(o) {
  const keys = new Set(); const cases = new Set();
  let lastFile = '';
  for (const fn of ['测试', '待建测试', '待接线测试']) {
    if (!o.fields.has(fn)) continue;
    for (const tok of splitAnchorTokens(o.fields.get(fn))) {
      let s = tok.trim().replace(/^`|`$/g, '').replace(/^\[[^\]]{1,10}\]\s*/, '').replace(/^`|`$/g, '').trim();
      if (!s) continue;
      if (/^(真机走查|走查|人工走查)/.test(s)) continue;
      if (s.startsWith('::') && lastFile) s = lastFile + s;
      const m = s.match(ANCHOR_TOKEN_RE);
      if (!m) continue;
      lastFile = m[1];
      const rest = (m[2] || '').trim();
      if (!rest) { keys.add(m[1]); continue; }
      const hash = rest.indexOf('#');
      // 平铺用例没有 describe 层：同一用例的键就是「文件::用例名」，
      // 这样两条判据钉同一条 node:test 用例时仍能建出共用锚点关系。
      if (hash < 0) { keys.add(`${m[1]}::${rest}`); cases.add(`${m[1]}::${rest}`); continue; }
      const describe = rest.slice(0, hash).trim();
      const cname = rest.slice(hash + 1).trim();
      keys.add(`${m[1]}::${describe}`);
      if (cname) cases.add(`${m[1]}::${describe}#${cname}`);
    }
  }
  return { keys, cases };
}

function isTestFile(f) {
  return /(^|\/)(test|ohosTest)\//.test(f) || /Test\.ets$/.test(f) || /SpecTest\.ets$/.test(f);
}

// ---------------------------------------------------------------------------
// 建图
// ---------------------------------------------------------------------------

function build() {
  const dir = path.join(ROOT, ORACLE_DIR);
  const files = walk(dir, (n) => n.endsWith('.md') && !n.startsWith('_') && n !== 'README.md')
    .filter((f) => !path.relative(dir, f).split(path.sep).includes('_legacy'))
    .filter((f) => !(EXCLUDE && new RegExp(EXCLUDE).test(path.relative(ROOT, f))));
  const legacyIds = new Set();
  const files2 = walk(path.join(dir, '_legacy'), (n) => n.endsWith('.md'));
  for (const f of files2) for (const o of parseFile(f)) legacyIds.add(o.id);

  const nodes = new Map();
  for (const f of files.sort()) {
    for (const o of parseFile(f)) {
      if (nodes.has(o.id)) { nodes.get(o.id).duplicate = true; continue; }
      const block = o.body.join('\n');
      const { keys, cases } = anchorsOf(o);
      const carriers = new Set();
      for (const f2 of collectAll(ETS_RE, `${o.fields.get('来源') || ''}\n${o.fields.get('可观测点') || ''}\n${o.fields.get('测试') || ''}`, new Set())) {
        if (!isTestFile(f2)) carriers.add(f2);
      }
      const batch = (o.fields.get('归属') || '').match(/(?:接收批次|认领批次|批次)\s*[:=]\s*(\S+)/);
      nodes.set(o.id, {
        id: o.id, title: o.title, file: o.file, line: o.line, layer: layerOf(o),
        state: (o.fields.get('状态') || '').split('\n')[0].trim(),
        parents: [...collectAll(new RegExp(ID_RE.source, 'g'), o.fields.get('父判据') || '', new Set())].filter((x) => x !== o.id),
        requirements: [...collectAll(new RegExp(REQ_RE.source, 'g'), `${o.fields.get('上游') || ''}\n${o.fields.get('来源') || ''}`, new Set())],
        journeys: [...collectAll(new RegExp(JOURNEY_RE.source, 'g'), `${o.fields.get('上游') || ''}\n${o.fields.get('来源') || ''}`, new Set())],
        seams: [...collectAll(new RegExp(SEAM_RE.source, 'g'), `${o.fields.get('上游') || ''}\n${o.fields.get('来源') || ''}`, new Set())],
        mentions: [...collectAll(new RegExp(ID_RE.source, 'g'), block, new Set())].filter((x) => x !== o.id),
        anchorKeys: keys, anchorCases: cases, carriers: [...carriers],
        batch: batch ? batch[1] : '',
      });
    }
  }

  // 反向边
  const back = new Map();      // id → 谁引用我
  const childOf = new Map();   // id → 谁把我当父判据
  const byAnchorKey = new Map(); const byAnchorCase = new Map(); const byCarrier = new Map(); const byBatch = new Map();
  const addTo = (map, k, id) => { if (!k) return; if (!map.has(k)) map.set(k, new Set()); map.get(k).add(id); };
  for (const n of nodes.values()) {
    for (const m of n.mentions) addTo(back, m, n.id);
    for (const p of n.parents) addTo(childOf, p, n.id);
    for (const k of n.anchorKeys) addTo(byAnchorKey, k, n.id);
    for (const c of n.anchorCases) addTo(byAnchorCase, c, n.id);
    for (const c of n.carriers) addTo(byCarrier, c, n.id);
    addTo(byBatch, n.batch, n.id);
  }

  const siblingsOf = (map, keys, id) => {
    const s = new Set();
    for (const k of keys) for (const other of (map.get(k) || [])) if (other !== id) s.add(other);
    return [...s].sort();
  };

  const edges = { parent: [], mentions: [], sharedAnchor: [], sharedCarrier: [], sharedBatch: [] };
  for (const n of nodes.values()) {
    for (const p of n.parents) edges.parent.push([n.id, p]);
    for (const m of n.mentions) edges.mentions.push([n.id, m]);
    for (const s of siblingsOf(byAnchorKey, n.anchorKeys, n.id)) edges.sharedAnchor.push([n.id, s]);
    for (const s of siblingsOf(byCarrier, n.carriers, n.id)) edges.sharedCarrier.push([n.id, s]);
  }
  for (const [b, ids] of byBatch) {
    if (!b) continue;
    const arr = [...ids].sort();
    for (const a of arr) for (const c of arr) if (a !== c) edges.sharedBatch.push([a, c]);
  }

  return { nodes, back, childOf, byAnchorKey, byAnchorCase, byCarrier, byBatch, edges, legacyIds, files };
}

// ---------------------------------------------------------------------------
// 检查
// ---------------------------------------------------------------------------

function checkGraph(g) {
  const findings = [];
  const add = (code, id, msg) => findings.push({ code, level: CHECKS[code].level, id, msg });

  // G1 悬空引用
  for (const n of g.nodes.values()) {
    for (const ref of new Set([...n.mentions, ...n.parents])) {
      if (g.nodes.has(ref)) continue;
      add('G1', n.id, `引用了判据 ${ref}，现行判据库里没有它${g.legacyIds.has(ref) ? '（只存在于 _legacy/，属待迁移）' : ''}（${n.file}:${n.line}）`);
    }
  }

  // G3 父子成环
  for (const n of g.nodes.values()) {
    const seen = new Set([n.id]); let cur = n.id; let loop = false;
    for (let hop = 0; hop < 50; hop++) {
      const parents = (g.nodes.get(cur)?.parents || []);
      if (!parents.length) break;
      const nx = parents.find((p) => g.nodes.has(p));
      if (!nx) break;
      if (seen.has(nx)) { loop = true; break; }
      seen.add(nx); cur = nx;
    }
    if (loop) add('G3', n.id, `沿「父判据」走回自己：${[...seen].join(' → ')}`);
  }

  // G4 层序颠倒
  for (const n of g.nodes.values()) {
    for (const p of n.parents) {
      const pn = g.nodes.get(p);
      if (!pn || !pn.layer || !n.layer) continue;
      if (LAYER_RANK[pn.layer] < LAYER_RANK[n.layer]) add('G4', n.id, `父判据 ${p} 是${pn.layer}，比本条（${n.layer}）更低`);
    }
  }

  // G5 孤立判据
  for (const n of g.nodes.values()) {
    const referenced = (g.back.get(n.id) || new Set()).size > 0;
    const hasParent = n.parents.length > 0;
    const hasReq = n.requirements.length > 0 || n.journeys.length > 0 || n.seams.length > 0;
    if (!referenced && !hasParent && !hasReq) add('G5', n.id, `没有父判据、没有上游需求，也没有别的判据引用它（${n.file}:${n.line}）`);
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

function render(g) {
  const L = [];
  const ids = [...g.nodes.keys()].sort();
  L.push('# 判据关系索引');
  L.push('');
  L.push('> **本文件由脚本生成，不要手改。** 重新生成：`node <a01>/scripts/oracle-graph.cjs --write`');
  L.push('> 校验是否过期：`node <a01>/scripts/oracle-graph.cjs --check`');
  L.push('>');
  L.push('> 为什么需要它：判据之间是有关系的（父子、同需求、同用例、同承载件、互相引用）。');
  L.push('> 改一条判据前，先在这里查它牵动哪些判据；改完再查一次，确认没有漏改。');
  L.push('');
  L.push(`判据 ${ids.length} 条 · 关系边：父判据 ${g.edges.parent.length} · 正文引用 ${g.edges.mentions.length}`
    + ` · 共用锚点 ${g.edges.sharedAnchor.length} · 共用承载件 ${g.edges.sharedCarrier.length}`
    + ` · 同批次 ${g.edges.sharedBatch.length}`);
  L.push('');
  const findings = checkGraph(g);
  const byCode = {};
  for (const f of findings) byCode[f.code] = (byCode[f.code] || 0) + 1;
  L.push('## 关系检查');
  L.push('');
  L.push('| 检查 | 级别 | 命中 |');
  L.push('| --- | --- | ---: |');
  for (const code of Object.keys(CHECKS)) L.push(`| ${code} ${CHECKS[code].name} | ${CHECKS[code].level} | ${byCode[code] || 0} |`);
  L.push('');
  for (const code of ['G3', 'G4', 'G1', 'G5']) {
    const items = findings.filter((f) => f.code === code);
    if (!items.length) continue;
    L.push(`### ${code} ${CHECKS[code].name}（${items.length}）`);
    L.push('');
    for (const f of items.slice(0, 200)) L.push(`- ${f.msg}`);
    if (items.length > 200) L.push(`- … 还有 ${items.length - 200} 条`);
    L.push('');
  }
  L.push('## 逐条索引');
  L.push('');
  for (const id of ids) {
    const n = g.nodes.get(id);
    L.push(`### ${id} ${n.title}`.trimEnd());
    L.push(`- 位置: \`${n.file}:${n.line}\` · 层: ${n.layer || '未判定'} · 状态: ${n.state || '未填'}${n.duplicate ? ' · ⚠️ 重号' : ''}`);
    const parents = n.parents.filter((p) => g.nodes.has(p));
    const kids = [...(g.childOf.get(id) || [])].sort();
    const citedBy = [...(g.back.get(id) || [])].sort().filter((x) => x !== id);
    const cites = n.mentions.filter((x) => g.nodes.has(x));
    if (parents.length) L.push(`- 父判据: ${parents.join(' ')}`);
    if (kids.length) L.push(`- 子判据: ${kids.join(' ')}`);
    if (n.requirements.length) L.push(`- 上游需求: ${n.requirements.join(' ')}`);
    if (n.journeys.length) L.push(`- 所在旅程: ${n.journeys.join(' ')}`);
    if (n.seams.length) L.push(`- 所在接缝: ${n.seams.join(' ')}`);
    if (cites.length) L.push(`- 本判据引用: ${cites.join(' ')}`);
    if (citedBy.length) L.push(`- 引用了本判据: ${citedBy.join(' ')}`);
    const sib = [...(g.byAnchorKey.get([...n.anchorKeys][0]) || [])].filter((x) => x !== id).sort();
    const seen = new Set();
    for (const k of n.anchorKeys) for (const x of (g.byAnchorKey.get(k) || [])) if (x !== id) seen.add(x);
    if (seen.size) L.push(`- 共用锚点: ${[...seen].sort().join(' ')}`);
    const seenC = new Set();
    for (const k of n.carriers) for (const x of (g.byCarrier.get(k) || [])) if (x !== id) seenC.add(x);
    if (seenC.size) L.push(`- 共用承载件: ${[...seenC].sort().slice(0, 40).join(' ')}${seenC.size > 40 ? ` …(+${seenC.size - 40})` : ''}`);
    if (n.batch) {
      const same = [...(g.byBatch.get(n.batch) || [])].filter((x) => x !== id).sort();
      L.push(`- 同接收批次(${n.batch}): ${same.length} 条`);
    }
    L.push('');
  }
  return { text: L.join('\n') + '\n', findings };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main() {
  const g = build();
  if (!g.nodes.size) {
    console.error(`没有在 ${path.join(ROOT, ORACLE_DIR)} 找到判据`);
    process.exit(2);
  }

  if (RELATED) {
    const n = g.nodes.get(RELATED);
    if (!n) {
      console.error(`判据库里没有 ${RELATED}`);
      process.exit(2);
    }
    const parents = n.parents.filter((p) => g.nodes.has(p));
    const kids = [...(g.childOf.get(RELATED) || [])].sort();
    const citedBy = [...(g.back.get(RELATED) || [])].sort().filter((x) => x !== RELATED);
    const cites = n.mentions.filter((x) => g.nodes.has(x));
    const seen = new Set();
    for (const k of n.anchorKeys) for (const x of (g.byAnchorKey.get(k) || [])) if (x !== RELATED) seen.add(x);
    const seenC = new Set();
    for (const k of n.carriers) for (const x of (g.byCarrier.get(k) || [])) if (x !== RELATED) seenC.add(x);
    if (AS_JSON) {
      emit(JSON.stringify({
        id: RELATED, title: n.title, file: n.file, line: n.line, layer: n.layer, state: n.state,
        parents, children: kids, cites, citedBy, sharedAnchor: [...seen].sort(), sharedCarrier: [...seenC].sort(),
        requirements: n.requirements, journeys: n.journeys, seams: n.seams, batch: n.batch,
      }, null, 2) + '\n');
    } else {
      console.log(`${RELATED} ${n.title}`);
      console.log(`  位置: ${n.file}:${n.line} · 层: ${n.layer || '未判定'} · 状态: ${n.state || '未填'}`);
      console.log(`  父判据: ${parents.join(' ') || '无'}`);
      console.log(`  子判据: ${kids.join(' ') || '无'}`);
      console.log(`  上游需求: ${n.requirements.join(' ') || '无'}`);
      console.log(`  本判据引用: ${cites.join(' ') || '无'}`);
      console.log(`  引用了本判据: ${citedBy.join(' ') || '无'}`);
      console.log(`  共用锚点: ${[...seen].sort().join(' ') || '无'}`);
      console.log(`  共用承载件: ${[...seenC].sort().slice(0, 20).join(' ') || '无'}`);
    }
    return;
  }

  const { text, findings } = render(g);

  if (CHECK) {
    const abs = path.join(ROOT, OUT);
    if (!fs.existsSync(abs)) {
      console.error(`索引文件不存在: ${OUT}（先跑 --write）`);
      process.exitCode = 1;
      return;
    }
    if (fs.readFileSync(abs, 'utf8') !== text) {
      console.error(`${OUT} 已过期（判据库变了，索引没重生成）`);
      process.exitCode = 1;
      return;
    }
    console.log(`${OUT} 是最新的。`);
    return;
  }

  if (WRITE) {
    fs.mkdirSync(path.dirname(path.join(ROOT, OUT)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, OUT), text);
    console.log(`已写出 ${OUT}（${g.nodes.size} 条判据）`);
  }

  if (AS_JSON) {
    emit(JSON.stringify({
      root: ROOT, oracles: g.nodes.size, edges: Object.fromEntries(Object.entries(g.edges).map(([k, v]) => [k, v.length])),
      findings,
    }, null, 2) + '\n');
  } else if (!WRITE) {
    const byCode = {};
    for (const f of findings) byCode[f.code] = (byCode[f.code] || 0) + 1;
    console.log(`判据 ${g.nodes.size} 条 · 文件 ${g.files.length} 份`);
    console.log(`关系边: 父判据 ${g.edges.parent.length} · 正文引用 ${g.edges.mentions.length} · 共用锚点 ${g.edges.sharedAnchor.length} · 共用承载件 ${g.edges.sharedCarrier.length} · 同批次 ${g.edges.sharedBatch.length}\n`);
    for (const code of Object.keys(CHECKS)) {
      if (code === 'G2') continue;
      const n = byCode[code] || 0;
      console.log(`  ${n ? '❌' : '✅'} ${code} [${CHECKS[code].level}] ${CHECKS[code].name.padEnd(6)} ${String(n).padStart(5)}  ${CHECKS[code].desc}`);
    }
    const show = (code, n = 10) => {
      const items = findings.filter((f) => f.code === code);
      for (const f of items.slice(0, n)) console.log(`     ${f.msg}`);
      if (items.length > n) console.log(`     … 还有 ${items.length - n} 条`);
    };
    const g1 = findings.filter((f) => f.code === 'G1');
    if (g1.length) {
      const legacy = g1.filter((f) => f.msg.includes('_legacy')).length;
      console.log(`     G1 里 ${legacy} 条只存在于 _legacy/（待迁移），${g1.length - legacy} 条完全不存在（笔误或已删）`);
    }
    console.log('');
    for (const code of ['G3', 'G4', 'G1']) show(code);
    console.log(`\n查一条判据的相关判据: --related=<ID>`);
    console.log(`生成索引: --write（默认输出 ${OUT}）`);
  }

  if (STRICT && findings.some((f) => f.level === 'P0')) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// 自测
// ---------------------------------------------------------------------------

function selfTest() {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-graph-'));
  const O = path.join(dir, 'docs/oracles');
  fs.mkdirSync(path.join(O, '01-mod'), { recursive: true });
  fs.mkdirSync(path.join(O, '91-seams'), { recursive: true });
  fs.mkdirSync(path.join(O, '_legacy'), { recursive: true });
  fs.writeFileSync(path.join(O, '01-mod/oracles.md'), [
    '### O-AAA-001 子判据甲',
    '- 父判据: O-SSS-001',
    '- 上游: R-A-01',
    '- 测试: entry/src/test/A.ets::ASpec#用例一',
    '- 状态: closed',
    '- 不确定特征: none',
    '',
    '### O-AAA-002 互相引用的乙',
    '- 父判据: O-AAA-001',
    '- 上游: R-A-01',
    '- 备注: 与 O-AAA-001 配套，细则见 O-OLD-001',
    '- 测试: entry/src/test/A.ets::ASpec#用例一',
    '- 状态: closed',
    '- 不确定特征: none',
    '',
    '### O-AAA-003 孤立判据',
    '- 测试: entry/src/test/B.ets::BSpec#用例一',
    '- 状态: closed',
    '- 不确定特征: none',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(O, '91-seams/oracles.md'), [
    '### O-SSS-001 接缝判据',
    '- 父判据: O-AAA-001',   // 成环：AAA-001 → SSS-001 → AAA-001
    '- 上游: R-A-01',
    '- 测试: entry/src/test/A.ets::ASpec#用例一',
    '- 状态: closed',
    '- 不确定特征: none',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(O, '_legacy/old.md'), '### O-OLD-001 遗留判据\n');

  const run = (args) => require('node:child_process').spawnSync(process.execPath,
    [__filename, `--root=${dir}`, ...args], { encoding: 'utf8' });
  const bad = [];
  const j = JSON.parse(run(['--json']).stdout);
  const n = (code) => j.findings.filter((f) => f.code === code).length;
  const want = (label, got, min) => { if (got < min) bad.push(`${label} 期望 ≥${min}，实际 ${got}`); else console.log(`  ${label} = ${got}（期望 ≥${min}）`); };
  want('G1 悬空引用', n('G1'), 1);
  want('G3 父子成环', n('G3'), 1);
  want('G5 孤立判据', n('G5'), 1);

  const w = run(['--write']);
  if (w.status !== 0) bad.push(`--write 失败: ${w.stderr}`);
  const c1 = run(['--check']);
  if (c1.status !== 0) bad.push(`--check 首次应为最新，实际 exit ${c1.status}`);
  fs.appendFileSync(path.join(O, '01-mod/oracles.md'), '\n### O-AAA-004 新加的\n- 状态: closed\n');
  const c2 = run(['--check']);
  if (c2.status !== 1) bad.push(`判据变了之后 --check 应 exit 1，实际 ${c2.status}`);
  const rel = JSON.parse(run(['--json', '--related=O-AAA-001']).stdout);
  if (!rel.children.includes('O-AAA-002')) bad.push(`--related 子判据缺 O-AAA-002: ${JSON.stringify(rel.children)}`);
  if (!rel.sharedAnchor.includes('O-AAA-002')) bad.push(`--related 共用锚点缺 O-AAA-002`);
  if (!rel.citedBy.includes('O-AAA-002')) bad.push(`--related 反查「谁引用我」缺 O-AAA-002`);

  fs.rmSync(dir, { recursive: true, force: true });
  if (bad.length) { console.error('自测失败：\n  ' + bad.join('\n  ')); process.exitCode = 1; }
  console.log('自测通过。');
  process.exitCode = 0;
}

if (flag('self-test')) selfTest();
else main();
