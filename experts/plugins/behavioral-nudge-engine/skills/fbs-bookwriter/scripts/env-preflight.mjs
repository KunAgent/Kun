#!/usr/bin/env node
/**
 * S0/S3 前环境预检（复盘 P0）：Node 可用、PowerShell -File 下变量正常（避免 -Command 被宿主吃掉 $）
 *
 * 用法：
 *   node scripts/env-preflight.mjs [--json]
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function checkRuntimeDependency(name) {
  try {
    const pkgPath = require.resolve(`${name}/package.json`);
    return { ok: true, detail: `已安装（${pkgPath}）` };
  } catch {
    return {
      ok: false,
      detail: `缺少运行时依赖 ${name}。请在技能根目录执行：npm install --omit=dev`,
    };
  }
}

function main() {
  const json = process.argv.includes('--json');
  const checks = [];

  let nodeOk = false;
  try {
    const v = process.version;
    nodeOk = !!v;
    checks.push({ id: 'node', ok: nodeOk, detail: v || '' });
  } catch {
    checks.push({ id: 'node', ok: false, detail: 'process.version 不可用' });
  }

  let psFileOk = false;
  let psDetail = '未检测';
  if (process.platform !== 'win32') {
    psFileOk = true;
    psDetail = '非 Windows 宿主：跳过 PowerShell 探针（请用 node 脚本与 bash）';
  } else {
    const tmpPs1 = path.join(os.tmpdir(), `fbs-ps-probe-${process.pid}.ps1`);
    try {
      fs.writeFileSync(
        tmpPs1,
        '$ErrorActionPreference = "Stop"\n$x = 1\nif ($x -ne 1) { exit 2 }\nexit 0\n',
        'utf8',
      );
      const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPs1], {
        encoding: 'utf8',
        timeout: 30000,
        windowsHide: true,
      });
      psFileOk = r.status === 0;
      psDetail = psFileOk ? 'powershell -File 探针脚本（$ 变量）执行成功' : (r.stderr || r.stdout || `exit ${r.status}`).slice(0, 200);
    } catch (e) {
      psDetail = String(e?.message || e);
    } finally {
      try {
        fs.unlinkSync(tmpPs1);
      } catch {
        // ignore
      }
    }
  }
  checks.push({ id: 'powershell_file', ok: psFileOk, detail: psDetail });

  checks.push({
    id: 'powershell_command_policy',
    ok: null,
    detail:
      'WorkBuddy 等宿主可能对 execute_command 做 shell 预处理：请勿使用 powershell -Command 内联 $ 变量；请用 powershell -File <脚本.ps1>，字数/词频用 node 脚本。',
  });

  const depGlob = checkRuntimeDependency('glob');
  checks.push({ id: 'deps.glob', ok: depGlob.ok, detail: depGlob.detail });

  const depIconv = checkRuntimeDependency('iconv-lite');
  checks.push({ id: 'deps.iconv-lite', ok: depIconv.ok, detail: depIconv.detail });

  const allOk = checks.filter((c) => c.ok === false).length === 0;

  const payload = {
    timestamp: new Date().toISOString(),
    skillRoot,
    allOk,
    checks,
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('🔍 环境预检（FBS）');
    for (const c of checks) {
      const mark = c.ok === false ? '❌' : c.ok === true ? '✅' : 'ℹ️';
      console.log(`  ${mark} ${c.id}: ${c.detail}`);
    }
    console.log(allOk ? '\n✅ 关键项就绪（仍请避免 PS -Command 内联变量）' : '\n⚠️ 存在失败项，请检查 Node / PowerShell 策略');
  }

  process.exit(allOk ? 0 : 1);
}

main();
