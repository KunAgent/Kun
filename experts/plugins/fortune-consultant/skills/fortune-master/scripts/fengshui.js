#!/usr/bin/env node
/**
 * 风水分析脚本
 * 支持：阳宅风水、办公室风水、颜色风水
 */

const fs = require('fs');
const path = require('path');

// 八卦方位对应
const baGuaDirection = {
  '乾': { direction: '西北', number: 6, element: '金', color: '白色', trait: '领导、权威' },
  '坤': { direction: '西南', number: 2, element: '土', color: '黄色', trait: '柔顺、包容' },
  '震': { direction: '东', number: 3, element: '木', color: '绿色', trait: '震动、创新' },
  '巽': { direction: '东南', number: 4, element: '木', color: '绿色', trait: '进入、柔和' },
  '坎': { direction: '北', number: 1, element: '水', color: '黑色', trait: '险陷、智慧' },
  '离': { direction: '南', number: 9, element: '火', color: '红色', trait: '明亮、热情' },
  '艮': { direction: '东北', number: 8, element: '土', color: '黄色', trait: '停止、稳定' },
  '兑': { direction: '西', number: 7, element: '金', color: '白色', trait: '喜悦、口才' }
};

// 九宫飞星宫位序列（洛书飞布次序）
const PALACE_SEQ = ['中宫', '乾', '兑', '艮', '离', '坎', '坤', '震', '巽'];
const STAR_NAMES = ['一白', '二黑', '三碧', '四绿', '五黄', '六白', '七赤', '八白', '九紫'];

// 财位寻找
const caiWei = {
  '明财位': '大门对角线位置',
  '暗财位': '住宅中心点',
  '流年财位': '每年变化，见流年飞星',
  '固定财位': '根据主人八字喜忌定'
};

// 吉凶方位
const jiXiongDirections = {
  '乾': { wealth: '吉', health: '平', career: '吉', love: '平' },
  '坤': { wealth: '平', health: '吉', career: '平', love: '吉' },
  '震': { wealth: '平', health: '平', career: '平', love: '吉' },
  '巽': { wealth: '吉', health: '平', career: '吉', love: '平' },
  '坎': { wealth: '平', health: '凶', career: '凶', love: '平' },
  '离': { wealth: '吉', health: '吉', career: '平', love: '平' },
  '艮': { wealth: '吉', health: '吉', career: '平', love: '平' },
  '兑': { wealth: '平', health: '平', career: '凶', love: '吉' }
};

/**
 * 获取流年飞星（三元九运体系，与 Python 版 feixing.py 一致）
 * 每20年一个运，入中宫之星不同：2004-2023 八白，2024-2043 九紫，以此类推
 */
function getFlyingStars(year = new Date().getFullYear()) {
  // 确定入中宫之星（ruzong）
  let ruzong;
  if (year >= 2024 && year <= 2043) ruzong = 9;
  else if (year >= 2004 && year <= 2023) ruzong = 8;
  else if (year >= 1984 && year <= 2003) ruzong = 7;
  else if (year >= 1964 && year <= 1983) ruzong = 6;
  else if (year >= 1944 && year <= 1963) ruzong = 5;
  else ruzong = 9; // 默认九紫

  // 洛书飞布次序：中宫→乾→兑→艮→离→坎→坤→震→巽
  // 飞布路径索引：0=中宫, 1=乾, 2=兑, 3=艮, 4=离, 5=坎, 6=坤, 7=震, 8=巽
  const flyPath = [4, 9, 2, 7, 6, 1, 8, 3]; // 洛书数字路径（跳过中宫5）
  const result = {};
  // 中宫
  result[STAR_NAMES[ruzong - 1]] = PALACE_SEQ[0];
  // 其余八宫按洛书飞布
  for (let i = 0; i < 8; i++) {
    const starNum = ((ruzong - 1 + i) % 9) + 1;
    // 跳过5（中宫已占），但飞星是1-9连续的
    const actualStar = ruzong + i > 9 ? ruzong + i - 9 : ruzong + i;
    result[STAR_NAMES[actualStar - 1]] = PALACE_SEQ[i + 1];
  }
  return result;
}

/**
 * 分析大门风水
 */
function analyzeMainDoor(direction) {
  const info = baGuaDirection[direction];
  if (!info) {
    return { error: '方向不明确' };
  }
  
  let analysis = '';
  let suggestions = [];
  
  // 大门朝向来判断
  if (['乾', '兑'].includes(direction)) {
    analysis = '大门朝西或西北，金气旺盛';
    suggestions.push('宜摆放金属装饰增强运势');
    suggestions.push('可放白色或金色地毯');
  } else if (['震', '巽'].includes(direction)) {
    analysis = '大门朝东或东南，木气旺盛';
    suggestions.push('宜摆放绿植招贵人');
    suggestions.push('保持空间明亮通风');
  } else if (['坎'].includes(direction)) {
    analysis = '大门朝北，水气旺盛';
    suggestions.push('宜用蓝色或黑色装饰');
    suggestions.push('注意防潮防湿');
  } else if (['离'].includes(direction)) {
    analysis = '大门朝南，火气旺盛';
    suggestions.push('宜用红色或紫色装饰');
    suggestions.push('注意防火安全');
  } else if (['坤', '艮'].includes(direction)) {
    analysis = '大门朝西南或东北，土气旺盛';
    suggestions.push('宜用黄色或棕色装饰');
    suggestions.push('保持空间稳重踏实');
  }
  
  return {
    direction: info.direction,
    element: info.element,
    analysis,
    suggestions
  };
}

