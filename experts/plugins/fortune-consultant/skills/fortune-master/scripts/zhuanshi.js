#!/usr/bin/env node
/**
 * 择吉选日脚本
 * 帮助用户选择：黄道吉日、开业、搬家、签约、订婚、装修、出行等好日子
 * 
 * 基于：紫微斗数、奇门遁甲、黄历建除十二神、彭祖百忌
 */

// ============================================================
// 内置农历/黄历算法（替代 lunar-typescript，无外部依赖）
// ============================================================

const _GAN  = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
const _ZHI  = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];

const _CHONG = { '子':'午','丑':'未','寅':'申','卯':'酉','辰':'戌','巳':'亥','午':'子','未':'丑','申':'寅','酉':'卯','戌':'辰','亥':'巳' };

const _JIAN_CHU = ['建','除','满','平','定','执','破','危','成','收','开','闭'];

const _JIAN_CHU_YI_JI = {
  '建': { yi: ['出行','上任','祭祀','求财'],         ji: ['嫁娶','动土','破土','安葬'] },
  '除': { yi: ['扫除','解除','移徙','沐浴'],         ji: ['嫁娶','破土','安葬','入殓'] },
  '满': { yi: ['嫁娶','开业','纳财','入宅'],         ji: ['出行','动土','破土','诉讼'] },
  '平': { yi: ['出行','移徙','求医','上任'],         ji: ['嫁娶','安葬','破土'] },
  '定': { yi: ['嫁娶','开业','签约','求财'],         ji: ['出行','诉讼','动土'] },
  '执': { yi: ['祭祀','纳财','捕猎','捉贼'],         ji: ['开业','嫁娶','移徙','出行'] },
  '破': { yi: [],                                   ji: ['开业','嫁娶','出行','移徙','动土','签约'] },
  '危': { yi: ['祭祀'],                             ji: ['出行','登高','嫁娶','开业'] },
  '成': { yi: ['开业','嫁娶','移徙','上任','出行'], ji: ['诉讼','破土'] },
  '收': { yi: ['纳财','收获','祭祀'],               ji: ['出行','嫁娶','动土','开业'] },
  '开': { yi: ['开业','嫁娶','出行','求财','移徙'], ji: ['入殓','安葬','破土'] },
  '闭': { yi: ['入殓','安葬','封穴'],               ji: ['开业','嫁娶','出行','动土'] }
};

const _PENG_ZU_GAN = {
  '甲':'甲不开仓财物耗散','乙':'乙不栽植千株不长','丙':'丙不修灶必见灾殃',
  '丁':'丁不剃头头必生疮','戊':'戊不受田田主不祥','己':'己不破券二比并亡',
  '庚':'庚不经络织机虚张','辛':'辛不合酱主人不尝','壬':'壬不决水更难提防',
  '癸':'癸不词讼理弱敌强'
};

function _getDayGanZhi(date) {
  const base = new Date('2024-01-01T12:00:00');
  const diff = Math.round((date - base) / 86400000);
  return _GAN[((diff % 10) + 10) % 10] + _ZHI[((diff % 12) + 12) % 12];
}

function _getZhiXing(date) {
  const m = date.getMonth() + 1;          // solar month 1-12
  const monthZhiIdx = m % 12;             // 1→丑(1), 2→寅(2)…12→子(0)
  const gz = _getDayGanZhi(date);
  const dayZhiIdx = _ZHI.indexOf(gz[1]);
  return _JIAN_CHU[((dayZhiIdx - monthZhiIdx) + 12) % 12];
}

/** 模拟 lunar-typescript Lunar 对象 */
function createLunarDate(date) {
  const gz       = _getDayGanZhi(date);
  const dayGan   = gz[0];
  const dayZhi   = gz[1];
  const zhiXing  = _getZhiXing(date);
  const chongZhi = _CHONG[dayZhi] || '';
  const yiji     = _JIAN_CHU_YI_JI[zhiXing] || { yi: [], ji: [] };
  return {
    getDayInGanZhi: () => gz,
    getDayGan:      () => dayGan,
    getDayZhi:      () => dayZhi,
    getZhiXing:     () => zhiXing,
    getDayYi:       () => yiji.yi,
    getDayJi:       () => yiji.ji,
    getPengZuGan:   () => _PENG_ZU_GAN[dayGan] || '',
    getChong:       () => chongZhi,
    getChongDesc:   () => `冲${chongZhi}`
  };
}

