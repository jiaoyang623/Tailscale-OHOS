// 设备驱动的 E2E 公共件。
//
// 本项目的真实入口在设备上：用户从桌面打开 MeshArc，界面动作经 EntryAbility
// 走到 VPN 扩展与后端。所以 E2E 从这里驱动设备，而不是在主机上另造一套界面假件。
//
// 三条命令是实测选定的：
//   hdc shell aa force-stop / aa start   冷启动，比 devecocli run 轻，且不重装
//   hdc shell hilog                       设备日志。devecocli log --follow 在脚本里
//                                         跑约 28 秒后会停止输出而进程仍活着，不能用
//   devecocli ui layout / ui click        读界面结构与点击。ui layout 的进度行走
//                                         stderr，只取 stdout 才是合法 JSON
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const BUNDLE = 'ren.w2h.mesharc';
export const HDC =
  process.env.HDC || '/opt/harmony/sdk/sdk/default/openharmony/toolchains/hdc';

export function serial() {
  const value = process.env.DEVICE;
  if (!value) {
    throw new Error('未指定设备。设 DEVICE=<序列号>；用 hdc list targets 看有哪些设备。');
  }
  return value;
}

function hdc(args, options = {}) {
  return execFileSync(HDC, ['-t', serial(), ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options
  });
}

// --device 是子命令的选项，不是全局选项：放在子命令之后。
function devecocli(command, args = []) {
  return execFileSync('devecocli', [...command, '--device', serial(), ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024
  });
}

export function forceStop() {
  try {
    hdc(['shell', 'aa', 'force-stop', BUNDLE]);
  } catch (_error) {
    // 应用本来就没在跑时这条会失败，那不是错误。
  }
}

// 应用私有目录。100 是这台设备上的用户号，换设备要重新确认。
const FILES_DIR = `/data/app/el2/100/base/${BUNDLE}/haps/entry/files`;

// 读应用私有目录下的一个文件。读不到就返回空串，由调用方判空。
// 用 `shell -b <包名>` 以应用自己的身份读，不靠目录权限放行。
export function readAppFile(name) {
  try {
    return hdc(['shell', '-b', BUNDLE, 'cat', `${FILES_DIR}/${name}`]);
  } catch (_error) {
    return '';
  }
}

// 读会话账本。每个写者一个文件，旧版单文件只读。
// 返回按时间升序合并、按 sessionId + kind 去重后的条目。
export function readLedgerEntries() {
  const names = [
    'vpn-session-ledger-vpn.ndjson',
    'vpn-session-ledger-ui.ndjson',
    'vpn-session-ledger.ndjson'
  ];
  const entries = [];
  for (const name of names) {
    for (const line of readAppFile(name).split('\n')) {
      if (!line.trim()) {
        continue;
      }
      try {
        entries.push(JSON.parse(line));
      } catch (_error) {
        // A torn last line is not an entry.
      }
    }
  }
  entries.sort((left, right) => left.timestampMs - right.timestampMs);
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.sessionId}|${entry.kind}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

// 应用是否写过某个标记文件。用它判断一次性界面（欢迎框等）的开关状态。
export function appFileExists(name) {
  try {
    return hdc(['shell', '-b', BUNDLE, `test -f ${FILES_DIR}/${name} && echo yes`])
      .trim() === 'yes';
  } catch (_error) {
    return false;
  }
}

