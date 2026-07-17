#!/usr/bin/env node
/**
 * 奇门遁甲排盘脚本（七步正统排盘法）
 *
 * 七步流程：
 *   1. 确定阴阳遁（根据节气）
 *   2. 定局数（节气 + 上/中/下元 → 1~9局）
 *   3. 排地盘（三奇六仪按洛书飞布）
 *   4. 排天盘（九星随值符移动）
 *   5. 排人盘（八门随值使移动）
 *   6. 排神盘（八神随值符宫位排列）
 *   7. 生成九宫综合报告
 */

// ═══════════════════════════════════════════════════
// 基础数据
// ═══════════════════════════════════════════════════

// 天干
const TIAN_GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];

// 地支
const DI_ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

// 洛书飞布路径：中5 → 乾6 → 兑7 → 艮8 → 离9 → 坎1 → 坤2 → 震3 → 巽4
const LUOSHU_PATH = [5, 6, 7, 8, 9, 1, 2, 3, 4];

// 九宫基本信息
const PALACE_INFO = {
  1: { name: '坎', direction: '北',   element: '水' },
  2: { name: '坤', direction: '西南', element: '土' },
  3: { name: '震', direction: '东',   element: '木' },
  4: { name: '巽', direction: '东南', element: '木' },
  5: { name: '中', direction: '中',   element: '土' },
  6: { name: '乾', direction: '西北', element: '金' },
  7: { name: '兑', direction: '西',   element: '金' },
  8: { name: '艮', direction: '东北', element: '土' },
  9: { name: '离', direction: '南',   element: '火' }
};

// 九星：原始宫位 → 星名
const STAR_BY_PALACE = {
  1: { name: '天蓬', element: '水', trait: '凶' },
  2: { name: '天芮', element: '土', trait: '凶' },
  3: { name: '天冲', element: '木', trait: '吉' },
  4: { name: '天辅', element: '木', trait: '吉' },
  5: { name: '天禽', element: '土', trait: '中' },
  6: { name: '天心', element: '金', trait: '吉' },
  7: { name: '天柱', element: '金', trait: '凶' },
  8: { name: '天任', element: '土', trait: '吉' },
  9: { name: '天英', element: '火', trait: '凶' }
};

// 八门：原始宫位 → 门名
const DOOR_BY_PALACE = {
  1: { name: '休门', element: '水', trait: '吉',   meaning: '休息、平和' },
  2: { name: '死门', element: '土', trait: '大凶', meaning: '死气、衰败' },
  3: { name: '伤门', element: '木', trait: '凶',   meaning: '伤害、竞争' },
  4: { name: '杜门', element: '木', trait: '中',   meaning: '闭塞、隐藏' },
  6: { name: '开门', element: '金', trait: '吉',   meaning: '开拓、通达' },
  7: { name: '惊门', element: '金', trait: '凶',   meaning: '惊恐、口舌' },
  8: { name: '生门', element: '土', trait: '大吉', meaning: '生机、财源' },
  9: { name: '景门', element: '火', trait: '吉',   meaning: '文化、扬名' }
};

// 八神（排列顺序）
const EIGHT_SPIRITS = [
  '值符', '螣蛇', '太阴', '六合', '白虎', '玄武', '九地', '九天'
];

// 六仪三奇完整序列（排地盘用）
const YI_QI_SEQUENCE = ['戊', '己', '庚', '辛', '壬', '癸', '丁', '丙', '乙'];

// 六甲遁干映射：旬首 → 所遁天干
const XUN_SHOU_DUN = {
  '甲子': '戊', '甲戌': '己', '甲申': '庚',
  '甲午': '辛', '甲辰': '壬', '甲寅': '癸'
};

// 六旬旬首表（日干/时干 → 旬首）
const XUN_TABLE = [
  { start: 0,  name: '甲子', gan: '甲', zhi: '子' },
  { start: 10, name: '甲戌', gan: '甲', zhi: '戌' },
  { start: 20, name: '甲申', gan: '甲', zhi: '申' },
  { start: 30, name: '甲午', gan: '甲', zhi: '午' },
  { start: 40, name: '甲辰', gan: '甲', zhi: '辰' },
  { start: 50, name: '甲寅', gan: '甲', zhi: '寅' }
];

// ═══════════════════════════════════════════════════
// 节气数据
// ═══════════════════════════════════════════════════