// ============================================
// 常量定义
// ============================================

// 天干地支
const TIAN_GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const DI_ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

// 地支对应五行
const ZHI_ELEMENT = {
  '子': '水', '丑': '土', '寅': '木', '卯': '木',
  '辰': '土', '巳': '火', '午': '火', '未': '土',
  '申': '金', '酉': '金', '戌': '土', '亥': '水'
};

// 天干对应五行
const GAN_ELEMENT = {
  '甲': '木', '乙': '木', '丙': '火', '丁': '火',
  '戊': '土', '己': '土', '庚': '金', '辛': '金',
  '壬': '水', '癸': '水'
};

// 五行颜色
const ELEMENT_COLOR = {
  '木': { color: '绿色、青色', direction: '东方' },
  '火': { color: '红色、紫色', direction: '南方' },
  '土': { color: '黄色、棕色', direction: '中央' },
  '金': { color: '白色、金色', direction: '西方' },
  '水': { color: '黑色、蓝色', direction: '北方' }
};

// 建除十二神序列
const JIAN_CHU = ['建', '除', '满', '平', '定', '执', '破', '危', '成', '收', '开', '闭'];

// 奇门遁甲九星
const NINE_STARS = [
  { name: '天蓬', element: '水', trait: '凶星', position: 1, good: false },
  { name: '天任', element: '土', trait: '凶星', position: 8, good: false },
  { name: '天冲', element: '木', trait: '吉星', position: 3, good: true },
  { name: '天辅', element: '木', trait: '吉星', position: 4, good: true },
  { name: '天英', element: '火', trait: '凶星', position: 9, good: false },
  { name: '天芮', element: '土', trait: '凶星', position: 2, good: false },
  { name: '天柱', element: '金', trait: '凶星', position: 7, good: false },
  { name: '天心', element: '金', trait: '吉星', position: 6, good: true },
  { name: '天禽', element: '土', trait: '大吉', position: 5, good: true }
];

// 奇门遁甲八门
const EIGHT_DOORS = [
  { name: '休门', element: '水', trait: '休息、平稳', good: true },
  { name: '生门', element: '土', trait: '生长、财运', good: true },
  { name: '伤门', element: '木', trait: '受伤、变动', good: false },
  { name: '杜门', element: '木', trait: '阻碍、保密', good: false },
  { name: '景门', element: '火', trait: '文化、虚假', good: false },
  { name: '死门', element: '土', trait: '死亡、凶险', good: false },
  { name: '惊门', element: '金', trait: '惊恐、口舌', good: false },
  { name: '开门', element: '金', trait: '开创、顺利', good: true }
];

// 时辰信息
const HOUR_INFO = {
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

// 活动类型与宜忌配合
const ACTIVITIES = {
  '开业': { good: ['开', '满', '定', '成', '收'], bad: ['闭', '破', '危', '建'] },
  '搬家': { good: ['满', '定', '平', '成', '收'], bad: ['破', '危', '闭', '建'] },
  '签约': { good: ['开', '定', '成', '满', '收'], bad: ['闭', '破', '危', '建'] },
  '订婚': { good: ['合', '定', '满', '成', '开'], bad: ['冲', '刑', '破', '危'] },
  '装修': { good: ['平', '满', '定', '成', '收'], bad: ['破', '冲', '危', '闭'] },
  '出行': { good: ['开', '定', '成', '满'], bad: ['闭', '破', '危', '建'] },
  '结婚': { good: ['合', '定', '满', '成', '开'], bad: ['冲', '刑', '破', '危'] },
  '祭祀': { good: ['建', '除', '满', '平'], bad: ['破', '闭'] },
  '求财': { good: ['开', '生', '满', '成', '收'], bad: ['闭', '破', '危'] },
  '上任': { good: ['开', '定', '成', '满'], bad: ['破', '危', '闭'] }
};

// ============================================
// 核心算法
// ============================================

/**
 * 获取指定月份的所有日期
 */
function getDatesInMonth(year, month) {
  const dates = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(new Date(year, month - 1, d));
  }
  return dates;
}

