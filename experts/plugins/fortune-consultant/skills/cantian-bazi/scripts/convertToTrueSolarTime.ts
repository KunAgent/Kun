import {
  convertBeijingDateTimeStringToTrueSolarTime,
  listSupportedCityNames,
  resolveCityLongitude,
} from './util.ts';

function fail(message: string): never {
  throw new Error(message);
}

function parseLongitude(raw: string, fieldName: string): number {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    fail(`${fieldName} 无效。请传入十进制度数，例如 114.17。`);
  }
  if (value < -180 || value > 180) {
    fail(`${fieldName} 超出范围。可用范围：-180 到 180。`);
  }
  return value;
}

function parseLongitudeOrCity(raw: string): number {
  const number = Number.parseFloat(raw);
  if (Number.isFinite(number)) {
    return parseLongitude(raw, 'longitude');
  }

  const longitude = resolveCityLongitude(raw);
  if (longitude !== undefined) {
    return longitude;
  }

  const sampleCities = listSupportedCityNames().slice(0, 8).join('、');
  fail(`无法识别地点：${raw}。请传经度（如 114.17）或城市名（如 武汉）。示例城市：${sampleCities}。`);
}

const [, , beijingTimeString, locationRaw, standardLongitudeRaw] = process.argv;
if (!beijingTimeString || !locationRaw) {
  fail(
    '参数不足。用法：node scripts/convertToTrueSolarTime.ts <beijingTime> <longitudeOrCity> [standardLongitude]'
  );
}

const longitude = parseLongitudeOrCity(locationRaw);
const standardLongitude =
  standardLongitudeRaw === undefined ? 120 : parseLongitude(standardLongitudeRaw, 'standardLongitude');

const trueSolarTime = convertBeijingDateTimeStringToTrueSolarTime(
  beijingTimeString,
  longitude,
  standardLongitude
);

// 输出可直接传给其它脚本的时间字符串
console.log(trueSolarTime);
