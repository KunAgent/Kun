import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_IGNORE_DIRS = new Set([
  '.git',
  '.fbs',
  '.workbuddy',
  'node_modules',
  'dist',
  'qc-output',
  // deliverables：对外交付 MD/HTML 须纳入 S2 扫描（复盘 P0）
  'releases',
  '.codebuddy',
  '.codebuddy-plugin',
]);

export const QUALITY_SCAN_IGNORE_GLOBS = [
  '**/.git/**',
  '**/.fbs/**',
  '**/.workbuddy/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/qc-output/**',
  '**/releases/**',
  '**/.codebuddy/**',
  '**/.codebuddy-plugin/**',
];

export function shouldIgnoreQualityDir(name) {
  return DEFAULT_IGNORE_DIRS.has(name);
}

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function normalizeRel(filePath, root) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

export function countChars(content) {
  return String(content || '').replace(/\s+/g, '').length;
}

export function resolveScriptSkillRoot(importMetaUrl) {
  const __filename = fileURLToPath(importMetaUrl);
  return path.resolve(path.dirname(__filename), '..', '..');
}

export function collectMarkdownFiles(bookRoot, options = {}) {
  const root = path.resolve(bookRoot);
  const ignoreDirs = new Set([...(options.ignoreDirs || []), ...DEFAULT_IGNORE_DIRS]);
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) continue;
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push(full);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export function readTextFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function inferGroup(relPath) {
  const parts = String(relPath || '').split('/').filter(Boolean);
  if (parts.length <= 1) return 'root';
  return parts[0];
}

function inferTitle(content, relPath) {
  const heading = String(content || '').split(/\r?\n/).find((line) => /^#\s+/.test(line.trim()));
  if (heading) return heading.replace(/^#\s+/, '').trim();
  return path.basename(relPath, path.extname(relPath));
}

export function buildInventory(files, bookRoot) {
  return files.map((filePath, index) => {
    const content = readTextFile(filePath);
    const relPath = normalizeRel(filePath, bookRoot);
    const stats = fs.statSync(filePath);
    return {
      id: `ch${String(index + 1).padStart(3, '0')}`,
      filePath,
      relPath,
      chars: countChars(content),
      group: inferGroup(relPath),
      title: inferTitle(content, relPath),
      mtimeMs: stats.mtimeMs,
    };
  });
}

export function groupInventoryByGroup(inventory) {
  const map = new Map();
  for (const item of inventory) {
    const key = item.group || 'root';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function renderMinimalBookContext(bookRoot, inventory) {
  const grouped = groupInventoryByGroup(inventory);
  const totalChars = inventory.reduce((sum, item) => sum + item.chars, 0);
  const rows = [...grouped.entries()]
    .map(([group, items]) => {
      const chars = items.reduce((sum, item) => sum + item.chars, 0);
      return `| ${group} | ${items.length} | ${chars} | ${items[0]?.relPath || '—'} |`;
    })
    .join('\n');

  return `# 书稿上下文简报（存量质检模式）

> 自动生成：仅为存量书稿质检提供最小工作面，不等同于完整 S0 初始化。

- **书稿根目录**：\`${bookRoot.replace(/\\/g, '/')}\`
- **Markdown 文件数**：${inventory.length}
- **总字符数**：${totalChars}
- **生成时间**：${new Date().toISOString()}

## 目录分布

| 分组 | 文件数 | 字符数 | 示例文件 |
|---|---:|---:|---|
${rows || '| root | 0 | 0 | — |'}

## 说明

1. 本模式仅创建 \`.fbs/book-context-brief.md\` 与 \`.fbs/chapter-status.md\`。
2. 不创建 \`deliverables/\`、\`releases/\`、素材库或搜索台账。
3. 若后续进入完整写作流程，请改用 S0 初始化。\n`;
}

export function renderMinimalChapterStatus(inventory) {
  const rows = inventory.map((item) => (
    `| ${item.id} | ${item.relPath} | ${item.group} | 待质检 | ${item.chars} | 自动扫描生成 |`
  )).join('\n');

  return `# 章节状态台账（存量质检模式）

> 自动生成：用于裸仓库/存量书稿质检，不代表正式写作流程状态台账。

最后更新：${new Date().toISOString()}

| 章节ID | 文件名 | 分组 | 状态 | 字数 | 备注 |
|---|---|---|---|---:|---|
${rows || '| ch001 | — | root | 待质检 | 0 | 无可扫描文件 |'}
`;
}

export function ensureBareQualityWorkspace(bookRoot, options = {}) {
  const root = path.resolve(bookRoot);
  const fbsDir = path.join(root, '.fbs');
  const qcOutputDir = path.join(root, 'qc-output');
  ensureDir(fbsDir);
  ensureDir(qcOutputDir);

  const files = options.files || collectMarkdownFiles(root, options);
  const inventory = options.inventory || buildInventory(files, root);

  const contextPath = path.join(fbsDir, 'book-context-brief.md');
  const statusPath = path.join(fbsDir, 'chapter-status.md');

  if (options.force || !fs.existsSync(contextPath)) {
    fs.writeFileSync(contextPath, renderMinimalBookContext(root, inventory), 'utf8');
  }
  if (options.force || !fs.existsSync(statusPath)) {
    fs.writeFileSync(statusPath, renderMinimalChapterStatus(inventory), 'utf8');
  }

  return {
    bookRoot: root,
    fbsDir,
    qcOutputDir,
    contextPath,
    statusPath,
    inventory,
  };
}

export function resolveQualityReferenceFile(skillRoot, fileName) {
  const candidates = [
    path.resolve(skillRoot || process.cwd(), 'references', '02-quality', fileName),
    path.resolve(skillRoot || process.cwd(), 'FBS-BookWriter', 'references', '02-quality', fileName),
    path.resolve(process.cwd(), 'references', '02-quality', fileName),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}