/**
 * 计算某日的奇门遁甲信息
 */
function calculateQimen(date) {
  const isYang = isYangDun(date);
  const zhiFu = getZhiFuStar(date, isYang);
  const zhiShi = getZhiShiDoor(date, isYang);
  
  return {
    isYang,
    zhiFu,
    zhiShi,
    goodStars: NINE_STARS.filter(s => s.good).map(s => s.name),
    goodDoors: EIGHT_DOORS.filter(d => d.good).map(d => d.name)
  };
}

/**
 * 判断阴遁还是阳遁
 */
function isYangDun(date = new Date()) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const yearDay = date.getMonth() * 30 + day;
  const summerSolstice = 5 * 30 + 21;
  const winterSolstice = 11 * 30 + 22;
  return yearDay < summerSolstice || yearDay > winterSolstice;
}

/**
 * 计算值符星
 */
function getZhiFuStar(date, isYang) {
  const baseDate = new Date('2024-01-01T12:00:00');
  const diffDays = Math.round((date - baseDate) / (1000 * 60 * 60 * 24));
  const hour = date.getHours();
  const shichen = Math.floor((hour + 1) / 2) % 12;
  const idx = ((diffDays * 12 + shichen) % 9 + 9) % 9;
  return isYang ? NINE_STARS[idx] : NINE_STARS[(9 - idx) % 9];
}

/**
 * 计算值使门
 */
function getZhiShiDoor(date, isYang) {
  const baseDate = new Date('2024-01-01T12:00:00');
  const diffDays = Math.round((date - baseDate) / (1000 * 60 * 60 * 24));
  const hour = date.getHours();
  const shichen = Math.floor((hour + 1) / 2) % 12;
  const idx = ((diffDays * 12 + shichen) % 8 + 8) % 8;
  return isYang ? EIGHT_DOORS[idx] : EIGHT_DOORS[(8 - idx) % 8];
}

/**
 * 获取某日吉时（基于五行）
 */
function getLuckyHoursForDate(date) {
  const lunarDate = createLunarDate(date);
  const ganZhi = lunarDate.getDayInGanZhi();
  const dayZhi = ganZhi[1];
  const dayElement = ZHI_ELEMENT[dayZhi] || '土';
  
  // 找出与日主五行相同或相生的时辰
  const luckyHours = [];
  for (const [zhi, elem] of Object.entries(ZHI_ELEMENT)) {
    if (elem === dayElement || (isSupportingElement(dayElement, elem))) {
      if (HOUR_INFO[zhi]) {
        luckyHours.push({ zhi, ...HOUR_INFO[zhi] });
      }
    }
  }
  
  return luckyHours.slice(0, 4);
}

/**
 * 判断是否相生
 */
function isSupportingElement(main, support) {
  const supportMap = { '木': '火', '火': '土', '土': '金', '金': '水', '水': '木' };
  return supportMap[main] === support;
}

/**
 * 评分日期
 */
