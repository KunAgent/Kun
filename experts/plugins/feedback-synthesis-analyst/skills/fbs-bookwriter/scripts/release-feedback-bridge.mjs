#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getRelease, updateRelease } from './releases-registry.mjs';

const FEEDBACK_DIRNAME = path.join('.fbs', 'org-feedback');
const FEEDBACK_BRIEF = path.join(FEEDBACK_DIRNAME, 'latest-feedback-brief.md');

function ensureFeedbackDir(bookRoot) {
  const dir = path.join(path.resolve(bookRoot), FEEDBACK_DIRNAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function feedbackPath(bookRoot, feedbackId) {
  return path.join(ensureFeedbackDir(bookRoot), `${feedbackId}.json`);
}

function generateFeedbackId(releaseId = 'feedback') {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  const normalized = String(releaseId || 'feedback').replace(/[^\w-]+/g, '-').slice(0, 30);
  return `feedback-${normalized}-${ts}-${rand}`;
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function listFeedback(bookRoot, filters = {}) {
  const dir = ensureFeedbackDir(bookRoot);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)

    .filter((name) => name.endsWith('.json'))
    .map((name) => safeReadJson(path.join(dir, name)))
    .filter(Boolean)
    .filter((item) => !filters.releaseId || item.releaseId === filters.releaseId)
    .filter((item) => !filters.status || item.status === filters.status)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function summarizeSeverity(items) {
  return items.reduce((acc, item) => {
    const level = item.severity || 'p1';
    acc[level] = (acc[level] || 0) + 1;
    return acc;
  }, {});
}

function buildBrief(bookRoot) {
  const items = listFeedback(bookRoot).slice(0, 20);
  const summary = {
    total: items.length,
    open: items.filter((item) => ['received', 'triaged', 'in_revision'].includes(item.status)).length,
    applied: items.filter((item) => item.status === 'applied').length,
    severity: summarizeSeverity(items),
  };

  const lines = [
    '# 组织反馈回流简报',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 反馈总数（最近 20 条）：${summary.total}`,
    `- 未关闭：${summary.open}`,
    `- 已应用：${summary.applied}`,
    `- 严重级别分布：${JSON.stringify(summary.severity)}`,
    '',
    '## 最近反馈',
    '',
  ];

  if (items.length === 0) {
    lines.push('- 暂无组织反馈回流记录');
  } else {
    for (const item of items) {
      lines.push(`- **${item.title}**｜来源：${item.source}｜状态：${item.status}｜级别：${item.severity}｜关联发布：${item.releaseId || '未绑定'}`);
      lines.push(`  - 摘要：${item.summary}`);
      if (item.resolutionNote) {
        lines.push(`  - 处理说明：${item.resolutionNote}`);
      }
    }
  }

  const briefPath = path.join(path.resolve(bookRoot), FEEDBACK_BRIEF);
  fs.mkdirSync(path.dirname(briefPath), { recursive: true });
  fs.writeFileSync(briefPath, lines.join('\n') + '\n', 'utf8');
  return briefPath;
}

function refreshReleaseFeedbackMeta(bookRoot, releaseId, preferredStatus) {
  if (!releaseId) return null;
  const release = getRelease(bookRoot, releaseId);
  if (!release) return null;

  const related = listFeedback(bookRoot, { releaseId });
  const summary = {
    total: related.length,
    open: related.filter((item) => ['received', 'triaged', 'in_revision'].includes(item.status)).length,
    applied: related.filter((item) => item.status === 'applied').length,
    latestFeedbackId: related[0]?.id || null,
    latestAt: related[0]?.createdAt || null,
    severity: summarizeSeverity(related),
  };

  const releaseStatus = preferredStatus
    ?? (summary.open > 0 ? 'feedback_received' : summary.applied > 0 ? 'revising' : release.status);

  updateRelease(bookRoot, releaseId, {
    status: releaseStatus,
    meta: {
      ...(release.meta || {}),
      organizationFeedback: summary,
    },
  });

  return summary;
}

export function recordFeedback(bookRoot, fields = {}) {
  const now = new Date().toISOString();
  const feedback = {
    id: generateFeedbackId(fields.releaseId),
    releaseId: fields.releaseId || null,
    source: fields.source || 'manual-review',
    title: fields.title || '未命名反馈',
    summary: fields.summary || '',
    severity: fields.severity || 'p1',
    status: fields.status || 'received',
    payloadFile: fields.payloadFile ? path.resolve(fields.payloadFile) : null,
    tags: Array.isArray(fields.tags) ? fields.tags : [],
    meta: fields.meta || {},
    createdAt: now,
    updatedAt: now,
    appliedAt: null,
    resolutionNote: '',
  };

  writeJson(feedbackPath(bookRoot, feedback.id), feedback);
  refreshReleaseFeedbackMeta(bookRoot, feedback.releaseId);
  const briefPath = buildBrief(bookRoot);
  return { feedback, briefPath };
}

export function applyFeedback(bookRoot, feedbackId, updates = {}) {
  const filePath = feedbackPath(bookRoot, feedbackId);
  const current = safeReadJson(filePath);
  if (!current) return null;

  const nextStatus = updates.status || 'applied';
  const updated = {
    ...current,
    status: nextStatus,
    resolutionNote: updates.note ?? current.resolutionNote ?? '',
    updatedAt: new Date().toISOString(),
    appliedAt: ['applied', 'accepted'].includes(nextStatus) ? new Date().toISOString() : current.appliedAt,
  };

  writeJson(filePath, updated);
  refreshReleaseFeedbackMeta(bookRoot, updated.releaseId, nextStatus === 'applied' ? 'revising' : undefined);
  const briefPath = buildBrief(bookRoot);
  return { feedback: updated, briefPath };
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      flags[token.slice(2)] = argv[++i];
    } else if (token.startsWith('--')) {
      flags[token.slice(2)] = true;
    }
  }
  return flags;
}

function printHelp() {
  console.log(`
组织反馈回流工具

用法:
  node scripts/release-feedback-bridge.mjs list   <bookRoot> [--release-id <id>]
  node scripts/release-feedback-bridge.mjs record <bookRoot> --release-id <id> --title <标题> --summary <摘要> [--source <来源>] [--severity p0|p1|p2] [--payload-file <file>]
  node scripts/release-feedback-bridge.mjs apply  <bookRoot> --feedback-id <id> [--status applied|accepted|rejected|archived] [--note <说明>]
  node scripts/release-feedback-bridge.mjs summary <bookRoot> [--release-id <id>]

说明:
  - 反馈记录会写入 .fbs/org-feedback/
  - 最新摘要会写入 .fbs/org-feedback/latest-feedback-brief.md
  - 若绑定 releaseId，会同步更新 releases/*-release.json 的 organizationFeedback 摘要
`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [action, bookRoot = process.cwd(), ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);

  if (!action || action === '--help') {
    printHelp();
    process.exit(0);
  }

  switch (action) {
    case 'list': {
      const items = listFeedback(bookRoot, { releaseId: flags['release-id'], status: flags.status });
      console.log(JSON.stringify(items, null, 2));
      break;
    }
    case 'summary': {
      const items = listFeedback(bookRoot, { releaseId: flags['release-id'], status: flags.status });
      console.log(JSON.stringify({
        total: items.length,
        open: items.filter((item) => ['received', 'triaged', 'in_revision'].includes(item.status)).length,
        applied: items.filter((item) => item.status === 'applied').length,
        releaseId: flags['release-id'] || null,
        severity: summarizeSeverity(items),
        latest: items[0] || null,
      }, null, 2));
      break;
    }
    case 'record': {
      const result = recordFeedback(bookRoot, {
        releaseId: flags['release-id'],
        source: flags.source,
        title: flags.title,
        summary: flags.summary,
        severity: flags.severity,
        status: flags.status,
        payloadFile: flags['payload-file'],
        tags: flags.tags ? String(flags.tags).split(',').map((item) => item.trim()).filter(Boolean) : [],
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'apply': {
      const result = applyFeedback(bookRoot, flags['feedback-id'], {
        status: flags.status,
        note: flags.note,
      });
      if (!result) {
        console.error('未找到指定反馈记录');
        process.exit(1);
      }
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default: {
      printHelp();
      process.exit(1);
    }
  }
}
