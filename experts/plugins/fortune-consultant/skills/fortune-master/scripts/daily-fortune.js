#!/usr/bin/env node
/**
 * 每日运程生成脚本
 * 生成当日运程报告：综合指数、穿衣颜色、宜忌、风险提示、吉时
 */

const dayMap = ['日', '一', '二', '三', '四', '五', '六'];
const monthMap = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];

// 五行颜色对应
const fiveElements = {
  '木': { color: '绿色、青色', direction: '东方', lucky: '招贵人运' },
  '火': { color: '红色、紫色', direction: '南方', lucky: '增事业运' },
  '土': { color: '黄色、棕色', direction: '中央', lucky: '稳财运' },
  '金': { color: '白色、金色', direction: '西方', lucky: '旺事业' },
  '水': { color: '黑色、蓝色', direction: '北方', lucky: '防水逆' }
};

// 地支对应五行
const zhiElement = {
  '子': '水', '丑': '土', '寅': '木', '卯': '木',
  '辰': '土', '巳': '火', '午': '火', '未': '土',
  '申': '金', '酉': '金', '戌': '土', '亥': '水'
};

//时辰信息
const hourInfo = {
  '子': { range: '23-01', element: '水', tip: '整理思考' },
  '丑': { range: '01-03', element: '土', tip: '睡眠休息' },
  '寅': { range: '03-05', element: '木', tip: '计划准备' },
  '卯': { range: '05-07', element: '木', tip: '晨间运动' },
  '辰': { range: '07-09', element: '土', tip: '贵人运佳' },
  '巳': { range: '09-11', element: '火', tip: '事业高峰' },
  '午': { range: '11-13', element: '火', tip: '财运旺盛' },
  '未': { range: '13-15', element: '土', tip: '平稳行事' },
  '申': { range: '15-17', element: '金', tip: '财运佳' },
  '酉': { range: '17-19', element: '金', tip: '收整理' },
  '戌': { range: '19-21', element: '土', tip: '社交应酬' },
  '亥': { range: '21-23', element: '水', tip: '学习思考' }
};

// 宜忌（简化版）
const yiJi = {
  '木': { yi: ['出行', '学习', '交友', '谈判'], ji: ['冒险', '投资', '手术'] },
  '火': { yi: ['表白', '签约', '创新', '表演'], ji: ['安葬', '搬家', '诉讼'] },
  '土': { yi: ['种植', '装修', '求职', '上任'], ji: ['动土', '开业', '破土'] },
  '金': { yi: ['上任', '洽谈', '收款', '装修'], ji: ['安葬', '破土', '开业'] },
  '水': { yi: ['出行', '考试', '推广', '流动'], ji: ['搬家', '动土', '投资'] }
};

/**
 * 计算当日天干地支
 */
function getDayGanZhi(date = new Date()) {
  // 以2024年1月1日=甲子日为基准（取正午避免夏令时边界问题）
  const baseDate = new Date('2024-01-01T12:00:00');

  const diffDays = Math.round((date - baseDate) / (1000 * 60 * 60 * 24));
  const ganIndex = ((diffDays % 10) + 10) % 10; // 甲=0
  const zhiIndex = ((diffDays % 12) + 12) % 12; // 子=0
  
  const tianGan = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
  const diZhi = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
  
  return tianGan[ganIndex] + diZhi[zhiIndex];
}

/**
 * 获取五行信息
 */
function getElementInfo(ganZhi) {
  const zhi = ganZhi[1];
  const element = zhiElement[zhi] || '土';
  return fiveElements[element] || fiveElements['土'];
}

/**
 * 生成宜忌列表
 */
function getYiJiList(element) {
  const info = yiJi[element] || yiJi['土'];
  return {
    yi: info.yi.slice(0, 4),
    ji: info.ji.slice(0, 4)
  };
}

/**
 * 获取吉时
 */
function getLuckyHours(ganZhi) {
  const zhi = ganZhi[1];
  const element = zhiElement[zhi] || '土';
  
  // 根据五行找出当日旺的时辰
  const luckyZhi = Object.entries(zhiElement)
    .filter(([_, el]) => el === element)
    .map(([z]) => z);
  
  return luckyZhi.slice(0, 2).map(z => ({
    zhi: z,
    ...hourInfo[z]
  }));
}

/**
 * 生成风险提示
 */
