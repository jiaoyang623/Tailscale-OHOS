#!/usr/bin/env node
'use strict';
/**
 * check-oracle-closure.cjs —— 判据「闭环」检查器（通用版，纯程序）。
 *
 * 用途：判据写完、设计各层收尾、以及实现完成后，逐条检查「这条判据是不是真的有人守」。
 * 现有检查通常只看到「判据 ↔ 用例名字对不对得上」。本工具往前后各补一段：
 *   往前：判据自己是不是在延期（写了"以后再做"，而没有任何接收方）；
 *   往后：用例有没有执行通道、有没有进 CI 清单、缺口有没有写接收方。
 *
 * 闭环定义（五段全绿才算 closed）：
 *   L1 定义在   有稳定 ID、标题、（可选）强度与来源
 *   L2 锚点真   判据点名的用例名，在点名的文件里真的存在            → S2 / S3
 *   L3 通道在   锚点所在测试文件，落在某个测试入口的可达闭包里      → S4
 *   L4 清单在   用例名出现在 CI 用例清单（给了 --expected 才查）    → S5
 *   L5 缺口有主 非闭环时，必须写 owner 与接收批次                   → S1 / S6
 *   附加        需求说「已实现」、判据说没做完 ⇒ 互相矛盾           → S7
 *
 * 程序与 AI 的分工：
 *   · 程序能判的：S1–S7 的机械部分，逐条给证据（文件:行 + 命中片段）。
 *   · 程序判不了的：锚点模糊匹配、状态自相矛盾、缺口该由谁接。
 *     用 `--worklist=<file>` 导出待判定清单；人工或 AI 填好后用 `--verdicts=<file>` 读回。
 *
 * 用法（全部可选；不给参数就在当前目录按默认约定找）：
 *   node check-oracle-closure.cjs [--root=<dir>] [--oracles=<dir>] [--entries=<a,b>]
 *        [--tests=<dirs>] [--expected=<file>] [--requirements=<dir>]
 *        [--signal=S3] [--limit=N] [--exclude=<相对路径正则>] [--strict] [--json]
 *        [--worklist=<file>] [--verdicts=<file>]
 *
 * 退出码：0 = 报告（默认）；1 = --strict 且命中 P0；2 = 输入错误。
 *
 * 只读。不修改任何文件（--worklist 写出的文件由调用方指定位置）。
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
const EXPECTED_FILE = opt('expected', '');
const TEST_DIRS = opt('tests', 'entry/src/test,entry/src/ohosTest/ets/test,base,common')
  .split(',').map((s) => s.trim()).filter(Boolean);
const ENTRY_FILES = opt('entries', '')
  ? opt('entries', '').split(',').map((s) => s.trim()).filter(Boolean)
  : null; // null = 自动发现
const ONLY = opt('signal', '');
// 判据锚点与测试文件的后缀由项目声明（默认 ArkTS 的 `.ets`）。同一个项目只用一套。
const TEST_EXTS = (opt('test-exts', '.ets') || '.ets').split(',').map((s) => s.trim()).filter(Boolean);
const EXT_ALT = TEST_EXTS.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const TEST_FILE_SRC = `[A-Za-z0-9_./@-]+(?:${EXT_ALT})`;
// 有的仓把「只说一句的提及」（如 pending.md 里的 O-* 小标题）当独立文件放，不算判据定义。
// 用 --exclude=<相对路径正则> 把这类文件排除掉，工具本身不预设。
const EXCLUDE = opt('exclude', '');
const LIMIT = Number(opt('limit', '12'));
const STRICT = flag('strict');
const AS_JSON = flag('json');
const WORKLIST = opt('worklist', '');
const VERDICTS = opt('verdicts', '');

// ---------------------------------------------------------------------------
// 信号词表（受控词表：判据模板里用同一套写法，程序才认得出）
// ---------------------------------------------------------------------------

const DEFER_RE = /(待补|待建|待裁决|待拍板|待定|下批|后续|不在本批范围|本版不做|本版不适用|暂不|归属待定|尚无|未交付|not_evaluated|_pending\/)/;
const OWNER_RE = /(owner|负责人)\s*[:=：]\s*\S+/i;
const BATCH_RE = /(接收批次|认领批次|批次)\s*[:=：]\s*\S+/;
const DECLARED_RE = /(待补|部分已建|本版不做|not_evaluated|缺口|未交付|待建)/;
const DONE_WORD_RE = /(已实现|已完成|已交付|done)/;
/** 需求状态位判「完成」：只看状态开头，不看正文里顺带提到的「是否已实现」。 */
const STATUS_DONE_RE = /^[^\p{L}\p{N}]{0,3}(已实现|已完成|已交付|done)/u;

