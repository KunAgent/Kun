#!/usr/bin/env node
/**
 * session-exit.mjs — FBS 会话退出处理器
 *
 * 目标：
 * - 在用户说“退出/停止/取消/退出福帮手”时，默认先保存当前工作状态
 * - 统一写入 .fbs/workbuddy-resume.json 与 .fbs/smart-memory/session-resume-brief.md
 * - 为下次输入“福帮手”提供可恢复入口
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSessionSnapshot } from './workbuddy-session-snapshot.mjs';
import { applyBookMemoryTemplate } from './apply-book-memory-template.mjs';
import { appendWorkbuddyMemoryMirror } from './lib/workbuddy-workspace-memory.mjs';
import { registerBookProject } from './lib/fbs-book-projects-registry.mjs';
import { appendTraceEvent } from './lib/fbs-trace-logger.mjs';
import { upsertBookSnippetIndex } from './lib/fbs-book-snippet-index.mjs';

function collectRecentChangedFiles(rootDir, sinceMs, maxCount = 50) {
  const out = [];
  function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
        continue;
      }
      try {
        const stat = fs.statSync(abs);
        if (stat.mtimeMs >= sinceMs) out.push(abs);
      } catch {
        // ignore
      }
      if (out.length >= maxCount) return;
    }
  }
  walk(rootDir);
  return out.slice(0, maxCount);
}

function parseArgs(argv) {
  const args = {
    bookRoot: null,
    json: false,
    quiet: false,
    note: '',
    help: false,
    noWorkbuddyMirror: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if ((token === '--book-root' || token === '--cwd') && argv[i + 1]) args.bookRoot = argv[++i];
    else if (token === '--note' && argv[i + 1]) args.note = argv[++i];
    else if (token === '--json') args.json = true;
    else if (token === '--quiet') args.quiet = true;
    else if (token === '--no-workbuddy-mirror') args.noWorkbuddyMirror = true;
    else if (token === '--help' || token === '-h') args.help = true;
  }

  return args;
}

function buildExitNarrativeLine(snapshotSummary) {
  const stage = snapshotSummary?.currentStage || 'S0';
  const wc = Number(snapshotSummary?.wordCount) || 0;
  const cc = Number(snapshotSummary?.chapterCount) || 0;
  const done = Number(snapshotSummary?.completedCount) || 0;
  const title = snapshotSummary?.bookTitle && String(snapshotSummary.bookTitle).trim();
  const next = snapshotSummary?.nextSuggested && String(snapshotSummary.nextSuggested).trim();

  if (!title && wc < 1 && done < 1 && (!cc || cc < 1)) {
    return '本次尚未开始具体书稿；下次输入「福帮手」可重新说明要写什么或指定书稿文件夹。';
  }
  const titleQ = title ? `《${title}》` : '当前书稿';
  const nextPart = next ? `建议下次从「${next}」继续。` : '';
  return `${titleQ}当前位于 ${stage}，已完成约 ${done}/${cc || '?'} 章，累计约 ${wc} 字。${nextPart}`.replace(/\s+/g, ' ').trim();
}

function printHelp() {
  console.log(`
session-exit.mjs — FBS 会话退出处理器

用法：
  node scripts/session-exit.mjs --book-root <bookRoot> [--json] [--note <text>]

注意：
  --book-root 为必填（勿依赖默认工作目录）。宿主若在「书稿目录」下用相对路径执行
  node scripts/session-exit.mjs，会解析到「书稿根/scripts/…」导致找不到模块；
  应使用技能包内脚本的绝对路径，或：node scripts/fbs-cli-bridge.mjs exit -- --book-root <书稿根> --json

行为：
  1. 写入 .fbs/workbuddy-resume.json
  2. 写入 .fbs/smart-memory/session-resume-brief.md
  3. 返回“已记录当前状态，下次输入『福帮手』可继续”
  4. 默认向 书稿根/.workbuddy/memory/当日.md 追加简短镜像（叙事层，与 .fbs 真值并行）；加 --no-workbuddy-mirror 可关闭
`);
}

export async function handleSessionExit({ bookRoot, note = '', quiet = false, mirrorWorkbuddyMemory = true } = {}) {
  const startedAtMs = Date.now();
  if (bookRoot == null || String(bookRoot).trim() === '') {
    throw new Error('缺少 bookRoot：CLI 须传入 --book-root <书稿根目录>');
  }
  const resolvedBookRoot = path.resolve(String(bookRoot).trim());
  if (!fs.existsSync(resolvedBookRoot)) {
    throw new Error(
      `书稿根目录不存在：${resolvedBookRoot}。请确认 --book-root 指向已有目录（推荐绝对路径）；勿在书稿子目录下用错误的相对路径调用 session-exit。`,
    );
  }
  const fbsDir = path.join(resolvedBookRoot, '.fbs');
  fs.mkdirSync(fbsDir, { recursive: true });

  const snapshot = await generateSessionSnapshot({ fbsDir, quiet: true, includeGitChanges: true });
  const memoryResult = applyBookMemoryTemplate({
    bookRoot: resolvedBookRoot,
    quiet: true,
    includeHostProfileInBrief: true,
  });

  let workbuddyMirrorPath = null;
  if (mirrorWorkbuddyMemory && memoryResult.briefPath && fs.existsSync(memoryResult.briefPath)) {
    const briefHead = fs
      .readFileSync(memoryResult.briefPath, 'utf8')
      .split('\n')
      .slice(0, 14)
      .join('\n');
    const mirror = appendWorkbuddyMemoryMirror({
      bookRoot: resolvedBookRoot,
      title: 'FBS 退出摘要',
      lines: [
        `书稿根：${resolvedBookRoot}`,
        ...(note ? [`备注：${note}`] : []),
        'session-resume-brief 摘录：',
        briefHead,
      ],
      quiet,
    });
    workbuddyMirrorPath = mirror.path;
  }

  const snapshotSummary = {
    currentStage: snapshot.currentStage || 'S0',
    bookTitle: snapshot.bookTitle || null,
    nextSuggested: snapshot.nextSuggested || null,
    wordCount: snapshot.wordCount || 0,
    chapterCount: snapshot.chapterCount || 0,
    completedCount: snapshot.completedCount || 0,
  };
  const userSummary = buildExitNarrativeLine(snapshotSummary);
  const baseMsg = '已记录当前状态。下次输入「福帮手」可从上次位置继续。';
  let userMessage = userSummary ? `${baseMsg}\n${userSummary}` : baseMsg;
  const modN = Array.isArray(snapshot.modifiedFiles) ? snapshot.modifiedFiles.length : 0;
  if (modN > 0) {
    userMessage += `\n📌 本次可核对变更路径 ${modN} 条（已写入 .fbs/workbuddy-resume.json → modifiedFiles）。`;
  }

  registerBookProject({
    bookRoot: resolvedBookRoot,
    bookTitle: snapshot.bookTitle || null,
    currentStage: snapshot.currentStage || null,
  });
  upsertBookSnippetIndex(resolvedBookRoot);

  let changedFiles = Array.isArray(snapshot.modifiedFiles) ? [...snapshot.modifiedFiles] : [];
  if (!(snapshot.gitAvailable ?? false) && changedFiles.length === 0) {
    changedFiles = collectRecentChangedFiles(fbsDir, startedAtMs - 2000);
  }

  const sessionChangeSummary = {
    gitAvailable: snapshot.gitAvailable ?? false,
    changedFiles,
    hint: snapshot.gitWorkspaceHint || '',
    porcelainLines: snapshot.gitPorcelainLines || [],
  };
  snapshot.modifiedFiles = changedFiles;
  try {
    const resumePath = path.join(fbsDir, 'workbuddy-resume.json');
    const resume = fs.existsSync(resumePath) ? JSON.parse(fs.readFileSync(resumePath, 'utf8')) : {};
    resume.modifiedFiles = changedFiles;
    fs.writeFileSync(resumePath, JSON.stringify(resume, null, 2) + '\n', 'utf8');
  } catch {
    // ignore
  }

  const out = {
    saved: true,
    bookRoot: resolvedBookRoot,
    note: note || null,
    workbuddyMirrorPath,
    files: {
      resumeCard: path.join(fbsDir, 'workbuddy-resume.json'),
      memoryBrief: memoryResult.briefPath,
      memorySnapshot: memoryResult.snapshotPath,
    },
    snapshotSummary,
    userSummary,
    userMessage,
    /** WorkBuddy 复盘 2026-04-16：本次会话变更文件摘要（git 可用时） */
    sessionChangeSummary,
    /** 供宿主/Agent 展示：退出前软确认（2026-04-13 WorkBuddy 实测 P0-3） */
    agentGuidance: {
      beforeExit:
        '用户说「退出福帮手」时：须先完成一句确认（「还需要别的吗？」或「进度会保存，确定退出？」），**再**调用本脚本；禁止未确认直接 exit。执行后须向用户完整复述 userMessage（含第二行摘要）。',
      retroReportPolicy:
        '退出后默认不自动生成长复盘报告；仅在用户明确要求时再生成，并建议落盘到 .fbs/retro-reports/。',
    },
  };

  appendTraceEvent({
    bookRoot: resolvedBookRoot,
    skillRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    script: 'session-exit.mjs',
    event: 'session_exit',
    exitCode: 0,
    payloadSummary: {
      currentStage: snapshotSummary.currentStage,
      bookTitle: snapshotSummary.bookTitle,
      wordCount: snapshotSummary.wordCount,
    },
  });

  return out;
}

