#!/usr/bin/env node
/**
 * Health check for CPQ plugin environment.
 *
 * Verifies that the environment where the CPQ plugin is loaded meets
 * expectations — CLI tools are available, auth is valid, runtime is healthy.
 *
 * Usage:
 *   health-check                          # 默认输出（含 skip 项详情）
 *
 * Exit code: 0 = all pass, 1 = some checks failed
 */

import { execSync } from 'node:child_process';
import { readFileSync, accessSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Load bin-manifest.json (SSOT) to get the CLI tools list
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(HERE, 'bin-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const CLI_TOOLS = manifest.entries
  .filter((e) => e.healthCheck === true)
  .map((e) => e.name);

// SSOT: additional checks from manifest
const PYTHON_DEPS = manifest.healthCheckExtras?.pythonDeps ?? [];
const FILE_CHECKS = manifest.healthCheckExtras?.fileChecks ?? [];
const NETWORK_CHECKS = manifest.healthCheckExtras?.networkChecks ?? [];

// zip root = parent of bin/ directory
const ZIP_ROOT = dirname(HERE);

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage: health-check [options]

Options:
  -h, --help    Show this help message and exit

Checks performed:`);
  console.log(`  - CLI tools: ${CLI_TOOLS.join(', ')}`);
  if (PYTHON_DEPS.length) console.log(`  - Python deps: ${PYTHON_DEPS.join(', ')}`);
  if (FILE_CHECKS.length) console.log(`  - Files: ${FILE_CHECKS.map((f) => f.name).join(', ')}`);
  if (NETWORK_CHECKS.length) console.log(`  - Network: ${NETWORK_CHECKS.map((n) => n.name).join(', ')}`);
  console.log(`  - Auth: command-auth whoami`);
  console.log(`  - Runtime: Node.js, Python`);
  console.log(`\n${'='.repeat(40)}`);
  console.log(`⚠️  黄色警告项（外部依赖/网络）不阻塞运行。`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const verbose = true;
const results = [];

function pass(name, detail) {
  results.push({ name, status: 'pass', detail });
  console.log(`  ✅ ${name}: ${detail}`);
}

function fail(name, detail) {
  results.push({ name, status: 'fail', detail });
  console.log(`  ❌ ${name}: ${detail}`);
}

function warn(name, detail) {
  results.push({ name, status: 'warn', detail });
  console.log(`  ⚠️  ${name}: ${detail}`);
}

function neutral(name, detail) {
  results.push({ name, status: 'neutral', detail });
  console.log(`  ℹ️  ${name}: ${detail}`);
}

function skip(name, detail) {
  results.push({ name, status: 'skip', detail });
  if (verbose) console.log(`  ⏭️  ${name}: ${detail}`);
}

function extra(text) {
  if (verbose && text) console.log(`     → ${text}`);
}

function section(title) {
  console.log(`\n── ${title}`);
}

/**
 * @param {string} cmd
 * @returns {{ stdout: string; stderr: string; code: number }}
 */
function run(cmd) {
  try {
    const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 15_000 });
    return { stdout: stdout.trim(), stderr: '', code: 0 };
  } catch (e) {
    const err = e;
    return {
      stdout: (err.stdout ?? '').toString().trim(),
      stderr: (err.stderr ?? '').toString().trim(),
      code: err.status ?? 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Check engine — data-driven, each check is a declarative definition
// ---------------------------------------------------------------------------

/**
 * @typedef {'pass'|'fail'|'warn'|'neutral'|'skip'} Status
 * @typedef {{ name: string; status: Status; detail: string }} CheckResult
 *
 * A check definition:
 *   - name:    display name
 *   - run:     () => { status, detail, extra? }
 */

// --- Template: CLI tool check ---
function checkCliTool(tool) {
  const which = run(`command -v ${tool} 2>/dev/null || which ${tool} 2>/dev/null || where ${tool} 2>/dev/null || true`);
  if (which.code === 0 && which.stdout) {
    const version = run(`${tool} --version 2>/dev/null || ${tool} version 2>/dev/null || true`);
    const versionInfo = version.code === 0 && version.stdout ? version.stdout : '(无版本信息)';
    return { status: 'pass', detail: which.stdout, extra: `版本: ${versionInfo}` };
  }
  return { status: 'fail', detail: `未找到（请检查 bin/ 目录）` };
}

// --- Template: runtime version check ---
function checkRuntime(name, cmd) {
  const r = run(cmd);
  if (r.code === 0 && r.stdout) {
    return { status: 'pass', detail: r.stdout };
  }
  return { status: 'fail', detail: `${name} 不可用` };
}

// --- Template: auth check ---
function checkAuth() {
  const r = run('command-auth whoami 2>&1 || true');
  // 中立返回：不判断成功或失败，直接展示原始结果
  const detail = (r.stdout || r.stderr || '').trim() || '(无输出)';
  return { status: 'neutral', detail };
}

// --- Template: Python package check ---
function checkPythonPkg(pkg) {
  const r = run(`python3 -c "import ${pkg}; print('${pkg} ' + getattr(${pkg}, '__version__', 'ok'))" 2>/dev/null || python -c "import ${pkg}; print('${pkg} ' + getattr(${pkg}, '__version__', 'ok'))" 2>/dev/null || true`);
  if (r.code === 0 && r.stdout) {
    return { status: 'pass', detail: r.stdout };
  }
  return { status: 'warn', detail: `${pkg} 未安装（pip install ${pkg}）` };
}

// --- Template: file existence check ---
function checkFileExists(name, relPath) {
  const absPath = join(ZIP_ROOT, relPath);
  try {
    accessSync(absPath);
    return { status: 'pass', detail: absPath };
  } catch {
    return { status: 'warn', detail: `${name} 不存在（${absPath}）` };
  }
}

// --- Template: network connectivity check ---
function checkNetwork(name, host, port) {
  const r = run(`curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 https://${host}:${port} 2>/dev/null || true`);
  if (r.code === 0 && r.stdout) {
    const code = r.stdout.trim();
    if (code && code !== '000') {
      return { status: 'pass', detail: `${host}:${port} (HTTP ${code})` };
    }
  }
  return { status: 'warn', detail: `${host}:${port} 不可达` };
}

// ---------------------------------------------------------------------------
// Check definitions (single source of truth)
// ---------------------------------------------------------------------------

/** @type {{ section: string; checks: { name: string; run: () => { status: Status; detail: string; extra?: string } }[] }[]} */
const checkGroups = [
  {
    section: 'CLI 工具检查',
    checks: CLI_TOOLS.map((tool) => ({ name: tool, run: () => checkCliTool(tool) })),
  },
  {
    section: '鉴权检查',
    checks: [{ name: 'command-auth', run: checkAuth }],
  },
  {
    section: '运行时检查',
    checks: [
      { name: 'Node.js', run: () => checkRuntime('Node.js', 'node --version 2>/dev/null || true') },
      { name: 'Python', run: () => checkRuntime('Python', 'python3 --version 2>/dev/null || python --version 2>/dev/null || true') },
    ],
  },
];

// Python pip packages (only add group if there are deps to check)
if (PYTHON_DEPS.length > 0) {
  checkGroups.push({
    section: 'Python 依赖检查',
    checks: PYTHON_DEPS.map((pkg) => ({ name: pkg, run: () => checkPythonPkg(pkg) })),
  });
}

// File existence checks
if (FILE_CHECKS.length > 0) {
  checkGroups.push({
    section: '文件检查',
    checks: FILE_CHECKS.map((f) => ({ name: f.name, run: () => checkFileExists(f.name, f.path) })),
  });
}

// Network connectivity checks
if (NETWORK_CHECKS.length > 0) {
  checkGroups.push({
    section: '网络连通性检查',
    checks: NETWORK_CHECKS.map((n) => ({ name: n.name, run: () => checkNetwork(n.name, n.host, n.port) })),
  });
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

for (const group of checkGroups) {
  section(group.section);
  for (const check of group.checks) {
    const r = check.run();
    if (r.status === 'pass') {
      pass(check.name, r.detail);
      extra(r.extra);
    } else if (r.status === 'fail') {
      fail(check.name, r.detail);
      extra(r.extra);
    } else if (r.status === 'warn') {
      warn(check.name, r.detail);
      extra(r.extra);
    } else if (r.status === 'neutral') {
      neutral(check.name, r.detail);
      extra(r.extra);
    } else {
      skip(check.name, r.detail);
    }
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const total = results.length;
const passCount = results.filter((r) => r.status === 'pass').length;
const failCount = results.filter((r) => r.status === 'fail').length;
const warnCount = results.filter((r) => r.status === 'warn').length;
const neutralCount = results.filter((r) => r.status === 'neutral').length;
const skipCount = results.filter((r) => r.status === 'skip').length;

console.log(`\n${'='.repeat(40)}`);
console.log(`结果: ${passCount} 通过, ${failCount} 失败, ${warnCount} 警告, ${neutralCount} 中性, ${skipCount} 跳过 / 共 ${total} 项`);
console.log(`${'='.repeat(40)}`);

if (failCount > 0) {
  console.log(`\n⚠️ 规则: 有检查项未通过，请先修复。`);
} else {
  console.log(`\n✅ 规则: 环境就绪。`);
}

process.exit(failCount > 0 ? 1 : 0);