// 读应用私有目录下的一个 JSON 文件。读不到或不是合法 JSON 都返回 null。
// 界面文案会变，落盘的数据不会，所以能用数据判的就用数据判。
export function readAppJson(name) {
  const text = readAppFile(name);
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

// 拉起应用，可带 Want 参数（--ps 字符串、--pi 整数、--pl 长整数、--pb 布尔）。
// 通知动作就是靠这条路复现的：通知的 Want 与这里构造的一致。
export function startAppWithParams(ability, params = {}) {
  const args = ['shell', 'aa', 'start', '-a', ability, '-b', BUNDLE];
  for (const [key, value] of Object.entries(params)) {
    const flag = typeof value === 'boolean' ? '--pb'
      : typeof value === 'number' ? (Number.isInteger(value) ? '--pi' : '--pl') : '--ps';
    args.push(flag, key, String(value));
  }
  return hdc(args);
}

// 注入返回键。退出设置详情页、关掉系统分享面板都要用。
export function pressBack() {
  return keyEvent('Back');
}

// 节点的 bounds（[left, top, right, bottom]）。找不到返回 null。
export function boundsOfId(id) {
  let hit = null;
  const walk = (node) => {
    if (hit || !node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.id === id && Array.isArray(node.bounds)) {
      hit = node.bounds;
      return;
    }
    walk(node.children || []);
  };
  walk(layout());
  return hit;
}

// 屏幕锁着时 aa start 会失败，报 10106102「The device screen is locked」。
// screen-off-survival 用 power-shell suspend 锁屏，唤醒后停在锁屏界面，
// 排在它后面的用例就全都起不来。这个坑现在看不出来，因为那个文件按字母排最后。
// 解锁只要上滑：这台设备没设密码。
// 坐标是实测的屏幕中心与底部，不随页面变化。
export function unlockScreen() {
  try {
    hdc(['shell', 'power-shell wakeup']);
  } catch (_error) {
    // 屏幕已经亮着时这条也会失败，不是错误。
  }
  sleepSync(1200);
  try {
    hdc(['shell', 'uitest uiInput swipe 660 2000 660 700 300']);
  } catch (_error) {
    // 没有锁屏时这条不报错；真报错也不该挡住后面的启动尝试。
  }
  sleepSync(800);
}

export function startApp() {
  const first = attemptStart();
  if (!/10106102|screen is locked/i.test(first)) {
    return first;
  }
  unlockScreen();
  return attemptStart();
}

function attemptStart() {
  try {
    return hdc(['shell', 'aa', 'start', '-a', 'EntryAbility', '-b', BUNDLE]);
  } catch (error) {
    // 非零退出时 execFileSync 抛错，失败原因在 stdout / stderr 上。
    return `${error.stdout || ''}${error.stderr || ''}${error.message || ''}`;
  }
}

// 同步等待。E2E 的 before 钩子是异步的，但解锁这两步之间必须真等屏幕亮起来。
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// 界面结构。只取 stdout：进度行在 stderr 上，混进来就不是合法 JSON。
export function layout() {
  const text = devecocli(['ui', 'layout'], ['--format', 'json', '--mode', 'full']);
  return JSON.parse(text);
}

export function layoutTexts() {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    for (const key of ['text', 'content', 'description']) {
      const value = node[key];
      if (typeof value === 'string' && value.trim()) {
        found.push(value.trim());
      }
    }
    walk(node.children || []);
  };
  walk(layout());
  return found;
}

// 按文本找可点节点，返回中心坐标。找不到返回 null。
export function centerOf(text) {
  let hit = null;
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    const value = node.text || node.content || node.description || '';
    const bounds = node.bounds;
    if (!hit && typeof value === 'string' && value.includes(text) && Array.isArray(bounds)) {
      hit = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
    }
    walk(node.children || []);
  };
  walk(layout());
  return hit;
}

export function click(x, y) {
  return devecocli(['ui', 'click'], [String(Math.round(x)), String(Math.round(y))]);
}

// 按节点 id 点击。比坐标稳：坐标会随布局变动，id 不会。
export function clickId(id) {
  return devecocli(['ui', 'click'], ['--id', id]);
}

// 取节点的界面文本，按 id 找。找不到返回 null。
export function textOfId(id) {
  let hit = null;
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    if (node.id === id) {
      hit = (node.text || node.content || node.description || '').trim();
      return;
    }
    walk(node.children || []);
  };
  walk(layout());
  return hit;
}

// 连续快速点击。解锁诊断要求在 1500 ms 内点满 5 次
// （BridgeStatus.ets:4958），而每次 devecocli ui click 要起一个进程，来不及。
// 设备侧的 uitest 快得多，所以这一条走它。
export function fastTap(x, y, times) {
  const command = `for i in $(seq 1 ${times}); do uitest uiInput click ${Math.round(x)} ${Math.round(y)}; done`;
  return hdc(['shell', command]);
}

// 按节点 id 取中心坐标。找不到返回 null。
export function centerOfId(id) {
  let hit = null;
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    if (node.id === id && Array.isArray(node.bounds)) {
      hit = [(node.bounds[0] + node.bounds[2]) / 2, (node.bounds[1] + node.bounds[3]) / 2];
      return;
    }
    walk(node.children || []);
  };
  walk(layout());
  return hit;
}

