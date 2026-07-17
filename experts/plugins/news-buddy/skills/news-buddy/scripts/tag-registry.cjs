#!/usr/bin/env node
// tag-registry.cjs — 兴趣标签提取与搜索维度推断
'use strict';

// ==================== 兴趣标签注册表 ====================
const INTEREST_REGISTRY = {
  // Hard interests
  'AI': 'AI与大模型', '大模型': 'AI与大模型', '人工智能': 'AI与大模型', 'LLM': 'AI与大模型',
  'agent': 'AI Agent工程', 'Agent': 'AI Agent工程', '智能体': 'AI Agent工程',
  'GEO': 'GEO与AI搜索引擎优化', '生成引擎优化': 'GEO与AI搜索引擎优化',
  '独立开发': '独立开发者', 'solopreneur': '独立开发者', '一人公司': '独立开发者',
  '编程': 'AI Coding实践', '写代码': 'AI Coding实践', 'Claude Code': 'AI Coding实践',
  '投资': '投资理财', '理财': '投资理财', '基金': '投资理财', '股票': '投资理财',
  '内容运营': '内容运营方法论', '新媒体': '内容运营方法论', '推荐算法': '内容运营方法论',
  '出海': '出海', 'SaaS': '出海',
  '半导体': '半导体', '芯片': '半导体',
  '云计算': '云计算',
  '越野跑': '跑步越野跑',
  '冲浪': '水上运动', '潜水': '水上运动', '风筝冲浪': '水上运动', '水肺': '水上运动', '自由潜': '水上运动',
  '钢笔': '钢笔文具手帐', '文具': '钢笔文具手帐',
  'EDC': 'EDC',
  '体育': '体育赛事',
  // Soft interests
  '手帐': '钢笔文具手帐', '笔记本': '钢笔文具手帐',
  '跑步': '跑步越野跑', '马拉松': '跑步越野跑',
  '王者荣耀': '王者荣耀', '游戏': '王者荣耀', '电竞': '王者荣耀',
  '猫咪': '宠物', '猫': '宠物',
  '美食': '美食烹饪', '烹饪': '美食烹饪',
  '思维模型': '思维模型与认知科学', '认知': '思维模型与认知科学',
  '人文': '人文社科', '社科': '人文社科',
  '播客': '播客',
  '影视': '影视娱乐',
  '运动': '运动健身', '健身': '运动健身',
  // Risk
  '房贷': '生活成本控制', '生活成本': '生活成本控制',
  '职业': '职业安全感', '裁员': '职业安全感',
  '隐私': '数据与隐私安全', '数据安全': '数据与隐私安全',
};

// ==================== 从自然语言中提取兴趣 ====================
function extractInterests(input) {
  if (!input) return { hard_interests: [], soft_interests: [], core_risk_avoidance: [] };

  const hardSet = new Set();
  const softSet = new Set();
  const riskSet = new Set();

  const hardKeywords = ['AI', '大模型', '人工智能', 'LLM', 'agent', 'Agent', '智能体',
    'GEO', '生成引擎', '独立开发', 'solopreneur', '编程', '写代码', 'Claude',
    '投资', '理财', '基金', '股票', '内容运营', '新媒体', '出海', 'SaaS',
    '半导体', '芯片', '云计算', '推荐算法',
    '越野跑', '冲浪', '潜水', '风筝冲浪', '水肺', '自由潜',
    '钢笔', '文具', 'EDC', '体育'];
  const softKeywords = ['手帐', '笔记本', '跑步', '马拉松', '王者荣耀', '游戏', '电竞',
    '猫咪', '猫', '美食', '烹饪', '思维模型', '认知', '人文', '社科',
    '播客', '影视', '运动', '健身'];
  const riskKeywords = ['房贷', '生活成本', '职业', '裁员', '隐私', '数据安全'];

  for (const kw of hardKeywords) {
    if (input.includes(kw)) {
      const mapped = INTEREST_REGISTRY[kw];
      if (mapped) hardSet.add(mapped);
    }
  }
  for (const kw of softKeywords) {
    if (input.includes(kw)) {
      const mapped = INTEREST_REGISTRY[kw];
      if (mapped) softSet.add(mapped);
    }
  }
  for (const kw of riskKeywords) {
    if (input.includes(kw)) {
      const mapped = INTEREST_REGISTRY[kw];
      if (mapped) riskSet.add(mapped);
    }
  }

  return {
    hard_interests: [...hardSet],
    soft_interests: [...softSet],
    core_risk_avoidance: [...riskSet],
  };
}

