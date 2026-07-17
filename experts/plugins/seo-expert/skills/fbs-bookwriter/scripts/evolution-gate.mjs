#!/usr/bin/env node
/**
 * P0 A3：进化/规范变更与发版同级门控（轻量）
 * - 校验 scripts/generated/scripts-manifest.json 存在
 * - 校验轨迹 schema 存在
 * - 可选：FBS_STRICT_EVOLUTION=1 时要求 git 工作区无未提交 references 变更（需 git）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function main() {
  const errors = [];
  const manifest = path.join(ROOT, 'scripts', 'generated', 'scripts-manifest.json');
  if (!fs.existsSync(manifest)) {
    errors.push(`缺少 ${manifest}，请先运行: node scripts/generate-scripts-manifest.mjs`);
  }

  const traceSchema = path.join(ROOT, 'references', '05-ops', 'fbs-trace-events.schema.json');
  if (!fs.existsSync(traceSchema)) {
    errors.push(`缺少轨迹 schema: ${traceSchema}`);
  }

  if (process.env.FBS_STRICT_EVOLUTION === '1') {
    const git = spawnSync('git', ['diff', '--name-only', 'references'], { cwd: ROOT, encoding: 'utf8' });
    if (git.status === 0 && git.stdout?.trim()) {
      errors.push('FBS_STRICT_EVOLUTION=1：references/ 存在未提交变更，请先提交或暂存后再打包');
    }
  }

  if (errors.length) {
    console.error('evolution-gate: ❌');
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log('evolution-gate: ✅ scripts-manifest + trace schema OK');
}

main();
