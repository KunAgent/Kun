#!/usr/bin/env node
/**
 * 团队移交包：单个 ZIP，内含约定文档 + 根目录 说明.md（不再另附 dist 侧说明文件）。
 * 非上架技能包；上架请 npm run pack:workbuddy
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ZIP_NAME = 'fbs-bookwriter-team-handoff-v211.zip';

/** 自仓库根目录复制的文件（保留相对路径） */
const EXTRA_FILES = [
  'releases/workbuddy-integration-checklist.md',
  'releases/workbuddy-review-v2.1.1.md',
  'releases/codebuddy-review-v2.1.1.md',
  'releases/README.md',
  'references/05-ops/credits-guide.md',
  'references/05-ops/ux-agent-playbook.md',
  'references/06-plugin/workbuddy-host-integration.md',
  'references/06-plugin/tier1-marketplace-faq.md',
  'references/01-core/runtime-mandatory-contract.md',
  'references/01-core/intake-and-routing.md',
  'references/01-core/skill-cli-bridge-matrix.md',
  'references/01-core/s0-material-phase-guard.md',
  'docs/README.md',
  'CHANGELOG.md',
  'README-v2.1.2.md',
  'fbs-runtime-hints.json',
  'workbuddy/channel-manifest.json',
  '_plugin_meta.json',
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFileSafe(srcRel, stagingRoot) {
  const src = path.join(ROOT, srcRel);
  if (!fs.existsSync(src)) {
    throw new Error(`移交清单缺少文件: ${srcRel}`);
  }
  const dst = path.join(stagingRoot, srcRel);
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function buildReadme(manifestLines, packagedAt) {
  return `# FBS-BookWriter 团队移交包 · 说明

> **版本**：2.1.1（与 WorkBuddy 过审技能包版本对齐）  
> **打包时间**：${packagedAt}  
> **性质**：团队内部移交用文档与契约快照；**不是**市场上架 zip，**不含**完整 \`scripts/\` 源码树。

---

## 1. 请先读本文档

本 ZIP **根目录**已包含移交所需的 Markdown、JSON 与目录索引；开箱后**先读本文件**，再按岗位打开下表路径。

---

## 2. 本包内容索引

| 路径 | 用途 |
|------|------|
${manifestLines}

---

## 3. 与完整仓库、上架包的关系

| 产物 | 说明 |
|------|------|
| **本 ZIP** | 文档与机读契约节选，便于运营/维护同事**不传整仓**即可对齐口径 |
| **Git 仓库** | 权威源码与 \`scripts/\`；开发与修 bug 以仓库为准 |
| **上架技能包** | \`npm run pack:workbuddy\` → \`dist/fbs-bookwriter-v211-workbuddy.zip\`，用于送审与分发 |

---

## 4. 维护与乐包入口（速查）

- 内部开发版定义：\`internal/team-dev-edition.md\`
- 乐包：\`references/05-ops/credits-guide.md\` + 仓库内 \`scripts/wecom/lib/credits-ledger.mjs\`（本包不含脚本正文）
- 宿主展示：\`references/06-plugin/workbuddy-host-integration.md\`、\`fbs-runtime-hints.json\`

---

*由 \`scripts/pack-team-handoff.mjs\` 生成根目录 \`说明.md\` 并打 zip。*
`;
}

function main() {
  const internalSrc = path.join(ROOT, 'docs', 'internal');
  if (!fs.existsSync(internalSrc)) {
    console.error('缺少:', internalSrc);
    process.exit(1);
  }

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'fbs-handoff-'));
  try {
    fs.cpSync(internalSrc, path.join(staging, 'internal'), { recursive: true });

    for (const rel of EXTRA_FILES) {
      copyFileSafe(rel, staging);
    }

    const rows = [];
    rows.push('| `说明.md` | 本说明（根目录，先读） |');
    rows.push('| `internal/` | 团队内部文档：开发版定义、与过审安装/送审包关系 |');
    for (const rel of EXTRA_FILES) {
      const label =
        rel.includes('codebuddy-review') ? 'CodeBuddy 通道 review 备忘' :
        rel.includes('workbuddy-review') ? 'WorkBuddy 通道 review 备忘' :
        rel.startsWith('releases/') ? '上架/集成清单与 review 备忘' :
        rel.includes('credits-guide') ? '乐包（Credits）产品与规则' :
        rel.includes('ux-agent-playbook') ? 'Agent 用户体验执行清单' :
        rel.includes('workbuddy-host-integration') ? 'WorkBuddy 宿主集成契约' :
        rel.includes('tier1-marketplace-faq') ? 'Tier1 本地市场 FAQ' :
        rel.includes('runtime-mandatory-contract') ? '运行时强制契约（intake / exit）' :
        rel.includes('intake-and-routing') ? '摄入与路由规范' :
        rel.includes('skill-cli-bridge-matrix') ? 'Skill↔脚本↔CLI 矩阵' :
        rel.includes('s0-material-phase-guard') ? 'S0 素材阶段防无限 S0、继续语义' :
        rel === 'docs/README.md' ? 'docs 目录索引' :
        rel === 'CHANGELOG.md' ? '版本变更全记录' :
        rel === 'README-v2.1.2.md' ? 'v2.1.2 审核版说明（随版本快照）' :
        rel === 'fbs-runtime-hints.json' ? '机读运行时提示（宿主可消费）' :
        rel.includes('channel-manifest.json') ? 'WorkBuddy 通道清单（入口脚本路径）' :
        rel === '_plugin_meta.json' ? '插件元数据（版本/能力声明）' :
        '移交文档';
      rows.push(`| \`${rel.replace(/\\/g, '/')}\` | ${label} |`);
    }

    const packagedAt = new Date().toISOString();
    const readme = buildReadme(rows.join('\n'), packagedAt);
    fs.writeFileSync(path.join(staging, '说明.md'), readme, 'utf8');

    ensureDir(DIST);
    const zipPath = path.join(DIST, ZIP_NAME);
    const zip = new AdmZip();
    zip.addLocalFolder(staging, '');
    zip.writeZip(zipPath);

    const bytes = fs.statSync(zipPath).size;
    console.log('═════════════════════════════════════');
    console.log(' 团队移交包已生成（单 ZIP 含说明 + 文档）');
    console.log('═════════════════════════════════════');
    console.log(`输出：${zipPath}`);
    console.log(`大小：${(bytes / 1024).toFixed(1)} KB`);
    console.log('');
    console.log('上架技能包请使用：npm run pack:workbuddy');
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

main();
