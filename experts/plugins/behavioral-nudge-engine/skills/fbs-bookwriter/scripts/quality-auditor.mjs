#!/usr/bin/env node
/**
 * 机器可检项质量审计器
 * - 裸仓库 standalone 模式
 * - 机器扫描（S2/S4/S5/S6/B0/C4/VCR）
 * - --auto-fix 生成候选修复文件与 diff
 * - --profile manuscript-full 开启全书稿机检全量 enforce（复盘 F-P0-3）
 */
import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';
import {
  ensureBareQualityWorkspace,
  normalizeRel,
  QUALITY_SCAN_IGNORE_GLOBS,
  resolveQualityReferenceFile,
  resolveScriptSkillRoot,
} from './lib/quality-runtime.mjs';
import { imperativeHitsForText, loadS2QualityMachineLexicon } from './lib/s2-quality-lexicon.mjs';

const SCRIPT_SKILL_ROOT = resolveScriptSkillRoot(import.meta.url);
const ABSOLUTE_PATTERNS = [
  /全球最[大小强弱]/,
  /行业第一/,
  /唯一[一支持提供]/,
  /完全无法/,
  /绝对[不无]/,
  /100%(?:保证|确保|正确)/,
];
const VCR_NUMBER_RE = /[\d,.]+\s*(?:%|万|亿|千万)/g;
const VCR_SOURCE_RE = /〔来源[：:]|【来源[：:]|（来源[：:]|\[来源[：:]/;
const SAFE_CONNECTORS = ['此外', '另外', '同时', '其次', '再者', '而且', '综上所述', '值得注意的是', '需要指出的是', '总的来说', '由此可见', '总而言之', '在此基础上'];
const BUZZWORD_REPLACEMENTS = new Map([
  ['赋能', '让……能做……'],
  ['抓手', '切入点'],
  ['底座', '基础'],
  ['底层能力', '基础能力'],
  ['链路', '流程'],
  ['全链路', '全流程'],
  ['沉淀', '积累'],
  ['闭环', '完整流程'],
  ['颗粒度', '细致程度'],
  ['打通', '连起来'],
  ['拉通', '连起来'],
  ['对齐', '统一'],
  ['拉齐', '统一'],
  ['心智', '认知'],
  ['势能', '优势'],
  ['卡位', '抢位'],
  ['卡点', '关键点'],
  ['组合拳', '组合策略'],
  ['矩阵', '组合'],
  ['生态', '协作体系'],
  ['中台', '中间平台'],
  ['协同', '配合'],
  ['联动', '一起动作'],
  ['融合', '结合'],
  ['整合', '合并'],
  ['维度', '方面'],
  ['视角', '角度'],
  ['层面', '方面'],
]);

function loadBuzzWords(skillRoot) {
  const lexiconPath = resolveQualityReferenceFile(skillRoot, 's5-buzzword-lexicon.json');
  const official = [];
  try {
    const json = JSON.parse(fs.readFileSync(lexiconPath, 'utf8'));
    if (Array.isArray(json?.terms)) official.push(...json.terms);
  } catch {
    // ignore
  }
  const builtin = ['深入探讨', '深入分析', '深度剖析', '全面解析', '系统梳理', '综合考量', '多维度', '不言而喻', '毋庸置疑', '值得注意的是', '不得不提', '尤为重要', '至关重要', '举足轻重', '首当其冲'];
  return Array.from(new Set([...official, ...builtin]));
}

function parseArgs(argv) {
  const o = {
    skillRoot: SCRIPT_SKILL_ROOT,
    bookRoot: process.cwd(),
    inputs: [],
    glob: null,
    globCwd: null,
    extraGlobInputs: [],
    profile: null,
    userSetGlob: false,
    manuscriptDoubleGlob: false,
    dashDensity: false,
    checkSectionIds: false,
    intPercentDensity: false,
    enforce: false,
    enforceStrict: false,
    failOnS6Warn: false,
    failOnS5Buzz: false,
    failOnLongSentenceWarn: false,
    failOnAbsoluteClaims: false,
    vcrHeuristicWarn: false,
    standalone: false,
    autoFix: false,
    write: false,
    json: false,
    jsonOut: null,
    enforceImperativeBook: false,
    warnImperative: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skill-root') o.skillRoot = argv[++i] || o.skillRoot;
    else if (a === '--book-root') o.bookRoot = argv[++i] || o.bookRoot;
    else if (a === '--inputs') o.inputs.push(argv[++i]);
    else if (a === '--input') o.inputs.push(argv[++i]);
    else if (a === '--glob') {
      o.glob = argv[++i];
      o.userSetGlob = true;
    } else if (a === '--profile') o.profile = argv[++i];
    else if (a === '--dash-density') o.dashDensity = true;
    else if (a === '--check-section-ids') o.checkSectionIds = true;
    else if (a === '--int-percent-density') o.intPercentDensity = true;
    else if (a === '--enforce') o.enforce = true;
    else if (a === '--enforce-strict') { o.enforce = true; o.enforceStrict = true; }
    else if (a === '--fail-on-s6-warn') o.failOnS6Warn = true;
    else if (a === '--fail-on-s5-buzz') o.failOnS5Buzz = true;
    else if (a === '--fail-on-long-sentence-warn') o.failOnLongSentenceWarn = true;
    else if (a === '--fail-on-absolute-claims') o.failOnAbsoluteClaims = true;
    else if (a === '--vcr-heuristic-warn') o.vcrHeuristicWarn = true;
    else if (a === '--standalone') o.standalone = true;
    else if (a === '--auto-fix') o.autoFix = true;
    else if (a === '--write') o.write = true;
    else if (a === '--json') o.json = true;
    else if (a === '--json-out') o.jsonOut = argv[++i] || null;
    else if (a === '--inputs-file') o.inputsFile = argv[++i] || null;
    else if (a === '--enforce-imperative-book') o.enforceImperativeBook = true;
    else if (a === '--warn-imperative') o.warnImperative = true;
  }
  o.skillRoot = path.resolve(o.skillRoot || SCRIPT_SKILL_ROOT);
  o.bookRoot = path.resolve(o.bookRoot || process.cwd());

  if (o.profile === 'manuscript' && !o.userSetGlob) {
    o.manuscriptDoubleGlob = true;
    o.warnImperative = true;
  }
  if (o.profile === 'skill-doc' && !o.userSetGlob) {
    o.glob = 'references/**/*.md';
    o.globCwd = o.skillRoot;
    o.extraGlobInputs = [path.join(o.skillRoot, 'SKILL.md')].filter((p) => fs.existsSync(p));
    o.warnImperative = false;
    o.enforceImperativeBook = false;
  }

  /** 全书稿机检「全量开关」：与 quality-check 机器项对齐，避免只跑子集（复盘 F-P0-3） */
  if (o.profile === 'manuscript-full') {
    o.manuscriptDoubleGlob = true;
    o.userSetGlob = false;
    o.warnImperative = true;
    o.enforce = true;
    o.enforceStrict = true;
    o.checkSectionIds = true;
    o.failOnS6Warn = true;
    o.failOnS5Buzz = true;
    o.failOnLongSentenceWarn = true;
    o.failOnAbsoluteClaims = true;
    o.vcrHeuristicWarn = true;
    o.enforceImperativeBook = true;
  }

  return o;
}

function collectFiles(args) {
  const files = new Set();
  args.inputs.forEach((input) => files.add(path.resolve(args.bookRoot, input)));
  if (args.inputsFile) {
    try {
      const raw = fs.readFileSync(path.resolve(args.inputsFile), 'utf8');
      raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((file) => files.add(path.resolve(file)));
    } catch {
      // ignore
    }
  }
  const globRoot = args.globCwd || args.bookRoot;
  if (args.manuscriptDoubleGlob) {
    for (const pattern of ['chapters/**/*.md', 'deliverables/**/*.md']) {
      globSync(pattern, { cwd: args.bookRoot, absolute: true, ignore: QUALITY_SCAN_IGNORE_GLOBS }).forEach((file) => files.add(file));
    }
  } else if (args.glob) {
    globSync(args.glob, { cwd: globRoot, absolute: true, ignore: QUALITY_SCAN_IGNORE_GLOBS }).forEach((file) => files.add(file));
  }
  for (const p of args.extraGlobInputs || []) {
    const abs = path.resolve(p);
    if (fs.existsSync(abs)) files.add(abs);
  }
  return [...files].filter((file) => fs.existsSync(file));
}


function textLen(text) {
  return Math.max(1, String(text || '').replace(/\s+/g, '').length);
}

function dashPerThousand(text) {
  return ((text.match(/——/g) || []).length * 1000) / textLen(text);
}

function intPercentPerThousand(text) {
  return ((text.match(/\d+%/g) || []).length * 1000) / textLen(text);
}

function longSentenceRatio(text) {
  const sentences = text.split(/[。！？\n]/).map((s) => s.replace(/\s+/g, '').length).filter((n) => n > 0);
  if (!sentences.length) return 0;
  return sentences.filter((n) => n > 40).length / sentences.length;
}

function findDupSectionIds(text) {
  const ids = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^#{2,3}\s+((\d+\.\d+(?:\.\d+)?))/);
    if (m) ids.push(m[1]);
  }
  const seen = new Set();
  const dup = new Set();
  ids.forEach((id) => (seen.has(id) ? dup.add(id) : seen.add(id)));
  return [...dup];
}

