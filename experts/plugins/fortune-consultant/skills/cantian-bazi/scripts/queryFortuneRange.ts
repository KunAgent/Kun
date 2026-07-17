import {
  appendRelation,
  EarthBranch,
  HeavenStem,
  SixtyCycleDay,
  SixtyCycleHour,
  SixtyCycle,
  SixtyCycleYear,
  SolarDay,
  SolarTime,
  buildBaziFromLunar,
  buildBaziFromSolar,
  getShenFromDayun,
} from 'cantian-tymext';

type Gender = 0 | 1;
type Sect = 1 | 2;
type IncludeUnit = 'year' | 'month' | 'day' | 'hour';

interface QueryInput {
  birth: {
    calendar: 'solar' | 'lunar';
    time: string;
    gender?: Gender;
    sect?: Sect;
  };
  query: {
    startDateTime: string;
    endDateTime: string;
    level?: IncludeUnit;
  };
}

interface DateParseResult {
  date: Date;
  precision: 'date' | 'hour';
}

interface DecadeFortuneItem {
  干支: string;
  开始年份: number;
  结束: number;
  开始年龄: number;
  结束年龄: number;
  天干十神?: string;
  地支十神?: string[];
  地支藏干?: string[];
}

interface TenGodDetail {
  天干十神: string;
  地支十神: string[];
  地支藏干: string[];
}

interface GanzhiExtraDetail {
  纳音: string;
  星运: string;
  自坐: string;
  空亡: string;
}

type RelationDetail = unknown;

interface BaseTimelineItem {
  年份: number;
  时间: string;
  流年干支: string;
  流年十神: TenGodDetail;
  流年扩展: GanzhiExtraDetail;
  流年神煞: string[];
  流年刑冲合会: RelationDetail;
  流月干支: string;
  流月十神: TenGodDetail;
  流月扩展: GanzhiExtraDetail;
  流月神煞: string[];
  流月刑冲合会: RelationDetail;
  流日干支: string;
  流日十神: TenGodDetail;
  流日扩展: GanzhiExtraDetail;
  流日神煞: string[];
  流日刑冲合会: RelationDetail;
  当前大运: DecadeFortuneItem | null;
}

interface MonthPeriod {
  开始日期: string;
  结束日期: string;
  流月干支: string;
  流月十神: TenGodDetail;
  流月扩展: GanzhiExtraDetail;
  流月神煞: string[];
  流月刑冲合会: RelationDetail;
  流年干支: string;
  流年十神: TenGodDetail;
  流年扩展: GanzhiExtraDetail;
  流年神煞: string[];
  流年刑冲合会: RelationDetail;
  当前大运: DecadeFortuneItem | null;
}

interface HourPeriod extends BaseTimelineItem {
  开始时间: string;
  结束时间: string;
  流时干支: string;
  流时十神: TenGodDetail;
  流时扩展: GanzhiExtraDetail;
  流时神煞: string[];
  流时刑冲合会: RelationDetail;
}