/**
 * 分析财位
 */
function analyzeWealthPosition(bazi, year = new Date().getFullYear()) {
  const stars = getFlyingStars(year);
  const baziDayStem = bazi?.charAt(0) || '甲';
  
  // 找出财位
  const positions = [];
  
  // 明财位
  positions.push({
    type: '明财位',
    location: '大门对角线（进门后左右角落）',
    description: '气流入处，聚气纳财',
    direction: '根据实际大门位置定'
  });
  
  // 流年财位
  const yiMaPosition = Object.entries(stars).find(([name]) => name === '一白贪狼')?.[1] || '坎';
  positions.push({
    type: '流年财位（2026）',
    location: `${baGuaDirection[yiMaPosition]?.direction || '北'}`,
    description: '一白贪狼星所在，利财运',
    stars: stars
  });
  
  // 日主喜用（简化）
  const dayElements = {
    '甲': '木', '乙': '木', '丙': '火', '丁': '火',
    '戊': '土', '己': '土', '庚': '金', '辛': '金',
    '壬': '水', '癸': '水'
  };
  const dayElement = dayElements[baziDayStem] || '土';
  
  // 根据日主五行找财位
  const wealthDirections = {
    '木': '东方、东南',
    '火': '南方',
    '土': '西南、东北',
    '金': '西方、西北',
    '水': '北方'
  };
  
  positions.push({
    type: '八字喜用财位',
    location: wealthDirections[dayElement] || '根据八字定',
    description: `日主${baziDayStem}，喜${dayElement}，财位在${wealthDirections[dayElement]}`
  });
  
  return positions;
}

/**
 * 分析卧室风水
 */
function analyzeBedroom(direction) {
  const info = baGuaDirection[direction];
  if (!info) {
    return { error: '方向不明确' };
  }
  
  const bedroomAnalysis = {
    '乾': {
      score: 85,
      pros: ['领导力增强', '事业运势提升'],
      cons: ['过于刚硬', '需柔和装饰平衡'],
      tips: ['放置圆润家具', '用红色点缀']
    },
    '坤': {
      score: 80,
      pros: ['睡眠安稳', '感情和睦'],
      cons: ['行动力减弱', '需适当运动'],
      tips: ['保持整洁', '放置陶瓷饰品']
    },
    '震': {
      score: 75,
      pros: ['事业突破', '贵人运强'],
      cons: ['情绪波动大', '需静心'],
      tips: ['放置绿植', '避免尖锐物品']
    },
    '巽': {
      score: 78,
      pros: ['思维活跃', '学习运佳'],
      cons: ['易犹豫不决', '需果断'],
      tips: ['保持空气流通', '放置文昌塔']
    },
    '坎': {
      score: 70,
      pros: ['智慧提升', '财运渐佳'],
      cons: ['健康需注意', '多运动'],
      tips: ['保持干燥', '放置属火物品']
    },
    '离': {
      score: 82,
      pros: ['名气提升', '桃花运佳'],
      cons: ['情绪波动', '需平和'],
      tips: ['避免强光直射', '放置水景装饰']
    },
    '艮': {
      score: 88,
      pros: ['健康安稳', '守财能力强'],
      cons: ['过于保守', '需突破'],
      tips: ['放置金属装饰', '适当变动布局']
    },
    '兑': {
      score: 76,
      pros: ['口才提升', '社交运佳'],
      cons: ['易起争执', '需忍让'],
      tips: ['放置鲜花', '保持明亮']
    }
  };
  
  return bedroomAnalysis[direction] || bedroomAnalysis['艮'];
}

/**
 * 分析办公室风水
 */
function analyzeOffice() {
  return {
    desk: {
      ideal: '背靠实墙，面朝门口或窗户',
      avoid: '背窗坐、横梁压顶',
      direction: '坐北朝南或坐东朝西'
    },
    wealth: {
      position: '大门对角线',
      tips: ['放置貔貅或金蟾', '保持整洁', '不放垃圾桶']
    },
    career: {
      position: '东或东南',
      tips: ['放置绿植', '文昌位放毛笔或书籍']
    },
    avoid: [
      '横梁压顶',
      '背后有窗户',
      '正对厕所门',
      '灯光直射头顶'
    ]
  };
}

/**
 * 生成颜色建议
 */
