#!/usr/bin/env node
// scripts/news-buddy.cjs — 腾讯新闻搭子核心执行脚本
// v4.1: 移除时效验证脚本，改用搜索策略（topic:news + 年份确认）保障时效
// 功能：画像管理（初始化/更新/迭代）、新闻数据存储、已展示记录管理
// 设计理念：画像对用户不可见，所有隐私信息脱敏存储，通过对话自然迭代

'use strict';

const fs = require('fs');
const path = require('path');

// === 模块导入 ===
const { loadConfig } = require('../config.cjs');
const {
  extractInterests, findRegistryMatch, inferSearchDimensions,
} = require('./tag-registry.cjs');
const {
  migrateInterests, interestTags, decayAndPrune,
  findSimilarInterest, addInterest, removeInterest,
} = require('./interest-utils.cjs');

// ==================== 路径 ====================
const SKILL_DIR = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(SKILL_DIR, '.cache');
const PROFILE_FILE = path.join(CACHE_DIR, 'profile.json');
const NEWS_FILE = path.join(CACHE_DIR, 'news.json');
const SHOWN_FILE = path.join(CACHE_DIR, 'shown.json');
const HISTORY_DIR = path.join(CACHE_DIR, 'history');
const TEMPLATES_FILE = path.join(SKILL_DIR, 'data', 'profile-templates.json');

// 确保缓存目录存在
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

// ==================== 配置快捷访问 ====================
function cfg(key) {
  return loadConfig()[key];
}

// ==================== 画像脱敏映射 ====================
const DESENSITIZE_MAP = {
  age: {
    ranges: [
      { min: 0, max: 22, label: '求学探索期新锐' },
      { min: 23, max: 28, label: '职场成长期新锐' },
      { min: 29, max: 35, label: '职场中坚力量' },
      { min: 36, max: 45, label: '成熟期社会中坚' },
      { min: 46, max: 55, label: '事业成熟期精英' },
      { min: 56, max: 120, label: '阅历丰富的社会前辈' },
    ],
  },
  city: {
    tier1: ['北京', '上海', '广州', '深圳'],
    newTier1: ['成都', '杭州', '武汉', '南京', '重庆', '苏州', '西安', '长沙', '天津', '郑州', '东莞', '青岛', '昆明', '沈阳', '宁波', '合肥'],
    tier2: ['佛山', '无锡', '厦门', '大连', '济南', '福州', '温州', '石家庄', '哈尔滨', '珠海'],
  },
  job: {
    'programmer|程序员|开发|前端|后端|全栈|码农|工程师|架构师': 'IT互联网背景',
    '产品经理|产品|PM': 'IT互联网产品背景',
    '设计师|设计|UI|UX': '创意设计背景',
    '公务员|事业单位|政府|体制内': '公共服务领域',
    '老师|教师|教育|教授': '教育行业背景',
    '医生|护士|医疗|医院': '医疗健康行业',
    '金融|银行|证券|基金|会计|财务': '金融财经背景',
    '律师|法律|法务': '法律行业背景',
    '销售|运营|市场|营销': '商业运营背景',
    '骑手|快递|外卖|工人|工厂|制造': '实干型劳动者',
    '个体|老板|创业|自营': '创业/个体经营者',
    '自由职业|freelance|自媒体|博主': '自由职业/内容创作者',
    '学生': '在校学生',
    '退休': '退休人士',
  },
};

// ==================== 工具函数 ====================
function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function loadJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {
    console.error(`\u26a0\ufe0f 读取 ${path.basename(filePath)} 失败: ${e.message}`);
  }
  return null;
}

function saveJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error(`\u274c 写入 ${path.basename(filePath)} 失败: ${e.message}`);
    process.exit(1);
  }
}

// 传递配置给 decayAndPrune
function decayWithConfig(interests) {
  return decayAndPrune(interests, {
    halfLife: cfg('DECAY_HALF_LIFE_DAYS'),
    minThreshold: cfg('MIN_WEIGHT_THRESHOLD'),
    maxPerCategory: cfg('MAX_INTERESTS_PER_CATEGORY'),
  });
}