function fail(message: string): never {
  throw new Error(message);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatDateHour(date: Date): string {
  return `${formatDate(date)}T${pad2(date.getHours())}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
  );
}

function addHours(date: Date, hours: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours() + hours,
    date.getMinutes(),
    date.getSeconds()
  );
}

function normalizeInputDateTime(value: string, isEnd: boolean): DateParseResult {
  const trimmed = value.trim();
  const dateOnly = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  const hourOnly = /^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2})$/;

  let y = 0;
  let m = 0;
  let d = 0;
  let h = 0;
  let precision: DateParseResult['precision'] = 'date';

  const dateMatch = dateOnly.exec(trimmed);
  if (dateMatch) {
    y = Number.parseInt(dateMatch[1], 10);
    m = Number.parseInt(dateMatch[2], 10);
    d = Number.parseInt(dateMatch[3], 10);
    h = isEnd ? 23 : 0;
  } else {
    const hourMatch = hourOnly.exec(trimmed);
    if (!hourMatch) {
      fail(
        `时间格式无效：${value}。请使用 YYYY-MM-DD 或 YYYY-MM-DDTHH（例如 2026-05-01 或 2026-05-01T09）。`
      );
    }
    y = Number.parseInt(hourMatch[1], 10);
    m = Number.parseInt(hourMatch[2], 10);
    d = Number.parseInt(hourMatch[3], 10);
    h = Number.parseInt(hourMatch[4], 10);
    precision = 'hour';
  }

  if (h < 0 || h > 23) {
    fail(`小时值无效：${value}。HH 取值范围为 00-23。`);
  }

  const date = new Date(y, m - 1, d, h, 0, 0);
  if (
    date.getFullYear() !== y ||
    date.getMonth() + 1 !== m ||
    date.getDate() !== d ||
    date.getHours() !== h
  ) {
    fail(`时间值无效：${value}。请确认年月日和小时是实际存在的时间。`);
  }

  return { date, precision };
}

function parseInput(args: string[]): QueryInput {
  const raw = args[2];
  if (!raw) {
    fail('缺少参数。请传入 JSON 字符串参数。');
  }

  let input: QueryInput;
  try {
    input = JSON.parse(raw) as QueryInput;
  } catch {
    fail('参数 JSON 解析失败。请传入合法 JSON。');
  }

  if (!input.birth || !input.query) {
    fail('参数缺少 birth 或 query 字段。');
  }

  if (!['solar', 'lunar'].includes(input.birth.calendar)) {
    fail('birth.calendar 无效。可选值：solar、lunar。');
  }

  if (!input.birth.time) {
    fail('birth.time 不能为空。');
  }

  if (input.birth.gender !== undefined && ![0, 1].includes(input.birth.gender)) {
    fail('birth.gender 无效。男性传 1，女性传 0。');
  }

  if (input.birth.sect !== undefined && ![1, 2].includes(input.birth.sect)) {
    fail(
      'birth.sect 无效。传 1 表示 23:00-23:59 日干支为明天，传 2 表示 23:00-23:59 日干支为当天。'
    );
  }

  if (!input.query.startDateTime || !input.query.endDateTime) {
    fail('query.startDateTime 和 query.endDateTime 必填。');
  }

  const level = input.query.level ?? 'year';
  const allowed = new Set<IncludeUnit>(['year', 'month', 'day', 'hour']);
  if (!allowed.has(level)) {
    fail('query.level 含无效值。可选：year、month、day、hour。');
  }

  input.query.level = level;

  return input;
}

function renderTenGod(lines: string[], detail: TenGodDetail, level: number) {
  lines.push(`${'#'.repeat(level)} 十神`);
  lines.push(`天干十神 ${detail.天干十神}`);
  lines.push(`地支十神 ${detail.地支十神.join('、')}`);
  lines.push(`地支藏干 ${detail.地支藏干.join('、')}`);
}

function renderExtra(lines: string[], detail: GanzhiExtraDetail, level: number) {
  lines.push(`${'#'.repeat(level)} 扩展`);
  lines.push(`纳音 ${detail.纳音}`);
  lines.push(`星运 ${detail.星运}`);
  lines.push(`自坐 ${detail.自坐}`);
  lines.push(`空亡 ${detail.空亡}`);
}

function renderRelationList(lines: string[], title: string, relations: RelationDetail, level: number) {
  lines.push(`${'#'.repeat(level)} ${title}`);
  const list = Array.isArray(relations) ? relations : [];
  if (list.length === 0) {
    lines.push('无');
    return;
  }
  for (let i = 0; i < list.length; i++) {
    const item = list[i] as Record<string, unknown>;
    const rel = String(item.关系 ?? '');
    const assoc = Array.isArray(item.关联柱) ? item.关联柱.join('、') : String(item.关联柱 ?? '');
    const desc = String(item.描述 ?? '');
    lines.push(`${rel} ${assoc}${desc}`);
  }
}

function buildMarkdownReport(output: {
  meta: {
    generatedAt: string;
    inputEcho: QueryInput;
    normalizedRange: { startDateTime: string; endDateTime: string; startPrecision: string; endPrecision: string };
    hourMode?: string;
  };
  natal: {
    八字: string;
    日主: string;
    起运日期?: string;
    起运年龄?: number;
    大运: DecadeFortuneItem[];
  };
  result: {
    years: Array<{
      年份: number;
      流年干支: string;
      流年十神: TenGodDetail;
      流年扩展: GanzhiExtraDetail;
      流年神煞: string[];
      流年刑冲合会: RelationDetail;
      当前大运: DecadeFortuneItem | null;
    }>;
    months: MonthPeriod[];
    days: BaseTimelineItem[];
    hours: HourPeriod[];
  };
}): string {
  const lines: string[] = ['# 运势流转', ''];

  lines.push('## 查询范围');
  lines.push(`开始 ${output.meta.normalizedRange.startDateTime}`);
  lines.push(`结束 ${output.meta.normalizedRange.endDateTime}`);
  lines.push('');

  lines.push('## 命盘');
  lines.push(`八字 ${output.natal.八字}`);
  lines.push(`日主 ${output.natal.日主}`);
  lines.push(`起运日期 ${output.natal.起运日期 ?? ''}`);
  lines.push(`起运年龄 ${output.natal.起运年龄 ?? ''}`);
  lines.push('### 大运');
  output.natal.大运.forEach((d) => {
    lines.push(`#### ${d.干支}大运 ${d.开始年份}-${d.结束}年`);
    lines.push(`开始年份 ${d.开始年份}`);
    lines.push(`结束 ${d.结束}`);
    lines.push(`开始年龄 ${d.开始年龄}`);
    lines.push(`结束年龄 ${d.结束年龄}`);
    lines.push(`天干十神 ${d.天干十神 ?? ''}`);
    lines.push(`地支十神 ${(d.地支十神 ?? []).join('、')}`);
    lines.push(`地支藏干 ${(d.地支藏干 ?? []).join('、')}`);
  });
  lines.push('');

  lines.push('## 流转结果');
  if (output.result.years.length > 0) {
    lines.push('### 流年');
    output.result.years.forEach((y) => {
      lines.push(`#### ${y.流年干支}流年 ${y.年份}年`);
      lines.push(`年份 ${y.年份}`);
      renderTenGod(lines, y.流年十神, 5);
      renderExtra(lines, y.流年扩展, 5);
      lines.push(`##### 流年神煞`);
      lines.push(y.流年神煞.join('、'));
      renderRelationList(lines, '流年刑冲合会', y.流年刑冲合会, 5);
    });
  }

  if (output.result.months.length > 0) {
    lines.push('### 流月');
    output.result.months.forEach((m) => {
      lines.push(`#### ${m.流月干支}流月 ${m.开始日期}-${m.结束日期}`);
      lines.push(`开始日期 ${m.开始日期}`);
      lines.push(`结束日期 ${m.结束日期}`);
      lines.push(`流年干支 ${m.流年干支}`);
      renderTenGod(lines, m.流月十神, 5);
      renderExtra(lines, m.流月扩展, 5);
      lines.push(`##### 流月神煞`);
      lines.push(m.流月神煞.join('、'));
      renderRelationList(lines, '流月刑冲合会', m.流月刑冲合会, 5);
    });
  }

  if (output.result.days.length > 0) {
    lines.push('### 流日');
    output.result.days.forEach((d) => {
      lines.push(`#### ${d.流日干支}流日 ${d.时间}`);
      lines.push(`年份 ${d.年份}`);
      lines.push(`时间 ${d.时间}`);
      lines.push(`流年干支 ${d.流年干支}`);
      lines.push(`流月干支 ${d.流月干支}`);
      renderTenGod(lines, d.流日十神, 5);
      renderExtra(lines, d.流日扩展, 5);
      lines.push(`##### 流日神煞`);
      lines.push(d.流日神煞.join('、'));
      renderRelationList(lines, '流日刑冲合会', d.流日刑冲合会, 5);
    });
  }

  if (output.result.hours.length > 0) {
    lines.push('### 流时');
    output.result.hours.forEach((h) => {
      lines.push(`#### ${h.流时干支}流时 ${h.开始时间}-${h.结束时间}`);
      lines.push(`流年干支 ${h.流年干支}`);
      lines.push(`流月干支 ${h.流月干支}`);
      lines.push(`流日干支 ${h.流日干支}`);
      renderTenGod(lines, h.流时十神, 5);
      renderExtra(lines, h.流时扩展, 5);
      lines.push(`##### 流时神煞`);
      lines.push(h.流时神煞.join('、'));
      renderRelationList(lines, '流时刑冲合会', h.流时刑冲合会, 5);
    });
  }

  return lines.join('\n');
}

