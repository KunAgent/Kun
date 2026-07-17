export interface ParseArgsResult {
  time: string;
  gender: 0 | 1;
  sect: 1 | 2;
}

export interface TrueSolarTimeResult {
  trueSolarTime: Date;
  meanSolarTime: Date;
  meanSolarOffsetSeconds: number;
  equationOfTimeSeconds: number;
  totalOffsetSeconds: number;
}

const CITY_LONGITUDE_BY_NAME: Record<string, number> = {
  台北: 121.5167,
  呼和浩特: 111.6333,
  包头: 110.0,
  海拉尔: 119.7167,
  太原: 112.55,
  临汾: 111.5167,
  大同: 113.2167,
  长治: 113.2167,
  石家庄: 114.4333,
  唐山: 118.15,
  秦皇岛: 119.6167,
  承德: 117.8667,
  保定: 115.4667,
  张家口: 114.9167,
  北京: 116.4,
  沈阳: 123.3833,
  鞍山: 123.0,
  锦州: 123.15,
  大连: 121.6333,
  长春: 125.3,
  吉林: 126.6,
  哈尔滨: 126.6333,
  牡丹江: 129.6,
  齐齐哈尔: 123.9167,
  上海: 121.4333,
  南京: 118.7667,
  无锡: 120.3,
  苏州: 120.65,
  徐州: 117.2,
  合肥: 117.2667,
  芜湖: 118.3333,
  安庆: 117.0333,
  济南: 117.0333,
  烟台: 121.3667,
  青岛: 120.3167,
  天津: 117.1667,
  杭州: 120.1667,
  绍兴: 120.6667,
  宁波: 121.5667,
  金华: 119.8167,
  温州: 120.6333,
  南昌: 115.8833,
  九江: 115.9833,
  赣州: 114.9333,
  福州: 119.3167,
  厦门: 118.0667,
  泉州: 118.6167,
  长沙: 112.9167,
  湘潭: 112.85,
  常德: 111.65,
  衡阳: 112.5667,
  武汉: 114.3333,
  监利: 112.8833,
  沙市: 112.2833,
  宜昌: 111.25,
  郑州: 113.7,
  新乡: 113.9,
  许昌: 113.8,
  洛阳: 112.4333,
  开封: 114.3833,
  广州: 113.3,
  珠海: 113.3,
  澳门: 113.3,
  韶关: 113.55,
  汕头: 116.6667,
  深圳: 113.55,
  香港: 114.1667,
  海口: 110.3167,
  南宁: 108.35,
  桂林: 110.1667,
  梧州: 111.3,
  柳州: 109.3167,
  贵阳: 106.7167,
  遵义: 106.8833,
  成都: 101.0667,
  重庆: 106.55,
  万县: 108.3667,
  内江: 105.05,
  泸州: 105.45,
  昆明: 102.7,
  西安: 108.9167,
  延安: 109.4333,
  宝鸡: 107.15,
  兰州: 103.8333,
  酒泉: 98.5,
  天水: 105.55,
  银川: 106.2167,
  西宁: 101.8167,
  乌鲁木齐: 87.6,
  克拉玛依: 84.85,
  哈密: 93.4833,
  和田: 79.9167,
  拉萨: 91.0333,
  达孜: 91.3833,
  林芝: 94.4667,
  曲水: 90.7333,
  贡嘎: 90.9667,
  林周: 91.2833,
  那曲: 92.05,
};