// ==================== （v4.1: 时效验证已移除，改用搜索策略保障时效） ====================

// ==================== 推断语气风格 ====================
function inferTone(profile) {
  if (profile.industry_bg && profile.industry_bg.includes('IT')) {
    return '专业但亲和的智囊伙伴，像资深同事在茶水间聊天';
  }
  if (profile.industry_bg && profile.industry_bg.includes('金融')) {
    return '理性冷静的分析搭子，数据说话不画饼';
  }
  if (profile.industry_bg && profile.industry_bg.includes('公共服务')) {
    return '严谨客观但不打官腔，像靠谱的参谋';
  }
  if (profile.industry_bg && profile.industry_bg.includes('实干型')) {
    return '说人话不绕弯，直接给结论和建议';
  }
  if (profile.life_stage && profile.life_stage.includes('前辈')) {
    return '尊重但不装嫩，平实亲切，信息清晰';
  }
  if (profile.life_stage && (profile.life_stage.includes('学生') || profile.life_stage.includes('新锐'))) {
    return '像学长聊天，轻松但靠谱';
  }
  return '像朋友聊天一样自然，亲和但有干货';
}

// ==================== 画像脱敏处理 ====================
function desensitizeAge(text) {
  const ageMatch = text.match(/(\d{1,3})\s*岁/);
  if (!ageMatch) return null;
  const age = parseInt(ageMatch[1]);
  for (const range of DESENSITIZE_MAP.age.ranges) {
    if (age >= range.min && age <= range.max) {
      return range.label;
    }
  }
  return '社会活跃期成员';
}

function desensitizeCity(text) {
  for (const city of DESENSITIZE_MAP.city.tier1) {
    if (text.includes(city)) return '一线城市居民';
  }
  for (const city of DESENSITIZE_MAP.city.newTier1) {
    if (text.includes(city)) return '新一线城市居民';
  }
  for (const city of DESENSITIZE_MAP.city.tier2) {
    if (text.includes(city)) return '二线城市居民';
  }
  if (text.match(/县|乡|镇|村/)) return '县域/乡镇居民';
  return null;
}

function desensitizeJob(text) {
  const textLower = text.toLowerCase();
  for (const [pattern, label] of Object.entries(DESENSITIZE_MAP.job)) {
    const keywords = pattern.split('|');
    for (const kw of keywords) {
      if (textLower.includes(kw.toLowerCase())) return label;
    }
  }
  return null;
}

// ==================== CLI 命令处理 ====================

function cmdGetProfile() {
  const profile = loadJSON(PROFILE_FILE);
  if (profile) {
    console.log(JSON.stringify({ has_profile: true, profile }, null, 2));
  } else {
    console.log(JSON.stringify({ has_profile: false }));
  }
}

