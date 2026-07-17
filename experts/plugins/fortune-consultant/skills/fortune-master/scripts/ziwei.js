#!/usr/bin/env node
/**
 * 紫微斗数命盘分析 v4 - 知识库驱动格局 + 大运流年 + 八字用神
 * 使用 iztro 库（中文紫微斗数）
 */

const fs = require('fs');
const path = require('path');
const { astro } = require('iztro');

// ============================================================
// 知识库格局匹配系统
// ============================================================

const KNOWLEDGE_DIR = process.env.OPENCLAW_KNOWLEDGE_DIR
  || (process.env.HOME ? path.join(process.env.HOME, '.openclaw/workspace/knowledge') : '');

/**
 * 解析知识库中的格局文件，构建模式检测规则
 */
function buildPatternRules() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) return [];

  const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.md'));
  const rules = [];
  const skipNames = [
    '倪海厦', '渊海子平', '滴天髓', '命理交叉', '排盘不准',
    '命运解读', '算卦', 'Jia-八字', '紫微斗数格局', '四化表',
    '紫微斗数基本术语', '紫微斗数与奇门遁甲', '星平会海',
    '渊海子平-学习', '滴天髓-子平真诠', '命理交叉验证系统'
  ];

  for (const file of files) {
    if (skipNames.some(n => file.includes(n))) continue;
    const filePath = path.join(KNOWLEDGE_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const name = file.replace('.md', '');

    const rule = parsePatternFile(name, content);
    if (rule) rules.push(rule);
  }

  return rules;
}

/**
 * 解析单个格局文件，提取检测条件
 */
