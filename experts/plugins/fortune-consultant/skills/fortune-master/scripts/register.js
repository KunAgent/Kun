#!/usr/bin/env node
/**
 * 快速注册脚本
 * 用于命令行快速注册新用户
 */

const fs = require('fs');
const path = require('path');
const { getLunarMonth, isAfterLiChun } = require('./jieqi');
const { runFullAnalysis } = require('./bazi-analysis');

// 天干地支
const tianGan = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const diZhi = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const zodiacMap = { '子': '鼠', '丑': '牛', '寅': '虎', '卯': '兔', '辰': '龙', '巳': '蛇', '午': '马', '未': '羊', '申': '猴', '酉': '鸡', '戌': '狗', '亥': '猪' };

// ============================================================
// 真太阳时修正
// ============================================================

/** 主要城市经度表（东经度） */
const CITY_LONGITUDE = {
  '上海': 121.47, '北京': 116.40, '广州': 113.26, '深圳': 114.06,
  '杭州': 120.15, '南京': 118.80, '成都': 104.07, '重庆': 106.55,
  '武汉': 114.30, '西安': 108.93, '沈阳': 123.43, '哈尔滨': 126.68,
  '长春': 125.32, '大连': 121.62, '天津': 117.19, '济南': 117.00,
  '青岛': 120.38, '郑州': 113.65, '石家庄': 114.51, '太原': 112.55,
  '呼和浩特': 111.76, '乌鲁木齐': 87.62, '拉萨': 91.11, '昆明': 102.68,
  '贵阳': 106.63, '南宁': 108.37, '海口': 110.33, '福州': 119.30,
  '厦门': 118.08, '南昌': 115.89, '合肥': 117.27, '长沙': 112.98,
  '兰州': 103.82, '西宁': 101.74, '银川': 106.23, '昭通': 103.72,
  '曲靖': 103.80, '丽江': 100.22, '大理': 100.27, '玉溪': 102.55,
  '保山': 99.16, '普洱': 100.97, '临沧': 100.08, '香港': 114.17,
  '澳门': 113.55, '台北': 121.53, '苏州': 120.62, '无锡': 120.30,
  '宁波': 121.55, '温州': 120.67, '济宁': 116.59, '烟台': 121.39,
  '徐州': 117.18, '洛阳': 112.45, '唐山': 118.18, '秦皇岛': 119.60
};

/**
 * 均时差（分钟）：地球椭圆公转导致的时差，精度约 ±1 分钟
 */
function getEquationOfTime(date) {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const doy = Math.floor((date - startOfYear) / 86400000) + 1;
  const B = (2 * Math.PI * (doy - 1)) / 365;
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}

/**
 * 计算真太阳时，返回修正后的日期和时间
 * @param {string} birthDate YYYY-MM-DD
 * @param {string} birthTime HH:MM
 * @param {string} birthPlace 出生地（城市名）
 * @returns {{ date: string, time: string, offsetMinutes: number, city: string|null }}
 */
function getTrueSolarTime(birthDate, birthTime, birthPlace) {
  // 匹配城市经度（支持"上海市"、"上海浦东"等写法）
  let longitude = null;
  let matchedCity = null;
  if (birthPlace) {
    for (const [city, lng] of Object.entries(CITY_LONGITUDE)) {
      if (birthPlace.includes(city)) {
        longitude = lng;
        matchedCity = city;
        break;
      }
    }
  }

  if (longitude === null) {
    // 未知城市，不做修正
    return { date: birthDate, time: birthTime, offsetMinutes: 0, city: null };
  }

  const date = new Date(`${birthDate}T12:00:00+08:00`);
  const geoOffset = (longitude - 120) * 4;       // 地理时差（分钟）
  const eot = getEquationOfTime(date);             // 均时差（分钟）
  const totalOffset = Math.round(geoOffset + eot); // 总修正量（分钟，四舍五入）

  const [h, m] = birthTime.split(':').map(Number);
  let totalMinutes = h * 60 + m + totalOffset;

  // 处理跨日
  let correctedDate = birthDate;
  if (totalMinutes < 0) {
    const d = new Date(`${birthDate}T12:00:00+08:00`);
    d.setDate(d.getDate() - 1);
    correctedDate = d.toISOString().slice(0, 10);
    totalMinutes += 1440;
  } else if (totalMinutes >= 1440) {
    const d = new Date(`${birthDate}T12:00:00+08:00`);
    d.setDate(d.getDate() + 1);
    correctedDate = d.toISOString().slice(0, 10);
    totalMinutes -= 1440;
  }

  const ch = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const cm = String(totalMinutes % 60).padStart(2, '0');

  return {
    date: correctedDate,
    time: `${ch}:${cm}`,
    offsetMinutes: totalOffset,
    city: matchedCity,
    geoOffsetMin: Math.round(geoOffset),
    eotMin: Math.round(eot)
  };
}

/**
 * 内置八字计算（使用精确节气算法）
 */