const TRUE_SOLAR_DIFF_SECONDS_BY_MMDD: Record<string, number> = {
  '01-01': -189,
  '01-02': -218,
  '01-03': -246,
  '01-04': -273,
  '01-05': -301,
  '01-06': -327,
  '01-07': -354,
  '01-08': -380,
  '01-09': -405,
  '01-10': -430,
  '01-11': -455,
  '01-12': -479,
  '01-13': -502,
  '01-14': -525,
  '01-15': -547,
  '01-16': -568,
  '01-17': -589,
  '01-18': -609,
  '01-19': -628,
  '01-20': -647,
  '01-21': -665,
  '01-22': -682,
  '01-23': -698,
  '01-24': -714,
  '01-25': -728,
  '01-26': -742,
  '01-27': -755,
  '01-28': -779,
  '01-29': -790,
  '01-30': -799,
  '01-31': -817,
  '02-01': -824,
  '02-02': -830,
  '02-03': -836,
  '02-04': -841,
  '02-05': -845,
  '02-06': -849,
  '02-07': -851,
  '02-08': -853,
  '02-09': -854,
  '02-10': -855,
  '02-11': -854,
  '02-12': -853,
  '02-13': -851,
  '02-14': -848,
  '02-15': -845,
  '02-16': -841,
  '02-17': -836,
  '02-18': -831,
  '02-19': -824,
  '02-20': -818,
  '02-21': -810,
  '02-22': -802,
  '02-23': -793,
  '02-24': -784,
  '02-25': -774,
  '02-26': -763,
  '02-27': -752,
  '02-28': -741,
  '02-29': -728,
  '03-01': -716,
  '03-02': -703,
  '03-03': -689,
  '03-04': -675,
  '03-05': -661,
  '03-06': -647,
  '03-07': -632,
  '03-08': -616,
  '03-09': -601,
  '03-10': -585,
  '03-11': -568,
  '03-12': -552,
  '03-13': -535,
  '03-14': -518,
  '03-15': -501,
  '03-16': -484,
  '03-17': -466,
  '03-18': -449,
  '03-19': -431,
  '03-20': -413,
  '03-21': -395,
  '03-22': -377,
  '03-23': -358,
  '03-24': -340,
  '03-25': -322,
  '03-26': -304,
  '03-27': -285,
  '03-28': -267,
  '03-29': -249,
  '03-30': -231,
  '03-31': -213,
  '04-01': -196,
  '04-02': -178,
  '04-03': -161,
  '04-04': -144,
  '04-05': -127,
  '04-06': -110,
  '04-07': -93,
  '04-08': -77,
  '04-09': -61,
  '04-10': 46,
  '04-11': 30,
  '04-12': 16,
  '04-13': 1,
  '04-14': 13,
  '04-15': 27,
  '04-16': 41,
  '04-17': 54,
  '04-18': 66,
  '04-19': 79,
  '04-20': 91,
  '04-21': 102,
  '04-22': 113,
  '04-23': 124,
  '04-24': 134,
  '04-25': 143,
  '04-26': 153,
  '04-27': 161,
  '04-28': 169,
  '04-29': 177,
  '04-30': 184,
  '05-01': 190,
  '05-02': 196,
  '05-03': 201,
  '05-04': 206,
  '05-05': 210,
  '05-06': 217,
  '05-07': 216,
  '05-08': 219,
  '05-09': 220,
  '05-10': 222,
  '05-11': 222,
  '05-12': 222,
  '05-13': 222,
  '05-14': 221,
  '05-15': 219,
  '05-16': 217,
  '05-17': 214,
  '05-18': 211,
  '05-19': 207,
  '05-20': 203,
  '05-21': 198,
  '05-22': 193,
  '05-23': 187,
  '05-24': 181,
  '05-25': 174,
  '05-26': 167,
  '05-27': 159,
  '05-28': 151,
  '05-29': 142,
  '05-30': 133,
  '05-31': 124,
  '06-01': 114,
  '06-02': 104,
  '06-03': 94,
  '06-04': 83,
  '06-05': 72,
  '06-06': 60,
  '06-07': 48,
  '06-08': 36,
  '06-09': 24,
  '06-10': 12,
  '06-11': 1,
  '06-12': 14,
  '06-13': 39,
  '06-14': 52,
  '06-15': -65,
  '06-16': -78,
  '06-17': -91,
  '06-18': -105,
  '06-19': -117,
  '06-20': -130,
  '06-21': -143,
  '06-22': -156,
  '06-23': -168,
  '06-24': -181,
  '06-25': -193,
  '06-26': -205,
  '06-27': -217,
  '06-28': -229,
  '06-29': -240,
  '06-30': -251,
  '07-01': -262,
  '07-02': -273,
  '07-03': -283,
  '07-04': -293,
  '07-05': -302,
  '07-06': -311,
  '07-07': -320,
  '07-08': -328,
  '07-09': -336,
  '07-10': -343,
  '07-11': -350,
  '07-12': -356,
  '07-13': -362,
  '07-14': -368,
  '07-15': -372,
  '07-16': -376,
  '07-17': -380,
  '07-18': -383,
  '07-19': -385,
  '07-20': -387,
  '07-21': -389,
  '07-22': -389,
  '07-23': -389,
  '07-24': -389,
  '07-25': -388,
  '07-26': -386,
  '07-27': -384,
  '07-28': -381,
  '07-29': -377,
  '07-30': -373,
  '07-31': -368,
  '08-01': -363,
  '08-02': -357,
  '08-03': -351,
  '08-04': -344,
  '08-05': -336,
  '08-06': -328,
  '08-07': -319,
  '08-08': -310,
  '08-09': -300,
  '08-10': -290,
  '08-11': -279,
  '08-12': -267,
  '08-13': -255,
  '08-14': -242,
  '08-15': -229,
  '08-16': -216,
  '08-17': -201,
  '08-18': -187,
  '08-19': -171,
  '08-20': -156,
  '08-21': -140,
  '08-22': -123,
  '08-23': -107,
  '08-24': -89,
  '08-25': -72,
  '08-26': 54,
  '08-27': 35,
  '08-28': 17,
  '08-29': 2,
  '08-30': 21,
  '08-31': 41,
  '09-01': 60,
  '09-02': 80,
  '09-03': 100,
  '09-04': 121,
  '09-05': 141,
  '09-06': 162,
  '09-07': 183,
  '09-08': 183,
  '09-09': 204,
  '09-10': 225,
  '09-11': 246,
  '09-12': 267,
  '09-13': 288,
  '09-14': 310,
  '09-15': 331,
  '09-16': 353,
  '09-17': 374,
  '09-18': 395,
  '09-19': 417,
  '09-20': 438,
  '09-21': 459,
  '09-22': 480,
  '09-23': 501,
  '09-24': 522,
  '09-25': 542,
  '09-26': 562,
  '09-27': 582,
  '09-28': 602,
  '09-29': 621,
  '09-30': 640,
  '10-01': 659,
  '10-02': 678,
  '10-03': 696,
  '10-04': 696,
  '10-05': 713,
  '10-06': 731,
  '10-07': 748,
  '10-08': 764,
  '10-09': 780,
  '10-10': 796,
  '10-11': 796,
  '10-12': 811,
  '10-13': 825,
  '10-14': 839,
  '10-15': 853,
  '10-16': 866,
  '10-17': 878,
  '10-18': 890,
  '10-19': 901,
  '10-20': 912,
  '10-21': 921,
  '10-22': 931,
  '10-23': 940,
  '10-24': 948,
  '10-25': 955,
  '10-26': 961,
  '10-27': 967,
  '10-28': 972,
  '10-29': 976,
  '10-30': 980,
  '10-31': 982,
  '11-01': 984,
  '11-02': 985,
  '11-03': 985,
  '11-04': 984,
  '11-05': 983,
  '11-06': 981,
  '11-07': 977,
  '11-08': 973,
  '11-09': 969,
  '11-10': 963,
  '11-11': 956,
  '11-12': 949,
  '11-13': 941,
  '11-14': 932,
  '11-15': 922,
  '11-16': 911,
  '11-17': 900,
  '11-18': 887,
  '11-19': 874,
  '11-20': 860,
  '11-21': 846,
  '11-22': 830,
  '11-23': 814,
  '11-24': 797,
  '11-25': 779,
  '11-26': 760,
  '11-27': 741,
  '11-28': 721,
  '11-29': 700,
  '11-30': 678,
  '12-01': 656,
  '12-02': 633,
  '12-03': 609,
  '12-04': 585,
  '12-05': 561,
  '12-06': 535,
  '12-07': 509,
  '12-08': 483,
  '12-09': 456,
  '12-10': 429,
  '12-11': 402,
  '12-12': 374,
  '12-13': 346,
  '12-14': 317,
  '12-15': 288,
  '12-16': 259,
  '12-17': 230,
  '12-18': 201,
  '12-19': 171,
  '12-20': 142,
  '12-21': 112,
  '12-22': 82,
  '12-23': 52,
  '12-24': 23,
  '12-25': 7,
  '12-26': 37,
  '12-27': -66,
  '12-28': -96,
  '12-29': -125,
  '12-30': -154,
  '12-31': -183,
};