function parsePatternFile(name, content) {
  // 提取吉星加会条件
  const luckyStars = [];
  if (content.includes('禄存')) luckyStars.push('禄存');
  if (content.includes('科权禄') || content.includes('化禄') && content.includes('化权') && content.includes('化科')) {
    luckyStars.push('科', '权', '科权禄');
  }
  if (content.includes('左右')) { luckyStars.push('左辅', '右弼'); }
  if (content.includes('昌曲') || content.includes('文昌') || content.includes('文曲')) {
    luckyStars.push('文昌', '文曲');
  }
  if (content.includes('魁钺') || content.includes('天魁') || content.includes('天钺')) {
    luckyStars.push('天魁', '天钺');
  }

  // 判断格局等级
  let level = '平';
  if (content.includes('大富大贵') || content.includes('极美') || content.includes('极贵')) level = '贵';
  else if (content.includes('富贵') || content.includes('大富') || content.includes('大贵')) level = '富';
  else if (content.includes('凶') || content.includes('刑') || content.includes('破格')) level = '凶';
  else if (content.includes('平常') || content.includes('普通')) level = '平';

  // 提取星曜条件
  const mainStars = [];
  const starMatches = content.match(/[\u4e00-\u9fa5]{2,4}(?:星|门|府|相|杀|狼|军|曲|昌|梁|机|阴|阳|同|贞|府|微)/g);
  if (starMatches) {
    const uniqueStars = [...new Set(starMatches.map(s => s.slice(0, 2)))];
    const knownStars = ['紫微','天机','太阳','武曲','天同','廉贞','天府','贪狼','巨门','太阴','天相','天梁','七杀','破军',
      '文昌','文曲','左辅','右弼','天魁','天钺','禄存','天马','擎羊','陀罗','火星','铃星','地空','地劫','解神','天虚','天喜','红鸾'];
    for (const s of uniqueStars) {
      if (knownStars.includes(s)) mainStars.push(s);
    }
  }

  // 提取宫位条件
  const branches = [];
  const branchKeywords = ['子','午','寅','申','卯','酉','辰','戌','丑','未','巳','亥','寅申','子午','辰戌','丑未','卯酉','巳亥'];
  for (const kw of branchKeywords) {
    if (content.includes(kw) && kw.length >= 1) {
      if (kw.length === 1) branches.push(kw);
      else branches.push(kw);
    }
  }

  // 提取年干条件
  const yearStems = [];
  if (content.includes('甲年') || content.includes('甲年生')) yearStems.push('甲');
  if (content.includes('乙年') || content.includes('乙年生')) yearStems.push('乙');
  if (content.includes('丙年') || content.includes('丙年生')) yearStems.push('丙');
  if (content.includes('丁年') || content.includes('丁年生')) yearStems.push('丁');
  if (content.includes('戊年') || content.includes('戊年生')) yearStems.push('戊');
  if (content.includes('己年') || content.includes('己年生')) yearStems.push('己');
  if (content.includes('庚年') || content.includes('庚年生')) yearStems.push('庚');
  if (content.includes('辛年') || content.includes('辛年生')) yearStems.push('辛');
  if (content.includes('壬年') || content.includes('壬年生')) yearStems.push('壬');
  if (content.includes('癸年') || content.includes('癸年生')) yearStems.push('癸');

  // 提取四化条件
  const mutagens = [];
  if (content.includes('化禄')) mutagens.push('禄');
  if (content.includes('化权')) mutagens.push('权');
  if (content.includes('化科')) mutagens.push('科');
  if (content.includes('化忌')) mutagens.push('忌');

  // 提取三方四正条件
  const sanfang = content.includes('三方四正') || content.includes('三合');

  // 提取夹的条件（邻宫）
  const adjacent = content.includes('夹命') || content.includes('相夹');

  // 提取凶格标志
  const isJiong = content.includes('凶格') || content.includes('刑') || content.includes('破格');

  // 提取描述
  let desc = '';
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('*') && !trimmed.startsWith('---') && trimmed.length > 5 && trimmed.length < 100) {
      if (trimmed.includes('大富大贵') || trimmed.includes('福寿') || trimmed.includes('贵气') || 
          trimmed.includes('少年') || trimmed.includes('劳碌') || trimmed.includes('平常') ||
          trimmed.includes('大富') || trimmed.includes('大贵') || trimmed.includes('先贫后富')) {
        desc = trimmed.replace(/[#*]/g, '').trim();
        break;
      }
    }
  }
  if (!desc) {
    for (const line of lines) {
      const trimmed = line.replace(/[#*]/g, '').trim();
      if (trimmed.length > 5 && trimmed.length < 80 && !trimmed.startsWith('-') && !trimmed.startsWith('|')) {
        desc = trimmed;
        break;
      }
    }
  }

  // 判断宫位条件类型
  let palaceCondition = 'ming'; // 默认命宫
  if (content.includes('命宫三方') || content.includes('三方') || sanfang) palaceCondition = 'sanfang';
  if (content.includes('命宫') && content.includes('邻宫') && adjacent) palaceCondition = 'adjacent';
  if (content.includes('命身宫入丑未') || content.includes('命身宫')) palaceCondition = 'mingBody';

  return {
    name,
    level,
    stars: mainStars,
    branches,
    yearStems,
    mutagens,
    luckyStars,
    palaceCondition, // ming | sanfang | adjacent | mingBody
    isJiong,
    desc: desc.substring(0, 80)
  };
}

/**
 * 使用知识库规则检测命盘格局
 */
function checkPatternsFromKnowledge(palaces, mingIdx, transforms, yearStem) {
  const rules = buildPatternRules();
  const results = [];

  // 构建命宫、三方四正、邻宫数据
  const mingPalace = palaces[mingIdx];
  const mingBranch = mingPalace?.earthlyBranch || '';
  const mingStars = mingPalace?.majorStars?.map(s => s.name) || [];
  const mingMinor = mingPalace?.minorStars?.map(s => s.name) || [];
  const mingAdj = mingPalace?.adjectiveStars?.map(s => s.name) || [];
  const allMingStars = [...mingStars, ...mingMinor, ...mingAdj];

  // 三方四正
  const opposite = (mingIdx + 6) % 12;
  const tri1 = (mingIdx + 4) % 12;
  const tri2 = (mingIdx + 8) % 12;
  const sanfangPalaces = [palaces[opposite], palaces[tri1], palaces[tri2]];
  const sanfangStars = sanfangPalaces.flatMap(p => [
    ...(p?.majorStars?.map(s => s.name) || []),
    ...(p?.minorStars?.map(s => s.name) || []),
    ...(p?.adjectiveStars?.map(s => s.name) || [])
  ]);
  const allSanfangStars = [...allMingStars, ...sanfangStars];

  // 邻宫
  const prevIdx = (mingIdx - 1 + 12) % 12;
  const nextIdx = (mingIdx + 1) % 12;
  const prevStars = [
    ...(palaces[prevIdx]?.majorStars?.map(s => s.name) || []),
    ...(palaces[prevIdx]?.minorStars?.map(s => s.name) || [])
  ];
  const nextStars = [
    ...(palaces[nextIdx]?.majorStars?.map(s => s.name) || []),
    ...(palaces[nextIdx]?.minorStars?.map(s => s.name) || [])
  ];

  // 四化星
  const transformMap = {};
  transforms.forEach(t => { transformMap[t.star] = t.hua; });

  for (const rule of rules) {
    try {
      if (!rule.stars || rule.stars.length === 0) continue;

      let matched = false;
      let matchType = '';

      // 主星检查
      const requiredStars = rule.stars.filter(s => {
        const main14 = ['紫微','天机','太阳','武曲','天同','廉贞','天府','贪狼','巨门','太阴','天相','天梁','七杀','破军',
          '文昌','文曲','左辅','右弼','天魁','天钺','禄存','天马','擎羊','陀罗','火星','铃星','地空','地劫'];
        return main14.includes(s);
      });

      if (requiredStars.length === 0) continue;

      if (rule.palaceCondition === 'ming' || rule.palaceCondition === 'mingBody') {
        // 命宫/命身宫检查
        if (requiredStars.every(s => allMingStars.includes(s))) {
          matched = true;
          matchType = '命宫';
        }
      } else if (rule.palaceCondition === 'sanfang') {
        // 三方四正检查
        if (requiredStars.every(s => allSanfangStars.includes(s))) {
          matched = true;
          matchType = '三方四正';
        }
      } else if (rule.palaceCondition === 'adjacent') {
        // 邻宫夹命检查
        const prevHas = requiredStars.some(s => prevStars.includes(s));
        const nextHas = requiredStars.some(s => nextStars.includes(s));
        if (prevHas && nextHas) {
          matched = true;
          matchType = '邻宫夹命';
        }
      } else {
        // 默认：命宫优先，三方四正次之
        if (requiredStars.every(s => allMingStars.includes(s))) {
          matched = true;
          matchType = '命宫';
        } else if (requiredStars.every(s => allSanfangStars.includes(s))) {
          matched = true;
          matchType = '三方四正';
        }
      }

      // 年干条件
      if (matched && rule.yearStems && rule.yearStems.length > 0) {
        if (!rule.yearStems.includes(yearStem)) {
          matched = false;
        }
      }

      // 宫位地支条件
      if (matched && rule.branches && rule.branches.length > 0) {
        const validBranch = rule.branches.some(b => {
          if (b.length === 1) return mingBranch === b;
          // 处理双地支如寅申
          return b.split('').some(c => mingBranch === c);
        });
        if (!validBranch) matched = false;
      }

      // 吉星加会条件
      if (matched && rule.luckyStars && rule.luckyStars.length > 0) {
        const hasLucky = rule.luckyStars.every(s => allSanfangStars.includes(s));
        if (!hasLucky) {
          // 降级：记录为弱匹配
          matchType += '(吉星不足)';
        }
      }

      if (matched) {
        results.push({
          name: rule.name,
          level: rule.level,
          desc: rule.desc,
          matchType
        });
      }
    } catch (e) {
      // Skip failed rules silently
    }
  }

  return results;
}

// ============================================================
// 十四主星、六煞星等定义
// ============================================================

const MAIN_STARS = ['紫微','天机','太阳','武曲','天同','廉贞','天府','贪狼','巨门','太阴','天相','天梁','七杀','破军'];
const LUCKY_STARS = ['左辅','右弼','天魁','天钺','文昌','文曲','禄存','天马'];
const UNLUCKY_STARS = ['擎羊','陀罗','火星','铃星','地空','地劫'];
const PEACH_STARS = ['贪狼','廉贞','红鸾','天喜','桃花','天姚'];
const WEALTH_STARS = ['武曲','太阴','天府','禄存','紫微','天相'];

// ============================================================
// 八字用神核心算法（穷通宝鉴 + 子平真诠）
// ============================================================

// 天干五行
const STEM_ELEMENT = { '甲': '木', '乙': '木', '丙': '火', '丁': '火', '戊': '土', '己': '土', '庚': '金', '辛': '金', '壬': '水', '癸': '水' };
const STEM_YINYANG = { '甲': '阳', '乙': '阴', '丙': '阳', '丁': '阴', '戊': '阳', '己': '阴', '庚': '阳', '辛': '阴', '壬': '阳', '癸': '阴' };
const ELEMENT_PRODUCES = { '木': '水', '火': '木', '土': '火', '金': '土', '水': '金' };
const ELEMENT_RESTRAINS = { '木': '金', '火': '水', '土': '木', '金': '火', '水': '土' };
const ELEMENT_SHENG = { '木': '火', '火': '土', '土': '金', '金': '水', '水': '木' };
const ELEMENT_KE = { '木': '土', '火': '金', '土': '水', '金': '木', '水': '火' };
const ELEMENT_BI = { '木': '金', '火': '水', '土': '木', '金': '火', '水': '土' };

// 地支藏干（主气、中气、余气）
const BRANCH_HIDDEN = {
  '子': { '主气': '癸', '中气': '壬', '余气': '辛' },
  '丑': { '主气': '己', '中气': '辛', '余气': '癸' },
  '寅': { '主气': '甲', '中气': '丙', '余气': '戊' },
  '卯': { '主气': '乙', '中气': '甲', '余气': '壬' },
  '辰': { '主气': '戊', '中气': '乙', '余气': '癸' },
  '巳': { '主气': '丙', '中气': '庚', '余气': '戊' },
  '午': { '主气': '丁', '中气': '己', '余气': '乙' },
  '未': { '主气': '己', '中气': '丁', '余气': '乙' },
  '申': { '主气': '庚', '中气': '壬', '余气': '戊' },
  '酉': { '主气': '辛', '中气': '庚', '余气': '丁' },
  '戌': { '主气': '戊', '中气': '辛', '余气': '丁' },
  '亥': { '主气': '壬', '中气': '甲', '余气': '戊' }
};
const HIDDEN_WEIGHT = { '主气': 1.0, '中气': 0.5, '余气': 0.3 };

// 地支藏干旺衰权重
const BRANCH_HIDDEN_WEIGHT = { '主气': 1.0, '中气': 0.5, '余气': 0.3 };

// 月令旺衰表（子平真诠）
const MONTH_STRENGTH = {
  '寅': { '甲': 100, '乙': 80, '丙': 70, '丁': 60, '戊': 50, '己': 40, '庚': 30, '辛': 20, '壬': 10, '癸': 0 },
  '卯': { '甲': 80, '乙': 100, '丙': 60, '丁': 70, '戊': 40, '己': 50, '庚': 20, '辛': 30, '壬': 10, '癸': 0 },
  '辰': { '甲': 60, '乙': 70, '丙': 70, '丁': 80, '戊': 70, '己': 80, '庚': 50, '辛': 60, '壬': 40, '癸': 50 },
  '巳': { '甲': 30, '乙': 40, '丙': 100, '丁': 80, '戊': 60, '己': 50, '庚': 40, '辛': 30, '壬': 10, '癸': 0 },
  '午': { '甲': 20, '乙': 30, '丙': 80, '丁': 100, '戊': 50, '己': 60, '庚': 30, '辛': 40, '壬': 0, '癸': 10 },
  '未': { '甲': 50, '乙': 60, '丙': 60, '丁': 70, '戊': 70, '己': 80, '庚': 50, '辛': 60, '壬': 20, '癸': 30 },
  '申': { '甲': 20, '乙': 10, '丙': 30, '丁': 40, '戊': 50, '己': 60, '庚': 100, '辛': 80, '壬': 70, '癸': 50 },
  '酉': { '甲': 10, '乙': 20, '丙': 20, '丁': 30, '戊': 40, '己': 50, '庚': 80, '辛': 100, '壬': 50, '癸': 70 },
  '戌': { '甲': 50, '乙': 60, '丙': 70, '丁': 80, '戊': 70, '己': 80, '庚': 50, '辛': 60, '壬': 40, '癸': 50 },
  '亥': { '甲': 70, '乙': 60, '丙': 20, '丁': 30, '戊': 30, '己': 40, '庚': 10, '辛': 20, '壬': 100, '癸': 80 },
  '子': { '甲': 50, '乙': 40, '丙': 10, '丁': 20, '戊': 20, '己': 30, '庚': 0, '辛': 10, '壬': 80, '癸': 100 },
  '丑': { '甲': 40, '乙': 50, '丙': 50, '丁': 60, '戊': 60, '己': 70, '庚': 50, '辛': 60, '壬': 50, '癸': 60 }
};

// 通根加分表
const TONGGEN_BONUS = {
  '甲': { '寅': 50, '卯': 40, '亥': 20, '子': 0, '辰': 10, '未': 10, '戌': 10, '丑': 5 },
  '乙': { '卯': 50, '寅': 30, '亥': 10, '子': 20, '辰': 10, '未': 15, '戌': 10, '丑': 10 },
  '丙': { '巳': 50, '午': 40, '寅': 20, '卯': 10, '申': 0, '酉': 0, '辰': 5, '戌': 10, '丑': 5 },
  '丁': { '午': 50, '巳': 30, '未': 15, '戌': 10, '寅': 10, '酉': 0, '申': 0, '辰': 5, '丑': 5 },
  '戊': { '巳': 20, '午': 30, '辰': 40, '戌': 40, '丑': 30, '寅': 5, '卯': 5, '申': 0, '酉': 0, '亥': 0, '子': 0 },
  '己': { '午': 20, '巳': 10, '辰': 30, '戌': 30, '丑': 40, '寅': 5, '卯': 5, '申': 0, '酉': 0, '亥': 5, '子': 5 },
  '庚': { '申': 50, '酉': 40, '辰': 15, '戌': 15, '丑': 20, '寅': 0, '卯': 0, '巳': 0, '午': 0, '亥': 0, '子': 0 },
  '辛': { '酉': 50, '申': 30, '辰': 10, '戌': 10, '丑': 15, '寅': 0, '卯': 0, '巳': 0, '午': 0, '亥': 0, '子': 0 },
  '壬': { '亥': 50, '子': 40, '申': 20, '酉': 10, '辰': 10, '戌': 10, '丑': 15, '寅': 0, '卯': 0, '巳': 0, '午': 0 },
  '癸': { '子': 50, '亥': 40, '丑': 20, '辰': 10, '戌': 10, '申': 5, '酉': 5, '寅': 0, '卯': 0, '巳': 0, '午': 0 }
};

// 穷通宝鉴调候用神表（完整版）
const TIAO_HOU_TABLE = {
  // === 甲木日主 ===
  '甲寅': { 主用神: ['丙', '癸'], 优先级: '丙先癸后', 忌神: '庚', 说明: '寅月木寒，丙火为君，癸水为佐' },
  '甲卯': { 主用神: ['丁', '丙'], 优先级: '丁先', 忌神: '庚', 说明: '卯月木旺，丁火泄秀，忌金' },
  '甲辰': { 主用神: ['庚', '丁'], 优先级: '庚先丁后', 忌神: '癸', 说明: '辰月土旺，先庚后丁' },
  '甲巳': { 主用神: ['癸', '丁'], 优先级: '癸先丁后', 忌神: '庚', 说明: '巳月火旺，癸水调候' },
  '甲午': { 主用神: ['癸', '壬'], 优先级: '癸先', 忌神: '丁', 说明: '午月火旺，水为调候' },
  '甲未': { 主用神: ['丁', '庚'], 优先级: '丁先', 忌神: '癸', 说明: '未月土月，用丁庚' },
  '甲申': { 主用神: ['庚', '丁'], 优先级: '庚先丁后', 忌神: '癸', 说明: '申月金旺，庚劈甲引丁' },
  '甲酉': { 主用神: ['丁', '丙'], 优先级: '丁先丙后', 忌神: '庚', 说明: '酉月金旺，丁火制金' },
  '甲戌': { 主用神: ['庚', '丁'], 优先级: '庚先丁后', 忌神: '癸', 说明: '戌月金土，用庚丁' },
  '甲亥': { 主用神: ['丙', '戊'], 优先级: '丙先戊后', 忌神: '庚', 说明: '亥月水冷，丙火调候' },
  '甲子': { 主用神: ['丙', '戊'], 优先级: '丙先戊后', 忌神: '庚', 说明: '子月水寒，丙戊并用' },
  '甲丑': { 主用神: ['丁', '丙'], 优先级: '丁先丙后', 忌神: '辛', 说明: '丑月寒湿，丁火暖局' },
  // === 乙木日主 ===
  '乙寅': { 主用神: ['丙', '癸'], 优先级: '丙先癸后', 忌神: '辛', 说明: '寅月木寒，丙癸双清' },
  '乙卯': { 主用神: ['丙', '癸'], 优先级: '丙先癸后', 忌神: '辛', 说明: '卯月木旺，丙癸调候' },
  '乙辰': { 主用神: ['癸', '丙'], 优先级: '癸先丙后', 忌神: '乙', 说明: '辰月湿土，癸水润乙' },
  '乙巳': { 主用神: ['癸', '丙'], 优先级: '癸先丙后', 忌神: '辛', 说明: '巳月火旺，癸水调候' },
  '乙午': { 主用神: ['癸', '壬'], 优先级: '癸先', 忌神: '丙', 说明: '午月火旺，癸水制火' },
  '乙未': { 主用神: ['丙', '癸'], 优先级: '丙先癸后', 忌神: '乙', 说明: '未月土月，丙癸并用' },
  '乙申': { 主用神: ['丙', '癸'], 优先级: '丙先癸后', 忌神: '辛', 说明: '申月金旺，丙癸并用' },
  '乙酉': { 主用神: ['丙', '癸'], 优先级: '丙先癸后', 忌神: '辛', 说明: '酉月金旺，丙火制金' },
  '乙戌': { 主用神: ['癸', '辛'], 优先级: '癸先辛后', 忌神: '丙', 说明: '戌月燥土，癸水润局' },
  '乙亥': { 主用神: ['丙', '戊'], 优先级: '丙先戊后', 忌神: '辛', 说明: '亥月水冷，丙戊暖局' },
  '乙子': { 主用神: ['丙', '戊'], 优先级: '丙先戊后', 忌神: '辛', 说明: '子月水寒，丙戊调候' },
  '乙丑': { 主用神: ['丙', '丁'], 优先级: '丙先丁后', 忌神: '辛', 说明: '丑月寒湿，丙丁暖局' },
  // === 丙火日主 ===
  '丙寅': { 主用神: ['壬', '庚'], 优先级: '壬先庚后', 忌神: '癸', 说明: '寅月木火，壬水通月令' },
  '丙卯': { 主用神: ['壬', '癸'], 优先级: '壬先癸后', 忌神: '甲', 说明: '卯月木旺，壬癸制火' },
  '丙辰': { 主用神: ['壬', '庚'], 优先级: '壬先庚后', 忌神: '戊', 说明: '辰月湿土，壬水通根' },
  '丙巳': { 主用神: ['壬', '癸'], 优先级: '壬先癸后', 忌神: '戊', 说明: '巳月火旺，壬水为用' },
  '丙午': { 主用神: ['壬', '癸'], 优先级: '壬先癸后', 忌神: '丙', 说明: '午月火旺极，壬水调候' },
  '丙未': { 主用神: ['壬', '庚'], 优先级: '壬先庚后', 忌神: '己', 说明: '未月土月，壬庚并用' },
  '丙申': { 主用神: ['壬', '癸'], 优先级: '壬先癸后', 忌神: '庚', 说明: '申月金水，壬水通根' },
  '丙酉': { 主用神: ['壬', '癸'], 优先级: '壬先癸后', 忌神: '辛', 说明: '酉月金旺，壬癸制火' },
  '丙戌': { 主用神: ['壬', '甲'], 优先级: '壬先甲后', 忌神: '丁', 说明: '戌月土金，壬甲并用' },
  '丙亥': { 主用神: ['甲', '壬'], 优先级: '甲先壬后', 忌神: '辛', 说明: '亥月水冷，甲木生火' },
  '丙子': { 主用神: ['甲', '壬'], 优先级: '甲先壬后', 忌神: '癸', 说明: '子月水旺，甲木生丙' },
  '丙丑': { 主用神: ['壬', '甲'], 优先级: '壬先甲后', 忌神: '己', 说明: '丑月寒湿，壬甲暖局' },
  // === 丁火日主 ===
  '丁寅': { 主用神: ['甲', '丙'], 优先级: '甲先丙后', 忌神: '壬', 说明: '寅月木旺，甲木生丁' },
  '丁卯': { 主用神: ['甲', '丙'], 优先级: '甲先丙后', 忌神: '癸', 说明: '卯月木旺，甲丙生丁' },
  '丁辰': { 主用神: ['甲', '庚'], 优先级: '甲先庚后', 忌神: '癸', 说明: '辰月土月，甲庚并用' },
  '丁巳': { 主用神: ['甲', '庚'], 优先级: '甲先庚后', 忌神: '戊', 说明: '巳月火旺，甲庚制火' },
  '丁午': { 主用神: ['壬', '癸'], 优先级: '壬先癸后', 忌神: '丁', 说明: '午月火旺，壬癸调候' },
  '丁未': { 主用神: ['甲', '庚'], 优先级: '甲先庚后', 忌神: '丁', 说明: '未月土月，甲庚并用' },
  '丁申': { 主用神: ['甲', '丙'], 优先级: '甲先丙后', 忌神: '壬', 说明: '申月金旺，甲丙生丁' },
  '丁酉': { 主用神: ['甲', '丙'], 优先级: '甲先丙后', 忌神: '癸', 说明: '酉月金旺，甲丙生丁' },
  '丁戌': { 主用神: ['甲', '壬'], 优先级: '甲先壬后', 忌神: '丁', 说明: '戌月燥土，壬水润局' },
  '丁亥': { 主用神: ['甲', '庚'], 优先级: '甲先庚后', 忌神: '壬', 说明: '亥月水冷，甲庚暖局' },
  '丁子': { 主用神: ['甲', '庚'], 优先级: '甲先庚后', 忌神: '癸', 说明: '子月水寒，甲庚暖局' },
  '丁丑': { 主用神: ['甲', '庚'], 优先级: '甲先庚后', 忌神: '癸', 说明: '丑月寒湿，甲庚暖局' },
  // === 戊土日主 ===
  '戊寅': { 主用神: ['丙', '甲'], 优先级: '丙先甲后', 忌神: '壬', 说明: '寅月木旺，丙甲并用' },
  '戊卯': { 主用神: ['丙', '甲'], 优先级: '丙先甲后', 忌神: '壬', 说明: '卯月木旺，丙甲并用' },
  '戊辰': { 主用神: ['丙', '癸'], 优先级: '丙先癸后', 忌神: '甲', 说明: '辰月湿土，丙癸调候' },
  '戊巳': { 主用神: ['丙', '癸'], 优先级: '丙先癸后', 忌神: '甲', 说明: '巳月火旺，丙癸并用' },
  '戊午': { 主用神: ['壬', '癸'], 优先级: '壬先癸后', 忌神: '丙', 说明: '午月火旺极，壬癸调候' },
  '戊未': { 主用神: ['癸', '丙'], 优先级: '癸先丙后', 忌神: '己', 说明: '未月土月，癸水润局' },
  '戊申': { 主用神: ['丙', '丁'], 优先级: '丙先丁后', 忌神: '壬', 说明: '申月金旺，丙丁暖局' },
  '戊酉': { 主用神: ['丙', '丁'], 优先级: '丙先丁后', 忌神: '癸', 说明: '酉月金旺，丙丁暖局' },
  '戊戌': { 主用神: ['甲', '丁'], 优先级: '甲先丁后', 忌神: '壬', 说明: '戌月燥土，甲丁调候' },
  '戊亥': { 主用神: ['丙', '甲'], 优先级: '丙先甲后', 忌神: '壬', 说明: '亥月水冷，丙甲暖局' },
  '戊子': { 主用神: ['丙', '甲'], 优先级: '丙先甲后', 忌神: '壬', 说明: '子月水寒，丙甲暖局' },
  '戊丑': { 主用神: ['丙', '甲'], 优先级: '丙先甲后', 忌神: '癸', 说明: '丑月寒湿，丙甲暖局' },
  // === 己土日主 ===
  '己寅': { 主用神: ['丙', '癸'], 优先级: '丙先癸后', 忌神: '甲', 说明: '寅月木旺，丙癸暖局' },
  '己卯': { 主用神: ['丙', '癸'], 优先级: '丙先癸后', 忌神: '甲', 说明: '卯月木旺，丙癸暖局' },
  '己辰': { 主用神: ['丙', '癸'], 优先级: '丙先癸后', 忌神: '乙', 说明: '辰月湿土，丙癸调候' },
  '己巳': { 主用神: ['癸', '丙'], 优先级: '癸先丙后', 忌神: '甲', 说明: '巳月火旺，癸水润局' },
  '己午': { 主用神: ['癸', '壬'], 优先级: '癸先壬后', 忌神: '丙', 说明: '午月火旺，癸壬调候' },
  '己未': { 主用神: ['癸', '丙'], 优先级: '癸先丙后', 忌神: '己', 说明: '未月土月，癸水润局' },
  '己申': { 主用神: ['丙', '癸'], 优先级: '丙先癸后', 忌神: '壬', 说明: '申月金旺，丙癸暖局' },
  '己酉': { 主用神: ['丙', '癸'], 优先级: '丙先癸后', 忌神: '辛', 说明: '酉月金旺，丙癸暖局' },
  '己戌': { 主用神: ['癸', '辛'], 优先级: '癸先辛后', 忌神: '丙', 说明: '戌月燥土，癸水润燥' },
  '己亥': { 主用神: ['丙', '辛'], 优先级: '丙先辛后', 忌神: '壬', 说明: '亥月水冷，丙辛暖局' },
  '己子': { 主用神: ['丙', '丁'], 优先级: '丙先丁后', 忌神: '癸', 说明: '子月水寒，丙丁暖局' },
  '己丑': { 主用神: ['丙', '丁'], 优先级: '丙先丁后', 忌神: '癸', 说明: '丑月寒湿，丙丁暖局' },
  // === 庚金日主 ===
  '庚寅': { 主用神: ['丁', '甲'], 优先级: '丁先甲后', 忌神: '壬', 说明: '寅月木旺，丁甲并用' },
  '庚卯': { 主用神: ['丁', '甲'], 优先级: '丁先甲后', 忌神: '癸', 说明: '卯月木旺，丁甲制木' },
  '庚辰': { 主用神: ['丁', '甲'], 优先级: '丁先甲后', 忌神: '壬', 说明: '辰月土月，丁甲并用' },
  '庚巳': { 主用神: ['壬', '癸'], 优先级: '壬先癸后', 忌神: '丙', 说明: '巳月火旺，壬癸制火' },
  '庚午': { 主用神: ['壬', '癸'], 优先级: '壬先癸后', 忌神: '丁', 说明: '午月火旺，壬癸调候' },
  '庚未': { 主用神: ['丁', '甲'], 优先级: '丁先甲后', 忌神: '己', 说明: '未月土月，丁甲暖局' },
  '庚申': { 主用神: ['丁', '丙'], 优先级: '丁先丙后', 忌神: '壬', 说明: '申月金旺，丁丙制金' },
  '庚酉': { 主用神: ['丁', '丙'], 优先级: '丁先丙后', 忌神: '壬', 说明: '酉月金旺，丁丙制金' },
  '庚戌': { 主用神: ['丁', '甲'], 优先级: '丁先甲后', 忌神: '辛', 说明: '戌月燥土，丁甲调候' },
  '庚亥': { 主用神: ['丁', '丙'], 优先级: '丁先丙后', 忌神: '壬', 说明: '亥月水冷，丁丙暖局' },
  '庚子': { 主用神: ['丁', '丙'], 优先级: '丁先丙后', 忌神: '癸', 说明: '子月水寒，丁丙暖局' },
  '庚丑': { 主用神: ['丙', '丁'], 优先级: '丙先丁后', 忌神: '癸', 说明: '丑月寒湿，丙丁暖局' },
  // === 辛金日主 ===
  '辛寅': { 主用神: ['壬', '甲'], 优先级: '壬先甲后', 忌神: '丙', 说明: '寅月木旺，壬水化木' },
  '辛卯': { 主用神: ['壬', '甲'], 优先级: '壬先甲后', 忌神: '丙', 说明: '卯月木旺，壬甲并用' },
  '辛辰': { 主用神: ['壬', '甲'], 优先级: '壬先甲后', 忌神: '乙', 说明: '辰月土月，壬甲暖局' },
  '辛巳': { 主用神: ['壬', '癸'], 优先级: '壬先癸后', 忌神: '丙', 说明: '巳月火旺，壬癸制火' },
  '辛午': { 主用神: ['壬', '癸'], 优先级: '壬先癸后', 忌神: '丁', 说明: '午月火旺，壬癸调候' },
  '辛未': { 主用神: ['丁', '甲'], 优先级: '丁先甲后', 忌神: '己', 说明: '未月土月，丁甲暖局' },
  '辛申': { 主用神: ['壬', '甲'], 优先级: '壬先甲后', 忌神: '庚', 说明: '申月金旺，壬水洗金' },
  '辛酉': { 主用神: ['壬', '甲'], 优先级: '壬先甲后', 忌神: '庚', 说明: '酉月金旺，壬水洗金' },
  '辛戌': { 主用神: ['丁', '丙'], 优先级: '丁先丙后', 忌神: '辛', 说明: '戌月燥土，丁丙暖局' },
  '辛亥': { 主用神: ['丙', '戊'], 优先级: '丙先戊后', 忌神: '壬', 说明: '亥月水冷，丙戊暖局' },
  '辛子': { 主用神: ['壬', '甲'], 优先级: '壬先甲后', 忌神: '丙', 说明: '子月水寒，壬甲暖局' },
  '辛丑': { 主用神: ['壬', '庚'], 优先级: '壬先庚后', 忌神: '己', 说明: '丑月寒湿，壬庚暖局' },
  // === 壬水日主 ===
  '壬寅': { 主用神: ['庚', '戊'], 优先级: '庚先戊后', 忌神: '丙', 说明: '寅月木旺，庚金生水' },
  '壬卯': { 主用神: ['庚', '辛'], 优先级: '庚先辛后', 忌神: '丙', 说明: '卯月木旺，庚辛生水' },
  '壬辰': { 主用神: ['庚', '丙'], 优先级: '庚先丙后', 忌神: '甲', 说明: '辰月土月，庚丙并用' },
  '壬巳': { 主用神: ['辛', '庚'], 优先级: '辛先庚后', 忌神: '戊', 说明: '巳月火旺，辛金化火' },
  '壬午': { 主用神: ['辛', '癸'], 优先级: '辛先癸后', 忌神: '丁', 说明: '午月火旺，辛癸调候' },
  '壬未': { 主用神: ['庚', '辛'], 优先级: '庚先辛后', 忌神: '己', 说明: '未月土月，庚辛生水' },
  '壬申': { 主用神: ['戊', '丁'], 优先级: '戊先丁后', 忌神: '丙', 说明: '申月金旺，戊丁暖局' },
  '壬酉': { 主用神: ['戊', '丁'], 优先级: '戊先丁后', 忌神: '丙', 说明: '酉月金旺，戊丁暖局' },
  '壬戌': { 主用神: ['辛', '丙'], 优先级: '辛先丙后', 忌神: '甲', 说明: '戌月燥土，辛丙调候' },
  '壬亥': { 主用神: ['丙', '戊'], 优先级: '丙先戊后', 忌神: '庚', 说明: '亥月水冷，丙戊暖局' },
  '壬子': { 主用神: ['丙', '戊'], 优先级: '丙先戊后', 忌神: '庚', 说明: '子月水寒，丙戊暖局' },
  '壬丑': { 主用神: ['丙', '丁'], 优先级: '丙先丁后', 忌神: '己', 说明: '丑月寒湿，丙丁暖局' },
  // === 癸水日主 ===
  '癸寅': { 主用神: ['辛', '丙'], 优先级: '辛先丙后', 忌神: '壬', 说明: '寅月木旺，辛丙暖局' },
  '癸卯': { 主用神: ['庚', '辛'], 优先级: '庚先辛后', 忌神: '壬', 说明: '卯月木旺，庚辛生水' },
  '癸辰': { 主用神: ['辛', '丙'], 优先级: '辛先丙后', 忌神: '乙', 说明: '辰月湿土，辛丙暖局' },
  '癸巳': { 主用神: ['辛', '壬'], 优先级: '辛先壬后', 忌神: '戊', 说明: '巳月火旺，辛壬调候' },
  '癸午': { 主用神: ['癸', '壬'], 优先级: '癸先壬后', 忌神: '丁', 说明: '午月火旺，癸壬制火' },
  '癸未': { 主用神: ['庚', '辛'], 优先级: '庚先辛后', 忌神: '己', 说明: '未月土月，庚辛生水' },
  '癸申': { 主用神: ['丁', '丙'], 优先级: '丁先丙后', 忌神: '壬', 说明: '申月金旺，丁丙暖局' },
  '癸酉': { 主用神: ['辛', '丁'], 优先级: '辛先丁后', 忌神: '壬', 说明: '酉月金旺，辛金生水' },
  '癸戌': { 主用神: ['辛', '壬'], 优先级: '辛先壬后', 忌神: '丙', 说明: '戌月燥土，辛壬润局' },
  '癸亥': { 主用神: ['丙', '戊'], 优先级: '丙先戊后', 忌神: '庚', 说明: '亥月水冷，丙戊暖局' },
  '癸子': { 主用神: ['丙', '丁'], 优先级: '丙先丁后', 忌神: '庚', 说明: '子月水寒，丙丁暖局' },
  '癸丑': { 主用神: ['丙', '丁'], 优先级: '丙先丁后', 忌神: '己', 说明: '丑月寒湿，丙丁暖局' },
};

// ============================================================
// 八字用神算法 - 增强版（穷通宝鉴 + 子平真诠）
// ============================================================

// 天干→十神映射（以日主为基准）
function stemToTenGods(dayMaster) {
  return {
    '甲': { '甲': '比肩', '乙': '劫财', '丙': '食神', '丁': '伤官', '戊': '偏财', '己': '正财', '庚': '七杀', '辛': '正官', '壬': '偏印', '癸': '正印' },
    '乙': { '甲': '劫财', '乙': '比肩', '丙': '伤官', '丁': '食神', '戊': '正财', '己': '偏财', '庚': '正官', '辛': '七杀', '壬': '正印', '癸': '偏印' },
    '丙': { '甲': '偏印', '乙': '正印', '丙': '比肩', '丁': '劫财', '戊': '食神', '己': '伤官', '庚': '偏财', '辛': '正财', '壬': '七杀', '癸': '正官' },
    '丁': { '甲': '正印', '乙': '偏印', '丙': '劫财', '丁': '比肩', '戊': '伤官', '己': '食神', '庚': '正财', '辛': '偏财', '壬': '正官', '癸': '七杀' },
    '戊': { '甲': '七杀', '乙': '正官', '丙': '偏印', '丁': '正印', '戊': '比肩', '己': '劫财', '庚': '食神', '辛': '伤官', '壬': '偏财', '癸': '正财' },
    '己': { '甲': '正官', '乙': '七杀', '丙': '正印', '丁': '偏印', '戊': '劫财', '己': '比肩', '庚': '伤官', '辛': '食神', '壬': '正财', '癸': '偏财' },
    '庚': { '甲': '偏财', '乙': '正财', '丙': '七杀', '丁': '正官', '戊': '偏印', '己': '正印', '庚': '比肩', '辛': '劫财', '壬': '食神', '癸': '伤官' },
    '辛': { '甲': '正财', '乙': '偏财', '丙': '正官', '丁': '七杀', '戊': '正印', '己': '偏印', '庚': '劫财', '辛': '比肩', '壬': '伤官', '癸': '食神' },
    '壬': { '甲': '食神', '乙': '伤官', '丙': '正财', '丁': '偏财', '戊': '七杀', '己': '正官', '庚': '偏印', '辛': '正印', '壬': '比肩', '癸': '劫财' },
    '癸': { '甲': '伤官', '乙': '食神', '丙': '偏财', '丁': '正财', '戊': '正官', '己': '七杀', '庚': '正印', '辛': '偏印', '壬': '劫财', '癸': '比肩' },
  }[dayMaster];
}

// 获取八字中所有天干和地支藏干
function getAllStemsAndHidden(palaces) {
  const allStems = [];
  const allHidden = []; // { stem, weight }

  for (const p of palaces) {
    if (p.stem) allStems.push(p.stem);
    const hidden = BRANCH_HIDDEN[p.branch];
    if (hidden) {
      for (const [pos, stem] of Object.entries(hidden)) {
        if (pos === '主气' || pos === '中气' || pos === '余气') {
          allHidden.push({ stem, weight: BRANCH_HIDDEN_WEIGHT[pos] || 0 });
        }
      }
    }
  }
  return { allStems, allHidden };
}

// 判断是否需要调候
function needsTiaoHou(monthBranch) {
  const coldMonths = ['子', '丑', '亥'];
  const hotMonths = ['巳', '午', '未'];
  return { isCold: coldMonths.includes(monthBranch), isHot: hotMonths.includes(monthBranch) };
}

// 穷通宝鉴调候用神查询
function getTiaoHouByTable(dayStem, monthBranch) {
  return TIAO_HOU_TABLE[`${dayStem}${monthBranch}`] || null;
}

// 子平真诠格局判断
function calculatePattern(dayStem, monthBranch, monthStem, strengthScore) {
  const me = dayStem;
  const hidden = BRANCH_HIDDEN[monthBranch];
  const tenGodsMap = stemToTenGods(me);

  // Step 1: 子平真诠月令取用
  // 规则：月令本气透干以透出为用，否则取本气
  let yongshenStem = hidden['主气'];
  if (monthStem && monthStem !== '' && [hidden['主气'], hidden['中气'], hidden['余气']].includes(monthStem)) {
    // 月干透出，以透出为用
    if (monthStem === hidden['主气'] || monthStem === hidden['中气']) {
      yongshenStem = monthStem;
    }
  }

  const tenGod = tenGodsMap[yongshenStem] || '比肩';

  // Step 2: 判断格局类型
  let patternType = '正格';
  const isStrong = strengthScore >= 220;
  const isWeak = strengthScore < 150;

  // 从格判断：日主极弱时
  if (isWeak) {
    if (tenGod === '正官' || tenGod === '七杀') patternType = '从官杀格';
    else if (tenGod === '正财' || tenGod === '偏财') patternType = '从财格';
    else if (tenGod === '食神' || tenGod === '伤官') patternType = '从食伤格';
    else patternType = '正格';
  }
  // 专旺格：日主极强时
  else if (strengthScore >= 380) {
    patternType = '专旺格';
  }

  // Step 3: 善用神判断
  // 身旺用官杀/财/食伤为善；身弱用印比为善
  let isGood = true;
  if (isStrong) {
    if (['比肩', '劫财', '偏印', '正印'].includes(tenGod)) isGood = false;
  } else if (isWeak) {
    if (['七杀', '正官', '偏财', '正财', '食神', '伤官'].includes(tenGod)) isGood = false;
  }

  // Step 4: 格局名称
  let patternName = tenGod;
  if (patternType !== '正格') {
    patternName = patternType;
  }

  // Step 5: 格局用神
  let patternYongshen = '';
  if (patternType === '正格') {
    patternYongshen = yongshenStem;
    // 身旺：取克泄；身弱：取生助
    if (isStrong) {
      const ke = ELEMENT_KE[STEM_ELEMENT[me]];
      const bi = ELEMENT_BI[STEM_ELEMENT[me]];
      const sheng = ELEMENT_SHENG[STEM_ELEMENT[me]];
      // 官杀、财、食伤皆可用
      patternYongshen = `${yongshenStem}（可辅以${ke}、${bi}）`;
    } else if (isWeak) {
      const sheng = ELEMENT_SHENG[STEM_ELEMENT[me]];
      const wuxing = STEM_ELEMENT[me];
      patternYongshen = `${yongshenStem}（可辅以${sheng}、${wuxing}）`;
    }
  }

  return {
    patternName,
    patternType,
    tenGod,
    yongshenStem,
    patternYongshen,
    isGood,
    desc: `${monthBranch}月令，${yongshenStem}为用，取${tenGod}（${patternType}）`
  };
}

// 子平真诠日主强弱判断（增强版）
function calculateStrengthEnhanced(dayMaster, monthBranch, palaces) {
  const me = dayMaster;
  const myElement = STEM_ELEMENT[me];

  // 1. 得令分（月令旺衰）
  const monthScore = MONTH_STRENGTH[monthBranch]?.[me] ?? 0;

  // 2. 得地分（地支根气 - 通根）
  let tonggenScore = 0;
  for (const p of palaces) {
    const bonus = TONGGEN_BONUS[me]?.[p.branch] ?? 0;
    if (bonus > 0) tonggenScore += bonus;
  }

  // 3. 得助分（天干印比帮身）
  let bizhuScore = 0;
  let yinScore = 0;
  for (const p of palaces) {
    const stem = p.stem;
    const stemElement = STEM_ELEMENT[stem];
    if (stemElement === myElement && stem !== me) {
      bizhuScore += 20; // 比肩/劫财
    }
    if (ELEMENT_PRODUCES[myElement] === stemElement) {
      yinScore += 15; // 印星
    }
  }

  // 4. 地支藏干中的印比
  for (const p of palaces) {
    const hidden = BRANCH_HIDDEN[p.branch];
    if (hidden) {
      for (const [pos, stem] of Object.entries(hidden)) {
        if (pos === '主气' || pos === '中气' || pos === '余气') {
          const stemElement = STEM_ELEMENT[stem];
          const weight = BRANCH_HIDDEN_WEIGHT[pos] || 0;
          if (stemElement === myElement) {
            bizhuScore += 15 * weight;
          }
          if (ELEMENT_PRODUCES[myElement] === stemElement) {
            yinScore += 10 * weight;
          }
        }
      }
    }
  }

  const totalScore = monthScore + tonggenScore + bizhuScore + yinScore;

  // 5. 等级判断
  let level = '中和';
  if (totalScore < 80) level = '极弱';
  else if (totalScore < 150) level = '弱';
  else if (totalScore < 220) level = '偏弱';
  else if (totalScore < 300) level = '中和';
  else if (totalScore < 380) level = '偏强';
  else if (totalScore < 450) level = '强';
  else level = '极强';

  // 6. 用神方向
  let direction = '中和难取';
  let directionDesc = '';
  if (level.includes('弱')) {
    direction = '扶抑-扶';
    directionDesc = '宜取印比生扶';
  } else if (level.includes('强')) {
    direction = '扶抑-抑';
    directionDesc = '宜取官杀财食克泄';
  }

  return {
    level,
    score: Math.round(totalScore),
    monthScore: Math.round(monthScore),
    tonggenScore: Math.round(tonggenScore),
    bizhuScore: Math.round(bizhuScore),
    yinScore: Math.round(yinScore),
    totalScore,
    direction,
    directionDesc,
    weightBreakdown: `月令${monthScore}分 + 通根${tonggenScore}分 + 比劫${bizhuScore}分 + 印绶${yinScore}分`
  };
}

// 综合用神计算（穷通宝鉴 + 子平真诠）
// 参数：dayMaster{stem, wuxing}, monthBranch, monthStem, palaces, strength{level, score, direction}
function calculateYongshenEnhanced(dayMaster, monthBranch, monthStem, palaces, strength) {
  const me = dayMaster.originalStem;
  const myElement = dayMaster.wuxing;
  const results = [];
  const { allStems, allHidden } = getAllStemsAndHidden(palaces);

  // === 1. 调候用神（穷通宝鉴） ===
  const tiaohouRule = getTiaoHouByTable(me, monthBranch);
  if (tiaohouRule) {
    const tiaohouPresent = tiaohouRule['主用神'].filter(g => allStems.includes(g));
    const tiaohouAbsent = tiaohouRule['主用神'].filter(g => !allStems.includes(g));
    const status = tiaohouPresent.length === tiaohouRule['主用神'].length ? '调候俱全' :
      tiaohouPresent.length > 0 ? '调候不全' : '调候皆缺';

    results.push({
      type: '调候',
      values: tiaohouPresent.length > 0 ? tiaohouPresent : tiaohouAbsent,
      primary: tiaohouRule['主用神'][0],
      present: tiaohouPresent,
      absent: tiaohouAbsent,
      status,
      priority: tiaohouRule['优先级'],
      avoid: tiaohouRule['忌神'],
      desc: tiaohouRule['说明'],
      isUrgent: needsTiaoHou(monthBranch).isCold || needsTiaoHou(monthBranch).isHot
    });
  }

  // === 2. 格局用神（子平真诠） ===
  const pattern = calculatePattern(me, monthBranch, monthStem, strength.score);
  results.push({
    type: '格局',
    value: pattern.yongshenStem,
    patternName: pattern.patternName,
    patternType: pattern.patternType,
    tenGod: pattern.tenGod,
    isGood: pattern.isGood,
    desc: pattern.desc,
    detail: pattern.patternYongshen
  });

  // === 3. 通关用神 ===
  // 当月令与日主相克时需要通关
  const monthElement = STEM_ELEMENT[BRANCH_HIDDEN[monthBranch]?.['主气'] || monthBranch];
  const myKe = ELEMENT_KE[myElement]; // 日主所克
  const mySheng = ELEMENT_SHENG[myElement]; // 日主所生

  // 月令克日主 → 用印通关
  if (ELEMENT_RESTRAINS[monthElement] === myElement) {
    const mediator = ELEMENT_PRODUCES[monthElement]; // 月令的印星可通关
    if (mediator && !results.some(r => r.values?.includes(mediator))) {
      results.push({ type: '通关', value: mediator, desc: `${monthElement}克${myElement}，以${mediator}通关`, isUrgent: false });
    }
  }
  // 日主克月令 → 用食伤通关
  if (ELEMENT_RESTRAINS[myElement] === monthElement) {
    const biElement = ELEMENT_BI[myElement]; // 日主所泄（食伤）
    if (biElement && !results.some(r => r.values?.includes(biElement))) {
      results.push({ type: '通关', value: biElement, desc: `${myElement}克${monthElement}，以${biElement}通关`, isUrgent: false });
    }
  }

  // === 4. 扶抑用神 ===
  if (strength.direction === '扶抑-扶') {
    results.push({
      type: '扶抑',
      values: [myElement, ELEMENT_SHENG[myElement]],
      desc: `身${strength.level}，宜取${myElement}、${ELEMENT_SHENG[myElement]}生助`
    });
  } else if (strength.direction === '扶抑-抑') {
    results.push({
      type: '扶抑',
      values: [ELEMENT_KE[myElement], ELEMENT_BI[myElement]],
      desc: `身${strength.level}，宜取${ELEMENT_KE[myElement]}、${ELEMENT_BI[myElement]}克泄`
    });
  }

  // === 综合排序 ===
  // 优先级：调候（紧急时）> 格局 > 通关 > 扶抑
  // 调候在寒月（亥子丑）和热月（巳午未）为急
  const tiaohou = results.find(r => r.type === '调候');
  const isUrgentTiaohou = tiaohou?.isUrgent;

  // 构建最终用神列表
  const finalDetails = [];
  if (isUrgentTiaohou && tiaohou) {
    finalDetails.push({ type: '调候（急）', value: tiaohou.primary, desc: tiaohou.desc });
  }
  const patternResult = results.find(r => r.type === '格局');
  if (patternResult) {
    finalDetails.push({ type: '格局', value: patternResult.value, desc: patternResult.desc });
  }
  const touguanResult = results.find(r => r.type === '通关');
  if (touguanResult) {
    finalDetails.push({ type: '通关', value: touguanResult.value, desc: touguanResult.desc });
  }
  const fuyiResult = results.find(r => r.type === '扶抑');
  if (fuyiResult) {
    for (const v of fuyiResult.values || []) {
      if (!finalDetails.some(d => d.value === v)) {
        finalDetails.push({ type: '扶抑', value: v, desc: fuyiResult.desc });
      }
    }
  }
  // 非紧急的调候也加入
  if (!isUrgentTiaohou && tiaohou && tiaohou.values) {
    for (const v of tiaohou.values) {
      if (!finalDetails.some(d => d.value === v)) {
        finalDetails.push({ type: '调候', value: v, desc: tiaohou.desc });
      }
    }
  }

  // 去重
  const seen = new Set();
  const uniqueDetails = finalDetails.filter(d => {
    if (seen.has(d.value)) return false;
    seen.add(d.value);
    return true;
  });

  const primary = uniqueDetails[0]?.value || me;
  const secondary = uniqueDetails.slice(1, 4).map(d => d.value);

  let tiaohouSummary = '无调候';
  if (tiaohou) {
    const urgent = isUrgentTiaohou ? '（急）' : '';
    // status如"调候俱全"，去掉前缀"调候"再拼
    const statusPart = (tiaohou.status || '').replace(/^调候/, '');
    tiaohouSummary = `调候${urgent}${statusPart}`;
  }
  let summary = `${tiaohouSummary}，格局${patternResult?.patternName || '待定'}`;
  if (touguanResult) summary += `，需${touguanResult.value}通关`;

  return {
    primary,
    secondary,
    details: uniqueDetails.slice(0, 5),
    summary,
    tiaohouStatus: tiaohou ? { present: tiaohou.present, absent: tiaohou.absent, status: tiaohou.status, avoid: tiaohou.avoid } : null,
    pattern: patternResult ? { name: patternResult.patternName, type: patternResult.patternType, isGood: patternResult.isGood, tenGod: patternResult.tenGod } : null,
    strengthDirection: strength.direction,
    fullAnalysis: results
  };
}

// 旧版兼容函数 - 保留接口兼容（内部调用增强版）
function getTiaohouYongshen(wuxing, monthBranch) {
  // 兼容旧接口：monthBranch可以是地支或月令对象
  const branch = typeof monthBranch === 'string' ? monthBranch : (monthBranch?.zhi || monthBranch?.branch || '寅');
  // 遍历找主用神
  for (const [key, rule] of Object.entries(TIAO_HOU_TABLE)) {
    const dayStem = key[0];
    const mz = key.slice(1);
    if (mz === branch) {
      return rule['主用神'][0];
    }
  }
  return null;
}

function getTiaohouDesc(dayStem, monthBranch) {
  const rule = getTiaoHouByTable(dayStem, monthBranch);
  if (!rule) return '';
  const { isCold, isHot } = needsTiaoHou(monthBranch);
  let season = '';
  if (isCold) season = '寒月';
  else if (isHot) season = '热月';
  return `${season ? season + '需' : ''}${rule['说明']}`;
}

// ============================================================
// 核心排盘分析
// ============================================================

function analyzePlate(year, month, day, hour, minute, sex) {
  const dateStr = minute > 0
    ? `${year}-${month}-${day} ${hour}:${String(minute).padStart(2, '0')}`
    : `${year}-${month}-${day} ${hour}`;

  const gender = sex === 1 ? 1 : 0;
  const astrolabe = astro.bySolar(dateStr, gender, true, 'zh-CN');

  // 收集十二宫数据
  const palaces = astrolabe.palaces.map((p, idx) => ({
    index: idx,
    name: p.name,
    duty: p.name,
    stem: p.heavenlyStem,
    branch: p.earthlyBranch,
    majorStars: p.majorStars || [],
    minorStars: p.minorStars || [],
    adjectiveStars: p.adjectiveStars || [],
    changsheng12: p.changsheng12 || '',
    boshi12: p.boshi12 || '',
    jiangqian12: p.jiangqian12 || '',
    suiqian12: p.suiqian12 || '',
    decadal: p.decadal || {}
  }));

  let mingIdx = -1;
  palaces.forEach((p, idx) => {
    if (p.name === '命宫') mingIdx = idx;
  });

  // 四化信息
  const transforms = [];
  for (const starName of MAIN_STARS) {
    try {
      const star = astrolabe.star(starName);
      if (star && star.mutagen) {
        transforms.push({ star: starName, hua: star.mutagen });
      }
    } catch (e) { /* skip */ }
  }

  // 八字信息
  const eightChar = astrolabe.chineseDate.split(' ');
  // eightChar = ['乙亥', '甲申', '戊寅', '壬子'] -> [年柱, 月柱, 日柱, 时柱]
  const yearStem = eightChar[0]?.[0] || '甲';    // 年干 = 乙
  const monthStem = eightChar[1]?.[0] || '甲';  // 月干 = 甲
  const dayStem = eightChar[2]?.[0] || '甲';     // 日干 = 戊
  const monthBranch = eightChar[1]?.[1] || '寅'; // 月支 = 申

  // 日主信息
  const dayMaster = getDayMaster(dayStem);
  const monthInfo = getMonthInfo(monthBranch);

  // 计算强弱（子平真诠增强版）
  const strength = calculateStrengthEnhanced(dayStem, monthBranch, palaces);
  // 构建兼容旧接口的strength对象
  const strengthCompat = {
    helpScore: strength.bizhuScore + strength.yinScore,
    stressScore: 0,
    total: strength.score,
    strength: strength.level,
    needSupport: strength.direction === '扶抑-抑' ? [ELEMENT_KE[dayMaster.wuxing]] : [ELEMENT_SHENG[dayMaster.wuxing], dayMaster.wuxing],
    needAvoid: strength.direction === '扶抑-抑' ? [dayMaster.wuxing, ELEMENT_SHENG[dayMaster.wuxing]] : [ELEMENT_KE[dayMaster.wuxing]],
    level: strength.level,
    score: strength.score,
    monthScore: strength.monthScore,
    tonggenScore: strength.tonggenScore,
    bizhuScore: strength.bizhuScore,
    yinScore: strength.yinScore,
    direction: strength.direction,
    directionDesc: strength.directionDesc,
    weightBreakdown: strength.weightBreakdown
  };

  // 用神计算（穷通宝鉴 + 子平真诠增强版）
  const yongshen = calculateYongshenEnhanced(dayMaster, monthBranch, monthStem, palaces, strength);

  // 格局检测（知识库驱动）
  const knowledgePatterns = checkPatternsFromKnowledge(palaces, mingIdx, transforms, yearStem);

  // 传统格局检测（补充）
  const traditionalPatterns = checkTraditionalPatterns(palaces, mingIdx, transforms);

  // 合并格局
  const allPatterns = mergePatterns(knowledgePatterns, traditionalPatterns);

  // 大运分析
  const decadalAnalysis = analyzeDecadal(astrolabe, year, month, day, gender, mingIdx, palaces);

  // 流年分析
  const yearlyAnalysis = analyzeYearly(astrolabe, year, month, day, gender, palaces);

  return {
    basic: {
      year, month, day, hour, minute,
      sex: sex === 1 ? '男' : '女',
      chineseDate: astrolabe.chineseDate,
      fiveElements: astrolabe.fiveElementsClass,
      soul: astrolabe.soul,
      body: astrolabe.body,
      zodiac: astrolabe.zodiac,
      sign: astrolabe.sign,
      palaces,
      mingIdx,
      transforms,
      yearStem,
      dayStem,
      monthBranch,
      astrolabe
    },
    analysis: {
      dayStem,
      dayMaster,
      monthZhi: monthBranch,
      monthInfo,
      ...strengthCompat,
      yongshen
    },
    patterns: allPatterns,
    decadal: decadalAnalysis,
    yearly: yearlyAnalysis
  };
}

// ============================================================
// 日主与月令
// ============================================================

function getDayMaster(stem) {
  const masters = {
    '甲': { name: '甲木', wuxing: '木', stem: '阳木', originalStem: '甲' },
    '乙': { name: '乙木', wuxing: '木', stem: '阴木', originalStem: '乙' },
    '丙': { name: '丙火', wuxing: '火', stem: '阳火', originalStem: '丙' },
    '丁': { name: '丁火', wuxing: '火', stem: '阴火', originalStem: '丁' },
    '戊': { name: '戊土', wuxing: '土', stem: '阳土', originalStem: '戊' },
    '己': { name: '己土', wuxing: '土', stem: '阴土', originalStem: '己' },
    '庚': { name: '庚金', wuxing: '金', stem: '阳金', originalStem: '庚' },
    '辛': { name: '辛金', wuxing: '金', stem: '阴金', originalStem: '辛' },
    '壬': { name: '壬水', wuxing: '水', stem: '阳水', originalStem: '壬' },
    '癸': { name: '癸水', wuxing: '水', stem: '阴水', originalStem: '癸' }
  };
  return masters[stem] || masters['甲'];
}

function getMonthInfo(zhi) {
  const infos = {
    '寅': { element: '木', strength: '旺', score: 3, season: '春' },
    '卯': { element: '木', strength: '旺', score: 3, season: '春' },
    '辰': { element: '木', strength: '墓', score: 0, season: '春' },
    '巳': { element: '火', strength: '相', score: 2, season: '夏' },
    '午': { element: '火', strength: '旺', score: 3, season: '夏' },
    '未': { element: '火', strength: '墓', score: 0, season: '夏' },
    '申': { element: '金', strength: '旺', score: 3, season: '秋' },
    '酉': { element: '金', strength: '旺', score: 3, season: '秋' },
    '戌': { element: '金', strength: '墓', score: 0, season: '秋' },
    '亥': { element: '水', strength: '旺', score: 3, season: '冬' },
    '子': { element: '水', strength: '旺', score: 3, season: '冬' },
    '丑': { element: '土', strength: '旺', score: 3, season: '冬' }
  };
  return infos[zhi] || { element: '土', strength: '平', score: 1, season: '四季' };
}

function getWuxing(stem) {
  const map = { '甲': '木', '乙': '木', '丙': '火', '丁': '火', '戊': '土', '己': '土', '庚': '金', '辛': '金', '壬': '水', '癸': '水' };
  return map[stem] || '土';
}

// ============================================================
// 命盘强弱分析（旧版兼容wrapper，调用增强版）
// ============================================================

function calculateStrength(dayMaster, monthInfo, palaces, mingIdx) {
  // 调用增强版算法
  const monthBranch = monthInfo?.zhi || monthInfo?.branch || monthInfo?.branch || '寅';
  const enhanced = calculateStrengthEnhanced(dayMaster.originalStem, monthBranch, palaces);
  // 兼容旧接口
  const wuxing = dayMaster.wuxing;
  let needSupport = [], needAvoid = [];
  if (enhanced.direction === '扶抑-抑') {
    needSupport = [ELEMENT_KE[wuxing]];
    needAvoid = [wuxing, ELEMENT_SHENG[wuxing]];
  } else if (enhanced.direction === '扶抑-扶') {
    needSupport = [ELEMENT_SHENG[wuxing], wuxing];
    needAvoid = [ELEMENT_KE[wuxing]];
  }
  return {
    helpScore: enhanced.bizhuScore + enhanced.yinScore,
    stressScore: 0,
    total: enhanced.score,
    strength: enhanced.level,
    needSupport,
    needAvoid,
    // 增强版额外字段
    level: enhanced.level,
    score: enhanced.score,
    monthScore: enhanced.monthScore,
    tonggenScore: enhanced.tonggenScore,
    bizhuScore: enhanced.bizhuScore,
    yinScore: enhanced.yinScore,
    direction: enhanced.direction,
    directionDesc: enhanced.directionDesc,
    weightBreakdown: enhanced.weightBreakdown
  };
}

// ============================================================
// 八字用神计算（旧版兼容wrapper，调用增强版）
// ============================================================

function calculateYongshen(dayMaster, monthInfo, palaces, mingIdx, strength) {
  const dayStem = dayMaster.stem;
  const monthBranch = monthInfo?.zhi || monthInfo?.branch || '寅';
  const monthStem = monthInfo?.stem || '';
  return calculateYongshenEnhanced(dayMaster, monthBranch, monthStem, palaces, strength);
}

function findWeakestLink(palaces, mingIdx, wuxing) {
  const counts = {};
  MAIN_STARS.forEach(s => counts[s] = 0);

  for (const p of palaces) {
    for (const s of p.majorStars || []) {
      if (MAIN_STARS.includes(s.name)) counts[s.name]++;
    }
  }

  // 检查是否有某主星完全缺失
  const missing = Object.entries(counts).filter(([k, v]) => v === 0).map(([k]) => k);
  if (missing.length > 2) {
    return { remedy: missing[0], desc: `命局缺${missing[0]}` };
  }

  return null;
}

// ============================================================
// 传统格局检测（补充知识库）
// ============================================================

function checkTraditionalPatterns(palaces, mingIdx, transforms) {
  const patterns = [];
  const mingPalace = palaces[mingIdx];
  const mingStars = mingPalace?.majorStars?.map(s => s.name) || [];
  const mingBranch = mingPalace?.branch || '';

  const allMingStars = [
    ...mingStars,
    ...(mingPalace?.minorStars?.map(s => s.name) || []),
    ...(mingPalace?.adjectiveStars?.map(s => s.name) || [])
  ];

  const getSanfang = () => {
    const opp = (mingIdx + 6) % 12;
    const t1 = (mingIdx + 4) % 12;
    const t2 = (mingIdx + 8) % 12;
    return [
      ...(palaces[opp]?.majorStars?.map(s => s.name) || []),
      ...(palaces[t1]?.majorStars?.map(s => s.name) || []),
      ...(palaces[t2]?.majorStars?.map(s => s.name) || [])
    ];
  };
  const sanfang = getSanfang();
  const allSanfang = [...allMingStars, ...sanfang];

  const has = (stars, names) => names.every(n => stars.includes(n));
  const hasAny = (stars, names) => names.some(n => stars.includes(n));

  const prevIdx = (mingIdx - 1 + 12) % 12;
  const nextIdx = (mingIdx + 1) % 12;
  const prevStars = palaces[prevIdx]?.minorStars?.map(s => s.name) || [];
  const nextStars = palaces[nextIdx]?.minorStars?.map(s => s.name) || [];

  // 紫府同宫
  if (has(mingStars, ['紫微', '天府']) && ['寅','申'].includes(mingBranch)) {
    patterns.push({ name: '紫府同宫', level: '贵', desc: '最吉之格，富贵双全', source: 'traditional' });
  }

  // 杀破狼
  if (['贪狼','七杀','破军'].filter(s => sanfang.includes(s)).length >= 2) {
    patterns.push({ name: '杀破狼', level: '变', desc: '动荡变革，破旧立新', source: 'traditional' });
  }

  // 机月同梁
  if (['天机','太阴','天同','天梁'].filter(s => sanfang.includes(s)).length >= 3) {
    patterns.push({ name: '机月同梁', level: '富', desc: '善谋稳定，公职之命', source: 'traditional' });
  }

  // 七杀朝斗
  if (has(mingStars, ['七杀']) && ['子','午','寅','申'].includes(mingBranch)) {
    patterns.push({ name: '七杀朝斗', level: '贵', desc: '威镇边疆，将相之才', source: 'traditional' });
  }

  // 石中隐
  // 左右同宫
  if (has(mingStars, ['左辅', '右弼'])) {
    patterns.push({ name: '左右同宫', level: '贵', desc: '辅助有力，秉性宽厚', source: 'traditional' });
  }

  // 魁钺相遇
  if (hasAny(mingStars, ['天魁', '天钺'])) {
    if (has(mingStars, ['天魁', '天钺'])) {
      patterns.push({ name: '魁钺相遇', level: '贵', desc: '贵人相助，文武双全', source: 'traditional' });
    }
  }

  // 天乙拱命
  if (hasAny(sanfang, ['天魁', '天钺'])) {
    patterns.push({ name: '天乙拱命', level: '贵', desc: '多贵人助，学识出众', source: 'traditional' });
  }

  // 羊陀夹命
  if ((prevStars.includes('擎羊') && nextStars.includes('陀罗')) ||
      (prevStars.includes('陀罗') && nextStars.includes('擎羊'))) {
    patterns.push({ name: '羊陀夹命', level: '凶', desc: '守财奴，钱财难聚', source: 'traditional' });
  }

  // 火铃夹命
  if ((prevStars.includes('火星') && nextStars.includes('铃星')) ||
      (prevStars.includes('铃星') && nextStars.includes('火星'))) {
    patterns.push({ name: '火铃夹命', level: '凶', desc: '叛逆冲动，易惹祸端', source: 'traditional' });
  }

  // 空劫夹命
  if ((prevStars.includes('地空') && nextStars.includes('地劫')) ||
      (prevStars.includes('地劫') && nextStars.includes('地空'))) {
    patterns.push({ name: '空劫夹命', level: '凶', desc: '精神孤独，钱难聚', source: 'traditional' });
  }

  // 命无正曜
  if (mingStars.length === 0) {
    patterns.push({ name: '命无正曜', level: '平', desc: '可塑性高，运势受环境影响大', source: 'traditional' });
  }

  // 日月同宫
  if (has(mingStars, ['太阳', '太阴'])) {
    patterns.push({ name: '日月同宫', level: '中', desc: '贵富，妨弟兄', source: 'traditional' });
  }

  // 贪武同行
  if (has(mingStars, ['贪狼', '武曲'])) {
    patterns.push({ name: '贪武同行', level: '富', desc: '大富，奔波后成', source: 'traditional' });
  }

  // 三奇加会
  const transNames = transforms.map(t => t.hua);
  if (transNames.includes('禄') && transNames.includes('权') && transNames.includes('科')) {
    patterns.push({ name: '三奇加会', level: '贵', desc: '志向远大，运气极佳', source: 'traditional' });
  }

  // 明珠出海
  const yiPalace = palaces.find(p => p.name === '迁移');
  if (yiPalace && ['太阳','太阴'].some(s => yiPalace.majorStars?.map(x => x.name).includes(s))) {
    patterns.push({ name: '明珠出海', level: '富', desc: '远行得名，利学术', source: 'traditional' });
  }

  return patterns;
}

// ============================================================
// 合并格局（去重，知识库优先）
// ============================================================

function mergePatterns(knowledgePatterns, traditionalPatterns) {
  const map = new Map();

  for (const p of traditionalPatterns) {
    if (!map.has(p.name)) map.set(p.name, p);
  }

  for (const p of knowledgePatterns) {
    if (!map.has(p.name)) {
      map.set(p.name, { ...p, source: 'knowledge' });
    }
  }

  const all = Array.from(map.values());

  // 按等级排序
  const levelOrder = { '贵': 1, '富': 2, '中': 3, '平': 4, '变': 5, '凶': 6 };
  all.sort((a, b) => (levelOrder[a.level] || 9) - (levelOrder[b.level] || 9));

  return all;
}

// ============================================================
// 大运分析
// ============================================================

function analyzeDecadal(astrolabe, birthYear, birthMonth, birthDay, gender, mingIdx, palaces) {
  const results = [];
  const currentYear = new Date().getFullYear();
  const currentAge = currentYear - birthYear;

  // 计算每步大运
  // 大运从命宫开始，每步大运10年
  // 大运地支顺序：寅→卯→辰→巳→午→未→申→酉→戌→亥→子→丑
  const branchOrder = ['寅','卯','辰','巳','午','未','申','酉','戌','亥','子','丑'];
  const stemOrder = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];

  // 命宫地支
  const mingBranch = palaces[mingIdx]?.branch || '寅';
  const mingBranchIdx = branchOrder.indexOf(mingBranch);

  // 五虎遁起月干（简化版）
  const tigerRule = { '甲': '丙', '乙': '戊', '丙': '庚', '丁': '辛', '戊': '壬', '己': '甲', '庚': '丙', '辛': '戊', '壬': '庚', '癸': '壬' };

  // 计算命宫天干
  // iztro的算法：命宫天干 = 五虎遁(年干)
  // 这里用简化：年干对应的五虎遁月干，再结合命宫地支推算

  // 获取出生年干
  const yearStem = astrolabe.chineseDate.split(' ')[1]?.[0] || '甲';
  const startStem = tigerRule[yearStem] || '丙';
  const startStemIdx = stemOrder.indexOf(startStem);

  // 命宫天干索引
  const mingStemIdx = (startStemIdx + mingBranchIdx) % 10;

  for (let i = 0; i < 12; i++) {
    const branchIdx = (mingBranchIdx + i) % 12;
    const stemIdx = (mingStemIdx + i) % 10;

    const ageStart = i * 10;
    const ageEnd = ageStart + 9;
    const midAge = ageStart + 5;

    // 检查是否当前大运
    const isCurrent = currentAge >= ageStart && currentAge <= ageEnd;

    // 获取大运星曜（通过horoscope）
    let decadalStars = [];
    let mutagen = [];
    if (isCurrent) {
      try {
        const today = new Date();
        const h = astrolabe.horoscope(today);
        decadalStars = h.decadal?.stars || [];
        mutagen = h.decadal?.mutagen || [];
      } catch (e) { /* skip */ }
    }

    // 大运宫名
    const palaceIdx = (mingIdx + i) % 12;
    const palaceName = palaces[palaceIdx]?.name || '命宫';
    const palaceBranch = palaces[palaceIdx]?.branch || branchOrder[branchIdx];

    // 大运运势评估
    const luckScore = evaluateDecadalLuck(palaces[palaceIdx], decadalStars, mutagen);

    results.push({
      index: i,
      ageStart,
      ageEnd,
      stem: stemOrder[stemIdx],
      branch: branchOrder[branchIdx],
      palaceName,
      palaceBranch,
      isCurrent,
      stars: decadalStars,
      mutagen,
      luck: luckScore
    });
  }

  return results;
}

function evaluateDecadalLuck(palace, decadalStars, mutagen) {
  let score = 0;
  const allStars = [
    ...(palace?.majorStars?.map(s => s.name) || []),
    ...(palace?.minorStars?.map(s => s.name) || [])
  ];

  for (const star of allStars) {
    if (LUCKY_STARS.includes(star)) score += 2;
    if (UNLUCKY_STARS.includes(star)) score -= 1;
  }

  for (const star of decadalStars) {
    if (star.type === 'soft' || star.type === 'flower' || star.type === 'lucun') score += 1;
    if (star.type === 'tough') score -= 0.5;
  }

  let level = '平常';
  if (score >= 4) level = '大吉';
  else if (score >= 2) level = '吉祥';
  else if (score >= 0) level = '平稳';
  else if (score >= -2) level = '小逆';
  else level = '不顺';

  return { score: +score.toFixed(1), level };
}

// ============================================================
// 流年分析
// ============================================================

function analyzeYearly(astrolabe, birthYear, birthMonth, birthDay, gender, palaces) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  try {
    const today = new Date();
    const h = astrolabe.horoscope(today);

    const yearly = h.yearly;
    const age = h.age;

    // 流年命宫位置
    const yearlyPalaceIdx = yearly?.index ?? 0;
    const yearlyPalaceName = yearly?.palaceNames?.[yearlyPalaceIdx] || '命宫';
    const yearlyStem = yearly?.heavenlyStem || '甲';
    const yearlyBranch = yearly?.earthlyBranch || '子';

    // 流年星
    const yearlyStars = yearly?.stars || [];

    // 流年四化
    const yearlyMutagen = yearly?.mutagen || [];

    // 小限
    const agePalaceIdx = age?.index ?? 0;
    const agePalaceName = age?.palaceNames?.[agePalaceIdx] || '命宫';
    const ageStem = age?.heavenlyStem || '甲';
    const ageBranch = age?.earthlyBranch || '子';

    // 评估流年
    const yearlyScore = evaluateYearlyLuck(yearlyStars, yearlyMutagen, palaces[yearlyPalaceIdx]);

    // 未来5年流年简览
    const nextYears = [];
    for (let i = 0; i < 5; i++) {
      const yr = currentYear + i;
      try {
        const date = new Date(yr + '-08-15');
        const hy = astrolabe.horoscope(date);
        nextYears.push({
          year: yr,
          stem: hy.yearly?.heavenlyStem || '',
          branch: hy.yearly?.earthlyBranch || '',
          palaceIdx: hy.yearly?.index || 0,
          palaceName: hy.yearly?.palaceNames?.[hy.yearly?.index || 0] || ''
        });
      } catch (e) {
        nextYears.push({ year: yr, stem: '', branch: '', palaceName: '（计算）' });
      }
    }

    return {
      current: {
        year: currentYear,
        stem: yearlyStem,
        branch: yearlyBranch,
        palaceName: yearlyPalaceName,
        palaceIdx: yearlyPalaceIdx,
        stars: yearlyStars,
        mutagen: yearlyMutagen,
        score: yearlyScore
      },
      age: {
        nominalAge: age?.nominalAge || currentYear - birthYear,
        stem: ageStem,
        branch: ageBranch,
        palaceName: agePalaceName,
        palaceIdx: agePalaceIdx
      },
      nextYears
    };
  } catch (e) {
    return { error: e.message, current: null, nextYears: [] };
  }
}

