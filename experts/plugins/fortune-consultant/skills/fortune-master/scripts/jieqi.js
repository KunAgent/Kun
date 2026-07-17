#!/usr/bin/env node
/**
 * 节气精确计算模块
 * 基于太阳黄道经度（简化 VSOP87），精度 ±15 分钟，对应到日期误差 < 1 天
 */

const DEG = Math.PI / 180;

/**
 * 计算给定儒略日的太阳黄道经度（度）
 * 来源：Jean Meeus《Astronomical Algorithms》第27章
 */
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

/**
 * 牛顿迭代：求太阳黄道经度恰好为 targetLon 时的儒略日
 */
function jdeAtLongitude(year, targetLon) {
  // 初始估算：以平均运动推算
  let jd = 2451545.0 + (year - 2000 + ((targetLon - 280.46 + 360) % 360) / 360) * 365.2422;
  for (let i = 0; i < 50; i++) {
    let diff = ((targetLon - sunLongitude(jd) + 540) % 360) - 180;
    if (Math.abs(diff) < 1e-6) break;
    jd += (diff / 360) * 365.2422;
  }
  return jd;
}

/**
 * 儒略日 → 北京时间（UTC+8）日期
 */
function jdToCST(jde) {
  const jd = jde + 8 / 24; // 转 UTC+8
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

// ── 12 个月建节气（定义月柱边界）─────────────────────────────────────────
//   名称      黄道经度   对应日历月
const MONTH_JIEQI = [
  { name: '小寒', lon: 285, calMonth:  1 },
  { name: '立春', lon: 315, calMonth:  2 },
  { name: '惊蛰', lon: 345, calMonth:  3 },
  { name: '清明', lon:  15, calMonth:  4 },
  { name: '立夏', lon:  45, calMonth:  5 },
  { name: '芒种', lon:  75, calMonth:  6 },
  { name: '小暑', lon: 105, calMonth:  7 },
  { name: '立秋', lon: 135, calMonth:  8 },
  { name: '白露', lon: 165, calMonth:  9 },
  { name: '寒露', lon: 195, calMonth: 10 },
  { name: '立冬', lon: 225, calMonth: 11 },
  { name: '大雪', lon: 255, calMonth: 12 },
];

// 未过当月节气 → 属于上个节气月（寅月=1, 卯月=2, ..., 丑月=12）
const LUNAR_BEFORE = [11, 12,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10];
// 已过当月节气 → 属于当月节气月
const LUNAR_AFTER  = [12,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11];

// 简单 LRU 缓存，避免重复计算
const _cache = new Map();
function cachedJdeAtLon(year, lon) {
  const key = `${year}:${lon}`;
  if (!_cache.has(key)) _cache.set(key, jdToCST(jdeAtLongitude(year, lon)));
  return _cache.get(key);
}

/**
 * 给定阳历日期，返回八字月柱的节气月序号
 * 1 = 寅月（正月，立春后）
 * 2 = 卯月（惊蛰后）
 * ...
 * 12 = 丑月（小寒后）
 */
function getLunarMonth(year, month, day) {
  const jq = MONTH_JIEQI[month - 1];
  const { day: jqDay } = cachedJdeAtLon(year, jq.lon);
  return day >= jqDay ? LUNAR_AFTER[month - 1] : LUNAR_BEFORE[month - 1];
}

/**
 * 判断给定日期是否已过立春（用于年柱计算）
 * 立春 = 黄道 315°
 */
function isAfterLiChun(year, month, day) {
  if (month > 2) return true;
  if (month < 2) return false;
  const { day: liChunDay } = cachedJdeAtLon(year, 315);
  return day >= liChunDay;
}

/**
 * 获取指定年份某节气的北京时间日期（供外部查询）
 * @param {number} year
 * @param {string} name  节气名称，如 '立春'
 * @returns {{ year, month, day }}
 */
function getJieQiDate(year, name) {
  const jq = MONTH_JIEQI.find(j => j.name === name);
  if (!jq) throw new Error(`未知节气: ${name}`);
  return cachedJdeAtLon(year, jq.lon);
}

// ── 命令行调试模式 ───────────────────────────────────────────────────────
if (require.main === module) {
  const year = parseInt(process.argv[2]) || new Date().getFullYear();
  console.log(`\n${year}年 十二月建节气（北京时间）\n${'─'.repeat(30)}`);
  for (const jq of MONTH_JIEQI) {
    const d = cachedJdeAtLon(year, jq.lon);
    console.log(`  ${jq.name}  ${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`);
  }
}

module.exports = { getLunarMonth, isAfterLiChun, getJieQiDate };
