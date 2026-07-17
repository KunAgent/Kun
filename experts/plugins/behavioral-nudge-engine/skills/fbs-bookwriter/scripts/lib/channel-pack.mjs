#!/usr/bin/env node
/**
 * 双通道 zip 打包（WorkBuddy / CodeBuddy）。
 *
 * 门禁顺序（失败即 exit 1）：
 *  1. runPackSkillGates — 版本/场景包/SKILL 链接与脚本引用/manifest 字段 + skill-package-consistency（Vitest）
 *  2. audit-entry-performance.mjs — 入口性能与断链
 *  3. 复制 COMMON_REQUIRED_* + 通道 coreFiles
 *  4. 待打包树内 Markdown 本地链接
 *  5. encoding-governance + audit-garble（pack-set）
 *  6. zip → 解包 → 编码/乱码复检 → 全文件 SHA256 对照
 *
 * 环境变量：FBS_PACK_SKIP_SKILL_GATES=1 | FBS_PACK_SKIP_VITEST=1
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { runPackSkillGates } from './pack-skill-gates.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');

const COMMON_REQUIRED_FILES = [
  'SKILL.md',
  'package.json',
  'LICENSE',
  '_plugin_meta.json',
  'references/bibliography.md',
  'fbs-runtime-hints.json',
];

const COMMON_REQUIRED_DIRS = [
  'references/01-core/',
  'references/02-quality/',
  'references/03-product/',
  'references/05-ops/',
  'references/06-plugin/',
  'references/scene-packs/',
  'scene-packs/',
  'scripts/',
  'assets/',
  'releases/',
  'docs/history/',
];

const COMMON_EXTRA_DOC_FILES = [
  'CHANGELOG.md',
  /** 与当前上架版本号一致的「审核版说明」快照；旧版 README-v2.1.1.md 仅留仓库/归档，不随包分发 */
  'README-v2.1.2.md',
];

const COMMON_CORE_FILES = [
  'references/01-core/section-3-workflow.md',
  'references/02-quality/quality-S.md',
  'references/02-quality/s5-buzzword-lexicon.json',
  'scripts/quality-auditor-lite.mjs',
  'scripts/init-fbs-multiagent-artifacts.mjs',
  'scripts/enforce-search-policy.mjs',
  'scripts/s3-start-gate.mjs',
  'scripts/verify-expected-artifacts.mjs',
  'scripts/host-capability-detect.mjs',
  'scripts/host-consume-presentation.mjs',
  'scripts/workbuddy-session-snapshot.mjs',
  'scripts/workbuddy-user-profile-bridge.mjs',
  'scripts/lib/workbuddy-host-runtime.mjs',
  'scripts/workspace-manifest.mjs',
  'scripts/releases-registry.mjs',
  'scripts/plan-board.mjs',
  'scripts/workspace-inspector.mjs',
  'scripts/propagation-debt-tracker.mjs',
  'scripts/workspace-runtime.mjs',
  'scripts/release-feedback-bridge.mjs',
  'assets/build.mjs',
];

const EXCLUDED_RUNTIME_DIRS = new Set(['.offline-cache']);
const EXCLUDED_RUNTIME_FILES = new Set([
  'credits-ledger.json',
  'credits-ledger-log.jsonl',
  'user-config.json',
]);

/** 发布包不包含：源码仓占位/草稿，避免审核误解（仓库内仍保留供内部集成） */
const EXCLUDED_FROM_RELEASE_REPO_REL = new Set(['scripts/wecom/connector-manifest.json']);
const EXCLUDED_HISTORY_ARCHIVE_REL = new Set([
  'docs/history/changelog-archive-internal-lines.md',
  'docs/history/internal-evolution-2.0.2-to-2.1.0.md',
  'docs/history/changelog-appendix-2.0.2-patch-supplement.md',
]);

function toRelativePosix(from, to) {
  return path.relative(from, to).replace(/\\/g, '/');
}