function scoreDate(date, activityType, userDayStem = null) {
  const lunarDate = createLunarDate(date);
  const activity = ACTIVITIES[activityType] || ACTIVITIES['开业'];
  
  let score = 50; // 基础分
  const factors = [];
  
  // 1. 建除十二神评分
  const zhiXing = lunarDate.getZhiXing();
  const jianChuIndex = JIAN_CHU.indexOf(zhiXing);
  if (activity.good.includes(zhiXing)) {
    score += 20;
    factors.push({ name: '建除', value: `${zhiXing}日`, bonus: 20, good: true });
  } else if (activity.bad.includes(zhiXing)) {
    score -= 25;
    factors.push({ name: '建除', value: `${zhiXing}日`, bonus: -25, good: false });
  } else {
    score += 5;
    factors.push({ name: '建除', value: `${zhiXing}日`, bonus: 5, good: null });
  }
  
  // 2. 宜忌配合
  const dayYi = lunarDate.getDayYi() || [];
  const dayJi = lunarDate.getDayJi() || [];
  const yiMatch = activity.good.some(a => dayYi.some(y => y.includes(a)));
  const jiMatch = activity.bad.some(a => dayJi.some(j => j.includes(a)));
  
  if (yiMatch) score += 15;
  if (jiMatch) score -= 15;
  factors.push({ name: '宜忌', value: yiMatch ? '配合较好' : '一般', bonus: yiMatch ? 15 : (jiMatch ? -15 : 0), good: yiMatch ? true : (jiMatch ? false : null) });
  
  // 3. 彭祖百忌（检查是否与日干相冲）
  const pengZuGan = lunarDate.getPengZuGan();
  const dayGan = lunarDate.getDayGan();
  if (pengZuGan && pengZuGan.includes(dayGan)) {
    score -= 5;
  }
  
  // 4. 日冲评分
  const chong = lunarDate.getChong();
  const dayZhi = lunarDate.getDayZhi();
  if (userDayStem) {
    const userElement = GAN_ELEMENT[userDayStem] || '';
    const chongElement = ZHI_ELEMENT[chong] || '';
    if (isSameElement(userElement, chongElement)) {
      score -= 20;
      factors.push({ name: '日冲', value: `${chong}（${lunarDate.getChongDesc()}）`, bonus: -20, good: false });
    } else {
      factors.push({ name: '日冲', value: `${chong}（${lunarDate.getChongDesc()}）`, bonus: 0, good: null });
    }
  } else {
    factors.push({ name: '日冲', value: `${chong}（${lunarDate.getChongDesc()}）`, bonus: 0, good: null });
  }
  
  // 5. 奇门遁甲吉凶
  const qimen = calculateQimen(date);
  if (qimen.zhiFu.good) {
    score += 10;
    factors.push({ name: '值符', value: qimen.zhiFu.name, bonus: 10, good: true });
  } else {
    factors.push({ name: '值符', value: qimen.zhiFu.name, bonus: 0, good: false });
  }
  
  if (qimen.zhiShi.good) {
    score += 10;
    factors.push({ name: '值使', value: qimen.zhiShi.name, bonus: 10, good: true });
  } else {
    factors.push({ name: '值使', value: qimen.zhiShi.name, bonus: 0, good: false });
  }
  
  // 6. 五行配合（如果提供了用户日干）
  if (userDayStem) {
    const userElement = GAN_ELEMENT[userDayStem];
    const dayElement = GAN_ELEMENT[dayGan];
    if (isSupportingElement(userElement, dayElement)) {
      score += 15;
      factors.push({ name: '五行', value: `日主${dayElement}生助我${userElement}`, bonus: 15, good: true });
    } else if (isSupportingElement(dayElement, userElement)) {
      score += 10;
      factors.push({ name: '五行', value: `我${userElement}生日主${dayElement}`, bonus: 10, good: true });
    } else if (userElement === dayElement) {
      score += 5;
      factors.push({ name: '五行', value: `比和${dayElement}`, bonus: 5, good: true });
    } else {
      score -= 10;
      factors.push({ name: '五行', value: `相克`, bonus: -10, good: false });
    }
  }
  
  // 限制分数范围
  score = Math.max(0, Math.min(100, score));
  
  return {
    score,
    factors,
    zhiXing,
    dayGanZhi: lunarDate.getDayInGanZhi(),
    dayGan,
    dayZhi,
    pengZuGan: lunarDate.getPengZuGan(),
    chong: lunarDate.getChong(),
    chongDesc: lunarDate.getChongDesc(),
    dayYi,
    dayJi,
    qimen,
    luckyHours: getLuckyHoursForDate(date)
  };
}

/**
 * 判断是否同元素
 */
function isSameElement(elem1, elem2) {
  return elem1 && elem2 && elem1 === elem2;
}

/**
 * 获取八字日主
 */
function getDayStemFromBazi(bazi) {
  if (!bazi) return null;
  // bazi 格式: "庚午 辛巳 庚辰 辛巳" (年 月 日 时)
  const parts = bazi.split(/\s+/);
  if (parts.length >= 3) {
    const dayGanZhi = parts[2];
    return dayGanZhi[0]; // 取天干
  }
  return null;
}