function cmdInitProfile(input) {
  if (!input) {
    console.error('\u274c 需要提供 --input 参数');
    process.exit(1);
  }

  const existingProfile = loadJSON(PROFILE_FILE);

  const lifeStage = desensitizeAge(input) || '社会活跃期成员';
  const cityTier = desensitizeCity(input) || null;
  const industryBg = desensitizeJob(input) || null;
  const interests = extractInterests(input);

  const now = new Date().toISOString();

  function toWeighted(tags) {
    return tags.map(tag => ({ tag, weight: cfg('DEFAULT_WEIGHT'), added_at: now, sentiment: 'positive' }));
  }

  const profile = {
    created_at: existingProfile ? existingProfile.created_at : now,
    updated_at: now,
    life_stage: lifeStage,
    industry_bg: industryBg || '综合背景',
    city_tier: cityTier || '城市居民',
    cognitive_style: '均衡型',
    notes: existingProfile ? (existingProfile.notes || '') : '',
    core_risk_avoidance: interests.core_risk_avoidance.length > 0
      ? toWeighted(interests.core_risk_avoidance)
      : toWeighted(['生活成本控制', '职业安全感']),
    hard_interests: interests.hard_interests.length > 0
      ? toWeighted(interests.hard_interests)
      : toWeighted(['社会热点', '经济趋势']),
    soft_interests: interests.soft_interests.length > 0
      ? toWeighted(interests.soft_interests)
      : toWeighted(['影视娱乐']),
    tone: '',
    search_dimensions: [],
    raw_keywords: input.substring(0, 200),
  };

  if (existingProfile) {
    for (const field of ['hard_interests', 'soft_interests', 'core_risk_avoidance']) {
      const oldItems = migrateInterests(existingProfile[field] || []);
      for (const oldItem of oldItems) {
        if (!findSimilarInterest(profile[field], oldItem.tag)) {
          profile[field].push({ ...oldItem, weight: oldItem.weight * 0.5 });
        }
      }
      profile[field] = decayWithConfig(profile[field]);
    }
  }

  profile.search_dimensions = inferSearchDimensions(profile);
  profile.tone = inferTone(profile);

  const templates = loadJSON(TEMPLATES_FILE);
  if (templates && templates.templates) {
    let bestMatch = null;
    let bestScore = 0;
    for (const tmpl of templates.templates) {
      let score = 0;
      const inputLower = input.toLowerCase();
      for (const kw of (tmpl.match_keywords || [])) {
        if (inputLower.includes(kw.toLowerCase())) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = tmpl;
      }
    }
    if (bestMatch && bestScore >= 2) {
      for (const interest of (bestMatch.hard_interests || [])) {
        if (!findSimilarInterest(profile.hard_interests, interest)) {
          profile.hard_interests.push({ tag: interest, weight: 0.7, added_at: now, sentiment: 'positive' });
        }
      }
      for (const interest of (bestMatch.soft_interests || [])) {
        if (!findSimilarInterest(profile.soft_interests, interest)) {
          profile.soft_interests.push({ tag: interest, weight: 0.7, added_at: now, sentiment: 'positive' });
        }
      }
      if (bestMatch.cognitive_style) {
        profile.cognitive_style = bestMatch.cognitive_style;
      }
      profile.hard_interests = decayWithConfig(profile.hard_interests);
      profile.soft_interests = decayWithConfig(profile.soft_interests);
      profile.search_dimensions = inferSearchDimensions(profile);
    }
  }

  saveJSON(PROFILE_FILE, profile);
  console.log(JSON.stringify({
    status: 'ok',
    profile_hint: {
      life_stage: profile.life_stage,
      industry_bg: profile.industry_bg,
      city_tier: profile.city_tier,
      hard_interests: interestTags(profile.hard_interests),
      soft_interests: interestTags(profile.soft_interests),
      core_risk_avoidance: interestTags(profile.core_risk_avoidance),
      search_dimensions: profile.search_dimensions,
      tone: profile.tone,
      notes: profile.notes || '',
    },
    message: '画像已初始化。请基于以上 profile_hint 构建完整脱敏画像，用于后续搜索和改写。',
  }, null, 2));
}

