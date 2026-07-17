#!/usr/bin/env node
/**
 * 策略 C：将 upgrade-diff-scan 结果写入 releases/，便于「装包后能力变更」留档
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scanUpgradeDiff } from './upgrade-diff-scan.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { base: null, target: ROOT, head: 120, help: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--base' && argv[i + 1]) args.base = path.resolve(argv[++i]);
    else if (argv[i] === '--target' && argv[i + 1]) args.target = path.resolve(argv[++i]);
    else if (argv[i] === '--head' && argv[i + 1]) args.head = Number(argv[++i]) || 120;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

function renderMd(report) {
  const onlyInBase = report.onlyInBase.length
    ? report.onlyInBase.map((file) => `- ${file}`).join('\n')
    : '- 无';
  const onlyInTarget = report.onlyInTarget.length
    ? report.onlyInTarget.map((file) => `- ${file}`).join('\n')
    : '- 无';
  const changed = report.changed.length
    ? report.changed.map((item) => `- ${item.relPath}`).join('\n')
    : '- 无';

  return `# 升级能力摘要（emit-upgrade-summary）

- **baseDir**：${report.baseDir.replace(/\\/g, '/')}
- **targetDir**：${report.targetDir.replace(/\\/g, '/')}
- **生成时间**：${report.generatedAt}

## 汇总

| 指标 | 数量 |
|------|------|
| base 文件 | ${report.summary.baseFiles} |
| target 文件 | ${report.summary.targetFiles} |
| 仅 base | ${report.summary.onlyInBase} |
| 仅 target | ${report.summary.onlyInTarget} |
| 内容变更 | ${report.summary.changed} |

## 仅 base 存在

${onlyInBase}

## 仅 target 存在

${onlyInTarget}

## 内容不同

${changed}

> 由 \`node scripts/emit-upgrade-summary.mjs\` 生成，供发布说明与策略 C 留档。
`;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.base) {
    console.error(`用法: node scripts/emit-upgrade-summary.mjs --base <旧版技能根目录> [--target <新版，默认当前仓库>] [--head N]`);
    process.exit(args.help ? 0 : 2);
  }

  const report = scanUpgradeDiff({
    baseDir: args.base,
    targetDir: args.target,
    head: args.head,
  });

  const releasesDir = path.join(args.target, 'releases');
  fs.mkdirSync(releasesDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const mdPath = path.join(releasesDir, `upgrade-capability-summary-${stamp}.md`);
  fs.writeFileSync(mdPath, renderMd(report), 'utf8');
  console.log(JSON.stringify({ markdownPath: mdPath, summary: report.summary }, null, 2));
}

main();