// 24节气顺序（从小寒开始，按黄道经度排列）
const SOLAR_TERMS = [
  { name: '小寒', lon: 285 }, { name: '大寒', lon: 300 },
  { name: '立春', lon: 315 }, { name: '雨水', lon: 330 },
  { name: '惊蛰', lon: 345 }, { name: '春分', lon: 0 },
  { name: '清明', lon: 15 },  { name: '谷雨', lon: 30 },
  { name: '立夏', lon: 45 },  { name: '小满', lon: 60 },
  { name: '芒种', lon: 75 },  { name: '夏至', lon: 90 },
  { name: '小暑', lon: 105 }, { name: '大暑', lon: 120 },
  { name: '立秋', lon: 135 }, { name: '处暑', lon: 150 },
  { name: '白露', lon: 165 }, { name: '秋分', lon: 180 },
  { name: '寒露', lon: 195 }, { name: '霜降', lon: 210 },
  { name: '立冬', lon: 225 }, { name: '小雪', lon: 240 },
  { name: '大雪', lon: 255 }, { name: '冬至', lon: 270 }
];

// 阳遁用局表：节气 → [上元, 中元, 下元]
const YANG_DUN_TABLE = {
  '冬至': [1, 7, 4], '小寒': [2, 8, 5], '大寒': [3, 9, 6],
  '立春': [8, 5, 2], '雨水': [9, 6, 3], '惊蛰': [1, 7, 4],
  '春分': [3, 9, 6], '清明': [4, 1, 7], '谷雨': [5, 2, 8],
  '立夏': [4, 1, 7], '小满': [5, 2, 8], '芒种': [6, 3, 9]
};

// 阴遁用局表：节气 → [上元, 中元, 下元]
const YIN_DUN_TABLE = {
  '夏至': [9, 3, 6], '小暑': [8, 2, 5], '大暑': [7, 1, 4],
  '立秋': [2, 5, 8], '处暑': [1, 4, 7], '白露': [9, 3, 6],
  '秋分': [7, 1, 4], '寒露': [6, 9, 3], '霜降': [5, 8, 2],
  '立冬': [6, 9, 3], '小雪': [5, 8, 2], '大雪': [4, 7, 1]
};

// ═══════════════════════════════════════════════════
// 太阳黄道经度计算（简化VSOP87）
// ═══════════════════════════════════════════════════

const DEG = Math.PI / 180;

function sunLongitude(jd) {
  const T = (jd - 2451545.0) / 36525;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * DEG;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
  return ((L0 + C) % 360 + 360) % 360;
}

function jdeAtLongitude(year, targetLon) {
  let jd = 2451545.0 + (year - 2000 + ((targetLon - 280.46 + 360) % 360) / 360) * 365.2422;
  for (let i = 0; i < 50; i++) {
    let diff = ((targetLon - sunLongitude(jd) + 540) % 360) - 180;
    if (Math.abs(diff) < 1e-6) break;
    jd += (diff / 360) * 365.2422;
  }
  return jd;
}

function jdToCST(jde) {
  const jd = jde + 8 / 24;
  const z = Math.floor(jd + 0.5);
  let a = z;
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const day   = b - d - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const yr    = month > 2 ? c - 4716 : c - 4715;
  return { year: yr, month, day };
}

// 缓存节气日期
const _jqCache = new Map();
function cachedJdeAtLon(year, lon) {
  const key = `${year}:${lon}`;
  if (!_jqCache.has(key)) _jqCache.set(key, jdToCST(jdeAtLongitude(year, lon)));
  return _jqCache.get(key);
}

// ═══════════════════════════════════════════════════
// Step 0: 基础历法工具
// ═══════════════════════════════════════════════════

/** 计算指定日期的日干支 */
function getDayGanZhi(date) {
  // 基准：2024年1月1日 = 甲子日
  const baseDate = new Date('2024-01-01T12:00:00');
  const diffDays = Math.round((date.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24));
  const ganIdx = ((diffDays % 10) + 10) % 10;
  const zhiIdx = ((diffDays % 12) + 12) % 12;
  return TIAN_GAN[ganIdx] + DI_ZHI[zhiIdx];
}

