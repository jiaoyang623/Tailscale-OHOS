#!/usr/bin/env node
'use strict';
/**
 * check-oracle-format.cjs —— 判据「形式化」检查器 + 进度统计（通用版，纯程序）。
 *
 * 为什么需要它：
 *   判据不只是给人读的文档。它要能被程序批量检查，才能回答两个问题——
 *   「这条判据写得合不合规范」和「这个项目做到哪一步了」。
 *   只靠 AI 读文档，结论不可复现、不可回归、也不能进 CI。
 *
 * 本工具做两件事：
 *   一、逐条检查判据的形式合规（F 系列，每条给 `文件:行` 与命中片段）
 *   二、出进度统计（P 系列：按层 / 按状态 / 按模块 / 闭环率）
 *
 * 检查项（F 系列）：
 *   F1  重号            同一个 ID 被定义两次（一个编号指两件事）
 *   F2  标题形式        标题层级与 ID 写法不合规范（默认要求 `### O-XXX-NNN 标题`）
 *   F3  字段缺失        规范要求的字段没有写
 *   F4  字段重复        同一字段在一条判据里出现多次（程序无法判定取哪个）
 *   F5  状态取值        状态缺失 / 重复 / 不在受控词表内
 *   F6  不确定特征取值  同上
 *   F7  归属            状态非 closed / out-of-scope 时，必须有 `归属`，且含 owner= 与 接收批次=
 *   F8  测试栏散文      `测试` 栏里出现不是锚点的文字（程序认不出，等于没写）
 *   F9  锚点形式        锚点不符合 `路径.ets::describe名#用例名`
 *   F10 占位词残留      `期望`/`可观测点`/`来源`/`失败信息` 里还留着「待补」一类占位词
 *   F11 层不可判定      读不出这条判据属于 旅程 / 接缝 / 单点
 *   F12 层与测试层不符  旅程判据应挂 E2E、接缝应挂集成
 *   F13 父判据缺失      接缝/单点没有父判据或上游，判据接不回需求
 *   F14 无锚点栏        `测试`/`待建测试`/`待接线测试` 三栏都没有，等于没声明落点
 *
 * 进度统计（P 系列）：判据总数、按层、按状态、闭环率、按模块。
 *
 * 用法：
 *   node check-oracle-format.cjs [--root=<dir>] [--oracles=<dir>] [--requirements=<dir>]
 *        [--entry=<Names>] [--heading-level=3] [--own-field] [--strict] [--json]
 *        [--only=F1,F8] [--limit=N] [--worklist=<file>] [--exclude=<相对路径正则>]
 *
 * 退出码：0 = 报告；1 = --strict 且有 P0 命中；2 = 输入错误。
 * 只读。不修改任何文件。
 *
 * 自测：node check-oracle-format.cjs --self-test
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
const REQUIREMENTS_DIR = opt('requirements', 'docs/requirements');
const HEADING_LEVEL = Number(opt('heading-level', '3'));
const LIMIT = Number(opt('limit', '10'));
const STRICT = flag('strict');
const AS_JSON = flag('json');
const ONLY = opt('only', '') ? new Set(opt('only', '').split(',').map((s) => s.trim())) : null;
const WORKLIST = opt('worklist', '');
// 目录约定（层由目录表达时用）：`<旅程目录名>,<接缝目录名>`，相对 --oracles。
const LAYER_DIRS = opt('layer-dirs', '90-journeys,91-seams').split(',').map((s) => s.trim()).filter(Boolean);
const EXCLUDE = opt('exclude', '');

// 项目可声明自己的锚点后缀（默认 ArkTS 的 `.ets`）。同一个项目只用一套，由项目
// 流程记录写定；程序读不到就等于没写。
const ANCHOR_EXTS = opt('anchor-exts', '.ets').split(',').map((s) => s.trim()).filter(Boolean);
const EXT_ALT = ANCHOR_EXTS.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const ANCHOR_FILE_SRC = `[A-Za-z0-9_./@-]+(?:${EXT_ALT})`;
const ANCHOR_TOKEN_RE = new RegExp(`^(${ANCHOR_FILE_SRC})(?:::(.*))?$`);
const ANCHOR_FILE_RE = new RegExp(`(?:${EXT_ALT})$`);
const ANCHOR_ANY_RE = new RegExp(EXT_ALT);
const ANCHOR_START_RE = new RegExp(`^[\\s\x60]*((::)|(${ANCHOR_FILE_SRC})|(#))`);

// ---------------------------------------------------------------------------
// 受控词表
// ---------------------------------------------------------------------------

const STATES = ['closed', 'pending-test', 'pending-oracle', 'not-evaluated', 'out-of-scope'];
const OPEN_STATES = ['pending-test', 'pending-oracle', 'not-evaluated'];
const UNCERTAIN_KINDS = ['none', 'UNCERTAIN-SOURCE', 'UNCERTAIN-VALUE', 'UNCERTAIN-CONFLICT',
  'UNCERTAIN-PLATFORM', 'UNCERTAIN-WIRING', 'DEFERRED-BATCH', 'NOT-EVALUATED', 'NO-ANCHOR'];
const LAYERS = ['旅程', '接缝', '单点'];
const LAYER_ALIAS = { '旅程': '旅程', 'journey': '旅程', '接缝': '接缝', 'seam': '接缝', '单点': '单点', 'point': '单点', 'unit': '单点' };

/** 规范要求的字段：canon 名 → 可接受的写法（同义）。 */
const FIELDS = [
  { canon: '强度', aliases: ['强度'], level: 'P1' },
  { canon: '可观测点', aliases: ['可观测点'], level: 'P1' },
  { canon: '期望', aliases: ['期望'], level: 'P1' },
  { canon: '失败信息', aliases: ['失败信息'], level: 'P1' },
  { canon: '来源', aliases: ['来源', '设计依据', '安卓依据', '依据'], level: 'P1' },
  { canon: '状态', aliases: ['状态'], level: 'P0' },
  { canon: '不确定特征', aliases: ['不确定特征'], level: 'P0' },
];
/** 条件字段：状态非 closed / out-of-scope 时必填。 */
const OWNER_FIELD = { canon: '归属', aliases: ['归属'], level: 'P0' };
/** 层可由字段表达，也可由目录约定表达；两者都没有才报 F11。 */
const LAYER_FIELD = { canon: '层级', aliases: ['层级'] };
const PARENT_FIELDS = ['父判据', '上游'];
const ANCHOR_FIELDS = ['测试', '待建测试', '待接线测试'];
const PLACEHOLDER_RE = /(待补|待定|待裁决|待拍板|TODO|TBD|XXX|待填)/;
const STRUCT_LINE_RE = /^\s*(#{1,6}\s|>|\||<|---\s*$)/;
const HEADING_RE = /^(#{1,6})\s+(?:[^\p{L}\p{N}\s]{1,4}\s*)?(O-[A-Z]+-\d+[A-Z]?)(?![0-9A-Za-z-])\s*(.*)$/u;
const FIELD_RE = /^\s*[-*]\s*([^:：]{1,60})\s*[:：]\s*(.*)$/;
const MANUAL_ANCHOR_RE = /^(真机走查|走查|人工走查)\s+\S+manual-checks\.md#M-\d+/;

const CHECKS = {
  F1: { level: 'P0', name: '重号', desc: '同一个判据 ID 被定义多次' },
  F2: { level: 'P0', name: '标题形式', desc: `标题必须是 \`${'#'.repeat(HEADING_LEVEL)} O-XXX-NNN 标题\`` },
  F3: { level: 'P1', name: '字段缺失', desc: '规范要求的字段没有写' },
  F4: { level: 'P1', name: '字段重复', desc: '同一字段在一条判据里出现多次' },
  F5: { level: 'P0', name: '状态取值', desc: '状态缺失 / 重复 / 不在受控词表内' },
  F6: { level: 'P0', name: '不确定特征取值', desc: '不确定特征缺失 / 重复 / 不在受控词表内' },
  F7: { level: 'P0', name: '归属', desc: '状态非 closed / out-of-scope 时缺 owner 或接收批次' },
  F8: { level: 'P1', name: '测试栏散文', desc: '测试栏里出现不是锚点的文字，程序认不出' },
  F9: { level: 'P1', name: '锚点形式', desc: '锚点不符合 `路径.ets::describe名#用例名`' },
  F10: { level: 'P1', name: '占位词残留', desc: '事实字段里还留着「待补」一类占位词' },
  F11: { level: 'P1', name: '层不可判定', desc: '读不出这条判据属于 旅程 / 接缝 / 单点' },
  F12: { level: 'P1', name: '层与测试层不符', desc: '旅程判据应挂 E2E、接缝应挂集成' },
  F13: { level: 'P1', name: '父判据缺失', desc: '接缝/单点没有父判据或上游，接不回需求' },
  F14: { level: 'P1', name: '无锚点栏', desc: '测试 / 待建测试 / 待接线测试 三栏都没有' },
};

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'build' || e.name === 'oh_modules' || e.name === '.test' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, filter, out); continue; }
    if (filter(e.name)) out.push(full);
  }
  return out;
}

