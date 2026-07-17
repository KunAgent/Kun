#!/usr/bin/env node
/**
 * 聚合预检：SKILL frontmatter、runtime-hints、env-preflight、Node 引擎版本。
 * 用法：node scripts/fbs-doctor.mjs [--json]
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const o = { skillRoot: DEFAULT_ROOT, json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--skill-root' && argv[i + 1]) o.skillRoot = path.resolve(argv[++i]);
    else if (argv[i] === '--json') o.json = true;
  }
  return o;
}

function runScript(root, rel) {
  const script = path.join(root, rel);
  const r = spawnSync(process.execPath, [script, '--skill-root', root], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: r.status ?? 1, stderr: r.stderr || '', stdout: r.stdout || '' };
}

function checkNodeEngine(root) {
  const pkgPath = path.join(root, 'package.json');
  let enginesNode = '>=18';
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    enginesNode = pkg.engines?.node || enginesNode;
  } catch {
    // ignore
  }
  const major = parseInt(String(process.versions.node).replace(/^v/, '').split('.')[0], 10);
  const ok = !Number.isNaN(major) && major >= 18;
  return {
    ok,
    detail: `当前 ${process.version}；package.json engines.node=${JSON.stringify(enginesNode)}`,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const root = args.skillRoot;

  const steps = [
    { id: 'validate-skill-frontmatter', ...runScript(root, 'scripts/validate-skill-frontmatter.mjs') },
    { id: 'validate-runtime-hints', ...runScript(root, 'scripts/validate-runtime-hints.mjs') },
  ];

  const ep = spawnSync(process.execPath, [path.join(root, 'scripts/env-preflight.mjs'), '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  let envPayload = null;
  try {
    envPayload = JSON.parse(String(ep.stdout || '').trim());
  } catch {
    envPayload = { allOk: false, checks: [{ id: 'parse', ok: false, detail: 'env-preflight 非 JSON' }] };
  }

  const nodeEng = checkNodeEngine(root);
  const checks = [
    { phase: 'validate-skill-frontmatter', ok: steps[0].status === 0, detail: steps[0].status === 0 ? '通过' : (steps[0].stderr || steps[0].stdout).slice(0, 400) },
    { phase: 'validate-runtime-hints', ok: steps[1].status === 0, detail: steps[1].status === 0 ? '通过' : (steps[1].stderr || steps[1].stdout).slice(0, 400) },
    {
      phase: 'env-preflight',
      ok: envPayload.allOk === true,
      detail: Array.isArray(envPayload.checks)
        ? envPayload.checks.map((c) => `${c.id}:${c.ok === true ? 'ok' : c.ok === false ? 'fail' : 'info'}`).join('; ')
        : '—',
    },
    { phase: 'node_engine', ok: nodeEng.ok, detail: nodeEng.detail },
  ];

  const failCount = checks.filter((c) => !c.ok).length;
  const payload = {
    timestamp: new Date().toISOString(),
    skillRoot: root,
    summary: failCount === 0 ? 'healthy' : 'degraded',
    allOk: failCount === 0,
    checks,
    envPreflight: envPayload,
    hints: {
      next:
        failCount > 0
          ? '查看失败项；Windows 请关注 env-preflight 的 powershell_file。'
          : '可继续 npm test 或 npm run pack:skill-gates。',
    },
  };

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('\n🩺 fbs-doctor（技能根预检聚合）\n');
    for (const c of checks) {
      const m = c.ok ? '✅' : '❌';
      console.log(`  ${m} ${c.phase}: ${c.detail}`);
    }
    console.log(failCount === 0 ? '\n✅ doctor：全部通过\n' : `\n⚠️ doctor：${failCount} 项需处理\n`);
  }
  process.exit(failCount === 0 ? 0 : 1);
}

if (process.argv[1] && process.argv[1].includes('fbs-doctor')) {
  main();
}