function cmdUpdateProfile(addJson) {
  const profile = loadJSON(PROFILE_FILE);
  if (!profile) {
    console.error('\u274c 本地画像不存在，请先执行 --init-profile');
    process.exit(1);
  }

  let addData;
  try {
    addData = JSON.parse(addJson);
  } catch (e) {
    console.error('\u274c JSON 解析失败:', e.message);
    process.exit(1);
  }

  const { field, value, action, sentiment } = addData;
  const op = action || 'add';

  if (field === 'notes') {
    const maxNotes = cfg('MAX_NOTES_CHARS');
    if (op === 'append') {
      const current = profile.notes || '';
      const newNotes = (current ? current + '\u00a7' : '') + value;
      profile.notes = newNotes.substring(0, maxNotes);
    } else if (op === 'replace') {
      profile.notes = (value || '').substring(0, maxNotes);
    } else if (op === 'remove') {
      const parts = (profile.notes || '').split('\u00a7');
      profile.notes = parts.filter(p => !p.includes(value)).join('\u00a7');
    } else {
      const current = profile.notes || '';
      const newNotes = (current ? current + '\u00a7' : '') + value;
      profile.notes = newNotes.substring(0, maxNotes);
    }
    profile.updated_at = new Date().toISOString();
    saveJSON(PROFILE_FILE, profile);
    console.log(JSON.stringify({ status: 'ok', updated_field: 'notes', operation: op, notes_length: (profile.notes || '').length, max: maxNotes }, null, 2));
    return;
  }

  const arrayFields = ['hard_interests', 'soft_interests', 'core_risk_avoidance'];
  const stringFields = ['search_dimensions', 'life_stage', 'industry_bg', 'city_tier', 'cognitive_style', 'tone'];
  const validFields = [...arrayFields, ...stringFields];

  if (!validFields.includes(field)) {
    console.error(`\u274c 不支持的字段: ${field}。支持: ${validFields.join(', ')}, notes`);
    process.exit(1);
  }

  let result = { action: op };

  if (arrayFields.includes(field)) {
    profile[field] = migrateInterests(profile[field]);

    if (op === 'remove') {
      const res = removeInterest(profile[field], value);
      profile[field] = res.interests;
      result.action = res.action;
    } else if (op === 'skeptical') {
      const target = findSimilarInterest(profile[field], value);
      if (target) {
        target.sentiment = 'skeptical';
        target.weight = Math.max(target.weight * 0.5, cfg('MIN_WEIGHT_THRESHOLD'));
        result.action = 'marked_skeptical';
      } else {
        result.action = 'not_found';
      }
    } else {
      const res = addInterest(profile[field], value, sentiment, {
        halfLife: cfg('DECAY_HALF_LIFE_DAYS'),
        minThreshold: cfg('MIN_WEIGHT_THRESHOLD'),
        maxPerCategory: cfg('MAX_INTERESTS_PER_CATEGORY'),
      });
      profile[field] = res.interests;
      result.action = res.action;
    }
  } else if (field === 'search_dimensions') {
    if (op === 'remove') {
      profile.search_dimensions = (profile.search_dimensions || []).filter(d => !d.includes(value));
    } else if (!profile.search_dimensions.includes(value)) {
      profile.search_dimensions.push(value);
    }
  } else {
    profile[field] = value;
  }

  profile.updated_at = new Date().toISOString();

  for (const f of arrayFields) {
    if (Array.isArray(profile[f]) && profile[f].length > 0 && typeof profile[f][0] === 'object') {
      profile[f] = decayWithConfig(profile[f]);
    }
  }

  if ([...arrayFields, 'industry_bg', 'life_stage'].includes(field)) {
    profile.search_dimensions = inferSearchDimensions(profile);
    profile.tone = inferTone(profile);
  }

  saveJSON(PROFILE_FILE, profile);
  console.log(JSON.stringify({
    status: 'ok',
    updated_field: field,
    value,
    operation: result.action,
    interests_count: {
      hard: (profile.hard_interests || []).length,
      soft: (profile.soft_interests || []).length,
      risk: (profile.core_risk_avoidance || []).length,
    },
  }, null, 2));
}

// --save-news: 保存新闻数据（v4.1: 直接保存，时效由搜索策略保障）
function cmdSaveNews(dataJson) {
  let data;
  try {
    data = JSON.parse(dataJson);
  } catch (e) {
    console.error('\u274c JSON 解析失败:', e.message);
    process.exit(1);
  }

  const today = getTodayStr();

  let archive = loadJSON(NEWS_FILE) || { days: {} };

  if (!archive.days[today]) {
    archive.days[today] = { batches: [] };
  }

  archive.days[today].batches.push({
    timestamp: new Date().toISOString(),
    news: data.news || [],
  });

  const retentionDays = cfg('NEWS_RETENTION_DAYS');
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  for (const dateKey of Object.keys(archive.days)) {
    if (new Date(dateKey) < cutoff) {
      delete archive.days[dateKey];
    }
  }

  saveJSON(NEWS_FILE, archive);

  const historyFile = path.join(HISTORY_DIR, today + '.json');
  saveJSON(historyFile, archive.days[today]);

  try {
    const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const fileDate = new Date(f.replace('.json', ''));
      if (fileDate < cutoff) {
        fs.unlinkSync(path.join(HISTORY_DIR, f));
      }
    }
  } catch (e) {
    console.error(`\u26a0\ufe0f 历史文件清理失败: ${e.message}`);
  }

  console.log(JSON.stringify({
    status: 'ok',
    date: today,
    batch_count: archive.days[today].batches.length,
    news_count: (data.news || []).length,
  }));
}