function getRiskWarnings(ganZhi, dayOfWeek) {
  const warnings = [];
  const zhi = ganZhi[1];
  
  // 驿马星（地支对冲）
  const yimaZhi = ['申', '亥', '寅', '巳'];
  if (yimaZhi.includes(zhi)) {
    warnings.push({
      level: '🟡',
      type: '出行',
      msg: '今日驿马星动，出行注意安全'
    });
  }
  
  // 破日（地支相破）
  const poZhi = ['子', '午', '卯', '酉', '辰', '丑', '寅', '亥', '巳', '申', '戌', '未'];
  const poPairs = [['子', '丑'], ['寅', '亥'], ['卯', '戌'], ['辰', '酉'], ['巳', '申'], ['午', '未']];
  
  // 简单的风险判断
  if (dayOfWeek === 1 || dayOfWeek === 5) {
    warnings.push({
      level: '🟢',
      type: '综合',
      msg: '今日诸事顺遂，宜积极行动'
    });
  }
  
  return warnings;
}

/**
 * 生成运势评分
 */
function getFortuneScores(ganZhi) {
  const zhi = ganZhi[1];
  const element = zhiElement[zhi] || '土';
  
  // 根据五行生克简单评分
  const baseScores = {
    '木': { career: 4, wealth: 3, love: 4, health: 3 },
    '火': { career: 5, wealth: 4, love: 3, health: 3 },
    '土': { career: 3, wealth: 4, love: 3, health: 4 },
    '金': { career: 4, wealth: 5, love: 3, health: 3 },
    '水': { career: 3, wealth: 3, love: 4, health: 4 }
  };
  
  const scores = baseScores[element] || baseScores['土'];
  
  // 确定性微调：基于日干支和分类，同一日重复查看结果一致
  const hashJitter = (suffix) => {
    const str = ganZhi + suffix;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return ((hash % 100) / 100) * 0.8 - 0.4;
  };
  return {
    career: Math.min(5, Math.max(1, scores.career + hashJitter('career'))).toFixed(1),
    wealth: Math.min(5, Math.max(1, scores.wealth + hashJitter('wealth'))).toFixed(1),
    love: Math.min(5, Math.max(1, scores.love + hashJitter('love'))).toFixed(1),
    health: Math.min(5, Math.max(1, scores.health + hashJitter('health'))).toFixed(1)
  };
}

/**
 * 格式化星级
 */
function formatStars(score) {
  const num = parseFloat(score);
  const full = Math.floor(num);
  const half = num - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★'.repeat(full) + '☆'.repeat(half) + '☆'.repeat(empty);
}

/**
 * 生成完整运程报告
 */
function generateDailyFortune(date = new Date()) {
  const ganZhi = getDayGanZhi(date);
  const elementInfo = getElementInfo(ganZhi);
  const element = zhiElement[ganZhi[1]] || '土';
  const yiJiInfo = getYiJiList(element);
  const luckyHours = getLuckyHours(ganZhi);
  const warnings = getRiskWarnings(ganZhi, date.getDay());
  const scores = getFortuneScores(ganZhi);
  
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekDay = dayMap[date.getDay()];
  const monthName = monthMap[month - 1];
  
  // 生成运势语
  const fortuneQuotes = [
    '顺势而为，伺机而动',
    '稳中求进，步步为营',
    '阳光总在风雨后',
    '把握当下，展望未来',
    '积跬步以至千里'
  ];
  const quote = fortuneQuotes[date.getDate() % fortuneQuotes.length];
  
  // 组装报告
  const report = `
🌅 【私人命理顾问】${year}年${month}月${day}日（周${weekDay}）

📊 今日综合指数
   事业：${formatStars(scores.career)} ${scores.career}
   财运：${formatStars(scores.wealth)} ${scores.wealth}
   感情：${formatStars(scores.love)} ${scores.love}
   健康：${formatStars(scores.health)} ${scores.health}

🎨 幸运色：${elementInfo.color}（利${elementInfo.lucky}）
   幸运方位：${elementInfo.direction}

💼 今日宜忌
   ✅ 宜：${yiJiInfo.yi.join('、')}
   ❌ 忌：${yiJiInfo.ji.join('、')}

⚠️ 风险提示
${warnings.length > 0 ? warnings.map(w => `   ${w.level} 【${w.type}】${w.msg}`).join('\n') : '   🟢 今日总体平稳，无明显风险'}

⏰ 吉时
${luckyHours.map(h => `   • ${h.zhi}时（${h.range}点）- ${h.tip}`).join('\n')}

💡 今日一句
   「${quote}」

📅 干支：${ganZhi}（${elementInfo.direction.charAt(0)}气旺）
`;
  
  return report;
}

// 主入口
const args = process.argv.slice(2);
let date = new Date();

if (args[0]) {
  try {
    date = new Date(args[0]);
    if (isNaN(date.getTime())) {
      console.error('日期格式无效，请使用 YYYY-MM-DD');
      process.exit(1);
    }
  } catch (e) {
    console.error('日期解析错误:', e.message);
    process.exit(1);
  }
}

console.log(generateDailyFortune(date));
