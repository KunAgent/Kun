#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { writeTestResultArtifacts } from './lib/runtime-result-store.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_IGNORE = new Set(['.git', 'node_modules', 'dist', '.workbuddy', '.codebuddy', '.codebuddy-plugin', 'deliverables', 'releases', 'qc-output']);

function parseArgs(argv) {
  const args = {
    target: DEFAULT_ROOT,
    base: null,
    enforce: false,
    head: 200,
  };

  for (let i = 2; i < argv.length; i++) {
    const current = argv[i];
    if (current === '--target' && argv[i + 1]) args.target = path.resolve(argv[++i]);
    else if (current === '--base' && argv[i + 1]) args.base = path.resolve(argv[++i]);
    else if (current === '--enforce') args.enforce = true;
    else if (current === '--head' && argv[i + 1]) args.head = Math.max(1, Number(argv[++i]) || args.head);
    else if (current === '--help' || current === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`upgrade-diff-scan.mjs — 升级差异扫描

用法：
  node scripts/upgrade-diff-scan.mjs --base <旧目录> [--target <新目录>] [--enforce]

输出：
  - 标准 JSON / Markdown 报告写入 <target>/.fbs/test-results/
  - 默认只做扫描；加 --enforce 时若存在差异则返回退出码 1
`);
}

function shouldIgnore(relPath) {
  return relPath.split('/').some((part) => DEFAULT_IGNORE.has(part));
}

function collectFiles(rootDir) {
  const root = path.resolve(rootDir);
  const files = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (!rel) continue;
      if (shouldIgnore(rel)) continue;
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function scanUpgradeDiff({ baseDir, targetDir, head = 200 }) {
  const baseFiles = collectFiles(baseDir);
  const targetFiles = collectFiles(targetDir);
  const baseSet = new Set(baseFiles);
  const targetSet = new Set(targetFiles);

  const onlyInBase = baseFiles.filter((file) => !targetSet.has(file));
  const onlyInTarget = targetFiles.filter((file) => !baseSet.has(file));
  const changed = [];

  for (const rel of baseFiles) {
    if (!targetSet.has(rel)) continue;
    const baseHash = sha256(path.join(baseDir, rel));
    const targetHash = sha256(path.join(targetDir, rel));
    if (baseHash !== targetHash) {
      changed.push({ relPath: rel, baseHash, targetHash });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    baseDir: path.resolve(baseDir),
    targetDir: path.resolve(targetDir),
    summary: {
      baseFiles: baseFiles.length,
      targetFiles: targetFiles.length,
      onlyInBase: onlyInBase.length,
      onlyInTarget: onlyInTarget.length,
      changed: changed.length,
      identical: baseFiles.length - onlyInBase.length - changed.length,
    },
    onlyInBase: onlyInBase.slice(0, head),
    onlyInTarget: onlyInTarget.slice(0, head),
    changed: changed.slice(0, head),
    truncated: {
      onlyInBase: Math.max(0, onlyInBase.length - head),
      onlyInTarget: Math.max(0, onlyInTarget.length - head),
      changed: Math.max(0, changed.length - head),
    },
  };
}

function renderMarkdown(report) {
  const onlyInBase = report.onlyInBase.length
    ? report.onlyInBase.map((file) => `- ${file}`).join('\n')
    : '- 无';
  const onlyInTarget = report.onlyInTarget.length
    ? report.onlyInTarget.map((file) => `- ${file}`).join('\n')
    : '- 无';
  const changed = report.changed.length
    ? report.changed.map((item) => `- ${item.relPath}`).join('\n')
    : '- 无';

  return `# 升级差异扫描结果\n\n- **baseDir**：${report.baseDir.replace(/\\/g, '/')}\n- **targetDir**：${report.targetDir.replace(/\\/g, '/')}\n- **生成时间**：${report.generatedAt}\n\n## 汇总\n\n- **baseFiles**：${report.summary.baseFiles}\n- **targetFiles**：${report.summary.targetFiles}\n- **onlyInBase**：${report.summary.onlyInBase}\n- **onlyInTarget**：${report.summary.onlyInTarget}\n- **changed**：${report.summary.changed}\n- **identical**：${report.summary.identical}\n\n## 仅 base 存在\n${onlyInBase}\n\n## 仅 target 存在\n${onlyInTarget}\n\n## 内容不同\n${changed}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.base) {
    printHelp();
    process.exit(args.help ? 0 : 2);
  }

  const report = scanUpgradeDiff({
    baseDir: args.base,
    targetDir: args.target,
    head: args.head,
  });

  const artifactId = `upgrade-diff-scan-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
  const persisted = writeTestResultArtifacts({
    bookRoot: args.target,
    artifactId,
    jsonPayload: report,
    markdownContent: renderMarkdown(report),
  });

  const output = {
    ...report.summary,
    artifactId,
    jsonPath: persisted.jsonPath,
    markdownPath: persisted.markdownPath,
  };
  console.log(JSON.stringify(output, null, 2));

  if (args.enforce && (report.summary.onlyInBase > 0 || report.summary.onlyInTarget > 0 || report.summary.changed > 0)) {
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    main();
  } catch (error) {
    console.error(`upgrade-diff-scan 失败: ${error.message}`);
    process.exit(1);
  }
}