/** 状态受控取值：判据模板里只能填这些值。 */
const STATES = ['closed', 'pending-test', 'pending-oracle', 'not-evaluated', 'out-of-scope'];
/** 其中「还没做完」的取值：写了这些，就需要 `归属`。 */
const OPEN_STATES = ['pending-test', 'pending-oracle', 'not-evaluated'];

/** 不确定特征受控词表：判据模板里只能填这些值。 */
const UNCERTAIN_KINDS = [
  'none',              // 无不确定
  'UNCERTAIN-SOURCE',  // 来源没读到（上游行号未实读、设计稿推测）
  'UNCERTAIN-VALUE',   // 具体取值未定（尺寸/颜色/文案）
  'UNCERTAIN-CONFLICT',// 多源冲突（参考实现 vs 设计稿 vs 需求打架）
  'UNCERTAIN-PLATFORM',// 平台差异未核实
  'UNCERTAIN-WIRING',  // 承载件或装配点不确定
  'DEFERRED-BATCH',    // 明确不在本批范围
  'NOT-EVALUATED',     // 行为未验证
  'NO-ANCHOR',         // 找不到可断言的落点
];

const SIGNALS = {
  S1: { level: 'P1', name: '延后标记未回收', desc: '判据写着「以后再做」（含 _pending/），且没有接收方' },
  S2: { level: 'P0', name: '锚点文件不存在', desc: '测试栏点名的带路径文件在仓库里不存在（挪走了没回填）' },
  S3: { level: 'P0', name: '用例名对不上', desc: '点名的用例名在点名的文件里找不到' },
  S4: { level: 'P0', name: '无执行通道', desc: '用例文件不在任何测试入口的可达闭包里，永远不会跑' },
  S5: { level: 'P1', name: '不在 CI 清单', desc: '文件已登记，但用例名不在 CI 用例清单里' },
  S6: { level: 'P1', name: '缺口无接收方', desc: '声明为缺口，但没有 owner 或接收批次' },
  S7: { level: 'P0', name: '需求说已实现、判据说没做完', desc: '需求状态与判据状态互相矛盾' },
};

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

