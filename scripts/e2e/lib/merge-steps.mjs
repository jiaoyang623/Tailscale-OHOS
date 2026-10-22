// 把各 E2E 文件写的 `.e2e-steps-<suite>.json` 合并成一份运行日志。
// 合并不是补写：用例、步骤、状态与证据都来自测试进程。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const CHECKS = join(REPO, 'docs/changes/vpn-endurance/checks');
const files = readdirSync(CHECKS)
  .filter((name) => name.startsWith('.e2e-steps-') && name.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.error('没有找到 .e2e-steps-*.json。先跑 E2E。');
  process.exit(2);
}

const runs = files.map((name) => JSON.parse(readFileSync(join(CHECKS, name), 'utf8')));
const cases = [];
const seen = new Set();
for (const run of runs) {
  for (const item of run.cases) {
    if (seen.has(item.id)) {
      console.error(`重复用例 ID：${item.id}`);
      process.exit(2);
    }
    seen.add(item.id);
    cases.push(item);
  }
}

const started = runs.map((run) => run.executed_at).sort()[0];
const merged = {
  skill_version: 'a01',
  title: '设备侧 E2E：断连恢复与省电',
  change_id: 'vpn-endurance',
  baseline: runs[0].baseline,
  environment: runs[0].environment,
  // 实际执行的命令由跑批脚本传进来。写死一份会与真实批次不符：
  // 全量批次跑 28 个文件，只跑五条恢复用例的批次跑 5 个文件。
  command: process.env.E2E_BATCH_COMMAND ||
    'scripts/e2e/run-batch.sh endurance-recovery network-recovery background-reconnect '
      + 'install-restart-recovery screen-off-survival',
  executed_at: started,
  target: 'mobile',
  notice: '本次在 Wi-Fi 下运行，手机通过 USB 连接并充电。通过一次不代表电池深度休眠或拔线后仍成立。'
    + '跳过项写明缺少的主机通道。',
  cases
};

const out = join(CHECKS, 'e2e-steps.json');
writeFileSync(out, JSON.stringify(merged, null, 2) + '\n', 'utf8');
console.log(`合并 ${runs.length} 个文件，${cases.length} 条用例 → ${out}`);