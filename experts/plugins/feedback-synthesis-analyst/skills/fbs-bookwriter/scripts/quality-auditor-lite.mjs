#!/usr/bin/env node
/**
 * 质量审计器（10分制等权版）
 * - 支持裸仓库 standalone 模式
 * - 输出 S/P/C/B 四层各自 10 分制 + 综合分
 * - 保持 JSON 结构兼容 panorama / incremental 调用方
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { globSync } from 'glob';
import {
  ensureBareQualityWorkspace,
  QUALITY_SCAN_IGNORE_GLOBS,
  resolveQualityReferenceFile,
  resolveScriptSkillRoot,
} from './lib/quality-runtime.mjs';

const SCRIPT_SKILL_ROOT = resolveScriptSkillRoot(import.meta.url);

function loadS5BuzzwordLexicon(skillRoot) {
  const lexiconPath = resolveQualityReferenceFile(skillRoot, 's5-buzzword-lexicon.json');
  try {
    const lexicon = JSON.parse(fs.readFileSync(lexiconPath, 'utf8'));
    if (Array.isArray(lexicon?.terms) && lexicon.terms.length > 0) return lexicon.terms;
  } catch {
    // ignore
  }
  return ['底层能力', '全链路', '组合拳', '颗粒度', '赋能', '体系化', '中台'];
}

const DEFAULT_PROFILE_THRESHOLDS = {
  core: { s3RatioMax: 10, s6SemicolonDensityMax: 2, p1MaxIssues: 1, p2MinRatio: 0.1, b0MaxDuplicates: 0, b2MinDensity: 1.0 },
  ops: { s3RatioMax: 15, s6SemicolonDensityMax: 3, p1MaxIssues: 2, p2MinRatio: 0.05, b0MaxDuplicates: 1, b2MinDensity: 1.0 },
  ledger: { s3RatioMax: 18, s6SemicolonDensityMax: 4, p1MaxIssues: 4, p2MinRatio: 0, b0MaxDuplicates: 999, b2MinDensity: 0.8 },
  standard: { s3RatioMax: 10, s6SemicolonDensityMax: 2, p1MaxIssues: 2, p2MinRatio: 0.05, b0MaxDuplicates: 0, b2MinDensity: 1.0 },
};

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function resolvePolicyFileCandidates(skillRoot) {
  return [
    path.resolve(skillRoot, 'references', '05-ops', 'search-policy.json'),
    path.resolve(skillRoot, 'FBS-BookWriter', 'references', '05-ops', 'search-policy.json'),
    path.resolve(process.cwd(), 'references', '05-ops', 'search-policy.json'),
    path.resolve(SCRIPT_SKILL_ROOT, 'references', '05-ops', 'search-policy.json'),
  ];
}

function loadProfileThresholds(skillRoot) {
  for (const candidate of resolvePolicyFileCandidates(skillRoot)) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const policy = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      const configured = policy?.qualityAuditProfiles?.thresholds;
      if (!isPlainObject(configured)) continue;
      const merged = { ...DEFAULT_PROFILE_THRESHOLDS };
      for (const key of Object.keys(DEFAULT_PROFILE_THRESHOLDS)) {
        if (isPlainObject(configured[key])) merged[key] = { ...DEFAULT_PROFILE_THRESHOLDS[key], ...configured[key] };
      }
      return merged;
    } catch {
      continue;
    }
  }
  return DEFAULT_PROFILE_THRESHOLDS;
}

function detectDocProfile(filePath) {
  const p = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  if (p.includes('/.fbs/') || p.endsWith('/chapter-status.md') || p.includes('/internal-memo-')) return 'ledger';
  if (p.includes('/references/01-core/') || p.endsWith('/skill.md')) return 'core';
  if (p.includes('/references/05-ops/')) return 'ops';
  return 'standard';
}

function pickFirstMeaningfulLine(lines) {
  for (let i = 0; i < lines.length; i++) {
    const raw = String(lines[i] || '').trim();
    if (!raw || /^---$/.test(raw) || /^\|.*\|$/.test(raw) || /^>/.test(raw)) continue;
    const cleaned = raw
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/`[^`]*`/g, '')
      .replace(/[*_~]/g, '')
      .trim();
    if (cleaned) return { line: i + 1, text: cleaned };
  }
  return { line: 1, text: '' };
}

function normalizeContent(raw) {
  let content = String(raw || '');
  content = content.replace(/^---[\s\S]*?---\s*/m, '');
  content = content.replace(/```[\s\S]*?```/g, '');
  content = content.replace(/\[[^\]]+\]\([^\)]+\)/g, '$1');
  return content;
}