function calculateBazi(birthDate, birthTime, gender, sect = 1) {
  const [year, month, day] = birthDate.split('-').map(Number);
  const [hour] = birthTime.split(':').map(Number);

  // 年柱（以立春精确时刻为界）
  const calcYear = isAfterLiChun(year, month, day) ? year : year - 1;
  const yearGanIndex = ((calcYear - 4) % 10 + 10) % 10;
  const yearZhiIndex = ((calcYear - 4) % 12 + 12) % 12;

  // 月柱（以精确节气为界）
  const lunarMonth = getLunarMonth(year, month, day);
  const monthZhiIndex = (lunarMonth + 1) % 12;
  const monthGanBases = [2, 4, 6, 8, 0]; // 甲己起丙，乙庚起戊，丙辛起庚，丁壬起壬，戊癸起甲
  const monthGanIndex = (monthGanBases[yearGanIndex % 5] + lunarMonth - 1) % 10;

  // 日柱（以2024-01-01甲子日为基准）
  let calcDate = new Date(`${birthDate}T12:00:00`);
  if (sect === 1 && hour === 23) calcDate.setDate(calcDate.getDate() + 1); // 晚子时算次日
  const baseDate = new Date('2024-01-01T12:00:00');
  const diffDays = Math.round((calcDate - baseDate) / (1000 * 60 * 60 * 24));
  const dayGanIndex = (diffDays % 10 + 10) % 10; // 2024-01-01=甲子(甲=0)
  const dayZhiIndex = (diffDays % 12 + 12) % 12; // 2024-01-01=甲子(子=0)

  // 时柱（五鼠遁日）
  const hourZhiIndex = (sect === 1 && hour === 23) ? 0 : Math.floor((hour + 1) / 2) % 12;
  const hourGanBases = [0, 2, 4, 6, 8]; // 甲己起甲，乙庚起丙，丙辛起戊，丁壬起庚，戊癸起壬
  const hourGanIndex = (hourGanBases[dayGanIndex % 5] + hourZhiIndex) % 10;

  return {
    year: tianGan[yearGanIndex] + diZhi[yearZhiIndex],
    month: tianGan[monthGanIndex] + diZhi[monthZhiIndex],
    day: tianGan[dayGanIndex] + diZhi[dayZhiIndex],
    hour: tianGan[hourGanIndex] + diZhi[hourZhiIndex],
    dayStem: tianGan[dayGanIndex],
    zodiac: zodiacMap[diZhi[yearZhiIndex]]
  };
}

/**
 * 生成初始档案
 */
function createProfile(userId, name, gender, birthDate, birthTime, birthPlace, sect = 1) {
  // 真太阳时修正
  const solar = getTrueSolarTime(birthDate, birthTime, birthPlace);

  // 用真太阳时计算八字
  const bazi = calculateBazi(solar.date, solar.time, gender === '男' ? 1 : 0, sect);

  const profile = {
    userId,
    name,
    language: 'zh',
    profile: {
      birthDate,
      birthTime,
      birthPlace,
      gender,
      timezone: 'Asia/Shanghai',
      trueSolarTime: solar.time,
      trueSolarDate: solar.date,
      solarCorrectionMin: solar.offsetMinutes,
      solarCorrectionCity: solar.city
    },
    bazi: {
      year: bazi?.year || '',
      month: bazi?.month || '',
      day: bazi?.day || '',
      hour: bazi?.hour || '',
      dayStem: bazi?.dayStem || '',
      zodiac: bazi?.zodiac || '',
      sect: sect === 1 ? '晚子时' : '早子时',
      source: 'verified',
      analysis: bazi ? runFullAnalysis(bazi) : null
    },
    ziwei: {
      mingGong: '',
      mingZhu: '',
      source: 'pending'
    },
    family: {
      spouse: {
        name: '配偶',
        profile: {
          birthDate: '待录入',
          birthTime: '待录入',
          birthPlace: '',
          gender: gender === '男' ? '女' : '男',
          lunarBirth: ''
        },
        bazi: {
          year: '',
          month: '',
          day: '',
          hour: '',
          source: 'pending'
        }
      },
      father: {
        name: '父亲',
        profile: {
          birthDate: '待录入',
          birthTime: '待录入',
          birthPlace: '',
          gender: '男'
        },
        bazi: {
          year: '',
          month: '',
          day: '',
          hour: '',
          source: 'pending'
        }
      },
      mother: {
        name: '母亲',
        profile: {
          birthDate: '待录入',
          birthTime: '待录入',
          birthPlace: '',
          gender: '女'
        },
        bazi: {
          year: '',
          month: '',
          day: '',
          hour: '',
          source: 'pending'
        }
      },
      children: []
    },
    preferences: {
      pushMorning: true,
      pushEvening: false,
      morningTime: '07:00',
      eveningTime: '20:00',
      channels: ['openclaw'],
      focusAreas: ['事业', '财运', '健康'],
      riskTolerance: '中等'
    },
    settings: {
      defaultSect: sect,
      lunarCalendar: true,
      notifications: {
        dailyFortune: true,
        riskAlert: true,
        weeklySummary: false
      }
    },
    createdAt: new Date().toISOString().split('T')[0],
    updatedAt: new Date().toISOString().split('T')[0]
  };

  return profile;
}

