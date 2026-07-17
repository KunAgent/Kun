#!/usr/bin/env node
/**
 * fbs-cli-bridge.mjs — Skill 统一 CLI 入口（非 MCP）
 *
 * 将检索前置合同、企微场景包工具、乐包查询、生命周期脚本汇总为单一入口，
 * 便于主 Agent / 宿主文档引用与用户排查。
 *
 * 用法：
 *   node scripts/fbs-cli-bridge.mjs help
 *   node scripts/fbs-cli-bridge.mjs preflight -- <args...>   → record-search-preflight.mjs
 *   node scripts/fbs-cli-bridge.mjs scene-pack -- <args...> → scene-pack-admin.mjs
 *   node scripts/fbs-cli-bridge.mjs credits balance [--json]
 *   node scripts/fbs-cli-bridge.mjs credits hint [--json]
 *   node scripts/fbs-cli-bridge.mjs intake -- <args...>     → intake-router.mjs
 *   node scripts/fbs-cli-bridge.mjs exit -- <args...>       → session-exit.mjs
 *   node scripts/fbs-cli-bridge.mjs host -- <args...>       → host-capability-detect.mjs
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, '..');

function runNode(scriptRel, args, inherit = true) {
  const script = path.join(SKILL_ROOT, scriptRel);
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
  });
  return r.status ?? 1;
}

function splitPassthrough(argv) {
  const idx = argv.indexOf('--');
  if (idx === -1) return { forward: argv, extra: [] };
  return { forward: argv.slice(0, idx), extra: argv.slice(idx + 1) };
}

function extractNamedArg(argv, name) {
  const i = argv.indexOf(name);
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  return null;
}

async function cmdCredits(sub, argv) {
  const wantJson = argv.includes('--json');
  const { getBalance, formatBalanceSummary, getUpgradeHint } = await import('./wecom/lib/credits-ledger.mjs');

  if (sub === 'balance') {
    if (wantJson) {
      const summary = formatBalanceSummary();
      console.log(
        JSON.stringify(
          {
            balance: getBalance(),
            markdownSummary: summary,
          },
          null,
          2,
        ),
      );
      return 0;
    }
    console.log(formatBalanceSummary());
    return 0;
  }

  if (sub === 'hint') {
    const h = getUpgradeHint();
    if (wantJson) {
      console.log(JSON.stringify(h, null, 2));
      return 0;
    }
    console.log(h.hint || '（当前无需升级提醒）');
    return 0;
  }

  console.error('未知子命令：credits ' + (sub || ''));
  console.error('可用：balance | hint');
  return 2;
}

function printHelp() {
  console.log(`fbs-cli-bridge — 福帮手 Skill 统一 CLI（脚本联动，非 MCP）

用法：
  node scripts/fbs-cli-bridge.mjs <子命令> [选项]

── 入口与生命周期 ──
  intake -- <参数>        → intake-router（默认快速开场；需完整场景包时加 --full）
  exit -- <参数>          → session-exit（安全退出并落盘恢复摘要）
  host -- <参数>          → host-capability-detect（宿主能力快照）

── 检索与合同 ──
  preflight -- <参数>     → record-search-preflight（检索前置合同）

── 企微与乐包 ──
  scene-pack -- <参数>    → scene-pack-admin（企微表只读/校验/状态等）
  credits balance [--json]   本地乐包余额与门槛表
  credits hint [--json]      升级提示（与 CHECK_BALANCE / UPGRADE_HINT 对齐）

  help                    本帮助

体验说明：references/05-ops/ux-agent-playbook.md · references/01-core/ux-optimization-rules.md
完整矩阵：references/01-core/skill-cli-bridge-matrix.md

示例：
  node scripts/fbs-cli-bridge.mjs credits balance --json
  node scripts/fbs-cli-bridge.mjs intake -- --book-root <书稿根> --intent auto --json --fast
  node scripts/fbs-cli-bridge.mjs scene-pack -- check
  node scripts/fbs-cli-bridge.mjs preflight -- --print-contract --skill-root .
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0] || 'help';

  if (sub === 'help' || sub === '--help' || sub === '-h') {
    printHelp();
    return 0;
  }

  if (sub === 'preflight') {
    const { extra } = splitPassthrough(argv.slice(1));
    return runNode('scripts/record-search-preflight.mjs', extra);
  }

  if (sub === 'scene-pack') {
    const { extra } = splitPassthrough(argv.slice(1));
    return runNode('scripts/wecom/scene-pack-admin.mjs', extra);
  }

  if (sub === 'credits') {
    const sub2 = argv[1];
    const rest = argv.slice(2);
    if (!sub2) {
      console.error('请指定：credits balance | credits hint');
      return 2;
    }
    return cmdCredits(sub2, rest);
  }

  if (sub === 'intake') {
    const { extra } = splitPassthrough(argv.slice(1));
    return runNode('scripts/intake-router.mjs', extra);
  }

  if (sub === 'exit') {
    const { extra } = splitPassthrough(argv.slice(1));
    const br = extractNamedArg(extra, '--book-root') || extractNamedArg(extra, '--cwd');
    if (!br || !String(br).trim()) {
      console.error('exit 子命令必须提供 --book-root <书稿根目录>（推荐绝对路径）');
      console.error('示例：node scripts/fbs-cli-bridge.mjs exit -- --book-root "D:\\\\my-book" --json');
      return 2;
    }
    return runNode('scripts/session-exit.mjs', extra);
  }

  if (sub === 'host') {
    const { extra } = splitPassthrough(argv.slice(1));
    return runNode('scripts/host-capability-detect.mjs', extra);
  }

  console.error(`未知子命令：${sub}（使用 help 查看列表）`);
  return 2;
}

main()
  .then((code) => process.exit(typeof code === 'number' ? code : 0))
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