function getCurrentDayun(dayunList: DecadeFortuneItem[], year: number): DecadeFortuneItem | null {
  const found = dayunList.find((d) => year >= d.开始年份 && year <= d.结束);
  return found ?? null;
}

function buildTenGodDetail(dayMaster: HeavenStem, ganzhi: string): TenGodDetail {
  const gan = ganzhi.slice(0, 1);
  const zhi = ganzhi.slice(1, 2);
  const heavenStem = HeavenStem.fromName(gan);
  const earthBranch = EarthBranch.fromName(zhi);
  const hideHeavenStems = earthBranch.getHideHeavenStems().map((item) => item.getHeavenStem());
  return {
    天干十神: dayMaster.getTenStar(heavenStem).getName(),
    地支十神: hideHeavenStems.map((stem) => dayMaster.getTenStar(stem).getName()),
    地支藏干: hideHeavenStems.map((stem) => stem.toString()),
  };
}

function buildGanzhiExtraDetail(dayMaster: HeavenStem, ganzhi: string): GanzhiExtraDetail {
  const sixtyCycle = SixtyCycle.fromName(ganzhi);
  const gan = sixtyCycle.getHeavenStem();
  const zhi = sixtyCycle.getEarthBranch();
  return {
    纳音: sixtyCycle.getSound().toString(),
    星运: dayMaster.getTerrain(zhi).toString(),
    自坐: gan.getTerrain(zhi).toString(),
    空亡: sixtyCycle.getExtraEarthBranches().join(''),
  };
}