// 可点区域的下边界。页签栏顶边是硬边界；窗口底边之外的点也点不到。
// 页签栏与窗口节点都从当前布局树里取，不写死像素。
function clickLimitOf(all) {
  let limit = Number.POSITIVE_INFINITY;
  for (const node of all) {
    if (node.bounds === null) {
      continue;
    }
    if (node.id.startsWith('tab-')) {
      limit = Math.min(limit, node.bounds[1]);
    }
    if (node.id === 'shell-window-host') {
      limit = Math.min(limit, node.bounds[3] - 4);
    }
  }
  return limit;
}

// 往下滚到某个 id 出现，**并且在可点区域内**。设置页比一屏长，直接找会找不到。
// 页签栏不在布局树里时（二级页盖住它），可点区域到窗口底边为止。
// 每次滑动后都复查一次，最后一次滑动也算数。滑动不生效时节点位置不变，
// 连续三次读到同一位置就判到底，不再空滑。2026-10-22 实测生成报告按钮
// 第 8 次滑动后才进入树里，第 9 次才升到页签栏上方。
export async function scrollToId(id, maxSwipes = 6) {
  let lastTop = null;
  let still = 0;
  for (let i = 0; i <= maxSwipes; i++) {
    const all = nodes();
    const limit = clickLimitOf(all);
    const hit = all.find((node) => node.id === id && node.center !== null);
    if (hit && hit.center[1] < limit) {
      return hit.center;
    }
    if (hit && hit.bounds[1] === lastTop) {
      still += 1;
      if (still >= 2) {
        return null;
      }
    } else {
      still = 0;
    }
    lastTop = hit ? hit.bounds[1] : null;
    if (i === maxSwipes) {
      break;
    }
    swipeUp();
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  return null;
}

// 按坐标点击（拿到 scrollToId 的结果之后用它，避免 --id 点到页签栏）。
export function clickAt(point) {
  return devecocli(['ui', 'click'], [String(Math.round(point[0])), String(Math.round(point[1]))]);
}

// 平铺当前的界面树，产出 { id, text, center } 列表。
//
// 现有的导出只能按文本或 id 找**一个**节点。要数「home-peer-* 有几行」、
// 要在一堆同名节点里挑一个，都得自己遍历。这里是那个遍历。
export function nodes() {
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    const bounds = node.bounds;
    found.push({
      id: node.id || '',
      text: (node.text || node.content || node.description || '').trim(),
      bounds: Array.isArray(bounds) ? bounds : null,
      center: Array.isArray(bounds)
        ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
        : null
    });
    walk(node.children || []);
  };
  walk(layout());
  return found;
}

// 点离 anchor 最近的那个 target。
//
// 系统对话框的按钮和面板里的按钮会用同一份文案（登出的「退出登录」两处都叫
// logout_action），按文本找会找到错的那个。按距离分开：对话框的按钮离它的标题最近。
export function clickNearText(anchor, target) {
  const all = nodes().filter((node) => node.center);
  const anchors = all.filter((node) => node.text.includes(anchor));
  const targets = all.filter((node) => node.text.includes(target));
  if (!anchors.length || !targets.length) {
    return null;
  }
  let best = null;
  let bestDistance = Infinity;
  for (const from of anchors) {
    for (const to of targets) {
      const distance = Math.hypot(to.center[0] - from.center[0], to.center[1] - from.center[1]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = to;
      }
    }
  }
  click(best.center[0], best.center[1]);
  return best;
}

// 所有以某个前缀开头的 id。用来数 `home-peer-*`、`taildrive-entry-*` 这类成组的行。
export function nodesWithIdPrefix(prefix) {
  return nodes().filter((node) => node.id.startsWith(prefix));
}