function longSentenceStats(content) {
  const prose = String(content || '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\[[^\]]+\]\([^\)]+\)/g, '$1');

  const roughSentences = prose.split(/[。！？；;：:\n]/).map((s) => s.trim()).filter(Boolean);
  const sentences = [];
  for (const s of roughSentences) {
    if (s.length > 45 && /，|,/.test(s)) {
      sentences.push(...s.split(/[，,]/).map((x) => x.trim()).filter(Boolean));
    } else {
      sentences.push(s);
    }
  }
  if (sentences.length === 0) return { ratio: 0, longCount: 0, total: 0, passed: true };
  const longSentences = sentences.filter((s) => s.length > 40);
  const ratio = (longSentences.length / sentences.length) * 100;
  return { ratio: Number(ratio.toFixed(2)), longCount: longSentences.length, total: sentences.length, passed: ratio < 10 };
}

function countRegex(content, regex) {
  const matches = content.match(regex) || [];
  return matches.length;
}

function coefficientOfVariation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!mean) return 0;
  const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function parseArgs(argv) {
  const args = {
    skillRoot: SCRIPT_SKILL_ROOT,
    bookRoot: process.cwd(),
    files: [],
    glob: null,
    minScore: 7.5,
    json: false,
    quiet: false,
    failFast: false,
    standalone: false,
    jsonOut: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--inputs') args.files.push(...String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--input') args.files.push(argv[++i]);
    else if (a === '--glob') args.glob = argv[++i];
    else if (a === '--min-score') args.minScore = Number(argv[++i] || args.minScore);
    else if (a === '--json') args.json = true;
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--fail-fast') args.failFast = true;
    else if (a === '--standalone') args.standalone = true;
    else if (a === '--skill-root') args.skillRoot = argv[++i] || args.skillRoot;
    else if (a === '--book-root') args.bookRoot = argv[++i] || args.bookRoot;
    else if (a === '--json-out') args.jsonOut = argv[++i] || null;
    else if (a === '--inputs-file') args.inputsFile = argv[++i] || null;
    else if (!a.startsWith('--')) args.files.push(a);
  }
  args.skillRoot = path.resolve(args.skillRoot || SCRIPT_SKILL_ROOT);
  args.bookRoot = path.resolve(args.bookRoot || process.cwd());
  return args;
}

function collectFiles(args) {
  const files = new Set(args.files.map((file) => path.resolve(args.bookRoot, file)));
  if (args.inputsFile) {
    try {
      const raw = fs.readFileSync(path.resolve(args.inputsFile), 'utf8');
      raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((file) => files.add(path.resolve(file)));
    } catch {
      // ignore
    }
  }
  if (args.glob) {
    globSync(args.glob, { cwd: args.bookRoot, absolute: true }).forEach((file) => files.add(file));
  }
  return [...files].filter((file) => fs.existsSync(file));
}