const HEADING_RE = /^#{1,6}\s+(?:[^\p{L}\p{N}\s]{1,4}\s*)?(O-[A-Z]+-\d+[A-Z]?)(?![0-9A-Za-z-])/u;
const FIELD_RE = /^\s*[-*]\s*([^:：]{1,12})\s*[:：]\s*(.*)$/;
/** 结构行：不作为上一字段的续行。 */
const STRUCT_LINE_RE = /^\s*(#{1,6}\s|>|\||<|---\s*$)/;

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

/** 解析判据文件：标题 → 字段字典 + 块全文。 */
function parseOracleFile(abs) {
  const rel = path.relative(ROOT, abs);
  const lines = fs.readFileSync(abs, 'utf8').split('\n');
  const out = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    cur.block = cur.body.join('\n');
    delete cur.body;
    out.push(cur);
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADING_RE);
    if (m) {
      flush();
      cur = { id: m[1], title: lines[i].replace(/^#{1,6}\s+/, '').replace(/^[^\p{L}\p{N}\s]{1,4}\s*/u, '').trim(), file: rel, line: i + 1, fields: new Map(), body: [] };
      continue;
    }
    if (!cur) continue;
    cur.body.push(lines[i]);
    const fm = lines[i].match(FIELD_RE);
    if (fm) {
      // 同一字段可以出现多次（旧判据常写多条 `- 测试:`，一条一个锚点）⇒ 合并，不当后者覆盖前者。
      const k = fm[1].trim();
      const v = fm[2].trim();
      cur.fields.set(k, cur.fields.has(k) ? `${cur.fields.get(k)}\n${v}` : v);
    }
    else if (lines[i].trim() && cur.fields.size > 0 && !STRUCT_LINE_RE.test(lines[i])) {
      // 续行：并到最后一个字段。
      // 但 `---`、`## 小节标题`、`> 说明段`、表格行、HTML 这些是**结构行**，不是上一字段的续行；
      // 旧判据里 `测试:` 后面常直接跟它们，若当续行，会把整段章节标题吞进字段值（实测 200+ 处）。
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
  return list;
}

/** 测试用例名索引：文件名 → 用例名集合；以及全局集合。 */
function buildCaseIndex() {
  const byFile = new Map();
  const byBase = new Map();
  const all = new Set();
  for (const d of TEST_DIRS) {
    for (const f of walk(path.join(ROOT, d), (n) => TEST_EXTS.some((e) => n.endsWith(e)))) {
      const rel = path.relative(ROOT, f);
      const src = fs.readFileSync(f, 'utf8');
      const names = new Set();
      // ArkTS 的 `it('名')` 与 node:test 的 `test('名')` 都算用例；只认行首，
      // 免得把 `if (/x/.test('y'))` 这种调用当作用例名收进池子。
      const re = /^[ \t]*(?:it|test)\(\s*(['"])((?:\\.|(?!\1).)*)\1/gm;
      let m;
      while ((m = re.exec(src)) !== null) names.add(m[2]);
      byFile.set(rel, names);
      if (!byBase.has(path.basename(rel))) byBase.set(path.basename(rel), []);
      byBase.get(path.basename(rel)).push(rel);
      for (const n of names) all.add(n);
    }
  }
  return { byFile, byBase, all };
}

/** 从一份 List.test.ets 出发，沿相对 import 走可达闭包。 */
function reachableFiles(entryRel) {
  const seen = new Set();
  const stack = [entryRel];
  while (stack.length > 0) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    seen.add(rel);
    const src = fs.readFileSync(abs, 'utf8');
    const re = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      let p = path.normalize(path.join(path.dirname(rel), spec));
      if (!TEST_EXTS.some((e) => p.endsWith(e))) {
        p = TEST_EXTS.map((e) => p + e).find((c) => fs.existsSync(path.join(ROOT, c))) || p + TEST_EXTS[0];
      }
      stack.push(p);
    }
  }
  return seen;
}

function discoverEntries() {
  if (!ENTRY_FILES) {
    return walk(ROOT, (n) => n === 'List.test.ets')
      .map((f) => path.relative(ROOT, f))
      .sort();
  }
  // 入口可以是通配（如 `scripts/test-*.mjs`）：每个命中的文件本身就是一个入口，
  // 这正对应 `node --test scripts/test-*.mjs` 这种「按模式发现」的运行方式。
  const out = [];
  for (const spec of ENTRY_FILES) {
    if (!spec.includes('*')) { out.push(spec); continue; }
    const dir = path.dirname(spec);
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    const glob = path.basename(spec)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    const re = new RegExp(`^${glob}$`);
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.isFile() && re.test(e.name)) out.push(path.posix.join(dir, e.name));
    }
  }
  return out.sort();
}

function loadExpected() {
  const full = new Set();
  const bare = new Set();
  if (!EXPECTED_FILE) return { full, bare, used: false };
  // 允许给多份清单（逗号分隔）：单测清单与设备/E2E 清单分开维护时都要算数。
  const files = EXPECTED_FILE.split(',').map((s) => s.trim()).filter(Boolean);
  let any = false;
  for (const f of files) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) continue;
    any = true;
    for (const raw of fs.readFileSync(abs, 'utf8').split('\n')) {
      const t = raw.trim();
      if (!t || t.startsWith('#')) continue;
      const bar = t.indexOf('|');
      const name = bar >= 0 ? t.slice(bar + 1) : t;
      const sep = name.indexOf('#');
      const bareName = sep >= 0 ? name.slice(sep + 1) : name;
      full.add(name);
      bare.add(bareName);
    }
  }
  return { full, bare, used: any };
}

/**
 * 需求条目的「已完成」索引：只在**该需求自己的状态位**上判完成，不看正文里
 * 顺带出现「已完成」的句子（那种句子常在一行里提到十几个 R-id，会把 S7 全判红）。
 * 认两种写法：
 *   1) 表格行：首格是 R-id ⇒ 末格当状态；
 *   2) 正文小节：标题里带 R-id ⇒ 该小节里的 `**鸿蒙现状**：<状态>` 行当状态。
 */