/**
 * 格式化星级
 */
function formatStars(score) {
  const stars = Math.round(score / 20);
  return '⭐'.repeat(stars) + '☆'.repeat(5 - stars);
}

// ============================================
// 报告生成
// ============================================

/**
 * 生成择日报告
 */
function generateReport(year, month, activityType, userBazi = null) {
  const userDayStem = userBazi ? getDayStemFromBazi(userBazi) : null;
  const dates = getDatesInMonth(year, month);
  const dayMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  
  const results = dates.map(date => {
    const scoreResult = scoreDate(date, activityType, userDayStem);
    return {
      date,
      dateStr: `${month}月${date.getDate()}日`,
      weekDay: dayMap[date.getDay()],
      ...scoreResult
    };
  });
  
  // 排序：按分数降序
  results.sort((a, b) => b.score - a.score);
  
  // 分类
  const avoidDates = results.filter(r => r.score < 30);
  const goodDates = results.filter(r => r.score >= 70).slice(0, 5);
  const mediumDates = results.filter(r => r.score >= 50 && r.score < 70).slice(0, 5);
  
  // 生成报告
  let report = `
🎯 ${year}年${month}月 最佳吉日（${activityType}）

━━━━━━━━━━━━━━━━━━━━
`;
  
  if (goodDates.length > 0) {
    const best = goodDates[0];
    report += `
🏆 综合最优（${activityType}）
   ${best.dateStr}（${best.weekDay}）${formatStars(best.score)} ${best.score}分
   吉时：${best.luckyHours.map(h => `${h.range}点（${h.zhi}时）`).join('、')}
   干支：${best.dayGanZhi}
   建除：${best.zhiXing}日
   冲：${best.chong}${best.chongDesc}
   彭祖：${best.pengZuGan}
   宜：${best.dayYi.slice(0, 4).join('、')}
   忌：${best.dayJi.slice(0, 3).join('、')}
`;
    
    // 奇门信息
    report += `
   【奇门遁甲】
   遁局：${best.qimen.isYang ? '阳遁' : '阴遁'}
   值符：${best.qimen.zhiFu.name}（${best.qimen.zhiFu.trait}）
   值使：${best.qimen.zhiShi.name}（${best.qimen.zhiShi.trait}）
`;
  }
  
  if (mediumDates.length > 0) {
    report += `
━━━━━━━━━━━━━━━━━━━━

📅 其他推荐
`;
    mediumDates.forEach(d => {
      report += `
   ${d.dateStr}（${d.weekDay}）${formatStars(d.score)} ${d.score}分
   干支：${d.dayGanZhi} | 建除：${d.zhiXing}日 | 冲：${d.chong}${d.chongDesc}
`;
    });
  }
  
  if (avoidDates.length > 0) {
    report += `
━━━━━━━━━━━━━━━━━━━━

⚠️ 避免日期
`;
    avoidDates.slice(0, 3).forEach(d => {
      report += `
   ${d.dateStr}（${d.weekDay}）❌ ${d.score}分
   原因：${d.factors.filter(f => f.bonus < 0).map(f => `${f.name}${f.value}`).join('、')}
   冲：${d.chong}${d.chongDesc}
`;
    });
  }
  
  report += `
━━━━━━━━━━━━━━━━━━━━

💡 评分说明
   • 分数范围：0-100分
   • ⭐⭐⭐⭐⭐ = 80-100分（极佳）
   • ⭐⭐⭐⭐ = 60-79分（良好）
   • ⭐⭐⭐ = 40-59分（一般）
   • ⭐⭐ = 20-39分（欠佳）
   • ⭐ = 0-19分（避免）
   
   评分因素：建除十二神(±25)、宜忌配合(±15)、
   日冲(±20)、值符值使(±20)、五行生克(±15)
`;
  
  if (userBazi) {
    report += `
   用户日主：${userDayStem}（${GAN_ELEMENT[userDayStem]}）
`;
  }
  
  return report;
}

/**
 * 查找最佳日期
 */