function buildFlowShen(baziText: string, ganzhi: string): string[] {
  const gan = ganzhi.slice(0, 1);
  const zhi = ganzhi.slice(1, 2);
  return getShenFromDayun(baziText, gan, zhi);
}

function buildFlowRelation(preGanzhiArray: string[], ganzhi: string): RelationDetail {
  return appendRelation(preGanzhiArray, ganzhi);
}

function buildBaseBazi(input: QueryInput) {
  const gender = input.birth.gender ?? 1;
  const sect = input.birth.sect ?? 2;

  if (input.birth.calendar === 'solar') {
    return buildBaziFromSolar({
      solarTime: input.birth.time,
      gender,
      sect,
    });
  }

  return buildBaziFromLunar({
    lunarTime: input.birth.time,
    gender,
    sect,
  });
}

function getFlowFromDate(
  date: Date,
  dayunList: DecadeFortuneItem[],
  dayMaster: HeavenStem,
  baziText: string,
  natalGanzhiArray: string[]
): BaseTimelineItem {
  const solarDay = SolarDay.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const scDay = SixtyCycleDay.fromSolarDay(solarDay);
  const liunianGanzhi = SixtyCycleYear.fromYear(date.getFullYear()).getSixtyCycle().toString();
  const liuyueGanzhi = scDay.getSixtyCycleMonth().getSixtyCycle().toString();
  const liuriGanzhi = scDay.getSixtyCycle().toString();

  return {
    年份: date.getFullYear(),
    时间: formatDateHour(date),
    流年干支: liunianGanzhi,
    流年十神: buildTenGodDetail(dayMaster, liunianGanzhi),
    流年扩展: buildGanzhiExtraDetail(dayMaster, liunianGanzhi),
    流年神煞: buildFlowShen(baziText, liunianGanzhi),
    流年刑冲合会: buildFlowRelation(natalGanzhiArray, liunianGanzhi),
    流月干支: liuyueGanzhi,
    流月十神: buildTenGodDetail(dayMaster, liuyueGanzhi),
    流月扩展: buildGanzhiExtraDetail(dayMaster, liuyueGanzhi),
    流月神煞: buildFlowShen(baziText, liuyueGanzhi),
    流月刑冲合会: buildFlowRelation([...natalGanzhiArray, liunianGanzhi], liuyueGanzhi),
    流日干支: liuriGanzhi,
    流日十神: buildTenGodDetail(dayMaster, liuriGanzhi),
    流日扩展: buildGanzhiExtraDetail(dayMaster, liuriGanzhi),
    流日神煞: buildFlowShen(baziText, liuriGanzhi),
    流日刑冲合会: buildFlowRelation([...natalGanzhiArray, liunianGanzhi], liuriGanzhi),
    当前大运: getCurrentDayun(dayunList, date.getFullYear()),
  };
}