/** 解析判据文件：标题 → 字段字典（重复字段合并并计数）+ 块行号。 */
function parseOracleFile(abs) {
  const rel = path.relative(ROOT, abs);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  const out = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    delete cur.body;
    out.push(cur);
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADING_RE);
    if (m) {
      flush();
      cur = {
        id: m[2], title: (m[3] || '').trim(), hash: m[1], hashes: m[1].length,
        file: rel, line: i + 1, fields: new Map(), counts: new Map(), body: [],
      };
      continue;
    }
    if (!cur) continue;
    cur.body.push(lines[i]);
    const fm = lines[i].match(FIELD_RE);
    if (fm) {
      // 字段名带说明时要能认出来（`期望（✅ 已裁决）:`），所以先去掉尾部括号再归一。
      const raw = fm[1].trim();
      const k = raw.replace(/[（(][^（()）]*[)）]\s*$/u, '').trim();
      const v = fm[2].trim();
      cur.fields.set(k, cur.fields.has(k) ? `${cur.fields.get(k)}\n${v}` : v);
      cur.counts.set(k, (cur.counts.get(k) || 0) + 1);
    } else if (lines[i].trim() && cur.fields.size > 0 && !STRUCT_LINE_RE.test(lines[i])) {
      const last = [...cur.fields.keys()].pop();
      cur.fields.set(last, `${cur.fields.get(last)}\n${lines[i].trim()}`);
    }
  }
  flush();
  return out;
}

