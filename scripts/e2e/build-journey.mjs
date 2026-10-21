// E2E · 开发者构建旅程。这是判据 O-BUILD-00 声明的用例所在。
//
// 这是**开发者旅程**，不是用户旅程，所以它不驱动设备，跑在宿主上。
// 判据把它单列一条，是因为本项目把构建脚本当作第一类流程。
//
// 本机的一个事实，先记在这里（本轮实测）：
//   `scripts/build.sh` 是 macOS 的移植版，它按 `$DEVECO_STUDIO_HOME/tools/hvigor/`
//   和 `$DEVECO_STUDIO_HOME/jbr/` 找工具链。本机的 DevEco 在 `/opt/harmony/sdk`，
//   布局是 `hvigor/` 与 `tool/node/` 而不是 `tools/hvigor/` 与 `jbr/`，
//   所以那条入口在本机连工具链都找不到，退出 1。
//   本机的实际构建入口是 `.build/compile.sh`，`scripts/device-run.sh:92` 用的就是它。
//   这条差异要由审查人裁决：是修 `scripts/build.sh` 让它认本机布局，
//   还是给 O-BUILD-00 的前置条件加一条「Linux 走 `.build/compile.sh`」。
//
//   DEVICE=<序列号> node --test scripts/e2e/build-journey.mjs
//   MESHARC_RUN_BUILD=1 ... node --test scripts/e2e/build-journey.mjs   # 连完整构建一起跑
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LIBS = join(ROOT, 'entry/libs/arm64-v8a');
const SO = join(LIBS, 'libtailscale_go.so');
const HEADER = join(LIBS, 'libtailscale_go.h');
const HAP = join(ROOT, 'entry/build/default/outputs/default/entry-default-signed.hap');

function run(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
    return { code: 0, stdout };
  } catch (error) {
    return {
      code: error.status === undefined ? -1 : error.status,
      stdout: `${error.stdout || ''}${error.stderr || ''}`
    };
  }
}

// 判据 R-BUILD-01：产物必须是 AArch64 动态库，且被正确打进 HAP。
// 这一条不重跑构建，验的是上一次构建留下的产物链。产物对不上说明构建坏了。
test('构建产物：引擎是 AArch64 动态库，且被打进 HAP', () => {
  assert.ok(existsSync(SO), `${SO} 不存在，引擎没有构建出来`);
  assert.ok(statSync(SO).size > 1024 * 1024,
    `libtailscale_go.so 只有 ${statSync(SO).size} 字节，不像一个链接好的引擎`);

  const described = run('file', ['-b', SO]).stdout;
  assert.match(described, /ELF 64-bit/,
    `.so 不是 64 位 ELF：${described.trim()}`);
  assert.match(described, /aarch64/,
    `.so 的目标架构不是 aarch64：${described.trim()}`);

  assert.ok(existsSync(HEADER),
    'libtailscale_go.h 不存在。只有 .so 没有头文件，装配出来的包不好对接口');

  assert.ok(existsSync(HAP), `${HAP} 不存在，没有装配好的 HAP 可查`);
  const listing = run('unzip', ['-l', HAP]).stdout;
  assert.match(listing, /libs\/arm64-v8a\/libtailscale_go\.so/,
    'HAP 里没有 libs/arm64-v8a/libtailscale_go.so，引擎没有被装配进去');
});

// 判据 O-BUILD-00 的失败与恢复一项：Release 或未知产品在任何构建动作之前被拒。
// 这条跑得快，因为拒绝发生在第一行，不碰工具链。每次都跑。
test('构建入口：非 default 产品在动工之前就被拒', () => {
  const rejected = run('bash', ['scripts/build.sh', 'release'], { cwd: ROOT });
  assert.equal(rejected.code, 1,
    `scripts/build.sh release 的退出码是 ${rejected.code}，预期 1`);
  assert.match(rejected.stdout, /only the default Debug product/,
    `拒绝时的文案不是预期的那句：${rejected.stdout.trim()}`);
  assert.match(rejected.stdout, /build\.ps1 -Product release/,
    '拒绝时没有把 Release 的正规路径指出来');
});

// 完整的开发者旅程：从仓库根真跑一次构建，再验产物落位。
// 一次要几分钟，所以默认不跑；发布前和构建脚本改动后手动开。
test('开发者从仓库根运行构建脚本得到可装配的 AArch64 产物', (t) => {
  if (!process.env.MESHARC_RUN_BUILD) {
    t.skip('完整构建要几分钟，默认不跑。设 MESHARC_RUN_BUILD=1 再跑。'
      + '本机走的是 .build/compile.sh（见文件头的说明），'
      + 'scripts/build.sh 认不出本机的 DevEco 布局。');
    return;
  }
  const built = run('sudo', ['-n', '-u', 'w2h', 'bash', '.build/compile.sh'],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000 });
  assert.equal(built.code, 0, `构建退出码 ${built.code}：${built.stdout.slice(-2000)}`);
  assert.match(built.stdout, /libtailscale_go\.so/, '构建输出里没有引擎产物那一步');
  assert.match(built.stdout, /assembleHap/, '构建输出里没有装配 HAP 那一步');
  assert.ok(existsSync(HAP), '构建报告成功，却没有 HAP 落地');
});