/** 计算时干支（需传入日干和小时） */
function getHourGanZhi(dayGan, hour) {
  // 时支：23~1子, 1~3丑, ..., 21~23亥
  const zhiIdx = Math.floor(((hour + 1) % 24) / 2);
  // 时干：甲己日起甲子时，乙庚日起丙子时，丙辛日起戊子时，丁壬日起庚子时，戊癸日起壬子时
  const dayGanIdx = TIAN_GAN.indexOf(dayGan);
  const baseGanIdx = (dayGanIdx % 5) * 2; // 0,2,4,6,8
  const ganIdx = (baseGanIdx + zhiIdx) % 10;
  return TIAN_GAN[ganIdx] + DI_ZHI[zhiIdx];
}

/** 找旬首：给定干支的60甲子序号，找出所属旬 */
function getXunShou(ganZhi) {
  const gan = ganZhi[0];
  const zhi = ganZhi[1];
  const ganIdx = TIAN_GAN.indexOf(gan);
  const zhiIdx = DI_ZHI.indexOf(zhi);
  // 60甲子序号
  const idx60 = ((ganIdx - zhiIdx) % 10 + 10) % 10 === 0
    ? ganIdx  // 天干地支序号之差为0的倍数时，可直接用
    : -1;
  // 简化：用60甲子序号计算
  const num60 = ((ganIdx + 10 - (zhiIdx % 10)) % 10 === 0)
    ? (ganIdx * 6 - zhiIdx * 5 + 600) % 60
    : 0;
  // 更可靠的方法：直接遍历六旬
  for (const xun of XUN_TABLE) {
    const xunGanIdx = TIAN_GAN.indexOf(xun.gan);
    const xunZhiIdx = DI_ZHI.indexOf(xun.zhi);
    const xun60 = xun.start;
    // 检查 ganZhi 是否在此旬中
    const gan60 = ((ganIdx - xunGanIdx + 10) % 10); // 在旬中的偏移
    const zhi60 = ((zhiIdx - xunZhiIdx + 12) % 12); // 在旬中的偏移
    if (gan60 === zhi60 && gan60 < 10) {
      return xun;
    }
  }
  // fallback: 用日干支在60甲子中的绝对序号
  const absIdx = (ganIdx * 6 - zhiIdx * 5 + 600) % 60;
  const xunIdx = Math.floor(absIdx / 10);
  return XUN_TABLE[xunIdx];
}

/** 获取时辰序号 (0=子时, 1=丑时, ...) */
function getShiChenIdx(hour) {
  return Math.floor(((hour + 1) % 24) / 2);
}

// ═══════════════════════════════════════════════════
// Step 1: 确定阴阳遁
// ═══════════════════════════════════════════════════

/**
 * 获取当前节气名称
 * 返回最近的节气及其日期
 */
function getCurrentSolarTerm(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // 计算当年所有节气日期
  const termDates = SOLAR_TERMS.map(term => ({
    ...term,
    date: cachedJdeAtLon(year, term.lon)
  }));

  // 也加上前一年末的节气（处理跨年情况）
  const prevYearTerms = SOLAR_TERMS.slice(-4).map(term => ({
    ...term,
    date: cachedJdeAtLon(year - 1, term.lon)
  }));

  const allTerms = [...prevYearTerms, ...termDates];

  // 找到 date 之前最近的节气
  let current = null;
  for (let i = allTerms.length - 1; i >= 0; i--) {
    const t = allTerms[i];
    const tDate = new Date(t.date.year, t.date.month - 1, t.date.day);
    if (tDate <= date) {
      current = t;
      break;
    }
  }

  return current;
}

/**
 * Step 1: 判断阴阳遁
 * 冬至→夏至: 阳遁
 * 夏至→冬至: 阴遁
 */
function determineYinYangDun(date) {
  const year = date.getFullYear();

  // 获取前一年冬至、当年夏至、当年冬至的日期
  const prevDongzhi = cachedJdeAtLon(year - 1, 270);
  const xiazhi = cachedJdeAtLon(year, 90);
  const dongzhi = cachedJdeAtLon(year, 270);

  const prevDDate = new Date(prevDongzhi.year, prevDongzhi.month - 1, prevDongzhi.day);
  const xDate = new Date(xiazhi.year, xiazhi.month - 1, xiazhi.day);
  const dDate = new Date(dongzhi.year, dongzhi.month - 1, dongzhi.day);

  // 阳遁：前一年冬至 <= date < 当年夏至
  // 阴遁：当年夏至 <= date < 当年冬至
  // 阳遁：当年冬至 <= date
  if (date >= prevDDate && date < xDate) {
    return true;  // 阳遁（冬至到夏至）
  } else if (date >= xDate && date < dDate) {
    return false; // 阴遁（夏至到冬至）
  } else if (date >= dDate) {
    return true;  // 阳遁（过了当年冬至）
  } else {
    // date < 前一年冬至（理论上不应出现）
    return true;  // 默认阳遁
  }
}