// 读一个节点的状态位。开关的禁用态、勾选态只能从这里得到：
// 布局树里的文本读不出 checked，靠文案侧证会漏。
export function nodeState(id) {
  let hit = null;
  const walk = (node) => {
    if (hit || !node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.id === id) {
      hit = {
        clickable: node.clickable === true,
        enabled: node.enabled !== false,
        checkable: node.checkable === true,
        checked: node.checked === true,
        text: (node.text || node.content || node.description || '').trim()
      };
      return;
    }
    walk(node.children || []);
  };
  walk(layout());
  return hit;
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 等界面出现某段文字。可给数组或正则：中英双语的几种写法都列上，命中任一即算。
// 设备当前是 zh_CN，只写英文会等不到。
export async function waitForText(text, timeoutMs = 15000) {
  const wanted = Array.isArray(text) ? text : [text];
  const matches = (line) => wanted.some((want) =>
    (want instanceof RegExp ? want : new RegExp(escapeRegExp(want))).test(line));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (layoutTexts().some(matches)) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await settle(700);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 当前连没连上。按按钮 id 判，不按日志里的 vpn_connected 判：
// 那类事件在本次运行里可能早就出现过，再等会立刻命中旧行。
export function connected() {
  return Boolean(centerOfId('vpn-stop'));
}

// 按界面判连接态。连上了就立刻返回，没连上就等到超时。
export async function waitForConnected(timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (connected()) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await settle(1500);
  }
}

// 等界面上的某段文字消失。用途：等对话框关掉、等加载态过去。
export async function waitForTextGone(text, timeoutMs = 15000) {
  const wanted = Array.isArray(text) ? text : [text];
  const matches = (line) => wanted.some((want) =>
    (want instanceof RegExp ? want : new RegExp(escapeRegExp(want))).test(line));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!layoutTexts().some(matches)) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await settle(700);
  }
}

// 等某个 id 出现。按 id 等不受语言影响，比按文案等稳。
export async function waitForId(id, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (centerOfId(id)) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await settle(700);
  }
}

// 往输入框写字。先把焦点点过去，再让设备侧把文本送进焦点。
//
// 只能追加，清不掉已有内容：devecocli 的 ui 没有清空或全选，
// 删字要走 `uitest uiInput keyEvent <删除键码>`，而那个键码还没在真机上验过。
// 所以用例要设计成不需要清空输入框，或者另找入口。
export function setFieldText(id, text) {
  const point = centerOfId(id);
  if (!point) {
    return false;
  }
  click(point[0], point[1]);
  devecocli(['ui', 'text'], [text]);
  return true;
}

// 把应用切到后台再切回来。测回前台这类行为用。
export async function cycleForeground() {
  sendHome();
  await settle(2500);
  startApp();
  await settle(2500);
}

// 首页设备列表里的对端行，按渲染顺序。
//
// 本机行常驻，在线与离线分组只在非空时出现（O-DEV-01）。分组归属靠分组标题的
// 位置判定：一行属于它上方最近的那个分组标题。
const LOCAL_GROUPS = ['本机', 'This device'];
const ONLINE_GROUPS = ['在线', 'Online'];
const OFFLINE_GROUPS = ['离线', 'Offline'];

export function homePeerRows() {
  const all = nodes().filter((node) => node.center);
  const headings = all
    .filter((node) => [...LOCAL_GROUPS, ...ONLINE_GROUPS, ...OFFLINE_GROUPS]
      .some((label) => node.text === label))
    .sort((a, b) => a.center[1] - b.center[1]);

  const groupAt = (node) => {
    let name = 'unknown';
    for (const heading of headings) {
      if (heading.center[1] <= node.center[1]) {
        if (LOCAL_GROUPS.includes(heading.text)) {
          name = 'local';
        } else if (ONLINE_GROUPS.includes(heading.text)) {
          name = 'online';
        } else {
          name = 'offline';
        }
      }
    }
    return name;
  };

  return all
    .filter((node) => /^home-peer-/.test(node.id))
    .map((node) => ({ id: node.id, name: node.text, center: node.center, group: groupAt(node) }))
    .map((row) => ({ ...row, online: row.group === 'online' }));
}

export function swipeUp() {
  return devecocli(['ui', 'swipe'], ['660', '1500', '660', '600']);
}

// 注入按键。设备自己的 `uitest uiInput help` 写明可取 keyID 或 Back/Home/Power。
// 走设备侧的 uitest，不走 devecocli：devecocli 的 ui 命令只覆盖点击与滑动。
export function keyEvent(key) {
  return hdc(['shell', `uitest uiInput keyEvent ${key}`]);
}

// 回到桌面。用来把应用切到后台，测连接窗口期与后台重连。
// 实测 2026-10-13：发这条之后设备日志出现 `background_entered`。
export function sendHome() {
  return keyEvent('Home');
}