function findAbsoluteClaims(text) {
  return ABSOLUTE_PATTERNS.filter((re) => re.test(text)).map((re) => re.toString());
}

function vcrHeuristicCheck(text) {
  const lines = text.split(/\r?\n/);
  const issues = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (VCR_NUMBER_RE.test(line) && !VCR_SOURCE_RE.test(line)) {
      VCR_NUMBER_RE.lastIndex = 0;
      issues.push(`第${i + 1}行：含数字/比例但无来源标注`);
    }
    VCR_NUMBER_RE.lastIndex = 0;
  }
  return issues.slice(0, 5);
}

function scanMachineMetrics(text, skillRoot) {
  const lex = loadS2QualityMachineLexicon(skillRoot);
  const safeAdverbs = lex.safeAdverbs || [];
  const protectedPhrases = lex.protectedPhrases || [];
  const buzzWords = loadBuzzWords(skillRoot);
  const connectors = SAFE_CONNECTORS.reduce((acc, word) => {
    const count = (text.match(new RegExp(word, 'g')) || []).length;
    if (count) acc[word] = count;
    return acc;
  }, {});
  const adverbs = safeAdverbs.reduce((acc, word) => {
    let cleaned = text;
    for (const phrase of protectedPhrases) {
      if (phrase.includes(word)) cleaned = cleaned.replace(new RegExp(phrase, 'g'), '');
    }
    const count = (cleaned.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (count) acc[word] = count;
    return acc;
  }, {});
  const imperative = imperativeHitsForText(text, lex);
  const imperativeTotal = Object.values(imperative).reduce((a, b) => a + b, 0);
  const buzz = buzzWords.filter((word) => text.includes(word));
  return {
    chars: textLen(text),
    dashDensity: Number(dashPerThousand(text).toFixed(2)),
    intPercentDensity: Number(intPercentPerThousand(text).toFixed(2)),
    longSentenceRatio: Number((longSentenceRatio(text) * 100).toFixed(2)),
    duplicateSectionIds: findDupSectionIds(text),
    absoluteClaims: findAbsoluteClaims(text),
    vcrIssues: vcrHeuristicCheck(text),
    connectors,
    connectorDensity: Number((Object.values(connectors).reduce((a, b) => a + b, 0) * 1000 / textLen(text)).toFixed(2)),
    adverbs,
    adverbDensity: Number((Object.values(adverbs).reduce((a, b) => a + b, 0) * 1000 / textLen(text)).toFixed(2)),
    imperative,
    imperativeTotal,
    buzz,
  };
}

function chooseDashReplacement(before, after) {
  const tail = before.trim().slice(-8);
  const head = after.trim().slice(0, 8);
  if (/(答案|结论|原因|关键|选择|方法|下一步)$/.test(tail)) return '：';
  if (/^(这|那|它|他|她|此|这是|这意味着|原因是|答案是)/.test(head)) return '。';
  return '，';
}

function normalizeLinePunctuation(line) {
  return line
    .replace(/，{2,}/g, '，')
    .replace(/。{2,}/g, '。')
    .replace(/：：+/g, '：')
    .replace(/，。/g, '。')
    .replace(/。。/g, '。')
    .replace(/^，/g, '')
    .replace(/^：/g, '');
}

function applyConservativeAutoFix(text, skillRoot) {
  const lex = loadS2QualityMachineLexicon(skillRoot);
  const protectedPhrases = lex.protectedPhrases || [];
  const safeAdverbs = lex.safeAdverbs || [];
  const impKeys = Object.keys(lex.imperativeAutoFixMap || {}).sort((a, b) => b.length - a.length);

  const lines = text.split(/\r?\n/);
  const changes = [];
  let inFence = false;
  const nextLines = lines.map((line, index) => {
    const original = line;
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    let current = line;

    current = current.replace(new RegExp(`(^|[。！？；\s])(?:${SAFE_CONNECTORS.join('|')})([，、：:]?)`, 'g'), (match, lead) => lead || '');
    const imperativeNoAutoReplace = new Set(['必须', '务必', '一定']);
    for (const k of impKeys) {
      if (imperativeNoAutoReplace.has(k)) continue;
      const to = lex.imperativeAutoFixMap[k];
      if (!to) continue;
      current = current.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), to);
    }
    for (const word of safeAdverbs) {
      if (protectedPhrases.some((phrase) => phrase.includes(word) && current.includes(phrase))) continue;
      const rep = lex.safeAdverbAutoFixMap && Object.prototype.hasOwnProperty.call(lex.safeAdverbAutoFixMap, word)
        ? lex.safeAdverbAutoFixMap[word]
        : null;
      if (rep === null || rep === undefined) continue;
      current = current.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), rep);
    }
    for (const [from, to] of BUZZWORD_REPLACEMENTS.entries()) {
      current = current.replace(new RegExp(from, 'g'), to);
    }
    if (current.includes('——')) {
      current = current.replace(/——+/g, (dash, offset, whole) => {
        const before = whole.slice(0, offset);
        const after = whole.slice(offset + dash.length);
        return chooseDashReplacement(before, after);
      });
    }
    current = normalizeLinePunctuation(current);
    if (current !== original) {
      changes.push({ line: index + 1, before: original, after: current });
    }
    return current;
  });

  return { text: nextLines.join('\n'), changes };
}