function cmdGetShownNews() {
  const shown = loadJSON(SHOWN_FILE) || { titles: [], last_updated: null };
  console.log(JSON.stringify(shown, null, 2));
}

function cmdMarkShown(titlesJson) {
  let titles;
  try {
    titles = JSON.parse(titlesJson);
  } catch (e) {
    console.error('\u274c JSON 解析失败:', e.message);
    process.exit(1);
  }

  let shown = loadJSON(SHOWN_FILE) || { titles: [], last_updated: null };

  const retentionDays = cfg('SHOWN_RETENTION_DAYS');
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  if (shown.last_updated && shown.last_updated < cutoff) {
    shown.titles = [];
  }

  for (const title of titles) {
    if (!shown.titles.includes(title)) {
      shown.titles.push(title);
    }
  }
  shown.last_updated = new Date().toISOString();

  saveJSON(SHOWN_FILE, shown);
  console.log(JSON.stringify({ status: 'ok', total_shown: shown.titles.length }));
}

function cmdDebugProfile() {
  const profile = loadJSON(PROFILE_FILE);
  if (!profile) {
    console.log('\u26a0\ufe0f 本地画像不存在');
    return;
  }
  console.log('=== 用户画像（调试） ===');
  console.log(JSON.stringify(profile, null, 2));
}

function cmdResetProfile() {
  if (fs.existsSync(PROFILE_FILE)) {
    fs.unlinkSync(PROFILE_FILE);
  }
  if (fs.existsSync(SHOWN_FILE)) {
    fs.unlinkSync(SHOWN_FILE);
  }
  console.log('\u2705 画像已重置');
}

function cmdGetHistory(dateStr) {
  if (dateStr) {
    const historyFile = path.join(HISTORY_DIR, dateStr + '.json');
    const data = loadJSON(historyFile);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(JSON.stringify({ error: `未找到 ${dateStr} 的历史数据` }));
    }
  } else {
    try {
      const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'));
      const dates = files.map(f => f.replace('.json', '')).sort().reverse();
      console.log(JSON.stringify({ dates }));
    } catch (e) {
      console.log(JSON.stringify({ dates: [] }));
    }
  }
}

