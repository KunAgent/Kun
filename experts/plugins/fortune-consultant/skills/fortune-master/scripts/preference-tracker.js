#!/usr/bin/env node
/**
 * 用户偏好学习系统
 * 基于用户互动记录，动态调整关注领域权重
 *
 * 用法（供 Agent 调用）:
 *   node preference-tracker.js record <userId> <topic> [context]
 *   node preference-tracker.js weights <userId>
 *   node preference-tracker.js top <userId> [n]
 */

const fs = require('fs');
const path = require('path');

const PROFILES_DIR = path.join(__dirname, '../data/profiles');

// 支持的关注领域
const TOPICS = ['财运', '事业', '感情', '健康', '婚姻', '子女', '官司', '出行', '风水'];

// 互动来源权重倍率
const CONTEXT_MULTIPLIERS = {
  explicit_query: 2.0,   // 用户主动提问
  topic_drill:    1.5,   // 用户追问同一话题
  morning_push:   0.8,   // 晨间推送被消费
  evening_push:   0.8,   // 晚间推送被消费
};

const DECAY_LAMBDA     = 0.05;  // 衰减系数，约14天半衰期
const MAX_LOG_SIZE     = 500;   // 最大记录条数
const MIN_WEIGHT       = 0.5;   // 进入 focusAreas 的最低权重
const DEFAULT_FOCUS    = ['事业', '财运', '健康'];

// ─────────────────────────────────────────────
// 文件 I/O
// ─────────────────────────────────────────────

function loadProfile(userId) {
  const fp = path.join(PROFILES_DIR, `${userId}.json`);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function saveProfile(userId, profile) {
  const fp = path.join(PROFILES_DIR, `${userId}.json`);
  profile.updatedAt = new Date().toISOString().split('T')[0];
  fs.writeFileSync(fp, JSON.stringify(profile, null, 2), 'utf8');
}

// ─────────────────────────────────────────────
// 核心算法：指数衰减加权
// ─────────────────────────────────────────────

function _computeWeights(log) {
  const now = Date.now();
  const totals = {};
  TOPICS.forEach(t => { totals[t] = 0; });

  for (const entry of (log || [])) {
    if (!TOPICS.includes(entry.topic)) continue;
    if (!entry.ts || typeof entry.ts !== 'number') continue;
    const daysDelta = (now - entry.ts) / 86400000;
    const multiplier = CONTEXT_MULTIPLIERS[entry.context] || 1.0;
    totals[entry.topic] += multiplier * Math.exp(-DECAY_LAMBDA * daysDelta);
  }
  return totals;
}

function _normalizeWeights(raw) {
  const max = Math.max(...Object.values(raw), 0.001);
  const result = {};
  for (const [t, w] of Object.entries(raw)) {
    result[t] = parseFloat((w / max).toFixed(3));
  }
  return result;
}

function _sortedTopics(weights) {
  return Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .map(([topic, weight]) => ({ topic, weight }));
}

// ─────────────────────────────────────────────
// 公开 API
// ─────────────────────────────────────────────

/**
 * 记录一次互动
 */
function recordInteraction(userId, topic, context = 'explicit_query') {
  const profile = loadProfile(userId);
  if (!profile) return false;
  if (!TOPICS.includes(topic)) return false;

  if (!profile.interactionLog) profile.interactionLog = [];

  profile.interactionLog.push({ ts: Date.now(), topic, context });

  // 超出上限时删除最旧的记录
  if (profile.interactionLog.length > MAX_LOG_SIZE) {
    profile.interactionLog = profile.interactionLog.slice(-MAX_LOG_SIZE);
  }

  // 重新计算并更新 focusAreas
  const raw = _computeWeights(profile.interactionLog);
  const normalized = _normalizeWeights(raw);
  const top = _sortedTopics(normalized)
    .filter(({ weight }) => weight >= MIN_WEIGHT)
    .slice(0, 3)
    .map(({ topic }) => topic);

  if (!profile.preferences) profile.preferences = {};
  profile.preferences.focusAreas = top.length > 0 ? top : DEFAULT_FOCUS;

  saveProfile(userId, profile);
  return true;
}

/**
 * 获取所有领域权重（归一化，降序）
 */
function getWeights(userId) {
  const profile = loadProfile(userId);
  if (!profile) return [];
  const raw = _computeWeights(profile.interactionLog || []);
  const normalized = _normalizeWeights(raw);
  return _sortedTopics(normalized);
}

/**
 * 获取 top-n 关注领域（有互动记录用计算结果，否则用 profile 默认值）
 */
function getTopTopics(userId, n = 3) {
  const profile = loadProfile(userId);
  if (!profile) return DEFAULT_FOCUS.slice(0, n);

  const log = profile.interactionLog || [];
  if (log.length === 0) {
    return (profile.preferences?.focusAreas || DEFAULT_FOCUS).slice(0, n);
  }

  const raw = _computeWeights(log);
  const normalized = _normalizeWeights(raw);
  return _sortedTopics(normalized)
    .slice(0, n)
    .map(({ topic }) => topic);
}

module.exports = { recordInteraction, getWeights, getTopTopics, TOPICS };

// ─────────────────────────────────────────────
// 命令行入口（供 Agent 调用）
// ─────────────────────────────────────────────

if (require.main === module) {
  const [cmd, userId, ...rest] = process.argv.slice(2);

  if (!cmd || !userId) {
    console.log(`
🧠 用户偏好追踪器

用法:
  node preference-tracker.js record <userId> <topic> [context]
  node preference-tracker.js weights <userId>
  node preference-tracker.js top <userId> [n]

topic 可选: ${TOPICS.join(' | ')}
context 可选: explicit_query | topic_drill | morning_push | evening_push

示例:
  node preference-tracker.js record 123456 财运 explicit_query
  node preference-tracker.js weights 123456
  node preference-tracker.js top 123456 3
`);
    process.exit(1);
  }

  switch (cmd) {
    case 'record': {
      const [topic, context = 'explicit_query'] = rest;
      if (!topic) { console.error('缺少 topic 参数'); process.exit(1); }
      const ok = recordInteraction(userId, topic, context);
      console.log(JSON.stringify({ success: ok, userId, topic, context }));
      break;
    }
    case 'weights': {
      const weights = getWeights(userId);
      console.log(JSON.stringify({ userId, weights }));
      break;
    }
    case 'top': {
      const n = parseInt(rest[0] || '3');
      const topics = getTopTopics(userId, n);
      console.log(JSON.stringify({ userId, topTopics: topics }));
      break;
    }
    default:
      console.error(`未知命令: ${cmd}`);
      process.exit(1);
  }
}