// ═══════════════════════════════════════════════════
// Step 2: 定局数
// ═══════════════════════════════════════════════════

/**
 * 确定上/中/下元 (0=上, 1=中, 2=下)
 * 根据当前日干支的旬首来判断
 */
function getYuan(dayGanZhi) {
  const xun = getXunShou(dayGanZhi);
  // 甲子旬/甲午旬 → 上元
  // 甲戌旬/甲辰旬 → 中元
  // 甲申旬/甲寅旬 → 下元
  switch (xun.name) {
    case '甲子': case '甲午': return 0; // 上元
    case '甲戌': case '甲辰': return 1; // 中元
    case '甲申': case '甲寅': return 2; // 下元
    default: return 0;
  }
}

/**
 * Step 2: 计算局数 (1-9)
 */
function calculateJuShu(date) {
  const isYang = determineYinYangDun(date);
  const solarTerm = getCurrentSolarTerm(date);
  const dayGanZhi = getDayGanZhi(date);
  const yuan = getYuan(dayGanZhi);

  // 查表获取局数
  const table = isYang ? YANG_DUN_TABLE : YIN_DUN_TABLE;

  let juShu;
  if (solarTerm && table[solarTerm.name]) {
    juShu = table[solarTerm.name][yuan];
  } else {
    // fallback：如果找不到节气，用简单公式
    // 基于日干支在60甲子中的序号来估算
    const ganIdx = TIAN_GAN.indexOf(dayGanZhi[0]);
    const zhiIdx = DI_ZHI.indexOf(dayGanZhi[1]);
    const idx60 = (ganIdx * 6 - zhiIdx * 5 + 600) % 60;
    juShu = isYang
      ? (idx60 % 9) + 1
      : 9 - (idx60 % 9);
  }

  return { isYang, juShu, solarTerm, dayGanZhi, yuan };
}

// ═══════════════════════════════════════════════════
// Step 3: 排地盘（三奇六仪）
// ═══════════════════════════════════════════════════

/**
 * 将三奇六仪按洛书飞布排入九宫
 * 阳遁：从局数对应宫开始，按洛书路径顺排
 * 阴遁：从局数对应宫开始，按洛书路径逆排
 */
function arrangeEarthPlate(juShu, isYang) {
  // 找到局数在洛书路径中的起始位置
  const startIdx = LUOSHU_PATH.indexOf(juShu);

  // 九宫地盘：palace[1..9] = 天干符号
  const earth = {};

  for (let i = 0; i < 9; i++) {
    let pathIdx;
    if (isYang) {
      // 阳遁顺排
      pathIdx = (startIdx + i) % 9;
    } else {
      // 阴遁逆排
      pathIdx = (startIdx - i + 9) % 9;
    }
    const palace = LUOSHU_PATH[pathIdx];
    earth[palace] = YI_QI_SEQUENCE[i];
  }

  return earth;
}

// ═══════════════════════════════════════════════════
// Step 4: 排天盘（九星）
// ═══════════════════════════════════════════════════

/**
 * 排天盘九星
 * 1. 找时旬旬首
 * 2. 旬首所遁天干在地盘的宫位 → 值符星（该宫原星即为值符）
 * 3. 值符星移到时干所在宫位
 * 4. 其余星按洛书路径同向移动
 */
