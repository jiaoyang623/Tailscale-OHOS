// E2E · 控制服务器配置。兼作 O-SETUP-02 的真机证据。
//
// 判据 O-SETUP-02：非法地址被拒，明文 HTTP 需显式确认风险。
// 触发条件：未连接时，用户在设置页输入控制服务器地址并确认。
//
// 本用例观察的界面节点、文件与诊断事件，源码位置如下：
//   control-server-input   输入框       BridgeStatus.ets:11668
//   control-server-save    保存按钮     BridgeStatus.ets:11718
//   control-server-edit    打开编辑器   BridgeStatus.ets:11806
//   control_server_editor_opened   BridgeStatus.ets:1676
//   control_server_confirm_failed  BridgeStatus.ets:1689
//   control_server_confirmed       BridgeStatus.ets:1735
//   落盘文件 control-server.json  ControlServerConfig.ets:12
//   地址校验 ControlServerConfig.ets:22 normalize
//
// 可达性：编辑器只在未登录态的账户面板里，且已确认时默认折叠。
//   controlServerEditorVisible = !confirmed（BridgeStatus.ets:1252）
//   打开按钮在 `if (!isAuthenticated())` 分支里（BridgeStatus.ets:11838）
// 登录之后编辑器就不可达。本用例不许登出，所以已登录的设备会跳过。
//
// 前置：控制服务器编辑器可达（未登录或未确认）。否则本用例跳过。
// 连接态下保存按钮被禁用（BridgeStatus.ets:11719），所以 before 先断开连接。
//
//   DEVICE=<序列号> node --test scripts/e2e/control-server.mjs
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  LogStream, clickId, forceStop, layoutTexts, readAppFile, serial, startApp, textOfId
} from './lib/device.mjs';

const OUT = process.env.E2E_OUT || join(homedir(), 'mesharc-e2e');
const EVIDENCE = join(OUT, `control-server-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const NO_EDITOR =
  '登录后控制服务器编辑器不可达（BridgeStatus.ets:11838、1252）。本用例不许登出，跳过。换一台未登录或未确认控制服务器的设备再跑。';
const CONFIG_FILE = 'control-server.json';

const log = new LogStream();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 在某个节点上写入文本。走 devecocli ui text：它按 id 解析中心点，再调
// uitest uiInput inputText。devecocli 会 base64 编码文本，特殊字符不会被 shell 吞掉。
function typeAtId(id, text) {
  return execFileSync('devecocli', ['ui', 'text', text, '--device', serial(), '--id', id],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// 切到别的页签再切回设置，清空二级页面栈，回到设置首页（BridgeStatus.ets:1561）。
async function resetToSettingsHome() {
  clickId('tab-home');
  await pause(1500);
  clickId('tab-settings');
  await pause(2500);
}

// 打开控制服务器编辑器。返回 { ok, clicked }。
// clicked 为真表示本次点了打开按钮，对应 control_server_editor_opened 事件。
async function openControlServerEditor() {
  await resetToSettingsHome();
  if (textOfId('control-server-input') !== null) {
    return { ok: true, clicked: false };
  }
  if (textOfId('control-server-edit') === null) {
    return { ok: false, clicked: false };
  }
  clickId('control-server-edit');
  await pause(2000);
  return { ok: textOfId('control-server-input') !== null, clicked: true };
}

before(async () => {
  log.start();
  await pause(4000);
  forceStop();
  await pause(2500);
  startApp();
  assert.ok(await log.waitFor(/MeshArcDiag: ui ui_opened/, 40000),
    '启动后没有出现 ui_opened，应用没有走到界面');
  await pause(9000);
  const texts = layoutTexts();
  const configured = texts.some((line) => line.includes('未连接') || line.includes('已连接'));
  if (!configured) {
    return;
  }
  // 归一：连接态下保存按钮被禁用。本用例要求未连接。
  if (textOfId('vpn-stop') !== null) {
    clickId('vpn-stop');
    await log.waitFor(/vpn_extension_destroyed/, 60000);
    await pause(4000);
  }
});

after(() => {
  log.stop();
  mkdirSync(OUT, { recursive: true });
  log.dump(EVIDENCE);
  console.log(`设备日志证据：${EVIDENCE}（${log.lines.length} 行）`);
});

test('控制服务器：编辑器给出输入框与保存按钮', async (t) => {
  const opened = await openControlServerEditor();
  if (!opened.ok) {
    t.skip(NO_EDITOR);
    return;
  }
  assert.ok(textOfId('control-server-input') !== null, '编辑器没有控制服务器输入框');
  assert.ok(textOfId('control-server-save') !== null, '编辑器里没有保存按钮');
  if (opened.clicked) {
    assert.ok(await log.waitForAfter(0, /control_server_editor_opened/, 10000),
      '打开编辑器没有记录 control_server_editor_opened');
  }
});

test('控制服务器：非法地址被拒且不写盘', async (t) => {
  const opened = await openControlServerEditor();
  if (!opened.ok) {
    t.skip(NO_EDITOR);
    return;
  }
  const fileBefore = readAppFile(CONFIG_FILE);
  // 合法地址不含 @（ControlServerConfig.ets:30）。写入一个 @ 让 normalize 返回空串。
  // 输入框预填已确认的地址，写入结果是拼接还是覆盖都含 @，两种都判非法。
  typeAtId('control-server-input', '@');
  await pause(1000);
  const mark = log.mark();
  clickId('control-server-save');
  const failed = await log.waitForAfter(mark, /control_server_confirm_failed/, 15000);
  assert.ok(failed, '非法地址没有被拒，没有出现 control_server_confirm_failed');
  assert.match(failed, /invalid/, `拒绝原因不是 invalid：${failed}`);
  assert.equal(log.countAfter(mark, /control_server_confirmed/), 0,
    '非法地址被拒之后仍然记录了 control_server_confirmed');
  assert.equal(readAppFile(CONFIG_FILE), fileBefore,
    '非法地址被拒之后 control-server.json 变了');
});

test('控制服务器：明文 HTTP 风险确认与取消', (t) => {
  // 这一条需要一个干净的输入值。输入框预填已确认的地址。
  // devecocli ui 没有清空或选中全部的手段（只有 click / text / swipe）。
  // 直接写入含 :// 的地址会走系统粘贴，落在光标处与旧值拼接，得到非法但不触发风险确认的值。
  // 强行写入还有把控制服务器改成坏地址的风险。
  t.skip('需要先清空输入框再写入 http:// 地址。设备侧没有清空输入框的手段（devecocli ui 无按键事件、无 clear）。补一个清空或直填函数后再跑。');
});