function parseAllOracles() {
  const dir = path.join(ROOT, ORACLE_DIR);
  const files = walk(dir, (n) => n.endsWith('.md') && !n.startsWith('_') && n !== 'README.md')
    .filter((f) => !path.relative(dir, f).split(path.sep).includes('_legacy'))
    .filter((f) => !(EXCLUDE && new RegExp(EXCLUDE).test(path.relative(ROOT, f))));
  const list = [];
  for (const f of files.sort()) list.push(...parseOracleFile(f));
  return { list, files };
}

/** 取字段值：canon 名或任一别名。 */
function fieldOf(o, canon, aliases) {
  for (const a of aliases) if (o.fields.has(a)) return { key: a, value: o.fields.get(a), count: o.counts.get(a) || 0 };
  return null;
}

/** 层：字段优先，其次目录约定。 */
function layerOf(o) {
  const f = fieldOf(o, LAYER_FIELD.canon, LAYER_FIELD.aliases);
  if (f) {
    const raw = f.value.split('\n')[0].trim().replace(/[[\]]/g, '').trim();
    const key = Object.keys(LAYER_ALIAS).find((k) => raw.startsWith(k) || raw.toLowerCase().startsWith(k));
    if (key) return { layer: LAYER_ALIAS[key], how: 'field', raw };
    return { layer: null, how: 'field', raw };
  }
  const rel = path.relative(path.join(ROOT, ORACLE_DIR), path.join(ROOT, o.file));
  const top = rel.split(path.sep)[0];
  if (top === LAYER_DIRS[0]) return { layer: '旅程', how: 'dir', raw: top };
  if (top === LAYER_DIRS[1]) return { layer: '接缝', how: 'dir', raw: top };
  if (/^(\d{2}|[A-Za-z])/.test(top)) return { layer: '单点', how: 'dir', raw: top };
  return { layer: null, how: 'none', raw: top };
}

/** 拆锚点 token：`、`/`；`/`,`/换行 只在后面紧跟锚点起点时才算分隔符。 */
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