function arrangeHeavenPlate(earthPlate, dayGanZhi, hour, isYang) {
  const dayGan = dayGanZhi[0];
  const hourGanZhi = getHourGanZhi(dayGan, hour);
  const hourGan = hourGanZhi[0];

  // 找时辰的旬首
  const shiXunShou = getXunShou(hourGanZhi);
  // 旬首所遁天干
  const xunDunGan = XUN_SHOU_DUN[shiXunShou.name];

  // 旬首天干在地盘的宫位 → 值符的原始宫位
  let zhiFuOrigPalace = null;
  for (let p = 1; p <= 9; p++) {
    if (earthPlate[p] === xunDunGan) {
      zhiFuOrigPalace = p;
      break;
    }
  }

  // 值符星 = 原始宫位的星
  const zhiFuStar = STAR_BY_PALACE[zhiFuOrigPalace];

  // 时干在地盘的宫位 → 值符星要移到此处
  // 注意：甲不出现在地盘上，甲隐遁于六仪中，因此需要用该旬的遁干
  let effectiveHourGan = hourGan;
  if (hourGan === '甲') {
    effectiveHourGan = xunDunGan; // 甲用其旬的遁干来查宫位
  }
  let hourGanPalace = null;
  for (let p = 1; p <= 9; p++) {
    if (earthPlate[p] === effectiveHourGan) {
      hourGanPalace = p;
      break;
    }
  }

  // 计算天盘九星位移
  // 原始宫位在洛书路径中的索引
  const origIdx = LUOSHU_PATH.indexOf(zhiFuOrigPalace);
  const targetIdx = LUOSHU_PATH.indexOf(hourGanPalace);

  // 位移量
  let shift;
  if (isYang) {
    shift = (targetIdx - origIdx + 9) % 9;
  } else {
    shift = (origIdx - targetIdx + 9) % 9;
  }

  // 安排天盘九星
  const heaven = {};
  for (let p = 1; p <= 9; p++) {
    const pIdx = LUOSHU_PATH.indexOf(p);
    let origStarIdx;
    if (isYang) {
      origStarIdx = (pIdx - shift + 9) % 9;
    } else {
      origStarIdx = (pIdx + shift) % 9;
    }
    const origPalace = LUOSHU_PATH[origStarIdx];
    heaven[p] = { ...STAR_BY_PALACE[origPalace] };
  }

  // 天禽星寄宫
  const tianQinPalace = isYang ? 2 : 8; // 阳遁寄坤二宫，阴遁寄艮八宫

  return {
    heaven,
    zhiFuStar,
    zhiFuOrigPalace,
    zhiFuCurrentPalace: hourGanPalace,
    tianQinPalace,
    hourGanZhi,
    shiXunShou,
    xunDunGan
  };
}

// ═══════════════════════════════════════════════════
// Step 5: 排人盘（八门）
// ═══════════════════════════════════════════════════

/**
 * 排八门
 * 值使 = 值符原宫位对应的门
 * 值使移到时干宫位，其余门按洛书路径同向移动
 * 注意：中五宫无门，天禽星寄宫时门也跟随
 */
function arrangeDoorPlate(earthPlate, heavenInfo, isYang) {
  const { zhiFuOrigPalace, zhiFuCurrentPalace } = heavenInfo;

  // 值使 = 值符原宫位的门（天禽星时需取寄宫的门）
  const zhiShiOrigPalace = zhiFuOrigPalace === 5
    ? (isYang ? 2 : 8)
    : zhiFuOrigPalace;
  const zhiShiDoor = DOOR_BY_PALACE[zhiShiOrigPalace];

  // 八门原始宫位（不含中宫）
  const doorOrigins = [1, 2, 3, 4, 6, 7, 8, 9];

  // 找到值使原始宫位和目标宫位在八门序列中的索引
  // 时干所在宫位 = 值使目标宫位
  const targetPalace = zhiFuCurrentPalace === 5
    ? (isYang ? 2 : 8)
    : zhiFuCurrentPalace;

  // 八门排布用的洛书路径（跳过5）
  const doorPath = LUOSHU_PATH.filter(p => p !== 5); // [6,7,8,9,1,2,3,4]

  const origDoorIdx = doorPath.indexOf(zhiShiOrigPalace);
  const targetDoorIdx = doorPath.indexOf(targetPalace);

  let doorShift;
  if (isYang) {
    doorShift = (targetDoorIdx - origDoorIdx + 8) % 8;
  } else {
    doorShift = (origDoorIdx - targetDoorIdx + 8) % 8;
  }

  // 安排八门到各宫
  const doors = {};
  for (let i = 0; i < 8; i++) {
    let srcIdx;
    if (isYang) {
      srcIdx = (i - doorShift + 8) % 8;
    } else {
      srcIdx = (i + doorShift) % 8;
    }
    const srcPalace = doorPath[srcIdx];
    const dstPalace = doorPath[i];
    doors[dstPalace] = { ...DOOR_BY_PALACE[srcPalace] };
  }

  // 中宫无门
  doors[5] = null;

  return {
    doors,
    zhiShiDoor,
    zhiShiOrigPalace,
    targetPalace
  };
}