export function clickText(text) {
  const point = centerOf(text);
  if (!point) {
    return false;
  }
  click(point[0], point[1]);
  return true;
}

// 点底部页签。应用会恢复上次的页签，连接状态只在「设备」页。
// 取精确文本的最后一次命中：页签在窗口树末尾，标题可能包含同样的字。
export function clickBottomTab(label) {
  let hit = null;
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    if (node.text === label && Array.isArray(node.bounds)) {
      hit = [(node.bounds[0] + node.bounds[2]) / 2, (node.bounds[1] + node.bounds[3]) / 2];
    }
    walk(node.children || []);
  };
  walk(layout());
  if (!hit) {
    return false;
  }
  click(hit[0], hit[1]);
  return true;
}

export function screenshot(name) {
  const path = join(mkdtempSync(join(tmpdir(), 'mesharc-e2e-')), `${name}.png`);
  devecocli(['ui', 'screenshot'], ['--path', path]);
  return path;
}

// 设备日志。用 hdc hilog 持续读，按包名就地过滤。
// 长跑时 hdc 连接可能断开。断开后自动重连。重连会把设备缓冲区的旧行再回放一次，
// 所以按整行去重。整行带毫秒时间戳，重放行完全相同，新行不会误伤。
export class LogStream {
  constructor() {
    this.lines = [];
    this.seen = new Set();
    this.child = null;
    this.buffer = '';
    this.stopped = false;
    this.restartTimer = null;
  }

  start() {
    // 先清空设备日志缓冲区。不清的话起流时会把整段历史回放进来，
    // 断言就会命中上一次运行留下的事件。
    try {
      hdc(['shell', 'hilog', '-r']);
    } catch (_error) {
      // 清不掉不致命，只是断言可能偏松。
    }
    this.stopped = false;
    this.seen = new Set();
    this.spawnStream();
    return this;
  }

  spawnStream() {
    const child = spawn(HDC, ['-t', serial(), 'shell', 'hilog'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.child = child;
    const take = (chunk) => {
      this.buffer += chunk.toString();
      const parts = this.buffer.split('\n');
      this.buffer = parts.pop();
      for (const line of parts) {
        if (!line.includes(BUNDLE) || this.seen.has(line)) {
          continue;
        }
        this.seen.add(line);
        this.lines.push(line);
      }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', () => {});
    child.on('exit', () => {
      if (this.child !== child) {
        return;
      }
      this.child = null;
      this.buffer = '';
      if (this.stopped) {
        return;
      }
      this.restartTimer = setTimeout(() => {
        if (!this.stopped) {
          this.spawnStream();
        }
      }, 2000);
    });
  }

  stop() {
    this.stopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
  }

  // 等到某个模式出现，返回匹配行；超时返回 null。
  //
  // 注意：这条每次都从头扫。同一轮里第二次等同一个事件名时，它会命中第一次那行。
  // 需要「这一次才出现」的语义时，先用 mark() 取位置，再用 waitForAfter()。
  async waitFor(pattern, timeoutMs = 20000) {
    return this.waitForAfter(0, pattern, timeoutMs);
  }

  // 取当前位置。拿它当分界线，把「之前」和「之后」分开。
  mark() {
    return this.lines.length;
  }

  // 从分界线之后开始等。mark 之前已经有的事件不会被算进来。
  async waitForAfter(mark, pattern, timeoutMs = 20000) {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    const deadline = Date.now() + timeoutMs;
    let index = mark;
    while (Date.now() < deadline) {
      while (index < this.lines.length) {
        if (regex.test(this.lines[index])) {
          return this.lines[index];
        }
        index++;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }

  // 从分界线之后数命中条数。用来断言「期间没有出现过某事件」。
  countAfter(mark, pattern) {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    return this.lines.slice(mark).filter((line) => regex.test(line)).length;
  }

  dump(path) {
    writeFileSync(path, `${this.lines.join('\n')}\n`, 'utf8');
    return path;
  }
}

// 设备日志的 hilog 行以 MM-DD HH:MM:SS.mmm 开头。
const STAMP = /^(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d\d\d)/;

export function stamp(line) {
  const found = STAMP.exec(line);
  if (!found) {
    return null;
  }
  const [, , , h, m, s, ms] = found;
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}