function evaluateYearlyLuck(stars, mutagen, palace) {
  let score = 0;

  for (const star of stars) {
    if (star.type === 'soft' || star.type === 'flower' || star.type === 'lucun') score += 1;
    if (star.type === 'tough') score -= 1;
  }

  for (const m of mutagen) {
    if (['禄','权','科'].includes(m)) score += 1;
    if (m === '忌') score -= 1;
  }

  let level = '平常';
  if (score >= 3) level = '大吉';
  else if (score >= 1) level = '吉祥';
  else if (score >= -1) level = '平稳';
  else if (score >= -3) level = '小逆';
  else level = '不顺';

  return { score: +score.toFixed(1), level };
}

// ============================================================
// 格式输出
// ============================================================

function formatOutput(result) {
  const { basic, analysis, patterns, decadal, yearly } = result;
  const palaces = basic.palaces;
  const mingIdx = basic.mingIdx;
  const mingPalace = palaces[mingIdx];
  const mingMainStars = mingPalace?.majorStars?.map(s => s.name) || [];

  // 地支生肖
  const branchNames = {
    '子':'鼠','丑':'牛','寅':'虎','卯':'兔','辰':'龙','巳':'蛇',
    '午':'马','未':'羊','申':'猴','酉':'鸡','戌':'狗','亥':'猪'
  };

  // 四化
  const transformStr = basic.transforms.map(t => `${t.star}化${t.hua}`).join('  ');

  let out = `
✨ ═══════════════════════════════════════
   紫微斗数命盘 v4 · 知识库增强版
══════════════════════════════════════ ✨

📋 基本信息
   出生：${basic.year}年${basic.month}月${basic.day}日 ${basic.hour}:${String(basic.minute).padStart(2,'0')}
   性别：${basic.sex}
   生肖：${basic.zodiac}
   八字：${basic.chineseDate}
   五行局：${basic.fiveElements}
   命主：${basic.soul} | 身主：${basic.body}
   星座：${basic.sign}

🌟 命宫
   位置：第${mingIdx + 1}宫「${mingPalace?.name}」
   干支：${mingPalace?.stem}${mingPalace?.branch}
   主星：${mingMainStars.join('、') || '空宫'}
   长生：${mingPalace?.changsheng12 || '-'} | 博士：${mingPalace?.boshi12 || '-'}
   擎羊：${mingPalace?.jiangqian12 || '-'} | 岁前：${mingPalace?.suiqian12 || '-'}

🔮 日主分析
   日主：${analysis.dayMaster.name}
   月令：${analysis.monthZhi}月（${analysis.monthInfo.strength}）
   助力：${analysis.helpScore}分 | 压力：${analysis.stressScore}分
   综合：${analysis.strength}（${analysis.total}分）

💊 八字用神（增强算法）
   主用神：${analysis.yongshen.primary}
   辅用神：${analysis.yongshen.secondary.join('、')}
   说明：${analysis.yongshen.summary}
`;
  if (analysis.yongshen.details.length > 0) {
    out += `   用神详情：\n`;
    analysis.yongshen.details.forEach(d => {
      out += `     · ${d.type}：${d.value} — ${d.desc}\n`;
    });
  }

  out += `
🎯 用神喜忌
   宜补：${analysis.needSupport.join('、')}（身${analysis.strength}宜）
   宜避：${analysis.needAvoid.join('、')}
`;

  if (basic.transforms.length > 0) {
    out += `
🔄 四化（${basic.yearStem}年）
   ${transformStr}
`;
  }

  if (patterns.length > 0) {
    out += `
🎴 命盘格局（共${patterns.length}个）
`;
    patterns.slice(0, 15).forEach(p => {
      const src = p.source === 'knowledge' ? '📚' : '📖';
      out += `   ${src} ${p.name}（${p.level}）${p.desc}\n`;
    });
    if (patterns.length > 15) out += `   ...另有${patterns.length - 15}个格局\n`;
  }

  // 大运
  if (decadal.length > 0) {
    out += `
🔁 大运流年
   当前：${decadal.filter(d => d.isCurrent).map(d =>
      `${d.stem}${d.branch}（${d.palaceName}）${d.stars.flat().filter(s=>s.name).map(s=>s.name).join('、')}`
    ).join(' | ') || '（计算中）'}
`;
    out += `   大运一览（${basic.year}年起）\n`;
    decadal.forEach(d => {
      const cur = d.isCurrent ? '👉' : '  ';
      out += `   ${cur} ${d.stem}${d.branch} · ${d.ageStart}-${d.ageEnd}岁 · ${d.palaceName} · ${d.luck.level}(${d.luck.score})\n`;
    });
  }

  // 流年
  if (yearly && yearly.current) {
    out += `
📅 流年（${yearly.current.year}年）
   干支：${yearly.current.stem}${yearly.current.branch}
   流年命宫：${yearly.current.palaceName}
   流年星：${yearly.current.stars.flat().filter(s=>s.name).map(s=>'流'+s.name.replace('流','')).join('、') || '（无明显吉凶）'}
   流年运势：${yearly.current.score.level}（${yearly.current.score.score}）
   小限：${yearly.age.stem}${yearly.age.branch} · ${yearly.age.palaceName}（${yearly.age.nominalAge}岁）
`;
    if (yearly.nextYears.length > 0) {
      out += `   未来五年：`;
      out += yearly.nextYears.map(n => `${n.year}年${n.stem}${n.branch}${n.palaceName}`).join(' → ');
      out += '\n';
    }
  }

  out += `
📜 十二宫
`;
  palaces.forEach((p, i) => {
    const stars = [
      ...(p.majorStars?.map(s => s.name) || []),
      ...(p.minorStars?.map(s => s.name) || []),
      ...(p.adjectiveStars?.map(s => s.name) || [])
    ].join('、');
    const isMing = i === mingIdx;
    const cur = isMing ? '👉' : '  ';
    const empty = stars ? '' : '（空）';
    out += `${cur} ${String(i+1).padStart(2,'0')}.${p.name} ${p.stem}${p.branch} ${stars}${empty}\n`;
  });

  out += `\n═══════════════════════════════════════\n`;
  return out;
}