// ═══════════════════════════════════════════════════
// Step 6: 排神盘（八神）
// ═══════════════════════════════════════════════════

/**
 * 排八神
 * 从值符星当前宫位开始排列
 * 阳遁按洛书顺时针，阴遁逆时针
 * 中宫跳过
 */
function arrangeSpiritPlate(heavenInfo, isYang) {
  const { zhiFuCurrentPalace } = heavenInfo;
  const startPalace = zhiFuCurrentPalace === 5
    ? (isYang ? 2 : 8)
    : zhiFuCurrentPalace;

  const doorPath = LUOSHU_PATH.filter(p => p !== 5); // [6,7,8,9,1,2,3,4]
  const startIdx = doorPath.indexOf(startPalace);

  const spirits = {};
  for (let i = 0; i < 8; i++) {
    let idx;
    if (isYang) {
      idx = (startIdx + i) % 8;
    } else {
      idx = (startIdx - i + 8) % 8;
    }
    const palace = doorPath[idx];
    spirits[palace] = EIGHT_SPIRITS[i];
  }

  // 中宫无神
  spirits[5] = null;

  return spirits;
}

// ═══════════════════════════════════════════════════
// 吉凶判断
// ═══════════════════════════════════════════════════

function judgePalaceFortune(star, door, spirit) {
  if (!star && !door) return { level: '未知', desc: '' };

  const goodStars = ['天冲', '天辅', '天心', '天任'];
  const badStars = ['天蓬', '天芮', '天柱', '天英'];
  const goodDoors = ['开门', '休门', '生门'];
  const badDoors = ['死门', '惊门', '伤门'];
  const neutralDoors = ['杜门', '景门'];
  const goodSpirits = ['值符', '太阴', '六合', '九天'];
  const badSpirits = ['白虎', '玄武', '螣蛇'];

  let score = 0;
  if (goodStars.includes(star?.name)) score += 2;
  if (badStars.includes(star?.name)) score -= 2;
  if (goodDoors.includes(door?.name)) score += 2;
  if (badDoors.includes(door?.name)) score -= 2;
  if (goodSpirits.includes(spirit)) score += 1;
  if (badSpirits.includes(spirit)) score -= 1;

  if (score >= 4) return { level: '大吉', desc: '星门神俱佳，大吉之象' };
  if (score >= 2) return { level: '吉', desc: '星门得力，谋事可成' };
  if (score >= 1) return { level: '小吉', desc: '略有助力，宜谨慎行事' };
  if (score === 0) return { level: '平', desc: '吉凶参半，静观其变' };
  if (score >= -1) return { level: '小凶', desc: '稍有阻滞，不宜妄动' };
  if (score >= -2) return { level: '凶', desc: '星门不利，防患未然' };
  return { level: '大凶', desc: '凶象明显，宜避为宜' };
}

// ═══════════════════════════════════════════════════
// Step 7: 生成报告
// ═══════════════════════════════════════════════════