function cmdDailyUpdate() {
  const profile = loadJSON(PROFILE_FILE);
  if (!profile) {
    console.log(JSON.stringify({ status: 'skip', reason: '画像不存在，跳过每日更新' }));
    return;
  }

  const today = getTodayStr();

  if (profile.updated_at) {
    const updatedDate = profile.updated_at.substring(0, 10);
    if (updatedDate === today) {
      profile.search_dimensions = inferSearchDimensions(profile);
      profile.tone = inferTone(profile);
      saveJSON(PROFILE_FILE, profile);
      console.log(JSON.stringify({
        status: 'already_updated_today',
        date: today,
        search_dimensions: profile.search_dimensions || [],
        hint: '今日已更新过，跳过重复衰减计算。搜索维度已重新推断。',
      }));
      return;
    }
  }

  const updateSummary = { decayed: [], boosted: [], removed: [], merged: [], date: today };

  const arrayFields = ['hard_interests', 'soft_interests', 'core_risk_avoidance'];
  for (const field of arrayFields) {
    const before = migrateInterests(profile[field] || []);
    const after = decayWithConfig(before);

    const afterTags = new Set(after.map(i => i.tag));
    for (const item of before) {
      if (!afterTags.has(item.tag)) {
        updateSummary.removed.push(item.tag);
      }
    }

    for (const item of after) {
      const oldItem = before.find(b => b.tag === item.tag);
      if (oldItem && item.weight < oldItem.weight) {
        updateSummary.decayed.push({ tag: item.tag, from: oldItem.weight, to: item.weight });
      }
    }

    profile[field] = after;
  }

  const normForMerge = s => s.replace(/与|和|\s/g, '').toLowerCase();
  for (const field of arrayFields) {
    const items = profile[field];
    if (items.length < 2) continue;
    const lowItems = items.filter(i => i.weight < 0.6).sort((a, b) => a.weight - b.weight);
    for (let i = 0; i < lowItems.length; i++) {
      for (let j = i + 1; j < lowItems.length; j++) {
        const a = normForMerge(lowItems[i].tag);
        const b = normForMerge(lowItems[j].tag);
        if (a.includes(b) || b.includes(a) || (a.length >= 4 && b.length >= 4 && a.substring(0, 2) === b.substring(0, 2))) {
          updateSummary.merged.push({
            from: [lowItems[i].tag, lowItems[j].tag],
            suggestion: `建议合并为一条：保留"${lowItems[i].weight >= lowItems[j].weight ? lowItems[i].tag : lowItems[j].tag}"，删除另一条`,
          });
        }
      }
    }
  }

  const shown = loadJSON(SHOWN_FILE) || { titles: [], last_updated: null };
  const todayNews = loadJSON(path.join(HISTORY_DIR, today + '.json'));

  const dimensionCounts = {};
  if (todayNews && todayNews.batches) {
    for (const batch of todayNews.batches) {
      for (const news of (batch.news || [])) {
        if (news.dimension) {
          dimensionCounts[news.dimension] = (dimensionCounts[news.dimension] || 0) + 1;
        }
      }
    }
  }

  const dailyBoost = cfg('BOOST_DAILY_FALLBACK');
  const boostThreshold = cfg('BOOST_DAILY_THRESHOLD');
  const boostMax = cfg('BOOST_MAX_WEIGHT');

  for (const [dim, count] of Object.entries(dimensionCounts)) {
    if (count >= boostThreshold) {
      const dimWords = dim.split(/[\s]+/).filter(w => w.length >= 2);

      for (const field of arrayFields) {
        for (const item of profile[field]) {
          const tagWords = item.tag.replace(/[与和]/g, ' ').split(/[\s]+/).filter(w => w.length >= 2);

          const matched = tagWords.some(tw =>
            dimWords.some(dw => dw.includes(tw) || tw.includes(dw))
          );

          if (matched) {
            const oldWeight = item.weight;
            item.weight = Math.min(item.weight + dailyBoost, boostMax);
            item.added_at = new Date().toISOString();
            if (item.weight > oldWeight) {
              updateSummary.boosted.push({ tag: item.tag, from: oldWeight, to: item.weight });
            }
          }
        }
      }
    }
  }

  profile.search_dimensions = inferSearchDimensions(profile);
  profile.tone = inferTone(profile);
  profile.updated_at = new Date().toISOString();

  const shownRetention = cfg('SHOWN_RETENTION_DAYS');
  if (shown.titles.length > 0) {
    const cutoff = new Date(Date.now() - shownRetention * 24 * 60 * 60 * 1000).toISOString();
    if (shown.last_updated && shown.last_updated < cutoff) {
      shown.titles = [];
      shown.last_updated = new Date().toISOString();
      saveJSON(SHOWN_FILE, shown);
    }
  }

  saveJSON(PROFILE_FILE, profile);

  console.log(JSON.stringify({
    status: 'ok',
    date: today,
    summary: {
      decayed_count: updateSummary.decayed.length,
      boosted_count: updateSummary.boosted.length,
      removed_count: updateSummary.removed.length,
      removed_tags: updateSummary.removed,
      boosted_tags: updateSummary.boosted.map(b => b.tag),
      merge_suggestions: updateSummary.merged,
      today_news_dimensions: dimensionCounts,
      total_interests: {
        hard: (profile.hard_interests || []).length,
        soft: (profile.soft_interests || []).length,
        risk: (profile.core_risk_avoidance || []).length,
      },
      notes: profile.notes || '',
      notes_length: (profile.notes || '').length,
    },
    search_dimensions: profile.search_dimensions,
    hint: '请根据以上统计：1）如果 removed 不为空，提示"某某兴趣因长期未提及已自动清理"；2）如果 merge_suggestions 不为空，请执行合并操作（--update-profile 先 remove 再 add）；3）如果你观察到正则无法覆盖的用户偏好，写入 notes（--update-profile --add \'{"field":"notes","value":"观察内容"}\'）。',
  }, null, 2));
}

