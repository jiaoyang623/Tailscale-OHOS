import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

// 集成：两个真实模块经真实落盘路径交接。
//
// 被测的是 `DiagnosticEventStore`（写盘）与 `DiagnosticPrivacy`（脱敏边界）这一对，
// 两者都是**真实 .ets 源码**，在同一个沙箱里按生产顺序装配：脱敏边界先定义，
// 事件存储的模块级常量才取得到它。桩只有一个 —— fileIo，换成一个内存文件系统，
// 因为落盘是这条接缝唯一接触平台的地方。
//
// 这条接缝的问题是「两个进程各写各的文件，却共用一个脱敏边界」：接口两边一致吗？
// 断言的是落盘文本，不是内存里的对象 —— 日志里出现的东西才是会离开设备的东西。

const HERE = import.meta.url;

function loadClass(relPath, exportName) {
  const source = readFileSync(new URL(relPath, HERE), 'utf8');
  return stripTypeScriptTypes(source
    .replace(/^import .*;\r?$/gm, '')
    .replace(`export class ${exportName}`, `class ${exportName}`));
}

const privacySource = loadClass('../../entry/src/main/ets/services/DiagnosticPrivacy.ets',
  'DiagnosticPrivacy');
const storeSource = loadClass('../../entry/src/main/ets/services/DiagnosticEventStore.ets',
  'DiagnosticEventStore');

function fixture() {
  const f = { files: new Map(), clock: 1_000_000, logs: [] };
  const sandbox = {
    Date: { now: () => f.clock++ },
    // The device log is the only channel a host-side run can read back without
    // a file transfer, so every recorded event also has to reach hilog.
    hilog: { info: (_domain, _tag, format, ...args) => f.logs.push([format, ...args].join(' ')) },
    fileIo: {
      OpenMode: { CREATE: 1, WRITE_ONLY: 2, TRUNC: 4 },
      accessSync: (p) => f.files.has(p),
      readTextSync: (p) => (f.files.has(p) ? f.files.get(p) : ''),
      // 生产代码每次重写整个文件，所以 writeSync 是覆盖而不是追加。
      openSync: (p, mode) => {
        if (mode & 4) f.files.set(p, '');
        else if (!f.files.has(p)) f.files.set(p, '');
        return { fd: p };
      },
      writeSync: (fd, content) => { f.files.set(fd, content); return content.length; },
      closeSync: () => {}
    }
  };
  // 顺序有意义：事件存储的模块级常量引用了脱敏边界的常量。
  vm.runInNewContext(`${privacySource}\n${storeSource}\nglobalThis.S = DiagnosticEventStore;`
    + 'globalThis.P = DiagnosticPrivacy;', sandbox);
  f.store = sandbox.S;
  f.privacy = sandbox.P;
  f.events = (name) => (f.files.get(`/files/${name}`) || '').split('\n').filter((l) => l.trim());
  return f;
}

const SECRET_URL = 'https://controlplane.tailscale.com/key?token=t-9f8e7d6c5b4a';
const BEARER = 'Bearer tskey-auth-kX9secret';

test('两进程落盘文本共用脱敏边界且超限淘汰最旧', async () => {
  const f = fixture();

  // 共用脱敏边界：日志文本里的 URL、bearer、令牌键值都要被替换掉。
  const redacted = f.privacy.redactForLog(`connect failed ${SECRET_URL} ${BEARER} password=hunter2`);
  assert.ok(!redacted.includes('t-9f8e7d6c5b4a'), `URL 令牌没被脱敏：${redacted}`);
  assert.ok(!redacted.includes('kX9secret'), `bearer 没被脱敏：${redacted}`);
  assert.ok(!redacted.includes('hunter2'), `密码没被脱敏：${redacted}`);
  assert.match(redacted, /<redacted>/);

  // 两进程各写自己的文件：同一个边界，两个出口。
  f.store.record('/files', 'ui', 'connect_requested', 'preflight');
  f.store.record('/files', 'vpn', 'vpn_tun_created', 'create');
  assert.equal(f.events('diagnostic-ui-events.ndjson').length, 1);
  assert.equal(f.events('diagnostic-vpn-events.ndjson').length, 1);
  assert.ok(f.events('diagnostic-vpn-events.ndjson')[0].includes('vpn_tun_created'));
  assert.ok(f.events('diagnostic-ui-events.ndjson')[0].includes('connect_requested'));

  // 落盘的每个字段都过同一条边界：把秘密塞进事件名，磁盘上不许出现原文。
  f.store.record('/files', 'ui', `handoff ${SECRET_URL}`, `phase ${BEARER}`);
  const dumped = f.events('diagnostic-ui-events.ndjson').join('\n');
  assert.ok(!dumped.includes('t-9f8e7d6c5b4a'), `URL 令牌落盘了：${dumped}`);
  assert.ok(!dumped.includes('kX9secret'), `bearer 落盘了：${dumped}`);
  assert.ok(!dumped.includes('https://'), `URL 结构落盘了：${dumped}`);

  // 超限淘汰最旧：每文件上限 100 条，超出丢最早的那条。
  const g = fixture();
  const limit = g.privacy.MAX_EVENTS_PER_FILE;
  assert.equal(limit, 100);
  for (let i = 0; i < limit + 30; i++) {
    g.store.record('/files', 'ui', `event_${i}`, 'probe');
  }
  const kept = g.events('diagnostic-ui-events.ndjson');
  assert.equal(kept.length, limit, '超出上限没有裁剪到上限');
  assert.ok(kept[0].includes('event_30'), `最旧的没有先丢：首条是 ${kept[0]}`);
  assert.ok(kept[kept.length - 1].includes(`event_${limit + 29}`), '最新的一条被丢掉了');
  assert.ok(!g.files.get('/files/diagnostic-ui-events.ndjson').includes('event_29'),
    '第 30 条之前的事件本应被淘汰');
});

test('every recorded event also reaches the device log, redacted', async () => {
  // A single device run collects the whole timeline from the device log.
  // Without this mirror the event files stay on the device and the run has to
  // fall back on manual export.
  const f = fixture();
  f.store.record('/files', 'ui', 'connect_requested', 'preflight');
  assert.equal(f.logs.length, 1, 'the event did not reach the device log');
  assert.ok(f.logs[0].includes('connect_requested'), `unexpected log line: ${f.logs[0]}`);
  assert.ok(f.logs[0].includes('preflight'), `unexpected log line: ${f.logs[0]}`);

  f.store.record('/files', 'vpn', `handoff ${SECRET_URL}`, `phase ${BEARER}`);
  const dumped = f.logs.join('\n');
  assert.ok(!dumped.includes('t-9f8e7d6c5b4a'), `URL token reached the device log: ${dumped}`);
  assert.ok(!dumped.includes('kX9secret'), `bearer reached the device log: ${dumped}`);
});
