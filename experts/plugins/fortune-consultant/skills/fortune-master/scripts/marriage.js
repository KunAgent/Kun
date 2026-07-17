#!/usr/bin/env node
/**
 * 合婚分析脚本
 * 根据八字分析两个人的婚姻适配度
 */

const fs = require('fs');
const path = require('path');

const PROFILES_DIR = path.join(__dirname, '../data/profiles');

/**
 * 加载用户档案
 */
function loadProfile(userId) {
  const filePath = path.join(PROFILES_DIR, `${userId}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * 天干信息
 */
const tianGan = {
  '甲': { element: '木', yin: '阳' },
  '乙': { element: '木', yin: '阴' },
  '丙': { element: '火', yin: '阳' },
  '丁': { element: '火', yin: '阴' },
  '戊': { element: '土', yin: '阳' },
  '己': { element: '土', yin: '阴' },
  '庚': { element: '金', yin: '阳' },
  '辛': { element: '金', yin: '阴' },
  '壬': { element: '水', yin: '阳' },
  '癸': { element: '水', yin: '阴' }
};

/**
 * 地支信息
 */
const diZhi = {
  '子': { element: '水', animal: '鼠' },
  '丑': { element: '土', animal: '牛' },
  '寅': { element: '木', animal: '虎' },
  '卯': { element: '木', animal: '兔' },
  '辰': { element: '土', animal: '龙' },
  '巳': { element: '火', animal: '蛇' },
  '午': { element: '火', animal: '马' },
  '未': { element: '土', animal: '羊' },
  '申': { element: '金', animal: '猴' },
  '酉': { element: '金', animal: '鸡' },
  '戌': { element: '土', animal: '狗' },
  '亥': { element: '水', animal: '猪' }
};

/**
 * 五行生克关系
 */
const wuXingRelations = {
  '木': { sheng: '火', ke: '土' },
  '火': { sheng: '土', ke: '金' },
  '土': { sheng: '金', ke: '水' },
  '金': { sheng: '水', ke: '木' },
  '水': { sheng: '木', ke: '火' }
};

/**
 * 日主五行关系分析
 */
function analyzeDayMasterCompatibility(bazi1, bazi2) {
  const day1 = bazi1.charAt(0);
  const day2 = bazi2.charAt(0);
  
  const el1 = tianGan[day1]?.element;
  const el2 = tianGan[day2]?.element;
  
  if (!el1 || !el2) return { score: 0, reason: '日主五行无法确定' };
  
  let relation = '';
  let score = 50;
  
  if (wuXingRelations[el1]?.sheng === el2) {
    relation = `${day1}（${el1}）生 ${day2}（${el2}）`;
    score = 75;
  } else if (wuXingRelations[el1]?.ke === el2) {
    relation = `${day1}（${el1}）克 ${day2}（${el2}）`;
    score = 45;
  } else if (wuXingRelations[el2]?.sheng === el1) {
    relation = `${day2}（${el2}）生 ${day1}（${el1}）`;
    score = 70;
  } else if (wuXingRelations[el2]?.ke === el1) {
    relation = `${day2}（${el2}）克 ${day1}（${el1}）`;
    score = 40;
  } else if (el1 === el2) {
    relation = `日主同属${el1}，比和`;
    score = 60;
  }
  
  return { score, relation, el1, el2, day1, day2 };
}

/**
 * 纳音五行分析
 */
function analyzeNaYinCompatibility(bazi1, bazi2) {
  // 从八字中提取年柱
  const year1 = bazi1.split(' ')[0] || '';
  const year2 = bazi2.split(' ')[0] || '';
  
  const naYinMap = {
    '甲子': '海中金', '乙丑': '海中金',
    '丙寅': '炉中火', '丁卯': '炉中火',
    '戊辰': '大林木', '己巳': '大林木',
    '庚午': '路旁土', '辛未': '路旁土',
    '壬申': '剑锋金', '癸酉': '剑锋金',
    '甲戌': '山头火', '乙亥': '山头火',
    '丙子': '漳下水', '丁丑': '漳下水',
    '戊寅': '城头土', '己卯': '城头土',
    '庚辰': '白蜡金', '辛巳': '白蜡金',
    '壬午': '杨柳木', '癸未': '杨柳木',
    '甲申': '井泉水', '乙酉': '井泉水',
    '丙戌': '屋上土', '丁亥': '屋上土',
    '戊子': '霹雳火', '己丑': '霹雳火',
    '庚寅': '松柏木', '辛卯': '松柏木',
    '壬辰': '长流水', '癸巳': '长流水',
    '甲午': '沙中金', '乙未': '沙中金',
    '丙申': '山下火', '丁酉': '山下火',
    '戊戌': '平地木', '己亥': '平地木',
    '庚子': '壁上土', '辛丑': '壁上土',
    '壬寅': '金箔金', '癸卯': '金箔金',
    '甲辰': '覆灯火', '乙巳': '覆灯火',
    '丙午': '天河水', '丁未': '天河水',
    '戊申': '大驿土', '己酉': '大驿土',
    '庚戌': '钗钏金', '辛亥': '钗钏金',
    '壬子': '桑柘木', '癸丑': '桑柘木',
    '甲寅': '大溪水', '乙卯': '大溪水',
    '丙辰': '沙中土', '丁巳': '沙中土',
    '戊午': '天上火', '己未': '天上火',
    '庚申': '石榴木', '辛酉': '石榴木',
    '壬戌': '大海水', '癸亥': '大海水'
  };
  
  const ny1 = naYinMap[year1] || '未知';
  const ny2 = naYinMap[year2] || '未知';
  
  return { ny1, ny2 };
}

/**
 * 地支合冲分析
 */
function analyzeDiZhiRelation(zhi1, zhi2) {
  const heMap = {
    '子丑': '六合', '寅亥': '六合', '卯戌': '六合',
    '辰酉': '六合', '巳申': '六合', '午未': '六合',
    '寅午': '三合', '午戌': '三合', '子辰': '三合',
    '申子': '三合', '巳酉': '三合', '丑亥': '三合',
    '卯卯': '比和', '午午': '比和', '酉酉': '比和'
  };
  
  const chongMap = {
    '子午': '子午相冲', '丑未': '丑未相冲',
    '寅申': '寅申相冲', '卯酉': '卯酉相冲',
    '辰戌': '辰戌相冲', '巳亥': '巳亥相冲'
  };
  
  const key1 = zhi1 + zhi2;
  const key2 = zhi2 + zhi1;
  
  let result = '';
  if (heMap[key1]) result = heMap[key1];
  else if (heMap[key2]) result = heMap[key2];
  else if (chongMap[key1]) result = chongMap[key1];
  else if (chongMap[key2]) result = chongMap[key2];
  else result = '无特殊合冲';
  
  return result;
}

/**
 * 天干合分析
 */
function analyzeTianGanHe(bazi1, bazi2) {
  const day1 = bazi1.charAt(0);
  const day2 = bazi2.charAt(0);
  
  const heTian = {
    '甲己': '甲己合（中正之合）', '乙庚': '乙庚合（仁义之合）',
    '丙辛': '丙辛合（威制之合）', '丁壬': '丁壬合（淫昵之合）',
    '戊癸': '戊癸合（无情之合）'
  };
  
  const key = day1 + day2;
  const key2 = day2 + day1;
  
  return heTian[key] || heTian[key2] || '日主无天干相合';
}

/**
 * 计算综合评分
 */
function calculateOverallScore(dayScore, heResult, dzResult) {
  let score = dayScore;
  
  if (dzResult.includes('六合')) score += 15;
  else if (dzResult.includes('三合')) score += 10;
  else if (dzResult.includes('比和')) score += 5;
  else if (dzResult.includes('相冲')) score -= 15;
  
  if (heResult.includes('中正') || heResult.includes('仁义')) score += 10;
  else if (heResult.includes('淫昵')) score -= 5;
  else if (heResult.includes('无情')) score -= 10;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * 生成评价
 */
function getEvaluation(score) {
  if (score >= 85) return { grade: '★★★★★', level: '极佳', desc: '天作之合，百年好合' };
  if (score >= 70) return { grade: '★★★★☆', level: '优秀', desc: '缘分深厚，婚配吉祥' };
  if (score >= 55) return { grade: '★★★☆☆', level: '中等', desc: '缘分平平，需要磨合' };
  if (score >= 40) return { grade: '★★☆☆☆', level: '偏低', desc: '需要多沟通包容' };
  return { grade: '★☆☆☆☆', level: '较差', desc: '婚配欠佳，需谨慎' };
}

/**
 * 生成分析报告
 */
function generateReport(name1, bazi1, name2, bazi2) {
  const dayAnalysis = analyzeDayMasterCompatibility(bazi1, bazi2);
  const naYin = analyzeNaYinCompatibility(bazi1, bazi2);
  
  // 解析八字（格式："庚午 辛巳 庚辰 癸未"）
  const parseBazi = (bazi) => {
    const parts = bazi.split(' ');
    return {
      year: parts[0] || '',
      month: parts[1] || '',
      day: parts[2] || '',
      hour: parts[3] || '',
      yearZhi: (parts[0] || '').charAt(1),
      monthZhi: (parts[1] || '').charAt(1),
      dayZhi: (parts[2] || '').charAt(1),
      hourZhi: (parts[3] || '').charAt(1)
    };
  };
  
  const p1 = parseBazi(bazi1);
  const p2 = parseBazi(bazi2);
  
  const zhiPairs = [
    { name: '年柱', z1: p1.yearZhi, z2: p2.yearZhi },
    { name: '月柱', z1: p1.monthZhi, z2: p2.monthZhi },
    { name: '日柱', z1: p1.dayZhi, z2: p2.dayZhi },
    { name: '时柱', z1: p1.hourZhi, z2: p2.hourZhi }
  ];
  
  const heResult = analyzeTianGanHe(bazi1, bazi2);
  
  const dzResults = zhiPairs.map(p => ({
    name: p.name,
    z1: p.z1,
    z2: p.z2,
    relation: analyzeDiZhiRelation(p.z1, p.z2)
  }));
  
  const overallScore = calculateOverallScore(dayAnalysis.score, heResult, dzResults[0].relation);
  const evaluation = getEvaluation(overallScore);
  
  let report = `
💕 【合婚分析报告】

━━━━━━━━━━━━━━━━━━━━

👤 男方：${name1}
   八字：${bazi1}
   日主：${dayAnalysis.day1}（${dayAnalysis.el1}）

👤 女方：${name2}
   八字：${bazi2}
   日主：${dayAnalysis.day2}（${dayAnalysis.el2}）

━━━━━━━━━━━━━━━━━━━━

📊 合婚评分

   ${evaluation.grade} ${evaluation.level}
   综合得分：${overallScore}分（满分100）

━━━━━━━━━━━━━━━━━━━━

🔮 详细分析

【日主关系】
   ${dayAnalysis.relation}
   ${overallScore >= 60 ? '✅ 日主关系良好' : overallScore >= 40 ? '⚠️ 日主关系一般' : '❌ 日主关系欠佳'}

【纳音五行】
   男：${naYin.ny1}
   女：${naYin.ny2}
   ${naYin.ny1 === naYin.ny2 ? '✅ 纳音相同，五行和谐' : '📝 纳音不同，需注意调和'}

【天干相合】
   ${heResult}

【地支关系】
`;
  
  dzResults.forEach(p => {
    report += `   ${p.name}（${p.z1} vs ${p.z2}）：${p.relation}\n`;
  });
  
  report += `
━━━━━━━━━━━━━━━━━━━━

💡 综合建议

`;
  
  if (overallScore >= 70) {
    report += `
🎉 恭喜！你们的八字非常相配。

• 日主关系和谐
• ${heResult.includes('合') ? '天干相合，感情纽带强' : '可多培养共同兴趣'}
• ${dzResults.filter(p => p.relation.includes('合')).length >= 2 ? '多柱相合，缘分深厚' : '虽有冲克，但可化解'}

💕 婚姻展望：
   婚后生活较和谐稳定，双方能互相理解支持。
`;
  } else if (overallScore >= 50) {
    report += `
📝 中等缘分，需要用心经营。

• 日主关系${dayAnalysis.score >= 50 ? '尚可' : '需加强'}
• 建议多沟通，了解彼此需求
• 注意${dzResults.find(p => p.relation.includes('冲'))?.name || '相关'}地支的影响

💡 婚姻建议：
   婚后需要双方共同努力，多包容理解。
`;
  } else {
    report += `
⚠️ 缘分较弱，需要谨慎对待。

• 存在一定婚配障碍
• 建议深入了解后再做结婚决定
• 如坚持在一起，需要更多磨合

⚠️ 注意事项：
   重点关注事业、感情沟通方面。
`;
  }
  
  return report;
}

// 主入口
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log(`
💕 合婚分析

用法:
  node marriage.js <userId1> <userId2>
  node marriage.js <name1> <bazi1> <name2> <bazi2>

示例:
  node marriage.js 111111 222222
  node marriage.js 张三 "甲子 乙丑 丙寅 丁卯" 李四 "庚午 辛巳 庚辰 癸未"
`);
  process.exit(1);
}

let name1, bazi1, name2, bazi2;

// 判断输入模式：2个参数=从档案加载，4个参数=直接输入
if (args.length === 2) {
  const profile1 = loadProfile(args[0]);
  const profile2 = loadProfile(args[1]);
  
  if (!profile1 || !profile2) {
    console.log('❌ 未找到用户档案');
    process.exit(1);
  }
  
  name1 = profile1.name;
  name2 = profile2.name;
  bazi1 = profile1.bazi.year + ' ' + profile1.bazi.month + ' ' + profile1.bazi.day + ' ' + profile1.bazi.hour;
  bazi2 = profile2.bazi.year + ' ' + profile2.bazi.month + ' ' + profile2.bazi.day + ' ' + profile2.bazi.hour;
  
  console.log('📋 从档案加载\n');
} else {
  name1 = args[0];
  bazi1 = args[1];
  name2 = args[2];
  bazi2 = args[3];
}

console.log(generateReport(name1, bazi1, name2, bazi2));

module.exports = { generateReport, analyzeDayMasterCompatibility };
