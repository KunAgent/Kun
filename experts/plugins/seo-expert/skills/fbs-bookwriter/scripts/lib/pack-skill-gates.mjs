#!/usr/bin/env node
/**
 * 打包前 Skill 完整性 / 一致性 / 可用性门禁（静态）
 *
 * 与 runChannelPack 配合：在复制与 zip 之前阻断明显缺陷。
 * 环境变量：
 *   FBS_PACK_SKIP_VITEST=1              跳过 skill-package-consistency 单测
 *   FBS_PACK_SKIP_UX_GUARD=1            跳过 ux-flow-guard
 *   FBS_PACK_SKIP_CONSISTENCY_AUDIT=1   跳过 consistency-audit
 *   FBS_PACK_SKIP_RUNTIME_HINTS=1       跳过 fbs-runtime-hints 结构校验
 *   FBS_PACK_SKIP_EVOLUTION_GATE=1      跳过 scripts 清单生成 + evolution-gate
 *   FBS_PACK_SKIP_VISIBLE_TECH_KPI=1    跳过 visible-tech-action-kpi（静态）
 *   FBS_PACK_SKIP_TOOL_BUDGET=1         跳过 tool-output-budget-gate（静态）
 *   FBS_PACK_SKIP_SKILL_IMPORT_SCAN=1   跳过 skill-import-security-scan
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { validateSkillFrontmatter } from './skill-frontmatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..', '..');

/**
 * @param {{ root?: string, skipVitest?: boolean }} [options]
 * @returns {{ passed: boolean, phases: Record<string, { ok: boolean, detail?: string }> }}
 */
