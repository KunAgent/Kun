// config.cjs — AI 新闻搭子 配置管理
// v3.0: 收拢所有业务常量，单一来源
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '.news-buddy-config.json');

const DEFAULT_CONFIG = {
  // === 兴趣权重管理 ===
  MAX_INTERESTS_PER_CATEGORY: 12,   // 每个兴趣类别最多保留
  DECAY_HALF_LIFE_DAYS: 30,         // 兴趣权重半衰期（天）
  MIN_WEIGHT_THRESHOLD: 0.15,       // 低于此权重的兴趣自动清理
  DEFAULT_WEIGHT: 1.0,              // 新增兴趣的默认权重
  BOOST_INCREMENT: 0.3,             // 重复提及的权重增幅

  // === 消费 boost ===
  BOOST_CONVERSATION: 0.15,         // 对话中即时 boost 幅度
  BOOST_DAILY_FALLBACK: 0.08,       // 每日兜底 boost 幅度
  BOOST_DAILY_THRESHOLD: 2,         // 当天消费 >=N 条才触发兜底 boost
  BOOST_MAX_WEIGHT: 2.0,            // 权重上限

  // === notes 字段 ===
  MAX_NOTES_CHARS: 2000,            // notes 自由文本上限

  // === 新闻管理 ===
  NEWS_RETENTION_DAYS: 7,           // 新闻保留天数
  NEWS_COUNT: 8,                    // 每次推荐新闻数量
  SEARCH_RECENCY_HOURS_CORE: 24,    // 核心内容搜索时效（小时）
  SEARCH_RECENCY_HOURS_SOFT: 72,    // 长尾兴趣搜索时效（小时）
  SEARCH_DIMENSIONS_MAX: 8,         // 搜索维度上限

  // === 画像维护 ===
  PROFILE_MAX_AGE_DAYS: 90,         // 画像自动清理（天）

  // === 已展示记录 ===
  SHOWN_RETENTION_DAYS: 3,          // 已展示标题保留天数

};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const saved = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...saved };
    }
  } catch (e) { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

function updateConfig(key, value) {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
  return config;
}

function checkConfig() {
  const config = loadConfig();
  return { config, missing: [], isComplete: true };
}

module.exports = { loadConfig, saveConfig, updateConfig, checkConfig, DEFAULT_CONFIG };
