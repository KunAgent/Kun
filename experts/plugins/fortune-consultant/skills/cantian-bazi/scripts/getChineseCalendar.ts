import { getChineseCalendar, getChineseCalendarMarkdown } from 'cantian-tymext';

function parseInputDate(input?: string): Date {
  if (!input) {
    return new Date();
  }

  const normalized = input.trim().replace(/\//g, '-');
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
  if (!match) {
    throw new Error('日期格式无效。请传入 YYYY-MM-DD（也兼容 YYYY/MM/DD）。');
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() + 1 !== month ||
    date.getDate() !== day
  ) {
    throw new Error('日期值无效。请确认年月日是实际存在的日期。');
  }

  return date;
}

const dateArg = process.argv[2];
const date = parseInputDate(dateArg);
const chineseCalendar = getChineseCalendar({
  year: date.getFullYear(),
  month: date.getMonth() + 1,
  day: date.getDate(),
});
const markdown = getChineseCalendarMarkdown(chineseCalendar);
console.log(markdown);
