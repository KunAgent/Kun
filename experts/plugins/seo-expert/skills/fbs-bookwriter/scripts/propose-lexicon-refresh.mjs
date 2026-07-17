#!/usr/bin/env node
/**
 * 策略 C：词表更新「提议」入口 — 人工评审后再合入 references/ 与词表 JSON
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const TARGETS = [
  'references/02-quality/s5-buzzword-lexicon.json',
  'references/02-quality/ai-pattern-lexicon.json',
  'references/02-quality/abbreviation-audit-lexicon.json',
];

function parseArgs(argv) {
  const args = { out: null, help: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) args.out = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`
propose-lexicon-refresh.mjs — 词表治理检查清单（策略 C）

流程：联网检索 → 记录来源 URL/日期 → 人工评审 → PR 合入词表 JSON（禁止自动覆盖线上文件）

相关文档：references/05-ops/lexicon-governance.md

用法：
  node scripts/propose-lexicon-refresh.mjs [--out <提案.md>]
`);
    process.exit(0);
  }

  const body = [
    '# 词表更新提案（模板）',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '## 待检视资产',
    '',
    ...TARGETS.map((t) => `- \`${t}\`（存在：${fs.existsSync(path.join(ROOT, t)) ? '是' : '否'}）`),
    '',
    '## 建议检索关键词（示例）',
    '',
    '- AI 生成文本检测 / 套话特征 2026',
    '- 中文公文 / 非虚构写作 禁用词 清单',
    '- 去机器味 句式替换',
    '',
    '## 来源记录（必填）',
    '',
    '| URL | 日期 | 摘录要点 | 拟合并入文件 |',
    '|-----|------|----------|--------------|',
    '|  |  |  |  |',
    '',
    '## 评审结论',
    '',
    '- [ ] 可合入',
    '- [ ] 仅作附录，不入机读词表',
    '',
  ].join('\n');

  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(ROOT, 'releases', `lexicon-refresh-proposal-${new Date().toISOString().slice(0, 10)}.md`);
  if (!args.out) fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, body, 'utf8');
  console.log(outPath);
}

main();