function exitMissingBookRoot(json) {
  const payload = {
    saved: false,
    error: 'session-exit: 必须指定 --book-root <书稿根目录>',
    hint:
      '若在书稿目录下使用相对路径执行 node scripts/session-exit.mjs，会解析到不存在的书稿根/scripts/。请使用技能包内 session-exit.mjs 的绝对路径，或：node scripts/fbs-cli-bridge.mjs exit -- --book-root <书稿根绝对路径> --json（工作目录为技能包根）。',
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.error(payload.error);
    console.error(payload.hint);
  }
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.bookRoot) {
    exitMissingBookRoot(args.json);
  }

  try {
    const result = await handleSessionExit({
      bookRoot: args.bookRoot,
      note: args.note,
      quiet: args.quiet || args.json,
      mirrorWorkbuddyMemory: !args.noWorkbuddyMirror,
    });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log('FBS 已安全退出并写入恢复摘要。');
    console.log(`- 恢复卡：${result.files.resumeCard}`);
    console.log(`- 会话摘要：${result.files.memoryBrief}`);
    console.log(`- 提示：${result.userMessage}`);
  } catch (error) {
    if (args.json) {
      console.log(
        JSON.stringify(
          {
            saved: false,
            error: error.message,
            hint: '可检查 --book-root 是否为书稿根目录（含 .fbs），以及磁盘权限。',
          },
          null,
          2,
        ),
      );
    } else {
      console.error(`session-exit 失败: ${error.message}`);
    }
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('session-exit.mjs')) {
  main();
}