function requirementDoneIndex() {
  const dir = path.join(ROOT, REQUIREMENTS_DIR);
  const idx = new Map(); // R-id → [{rel,line,status}]
  const add = (rid, rel, line, status) => {
    if (!idx.has(rid)) idx.set(rid, []);
    idx.get(rid).push({ rel, line, status });
  };
  for (const f of walk(dir, (n) => n.endsWith('.md'))) {
    const rel = path.relative(ROOT, f);
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    let sectionRids = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const head = line.match(/^#{1,6}\s+(.*)$/);
      if (head) {
        sectionRids = [...head[1].matchAll(/(R-[A-Z]+-\d+)/g)].map((m) => m[1]);
        continue;
      }
      const row = line.match(/^\|\s*(R-[A-Z]+-\d+)\s*\|(.*)$/);
      if (row) {
        const cells = row[2].split('|').map((c) => c.trim()).filter(Boolean);
        if (cells.length > 0) add(row[1], rel, i + 1, cells[cells.length - 1]);
        continue;
      }
      const now = line.match(/鸿蒙现状\*\*?\s*[:：]\s*(.+)$/);
      if (now) for (const rid of sectionRids) add(rid, rel, i + 1, now[1].trim());
    }
  }
  return idx;
}

/**
 * 从 `测试` 字段抽锚点。**只认模板规定的机器可读写法**：
 *   `路径.ets::describe名#用例名`  或  `路径.ets::用例名`  或  `路径.ets`
 * 逗号 / 分号 / 换行分隔，可以写多条。
 * 散文（旧格式）一律判为「不可解析」，进待判定清单，不当 P0 误报。
 */
const ANCHOR_TOKEN_RE = new RegExp(`^(${TEST_FILE_SRC})(?:::(.+))?$`);

function anchorsOf(testText) {
  const parsed = [];
  const badTokens = [];
  if (!testText) return { parsed, badTokens };
  // 旧格式的分隔符是「、」与换行；用例名里可能自带 `，`/`,`（如"…work.n.cn，与地址前缀同源"），
  // 所以逗号只有在**后面紧跟着一条新锚点**时才算分隔符。
  const normalized = testText
    .replace(/`/g, '')
    .replace(/[、]+/g, '\n')
    .replace(new RegExp(`[;；](?=\\s*\x60?\\s*(?:::|${TEST_FILE_SRC}))`, 'g'), '\n')
    .replace(new RegExp(`[,，](?=\\s*(?:::|${TEST_FILE_SRC}))`, 'g'), '\n');
  let lastFile = '';
  for (const raw of normalized.split('\n')) {
    let t = raw.trim().replace(/^\[[^\]]*\]\s*/, '').replace(/[、。]+$/, '');
    if (!t) continue;
    if (/^(走查|真机走查|manual-checks|待补|待建|缺口|转嫁|沿用|不适用|not_evaluated|无)/.test(t)) continue;
    // 续行锚点：`::describe#case` → 继承上一段的文件
    if (t.startsWith('::') && lastFile) t = lastFile + t;
    const m = t.match(ANCHOR_TOKEN_RE);
    if (!m) { badTokens.push(t); continue; }
    lastFile = m[1];
    let name = (m[2] || '').trim();
    const hash = name.indexOf('#');
    if (hash >= 0) name = name.slice(hash + 1).trim();
    name = name.replace(/[、。]+$/, '');
    parsed.push({ file: m[1], name });
  }
  return { parsed, badTokens };
}