function createRuleSet(skillRoot) {
  const s5Buzzwords = loadS5BuzzwordLexicon(skillRoot);
  return {
    S: {
      S1: {
        name: '首句具体化',
        check(lines) {
          const first = pickFirstMeaningfulLine(lines);
          const hasElement = /[人物场景数据问题目标用户流程策略任务章节版本说明]/.test(first.text) || first.text.length >= 10;
          return { passed: hasElement, line: first.line };
        },
      },
      S2: {
        name: '消灭冗余修饰',
        buzzwords: ['非常', '显著', '大幅', '根本性', '彻底', '完全', '极其', '高度', '深度', '广泛', '极大地', '深刻地', '全面地', '前所未有', '充分', '深入', '尤其', '特别', '相当', '格外', '甚为', '甚'],
        professionalPhrases: ['深度学习', '深度阅读', '深度工作', '深度理解', '深度研究', '深度分析', '深度整合', '深度专家', '深度积累', '深度参与', '深度思考', '深度专注', '高度不确定', '高度专业', '高度复杂'],
        check(content) {
          const found = [];
          for (const word of this.buzzwords) {
            let cleaned = content;
            for (const phrase of this.professionalPhrases) {
              if (phrase.includes(word)) cleaned = cleaned.replace(new RegExp(phrase, 'g'), '');
            }
            const matches = cleaned.match(new RegExp(word, 'g'));
            if (matches) found.push(`${word}(${matches.length})`);
          }
          return { passed: found.length === 0, issues: found };
        },
      },
      S3: {
        name: '短句优先',
        check: longSentenceStats,
      },
      S4: {
        name: '连接词降频',
        connectors: ['此外', '另外', '同时', '其次', '再者', '而且', '综上所述', '不难看出', '值得注意的是', '需要指出的是', '总的来说', '由此可见', '因此', '所以', '总而言之', '此时', '在此基础上'],
        check(content) {
          const found = {};
          for (const conn of this.connectors) {
            const matches = content.match(new RegExp(conn, 'g'));
            if (matches) found[conn] = matches.length;
          }
          const total = Object.values(found).reduce((a, b) => a + b, 0);
          const density = total / Math.max(content.replace(/\s+/g, '').length / 1000, 1);
          return { passed: density < 2, found, total, density: Number(density.toFixed(2)) };
        },
      },
      S5: {
        name: 'Buzzword黑名单',
        buzzwords: s5Buzzwords,
        check(content) {
          const found = this.buzzwords.filter((word) => content.includes(word));
          return { passed: found.length === 0, issues: found };
        },
      },
      S6: {
        name: '标点符号纪律',
        check(content) {
          const dashCount = countRegex(content, /——/g);
          const semicolonCount = countRegex(content, /；/g);
          const exclamationCount = countRegex(content, /！/g);
          const lengthKb = Math.max(content.replace(/\s+/g, '').length / 1000, 1);
          const dashDensity = dashCount / lengthKb;
          const semicolonDensity = semicolonCount / lengthKb;
          return {
            passed: dashDensity <= 1 && semicolonDensity <= 2 && exclamationCount <= 2,
            dashCount,
            semicolonCount,
            exclamationCount,
            dashDensity: Number(dashDensity.toFixed(2)),
            semicolonDensity: Number(semicolonDensity.toFixed(2)),
          };
        },
      },
    },
    P: {
      P1: {
        name: '问题驱动',
        check(paragraphs) {
          if (!paragraphs.length) return { passed: true, issues: [] };
          const issues = [];
          paragraphs.forEach((paragraph, index) => {
            const t = paragraph.trim();
            if (t.length < 80) return;
            if (/^[-*>]|^\d+\./.test(t) || /^#{1,6}\s/.test(t) || /^\|.*\|$/.test(t) || /^```/.test(t)) return;
            if (/`[^`]+`/.test(t) && /\//.test(t)) return;
            const firstSentence = t.split(/[。！？]/)[0] || t;
            const hasQuestion = /[？?]/.test(firstSentence);
            const hasContext = /[时间地点人物场景问题目标用户流程策略任务]/.test(firstSentence);
            const hasLead = /[:：]/.test(firstSentence);
            if (!hasQuestion && !hasContext && !hasLead) {
              issues.push(`段落${index + 1}: ${firstSentence.slice(0, 30)}...`);
            }
          });
          return { passed: issues.length <= 2, issues };
        },
      },
      P2: {
        name: '对话代替转述',
        check(content) {
          const quoteCount = countRegex(content, /[“”"「」『』]/g);
          const codeQuoteCount = (content.match(/`[^`]+`/g) || []).length;
          const ratio = (quoteCount + codeQuoteCount) / Math.max(content.replace(/\s+/g, '').length / 1000, 1);
          return { passed: ratio >= 0.6, ratio: Number(ratio.toFixed(2)) };
        },
      },
      P3: {
        name: '禁止对称排比',
        check(content) {
          const sentences = content.split(/[。！？]/).map((s) => s.trim()).filter(Boolean).filter((s) => !/^[-*#>|`]/.test(s)).filter((s) => !/^\|.*\|$/.test(s));
          for (let i = 0; i < sentences.length - 2; i++) {
            const [s1, s2, s3] = [sentences[i], sentences[i + 1], sentences[i + 2]];
            if (s1.length > 28 && s2.length > 28 && s3.length > 28) {
              const p1 = s1.slice(0, 6);
              const p2 = s2.slice(0, 6);
              const p3 = s3.slice(0, 6);
              if (p1 === p2 && p2 === p3) return { passed: false };
            }
          }
          return { passed: true };
        },
      },
      P4: {
        name: '拒绝注水',
        check(paragraphs) {
          const issues = [];
          paragraphs.forEach((paragraph, index) => {
            const t = paragraph.trim();
            if (/^(此外|另外|同时|总的来说|换言之|也就是说)/.test(t) && t.length < 60) {
              issues.push(`段落${index + 1}: 疑似过渡注水`);
            }
          });
          return { passed: issues.length === 0, issues };
        },
      },
    },
    C: {
      C1: {
        name: '承认局限+明确表态',
        limitationKeywords: ['但是', '然而', '不过', '局限', '不足', '有待', '尚未', '需要注意', '值得注意', '除非', '前提是', '有条件', '可能', '目前', '暂时', '无法保证'],
        check(content) {
          if (!content || content.trim().length < 100) return { passed: true, note: 'content too short to evaluate' };
          const found = this.limitationKeywords.some((kw) => content.includes(kw));
          return { passed: found, note: found ? 'limitation or qualification found' : 'no limitation/qualification detected' };
        },
      },
      C2: {
        name: '结尾指向行动',
        actionKeywords: ['可以', '应该', '建议', '需要', '下一步', '接下来', '开始', '尝试', '执行', '请', '推荐', '参考', '实施', '完成', '进入', '启动'],
        check(content) {
          const sentences = content.split(/[。！？\n]/).map((s) => s.trim()).filter(Boolean);
          const tail = sentences.slice(-3).join('');
          if (!tail) return { passed: false, note: 'no ending sentence found' };
          const found = this.actionKeywords.some((kw) => tail.includes(kw));
          return { passed: found, note: found ? 'action-oriented ending found' : 'ending lacks actionable direction' };
        },
      },
      C3: {
        name: '打破结构均匀',
        check(sections) {
          if (sections.length <= 1) return { passed: true, cv: 0 };
          const lengths = sections.map((s) => s.length);
          const cv = coefficientOfVariation(lengths);
          return { passed: cv >= 0.3, cv: Number(cv.toFixed(2)) };
        },
      },
      C4: {
        name: '数据具体化',
        check(content) {
          const matches = content.match(/\d+%/g) || [];
          const totalNumbers = content.match(/\d+/g) || [];
          const ratio = (matches.length / Math.max(totalNumbers.length, 1)) * 100;
          return { passed: ratio <= 20, ratio: Number(ratio.toFixed(2)) };
        },
      },
    },
    B: {
      B0: {
        name: '标题编号唯一',
        check(content) {
          const headings = (content.match(/^#+\s+.*$/gm) || []).map((h) => h.trim());
          const ids = headings.map((heading) => {
            const m = heading.match(/^#+\s+([\d]+(?:\.[\d]+)*\.?)(?:\s|$)/);
            return m ? m[1].replace(/\.$/, '') : null;
          }).filter(Boolean);
          const duplicates = ids.length - new Set(ids).size;
          return { passed: duplicates === 0, duplicates };
        },
      },
      B1: {
        name: '标题去公式化',
        templatePatterns: [
          /^#{1,3}\s+第[一二三四五六七八九十百\d]+章/,
          /^#{1,3}\s+(如何|怎么|怎样)[^：:，,]{0,20}[？?]?$/,
          /^#{1,3}\s+\d+\s*(个|种|条|步|大|项)\s*[^（(]/,
          /^#{1,3}\s+(总结|小结|本章小结|本节小结|小节总结)\s*$/,
        ],
        check(content) {
          const headings = (content.match(/^#{1,3}\s+.*$/gm) || []).map((h) => h.trim());
          if (headings.length <= 2) return { passed: true, formulaic: [] };
          const formulaic = [];
          for (const heading of headings) {
            for (const pattern of this.templatePatterns) {
              if (pattern.test(heading)) {
                formulaic.push(heading.replace(/^#+\s+/, ''));
                break;
              }
            }
          }
          return { passed: formulaic.length <= 1, formulaic, count: formulaic.length };
        },
      },
      B2_1: {
        name: '段落节奏',
        check(paragraphs) {
          if (paragraphs.length <= 1) return { passed: true, cv: 0 };
          const cv = coefficientOfVariation(paragraphs.map((p) => p.length));
          return { passed: cv >= 0.3, cv: Number(cv.toFixed(2)) };
        },
      },
      B2_2: {
        name: '标点多样性',
        check(content) {
          const punctuation = content.match(/[，。；：！？、“”"'（）【】《》……]/g) || [];
          const unique = new Set(punctuation);
          const density = unique.size / Math.max(content.replace(/\s+/g, '').length / 1000, 1);
          return { passed: density >= 1.0, density: Number(density.toFixed(2)), uniqueCount: unique.size };
        },
      },
      B2_C: {
        name: '结构雷同检测（轻量）',
        check(sections) {
          if (sections.length <= 2) return { passed: true, similarity: 0 };
          const leads = sections.map((section) => {
            const firstLine = section.trim().split('\n').find((line) => line.trim() && !line.trim().startsWith('#')) || '';
            return firstLine.trim().slice(0, 5);
          }).filter(Boolean);
          if (leads.length <= 2) return { passed: true, similarity: 0 };
          const seen = new Set();
          let duplicateLeads = 0;
          for (const lead of leads) {
            if (seen.has(lead) && lead.length >= 3) duplicateLeads++;
            seen.add(lead);
          }
          const similarity = duplicateLeads / leads.length;
          return { passed: similarity <= 0.3, similarity: Number(similarity.toFixed(2)), duplicateLeads };
        },
      },
      B3: {
        name: '全局节奏综合',
        check(paragraphs) {
          if (paragraphs.length <= 2) return { passed: true, cv: 0, note: 'paragraphs too few to evaluate' };
          const cv = coefficientOfVariation(paragraphs.map((p) => p.length));
          return { passed: cv >= 0.4, cv: Number(cv.toFixed(2)) };
        },
      },
      V1: {
        name: '视觉密度',
        check(content) {
          const imageCount = (content.match(/!\[[^\]]*\]\([^\)]+\)|<img\b[^>]*>/g) || []).length;
          const mermaidCount = (content.match(/```mermaid[\s\S]*?```/g) || []).length;
          const lines = content.split(/\r?\n/);
          let tableBlocks = 0;
          let inTable = false;
          for (const line of lines) {
            const isTableLine = /^\s*\|.*\|\s*$/.test(line);
            if (isTableLine && !inTable) tableBlocks += 1;
            inTable = isTableLine;
          }
          const visualCount = imageCount + mermaidCount + tableBlocks;
          const densityPer5k = Number((visualCount / Math.max(content.replace(/\s+/g, '').length / 5000, 1)).toFixed(2));
          return {
            passed: densityPer5k >= 1,
            imageCount,
            mermaidCount,
            tableBlocks,
            visualCount,
            densityPer5k,
          };
        },
      },
    },
  };
}

function applyProfileThresholds(profile, details, thresholds) {
  const t = thresholds[profile] || thresholds.standard;
  if (details?.S?.S3) details.S.S3.passed = details.S.S3.ratio <= t.s3RatioMax;
  if (details?.S?.S6) details.S.S6.passed = details.S.S6.dashDensity <= 1 && details.S.S6.semicolonDensity <= t.s6SemicolonDensityMax && details.S.S6.exclamationCount <= 2;
  if (details?.P?.P1) details.P.P1.passed = (details.P.P1.issues || []).length <= t.p1MaxIssues;
  if (details?.P?.P2) details.P.P2.passed = details.P.P2.ratio >= t.p2MinRatio;
  if (details?.B?.B0) details.B.B0.passed = (details.B.B0.duplicates || 0) <= t.b0MaxDuplicates;
  if (details?.B?.B2_2) details.B.B2_2.passed = details.B.B2_2.density >= t.b2MinDensity;
  return details;
}

function scoreLayer(details, keys = Object.keys(details)) {
  const total = Math.max(keys.length, 1);
  const passed = keys.filter((key) => details[key]?.passed).length;
  return Number(((passed / total) * 10).toFixed(1));
}

export function auditFile(filePath, options = {}) {
  const profile = detectDocProfile(filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  const content = normalizeContent(raw);
  const lines = content.split('\n');
  const paragraphs = content.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const sections = content.split(/^##/m).map((s) => s.trim()).filter(Boolean);
  const rules = options.rules || createRuleSet(options.skillRoot || SCRIPT_SKILL_ROOT);
  const thresholds = options.thresholds || loadProfileThresholds(options.skillRoot || SCRIPT_SKILL_ROOT);

  const sResults = {
    S1: rules.S.S1.check(lines),
    S2: rules.S.S2.check(content),
    S3: rules.S.S3.check(content),
    S4: rules.S.S4.check(content),
    S5: rules.S.S5.check(content),
    S6: rules.S.S6.check(content),
  };
  const pResults = {
    P1: rules.P.P1.check(paragraphs),
    P2: rules.P.P2.check(content),
    P3: rules.P.P3.check(content),
    P4: rules.P.P4.check(paragraphs),
  };
  const cResults = {
    C1: rules.C.C1.check(content),
    C2: rules.C.C2.check(content),
    C3: rules.C.C3.check(sections),
    C4: rules.C.C4.check(content),
  };
  const bResults = {
    B0: rules.B.B0.check(content),
    B1: rules.B.B1.check(content),
    B2_1: rules.B.B2_1.check(paragraphs),
    B2_2: rules.B.B2_2.check(content),
    B2_C: rules.B.B2_C.check(sections),
    B3: rules.B.B3.check(paragraphs),
    V1: rules.B.V1.check(content),
  };

  const details = applyProfileThresholds(profile, { S: sResults, P: pResults, C: cResults, B: bResults }, thresholds);
  const scoreS = scoreLayer(details.S);
  const scoreP = scoreLayer(details.P);
  const scoreC = scoreLayer(details.C);
  const scoreB = scoreLayer(details.B, ['B0', 'B1', 'B2_1', 'B2_2', 'B2_C', 'B3']);
  const scoreV1 = details.B.V1?.passed ? 10 : 0;
  const overall = Number((((scoreS + scoreP + scoreC + scoreB) / 4)).toFixed(1));
  const threshold = { min: Number(options.minScore || 7.5), passed: overall >= Number(options.minScore || 7.5) };

  return {
    filePath,
    profile,
    scoringVersion: '10-point-equal-layers-v1',
    scores: {
      S: scoreS,
      P: scoreP,
      C: scoreC,
      B: scoreB,
      V1: scoreV1,
      total: overall,
      converted: overall,
      overall,
    },
    threshold,
    gGate: { status: 'manual_review_required' },
    details,
  };
}

function printFileSummary(result) {
  console.log(`\n[quality] ${result.filePath}`);
  console.log(`  综合: ${result.scores.overall}/10 ${result.threshold.passed ? '✅' : '❌'} | S ${result.scores.S} / P ${result.scores.P} / C ${result.scores.C} / B ${result.scores.B}`);
}

export function summarizeResults(results, minScore) {
  const passed = results.filter((result) => result.threshold?.passed).length;
  const failed = results.length - passed;
  return {
    timestamp: new Date().toISOString(),
    scoringVersion: '10-point-equal-layers-v1',
    minScore,
    total: results.length,
    passed,
    failed,
    avgScore: Number((results.filter((r) => r.scores).reduce((acc, result) => acc + (result.scores?.overall || 0), 0) / Math.max(results.filter((r) => r.scores).length, 1)).toFixed(2)),
    results,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const files = collectFiles(args);
  if (!files.length) {
    console.error(
      'Usage: node quality-auditor-lite.mjs <file.md> [--inputs a.md,b.md] [--glob "**/*.md"] [--book-root .] [--standalone] [--min-score 7.5] [--json]\n' +
        '提示：含中文或特殊字符路径时优先使用 --inputs 或 --glob，避免裸位置参数在部分终端下解析异常。',
    );
    process.exit(2);
  }

  const shouldBootstrapBare = args.standalone || !fs.existsSync(path.join(args.bookRoot, '.fbs'));
  let runtime = null;
  if (shouldBootstrapBare) {
    runtime = ensureBareQualityWorkspace(args.bookRoot, { files });
  }

  const rules = createRuleSet(args.skillRoot);
  const thresholds = loadProfileThresholds(args.skillRoot);
  const results = [];

  for (const filePath of [...new Set(files.map((file) => path.resolve(file)))]) {
    if (!fs.existsSync(filePath)) {
      results.push({ filePath, error: 'file_not_found', threshold: { min: args.minScore, passed: false } });
      if (args.failFast) break;
      continue;
    }
    const result = auditFile(filePath, { minScore: args.minScore, skillRoot: args.skillRoot, rules, thresholds });
    results.push(result);
    if (!args.quiet) printFileSummary(result);
    if (args.failFast && !result.threshold.passed) break;
  }

  const summary = summarizeResults(results, args.minScore);
  if (runtime || args.jsonOut) {
    const jsonOutPath = path.resolve(args.jsonOut || path.join(args.bookRoot, 'qc-output', 'quality-audit-lite.json'));
    fs.mkdirSync(path.dirname(jsonOutPath), { recursive: true });
    fs.writeFileSync(jsonOutPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
    summary.reportPath = jsonOutPath;
  }

  // 落盘到 .workbuddy/memory/qc-{taskId}.md（B3 合规）
  const taskId = `lite-${Date.now()}`;
  const p0Count = summary.results.filter((r) => r.threshold && !r.threshold.passed && (r.scores?.overall || 0) < 5).length;
  const p1Count = summary.failed - p0Count;
  const memoryDir = path.join(args.bookRoot, '.workbuddy', 'memory');
  try {
    fs.mkdirSync(memoryDir, { recursive: true });
    const memFile = path.join(memoryDir, `qc-${taskId}.md`);
    const conclusion = summary.failed === 0 ? 'passed' : `failed(${summary.failed}/${summary.total})`;
    const meta = JSON.stringify({ taskId, conclusion, p0Count, p1Count, total: summary.total, avgScore: summary.avgScore, reportPath: summary.reportPath || '' });
    const content = `<!-- FBS_QC_META ${meta} -->\n# QC 落盘（quality-auditor-lite）\n\n- taskId: ${taskId}\n- 结论: ${conclusion}\n- P0（<5分）: ${p0Count}\n- P1（未通过）: ${p1Count}\n- 总文件: ${summary.total}\n- 平均分: ${summary.avgScore}\n- reportPath: ${summary.reportPath || '(未生成)'}\n- generatedAt: ${summary.timestamp}\n`;
    fs.writeFileSync(memFile, content, 'utf8');
  } catch {
    // 落盘失败不阻断主流程
  }

  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else console.log(`\n[quality] 汇总: total=${summary.total}, passed=${summary.passed}, failed=${summary.failed}, avg=${summary.avgScore}/10`);

  process.exit(summary.failed > 0 ? 1 : 0);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}
