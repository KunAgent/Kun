#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

function parseArgs(argv) {
  const args = {
    skillRoot: process.cwd(),
    bookRoot: null,
    enforce: false,
    help: false
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skill-root') args.skillRoot = argv[++i] || args.skillRoot;
    else if (a === '--book-root') args.bookRoot = argv[++i] || args.bookRoot;
    else if (a === '--enforce') args.enforce = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }

  if (!args.bookRoot) args.bookRoot = args.skillRoot;
  return args;
}

function readMaybe(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function countActionItems(nextActionText) {
  const lines = String(nextActionText || '').split(/\r?\n/);
  return lines.filter((line) => /^\s*(?:[-*]|\d+[.)])\s+/.test(line)).length;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('用法: node scripts/ux-flow-guard.mjs --skill-root <path> --book-root <path> [--enforce]');
    process.exit(0);
  }

  const skillRoot = path.resolve(args.skillRoot);
  const bookRoot = path.resolve(args.bookRoot);

  const checks = [
    {
      name: 'SKILL-恢复卡规则',
      file: path.join(skillRoot, 'SKILL.md'),
      pattern: /恢复卡/,
      message: 'SKILL.md 缺少「恢复卡」约束'
    },
    {
      name: 'SKILL-推荐上限规则',
      file: path.join(skillRoot, 'SKILL.md'),
      pattern: /(?:推荐[^。\n]*最多\s*3\s*(?:条|个)|每次最多\s*3\s*(?:条|个)|最多\s*3\s*个推荐动作)/,
      message: 'SKILL.md 缺少「每次最多3条推荐」约束'
    },
    {
      name: 'team-lead-推荐上限规则',
      file: path.join(skillRoot, '.codebuddy', 'agents', 'fbs-team-lead.md'),
      pattern: /(?:推荐[^。\n]*最多\s*3\s*(?:条|个)|每次最多\s*3\s*(?:条|个)|最多\s*3\s*个推荐动作)/,
      message: 'fbs-team-lead.md 缺少「每次最多3条推荐」约束'
    },
    {
      name: 'team-lead-进度仪表盘规则',
      file: path.join(skillRoot, '.codebuddy', 'agents', 'fbs-team-lead.md'),
      pattern: /进度仪表盘|仪表盘/,
      message: 'fbs-team-lead.md 缺少「进度仪表盘触发」约束'
    },
    {
      name: 'ux-rules-成就式反馈规则',
      file: path.join(skillRoot, 'references', '01-core', 'ux-optimization-rules.md'),
      pattern: /成就式/,
      message: 'ux-optimization-rules.md 缺少「成就式反馈」约束'
    },
    {
      name: 'ux-design-版本与产品对齐',
      file: path.join(skillRoot, 'references', '03-product', '07-ux-design.md'),
      pattern: /\*\*版本\*\*[：:]\s*2\.1\.1/,
      message: '07-ux-design.md 须标明与产品一致的版本 2.1.1（与 package.json / fbs-runtime-hints 对齐）'
    }
  ];

  const failures = [];
  const warnings = [];

  checks.forEach((rule) => {
    const content = readMaybe(rule.file);
    if (!content) {
      failures.push(`${rule.name}: 文件缺失或为空 -> ${rule.file}`);
      return;
    }
    if (!rule.pattern.test(content)) {
      failures.push(`${rule.name}: ${rule.message}`);
    }
  });

  const nextActionFile = path.join(bookRoot, '.fbs', 'next-action.md');
  if (fs.existsSync(nextActionFile)) {
    const actionCount = countActionItems(readMaybe(nextActionFile));
    if (actionCount > 3) {
      failures.push(`next-action 推荐条目超过上限：${actionCount} > 3`);
    }
  } else {
    warnings.push(`未找到 ${nextActionFile}，跳过推荐条目数量检查`);
  }

  console.log('ux-flow-guard: 检查完成');
  if (warnings.length) {
    warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }
  if (failures.length) {
    failures.forEach((f) => console.log(`  ✖ ${f}`));
    if (args.enforce) process.exit(1);
  }

  if (!failures.length) {
    console.log('  ✅ 所有 UX 流畅度规则门禁通过');
  } else {
    console.log(`  ⚠ 检测到 ${failures.length} 项问题（当前为${args.enforce ? '严格' : '提示'}模式）`);
  }
}

main();