function buildIssueBuckets(metrics, args, fileName) {
  const issues = [];
  const warnings = [];

  if (metrics.dashDensity > 3) {
    (args.enforce || args.enforceStrict ? issues : warnings).push(`[破折号] ${fileName}: ${metrics.dashDensity}/千字 > 3（阻断阈值）`);
  } else if (metrics.dashDensity > 1) {
    (args.failOnS6Warn || args.enforceStrict ? issues : warnings).push(`[破折号] ${fileName}: ${metrics.dashDensity}/千字 > 1（警告阈值）`);
  }

  if ((args.checkSectionIds || args.enforce || args.enforceStrict) && metrics.duplicateSectionIds.length) {
    (args.enforce || args.enforceStrict ? issues : warnings).push(`[编号重复] ${fileName}: ${metrics.duplicateSectionIds.join(', ')}`);
  }

  if (args.intPercentDensity && metrics.intPercentDensity > 10) {
    warnings.push(`[百分比密度] ${fileName}: ${metrics.intPercentDensity}/千字 偏高`);
  }

  if ((args.failOnS5Buzz || args.enforce || args.enforceStrict) && metrics.buzz.length) {
    (args.failOnS5Buzz || args.enforceStrict ? issues : warnings).push(`[AI味词汇] ${fileName}: ${metrics.buzz.slice(0, 5).join('、')}${metrics.buzz.length > 5 ? '…' : ''}`);
  }

  if ((args.failOnLongSentenceWarn || args.enforce || args.enforceStrict) && metrics.longSentenceRatio > 8) {
    (args.failOnLongSentenceWarn || args.enforceStrict ? issues : warnings).push(`[长句] ${fileName}: 长句比例${metrics.longSentenceRatio}% > 8%`);
  }

  if ((args.failOnAbsoluteClaims || args.enforce || args.enforceStrict) && metrics.absoluteClaims.length) {
    (args.failOnAbsoluteClaims || args.enforceStrict ? issues : warnings).push(`[绝对化陈述] ${fileName}: 命中${metrics.absoluteClaims.length}条规则`);
  }

  if (args.vcrHeuristicWarn && metrics.vcrIssues.length) {
    metrics.vcrIssues.forEach((issue) => warnings.push(`[VCR-P2] ${fileName}: ${issue}`));
  }

  if (args.warnImperative && metrics.imperativeTotal > 0) {
    const detail = Object.entries(metrics.imperative || {}).map(([k, v]) => `${k}×${v}`).join('、');
    warnings.push(`[A类命令词] ${fileName}: 合计 ${metrics.imperativeTotal} 次（${detail}）；全书阈值见 quality-S.md，修复后须用本脚本复验`);
  }

  return { issues, warnings };
}

