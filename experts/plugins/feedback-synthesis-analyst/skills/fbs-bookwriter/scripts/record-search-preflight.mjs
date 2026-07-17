#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { appendTraceEvent } from './lib/fbs-trace-logger.mjs';
import {
  appendLedgerEntry,
  createSearchPreflightEntry,
  loadEntryContractPolicy,
  normalizeStage,
} from './lib/entry-contract-runtime.mjs';

/** 快速网络探测：尝试 DNS 解析，超时则视为离线 */
async function detectOnlineStatus(timeoutMs = 2000) {
  try {
    const { default: dns } = await import('dns/promises');
    await Promise.race([
      dns.lookup('www.baidu.com'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}



function parseArgs(argv) {
  const options = {
    skillRoot: process.cwd(),
    bookRoot: null,
    stage: '',
    chapterId: 'global',
    whyNow: '',
    searchScope: '',
    nextStepAfterSearch: '',
    offlineFallback: '',
    message: '',
    source: 'runtime',
    json: false,
    printContract: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skill-root') options.skillRoot = argv[++i] || options.skillRoot;
    else if (arg === '--book-root') options.bookRoot = argv[++i] || options.bookRoot;
    else if (arg === '--stage') options.stage = argv[++i] || options.stage;
    else if (arg === '--chapter-id') options.chapterId = argv[++i] || options.chapterId;
    else if (arg === '--why') options.whyNow = argv[++i] || options.whyNow;
    else if (arg === '--scope') options.searchScope = argv[++i] || options.searchScope;
    else if (arg === '--next-step') options.nextStepAfterSearch = argv[++i] || options.nextStepAfterSearch;
    else if (arg === '--offline-fallback') options.offlineFallback = argv[++i] || options.offlineFallback;
    else if (arg === '--message') options.message = argv[++i] || options.message;
    else if (arg === '--source') options.source = argv[++i] || options.source;
    else if (arg === '--json') options.json = true;
    else if (arg === '--print-contract') options.printContract = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }

  return options;
}

function printHelp() {
  console.log(`搜索前置合同记录器

用法:
  node scripts/record-search-preflight.mjs --print-contract [--skill-root <根>]
  node scripts/record-search-preflight.mjs --skill-root <技能根> --book-root <本书根> --stage <S0|S1|S2|S3|S5|S6> --why "为什么查" --scope "查什么" --next-step "查完去哪一步" --offline-fallback "离线如何降级" [--chapter-id Ch01] [--message "展示给用户的话"] [--json]

示例:
  node scripts/record-search-preflight.mjs --skill-root . --book-root ./demo-book --stage S0 --why "确认主题和时间基准" --scope "同类内容、目标读者、时间基准" --next-step "S0 简报" --offline-fallback "标记为离线降级并改用现有素材"`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const skillRoot = path.resolve(args.skillRoot || process.cwd());
  if (args.printContract) {
    const contractPath = path.join(skillRoot, 'references/05-ops/search-preflight-contract.json');
    if (!fs.existsSync(contractPath)) {
      console.error(`未找到契约文件: ${contractPath}`);
      process.exit(2);
    }
    const text = fs.readFileSync(contractPath, 'utf8');
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
    process.exit(0);
  }

  if (!args.bookRoot || !args.stage) {
    console.error('用法错误：必须提供 --book-root 和 --stage');
    printHelp();
    process.exit(2);
  }

  const bookRoot = path.resolve(args.bookRoot);
  const policy = loadEntryContractPolicy(skillRoot);

  // 自动网络探测：离线时自动填充 offlineFallback 并在 message 头部插入【离线降级】
  const isOnline = await detectOnlineStatus();
  if (!isOnline) {
    if (!args.offlineFallback) {
      args.offlineFallback = '当前无法联网，已自动标记为离线降级；改用现有素材和模型知识继续';
    }
    if (!args.message.startsWith('【离线降级】')) {
      args.message = `【离线降级】${args.message}`.trim();
    }
    console.warn('[record-preflight] ⚠ 检测到离线状态，已自动标注「离线降级」');
  }

  const entry = createSearchPreflightEntry({
    stage: normalizeStage(args.stage),
    chapterId: args.chapterId,
    whyNow: args.whyNow,
    searchScope: args.searchScope,
    nextStepAfterSearch: args.nextStepAfterSearch,
    offlineFallback: args.offlineFallback,
    message: args.message,
    source: args.source,
  }, policy);

  const ledgerPath = appendLedgerEntry(bookRoot, entry);
  const output = {
    ok: true,
    ledgerPath,
    entry,
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`${isOnline ? '✅' : '⚠️ [离线降级]'} 已记录搜索前置合同`);
    console.log(`- stage: ${entry.stage}`);
    console.log(`- chapterId: ${entry.chapterId}`);
    console.log(`- ledger: ${ledgerPath}`);
    console.log(`- message: ${entry.message}`);
  }

  appendTraceEvent({
    bookRoot,
    skillRoot,
    script: 'record-search-preflight.mjs',
    event: 'search_preflight',
    exitCode: 0,
    payloadSummary: { stage: entry.stage, chapterId: entry.chapterId, online: isOnline },
  });
}

main().catch((err) => {
  console.error('[record-preflight] 错误:', err.message);
  process.exit(1);
});