function unique(items) {
  return [...new Set(items)];
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureCleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dst, repoRoot = null) {
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(dst, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);

    if (!entry.isDirectory() && repoRoot) {
      const rel = path.relative(repoRoot, srcPath).replace(/\\/g, '/');
      if (EXCLUDED_FROM_RELEASE_REPO_REL.has(rel)) {
        console.log(`  ⏭️  跳过发布排除项: ${rel}`);
        continue;
      }
      if (EXCLUDED_HISTORY_ARCHIVE_REL.has(rel)) {
        console.log(`  ⏭️  跳过历史归档冗余文档: ${rel}`);
        continue;
      }
    }

    if (entry.isDirectory() && (entry.name === 'test' || entry.name === '__tests__')) {
      console.log(`  ⏭️  跳过测试目录: ${entry.name}`);
      continue;
    }

    if (entry.isDirectory() && EXCLUDED_RUNTIME_DIRS.has(entry.name)) {
      console.log(`  ⏭️  跳过运行时数据目录: ${entry.name}`);
      continue;
    }

    if (entry.isDirectory() && entry.name === '.fbs') {
      console.log(`  ⏭️  跳过过程工件目录: ${entry.name}`);
      continue;
    }

    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath, repoRoot);
      continue;
    }

    if (entry.name.endsWith('.test.mjs') || entry.name.endsWith('.spec.mjs')) {
      console.log(`  ⏭️  跳过测试文件: ${entry.name}`);
      continue;
    }

    if (/^_[\w-]+\.(mjs|js)$/.test(entry.name)) {
      console.log(`  ⏭️  跳过临时脚本: ${entry.name}`);
      continue;
    }

    if (entry.name.endsWith('.recovered')) {
      console.log(`  ⏭️  跳过损坏恢复文件: ${entry.name}`);
      continue;
    }

    if (/\.tmp\.\d+$/i.test(entry.name)) {
      console.log(`  ⏭️  跳过临时残留文件: ${entry.name}`);
      continue;
    }

    if (EXCLUDED_RUNTIME_FILES.has(entry.name)) {
      console.log(`  ⏭️  跳过运行时数据文件: ${entry.name}`);
      continue;
    }

    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.copyFileSync(srcPath, dstPath);
  }
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function buildManifest(rootDir) {
  const manifest = new Map();
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue;

      const rel = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      manifest.set(rel, {
        size: fs.statSync(fullPath).size,
        sha256: hashFile(fullPath),
      });
    }
  }

  return manifest;
}

function compareManifests(expected, actual) {
  const missingFiles = [];
  const extraFiles = [];
  const hashMismatches = [];
  const allKeys = new Set([...expected.keys(), ...actual.keys()]);

  for (const key of [...allKeys].sort()) {
    const left = expected.get(key);
    const right = actual.get(key);

    if (left && !right) {
      missingFiles.push(key);
      continue;
    }
    if (!left && right) {
      extraFiles.push(key);
      continue;
    }
    if (left.sha256 !== right.sha256 || left.size !== right.size) {
      hashMismatches.push({
        file: key,
        expectedSize: left.size,
        actualSize: right.size,
        expectedSha256: left.sha256,
        actualSha256: right.sha256,
      });
    }
  }

  return { missingFiles, extraFiles, hashMismatches };
}

function collectMarkdownFiles(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function auditMarkdownLocalLinks(rootDir) {
  const broken = [];
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

  for (const filePath of collectMarkdownFiles(rootDir)) {
    const text = fs.readFileSync(filePath, 'utf8');
    let match;

    while ((match = linkPattern.exec(text)) !== null) {
      const raw = match[1].trim();
      if (!raw || raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('#')) {
        continue;
      }

      const filePart = raw.split('#')[0].trim();
      if (!filePart) continue;

      const resolved = path.resolve(path.dirname(filePath), filePart);
      if (!fs.existsSync(resolved)) {
        broken.push({
          file: toRelativePosix(rootDir, filePath),
          link: raw,
          resolved: toRelativePosix(rootDir, resolved),
        });
      }
    }
  }

  return broken;
}


function resolvePowerShellExecutable() {
  return process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
}

function runPowerShell(script, envVars, label) {
  execFileSync(resolvePowerShellExecutable(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...envVars,
    },
  });
  console.log(`  ✅ ${label}`);
}