function buildYearItems(
  start: Date,
  end: Date,
  dayunList: DecadeFortuneItem[],
  dayMaster: HeavenStem,
  baziText: string,
  natalGanzhiArray: string[]
) {
  const items: Array<{
    年份: number;
    流年干支: string;
    流年十神: TenGodDetail;
    流年扩展: GanzhiExtraDetail;
    流年神煞: string[];
    流年刑冲合会: RelationDetail;
    当前大运: DecadeFortuneItem | null;
  }> = [];

  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    const liunianGanzhi = SixtyCycleYear.fromYear(y).getSixtyCycle().toString();
    items.push({
      年份: y,
      流年干支: liunianGanzhi,
      流年十神: buildTenGodDetail(dayMaster, liunianGanzhi),
      流年扩展: buildGanzhiExtraDetail(dayMaster, liunianGanzhi),
      流年神煞: buildFlowShen(baziText, liunianGanzhi),
      流年刑冲合会: buildFlowRelation(natalGanzhiArray, liunianGanzhi),
      当前大运: getCurrentDayun(dayunList, y),
    });
  }
  return items;
}

function buildDayItems(
  start: Date,
  end: Date,
  dayunList: DecadeFortuneItem[],
  dayMaster: HeavenStem,
  baziText: string,
  natalGanzhiArray: string[]
) {
  const first = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0);
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0);
  const items: BaseTimelineItem[] = [];

  let cursor = first;
  while (cursor.getTime() <= last.getTime()) {
    items.push(getFlowFromDate(cursor, dayunList, dayMaster, baziText, natalGanzhiArray));
    cursor = addDays(cursor, 1);
  }
  return items;
}

function buildMonthPeriods(dayItems: BaseTimelineItem[]): MonthPeriod[] {
  if (dayItems.length === 0) {
    return [];
  }

  const periods: MonthPeriod[] = [];
  for (const item of dayItems) {
    const date = item.时间.slice(0, 10);
    const last = periods[periods.length - 1];
    if (last && last.流月干支 === item.流月干支) {
      last.结束日期 = date;
      continue;
    }

    periods.push({
      开始日期: date,
      结束日期: date,
      流月干支: item.流月干支,
      流月十神: item.流月十神,
      流月扩展: item.流月扩展,
      流月神煞: item.流月神煞,
      流月刑冲合会: item.流月刑冲合会,
      流年干支: item.流年干支,
      流年十神: item.流年十神,
      流年扩展: item.流年扩展,
      流年神煞: item.流年神煞,
      流年刑冲合会: item.流年刑冲合会,
      当前大运: item.当前大运,
    });
  }
  return periods;
}

function buildHourPeriods(
  start: Date,
  end: Date,
  dayunList: DecadeFortuneItem[],
  dayMaster: HeavenStem,
  baziText: string,
  natalGanzhiArray: string[]
): HourPeriod[] {
  const periods: HourPeriod[] = [];
  let cursor = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
    start.getHours(),
    0,
    0
  );

  while (cursor.getTime() <= end.getTime()) {
    const solarTime = SolarTime.fromYmdHms(
      cursor.getFullYear(),
      cursor.getMonth() + 1,
      cursor.getDate(),
      cursor.getHours(),
      0,
      0
    );
    const scHour = SixtyCycleHour.fromSolarTime(solarTime);
    const scDay = scHour.getSixtyCycleDay();
    const hourGanzhi = scHour.getSixtyCycle().toString();
    const liunianGanzhi = SixtyCycleYear.fromYear(cursor.getFullYear()).getSixtyCycle().toString();
    const liuyueGanzhi = scDay.getSixtyCycleMonth().getSixtyCycle().toString();
    const liuriGanzhi = scDay.getSixtyCycle().toString();

    const current: HourPeriod = {
      年份: cursor.getFullYear(),
      时间: formatDateHour(cursor),
      开始时间: formatDateHour(cursor),
      结束时间: formatDateHour(cursor),
      流时干支: hourGanzhi,
      流时十神: buildTenGodDetail(dayMaster, hourGanzhi),
      流时扩展: buildGanzhiExtraDetail(dayMaster, hourGanzhi),
      流时神煞: buildFlowShen(baziText, hourGanzhi),
      流时刑冲合会: buildFlowRelation([...natalGanzhiArray, liunianGanzhi], hourGanzhi),
      流年干支: liunianGanzhi,
      流年十神: buildTenGodDetail(dayMaster, liunianGanzhi),
      流年扩展: buildGanzhiExtraDetail(dayMaster, liunianGanzhi),
      流年神煞: buildFlowShen(baziText, liunianGanzhi),
      流年刑冲合会: buildFlowRelation(natalGanzhiArray, liunianGanzhi),
      流月干支: liuyueGanzhi,
      流月十神: buildTenGodDetail(dayMaster, liuyueGanzhi),
      流月扩展: buildGanzhiExtraDetail(dayMaster, liuyueGanzhi),
      流月神煞: buildFlowShen(baziText, liuyueGanzhi),
      流月刑冲合会: buildFlowRelation([...natalGanzhiArray, liunianGanzhi], liuyueGanzhi),
      流日干支: liuriGanzhi,
      流日十神: buildTenGodDetail(dayMaster, liuriGanzhi),
      流日扩展: buildGanzhiExtraDetail(dayMaster, liuriGanzhi),
      流日神煞: buildFlowShen(baziText, liuriGanzhi),
      流日刑冲合会: buildFlowRelation([...natalGanzhiArray, liunianGanzhi], liuriGanzhi),
      当前大运: getCurrentDayun(dayunList, cursor.getFullYear()),
    };

    const last = periods[periods.length - 1];
    if (
      last &&
      last.流时干支 === current.流时干支 &&
      last.流日干支 === current.流日干支 &&
      last.流月干支 === current.流月干支 &&
      last.流年干支 === current.流年干支
    ) {
      last.结束时间 = current.结束时间;
    } else {
      periods.push(current);
    }

    cursor = addHours(cursor, 1);
  }

  return periods;
}

