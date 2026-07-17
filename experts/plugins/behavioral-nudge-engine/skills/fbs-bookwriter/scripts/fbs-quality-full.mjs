#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { runPolishGate } from './polish-gate.mjs';

function parseArgs(argv) {
  const out = {
    bookRoot: null,
    jsonOut: null,
    enforce: false,
    quiet: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book-root') out.bookRoot = path.resolve(argv[++i] || '');
    else if (a === '--json-out') out.jsonOut = path.resolve(argv[++i] || '');
    else if (a === '--enforce') out.enforce = true;
    else if (a === '--quiet') out.quiet = true;
  }
  return out;
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function buildConclusion(finalRun, deliverablesRun) {
  const finalExecError = !finalRun?.completed;
  const delExecError = !deliverablesRun?.completed;
  if (finalExecError || delExecError) {
    return {
      overallStatus: 'warn',
      comparabilityNote: '质检未完全完成，先修复执行问题后再比较分数。',
      nextBestAction: '先处理执行失败的质检任务，再重跑全量结论。',
    };
  }

  const finalBelow = Number(finalRun?.quality?.belowThreshold) || 0;
  const delBelow = Number(deliverablesRun?.quality?.belowThreshold) || 0;
  if (finalBelow > 0) {
    return {
      overallStatus: 'fail',
      comparabilityNote: '终稿与单章文本范围不同，分数不可直接横比；终稿结论优先。',
      nextBestAction: `终稿存在 ${finalBelow} 项未达标，优先精修终稿，再回看单章。`,
    };
  }
  if (delBelow > 0) {
    return {
      overallStatus: 'warn',
      comparabilityNote: '终稿与单章文本范围不同，分数不可直接横比；当前终稿优先级更高。',
      nextBestAction: `终稿已达标，建议补修 ${delBelow} 个未达标单章以提升整体稳定性。`,
    };
  }
  return {
    overallStatus: 'pass',
    comparabilityNote: '终稿与单章范围不同，当前两者均达标，可进入发布验收。',
    nextBestAction: '可进入发布前核对与最终交付流程。',
  };
}

export function runFbsQualityFull({ bookRoot, jsonOut = null, enforce = false } = {}) {
  if (!bookRoot) {
    return { code: 2, message: 'missing --book-root' };
  }
  const resolvedBookRoot = path.resolve(bookRoot);
  if (!fs.existsSync(resolvedBookRoot)) {
    return { code: 2, message: `book-root not exists: ${resolvedBookRoot}` };
  }
  const fbsDir = path.join(resolvedBookRoot, '.fbs');
  const outPath = path.resolve(jsonOut || path.join(fbsDir, 'quality-full-last.json'));
  const finalJsonOut = path.join(fbsDir, 'polish-final-last.json');
  const deliverablesJsonOut = path.join(fbsDir, 'polish-deliverables-last.json');

  const finalRun = runPolishGate({
    bookRoot: resolvedBookRoot,
    target: 'final-manuscript',
    sourceBackup: false,
    withQualityAudit: true,
    jsonOut: finalJsonOut,
  });
  const deliverablesRun = runPolishGate({
    bookRoot: resolvedBookRoot,
    target: 'deliverables',
    sourceBackup: false,
    withQualityAudit: true,
    jsonOut: deliverablesJsonOut,
  });

  const conclusion = buildConclusion(finalRun, deliverablesRun);
  const payload = {
    generatedAt: new Date().toISOString(),
    bookRoot: resolvedBookRoot,
    bookQualityConclusion: {
      overallStatus: conclusion.overallStatus,
      finalManuscript: {
        completed: !!finalRun?.completed,
        summary: finalRun?.quality || null,
        reportPath: finalRun?.qualityJsonOut || null,
        targetFile: finalRun?.plan?.files?.[0] || null,
      },
      deliverables: {
        completed: !!deliverablesRun?.completed,
        summary: deliverablesRun?.quality || null,
        reportPath: deliverablesRun?.qualityJsonOut || null,
        targetGlob: deliverablesRun?.plan?.glob || null,
      },
      comparabilityNote: conclusion.comparabilityNote,
      nextBestAction: conclusion.nextBestAction,
    },
    actions: {
      rerunFinal: `node scripts/polish-gate.mjs --book-root "${resolvedBookRoot}" --target final-manuscript --no-source-backup --json-out "${finalJsonOut}"`,
      rerunDeliverables: `node scripts/polish-gate.mjs --book-root "${resolvedBookRoot}" --target deliverables --no-source-backup --json-out "${deliverablesJsonOut}"`,
    },
  };

  writeJson(outPath, payload);
  const shouldFail = enforce && payload.bookQualityConclusion.overallStatus === 'fail';
  return {
    code: shouldFail ? 1 : 0,
    message: shouldFail ? 'quality full enforce failed' : 'quality full completed',
    reportPath: outPath,
    ...payload,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const result = runFbsQualityFull(args);
  if (!args.quiet) {
    if (result.reportPath) {
      console.log(`[fbs-quality-full] report -> ${result.reportPath}`);
    }
    if (result.bookQualityConclusion) {
      const c = result.bookQualityConclusion;
      console.log(`[fbs-quality-full] overall=${c.overallStatus}`);
      console.log(`[fbs-quality-full] next=${c.nextBestAction}`);
    } else {
      console.log(`[fbs-quality-full] ${result.message}`);
    }
  }
  process.exit(result.code);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith('fbs-quality-full.mjs')) {
  main();
}

