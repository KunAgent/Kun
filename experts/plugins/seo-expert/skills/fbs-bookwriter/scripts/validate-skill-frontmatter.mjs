#!/usr/bin/env node
/**
 * 校验 SKILL.md frontmatter 顶层键是否在白名单内。
 * pack:skill-gates / npm run doctor 使用。
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { validateSkillFrontmatter } from './lib/skill-frontmatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const o = { skillRoot: path.resolve(__dirname, '..'), help: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--skill-root' && argv[i + 1]) o.skillRoot = path.resolve(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') o.help = true;
  }
  return o;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('用法: node scripts/validate-skill-frontmatter.mjs [--skill-root <技能根>]');
    process.exit(0);
  }

  const { ok, errors } = validateSkillFrontmatter(args.skillRoot);
  if (ok) {
    console.log('validate-skill-frontmatter: ✅ SKILL.md frontmatter 键白名单通过');
    process.exit(0);
  }
  console.error('validate-skill-frontmatter: ❌ 校验失败');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

if (process.argv[1] && process.argv[1].includes('validate-skill-frontmatter')) {
  main();
}