function cmdBoostDimension(dim, amount) {
  if (!dim) {
    console.error('\u274c 需要提供 --dim 参数');
    process.exit(1);
  }

  const boostAmount = amount ? parseFloat(amount) : cfg('BOOST_CONVERSATION');
  if (isNaN(boostAmount) || boostAmount <= 0 || boostAmount > 1.0) {
    console.error('\u274c --amount 需要是 0~1.0 的数字');
    process.exit(1);
  }

  const profile = loadJSON(PROFILE_FILE);
  if (!profile) {
    console.log(JSON.stringify({ status: 'skip', reason: '画像不存在' }));
    return;
  }

  const today = getTodayStr();
  if (!profile._boosted_today) {
    profile._boosted_today = { date: today, dims: [] };
  }
  if (profile._boosted_today.date !== today) {
    profile._boosted_today = { date: today, dims: [] };
  }
  if (profile._boosted_today.dims.includes(dim)) {
    console.log(JSON.stringify({
      status: 'already_boosted',
      dim,
      hint: '该维度今天已 boost 过，跳过。',
    }));
    return;
  }

  const boostMax = cfg('BOOST_MAX_WEIGHT');
  const dimWords = dim.split(/[\s]+/).filter(w => w.length >= 2);
  const boosted = [];
  const arrayFields = ['hard_interests', 'soft_interests', 'core_risk_avoidance'];

  for (const field of arrayFields) {
    const items = migrateInterests(profile[field] || []);
    for (const item of items) {
      const tagWords = item.tag.replace(/[与和]/g, ' ').split(/[\s]+/).filter(w => w.length >= 2);
      const matched = tagWords.some(tw =>
        dimWords.some(dw => dw.includes(tw) || tw.includes(dw))
      );
      if (matched) {
        const oldWeight = item.weight;
        item.weight = Math.min(item.weight + boostAmount, boostMax);
        item.added_at = new Date().toISOString();
        boosted.push({ tag: item.tag, from: oldWeight, to: item.weight });
      }
    }
    profile[field] = items;
  }

  profile._boosted_today.dims.push(dim);
  saveJSON(PROFILE_FILE, profile);

  console.log(JSON.stringify({
    status: 'ok',
    dim,
    boosted,
    hint: boosted.length > 0
      ? `已对 ${boosted.length} 个相关兴趣 boost +${boostAmount}`
      : '未找到匹配的兴趣项，无操作。',
  }));
}