function classifyAnchorToken(t) {
  const s = t.trim().replace(/^`|`$/g, '').replace(/^\[[^\]]{1,10}\]\s*/, '').replace(/^`|`$/g, '').trim();
  if (!s) return { kind: 'empty' };
  if (MANUAL_ANCHOR_RE.test(s)) return { kind: 'manual', text: s };
  if (/^::/.test(s)) return { kind: 'cont', text: s };
  if (/^#[^\s#]{2,}$/.test(s)) return { kind: 'cont', text: s };
  const m = s.match(ANCHOR_TOKEN_RE);
  if (m) {
    const rest = (m[2] || '').trim();
    if (!rest) return { kind: 'anchor-file-only', file: m[1], text: s };
    const hash = rest.indexOf('#');
    if (hash < 0) {
      // 平铺用例（如 node:test 的 `test('名')`）没有 describe 层：整段就是用例名。
      // 名字对不对由闭环检查的 S3 判，这里只管形状。
      return { kind: 'anchor', file: m[1], describe: '', case: rest, text: s };
    }
    const describe = rest.slice(0, hash).trim();
    const cname = rest.slice(hash + 1).trim();
    if (!describe) return { kind: 'anchor-no-describe', file: m[1], text: s };
    if (!cname) return { kind: 'anchor-no-case', file: m[1], text: s };
    return { kind: 'anchor', file: m[1], describe, case: cname, text: s };
  }
  if (ANCHOR_FILE_RE.test(s) || ANCHOR_ANY_RE.test(s)) return { kind: 'anchor-broken', text: s };
  if (/(待补|待建|待接线|缺口|转嫁|不适用|^无$|TODO)/i.test(s)) return { kind: 'placeholder', text: s };
  return { kind: 'prose', text: s };
}

/** 测试栏的层标记：`[单元]` / `[集成]` / `[E2E]`。 */
function testLayerTags(text) {
  const tags = new Set();
  const re = /\[(单元|集成|E2E|e2e)\]/g; let m;
  while ((m = re.exec(text || '')) !== null) tags.add(m[1] === 'e2e' ? 'E2E' : m[1]);
  return tags;
}

// ---------------------------------------------------------------------------
// 检查
// ---------------------------------------------------------------------------

