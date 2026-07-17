#!/usr/bin/env node
import { astro } from 'iztro';

const MUTAGEN_KEY_TO_CN = {
  taiyinMaj: '太阴',
  tiantongMaj: '天同',
  tianjiMaj: '天机',
  jumenMaj: '巨门',
  wuquMaj: '武曲',
  tanlangMaj: '贪狼',
  tianliangMaj: '天梁',
  wenquMin: '文曲',
  pojunMaj: '破军',
  wenchangMin: '文昌',
  lianzhenMaj: '廉贞',
  ziweiMaj: '紫微',
  taiyangMaj: '太阳',
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const k = key.slice(2);
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) {
      out[k] = true;
      continue;
    }
    out[k] = v;
    i += 1;
  }
  return out;
}

function normalizeGender(raw) {
  const token = String(raw || '').trim().toLowerCase();
  if (['male', 'm', '1', '男'].includes(token)) return '男';
  if (['female', 'f', '0', '女'].includes(token)) return '女';
  throw new Error('gender only supports male/female/男/女');
}

function uniq(arr) {
  return [...new Set(arr)];
}

function normalizeMutagen(list) {
  return uniq((Array.isArray(list) ? list : []).map((x) => MUTAGEN_KEY_TO_CN[x] || x));
}

function palaceItem(p, index) {
  return {
    index,
    name: p.name,
    stem: p.heavenlyStem,
    branch: p.earthlyBranch,
    major: p.majorStars.map((s) => s.name),
    minor: p.minorStars.map((s) => s.name),
    adj: p.adjectiveStars.map((s) => s.name),
    decadal_range: [p.decadal.range[0], p.decadal.range[1]],
    ages: p.ages,
  };
}

function mingContext(palaces, mingIndex) {
  const idxs = [mingIndex, (mingIndex + 4) % 12, (mingIndex + 8) % 12, (mingIndex + 6) % 12];
  const tags = ['本宫', '三方一', '三方二', '对宫'];
  return {
    indices: idxs,
    related: idxs.map((idx, i) => ({
      tag: tags[i],
      palace: palaces[idx].name,
      stem_branch: `${palaces[idx].stem}${palaces[idx].branch}`,
      major: palaces[idx].major,
    })),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.date || !args['time-index'] || !args.gender) {
    throw new Error('required: --date --time-index --gender');
  }

  const date = args.date;
  const timeIndex = Number(args['time-index']);
  const gender = normalizeGender(args.gender);
  const year = args.year ? Number(args.year) : null;
  const anchorDate = args['anchor-date'] || null;

  const chart = astro.bySolar(date, timeIndex, gender, true, 'zh-CN');

  const palaces = chart.palaces.map((p, i) => palaceItem(p, i));
  const ming = palaceItem(chart.palace(0), 0);
  const bodyRaw = chart.palaces.find((p) => p.isBodyPalace);
  const body = bodyRaw ? palaceItem(bodyRaw, bodyRaw.index) : null;

  const decadals = palaces
    .map((p) => ({
      index: p.index,
      palace: p.name,
      stem_branch: `${p.stem}${p.branch}`,
      start_age: p.decadal_range[0],
      end_age: p.decadal_range[1],
      major: p.major,
    }))
    .sort((a, b) => a.start_age - b.start_age);

  let horoscope = null;
  if (year && anchorDate) {
    const hs = chart.horoscope(anchorDate);
    const d = palaceItem(chart.palace(hs.decadal.index), hs.decadal.index);
    const y = palaceItem(chart.palace(hs.yearly.index), hs.yearly.index);
    const a = palaceItem(chart.palace(hs.age.index), hs.age.index);
    const mutagen = normalizeMutagen(hs.yearly.mutagen || []);

    horoscope = {
      year,
      anchor_date: anchorDate,
      decadal: {
        palace: d.name,
        stem_branch: `${d.stem}${d.branch}`,
        major: d.major,
      },
      yearly: {
        palace: y.name,
        stem_branch: `${y.stem}${y.branch}`,
        major: y.major,
        mutagen,
      },
      age: {
        name: hs.age.name,
        palace: a.name,
        stem_branch: `${a.stem}${a.branch}`,
      },
    };
  }

  const payload = {
    five_elements_class: chart.fiveElementsClass,
    ming,
    body,
    ming_context: mingContext(palaces, 0),
    horoscope,
    palaces,
    decadals,
  };

  process.stdout.write(JSON.stringify(payload));
}

try {
  main();
} catch (err) {
  process.stderr.write(String(err?.stack || err));
  process.exit(1);
}