/**
 * 保存档案
 */
function saveProfile(userId, profile) {
  const dir = path.join(__dirname, '../data/profiles');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, `${userId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf8');
  return filePath;
}

// 主入口
const args = process.argv.slice(2);

if (args.length < 5) {
  console.log(`
📝 快速注册用户

用法:
  node register.js <userId> <姓名> <性别> <出生日期> <出生时间> [出生地点] [子时]

参数:
  userId      - 用户ID（唯一标识）
  姓名        - 用户姓名
  性别        - 男 或 女
  出生日期    - YYYY-MM-DD
  出生时间    - HH:MM（24小时制）
  出生地点    - 省市（可选，默认上海）
  子时        - 1=晚子时(23点后算次日)，2=早子时(可选，默认1)

示例:
  node register.js 123456 张三 男 1990-05-15 14:30 上海
  node register.js 123456 李四 女 1995-08-20 23:45 北京 1

说明:
  子时(23:00-01:00)出生需要特别注意：
  - 晚子时(1): 23:00后算次日日柱
  - 早子时(2): 23:00后算当日日柱
`);
  process.exit(1);
}

const userId = args[0];
const name = args[1];
const gender = args[2];
const birthDate = args[3];
const birthTime = args[4];
const birthPlace = args[5] || '上海';
const sect = parseInt(args[6] || '1');

// 验证
if (!['男', '女'].includes(gender)) {
  console.error('性别必须是"男"或"女"');
  process.exit(1);
}

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
if (!dateRegex.test(birthDate)) {
  console.error('出生日期格式错误，请使用 YYYY-MM-DD');
  process.exit(1);
}

const timeRegex = /^\d{2}:\d{2}$/;
if (!timeRegex.test(birthTime)) {
  console.error('出生时间格式错误，请使用 HH:MM');
  process.exit(1);
}

console.log('\n📝 正在注册用户...\n');
console.log(`  用户ID: ${userId}`);
console.log(`  姓名: ${name}`);
console.log(`  性别: ${gender}`);
console.log(`  出生: ${birthDate} ${birthTime}`);
console.log(`  地点: ${birthPlace}`);
console.log(`  子时: ${sect === 1 ? '晚子时(23点后算次日)' : '早子时(23点后算当日)'}`);
console.log('');

// 创建档案
const profile = createProfile(userId, name, gender, birthDate, birthTime, birthPlace, sect);

// 保存
const filePath = saveProfile(userId, profile);

console.log('✅ 注册成功！\n');

// 真太阳时提示
const sc = profile.profile.solarCorrectionMin;
if (sc !== 0 && profile.profile.solarCorrectionCity) {
  const sign = sc > 0 ? '+' : '';
  console.log(`🌞 真太阳时修正（${profile.profile.solarCorrectionCity}）`);
  console.log(`  北京时间: ${birthDate} ${birthTime}`);
  console.log(`  真太阳时: ${profile.profile.trueSolarDate} ${profile.profile.trueSolarTime} (${sign}${sc}分钟)`);
  console.log(`  八字时柱以真太阳时计算`);
  console.log('');
} else if (!profile.profile.solarCorrectionCity) {
  console.log(`🌞 真太阳时：未识别城市"${birthPlace}"，以北京时间计算（如需精确请使用主要城市名）`);
  console.log('');
}

console.log('📊 八字信息');
console.log(`  年柱: ${profile.bazi.year}`);
console.log(`  月柱: ${profile.bazi.month}`);
console.log(`  日柱: ${profile.bazi.day}`);
console.log(`  时柱: ${profile.bazi.hour}`);
console.log(`  日主: ${profile.bazi.dayStem} (${profile.bazi.zodiac})`);
console.log('');
console.log(`📁 档案已保存: ${filePath}`);
console.log('');

// 自动开启推送（如果指定了 --push 参数）
const pushIdx = args.indexOf('--push');
if (pushIdx !== -1) {
  const channel = args[args.indexOf('--channel') + 1] || 'openclaw';
  const morning = args[args.indexOf('--morning') + 1] || '08:00';
  const evening = args[args.indexOf('--evening') + 1] || '20:00';
  console.log('⏳ 正在开启每日推送...');
  try {
    const { enablePush } = require('./push-toggle');
    enablePush(userId, { morning, evening, channel });
  } catch (e) {
    console.error('推送开启失败:', e.message);
  }
} else {
  console.log('💡 提示：运行以下命令开启每日运程推送：');
  console.log(`   node scripts/push-toggle.js on ${userId}`);
  console.log('');
}

module.exports = { createProfile, saveProfile };