function generateColorAdvice(bazi) {
  const dayStem = bazi?.charAt(0) || '甲';
  const dayElements = {
    '甲': '木', '乙': '木', '丙': '火', '丁': '火',
    '戊': '土', '己': '土', '庚': '金', '辛': '金',
    '壬': '水', '癸': '水'
  };
  
  const element = dayElements[dayStem] || '土';
  
  const colorMap = {
    '木': { lucky: ['绿色', '青色', '蓝色'], avoid: ['白色', '金色'], reason: '木生火，绿色助木' },
    '火': { lucky: ['红色', '紫色', '绿色'], avoid: ['黑色', '蓝色'], reason: '火生土，红紫色助火' },
    '土': { lucky: ['黄色', '棕色', '红色'], avoid: ['绿色', '青色'], reason: '土生金，黄色助土' },
    '金': { lucky: ['白色', '金色', '黄色'], avoid: ['红色', '紫色'], reason: '金生水，白金色助金' },
    '水': { lucky: ['黑色', '蓝色', '白色'], avoid: ['黄色', '棕色'], reason: '水生木，蓝色助水' }
  };
  
  return colorMap[element] || colorMap['土'];
}

/**
 * 生成完整风水报告
 */
function generateFengShuiReport(bazi, year = new Date().getFullYear()) {
  const stars = getFlyingStars(year);
  const dayStem = bazi?.charAt(0) || '甲';
  
  // 流年分析
  let report = `
🏠 【风水分析报告】

━━━━━━━━━━━━━━━━━━━━

📅 流年：${year}年
🧮 八字：${bazi || '未提供'}

━━━━━━━━━━━━━━━━━━━━

✨ 流年飞星（${year}年）

`;
  
  for (const [star, position] of Object.entries(stars)) {
    // 中宫特殊处理
    if (position === '中宫' || position === '中') {
      report += `  ${star} → 中宫\n`;
      report += `    方位：中 | 五行：土\n`;
      report += `    财：平 | 健康：吉 | 事业：平\n\n`;
      continue;
    }
    const info = baGuaDirection[position] || {};
    const jiXiong = jiXiongDirections[position] || {};
    report += `  ${star} → ${info.direction || position}\n`;
    report += `    方位：${info.direction} | 五行：${info.element}\n`;
    report += `    财：${jiXiong.wealth} | 健康：${jiXiong.health} | 事业：${jiXiong.career}\n\n`;
  }
  
  // 财位分析
  const wealthPositions = analyzeWealthPosition(bazi, year);
  report += `
💰 财位分析

`;
  
  wealthPositions.forEach(pos => {
    report += `【${pos.type}】\n`;
    report += `  位置：${pos.location}\n`;
    report += `  说明：${pos.description}\n\n`;
  });
  
  // 颜色建议
  const colorAdvice = generateColorAdvice(dayStem);
  report += `
🎨 幸运颜色

  幸运色：${colorAdvice.lucky.join('、')}
  忌用色：${colorAdvice.avoid.join('、')}
  原因：${colorAdvice.reason}

`;
  
  // 方位分析
  report += `
🧭 各方位吉凶

`;
  
  for (const [gua, info] of Object.entries(baGuaDirection)) {
    const jx = jiXiongDirections[gua];
    if (jx) {
      report += `【${info.direction}】${gua}\n`;
      report += `  财：${jx.wealth} | 健康：${jx.health} | 事业：${jx.career} | 感情：${jx.love}\n`;
      report += `  布置建议：${info.trait}\n\n`;
    }
  }
  
  // 办公室风水
  const office = analyzeOffice();
  report += `
💼 办公室风水

  理想工位：${office.desk.ideal}
  宜朝向：${office.desk.direction}
  忌讳：${office.desk.avoid}

  财位布置：${office.wealth.tips.join('、')}
  事业位：${office.career.tips.join('、')}

`;
  
  // 综合建议
  report += `
💡 综合建议

  1. 财位保持整洁，避免堆放杂物
  2. 门口保持畅通，气流流通
  3. 每日开窗通风，引入新鲜气场
  4. 根据今日幸运色选择穿着或装饰
  5. 流年不利方位可用水景或绿植化解

`;
  
  return report;
}

// 主入口
const args = process.argv.slice(2);

if (args[0] === '--help' || args[0] === '-h') {
  console.log(`
🏠 风水分析

用法:
  node fengshui.js                    # 基础分析
  node fengshui.js <八字>             # 带八字分析
  node fengshui.js <八字> <年份>      # 指定年份

示例:
  node fengshui.js
  node fengshui.js 戊子
  node fengshui.js 戊子 2026
`);
} else {
  const bazi = args[0] || '';
  const year = parseInt(args[1]) || new Date().getFullYear();
  console.log(generateFengShuiReport(bazi, year));
}

module.exports = { 
  analyzeWealthPosition, 
  generateColorAdvice, 
  getFlyingStars,
  analyzeOffice 
};
