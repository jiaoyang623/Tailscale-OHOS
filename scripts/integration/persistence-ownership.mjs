import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

// 集成：同一个「持久化所有权」接缝上的两种载体 —— 应用进程独占的配置文件
// （ControlServerConfig，原子写 + 缺证据回落）与 ArkData 偏好（AnimationPreferences，
// 缺键取默认）。断言的是**跨模块一致的那条契约**：谁拥有、半写怎么办、没有值时取什么。
//
// 两个模块都是真实 .ets 源码。桩是它们的平台面：fileIo 换成内存文件系统，
// preferences 换成一个真的按 key 存取的映射（getSync 的第二参数就是默认值语义本身）。

const HERE = import.meta.url;

function loadClass(relPath, exportName) {
  const source = readFileSync(new URL(relPath, HERE), 'utf8');
  // 这两个文件除了 class 还有 export const / export interface，统一去掉行首 export。
  return stripTypeScriptTypes(source
    .replace(/^import .*;\r?$/gm, '')
    .replace(/^export\s+/gm, ''));
}

const configSource = loadClass('../../entry/src/main/ets/services/ControlServerConfig.ets',
  'ControlServerConfig');
const prefsSource = loadClass('../../entry/src/main/ets/services/AnimationPreferences.ets',
  'AnimationPreferences');

function fixture() {
  const f = { files: new Map(), failWrite: false, clock: 1_700_000_000_000 };
  const sandbox = {
    Date: { now: () => f.clock++ },
    fileIo: {
      OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4 },
      accessSync: (p) => f.files.has(p),
      readTextSync: (p) => (f.files.has(p) ? f.files.get(p) : ''),
      openSync: (p, mode) => {
        if (mode & 4) f.files.set(p, '');
        else if (!f.files.has(p)) f.files.set(p, '');
        return { fd: p };
      },
      writeSync: (fd, content) => {
        if (f.failWrite) throw new Error('disk full');
        f.files.set(fd, content);
      },
      closeSync: () => {},
      renameSync: (from, to) => {
        if (!f.files.has(from)) throw new Error('no such file');
        f.files.set(to, f.files.get(from));
        f.files.delete(from);
      },
      unlinkSync: (p) => { f.files.delete(p); }
    },
    preferences: {
      getPreferences: async (_context, name) => ({
        name,
        // 真实语义：键不存在就返回调用方给的默认值 —— 这条就是「缺键取默认」。
        getSync: (key, fallback) => (f.prefs && Object.prototype.hasOwnProperty.call(f.prefs, key)
          ? f.prefs[key] : fallback)
      })
    }
  };
  vm.runInNewContext(`${configSource}\n${prefsSource}\nglobalThis.C = ControlServerConfig;`
    + 'globalThis.A = AnimationPreferences;', sandbox);
  f.config = sandbox.C;
  f.prefsClass = sandbox.A;
  f.tempFiles = () => [...f.files.keys()].filter((p) => p.endsWith('.tmp'));
  return f;
}

const CONFIG_PATH = '/files/control-server.json';

test('半写配置回落未配置态且偏好缺键取默认', async () => {
  // ---- 缺证据回落：不是「有文件就当配置好了」 ----
  const f = fixture();
  assert.equal(f.config.load('/files').confirmed, false, '没有文件时应是未配置态');

  f.files.set(CONFIG_PATH, '{"controlURL":"https://exa');           // 半写
  assert.equal(f.config.load('/files').confirmed, false, '半写的 JSON 必须回落未配置态');

  f.files.set(CONFIG_PATH, JSON.stringify({ controlURL: 'https://control.example',
    confirmed: false, updatedAtMs: 1 }));
  assert.equal(f.config.load('/files').confirmed, false, '未确认的配置不算已配置');

  f.files.set(CONFIG_PATH, JSON.stringify({ controlURL: 'not-a-url',
    confirmed: true, updatedAtMs: 1 }));
  assert.equal(f.config.load('/files').confirmed, false, '非法地址必须被回落而不是照用');

  // ---- 原子写：先写临时件再改名，读回来的是归一化后的值 ----
  const saved = f.config.save('/files', 'https://control.example/');
  assert.ok(saved, '保存应该成功');
  assert.equal(saved.controlURL, 'https://control.example', '末尾斜杠没有被归一化掉');
  assert.deepEqual(f.tempFiles(), [], '保存后不该留下临时件');
  const loaded = f.config.load('/files');
  assert.equal(loaded.confirmed, true);
  assert.equal(loaded.controlURL, 'https://control.example');

  // ---- 保存失败：不落半成品，也不留临时件 ----
  const g = fixture();
  g.failWrite = true;
  assert.equal(g.config.save('/files', 'https://control.example'), undefined, '写失败应返回 undefined');
  assert.equal(g.config.load('/files').confirmed, false, '写失败后不该读到半成品');
  assert.deepEqual(g.tempFiles(), [], '写失败后临时件必须被清掉');

  // ---- 偏好缺键取默认：所有权在这一层，缺值不抛错也不写坏 ----
  const h = fixture();
  const defaults = h.prefsClass.defaults();
  h.prefs = {};
  assert.deepEqual(await h.prefsClass.load({}), defaults, '空偏好应取全部默认值');

  h.prefs = { animation_duration: 80 };
  const partial = await h.prefsClass.load({});
  assert.equal(partial.duration, 80, '已存在的键没有被采用');
  assert.equal(partial.preset, defaults.preset, '缺失的键没有取默认值');
  assert.equal(partial.amplitude, defaults.amplitude);
  assert.equal(partial.damping, defaults.damping);

  // 所有权包含「不信任磁盘上的值」：越界或非数字一律被规范回默认/边界，
  // 而不是把 120 当成合法的 120 用下去。
  h.prefs = { animation_duration: 120, animation_amplitude: -5, animation_preset: 9 };
  const clamped = await h.prefsClass.load({});
  assert.equal(clamped.duration, 100, '超过上限的持久值没有被夹到 100');
  assert.equal(clamped.amplitude, 0, '低于下限的持久值没有被夹到 0');
  assert.equal(clamped.preset, defaults.preset, '越界的 preset 没有回落默认');
});