const input = parseInput(process.argv);
const startParsed = normalizeInputDateTime(input.query.startDateTime, false);
const endParsed = normalizeInputDateTime(input.query.endDateTime, true);

if (startParsed.date.getTime() > endParsed.date.getTime()) {
  fail('时间范围无效：startDateTime 不能晚于 endDateTime。');
}

const level = input.query.level ?? 'year';
const levelRank: Record<IncludeUnit, number> = { year: 1, month: 2, day: 3, hour: 4 };
const rank = levelRank[level];
const hasYear = rank >= levelRank.year;
const hasMonth = rank >= levelRank.month;
const hasDay = rank >= levelRank.day;
const hasHour = rank >= levelRank.hour;

if (hasHour) {
  const maxHourSpan = 24 * 62;
  const hours = Math.floor((endParsed.date.getTime() - startParsed.date.getTime()) / 3600000) + 1;
  if (hours > maxHourSpan) {
    fail('hour 查询区间过大。为避免输出过长，包含 hour 时最多支持 62 天。');
  }
}

const bazi = buildBaseBazi(input);
const dayunList = (bazi.大运?.大运 ?? []) as DecadeFortuneItem[];
const dayMaster = HeavenStem.fromName(bazi.日主);
const natalGanzhiArray = bazi.八字.trim().split(/\s+/);
if (natalGanzhiArray.length < 4) {
  fail(`八字格式无效：${bazi.八字}`);
}

let yearItems: ReturnType<typeof buildYearItems> = [];
if (hasYear) {
  yearItems = buildYearItems(
    startParsed.date,
    endParsed.date,
    dayunList,
    dayMaster,
    bazi.八字,
    natalGanzhiArray
  );
}

let dayItems: ReturnType<typeof buildDayItems> = [];
if (hasDay || hasMonth) {
  dayItems = buildDayItems(
    startParsed.date,
    endParsed.date,
    dayunList,
    dayMaster,
    bazi.八字,
    natalGanzhiArray
  );
}

let monthPeriods: ReturnType<typeof buildMonthPeriods> = [];
if (hasMonth) {
  monthPeriods = buildMonthPeriods(dayItems);
}

let hourPeriods: ReturnType<typeof buildHourPeriods> = [];
if (hasHour) {
  hourPeriods = buildHourPeriods(
    startParsed.date,
    endParsed.date,
    dayunList,
    dayMaster,
    bazi.八字,
    natalGanzhiArray
  );
}

const output = {
  meta: {
    generatedAt: new Date().toISOString(),
    inputEcho: input,
    normalizedRange: {
      startDateTime: formatDateHour(startParsed.date),
      endDateTime: formatDateHour(endParsed.date),
      startPrecision: startParsed.precision,
      endPrecision: endParsed.precision,
    },
    hourMode: hasHour ? 'shichen-like (merged contiguous same liushi)' : undefined,
  },
  natal: {
    八字: bazi.八字,
    日主: bazi.日主,
    起运日期: bazi.大运?.起运日期,
    起运年龄: bazi.大运?.起运年龄,
    大运: dayunList,
  },
  result: {
    years: yearItems,
    months: monthPeriods,
    days: hasDay ? dayItems : [],
    hours: hourPeriods,
  },
};

console.log(buildMarkdownReport(output));