export function parseArgs(args: string[]): ParseArgsResult {
  const [, , time, genderString, sectString] = args;

  let gender: 0 | 1 = 1;
  if (genderString) {
    gender = Number.parseInt(genderString, 10) as 0 | 1;
    if (isNaN(gender) || ![0, 1].includes(gender)) {
      throw new Error('性别参数无效。男性传 1，女性传 0。');
    }
  }

  let sect: 1 | 2 = 2;
  if (sectString) {
    sect = Number.parseInt(sectString, 10) as 1 | 2;
    if (isNaN(sect) || ![1, 2].includes(sect)) {
      throw new Error(
        '早晚子时配置参数无效。传 1 表示 23:00-23:59 日干支为明天，传 2 表示 23:00-23:59 日干支为当天。'
      );
    }
  }

  return { time, gender, sect };
}

function buildMonthDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

export function getEquationOfTimeSeconds(date: Date): number {
  const key = buildMonthDayKey(date);
  const value = TRUE_SOLAR_DIFF_SECONDS_BY_MMDD[key];
  if (value === undefined) {
    throw new Error(`无法找到真平太阳时差：${key}`);
  }
  return value;
}

export function getMeanSolarOffsetSeconds(longitude: number, standardLongitude = 120): number {
  if (!Number.isFinite(longitude)) {
    throw new Error('经度无效：longitude 必须是有限数字。');
  }

  if (longitude < -180 || longitude > 180) {
    throw new Error('经度超出范围：longitude 必须在 -180 到 180 之间。');
  }

  if (!Number.isFinite(standardLongitude)) {
    throw new Error('标准经度无效：standardLongitude 必须是有限数字。');
  }

  return Math.round((longitude - standardLongitude) * 4 * 60);
}