function check(list) {
  const findings = [];
  const add = (code, o, msg, snippet) => {
    if (ONLY && !ONLY.has(code)) return;
    findings.push({ code, level: CHECKS[code].level, id: o.id, file: o.file, line: o.line, msg, snippet: snippet || '' });
  };

  for (const o of list) {
    // F2 标题形式
    if (o.hashes !== HEADING_LEVEL) add('F2', o, `标题用了 ${o.hashes} 级，规范要求 ${HEADING_LEVEL} 级`, `${o.hash} ${o.id}`);
    if (!o.title) add('F2', o, '标题为空（ID 后没有文字）', `${o.hash} ${o.id}`);

    // F3/F4 字段
    for (const spec of FIELDS) {
      const hit = fieldOf(o, spec.canon, spec.aliases);
      if (!hit) add('F3', o, `缺字段「${spec.canon}」`);
      else if (hit.count > 1) add('F4', o, `字段「${hit.key}」出现 ${hit.count} 次`, hit.key);
    }

    // F5/F6/F7 机器字段
    const st = fieldOf(o, '状态', ['状态']);
    if (!st) add('F5', o, '缺字段「状态」');
    else if (st.count > 1) add('F5', o, `状态出现 ${st.count} 次`);
    else {
      const v = st.value.split('\n')[0].trim();
      if (!STATES.includes(v)) add('F5', o, `状态取值「${v}」不在受控词表内`, v);
    }
    const unc = fieldOf(o, '不确定特征', ['不确定特征']);
    if (!unc) add('F6', o, '缺字段「不确定特征」');
    else if (unc.count > 1) add('F6', o, `不确定特征出现 ${unc.count} 次`);
    else {
      const v = unc.value.split('\n')[0].trim().split(/\s+/)[0];
      if (!UNCERTAIN_KINDS.includes(v)) add('F6', o, `不确定特征取值「${v}」不在受控词表内`, v);
    }
    const stateVal = st ? st.value.split('\n')[0].trim() : '';
    if (stateVal && OPEN_STATES.includes(stateVal)) {
      const own = fieldOf(o, OWNER_FIELD.canon, OWNER_FIELD.aliases);
      if (!own) add('F7', o, `状态为 ${stateVal}，但缺字段「归属」`);
      else {
        const v = own.value;
        if (!/owner\s*[:=]\s*\S+/.test(v)) add('F7', o, '归属里没有 owner=', v.slice(0, 80));
        if (!/(接收批次|认领批次|批次)\s*[:=]\s*\S+/.test(v)) add('F7', o, '归属里没有 接收批次=', v.slice(0, 80));
      }
    }

    // F8/F9/F14 锚点栏
    let hasAnchorField = false;
    for (const fn of ANCHOR_FIELDS) {
      if (!o.fields.has(fn)) continue;
      hasAnchorField = true;
      for (const tok of splitAnchorTokens(o.fields.get(fn))) {
        const c = classifyAnchorToken(tok);
        if (c.kind === 'empty' || c.kind === 'cont') continue;
        if (c.kind === 'anchor' || c.kind === 'manual' || c.kind === 'anchor-file-only') continue;
        if (c.kind === 'anchor-no-case' || c.kind === 'anchor-no-describe' || c.kind === 'anchor-broken') {
          add('F9', o, `${fn} 栏锚点不完整（要 \`路径.ets::describe名#用例名\`）：${c.text.slice(0, 70)}`);
          continue;
        }
        // prose / placeholder 只在 `测试` 栏算问题；待建/待接线 栏本来就可以写原因
        if (fn === '测试') add('F8', o, `测试栏有非锚点文字：${c.text.slice(0, 70)}`);
      }
    }
    if (!hasAnchorField) add('F14', o, '测试 / 待建测试 / 待接线测试 三栏都没有');

    // F10 占位词残留
    for (const canon of [['期望', ['期望']], ['可观测点', ['可观测点']], ['来源', ['来源', '设计依据', '安卓依据', '依据']], ['失败信息', ['失败信息']]]) {
      const hit = fieldOf(o, canon[0], canon[1]);
      if (!hit) continue;
      const m = hit.value.match(PLACEHOLDER_RE);
      if (m) add('F10', o, `${canon[0]} 里残留占位词「${m[1]}」`, hit.value.split('\n').find((l) => PLACEHOLDER_RE.test(l))?.slice(0, 70) || '');
    }

    // F11/F12/F13 层
    const L = layerOf(o);
    if (!L.layer) add('F11', o, `层不可判定（字段=${L.how === 'field' ? L.raw : '无'}，目录=${L.raw || '无'}）`);
    else {
      const tags = new Set();
      for (const fn of ANCHOR_FIELDS) for (const t of testLayerTags(o.fields.get(fn))) tags.add(t);
      if (L.layer === '旅程' && tags.size > 0 && !tags.has('E2E')) add('F12', o, `旅程判据的测试栏标了 [${[...tags].join('/')}]，规范要求 [E2E]`, [...tags].join('/'));
      if (L.layer === '接缝' && tags.size > 0 && !tags.has('集成')) add('F12', o, `接缝判据的测试栏标了 [${[...tags].join('/')}]，规范要求 [集成]`, [...tags].join('/'));
      if (L.layer !== '旅程' && !PARENT_FIELDS.some((p) => o.fields.has(p))) {
        add('F13', o, `${L.layer}判据没有「父判据」也没有「上游」，接不回需求`);
      }
    }
  }

  // F1 重号
  const byId = new Map();
  for (const o of list) {
    if (!byId.has(o.id)) byId.set(o.id, []);
    byId.get(o.id).push(o);
  }
  for (const [id, arr] of byId) {
    if (arr.length < 2) continue;
    for (const o of arr) {
      if (ONLY && !ONLY.has('F1')) continue;
      findings.push({
        code: 'F1', level: CHECKS.F1.level, id, file: o.file, line: o.line,
        msg: `ID ${id} 被定义 ${arr.length} 次`, snippet: arr.map((x) => `${x.file}:${x.line}`).join(' · '),
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 进度统计
// ---------------------------------------------------------------------------

function progress(list) {
  const byLayer = {}; const byState = {}; const byModule = {};
  for (const o of list) {
    const L = layerOf(o).layer || '未判定';
    byLayer[L] = (byLayer[L] || 0) + 1;
    const st = (fieldOf(o, '状态', ['状态'])?.value.split('\n')[0].trim()) || '未填';
    byState[st] = (byState[st] || 0) + 1;
    const mod = path.relative(path.join(ROOT, ORACLE_DIR), path.join(ROOT, o.file)).split(path.sep)[0];
    if (!byModule[mod]) byModule[mod] = { total: 0, closed: 0, openNoOwner: 0 };
    byModule[mod].total += 1;
    if (st === 'closed') byModule[mod].closed += 1;
    if (OPEN_STATES.includes(st) && !o.fields.has('归属')) byModule[mod].openNoOwner += 1;
  }
  const closed = byState.closed || 0;
  return { total: list.length, closed, closedRate: list.length ? closed / list.length : 0, byLayer, byState, byModule };
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

function main() {
  const { list, files } = parseAllOracles();
  if (!list.length) {
    console.error(`没有在 ${path.join(ROOT, ORACLE_DIR)} 找到判据（标题形式 \`${'#'.repeat(HEADING_LEVEL)} O-XXX-NNN 标题\`）`);
    process.exit(2);
  }
  const findings = check(list);
  const P = progress(list);

  if (AS_JSON) {
    emit(JSON.stringify({ root: ROOT, oracleDir: ORACLE_DIR, files: files.length, progress: P, findings }, null, 2) + '\n');
  } else {
    const byCode = {};
    for (const f of findings) byCode[f.code] = (byCode[f.code] || 0) + 1;
    console.log(`判据 ${P.total} 条，文件 ${files.length} 份（${path.relative(process.cwd(), path.join(ROOT, ORACLE_DIR)) || '.'}）\n`);
    console.log('一、形式检查');
    if (!findings.length) console.log('  ✅ 全部通过');
    for (const code of Object.keys(CHECKS)) {
      const n = byCode[code] || 0;
      if (!ONLY && !n) continue;
      if (ONLY && !ONLY.has(code)) continue;
      const mk = n ? '❌' : '✅';
      console.log(`  ${mk} ${code} [${CHECKS[code].level}] ${CHECKS[code].name.padEnd(8)} ${String(n).padStart(5)}  ${CHECKS[code].desc}`);
    }
    const shown = {};
    for (const f of findings) {
      shown[f.code] = (shown[f.code] || 0) + 1;
      if (shown[f.code] > LIMIT) continue;
      console.log(`     ${f.id} ${f.file}:${f.line}  ${f.msg}${f.snippet ? `  ← ${f.snippet}` : ''}`);
    }
    for (const [code, n] of Object.entries(shown)) {
      if (n > LIMIT) console.log(`     … ${code} 还有 ${n - LIMIT} 条（--limit=N 调整，或 --only=${code}）`);
    }
    console.log('\n二、进度');
    console.log(`  判据总数 ${P.total} · 状态 closed ${P.closed}（闭环率 ${(P.closedRate * 100).toFixed(1)}%）`);
    console.log(`  按层: ${Object.entries(P.byLayer).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    console.log(`  按状态: ${Object.entries(P.byState).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    console.log('  按模块:');
    for (const [m, s] of Object.entries(P.byModule).sort()) {
      const rate = s.total ? ((s.closed / s.total) * 100).toFixed(0) : '0';
      console.log(`    ${m.padEnd(22)} ${String(s.total).padStart(5)} 条 · closed ${String(s.closed).padStart(5)} (${rate.padStart(3)}%)${s.openNoOwner ? ` · 缺归属 ${s.openNoOwner}` : ''}`);
    }
    if (WORKLIST) {
      fs.writeFileSync(WORKLIST, JSON.stringify(findings, null, 2) + '\n');
      console.log(`\n待处理清单已写出: ${WORKLIST}（${findings.length} 条）`);
    }
  }

  if (STRICT && findings.some((f) => f.level === 'P0')) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// 自测
// ---------------------------------------------------------------------------

function selfTest() {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-format-'));
  const O = path.join(dir, 'docs/oracles');
  fs.mkdirSync(path.join(O, '01-mod/01-a'), { recursive: true });
  fs.mkdirSync(path.join(O, '90-journeys'), { recursive: true });
  fs.mkdirSync(path.join(O, '91-seams'), { recursive: true });

  const good = `### O-AAA-001 好判据\n- 强度: [强]\n- 可观测点: 看 X\n- 期望: Y 成立\n- 失败信息: 期望 Y，实际 Z\n- 来源: R-A-01\n- 上游: R-A-01\n- 测试: entry/src/test/A.ets::ASpec#用例一\n- 状态: closed\n- 不确定特征: none\n`;
  fs.writeFileSync(path.join(O, '01-mod/01-a/oracles.md'), good + `\n### O-AAA-002 缺字段且测试栏有散文\n- 强度: [强]\n- 测试: entry/src/test/A.ets::ASpec#用例二；顺带说明一句散文\n- 状态: pending-test\n- 不确定特征: none\n- 归属: owner=someone\n` + `\n### O-AAA-002 重号\n- 强度: [强]\n- 观测点: 写错字段名\n- 期望: 待补\n- 失败信息: 无\n- 来源: 无\n- 测试: 没有锚点\n- 状态: 做完啦\n- 不确定特征: 可能吧\n`);
  fs.writeFileSync(path.join(O, '90-journeys/J-01.md'), `### O-JJJ-001 旅程判据\n- 强度: [强]\n- 可观测点: 走完整个流程\n- 期望: 走到终点\n- 失败信息: 停在中间\n- 来源: R-J-01\n- 上游: R-J-01\n- 测试: [单元] entry/src/test/A.ets::ASpec#用例一\n- 状态: closed\n- 不确定特征: none\n`);
  fs.writeFileSync(path.join(O, '91-seams/S-01.md'), `### O-SSS-001 接缝判据\n- 强度: [强]\n- 可观测点: 两模块交接\n- 期望: 交接成功\n- 失败信息: 交接丢数据\n- 来源: R-S-01\n- 测试: [集成] entry/src/test/A.ets::ASpec#用例一\n- 状态: pending-oracle\n- 不确定特征: UNCERTAIN-WIRING\n`);
  fs.writeFileSync(path.join(O, '01-mod/01-a/oracles.md'),
    fs.readFileSync(path.join(O, '01-mod/01-a/oracles.md'), 'utf8') +
    `\n### O-AAA-003 三栏锚点都没有\n- 强度: [强]\n- 可观测点: 看 W\n- 期望: W 成立\n- 失败信息: 期望 W，实际没有\n- 来源: R-A-01\n- 上游: R-A-01\n- 状态: pending-test\n- 不确定特征: none\n- 归属: owner=someone 接收批次=01-mod-01\n`);
  fs.writeFileSync(path.join(O, 'README.md'), '# 不是判据\n');

  const out = [];
  const bad = [];
  const expect = (code, want) => {
    const r = require('node:child_process').spawnSync(process.execPath,
      [__filename, `--root=${dir}`, '--json'], { encoding: 'utf8' });
    if (r.status !== 0) { bad.push(`运行失败: ${r.stderr}`); return; }
    const j = JSON.parse(r.stdout);
    const n = j.findings.filter((f) => f.code === code).length;
    out.push(`${code} 命中 ${n}（期望 ≥${want}）`);
    if (n < want) bad.push(`${code} 期望 ≥${want}，实际 ${n}`);
  };
  expect('F1', 2);   // 重号两条
  expect('F2', 0);   // 都是 ###
  expect('F3', 1);   // O-AAA-002 缺 可观测点/期望…至少一条
  expect('F5', 1);   // 状态「做完啦」
  expect('F6', 1);   // 不确定特征「可能吧」
  expect('F7', 1);   // 归属缺 接收批次
  expect('F8', 1);   // 测试栏散文
  expect('F11', 0);  // 层都能判定
  expect('F12', 1);  // 旅程判据标了 [单元]
  expect('F13', 1);  // 接缝判据没有父判据/上游
  expect('F14', 1);  // O-AAA-003 三栏都没有

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('自测：');
  for (const l of out) console.log('  ' + l);
  if (bad.length) { console.error('自测失败：\n  ' + bad.join('\n  ')); process.exitCode = 1; return; }
  console.log('自测通过。');
}

if (flag('self-test')) selfTest();
else main();
