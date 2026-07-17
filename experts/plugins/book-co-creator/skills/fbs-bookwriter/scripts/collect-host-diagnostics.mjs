#!/usr/bin/env node
/**
 * 收集宿主与福帮手诊断信息（策略 A：排障包，不含书稿正文）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveWorkBuddyPaths, readBinaryToolchainRegistry } from './lib/workbuddy-host-runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');

function redact(p) {
  if (!p || typeof p !== 'string') return p;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (home && p.startsWith(home)) return `~${p.slice(home.length)}`;
  return p;
}

function parseArgs(argv) {
  const args = { bookRoot: null, json: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--book-root' && argv[i + 1]) args.bookRoot = argv[++i];
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
collect-host-diagnostics.mjs — 宿主 / 技能环境诊断（脱敏路径）

用法：
  node scripts/collect-host-diagnostics.mjs --book-root <书稿根> [--json]

输出：JSON 或易读文本；不含用户书稿内容。
`);
}

function safeReadJson(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const bookRoot = args.bookRoot ? path.resolve(args.bookRoot) : process.cwd();
  const fbsDir = path.join(bookRoot, '.fbs');
  const hostCapPath = path.join(fbsDir, 'host-capability.json');
  const wb = resolveWorkBuddyPaths();

  const settings = safeReadJson(wb.settingsPath);
  const hostCap = safeReadJson(hostCapPath);
  const binaryToolchain = readBinaryToolchainRegistry(wb.homeDir);

  const out = {
    schema: 'fbs-host-diagnostics-v1',
    collectedAt: new Date().toISOString(),
    bookRoot: redact(bookRoot),
    fbs: {
      exists: fs.existsSync(fbsDir),
      hostCapabilityPath: redact(hostCapPath),
      hostCapabilityDetectedAt: hostCap?.detectedAt || null,
    },
    workbuddy: {
      homeDir: redact(wb.homeDir),
      settingsPath: redact(wb.settingsPath),
      enabledPlugins: settings?.enabledPlugins
        ? Object.entries(settings.enabledPlugins)
            .filter(([, v]) => v === true)
            .map(([k]) => k.split('@')[0])
        : [],
    },
    binaryToolchain,
    routingMode: hostCap?.routingMode || null,
    hostType: hostCap?.hostType || null,
    note: '若 host-capability.json 缺失，请先运行 node scripts/host-capability-detect.mjs --book-root <书稿根> --force',
  };

  if (args.json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log('═════════════════════════════════════');
    console.log(' FBS 宿主诊断（脱敏路径）');
    console.log('═════════════════════════════════════\n');
    console.log(JSON.stringify(out, null, 2));
  }
}

main();