function generateReport(date, step2, earthPlate, heavenInfo, doorInfo, spiritPlate) {
  const { isYang, juShu, solarTerm, dayGanZhi, yuan } = step2;
  const { heaven, zhiFuStar, zhiFuCurrentPalace, tianQinPalace, hourGanZhi, shiXunShou, xunDunGan } = heavenInfo;
  const { doors, zhiShiDoor } = doorInfo;

  const hour = date.getHours();
  const hourZhi = DI_ZHI[getShiChenIdx(hour)];
  const yuanName = ['上元', '中元', '下元'][yuan];
  const termName = solarTerm ? solarTerm.name : '未知';

  let report = '';
  report += '\n';
  report += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  report += '  奇门遁甲排盘（七步正统法）\n';
  report += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  report += '\n';

  // 基本信息
  report += '[ 基本信息 ]\n';
  report += `   日期：${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日\n`;
  report += `   时辰：${hourZhi}时（${hourGanZhi}）\n`;
  report += `   日干支：${dayGanZhi}\n`;
  report += `   节气：${termName}\n`;
  report += `   遁局：${isYang ? '阳遁' : '阴遁'} ${juShu}局  ${yuanName}\n`;
  report += `   时旬首：${shiXunShou.name}（遁${xunDunGan}）\n`;
  report += `   值符星：${zhiFuStar.name}（落${PALACE_INFO[zhiFuCurrentPalace].name}${zhiFuCurrentPalace}宫）\n`;
  report += `   值使门：${zhiShiDoor.name}\n`;
  report += `   天禽寄宫：${isYang ? '坤二宫（阳遁）' : '艮八宫（阴遁）'}\n`;
  report += '\n';

  // 九宫排布图
  report += '[ 九宫排布 ]\n';
  report += '（每宫四层：神盘/天盘/人盘/地盘）\n\n';

  // 九宫格展示顺序：从上到下，从左到右
  const layout = [
    [4, 9, 2],  // 东南  南  西南
    [3, 5, 7],  // 东    中  西
    [8, 1, 6]   // 东北  北  西北
  ];

  for (let row = 0; row < 3; row++) {
    report += '  ┌─────────────────┬─────────────────┬─────────────────┐\n';

    for (const palace of layout[row]) {
      const info = PALACE_INFO[palace];
      const star = heaven[palace];
      const door = doors[palace];
      const spirit = spiritPlate[palace];
      const earth = earthPlate[palace];
      const fortune = judgePalaceFortune(star, door, spirit);

      report += `  │ 【${palace}宫 ${info.name}(${info.direction})】`;
    }
    report += '\n';

    for (const palace of layout[row]) {
      const star = heaven[palace];
      const door = doors[palace];
      const spirit = spiritPlate[palace];
      const earth = earthPlate[palace];

      const spiritStr = spirit ? `${spirit}` : '  ';
      const starStr = star ? `${star.name}` : '    ';
      const doorStr = door ? `${door.name}` : '    ';
      const earthStr = earth || '  ';

      report += `  │ 神:${spiritStr.padEnd(4)} 星:${starStr.padEnd(4)}`;
    }
    report += '\n';

    for (const palace of layout[row]) {
      const door = doors[palace];
      const earth = earthPlate[palace];
      const doorStr = door ? `${door.name}` : '    ';
      const earthStr = earth || '  ';

      report += `  │ 门:${doorStr.padEnd(4)} 地:${earthStr.padEnd(4)}`;
    }
    report += '\n';

    for (const palace of layout[row]) {
      const star = heaven[palace];
      const door = doors[palace];
      const spirit = spiritPlate[palace];
      const fortune = judgePalaceFortune(star, door, spirit);
      const symbol = fortune.level.includes('大吉') ? '[大吉]' :
                     fortune.level.includes('吉') ? '[吉 ]' :
                     fortune.level === '平' ? '[平 ]' :
                     fortune.level.includes('大凶') ? '[大凶]' : '[凶 ]';

      report += `  │     ${symbol}         `;
    }
    report += '\n';
  }
  report += '  └─────────────────┴─────────────────┴─────────────────┘\n';
  report += '\n';

  // 各宫详情
  report += '[ 各宫位详情 ]\n';
  report += '─────────────────────────────────────\n';

  for (let p = 1; p <= 9; p++) {
    if (p === 5) {
      // 中宫特殊处理
      const earth = earthPlate[p];
      const star = heaven[p];
      report += `\n【${p}宫 中宫】（天禽星寄${isYang ? '坤二' : '艮八'}宫）\n`;
      report += `   地盘：${earth}\n`;
      report += `   天盘：${star ? star.name : '天禽（寄宫）'}\n`;
      report += `   中宫无门无神，天禽星随值符运行\n`;
      continue;
    }

    const info = PALACE_INFO[p];
    const star = heaven[p];
    const door = doors[p];
    const spirit = spiritPlate[p];
    const earth = earthPlate[p];
    const fortune = judgePalaceFortune(star, door, spirit);

    report += `\n【${p}宫 ${info.name}宫（${info.direction}）${info.element}行】\n`;
    report += `   地盘：${earth}\n`;
    report += `   天盘：${star ? star.name + '（' + star.trait + '星）' : '-'}\n`;
    report += `   人盘：${door ? door.name + '（' + door.trait + '）' : '-'}\n`;
    report += `   神盘：${spirit || '-'}\n`;
    report += `   吉凶：${fortune.level} — ${fortune.desc}\n`;

    // 格局分析
    if (star && door) {
      if (['开门', '休门', '生门'].includes(door.name) && ['天心', '天任', '天冲', '天辅'].includes(star.name)) {
        report += `   ★ 吉格：${star.name}+${door.name}，大吉之象\n`;
      }
      if (door.name === '死门' && star.name === '天芮') {
        report += `   ✘ 凶格：天芮+死门，大凶之象\n`;
      }
      if (spirit === '值符') {
        report += `   ★ 值符临宫，贵人助力\n`;
      }
      if (spirit === '六合') {
        report += `   ★ 六合临宫，合作和合\n`;
      }
    }
  }

  // 三奇方位
  report += '\n[ 三奇方位 ]\n';
  report += '─────────────────────────────────────\n';
  for (let p = 1; p <= 9; p++) {
    if (p === 5) continue;
    const earth = earthPlate[p];
    if (['乙', '丙', '丁'].includes(earth)) {
      const qiName = earth === '乙' ? '日奇' : earth === '丙' ? '月奇' : '星奇';
      report += `   ${qiName}（${earth}）在${PALACE_INFO[p].name}${p}宫（${PALACE_INFO[p].direction}方）\n`;
    }
  }

  // 综合建议
  report += '\n[ 综合建议 ]\n';
  report += '─────────────────────────────────────\n';

  // 找最佳宫位
  let bestPalaces = [];
  for (let p = 1; p <= 9; p++) {
    if (p === 5) continue;
    const fortune = judgePalaceFortune(heaven[p], doors[p], spiritPlate[p]);
    if (fortune.level === '大吉' || fortune.level === '吉') {
      bestPalaces.push(p);
    }
  }

  report += `   遁法：${isYang ? '阳遁宜进，宜主动出击' : '阴遁宜退，宜防守固守'}\n`;
  report += `   值符：${zhiFuStar.name}为核心，主导局势\n`;
  report += `   值使：${zhiShiDoor.name}为动向，指示行事\n`;

  if (bestPalaces.length > 0) {
    report += `   吉利方位：${bestPalaces.map(p => `${PALACE_INFO[p].direction}（${PALACE_INFO[p].name}${p}宫）`).join('、')}\n`;
  } else {
    report += `   今日无大吉方位，宜静不宜动\n`;
  }

  // 时辰建议
  report += `\n   今日${hourZhi}时起局，日干${dayGanZhi[0]}，时干${hourGanZhi[0]}\n`;

  report += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

  return report;
}