function findBestDate(year, month, activityType, userBazi = null) {
  const userDayStem = userBazi ? getDayStemFromBazi(userBazi) : null;
  const dates = getDatesInMonth(year, month);
  
  let bestDate = null;
  let bestScore = -1;
  
  for (const date of dates) {
    const result = scoreDate(date, activityType, userDayStem);
    if (result.score > bestScore) {
      bestScore = result.score;
      bestDate = { date, ...result };
    }
  }
  
  return bestDate;
}

// ============================================
// 主入口
// ============================================

const args = process.argv.slice(2);

function showHelp() {
  console.log(`
📅 择吉选日脚本

用法:
  node zhuanshi.js <YYYY-MM> <活动类型> [用户八字]
  node zhuanshi.js best <YYYY-MM> <活动类型> [用户八字]

活动类型:
  开业、搬家、签约、订婚、装修、出行、结婚、祭祀、求财、上任

示例:
  node zhuanshi.js 2026-04 开业
  node zhuanshi.js 2026-04 签约 "庚午 辛巳 庚辰 辛巳"
  node zhuanshi.js best 2026-04 搬家
`);
}

if (args[0] === '--help' || args[0] === '-h') {
  showHelp();
  process.exit(0);
}

// 解析参数
if (args.length < 2) {
  console.error('参数不足');
  showHelp();
  process.exit(1);
}

let year, month, activityType, userBazi;
let findBest = false;

if (args[0] === 'best') {
  findBest = true;
  const dateMatch = args[1].match(/^(\d{4})-(\d{2})$/);
  if (!dateMatch) {
    console.error('日期格式错误，请使用 YYYY-MM');
    process.exit(1);
  }
  year = parseInt(dateMatch[1]);
  month = parseInt(dateMatch[2]);
  activityType = args[2] || '开业';
  userBazi = args[3] || null;
} else {
  const dateMatch = args[0].match(/^(\d{4})-(\d{2})$/);
  if (!dateMatch) {
    console.error('日期格式错误，请使用 YYYY-MM');
    process.exit(1);
  }
  year = parseInt(dateMatch[1]);
  month = parseInt(dateMatch[2]);
  activityType = args[1] || '开业';
  userBazi = args[2] || null;
}

if (month < 1 || month > 12) {
  console.error('月份无效，请使用 1-12');
  process.exit(1);
}

if (!Object.keys(ACTIVITIES).includes(activityType)) {
  console.warn(`警告：未知的活动类型 "${activityType}"，使用默认值"开业"`);
  activityType = '开业';
}

console.log(`
╭──────────────────────────────────────╮
│       🔮 择吉选日分析中...           │
╰──────────────────────────────────────╯
`);

console.log(`📋 分析条件`);
console.log(`   日期：${year}年${month}月`);
console.log(`   活动：${activityType}`);
if (userBazi) console.log(`   用户八字：${userBazi}`);
console.log('');

if (findBest) {
  const best = findBestDate(year, month, activityType, userBazi);
  const dayMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const stars = formatStars(best.score);
  
  console.log(`
🏆 ${year}年${month}月最佳吉日

${best.date.getMonth() + 1}月${best.date.getDate()}日（${dayMap[best.date.getDay()]}）${stars} ${best.score}分

📊 详细信息
   干支：${best.dayGanZhi}
   建除：${best.zhiXing}日
   冲：${best.chong}${best.chongDesc}
   彭祖：${best.pengZuGan}

⏰ 吉时
${best.luckyHours.map(h => `   • ${h.zhi}时（${h.range}点）- ${h.tip}`).join('\n')}

✅ 宜
   ${best.dayYi.slice(0, 5).join('、')}

❌ 忌
   ${best.dayJi.slice(0, 4).join('、')}

【奇门遁甲】
   遁局：${best.qimen.isYang ? '阳遁' : '阴遁'}
   值符：${best.qimen.zhiFu.name}（${best.qimen.zhiFu.element}，${best.qimen.zhiFu.trait}）
   值使：${best.qimen.zhiShi.name}（${best.qimen.zhiShi.element}，${best.qimen.zhiShi.trait}）
`);
} else {
  console.log(generateReport(year, month, activityType, userBazi));
}