function renderAutoFixDiff(changesByFile, bookRoot) {
  const sections = changesByFile.map(({ filePath, candidatePath, changes }) => {
    const rel = normalizeRel(filePath, bookRoot);
    const lines = changes.map((change) => `- 第 ${change.line} 行\n  - 原文：${change.before || '（空）'}\n  - 建议：${change.after || '（空）'}`).join('\n');
    return `## ${rel}\n\n- 候选文件：\`${candidatePath.replace(/\\/g, '/')}\`\n- 修改数：${changes.length}\n\n${lines}`;
  });
  return `# 机器可检项自动修复 diff\n\n> 说明：本文件为 \`quality-auditor.mjs --auto-fix\` 生成的候选修复清单。默认不覆盖原文；如需直接回写，请加 \`--write\`。\n\n${sections.join('\n\n---\n\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const files = collectFiles(args);
  if (!files.length) {
    console.error('quality-auditor: 未找到输入文件（用 --inputs 或 --glob）');
    process.exit(2);
  }

  const shouldBootstrapBare = args.standalone || !fs.existsSync(path.join(args.bookRoot, '.fbs'));
  const runtime = shouldBootstrapBare ? ensureBareQualityWorkspace(args.bookRoot, { files }) : { qcOutputDir: path.join(args.bookRoot, 'qc-output') };
  fs.mkdirSync(runtime.qcOutputDir, { recursive: true });

  const results = [];
  const allIssues = [];
  const allWarnings = [];
  const changesByFile = [];
  let imperativeBookTotal = 0;

  for (const filePath of files) {
    const text = fs.readFileSync(filePath, 'utf8');
    const metrics = scanMachineMetrics(text, args.skillRoot);
    imperativeBookTotal += metrics.imperativeTotal || 0;
    const fileName = path.basename(filePath);
    const buckets = buildIssueBuckets(metrics, args, fileName);
    allIssues.push(...buckets.issues);
    allWarnings.push(...buckets.warnings);

    const result = {
      filePath,
      metrics,
      issues: buckets.issues,
      warnings: buckets.warnings,
    };

    if (args.autoFix) {
      const fixed = applyConservativeAutoFix(text, args.skillRoot);
      if (fixed.changes.length > 0) {
        const candidatePath = path.join(runtime.qcOutputDir, 'auto-fix', normalizeRel(filePath, args.bookRoot));
        fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
        fs.writeFileSync(candidatePath, fixed.text, 'utf8');
        if (args.write) fs.writeFileSync(filePath, fixed.text, 'utf8');
        changesByFile.push({ filePath, candidatePath, changes: fixed.changes });
        result.autoFix = { candidatePath, changeCount: fixed.changes.length, appliedToSource: !!args.write };
      }
    }

    results.push(result);

    if (!args.json) {
      if (args.dashDensity || (!args.checkSectionIds && !args.intPercentDensity)) console.log(`${fileName}: 破折号/千字=${metrics.dashDensity.toFixed(2)}`);
      if (args.intPercentDensity) console.log(`${fileName}: 整数%/千字=${metrics.intPercentDensity.toFixed(2)}`);
    }
  }

  if (args.enforceImperativeBook && imperativeBookTotal > 3) {
    allIssues.push(`[A类命令词·全书] 本次扫描 A 类词合计 ${imperativeBookTotal} 次，超过 quality-S.md 建议阈值 3（须降级为非命令式表述后加 --warn-imperative 复验）`);
  }

  let diffPath = null;
  if (args.autoFix && changesByFile.length > 0) {
    diffPath = path.join(runtime.qcOutputDir, 'auto-fix-diff.md');
    fs.writeFileSync(diffPath, renderAutoFixDiff(changesByFile, args.bookRoot), 'utf8');
  }

  const summary = {
    timestamp: new Date().toISOString(),
    standalone: shouldBootstrapBare,
    bookRoot: args.bookRoot,
    total: results.length,
    imperativeBookTotal,
    issueCount: allIssues.length,
    warningCount: allWarnings.length,
    issues: allIssues,
    warnings: allWarnings,
    autoFix: args.autoFix ? { diffPath, changedFiles: changesByFile.length, write: !!args.write } : null,
    results,
  };

  const jsonOutPath = path.resolve(args.jsonOut || path.join(runtime.qcOutputDir, 'quality-audit-machine.json'));
  fs.mkdirSync(path.dirname(jsonOutPath), { recursive: true });
  fs.writeFileSync(jsonOutPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  summary.reportPath = jsonOutPath;

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    if (allWarnings.length) {
      console.log('\nquality-auditor: ⚠ 警告');
      allWarnings.forEach((warning) => console.log(`  ⚠ ${warning}`));
    }
    if (allIssues.length) {
      console.log('\nquality-auditor: ❌ 发现阻断问题');
      allIssues.forEach((issue) => console.log(`  ✗ ${issue}`));
    }
    if (!allIssues.length && !allWarnings.length) {
      console.log('quality-auditor: ✅ 通过');
    }
    if (diffPath) console.log(`quality-auditor: 🛠 已生成 auto-fix diff → ${diffPath}`);
    console.log(`quality-auditor: 报告 → ${jsonOutPath}`);
  }

  process.exit(allIssues.length > 0 ? 1 : 0);
}

main();