function createZipWithPowerShell(sourceDir, outputPath) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.IO.Compression',
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$sourceRoot = (Resolve-Path $env:PACK_SOURCE_DIR).Path.TrimEnd("\\")',
    '$destinationPath = $env:PACK_OUTPUT_PATH',
    '$destinationParent = Split-Path -Parent $destinationPath',
    'if ($destinationParent -and -not (Test-Path $destinationParent)) { New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null }',
    'if (Test-Path $destinationPath) { Remove-Item $destinationPath -Force }',
    '$stream = [System.IO.File]::Open($destinationPath, [System.IO.FileMode]::Create)',
    'try {',
    '  $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create, $false)',
    '  try {',
    '    Get-ChildItem -Path $sourceRoot -Recurse -File | Sort-Object FullName | ForEach-Object {',
    '      $relative = $_.FullName.Substring($sourceRoot.Length).TrimStart("\\").Replace("\\", "/")',
    '      $entry = $zip.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)',
    '      $entryStream = $entry.Open()',
    '      $fileStream = [System.IO.File]::OpenRead($_.FullName)',
    '      try { $fileStream.CopyTo($entryStream) } finally { $fileStream.Dispose(); $entryStream.Dispose() }',
    '    }',
    '  } finally {',
    '    $zip.Dispose()',
    '  }',
    '} finally {',
    '  $stream.Dispose()',
    '}',
  ].join('; ');

  runPowerShell(script, {
    PACK_SOURCE_DIR: sourceDir,
    PACK_OUTPUT_PATH: outputPath,
  }, outputPath);
}

function extractZipWithPowerShell(zipPath, destinationDir) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$destination = $env:PACK_UNZIP_DIR',
    'if (Test-Path $destination) { Remove-Item $destination -Recurse -Force }',
    'New-Item -ItemType Directory -Path $destination -Force | Out-Null',
    '[System.IO.Compression.ZipFile]::ExtractToDirectory($env:PACK_ZIP_PATH, $destination)',
  ].join('; ');

  runPowerShell(script, {
    PACK_ZIP_PATH: zipPath,
    PACK_UNZIP_DIR: destinationDir,
  }, `解包校验目录 ${destinationDir}`);
}

