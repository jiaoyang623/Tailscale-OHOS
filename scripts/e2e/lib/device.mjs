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

export function startApp() {
  return hdc(['shell', 'aa', 'start', '-a', 'EntryAbility', '-b', BUNDLE]);
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

export function clickText(text) {
  const point = centerOf(text);
  if (!point) {
    return false;
  }
  click(point[0], point[1]);
  return true;
}

export function screenshot(name) {
  const path = join(mkdtempSync(join(tmpdir(), 'mesharc-e2e-')), `${name}.png`);
  devecocli(['ui', 'screenshot'], ['--path', path]);
  return path;
}

// 设备日志。用 hdc hilog 持续读，按包名就地过滤。
export class LogStream {
  constructor() {
    this.lines = [];
    this.child = null;
    this.buffer = '';
  }

  start() {
    // 先清空设备日志缓冲区。不清的话起流时会把整段历史回放进来，
    // 断言就会命中上一次运行留下的事件。
    try {
      hdc(['shell', 'hilog', '-r']);
    } catch (_error) {
      // 清不掉不致命，只是断言可能偏松。
    }
    this.child = spawn(HDC, ['-t', serial(), 'shell', 'hilog'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const take = (chunk) => {
      this.buffer += chunk.toString();
      const parts = this.buffer.split('\n');
      this.buffer = parts.pop();
      for (const line of parts) {
        if (line.includes(BUNDLE)) {
          this.lines.push(line);
        }
      }
    };
    this.child.stdout.on('data', take);
    this.child.stderr.on('data', take);
    return this;
  }

  stop() {
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
    }
  }

  // 等到某个模式出现，返回匹配行；超时返回 null。
  async waitFor(pattern, timeoutMs = 20000) {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    const deadline = Date.now() + timeoutMs;
    let index = 0;
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