// ==================== 主入口 ====================
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printHelp();
    return;
  }


  if (args.includes('--get-profile')) {
    cmdGetProfile();
    return;
  }

  if (args.includes('--init-profile')) {
    const idx = args.indexOf('--input');
    const input = idx >= 0 ? args[idx + 1] : null;
    cmdInitProfile(input);
    return;
  }

  if (args.includes('--daily-update')) {
    cmdDailyUpdate();
    return;
  }

  if (args.includes('--boost-dimension')) {
    const dimIdx = args.indexOf('--dim');
    const dim = dimIdx >= 0 ? args[dimIdx + 1] : null;
    const amountIdx = args.indexOf('--amount');
    const amount = amountIdx >= 0 ? args[amountIdx + 1] : null;
    cmdBoostDimension(dim, amount);
    return;
  }

  if (args.includes('--update-profile')) {
    const idx = args.indexOf('--add');
    const addJson = idx >= 0 ? args[idx + 1] : null;
    if (!addJson) {
      console.error('\u274c 需要提供 --add 参数');
      process.exit(1);
    }
    cmdUpdateProfile(addJson);
    return;
  }

  if (args.includes('--save-news')) {
    const idx = args.indexOf('--data');
    const dataJson = idx >= 0 ? args[idx + 1] : null;
    if (!dataJson) {
      console.error('\u274c 需要提供 --data 参数');
      process.exit(1);
    }
    cmdSaveNews(dataJson);
    return;
  }

  if (args.includes('--get-shown-news')) {
    cmdGetShownNews();
    return;
  }

  if (args.includes('--mark-shown')) {
    const idx = args.indexOf('--titles');
    const titlesJson = idx >= 0 ? args[idx + 1] : null;
    if (!titlesJson) {
      console.error('\u274c 需要提供 --titles 参数');
      process.exit(1);
    }
    cmdMarkShown(titlesJson);
    return;
  }

  if (args.includes('--debug-profile')) {
    cmdDebugProfile();
    return;
  }

  if (args.includes('--reset-profile')) {
    cmdResetProfile();
    return;
  }

  if (args.includes('--get-history')) {
    const idx = args.indexOf('--get-history');
    const dateStr = args[idx + 1] && !args[idx + 1].startsWith('--') ? args[idx + 1] : null;
    cmdGetHistory(dateStr);
    return;
  }

  console.error(`\u274c 未知命令: ${args.join(' ')}`);
  printHelp();
  process.exit(1);
}

function printHelp() {
  const c = loadConfig();
  console.log(`
腾讯新闻搭子 (News Buddy) v4.1 — 画像与数据管理

命令:
  --get-profile                         查看当前画像
  --init-profile --input "描述"         初始化画像（基于用户自然语言，已有画像时合并保留）
  --daily-update                        画像衰减+boost（每次推送前调用，幂等每天最多一次）
  --save-news --data '<JSON>'           保存新闻数据
  --update-profile --add '{"field":"hard_interests","value":"量化交易"}'
                                        添加兴趣（近义词自动合并提权）
  --update-profile --add '{"field":"hard_interests","value":"区块链","action":"remove"}'
                                        移除兴趣（支持模糊匹配）
  --get-shown-news                      获取已展示的新闻标题
  --mark-shown --titles '["标题1"]'     标记新闻为已展示
  --boost-dimension --dim "维度" [--amount 0.15]
                                        即时 boost 某维度（对话中用户消费新闻时调用，当天幂等）
  --get-history [date]                  查看历史新闻（不指定日期则列出所有）
  --debug-profile                       查看完整画像（调试）
  --reset-profile                       重置画像和展示记录

画像更新特性:
  - 兴趣带权重（0~2.0）和时间戳，支持时间衰减（半衰期${c.DECAY_HALF_LIFE_DAYS}天）
  - 权重低于${c.MIN_WEIGHT_THRESHOLD}的兴趣自动清理
  - 每个类别最多保留${c.MAX_INTERESTS_PER_CATEGORY}个兴趣
  - 近义词自动检测合并（如"AI与大模型"和"大模型技术"不会重复添加）
  - 更新兴趣/行业/人生阶段时自动重推搜索维度和语气风格

示例:
  node news-buddy.cjs --init-profile --input "我是深圳的前端开发，有房贷，关注AI"
  node news-buddy.cjs --save-news --data '{"news":[{"title":"xx","source":"36kr","url":"https://36kr.com/p/xxx","date":"2026-06-15","dimension":"AI","relevance_score":8,"summary":"摘要"}]}'
  node news-buddy.cjs --daily-update
  node news-buddy.cjs --reset-profile
  `);
}

main();

// 导出供测试使用
module.exports = {
  desensitizeAge, desensitizeCity, desensitizeJob,
  inferTone, getTodayStr, loadJSON, saveJSON,
  extractInterests, findRegistryMatch, inferSearchDimensions,
  migrateInterests, interestTags, decayAndPrune,
  findSimilarInterest, addInterest, removeInterest,
};