// ═══════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════

const args = process.argv.slice(2);

if (args[0] === '--help' || args[0] === '-h') {
  console.log(`
奇门遁甲排盘（七步正统法）

用法:
  node qimen.js                 # 当前时间起局
  node qimen.js 2026-03-24     # 指定日期（默认午时）
  node qimen.js 2026-03-24 15  # 指定日期和时辰（24小时制）

示例:
  node qimen.js
  node qimen.js 2026-03-24
  node qimen.js 2026-03-24 15

排盘步骤:
  1. 确定阴阳遁（根据节气精确计算）
  2. 定局数（节气 + 日干支元局 → 1~9局）
  3. 排地盘（三奇六仪按洛书飞布）
  4. 排天盘（九星随值符移动）
  5. 排人盘（八门随值使移动）
  6. 排神盘（八神随值符宫位排列）
  7. 生成九宫综合报告
`);
} else {
  let date;
  let hour;

  if (args.length === 0) {
    date = new Date();
  } else if (args.length === 1) {
    date = new Date(args[0]);
    if (isNaN(date.getTime())) {
      console.error('日期格式无效，请使用 YYYY-MM-DD 格式');
      process.exit(1);
    }
    date.setHours(12); // 默认午时
  } else if (args.length >= 2) {
    date = new Date(args[0]);
    if (isNaN(date.getTime())) {
      console.error('日期格式无效，请使用 YYYY-MM-DD 格式');
      process.exit(1);
    }
    hour = parseInt(args[1]);
    if (isNaN(hour) || hour < 0 || hour > 23) {
      console.error('时辰无效，请使用 0-23 的整数');
      process.exit(1);
    }
    date.setHours(hour);
  }

  // 七步排盘
  const step2 = calculateJuShu(date);
  const earthPlate = arrangeEarthPlate(step2.juShu, step2.isYang);
  const heavenInfo = arrangeHeavenPlate(earthPlate, step2.dayGanZhi, date.getHours(), step2.isYang);
  const doorInfo = arrangeDoorPlate(earthPlate, heavenInfo, step2.isYang);
  const spiritPlate = arrangeSpiritPlate(heavenInfo, step2.isYang);

  console.log(generateReport(date, step2, earthPlate, heavenInfo, doorInfo, spiritPlate));
}