// ============================================================
// 主入口
// ============================================================

function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(`
✨ 紫微斗数命盘分析 v4（知识库增强版）

用法:
  node ziwei.js <出生日期> <性别> [时间]

参数:
  出生日期  YYYY-MM-DD
  性别      男=1 或 女=0
  时间      HH:MM（可选，默认12:00）

示例:
  node ziwei.js 1995-08-15 0 12:00
  node ziwei.js 1984-05-18 1
  node ziwei.js 1990-05-15 0 14:30
`);
    return;
  }

  const dateStr = args[0];
  const sexArg = args[1];
  const sex = sexArg === '男' ? 1 : sexArg === '女' ? 0 : parseInt(sexArg);
  const timeStr = args[2] || '12:00';

  const [year, month, day] = dateStr.split('-').map(Number);

  const SHICHEN_MAP = {'子':0,'丑':2,'寅':4,'卯':6,'辰':8,'巳':10,'午':12,'未':14,'申':16,'酉':18,'戌':20,'亥':22};
  let hour, minute;
  if (SHICHEN_MAP[timeStr] !== undefined) {
    hour = SHICHEN_MAP[timeStr];
    minute = 0;
  } else {
    [hour, minute = 0] = timeStr.split(':').map(Number);
  }

  try {
    const result = analyzePlate(year, month, day, hour, minute, sex);
    console.log(formatOutput(result));
  } catch (e) {
    console.error('分析失败:', e.message);
    console.error(e.stack);
  }
}

main();
