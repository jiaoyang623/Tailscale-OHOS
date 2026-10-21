// a01 运行日志记录器。E2E 代码在运行时写入，报告只读它。
//
// 每个 E2E 文件写出 `checks/.e2e-steps-<suite>.json`。`merge-steps.mjs` 把
// 各文件合并成 `checks/e2e-steps.json`。截图放在 `checks/e2e-run/shots/`，
// 日志里的路径相对 `checks/`，报告生成器按同目录解析。
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HDC, screenshot } from './device.mjs';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const CHECKS = join(REPO, 'docs/changes/vpn-endurance/checks');
const SHOTS = join(CHECKS, 'e2e-run/shots');
const STATUS_ORDER = { pass: 0, skip: 1, blocked: 2, fail: 3 };

function baseline() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'],
      { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_error) {
    return 'unknown';
  }
}

function clip(text, limit = 4000) {
  const value = String(text ?? '');
  return value.length <= limit ? value : `…（前段省略）\n${value.slice(-limit)}`;
}

function worst(statuses) {
  return statuses.reduce((left, right) =>
    STATUS_ORDER[right] > STATUS_ORDER[left] ? right : left, 'pass');
}

class Case {
  constructor(run, id, title, oracleIds) {
    this.run = run;
    this.id = id;
    this.title = title;
    this.oracleIds = oracleIds;
    this.steps = [];
    this.explicitStatus = null;
    this.error = '';
  }

  step(spec) {
    const record = {
      id: spec.id,
      name: spec.name,
      operation: spec.operation,
      expected: spec.expected,
      actual: '',
      status: 'skip',
      evidence: spec.evidence
    };
    const mark = (status, actual, evidence) => {
      record.status = status;
      record.actual = String(actual ?? '');
      if (evidence !== undefined) {
        record.evidence = evidence;
      }
      return record;
    };
    record.pass = (actual, evidence) => mark('pass', actual, evidence);
    record.fail = (actual, evidence) => mark('fail', actual, evidence);
    record.skip = (actual, evidence) => mark('skip', actual, evidence);
    record.blocked = (actual, evidence) => mark('blocked', actual, evidence);
    this.steps.push(record);
    return record;
  }

  skip(actual) {
    this.explicitStatus = 'skip';
    const id = `S${this.steps.length + 1}`;
    this.steps.push({
      id, name: this.steps.length === 0 ? '用例适用性' : '跳过原因',
      operation: '检查前置条件',
      expected: ['前置条件满足'], actual: String(actual), status: 'skip',
      evidence: { kind: 'log', output: clip(actual) }
    });
    return this;
  }

  fail(error) {
    this.error = String(error ?? '');
    return this;
  }

  toJSON() {
    const statuses = this.steps.map((step) => step.status);
    const status = this.explicitStatus ?? (statuses.length > 0 ? worst(statuses) : 'blocked');
    return {
      id: this.id,
      title: this.title,
      oracle_ids: this.oracleIds,
      status,
      steps: this.steps.map((step) => ({
        id: step.id, name: step.name, operation: step.operation,
        expected: step.expected, actual: step.actual, status: step.status,
        ...(step.evidence === undefined ? {} : { evidence: step.evidence })
      })),
      ...(this.error ? { error: this.error } : {})
    };
  }
}

export class RunLog {
  constructor(options) {
    this.options = options;
    this.cases = [];
    this.startedAt = new Date().toISOString();
    this.shotIndex = 0;
  }

  case(id, title, oracleIds) {
    const record = new Case(this, id, title, oracleIds);
    this.cases.push(record);
    return record;
  }

  // 截一张设备界面图。devecocli 写临时文件，这里复制进检查目录。
  shot(name, label) {
    mkdirSync(SHOTS, { recursive: true });
    const source = screenshot(name);
    this.shotIndex += 1;
    const file = `${String(this.shotIndex).padStart(2, '0')}-${name}.png`;
    copyFileSync(source, join(SHOTS, file));
    return { path: `e2e-run/shots/${file}`, label };
  }

  output(text) {
    return { kind: 'log', output: clip(text) };
  }

  write() {
    const file = process.env.E2E_STEPS_OUT ||
      join(CHECKS, `.e2e-steps-${this.options.suite}.json`);
    mkdirSync(dirname(file), { recursive: true });
    const data = {
      skill_version: 'a01',
      title: this.options.title,
      change_id: 'vpn-endurance',
      baseline: `${baseline()}（工作树有本批次未提交改动）`,
      environment: this.options.environment,
      command: this.options.command,
      executed_at: this.startedAt,
      target: 'mobile',
      ...(this.options.notice ? { notice: this.options.notice } : {}),
      cases: this.cases.map((record) => record.toJSON())
    };
    writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
    return file;
  }
}

export function createRun(options) {
  return new RunLog(options);
}

export function deviceEnvironment() {
  const device = process.env.DEVICE || '未指定设备';
  let model = 'unknown';
  let api = 'unknown';
  try {
    model = execFileSync(HDC,
      ['-t', device, 'shell', 'param get const.product.model'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    api = execFileSync(HDC,
      ['-t', device, 'shell', 'param get const.ohos.apiversion'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_error) {
    // Keep the neutral labels when the device cannot be queried.
  }
  return `${device} · ${model} · API ${api} · USB 连接 · Wi-Fi · 充电中`;
}