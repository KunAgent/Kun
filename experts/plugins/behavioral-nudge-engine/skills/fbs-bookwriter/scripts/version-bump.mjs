#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');


function parseArgs(argv) {
  const args = {
    skillRoot: DEFAULT_ROOT,
    version: null,
    dryRun: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const current = argv[i];
    if (current === '--skill-root' && argv[i + 1]) args.skillRoot = path.resolve(argv[++i]);
    else if (current === '--version' && argv[i + 1]) args.version = argv[++i];
    else if (current === '--dry-run') args.dryRun = true;
    else if (current === '--help' || current === '-h') args.help = true;
  }

  return args;
}

function printHelp() {
  console.log(`version-bump.mjs — 核心版本源统一替换

用法：
  node scripts/version-bump.mjs --version <x.y.z> [--skill-root <dir>] [--dry-run]

说明：
  - 统一更新 package / SKILL / version.mjs / channel manifest / 打包脚本等核心版本源
  - 默认保留历史兼容入口（如 pack:v210 脚本别名）不做删除
`);
}

export function compactVersion(version) {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`非法版本号：${version}`);
  return `${Number(match[1])}${Number(match[2])}${Number(match[3])}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function updateTextFile(filePath, transform) {
  const source = fs.readFileSync(filePath, 'utf8');
  const output = transform(source);
  return { filePath, source, output, changed: source !== output };
}

function replaceRegex(source, regex, replacer, label) {
  if (!regex.test(source)) {
    throw new Error(`未命中可替换内容：${label}`);
  }
  return source.replace(regex, replacer);
}

export function planVersionBump(rootDir, nextVersion) {
  const root = path.resolve(rootDir);
  const currentPkg = readJson(path.join(root, 'package.json'));
  const currentVersion = currentPkg.version;
  const currentCompact = compactVersion(currentVersion);
  const nextCompact = compactVersion(nextVersion);
  const today = new Date().toISOString().slice(0, 10);

  const operations = [];

  operations.push({
    filePath: path.join(root, 'package.json'),
    apply() {
      const pkg = readJson(this.filePath);
      pkg.version = nextVersion;
      pkg.description = String(pkg.description || '').replace(`v${currentVersion}`, `v${nextVersion}`);
      pkg['scene-pack-version'] = nextVersion;
      return pkg;
    },
    type: 'json',
  });

  const packageLockPath = path.join(root, 'package-lock.json');
  if (fs.existsSync(packageLockPath)) {
    operations.push({
      filePath: packageLockPath,
      apply() {
        const lock = readJson(this.filePath);
        lock.version = nextVersion;
        if (lock.packages?.['']) {
          lock.packages[''].version = nextVersion;
        }
        return lock;
      },
      type: 'json',
    });
  }

  operations.push(
    {
      filePath: path.join(root, '_plugin_meta.json'),
      apply() {
        const meta = readJson(this.filePath);
        meta.version = nextVersion;
        return meta;
      },
      type: 'json',
    },
    {
      filePath: path.join(root, '_skillhub_meta.json'),
      apply() {
        const meta = readJson(this.filePath);
        meta.version = nextVersion;
        return meta;
      },
      type: 'json',
    },
    {
      filePath: path.join(root, 'scene-packs', 'registry.json'),
      apply() {
        const registry = readJson(this.filePath);
        registry._version = nextVersion;
        registry._updated = today;
        return registry;
      },
      type: 'json',
    },
    {
      filePath: path.join(root, 'references', '05-ops', 'search-policy.json'),
      apply() {
        const policy = readJson(this.filePath);
        policy.version = nextVersion;
        return policy;
      },
      type: 'json',
    },
    {
      filePath: path.join(root, 'references', '02-quality', 'quality-PLC.md'),
      type: 'text',
      apply() {
        return updateTextFile(this.filePath, (source) =>
          replaceRegex(source, /> \*\*版本\*\*：[^\r\n]+/, `> **版本**：${nextVersion}`, 'references/02-quality/quality-PLC.md version')
        );
      },
    },
    {
      filePath: path.join(root, 'references', '02-quality', 'quality-S.md'),
      type: 'text',
      apply() {
        return updateTextFile(this.filePath, (source) => {
          if (/> \*\*版本\*\*：/.test(source)) {
            return replaceRegex(source, /> \*\*版本\*\*：[^\r\n]+/, `> **版本**：${nextVersion}`, 'references/02-quality/quality-S.md version');
          }
          return replaceRegex(
            source,
            /(> \*\*关联延伸\*\*：[^\r\n]+\r?\n)/,
            `$1> **版本**：${nextVersion}\n`,
            'references/02-quality/quality-S.md version insert'
          );
        });
      },
    },
    {
      filePath: path.join(root, 'references', '02-quality', 'cross-chapter-consistency.md'),
      type: 'text',
      apply() {
        return updateTextFile(this.filePath, (source) =>
          replaceRegex(
            source,
            /> \*\*版本\*\*：[^\r\n]+/,
            `> **版本**：${nextVersion}（CX-4 强制升级 + 分类型章节写作前强制重叠检测门禁）`,
            'references/02-quality/cross-chapter-consistency.md version'
          )
        );
      },
    },
    {
      filePath: path.join(root, 'workbuddy', 'channel-manifest.json'),

      apply() {
        const manifest = readJson(this.filePath);
        manifest.skill.version = nextVersion;
        if (manifest.distribution?.primaryPackage) {
          manifest.distribution.primaryPackage = `dist/fbs-bookwriter-v${nextCompact}-workbuddy.zip`;
        }
        if (manifest.distribution?.reviewNote) {
          manifest.distribution.reviewNote = `releases/workbuddy-review-v${nextVersion}.md`;
        }
        if (manifest.distribution?.companionPackage) {
          manifest.distribution.companionPackage = `dist/fbs-bookwriter-v${nextCompact}-codebuddy.zip`;
        }
        return manifest;
      },
      type: 'json',
    },
    {
      filePath: path.join(root, 'codebuddy', 'channel-manifest.json'),
      apply() {
        const manifest = readJson(this.filePath);
        manifest.skill.version = nextVersion;
        if (manifest.distribution?.primaryPackage) {
          manifest.distribution.primaryPackage = `dist/fbs-bookwriter-v${nextCompact}-codebuddy.zip`;
        }
        if (manifest.distribution?.reviewNote) {
          manifest.distribution.reviewNote = `releases/codebuddy-review-v${nextVersion}.md`;
        }
        return manifest;
      },
      type: 'json',
    }
  );

  operations.push(
    {
      filePath: path.join(root, 'scripts', 'version.mjs'),
      type: 'text',
      apply() {
        return updateTextFile(this.filePath, (source) => {
          let output = replaceRegex(source, /export const VERSION = '[^']+';/, `export const VERSION = '${nextVersion}';`, 'scripts/version.mjs VERSION');
          output = replaceRegex(output, /full: '[^']+',/, `full: '${nextVersion}',`, 'scripts/version.mjs full');
          // 发布日可能与当前日期相同，允许无变化
          output = output.replace(/date: '[^']+',/, `date: '${today}',`);
          return output;
        });
      },
    },
    {
      filePath: path.join(root, 'SKILL.md'),
      type: 'text',
      apply() {
        return updateTextFile(this.filePath, (source) => {
          let output = replaceRegex(source, /^version:\s*[^\r\n]+/m, `version: ${nextVersion}`, 'SKILL.md frontmatter version');
          output = replaceRegex(output, /^plugin-id:\s*[^\r\n]+/m, `plugin-id: fbs-bookwriter-v${nextCompact}`, 'SKILL.md plugin-id');
          output = replaceRegex(output, /(> \*\*版本\*\*：)([^\s]+)/, `$1${nextVersion}`, 'SKILL.md visible version');
          return output;
        });
      },
    },
    {
      filePath: path.join(root, 'scripts', 'pack-workbuddy-marketplace.mjs'),
      type: 'text',
      apply() {
        return updateTextFile(this.filePath, (source) => {
          let output = replaceRegex(source, /version: '[^']+'/, `version: '${nextVersion}'`, 'pack-workbuddy version');
          output = replaceRegex(output, /packageName: 'fbs-bookwriter-v\d+-workbuddy'/, `packageName: 'fbs-bookwriter-v${nextCompact}-workbuddy'`, 'pack-workbuddy packageName');
          output = replaceRegex(output, /releases\/workbuddy-review-v[^']+\.md/, `releases/workbuddy-review-v${nextVersion}.md`, 'pack-workbuddy review file');
          return output;
        });
      },
    },
    {
      filePath: path.join(root, 'scripts', 'pack-codebuddy-plugin.mjs'),
      type: 'text',
      apply() {
        return updateTextFile(this.filePath, (source) => {
          let output = replaceRegex(source, /version: '[^']+'/, `version: '${nextVersion}'`, 'pack-codebuddy version');
          output = replaceRegex(output, /packageName: 'fbs-bookwriter-v\d+-codebuddy'/, `packageName: 'fbs-bookwriter-v${nextCompact}-codebuddy'`, 'pack-codebuddy packageName');
          output = replaceRegex(output, /releases\/codebuddy-review-v[^']+\.md/, `releases/codebuddy-review-v${nextVersion}.md`, 'pack-codebuddy review file');
          return output;
        });
      },
    },
    {
      filePath: path.join(root, 'scripts', 'pack-openclaw-skill.mjs'),
      type: 'text',
      apply() {
        return updateTextFile(this.filePath, (source) => {
          let output = replaceRegex(source, /version:\s*'[^']+'/, `version: '${nextVersion}'`, 'pack-openclaw version');
          output = replaceRegex(output, /packageName:\s*'fbs-bookwriter-v\d+-openclaw'/, `packageName: 'fbs-bookwriter-v${nextCompact}-openclaw'`, 'pack-openclaw packageName');
          return output;
        });
      },
    }
  );

  return {
    root,
    currentVersion,
    nextVersion,
    currentCompact,
    nextCompact,
    operations,
  };
}

export function executeVersionBump(plan, { dryRun = false } = {}) {
  const changes = [];

  for (const operation of plan.operations) {
    if (!fs.existsSync(operation.filePath)) continue;

    if (operation.type === 'json') {
      const before = fs.readFileSync(operation.filePath, 'utf8');
      const payload = operation.apply();
      const after = `${JSON.stringify(payload, null, 2)}\n`;
      const changed = before !== after;
      if (changed && !dryRun) writeJson(operation.filePath, payload);
      changes.push({ file: path.relative(plan.root, operation.filePath).replace(/\\/g, '/'), changed });
      continue;
    }

    const textResult = operation.apply();
    if (textResult.changed && !dryRun) {
      fs.writeFileSync(operation.filePath, textResult.output, 'utf8');
    }
    changes.push({ file: path.relative(plan.root, operation.filePath).replace(/\\/g, '/'), changed: textResult.changed });
  }

  return {
    currentVersion: plan.currentVersion,
    nextVersion: plan.nextVersion,
    currentCompact: plan.currentCompact,
    nextCompact: plan.nextCompact,
    dryRun,
    changedFiles: changes.filter((item) => item.changed).map((item) => item.file),
    scannedFiles: changes.map((item) => item.file),
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.version) {
    printHelp();
    process.exit(args.help ? 0 : 2);
  }

  const plan = planVersionBump(args.skillRoot, args.version);
  const result = executeVersionBump(plan, { dryRun: args.dryRun });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {

  try {
    main();
  } catch (error) {
    console.error(`version-bump 失败: ${error.message}`);
    process.exit(1);
  }
}