// ==================== 查找标签是否已存在于数组中 ====================
function findRegistryMatch(interests, tag) {
  if (!tag || !Array.isArray(interests)) return null;
  const normTag = tag.replace(/与|和|\s/g, '').toLowerCase();
  for (const item of interests) {
    const itemTag = typeof item === 'string' ? item : (item.tag || '');
    const normItem = itemTag.replace(/与|和|\s/g, '').toLowerCase();
    if (normItem === normTag || normItem.includes(normTag) || normTag.includes(normItem)) {
      return item;
    }
  }
  return null;
}

// ==================== 推断搜索维度 ====================
const DIMENSION_MAP = {
  'AI与大模型': 'AI人工智能 大模型 科技产业 最新进展',
  'AI Agent工程': 'AI Agent 自主智能体 多Agent 最新进展',
  'GEO与AI搜索引擎优化': 'GEO 生成引擎优化 AI搜索 引用机制',
  '独立开发者': '独立开发者 SaaS 小产品 出海 ProductHunt',
  'AI Coding实践': 'AI Coding Claude Code Copilot 开发工具',
  '内容运营方法论': '内容运营 新媒体 分发策略 推荐算法',
  '内容运营': '内容运营 新媒体 分发策略 推荐算法',
  '内容行业趋势': '内容行业 新媒体 AI 趋势 分发',
  '出海': '出海 SaaS 中国企业全球化 趋势',
  '半导体': '半导体 芯片 硬科技 突破',
  '云计算': '云计算 SaaS 企业服务 趋势',
  '投资理财': '投资理财 资产配置 经济趋势',
  '钢笔文具手帐': '钢笔 文具 手帐 文创 墨水',
  '钢笔文具': '钢笔 文具 手帐 文创 墨水',
  '国产老钢笔品牌历史': '钢笔 国产 文具 品牌 历史 文创',
  '跑步越野跑': '越野跑 越野赛 ultra 赛事 装备',
  '越野跑': '越野跑 越野赛 ultra 赛事 装备',
  '水上运动': '潜水 自由潜 冲浪 水上运动 装备',
  '风筝冲浪': '风筝冲浪 冲浪 装备 进展 地点',
  '水肺潜水OW': '潜水 水肺潜水 装备 考证',
  '自由潜二星': '自由潜 潜水 装备 考证',
  '王者荣耀': '王者荣耀 MOBA 电竞 版本更新 新英雄',
  '思维模型与认知科学': '思维模型 认知科学 心理学 决策',
  '人文社科': '人文 社科 文化 历史 思想',
  '播客': '播客 中文播客 音频 节目推荐',
  '美食烹饪': '美食 烹饪 食谱 餐厅',
  '影视娱乐': '影视 剧集 电影 综艺',
  '宠物': '宠物 猫 养猫 萌宠',
  '运动健身': '运动 健身 训练 装备',
  '体育赛事': '体育 赛事 NBA 足球',
  'EDC': 'EDC 随身物件 数码 精品',
};

function inferSearchDimensions(profile) {
  const dims = [];
  const riskTags = (profile.core_risk_avoidance || []).map(i => typeof i === 'string' ? i : (i.tag || ''));

  // 按权重排序所有兴趣，生成搜索维度
  const allInterests = [
    ...(profile.hard_interests || []).map(i => ({ ...i, category: 'hard' })),
    ...(profile.soft_interests || []).map(i => ({ ...i, category: 'soft' })),
  ].sort((a, b) => (b.weight || 0) - (a.weight || 0));

  for (const interest of allInterests) {
    const tag = interest.tag || interest;
    if (DIMENSION_MAP[tag] && !dims.includes(DIMENSION_MAP[tag])) {
      dims.push(DIMENSION_MAP[tag]);
    }
  }

  // Risk dimensions
  for (const tag of riskTags) {
    if (tag.includes('生活成本') || tag.includes('房贷')) {
      if (!dims.some(d => d.includes('生活成本'))) dims.push('物价 通勤 油价 生活成本');
    }
    if (tag.includes('职业')) {
      if (!dims.some(d => d.includes('职场'))) dims.push('就业市场 职场趋势 人才需求');
    }
    if (tag.includes('数据') || tag.includes('隐私')) {
      if (!dims.some(d => d.includes('数据安全'))) dims.push('数据安全 隐私保护 信息安全');
    }
  }

  return dims.slice(0, 12);
}

module.exports = {
  extractInterests, findRegistryMatch, inferSearchDimensions,
};