// ---------------------------------------------------------------------------
// 检查
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(path.join(ROOT, ORACLE_DIR))) {
    console.error(`找不到判据目录：${path.join(ROOT, ORACLE_DIR)}（用 --oracles= 指定）`);
    process.exit(2);
  }

  const oracles = parseAllOracles();
  const cases = buildCaseIndex();
  const entries = discoverEntries();
  const reachable = new Set();
  for (const e of entries) for (const f of reachableFiles(e)) reachable.add(f);
  const expected = loadExpected();
  const doneIndex = fs.existsSync(path.join(ROOT, REQUIREMENTS_DIR)) ? requirementDoneIndex() : new Map();

  // 已登记文件里「用例名不在 CI 清单」的差集：一次算好，避免逐条判据重复扫大表。
  const missingInCi = new Map(); // file → 缺失用例名数组
  if (expected.used) {
    for (const f of reachable) {
      const names = cases.byFile.get(f);
      if (!names) continue;
      const miss = [...names].filter((n) => !expected.bare.has(n));
      if (miss.length > 0) missingInCi.set(f, miss);
    }
  }

  const findings = [];
  const worklist = [];
  const status = [];
  const seen = new Set();
  const push = (o, sig, detail) => {
    const key = `${o.id}|${sig}|${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ id: o.id, file: o.file, line: o.line, signal: sig, level: SIGNALS[sig].level, detail });
  };

  for (const o of oracles) {
    const testText = o.fields.get('测试') || '';
    const stateText = o.fields.get('状态') || '';
    const uncText = o.fields.get('不确定特征') || '';
    const ownerText = o.fields.get('归属') || '';
    const block = `${o.block}\n${[...o.fields.values()].join('\n')}`;

    // 写了 `状态` 就以它为准，没写才回退到正文文字启发式。
    // 理由：正文（尤其「备注」）里常出现「后续」「下批」这类词在说别的事，
    // 全文匹配会把已闭环的判据误报成延期。
    const stateTrim = stateText.trim();
    const hasReceiver = OWNER_RE.test(ownerText) && BATCH_RE.test(ownerText);
    const stateOpen = OPEN_STATES.some((s) => stateTrim.startsWith(s));
    // 「待建测试 / 待接线测试」是回填时把跑不到的锚点挪出去的落点。
    // 它意味着「本条点名了要建/要接线但当前跑不到的测试」＝一个登记在案的缺口，
    // 所以：算声明了缺口，也不算闭环。否则这两个栏位就成了没人管的死信。
    const parkedAnchors = o.fields.has('待建测试') || o.fields.has('待接线测试');
    const deferMarked = (stateTrim ? stateOpen : DEFER_RE.test(block)) || parkedAnchors;
    // `out-of-scope`（本版不做）按模板不需要 `归属`，所以它不算「缺口无接收方」；
    // 但它也不是闭环，`closed` 的判定另算。
    const declared = parkedAnchors || (stateTrim
      ? stateOpen
      : (DECLARED_RE.test(testText) || /待补|待建|not_evaluated|缺口/.test(stateText)));
    const declaredOrParked = declared || (stateTrim ? stateTrim.startsWith('out-of-scope') : false);
    const uniq = new Set();

    // ---- 模板字段合规（新模板才查） ----
    if (stateTrim && !STATES.some((s) => stateTrim.startsWith(s))) {
      worklist.push({
        id: o.id, file: o.file, line: o.line, kind: 'unknown-state',
        question: `状态写的是「${stateTrim}」，不在受控取值里。`,
        evidence: [stateTrim], answer_format: `STATES 之一：${STATES.join(' / ')}`,
      });
    }
    if (uncText) {
      for (const k of uncText.split('\n')[0].split(/[,\s|/]+/).filter(Boolean)) {
        if (!UNCERTAIN_KINDS.includes(k)) {
          worklist.push({
            id: o.id, file: o.file, line: o.line, kind: 'unknown-uncertain-kind',
            question: `不确定特征写的是「${k}」，不在受控词表里。`,
            evidence: [uncText], answer_format: `UNCERTAIN_KINDS 之一：${UNCERTAIN_KINDS.join(' / ')}`,
          });
        }
      }
    }

    // ---- S1 延后标记未回收（写了延期，就得有人接） ----
    if (deferMarked && !hasReceiver) {
      const marker = stateTrim || (block.match(DEFER_RE) || [''])[0];
      uniq.add('S1');
      push(o, 'S1', `${stateTrim ? `状态=${marker}` : (marker === '_pending/' ? '有 _pending 承接' : '仅文字延期')}（${marker}）`);
    }

    // ---- S2 / S3 锚点 ----
    const anchorPaths = new Set();
    const anchorNames = [];
    const anchorInfo = anchorsOf(testText);
    for (const a of anchorInfo.parsed) {
      // 只有「文件真的在」的锚点才进名字比对池：文件都不在的锚点已经由 S2 单独报了，
      // 再拿它的用例名去别的文件的池子里比，会凭空多出一条 S3。
      if (a.file.includes('/')) {
        if (fs.existsSync(path.join(ROOT, a.file))) {
          anchorPaths.add(a.file);
          if (a.name) anchorNames.push(a.name);
        } else { uniq.add('S2'); push(o, 'S2', a.file); }
      } else {
        const hits = cases.byBase.get(a.file) || [];
        for (const rel of hits) anchorPaths.add(rel);
        if (hits.length === 0) { uniq.add('S2'); push(o, 'S2', `${a.file}（同名文件在测试目录里也找不到）`); }
        else if (a.name) anchorNames.push(a.name);
      }
    }
    if (anchorInfo.badTokens.length > 0) {
      worklist.push({
        id: o.id, file: o.file, line: o.line, kind: 'test-field-not-machine-readable',
        question: '「测试」栏不是模板规定的锚点写法，程序无法判断它到底指哪条用例。',
        evidence: anchorInfo.badTokens.slice(0, 3),
        answer_format: `每条锚点写成 \`路径${TEST_EXTS[0]}::describe名#用例名\`，多条用逗号分隔；缺口写 状态 + 归属`,
      });
    }

    let nameMiss = 0;
    for (const n of anchorNames) {
      const pool = new Set();
      for (const p of anchorPaths) for (const x of cases.byFile.get(p) || []) pool.add(x);
      if (pool.size === 0) continue;
      if (pool.has(n)) continue;
      // 旧格式常在用例名后追批注（`（已登记）`、`（已建 2026-09-22：…`）⇒ 允许一次前缀匹配，
      // 但只记入待判定清单（低置信），不当 P0。
      const sq = (s) => s.replace(/[\s`]/g, '');
      const sn = sq(n);
      const prefixHit = sn.length >= 8 && [...pool].some((x) => {
        const sx = sq(x);
        return sx.startsWith(sn) || sn.startsWith(sx);
      });
      if (prefixHit) {
        worklist.push({
          id: o.id, file: o.file, line: o.line, kind: 'anchor-prefix-match',
          question: `锚点「${n}」只能靠前缀匹配对上，请确认它指的就是这条用例。`,
          evidence: [...pool].filter((x) => sq(x).startsWith(sn) || sn.startsWith(sq(x))).slice(0, 2),
          answer_format: '确认 ⇒ 回填逐字用例名；否则 ⇒ 状态=pending-test 并写 归属',
        });
        continue;
      }
      nameMiss += 1;
      if (!declared) {
        uniq.add('S3');
        push(o, 'S3', `点名用例「${n}」在该文件里找不到`);
      }
    }
    if (nameMiss > 0 && declared) {
      worklist.push({
        id: o.id, file: o.file, line: o.line, kind: 'declared-gap-with-live-anchor',
        question: '判据既写了缺口声明，又点名了用例，但用例名对不上。要判断：缺口是真的，还是名字写错了？',
        evidence: anchorNames, answer_format: '缺口仍在 ⇒ 状态=pending-*；名字写错 ⇒ 回填正确用例名',
      });
    }

    // ---- S4 无执行通道 ----
    const reachableAnchors = [...anchorPaths].filter((p) => reachable.has(p));
    if (anchorPaths.size > 0 && reachableAnchors.length === 0) {
      uniq.add('S4');
      push(o, 'S4', [...anchorPaths].slice(0, 2).join(', '));
    }

    // ---- S5 不在 CI 清单 ----
    if (expected.used) {
      for (const p of reachableAnchors) {
        const miss = missingInCi.get(p);
        if (miss && miss.length > 0) {
          uniq.add('S5');
          push(o, 'S5', `${p} 有 ${miss.length} 条用例不在 CI 清单：${miss.slice(0, 2).join(' / ')}`);
          break;
        }
      }
    }

    // ---- S6 缺口无接收方 ----
    if (declared && !hasReceiver) {
      uniq.add('S6');
      push(o, 'S6', '缺 owner/接收批次');
      worklist.push({
        id: o.id, file: o.file, line: o.line, kind: 'gap-without-owner',
        question: '判据声明没做完或没验证，但没有写谁接、哪一批接。',
        evidence: [(testText || stateText || '').slice(0, 200)], answer_format: '归属: owner=<名字> 接收批次=<批次或需求ID>',
      });
    }

    // ---- S7 需求说已实现、判据说没做完 ----
    if (deferMarked || declared) {
      const reqIds = [...block.matchAll(/(R-[A-Z]+-\d+)/g)].map((m) => m[1]);
      for (const rid of new Set(reqIds)) {
        const hit = (doneIndex.get(rid) || []).find((l) => STATUS_DONE_RE.test(l.status));
        if (hit) { uniq.add('S7'); push(o, 'S7', `${rid} @ ${hit.rel}:${hit.line} 需求状态「${hit.status.slice(0, 40)}」`); break; }
      }
    }

    // ---- 待判定项：状态与内容自相矛盾 ----
    if (/^closed/.test(stateText) && (deferMarked || uniq.has('S3') || uniq.has('S4'))) {
      worklist.push({
        id: o.id, file: o.file, line: o.line, kind: 'state-says-closed-but-open',
        question: '判据自己写「状态: closed」，但机械检查发现它没闭环。',
        evidence: [...uniq], answer_format: '改状态，或补上缺的证据',
      });
    }
    if (!testText.trim() && !declaredOrParked) {
      worklist.push({
        id: o.id, file: o.file, line: o.line, kind: 'no-test-no-declaration',
        question: '既没写测试锚点，也没声明缺口或"不做"。',
        evidence: [], answer_format: '补测试锚点，或补 状态/归属 声明',
      });
    }

    // 写了延期状态（pending-* / not-evaluated）的条目**不算闭环**：
    // 「缺口有主」只是把缺口登记清楚，不等于缺口已经补上。
    const openByState = stateOpen || stateTrim.startsWith('out-of-scope');
    status.push({ id: o.id, file: o.file, line: o.line, signals: [...uniq].sort(), closed: uniq.size === 0 && !openByState && !parkedAnchors });
  }

  // ---- 读回人工/AI 判定 ----
  let resolved = new Set();
  if (VERDICTS) {
    const vAbs = path.join(ROOT, VERDICTS);
    if (fs.existsSync(vAbs)) {
      try {
        const arr = JSON.parse(fs.readFileSync(vAbs, 'utf8'));
        for (const v of arr) if (v && v.id && (v.verdict === 'resolved' || v.verdict === 'accepted')) resolved.add(`${v.id}|${v.signal || ''}`);
      } catch (e) { console.error(`判定文件读不了：${e.message}`); }
    }
  }

  const active = findings.filter((f) => !resolved.has(`${f.id}|${f.signal}`) && !resolved.has(`${f.id}|`));
  const counts = {};
  for (const k of Object.keys(SIGNALS)) counts[k] = active.filter((f) => f.signal === k).length;
  const closed = status.filter((s) => s.closed).length;

  if (WORKLIST) {
    const abs = path.join(ROOT, WORKLIST);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(worklist, null, 1), 'utf8');
    console.log(`待判定清单已写出：${WORKLIST}（${worklist.length} 条）`);
  }

  if (AS_JSON) {
    emit(JSON.stringify({ total: status.length, closed, open: status.length - closed, counts, findings: active, worklist, status }, null, 1));
    return;
  }

  console.log('=== 判据闭环检查（纯程序）===');
  console.log(`判据 ${status.length} 条 · 闭环 ${closed} 条（${status.length ? (closed / status.length * 100).toFixed(1) : '0'}%）· 未闭环 ${status.length - closed} 条`);
  console.log(`入口：${entries.length} 份 · 可达文件 ${reachable.size} 个 · 用例名 ${cases.all.size} 条${expected.used ? ` · CI 清单 ${expected.bare.size} 条` : ' · 未给 CI 清单（S5 跳过）'}`);
  console.log(`待人工/AI 判定 ${worklist.length} 条（--worklist=<file> 导出）\n`);

  for (const k of Object.keys(SIGNALS)) {
    if (ONLY && ONLY !== k) continue;
    const s = SIGNALS[k];
    console.log(`${k} [${s.level}] ${s.name} —— ${counts[k]} 条`);
    console.log(`    ${s.desc}`);
    for (const it of active.filter((f) => f.signal === k).slice(0, LIMIT)) {
      console.log(`    · ${it.id}  ${it.file}:${it.line}  ${it.detail}`);
    }
    if (counts[k] > LIMIT) console.log(`    … 还有 ${counts[k] - LIMIT} 条（--signal=${k} --limit=N）`);
    console.log('');
  }

  const p0 = active.filter((f) => f.level === 'P0').length;
  const p1 = active.filter((f) => f.level === 'P1').length;
  console.log(`P0 ${p0} 处（会漏验或给出互相矛盾的验收结论）· P1 ${p1} 处 · 待判定 ${worklist.length} 条`);
  if (STRICT && p0 > 0) {
    console.log('--strict：命中 P0 ⇒ exit 1');
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// 自测：造一个最小假工程，逐个信号断言。跨项目复用时先跑它。
// ---------------------------------------------------------------------------

function selfTest() {
  const os = require('node:os');
  const cp = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-closure-'));
  const w = (rel, text) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
  };

  w('docs/oracles/x/oracles.md', [
    '### O-T-001 正常闭环',
    '- 强度: [强]',
    '- 期望: 有锚点且用例存在',
    '- 状态: closed',
    '- 测试: entry/src/test/A.test.ets::A#case one',
    '',
    '### O-T-002 锚点文件不存在',
    '- 强度: [强]',
    '- 测试: entry/src/test/gone/Gone.test.ets::G#whatever',
    '',
    '### O-T-003 用例名对不上',
    '- 强度: [强]',
    '- 测试: entry/src/test/A.test.ets::A#这不是本文件里的用例名',
    '',
    '### O-T-004 无执行通道',
    '- 强度: [强]',
    '- 测试: entry/src/test/B.test.ets::B#case two',
    '',
    '### O-T-005 延后标记且无接收方',
    '- 强度: [强]',
    '- 上游: R-T-1',
    '- 测试: 待补',
    '',
    '### O-T-006 需求说已实现、判据说没做完',
    '- 强度: [强]',
    '- 上游: R-T-2',
    '- 测试: entry/src/test/A.test.ets::A#case one（待补）',
    '',
    '### O-T-007 写了多条 测试 行，第一条点名的文件不存在',
    '- 强度: [强]',
    '- 测试: entry/src/test/gone/Nope.test.ets::N#nope',
    '- 测试: entry/src/test/A.test.ets::A#case one',
    '',
    '### O-T-008 挂着待接线测试，但写了接收方',
    '- 强度: [强]',
    '- 待接线测试: entry/src/test/B.test.ets::B#case two',
    '- 状态: pending-test',
    '- 不确定特征: UNCERTAIN-WIRING',
    '- 归属: owner=tester 接收批次=x',
    '',
    '### O-T-009 挂着待建测试，没有接收方',
    '- 强度: [强]',
    '- 待建测试: entry/src/test/gone/Gone.test.ets::G#whatever',
    '- 状态: pending-test',
    '',
  ].join('\n'));
  w('entry/src/test/List.test.ets', "import a from './A.test';\n");
  w('entry/src/test/A.test.ets', "it('case one', 0, () => {});\n");
  w('entry/src/test/B.test.ets', "it('case two', 0, () => {});\n");
  w('ci/expected.txt', 'entry|A#case one\n');
  w('docs/requirements/r.md', '| R-T-1 | 规则 | 已实现 |\n| R-T-2 | 规则 | 已实现 |\n');

  const out = cp.execFileSync(process.execPath, [
    __filename, `--root=${dir}`, '--json', '--expected=ci/expected.txt', '--tests=entry/src/test',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const j = JSON.parse(out);
  const expect = { S1: 3, S2: 2, S3: 1, S4: 1, S6: 3, S7: 2 };
  let bad = 0;
  for (const [k, v] of Object.entries(expect)) {
    const got = j.counts[k];
    if (got !== v) { console.log(`✗ ${k} 期望 ${v} 实际 ${got}`); bad += 1; }
    else console.log(`✓ ${k} = ${v}`);
  }
  // 闭环口径：写了 pending-* 或挂着 待建/待接线测试 的都不算闭环（缺口有主 ≠ 缺口已补）。
  // 本 fixture 里只有 O-T-001 真的闭环。
  if (j.total !== 9) { console.log(`✗ 判据条数 期望 9 实际 ${j.total}`); bad += 1; }
  else console.log('✓ 判据条数 = 9');
  if (j.closed !== 1) { console.log(`✗ 闭环条数 期望 1 实际 ${j.closed}`); bad += 1; }
  else console.log('✓ 闭环条数 = 1');
  const strict = cp.spawnSync(process.execPath, [
    __filename, `--root=${dir}`, '--strict', '--expected=ci/expected.txt', '--tests=entry/src/test',
  ], { encoding: 'utf8' });
  if (strict.status !== 1) { console.log(`✗ --strict 期望 exit 1 实际 ${strict.status}`); bad += 1; }
  else console.log('✓ --strict 命中 P0 时 exit 1');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(bad === 0 ? '\n自测通过' : `\n自测失败 ${bad} 项`);
  process.exit(bad === 0 ? 0 : 1);
}

if (flag('self-test')) selfTest();
else main();