/**
 * 参考 http://www.zyqmdj.com/1450.html 中的换算说明：
 * 真太阳时 = 当地平太阳时 + 真平太阳时差
 * 当地平太阳时 = 标准时 + (当地经度 - 标准经度) * 4 分钟
 *
 * 注：源表中存在极少数明显录入错误，本实现做了最小纠偏：
 * - 秒数写成 60 的条目归一化（如 +12分60秒 => +13分0秒）
 * - 02-24、05-01、10-21 按上下文连续性修正
 */
export function convertBeijingTimeToTrueSolarTime(
  beijingTime: Date,
  longitude: number,
  standardLongitude = 120
): TrueSolarTimeResult {
  if (!(beijingTime instanceof Date) || Number.isNaN(beijingTime.getTime())) {
    throw new Error('时间参数无效：beijingTime 必须是有效的 Date。');
  }

  const meanSolarOffsetSeconds = getMeanSolarOffsetSeconds(longitude, standardLongitude);
  const meanSolarTime = new Date(beijingTime.getTime() + meanSolarOffsetSeconds * 1000);

  const equationOfTimeSeconds = getEquationOfTimeSeconds(meanSolarTime);
  const totalOffsetSeconds = meanSolarOffsetSeconds + equationOfTimeSeconds;
  const trueSolarTime = new Date(beijingTime.getTime() + totalOffsetSeconds * 1000);

  return {
    trueSolarTime,
    meanSolarTime,
    meanSolarOffsetSeconds,
    equationOfTimeSeconds,
    totalOffsetSeconds,
  };
}

const DATE_TIME_WITHOUT_TIMEZONE =
  /^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;

function parseDateTimeWithoutTimezone(value: string): Date {
  const normalized = value.trim();
  const match = DATE_TIME_WITHOUT_TIMEZONE.exec(normalized);
  if (!match) {
    throw new Error(
      `时间格式无效：${value}。请使用不带时区的 YYYY-MM-DDTHH:mm[:ss]，例如 1990-05-15T14:30:00。`
    );
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);
  const second = match[6] ? Number.parseInt(match[6], 10) : 0;

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    throw new Error(`时间值无效：${value}。请确认时分秒在有效范围内。`);
  }

  const date = new Date(year, month - 1, day, hour, minute, second);
  if (
    date.getFullYear() !== year ||
    date.getMonth() + 1 !== month ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    throw new Error(`时间值无效：${value}。请确认年月日和时分秒是实际存在的时间。`);
  }

  return date;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateTimeWithoutTimezone(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(
    date.getMinutes()
  )}:${pad2(date.getSeconds())}`;
}

export function resolveCityLongitude(cityName: string): number | undefined {
  const normalized = cityName.trim();
  if (!normalized) {
    return undefined;
  }

  const direct = CITY_LONGITUDE_BY_NAME[normalized];
  if (direct !== undefined) {
    return direct;
  }

  const withoutSuffix = normalized.replace(/(市|地区|盟|自治州)$/u, '');
  return CITY_LONGITUDE_BY_NAME[withoutSuffix];
}

export function listSupportedCityNames(): string[] {
  return Object.keys(CITY_LONGITUDE_BY_NAME);
}

export function convertBeijingDateTimeStringToTrueSolarTime(
  beijingTimeString: string,
  longitude: number,
  standardLongitude = 120
): string {
  const beijingTime = parseDateTimeWithoutTimezone(beijingTimeString);
  const { trueSolarTime } = convertBeijingTimeToTrueSolarTime(beijingTime, longitude, standardLongitude);
  return formatDateTimeWithoutTimezone(trueSolarTime);
}