function runNodeScript(args, label) {
  try {
    execFileSync(process.execPath, args, {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch (error) {
    console.error(`  ❌ ${label} 未通过，已阻断打包`);
    throw error;
  }
}

function runEncodingAudit({ root, dirs, out, label }) {
  const args = [
    path.join(ROOT, 'scripts', 'encoding-governance.mjs'),
    '--root',
    root,
    '--dirs',
    dirs.join(','),
    '--out',
    out,
    '--enforce',
  ];
  runNodeScript(args, label);
}

function verifyRequiredFiles(baseDir, files, label) {
  const missing = files.filter((file) => !fs.existsSync(path.join(baseDir, file)));
  if (missing.length > 0) {
    throw new Error(`${label} 缺少关键文件:\n- ${missing.join('\n- ')}`);
  }
  console.log(`  ✅ ${label}`);
}

function writeVerificationReport(filePath, report) {
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

export function runChannelPack(config) {
  const version = config.version ?? '2.1.1';
  const packageName = config.packageName;
  const packageRootName = config.packageRootName ?? 'fbs-bookwriter';
  const channelLabel = config.channelLabel ?? config.packageName;
  const requiredFiles = unique([...COMMON_REQUIRED_FILES, ...(config.requiredFiles ?? [])]);
  const requiredDirs = unique([...COMMON_REQUIRED_DIRS, ...(config.requiredDirs ?? [])]);
  const coreFiles = unique([...COMMON_CORE_FILES, ...(config.coreFiles ?? [])]);
  const extraDocFiles = unique([...(config.extraDocFiles ?? COMMON_EXTRA_DOC_FILES)]);

  if (!packageName) {
    throw new Error('runChannelPack 缺少 packageName');
  }

  const DIST_DIR = path.join(ROOT, 'dist');
  const TEMP_DIR = path.join(DIST_DIR, `${packageName}-temp`);
  const TEST_UNZIP_ROOT = path.join(DIST_DIR, 'test-unzip', packageName);
  const OUTPUT_PATH = path.join(DIST_DIR, `${packageName}.zip`);
  const VERIFICATION_PATH = path.join(DIST_DIR, `${packageName}.verification.json`);
  const PREPACK_ENCODING_REPORT_PATH = path.join(DIST_DIR, `${packageName}.encoding-prepack.json`);
  const POSTPACK_ENCODING_REPORT_PATH = path.join(DIST_DIR, `${packageName}.encoding-postpack.json`);
  const PREPACK_GARBLE_REPORT_PATH = path.join(DIST_DIR, `${packageName}.garble-prepack.json`);
  const POSTPACK_GARBLE_REPORT_PATH = path.join(DIST_DIR, `${packageName}.garble-postpack.json`);

  console.log('═════════════════════════════════════');
  console.log(` FBS-BookWriter v${version} 打包脚本`);
  console.log('═════════════════════════════════════');
  console.log(`目标：${packageName}.zip`);
  console.log(`通道：${channelLabel}`);

  if (process.env.FBS_PACK_SKIP_SKILL_GATES === '1') {
    console.log('\n⏭️  已跳过 Skill 全量门禁（FBS_PACK_SKIP_SKILL_GATES=1）');
  } else {
    try {
      runPackSkillGates({
        root: ROOT,
        skipVitest: process.env.FBS_PACK_SKIP_VITEST === '1',
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      console.error('  ❌ Skill 门禁未通过，已阻断打包');
      process.exit(1);
    }
  }

  console.log('\n🧪 打包前门禁检查（入口性能）...');
  try {
    runNodeScript([
      path.join(ROOT, 'scripts', 'audit-entry-performance.mjs'),
      '--skill-root',
      '.',
      '--book-root',
      '.',
      '--channel',
      'all',
      '--enforce',
    ], 'audit:entry-gate');
    console.log('  ✅ audit:entry-gate 通过');
  } catch {
    process.exit(1);
  }

  ensureDir(DIST_DIR);
  ensureCleanDir(TEMP_DIR);

  const packageRootDir = path.join(TEMP_DIR, packageRootName);
  fs.mkdirSync(packageRootDir, { recursive: true });

  console.log('\n📦 开始复制文件...');
  for (const file of requiredFiles) {
    const src = path.join(ROOT, file);
    const dst = path.join(packageRootDir, file);

    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      console.log(`  ✅ ${file}`);
      continue;
    }

    if (file === 'LICENSE') {
      console.log(`  ⚠️  ${file} (从 _plugin_meta.json 生成)`);
      const pluginMeta = JSON.parse(fs.readFileSync(path.join(ROOT, '_plugin_meta.json'), 'utf8'));
      const licenseText = `MIT License\n\nCopyright (c) 2026 ${pluginMeta.author}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`;
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, licenseText, 'utf8');
      continue;
    }

    throw new Error(`缺少必选文件: ${file}`);
  }

  for (const dir of requiredDirs) {
    const src = path.join(ROOT, dir);
    const dst = path.join(packageRootDir, dir);
    if (!fs.existsSync(src)) {
      throw new Error(`缺少必选目录: ${dir}`);
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    copyDir(src, dst, ROOT);
    console.log(`  ✅ ${dir}*`);
  }

  const packagedSkillPath = path.join(packageRootDir, 'SKILL.md');
  const skillMdOverride = config.skillMdOverride;
  if (skillMdOverride) {
    const overrideAbs = path.join(ROOT, skillMdOverride);
    if (!fs.existsSync(overrideAbs)) {
      throw new Error(`skillMdOverride 不存在: ${skillMdOverride}`);
    }
    fs.mkdirSync(path.dirname(packagedSkillPath), { recursive: true });
    fs.copyFileSync(overrideAbs, packagedSkillPath);
    console.log(`  ✅ SKILL.md 已由 ${skillMdOverride} 覆盖（OpenClaw 等通道）`);
  }
  if (fs.existsSync(packagedSkillPath)) {
    const skillText = fs.readFileSync(packagedSkillPath, 'utf8');
    const normalizedSkillText = skillText.replaceAll('(./FBS-BookWriter/', '(./');
    fs.writeFileSync(packagedSkillPath, normalizedSkillText, 'utf8');
    console.log('  ✅ SKILL.md 链接已按发布包结构规范化');
  }

  console.log('\n🔍 验证通道关键文件...');
  for (const file of coreFiles) {
    const dst = path.join(packageRootDir, file);
    if (!fs.existsSync(dst)) {
      throw new Error(`缺少通道关键文件: ${file}`);
    }
    const stats = fs.statSync(dst);
    console.log(`  ✅ ${file} (${stats.size} bytes)`);
  }

  console.log('\n📚 复制额外文档...');
  const copiedExtraDocFiles = [];
  for (const file of extraDocFiles) {
    const src = path.join(ROOT, file);
    const dst = path.join(packageRootDir, file);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      copiedExtraDocFiles.push(file);
      console.log(`  ✅ ${file}`);
    } else {
      console.log(`  ⚠️  ${file} (不存在，跳过)`);
    }
  }

  console.log('\n🔗 审计待打包目录内的 Markdown 本地链接...');
  const brokenMarkdownLinks = auditMarkdownLocalLinks(packageRootDir);
  if (brokenMarkdownLinks.length > 0) {
    console.error('  ❌ 待打包目录存在本地断链：');
    brokenMarkdownLinks.slice(0, 20).forEach((item) => {
      console.error(`    - ${item.file} -> ${item.link} (resolved: ${item.resolved})`);
    });
    if (brokenMarkdownLinks.length > 20) {
      console.error(`    ... 还有 ${brokenMarkdownLinks.length - 20} 处断链`);
    }
    throw new Error('打包前 Markdown 本地链接审计未通过');
  }
  console.log('  ✅ Markdown 本地链接审计通过');

  const postPackRequiredFiles = unique([...requiredFiles, ...coreFiles, ...copiedExtraDocFiles]);

  console.log('\n🧪 打包内容编码门禁（仅检查待打包集合）...');
  try {
    runEncodingAudit({
      root: TEMP_DIR,
      dirs: [packageRootName],
      out: toRelativePosix(TEMP_DIR, PREPACK_ENCODING_REPORT_PATH),
      label: 'audit:encoding (pack-set)',
    });
    console.log('  ✅ audit:encoding (pack-set) 通过');
  } catch {
    process.exit(1);
  }

  console.log('\n🧪 打包内容乱码审计（仅检查待打包集合）...');
  try {
    runNodeScript([
      path.join(ROOT, 'scripts', 'audit-garble.mjs'),
      '--root', TEMP_DIR,
      '--dirs', packageRootName,
      '--out', toRelativePosix(TEMP_DIR, PREPACK_GARBLE_REPORT_PATH),
      '--enforce',
      '--verbose',
    ], 'audit:garble (pack-set)');
    console.log('  ✅ audit:garble (pack-set) 通过');
  } catch {
    process.exit(1);
  }

  const sourceManifest = buildManifest(TEMP_DIR);
  const totalFiles = sourceManifest.size;
  console.log(`\n📊 文件统计：${totalFiles} 个文件`);

  console.log('\n🗜️  开始打包...');
  try {
    createZipWithPowerShell(TEMP_DIR, OUTPUT_PATH);
  } catch (error) {
    console.error('  ❌ PowerShell ZipArchive 打包失败');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  console.log('\n🧪 打包后解包复检（结构 + 编码 + SHA256）...');
  try {
    extractZipWithPowerShell(OUTPUT_PATH, TEST_UNZIP_ROOT);

    const unpackedPackageDir = path.join(TEST_UNZIP_ROOT, packageRootName);
    if (!fs.existsSync(unpackedPackageDir)) {
      throw new Error(`解包后缺少技能根目录: ${packageRootName}`);
    }

    verifyRequiredFiles(unpackedPackageDir, postPackRequiredFiles, '解包后关键文件齐全');

    runEncodingAudit({
      root: TEST_UNZIP_ROOT,
      dirs: [packageRootName],
      out: toRelativePosix(TEST_UNZIP_ROOT, POSTPACK_ENCODING_REPORT_PATH),
      label: 'audit:encoding (post-pack)',
    });
    console.log('  ✅ audit:encoding (post-pack) 通过');

    console.log('\n  🧪 解包后乱码审计...');
    runNodeScript([
      path.join(ROOT, 'scripts', 'audit-garble.mjs'),
      '--root', TEST_UNZIP_ROOT,
      '--dirs', packageRootName,
      '--out', toRelativePosix(TEST_UNZIP_ROOT, POSTPACK_GARBLE_REPORT_PATH),
      '--enforce',
      '--verbose',
    ], 'audit:garble (post-pack)');
    console.log('  ✅ audit:garble (post-pack) 通过');

    const unpackedManifest = buildManifest(TEST_UNZIP_ROOT);
    const diff = compareManifests(sourceManifest, unpackedManifest);
    const verificationReport = {
      packageName,
      version,
      channel: channelLabel,
      generatedAt: new Date().toISOString(),
      zipPath: OUTPUT_PATH,
      tempDir: TEMP_DIR,
      unzipDir: TEST_UNZIP_ROOT,
      prepackEncodingReportPath: PREPACK_ENCODING_REPORT_PATH,
      postpackEncodingReportPath: POSTPACK_ENCODING_REPORT_PATH,
      prepackGarbleReportPath: PREPACK_GARBLE_REPORT_PATH,
      postpackGarbleReportPath: POSTPACK_GARBLE_REPORT_PATH,
      sourceFileCount: sourceManifest.size,
      unpackedFileCount: unpackedManifest.size,
      missingFiles: diff.missingFiles,
      extraFiles: diff.extraFiles,
      hashMismatches: diff.hashMismatches,
      passed: diff.missingFiles.length === 0 && diff.extraFiles.length === 0 && diff.hashMismatches.length === 0,
    };

    writeVerificationReport(VERIFICATION_PATH, verificationReport);

    if (!verificationReport.passed) {
      throw new Error(`解包校验失败：missing=${diff.missingFiles.length}, extra=${diff.extraFiles.length}, mismatched=${diff.hashMismatches.length}`);
    }

    if (unpackedManifest.size !== totalFiles) {
      throw new Error(`文件数量不一致：源=${totalFiles}，解包=${unpackedManifest.size}`);
    }

    console.log(`  ✅ SHA256 校验通过（${sourceManifest.size} 个文件）`);
    console.log(`  ✅ 校验报告：${VERIFICATION_PATH}`);
  } catch (error) {
    const failedReport = {
      packageName,
      version,
      channel: channelLabel,
      generatedAt: new Date().toISOString(),
      zipPath: OUTPUT_PATH,
      tempDir: TEMP_DIR,
      unzipDir: TEST_UNZIP_ROOT,
      prepackEncodingReportPath: PREPACK_ENCODING_REPORT_PATH,
      postpackEncodingReportPath: POSTPACK_ENCODING_REPORT_PATH,
      prepackGarbleReportPath: PREPACK_GARBLE_REPORT_PATH,
      postpackGarbleReportPath: POSTPACK_GARBLE_REPORT_PATH,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    };
    writeVerificationReport(VERIFICATION_PATH, failedReport);
    console.error('  ❌ 打包后复检失败，已阻断交付');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  console.log('\n═════════════════════════════════════');
  console.log(` v${version} 打包完成`);
  console.log('═════════════════════════════════════');
  console.log(`输出文件：${OUTPUT_PATH}`);
  console.log(`Pre-pack 编码报告：${PREPACK_ENCODING_REPORT_PATH}`);
  console.log(`Post-pack 编码报告：${POSTPACK_ENCODING_REPORT_PATH}`);
  console.log(`Pre-pack 乱码报告：${PREPACK_GARBLE_REPORT_PATH}`);
  console.log(`Post-pack 乱码报告：${POSTPACK_GARBLE_REPORT_PATH}`);
  console.log(`校验报告：${VERIFICATION_PATH}`);
  console.log(`文件数量：${totalFiles}`);
  console.log(`版本：${version}`);
  console.log(`适配：${channelLabel}`);
  console.log(`临时目录保留：${TEMP_DIR}`);
  console.log(`解包复检目录保留：${TEST_UNZIP_ROOT}`);

  return {
    packageName,
    version,
    channel: channelLabel,
    outputPath: OUTPUT_PATH,
    verificationPath: VERIFICATION_PATH,
  };
}
