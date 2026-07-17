/**
 * host-capability-detect.mjs — WorkBuddy 宿主能力检测器
 * FBS-BookWriter v2.1.2
 *
 * 功能：
 * - 统一探测 WorkBuddy 宿主目录、本地技能市场、已启用插件
 * - 读取 Node.js 与 Git 运行时信息
 * - 输出 .fbs/host-capability.json（缓存 60 分钟）
 *
 * 输出 routingMode：
 *   hybrid       — WorkBuddy 宿主能力 + 脚本双轨可用
 *   script-only  — 仅脚本能力可用
 *   dialog-only  — 全部降级为对话模式
 */

import path from 'path';
import { fileURLToPath } from 'url';
import {
  createWorkBuddyHostSnapshot,
  readCachedHostSnapshot,
  writeHostSnapshot,
} from './lib/workbuddy-host-runtime.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


function parseArgs(argv) {
  const args = {
    force: false,
    json: false,
    bookRoot: null,
    skillRoot: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const current = argv[i];
    if (current === '--force') args.force = true;
    else if (current === '--json') args.json = true;
    else if ((current === '--book-root' || current === '--cwd') && argv[i + 1]) args.bookRoot = argv[++i];
    else if (current === '--skill-root' && argv[i + 1]) args.skillRoot = argv[++i];
  }

  return args;
}

/**
 * 主检测函数
 * @param {object} options
 * @param {string} [options.bookRoot]
 * @param {string} [options.cwd]       兼容旧参数名，等价于 bookRoot
 * @param {string} [options.skillRoot]
 * @param {string} [options.fbsDir]
 * @param {boolean} [options.force]
 * @returns {object}
 */
export async function detectHostCapability({ bookRoot, cwd, skillRoot, fbsDir, force = false } = {}) {
  const resolvedBookRoot = path.resolve(bookRoot || cwd || process.cwd());
  const resolvedSkillRoot = path.resolve(skillRoot || path.resolve(__dirname, '..'));
  const resolvedFbsDir = fbsDir || path.join(resolvedBookRoot, '.fbs');

  const outPath = path.join(resolvedFbsDir, 'host-capability.json');

  if (!force) {
    const cached = readCachedHostSnapshot(outPath);
    if (cached) return cached;
  }

  const snapshot = createWorkBuddyHostSnapshot({
    bookRoot: resolvedBookRoot,
    skillRoot: resolvedSkillRoot,
  });

  writeHostSnapshot(outPath, snapshot);
  return snapshot;
}

if (process.argv[1] && process.argv[1].endsWith('host-capability-detect.mjs')) {
  const args = parseArgs(process.argv);

  detectHostCapability({
    bookRoot: args.bookRoot,
    skillRoot: args.skillRoot,
    force: args.force,
  }).then((capability) => {
    process.stdout.write(`${JSON.stringify(capability, null, 2)}\n`);
  }).catch((error) => {
    console.error('host-capability-detect 失败:', error.message);
    process.exit(1);
  });
}
