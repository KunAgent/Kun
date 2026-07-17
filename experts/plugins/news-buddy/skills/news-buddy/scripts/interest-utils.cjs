#!/usr/bin/env node
// interest-utils.cjs — 兴趣标签权重管理工具函数
'use strict';

// ==================== 兴趣数据格式迁移 ====================
function migrateInterests(interests) {
  if (!Array.isArray(interests)) return [];
  return interests.map(item => {
    if (typeof item === 'string') {
      return { tag: item, weight: 1.0, added_at: new Date().toISOString(), sentiment: 'positive' };
    }
    return {
      tag: item.tag || '',
      weight: typeof item.weight === 'number' ? item.weight : 1.0,
      added_at: item.added_at || new Date().toISOString(),
      sentiment: item.sentiment || 'positive',
    };
  }).filter(item => item.tag);
}

// ==================== 提取标签列表 ====================
function interestTags(interests) {
  if (!Array.isArray(interests)) return [];
  return interests.map(i => typeof i === 'string' ? i : (i.tag || ''));
}

// ==================== 时间衰减 + 剪枝 ====================
function decayAndPrune(interests, options = {}) {
  const {
    halfLife = 30,
    minThreshold = 0.15,
    maxPerCategory = 12,
  } = options;

  if (!Array.isArray(interests)) return [];

  const now = Date.now();
  const decayFactor = Math.pow(0.5, 1 / halfLife); // 每天衰减因子

  // 计算衰减后权重
  let decayed = interests.map(item => {
    const addedAt = new Date(item.added_at).getTime();
    if (isNaN(addedAt)) {
      // 无效日期，保留原权重
      return { ...item, weight: Math.round((item.weight || 1.0) * 1000) / 1000 };
    }
    const daysSince = Math.max(0, (now - addedAt) / (1000 * 60 * 60 * 24));
    const newWeight = (item.weight || 1.0) * Math.pow(decayFactor, daysSince);
    return { ...item, weight: Math.round(newWeight * 1000) / 1000 };
  });

  // 剪枝：低于阈值
  decayed = decayed.filter(item => item.weight >= minThreshold);

  // 按权重降序排序，限制数量
  decayed.sort((a, b) => b.weight - a.weight);
  if (decayed.length > maxPerCategory) {
    decayed = decayed.slice(0, maxPerCategory);
  }

  return decayed;
}

// ==================== 查找相似兴趣 ====================
function findSimilarInterest(interests, tag) {
  if (!tag || !Array.isArray(interests)) return null;
  const normTag = tag.replace(/与|和|\s/g, '').toLowerCase();

  // 精确匹配
  for (const item of interests) {
    const normItem = (item.tag || '').replace(/与|和|\s/g, '').toLowerCase();
    if (normItem === normTag) return item;
  }
  // 包含匹配
  for (const item of interests) {
    const normItem = (item.tag || '').replace(/与|和|\s/g, '').toLowerCase();
    if (normItem.includes(normTag) || normTag.includes(normItem)) return item;
  }
  return null;
}

// ==================== 添加兴趣 ====================
function addInterest(interests, value, sentiment, options = {}) {
  const {
    halfLife = 30,
    minThreshold = 0.15,
    maxPerCategory = 12,
  } = options;
  const defaultWeight = options.defaultWeight || 1.0;
  const boostIncrement = options.boostIncrement || 0.3;
  const boostMax = options.boostMax || 2.0;

  if (!value) return { interests, action: 'no_value' };

  const existing = findSimilarInterest(interests, value);
  if (existing) {
    // 已存在 → 提权
    const oldWeight = existing.weight;
    existing.weight = Math.min(existing.weight + boostIncrement, boostMax);
    existing.added_at = new Date().toISOString();
    if (sentiment) existing.sentiment = sentiment;
    const action = existing.weight > oldWeight ? 'boosted' : 'at_max';
    return { interests, action };
  }

  // 新增
  const now = new Date().toISOString();
  interests.push({
    tag: value,
    weight: defaultWeight,
    added_at: now,
    sentiment: sentiment || 'positive',
  });

  // 超限剪枝
  interests.sort((a, b) => b.weight - a.weight);
  const pruned = interests.length > maxPerCategory ? interests.slice(0, maxPerCategory) : interests;

  return { interests: pruned, action: 'added' };
}

// ==================== 移除兴趣 ====================
function removeInterest(interests, value) {
  if (!value || !Array.isArray(interests)) return { interests: interests || [], action: 'no_value' };

  const normValue = value.replace(/与|和|\s/g, '').toLowerCase();
  const beforeLen = interests.length;

  const filtered = interests.filter(item => {
    const normItem = (item.tag || '').replace(/与|和|\s/g, '').toLowerCase();
    return normItem !== normValue && !normItem.includes(normValue) && !normValue.includes(normItem);
  });

  return {
    interests: filtered,
    action: filtered.length < beforeLen ? 'removed' : 'not_found',
  };
}

module.exports = {
  migrateInterests, interestTags, decayAndPrune,
  findSimilarInterest, addInterest, removeInterest,
};