export function runPackSkillGates(options = {}) {
  const root = path.resolve(options.root ?? DEFAULT_ROOT);
  const skipVitest = Boolean(options.skipVitest);

  const phases = {
    versions: { ok: false },
    scenePacks: { ok: false },
    skillLinks: { ok: false },
    skillScripts: { ok: false },
    manifests: { ok: false },
    vitest: { ok: false, detail: skipVitest ? 'skipped' : undefined },
  };

  console.log('\n🛡️  Skill 门禁（完整性 · 一致性 · 可用性）...');

  // —— 版本三角
  const skillText = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
  const fm = parseSkillFrontmatter(skillText);
  if (!fm.version) {
    throw new Error('SKILL.md frontmatter 缺少 version');
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(root, '_plugin_meta.json'), 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'scene-packs/registry.json'), 'utf8'));
  const wb = JSON.parse(fs.readFileSync(path.join(root, 'workbuddy/channel-manifest.json'), 'utf8'));
  const cb = JSON.parse(fs.readFileSync(path.join(root, 'codebuddy/channel-manifest.json'), 'utf8'));
  const plugin = JSON.parse(fs.readFileSync(path.join(root, '.codebuddy-plugin/plugin.json'), 'utf8'));

  const versionTargets = [
    ['SKILL.md', fm.version],
    ['package.json', pkg.version],
    ['package.json#scene-pack-version', pkg['scene-pack-version']],
    ['_plugin_meta.json', meta.version],
    ['scene-packs/registry.json#_version', registry._version],
    ['workbuddy/channel-manifest.json#skill.version', wb.skill?.version],
    ['codebuddy/channel-manifest.json#skill.version', cb.skill?.version],
    ['.codebuddy-plugin/plugin.json', plugin.version],
  ];

  const base = fm.version;
  const mismatched = versionTargets.filter(([, v]) => v !== base);
  if (mismatched.length > 0) {
    const lines = mismatched.map(([k, v]) => `    - ${k}: ${v ?? '(空)'}`).join('\n');
    throw new Error(`版本号不一致（基准 SKILL.md = ${base}）：\n${lines}`);
  }
  phases.versions = { ok: true, detail: base };
  console.log(`  ✅ 版本对齐：${base}`);

  // —— 场景包：frontmatter ↔ registry ↔ 磁盘规则文件
  if (!fm.scenePacks?.length) {
    throw new Error('SKILL.md frontmatter 缺少 scene-packs 列表');
  }
  for (const id of fm.scenePacks) {
    if (!registry.packs?.[id]) {
      throw new Error(`scene-packs/registry.json 缺少 packs.${id}（与 SKILL.md scene-packs 不一致）`);
    }
    const main = path.join(root, 'references/scene-packs', `${id}.md`);
    const local = path.join(root, 'references/scene-packs', `${id}-local-rule.md`);
    if (!fs.existsSync(main)) {
      throw new Error(`场景包主规则缺失：references/scene-packs/${id}.md`);
    }
    if (!fs.existsSync(local)) {
      throw new Error(`场景包 local-rule 缺失：references/scene-packs/${id}-local-rule.md`);
    }
  }
  const metaAvailable = new Set([...(meta.scene_packs?.builtin ?? []), ...(meta.scene_packs?.available ?? [])]);
  for (const id of fm.scenePacks) {
    if (!metaAvailable.has(id)) {
      throw new Error(`_plugin_meta.json scene_packs 未列出「${id}」（应与 SKILL.md 对齐）`);
    }
  }
  phases.scenePacks = { ok: true, detail: `${fm.scenePacks.length} packs` };
  console.log(`  ✅ 场景包：${fm.scenePacks.join(', ')}`);

  // —— SKILL.md 内 Markdown 本地链接（./ 相对路径）
  const brokenLinks = auditSkillMarkdownLinks(root, skillText);
  if (brokenLinks.length > 0) {
    const sample = brokenLinks
      .slice(0, 12)
      .map((b) => `    - ${b.link} → ${b.resolved}`)
      .join('\n');
    throw new Error(`SKILL.md 存在 ${brokenLinks.length} 处断链：\n${sample}`);
  }
  phases.skillLinks = { ok: true };
  console.log('  ✅ SKILL.md 内嵌本地链接可解析');

  // —— 速查表 / 正文引用的 scripts 路径
  const scriptRefs = extractScriptRefsFromSkill(skillText);
  const missingScripts = scriptRefs.filter((rel) => !fs.existsSync(path.join(root, rel)));
  if (missingScripts.length > 0) {
    throw new Error(`SKILL.md 引用但仓库不存在的脚本：\n- ${missingScripts.join('\n- ')}`);
  }
  phases.skillScripts = { ok: true, detail: `${scriptRefs.length} refs` };
  console.log(`  ✅ SKILL.md 引用的脚本路径存在（${scriptRefs.length}）`);

  const fmKeys = validateSkillFrontmatter(root);
  if (!fmKeys.ok) {
    throw new Error(`SKILL.md frontmatter 键校验失败：\n- ${fmKeys.errors.join('\n- ')}`);
  }
  console.log('  ✅ SKILL.md frontmatter 键白名单');

  // —— 双通道 manifest 与插件元数据
  if (wb.skill?.id !== 'fbs-bookwriter' || cb.skill?.id !== 'fbs-bookwriter') {
    throw new Error('channel-manifest skill.id 应为 fbs-bookwriter');
  }
  if (plugin.name !== 'fbs-bookwriter') {
    throw new Error('.codebuddy-plugin/plugin.json name 应为 fbs-bookwriter');
  }
  if (plugin.settings?.channelManifest !== 'codebuddy/channel-manifest.json') {
    throw new Error('plugin.json settings.channelManifest 应为 codebuddy/channel-manifest.json');
  }
  phases.manifests = { ok: true };
  console.log('  ✅ 通道 manifest / plugin 基础字段一致');

  // —— fbs-runtime-hints 机读约定（防漂移）
  if (process.env.FBS_PACK_SKIP_RUNTIME_HINTS === '1') {
    console.log('  ⏭️  validate-runtime-hints 已跳过（FBS_PACK_SKIP_RUNTIME_HINTS=1）');
  } else {
    try {
      execFileSync(process.execPath, [path.join(root, 'scripts/validate-runtime-hints.mjs'), '--skill-root', root], {
        cwd: root,
        stdio: 'inherit',
      });
    } catch {
      throw new Error('validate-runtime-hints 未通过（可用 FBS_PACK_SKIP_RUNTIME_HINTS=1 跳过）');
    }
    console.log('  ✅ validate-runtime-hints');
  }

  // —— 可见技术处理解释 KPI（静态门禁）
  if (process.env.FBS_PACK_SKIP_VISIBLE_TECH_KPI === '1') {
    console.log('  ⏭️  visible-tech-action-kpi 已跳过（FBS_PACK_SKIP_VISIBLE_TECH_KPI=1）');
  } else {
    try {
      execFileSync(
        process.execPath,
        [path.join(root, 'scripts/visible-tech-action-kpi.mjs'), '--skill-root', root, '--book-root', root, '--mode', 'static', '--enforce'],
        { cwd: root, stdio: 'inherit' },
      );
    } catch {
      throw new Error('visible-tech-action-kpi 未通过（可用 FBS_PACK_SKIP_VISIBLE_TECH_KPI=1 跳过）');
    }
    console.log('  ✅ visible-tech-action-kpi');
  }

  // —— 工具输出预算（静态预算门禁，防超长输出回灌）
  if (process.env.FBS_PACK_SKIP_TOOL_BUDGET === '1') {
    console.log('  ⏭️  tool-output-budget-gate 已跳过（FBS_PACK_SKIP_TOOL_BUDGET=1）');
  } else {
    try {
      execFileSync(
        process.execPath,
        [path.join(root, 'scripts/tool-output-budget-gate.mjs'), '--book-root', root, '--max-per-file-kb', '1024', '--max-total-mb', '16', '--enforce'],
        { cwd: root, stdio: 'inherit' },
      );
    } catch {
      throw new Error('tool-output-budget-gate 未通过（可用 FBS_PACK_SKIP_TOOL_BUDGET=1 跳过）');
    }
    console.log('  ✅ tool-output-budget-gate');
  }

  // —— Skill 导入安全扫描
  if (process.env.FBS_PACK_SKIP_SKILL_IMPORT_SCAN === '1') {
    console.log('  ⏭️  skill-import-security-scan 已跳过（FBS_PACK_SKIP_SKILL_IMPORT_SCAN=1）');
  } else {
    try {
      execFileSync(process.execPath, [path.join(root, 'scripts/skills-import-guard.mjs'), '--skill-root', root, '--enforce'], {
        cwd: root,
        stdio: 'inherit',
      });
    } catch {
      throw new Error('skill-import-security-scan 未通过（可用 FBS_PACK_SKIP_SKILL_IMPORT_SCAN=1 跳过）');
    }
    console.log('  ✅ skill-import-security-scan');
  }

  if (process.env.FBS_PACK_SKIP_EVOLUTION_GATE === '1') {
    console.log('  ⏭️  evolution-gate 已跳过（FBS_PACK_SKIP_EVOLUTION_GATE=1）');
  } else {
    try {
      execFileSync(process.execPath, [path.join(root, 'scripts/generate-scripts-manifest.mjs')], {
        cwd: root,
        stdio: 'pipe',
      });
    } catch {
      /* manifest 生成失败时由 evolution-gate 报具体原因 */
    }
    try {
      execFileSync(process.execPath, [path.join(root, 'scripts/evolution-gate.mjs')], {
        cwd: root,
        stdio: 'inherit',
      });
    } catch {
      throw new Error('evolution-gate 未通过（可先运行 node scripts/generate-scripts-manifest.mjs；或 FBS_PACK_SKIP_EVOLUTION_GATE=1 跳过）');
    }
    console.log('  ✅ evolution-gate');
  }

  // —— UX 流畅度（恢复卡 / 最多 3 条推荐等）
  if (process.env.FBS_PACK_SKIP_UX_GUARD === '1') {
    console.log('  ⏭️  ux-flow-guard 已跳过（FBS_PACK_SKIP_UX_GUARD=1）');
  } else {
    try {
      execFileSync(
        process.execPath,
        [path.join(root, 'scripts/ux-flow-guard.mjs'), '--skill-root', root, '--book-root', root, '--enforce'],
        { cwd: root, stdio: 'inherit' },
      );
    } catch {
      throw new Error('ux-flow-guard 未通过（可用 FBS_PACK_SKIP_UX_GUARD=1 跳过）');
    }
    console.log('  ✅ ux-flow-guard');
  }

  // —— 文档-脚本一致性审计（SKILL 引用脚本落盘）
  if (process.env.FBS_PACK_SKIP_CONSISTENCY_AUDIT === '1') {
    console.log('  ⏭️  consistency-audit 已跳过（FBS_PACK_SKIP_CONSISTENCY_AUDIT=1）');
  } else {
    try {
      execFileSync(process.execPath, [path.join(root, 'scripts/consistency-audit.mjs')], {
        cwd: root,
        stdio: 'inherit',
      });
    } catch {
      throw new Error('consistency-audit 未通过（可用 FBS_PACK_SKIP_CONSISTENCY_AUDIT=1 跳过）');
    }
    console.log('  ✅ consistency-audit');
  }

  // —— 契约单测（skill 包级）
  if (skipVitest) {
    console.log('  ⏭️  skill-package-consistency（Vitest）已跳过（FBS_PACK_SKIP_VITEST=1）');
  } else {
    const vitestEntry = path.join(root, 'node_modules/vitest/vitest.mjs');
    if (!fs.existsSync(vitestEntry)) {
      throw new Error('未找到 node_modules/vitest，请先 npm install（打包需 devDependencies 以运行契约测试）');
    }
    try {
      execFileSync(
        process.execPath,
        [
          vitestEntry,
          'run',
          path.join(root, 'scripts/test/skill-package-consistency.test.mjs'),
          '--config',
          path.join(root, 'vitest.config.mjs'),
          '--reporter',
          'dot',
        ],
        { cwd: root, stdio: 'inherit' },
      );
    } catch {
      throw new Error('skill-package-consistency 测试未通过（可用 FBS_PACK_SKIP_VITEST=1 跳过）');
    }
    phases.vitest = { ok: true };
    console.log('  ✅ skill-package-consistency（Vitest）');
  }

  console.log('  ✅ Skill 门禁全部通过\n');

  return { passed: true, phases };
}

function parseSkillFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { version: null, scenePacks: [] };
  const block = m[1];
  let version = null;
  const vm = block.match(/^version:\s*([\d.]+)\s*$/m);
  if (vm) version = vm[1];

  const scenePacks = [];
  const sm = block.match(/scene-packs:\s*\[([^\]]+)\]/);
  if (sm) {
    for (const part of sm[1].split(',')) {
      const id = part.trim();
      if (id) scenePacks.push(id);
    }
  }

  return { version, scenePacks };
}

function auditSkillMarkdownLinks(root, skillText) {
  const broken = [];
  const linkPattern = /\[[^\]]*\]\(\.\/([^)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(skillText)) !== null) {
    const raw = match[1].trim();
    const filePart = raw.split('#')[0].trim();
    if (!filePart) continue;
    const resolved = path.resolve(root, filePart);
    if (!fs.existsSync(resolved)) {
      broken.push({ link: `./${raw}`, resolved: path.relative(root, resolved) });
    }
  }
  return broken;
}

function extractScriptRefsFromSkill(skillText) {
  const set = new Set();

  const backtickNode = /`node\s+(scripts\/[^\s`]+\.(?:mjs|ps1))`/g;
  let m;
  while ((m = backtickNode.exec(skillText)) !== null) {
    set.add(m[1]);
  }

  const plain = /(?:^|[\s|`])(scripts\/[a-zA-Z0-9_.-]+\.(?:mjs|ps1))/g;
  while ((m = plain.exec(skillText)) !== null) {
    set.add(m[1]);
  }

  return [...set].sort();
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  try {
    runPackSkillGates({
      root: DEFAULT_ROOT,
      skipVitest: process.env.FBS_PACK_SKIP_VITEST === '1',
      // ux / consistency 由环境变量控制，见文件头注释
    });
    process.exit(0);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
