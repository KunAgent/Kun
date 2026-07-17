#!/usr/bin/env node
/**
 * 六爻预测脚本（纳甲法）
 * 模拟三枚铜钱摇六次成卦
 * 输入：6组阴阳信息（每组3个0或1，1=阳面）
 *
 * 爻位编号：初爻(1)到上爻(6)，从下到上
 * 数组索引：index 0 = 初爻, index 5 = 上爻
 */

// ============================================================
// 基础数据
// ============================================================

const tianGan = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const diZhi = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const yaoNames = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];

// 八卦符号
const baGua = {
  '乾': '☰', '兑': '☱', '离': '☲', '震': '☳',
  '巽': '☴', '坎': '☵', '艮': '☶', '坤': '☷'
};

// 八卦五行
const baGuaElement = {
  '乾': '金', '兑': '金', '离': '火', '震': '木',
  '巽': '木', '坎': '水', '艮': '土', '坤': '土'
};

// 天干 -> 五行
const ganElement = {
  '甲': '木', '乙': '木', '丙': '火', '丁': '火', '戊': '土',
  '己': '土', '庚': '金', '辛': '金', '壬': '水', '癸': '水'
};

// 地支 -> 五行
const zhiElement = {
  '子': '水', '亥': '水', '寅': '木', '卯': '木',
  '巳': '火', '午': '火', '申': '金', '酉': '金',
  '丑': '土', '辰': '土', '未': '土', '戌': '土'
};

// 地支藏干
const zangGan = {
  '子': ['癸'], '丑': ['己', '癸', '辛'], '寅': ['甲', '丙', '戊'],
  '卯': ['乙'], '辰': ['戊', '乙', '癸'], '巳': ['丙', '庚', '戊'],
  '午': ['丁', '己'], '未': ['己', '丁', '乙'], '申': ['庚', '壬', '戊'],
  '酉': ['辛'], '戌': ['戊', '辛', '丁'], '亥': ['壬', '甲']
};

// ============================================================
// 八卦判定：从三位阴阳确定是哪一卦
// ============================================================

// 八卦的三位编码：从初爻到上爻（bottom to top）
// 用二进制表示：1=阳, 0=阴
const baGuaByPattern = {
  '111': '乾', '011': '兑', '101': '离', '001': '震',
  '110': '巽', '010': '坎', '100': '艮', '000': '坤'
};

// ============================================================
// 纳甲天干：每个卦对应的纳甲天干
// 乾内甲外壬, 坤内乙外癸, 其余各纳一干
// ============================================================

const naJiaGan = {
  '乾': { inner: '甲', outer: '壬' },
  '坤': { inner: '乙', outer: '癸' },
  '震': { inner: '庚', outer: '庚' },
  '巽': { inner: '辛', outer: '辛' },
  '坎': { inner: '戊', outer: '戊' },
  '离': { inner: '己', outer: '己' },
  '艮': { inner: '丙', outer: '丙' },
  '兑': { inner: '丁', outer: '丁' }
};

// ============================================================
// 纳甲地支：每个卦内卦、外卦各有三个地支（从下到上）
// ============================================================

const naJiaZhi = {
  '乾': { inner: ['子', '寅', '辰'], outer: ['午', '申', '戌'] },
  '坤': { inner: ['未', '巳', '卯'], outer: ['丑', '亥', '酉'] },
  '震': { inner: ['子', '寅', '辰'], outer: ['午', '申', '戌'] },
  '巽': { inner: ['丑', '亥', '酉'], outer: ['未', '巳', '卯'] },
  '坎': { inner: ['寅', '辰', '午'], outer: ['申', '戌', '子'] },
  '离': { inner: ['卯', '丑', '亥'], outer: ['酉', '未', '巳'] },
  '艮': { inner: ['辰', '午', '申'], outer: ['戌', '子', '寅'] },
  '兑': { inner: ['巳', '卯', '丑'], outer: ['亥', '酉', '未'] }
};

// ============================================================
// 六十四卦归属八宫及世应位置
// 每个八宫有8个卦，按 本位、一世、二世、三世、四世、五世、游魂、归魂 排列
// 世应位置：世爻和应爻的爻位编号(1-6)
// ============================================================

const palaceRules = [
  { position: '本位卦', shi: 6, ying: 3 },
  { position: '一世卦', shi: 1, ying: 4 },
  { position: '二世卦', shi: 2, ying: 5 },
  { position: '三世卦', shi: 3, ying: 6 },
  { position: '四世卦', shi: 4, ying: 1 },
  { position: '五世卦', shi: 5, ying: 2 },
  { position: '游魂卦', shi: 4, ying: 1 },
  { position: '归魂卦', shi: 3, ying: 6 }
];

// 八宫卦序 - 每宫8卦，按 本位、一世、二世、三世、四世、五世、游魂、归魂 排列
// 使用内外卦组合确定：key = "外卦-内卦"
// 八宫顺序按 乾、兑、离、震、巽、坎、艮、坤（先天序 reversed / 后天常用序）
const palaceMembers = {
  // 乾宫 (金)
  '乾': ['乾', '姤', '遁', '否', '观', '剥', '晋', '大有'],
  // 坎宫 (水)
  '坎': ['坎', '节', '屯', '既济', '革', '丰', '明夷', '师'],
  // 艮宫 (土)
  '艮': ['艮', '贲', '大畜', '损', '睽', '履', '中孚', '渐'],
  // 震宫 (木)
  '震': ['震', '豫', '解', '恒', '升', '井', '大过', '随'],
  // 巽宫 (木)
  '巽': ['巽', '小畜', '家人', '益', '无妄', '噬嗑', '颐', '蛊'],
  // 离宫 (火)
  '离': ['离', '旅', '鼎', '未济', '蒙', '涣', '讼', '同人'],
  // 坤宫 (土)
  '坤': ['坤', '复', '临', '泰', '大壮', '夬', '需', '比'],
  // 兑宫 (金)
  '兑': ['兑', '困', '萃', '咸', '蹇', '谦', '小过', '归妹']
};

// 建立 卦名 -> { palace, index } 的反向查找表
const hexagramPalaceMap = {};
for (const [palace, members] of Object.entries(palaceMembers)) {
  members.forEach((name, idx) => {
    hexagramPalaceMap[name] = { palace, index: idx };
  });
}

// ============================================================
// 六十四卦名：通过内外卦组合查找卦名
// key: "外卦-内卦"
// ============================================================

const hexagramByTrigrams = {
  '乾-乾': '乾', '乾-坎': '讼', '乾-艮': '遁', '乾-震': '无妄',
  '乾-巽': '姤', '乾-离': '同人', '乾-坤': '否', '乾-兑': '履',
  '坎-乾': '需', '坎-坎': '坎', '坎-艮': '蹇', '坎-震': '屯',
  '坎-巽': '井', '坎-离': '既济', '坎-坤': '比', '坎-兑': '节',
  '艮-乾': '大畜', '艮-坎': '蒙', '艮-艮': '艮', '艮-震': '颐',
  '艮-巽': '蛊', '艮-离': '贲', '艮-坤': '剥', '艮-兑': '损',
  '震-乾': '大壮', '震-坎': '解', '震-艮': '小过', '震-震': '震',
  '震-巽': '恒', '震-离': '丰', '震-坤': '豫', '震-兑': '归妹',
  '巽-乾': '小畜', '巽-坎': '涣', '巽-艮': '渐', '巽-震': '益',
  '巽-巽': '巽', '巽-离': '家人', '巽-坤': '观', '巽-兑': '中孚',
  '离-乾': '大有', '离-坎': '未济', '离-艮': '旅', '离-震': '噬嗑',
  '离-巽': '鼎', '离-离': '离', '离-坤': '晋', '离-兑': '睽',
  '坤-乾': '泰', '坤-坎': '师', '坤-艮': '谦', '坤-震': '复',
  '坤-巽': '升', '坤-离': '明夷', '坤-坤': '坤', '坤-兑': '临',
  '兑-乾': '夬', '兑-坎': '困', '兑-艮': '咸', '兑-震': '随',
  '兑-巽': '大过', '兑-离': '革', '兑-坤': '萃', '兑-兑': '兑'
};

// ============================================================
// 六神 (六兽)
// 六神顺序固定：青龙、朱雀、勾陈、螣蛇、白虎、玄武
// 根据日干确定从第几个六神开始排
// ============================================================

const liuShenOrder = ['青龙', '朱雀', '勾陈', '螣蛇', '白虎', '玄武'];

// 日干 -> 六神起始索引
const liuShenStartByGan = {
  '甲': 0, '乙': 0,  // 青龙起
  '丙': 1, '丁': 1,  // 朱雀起
  '戊': 2,            // 勾陈起
  '己': 2,            // 勾陈起
  '庚': 4, '辛': 4,  // 白虎起
  '壬': 5, '癸': 5   // 玄武起
};

// ============================================================
// 五行生克关系
// ============================================================

// 五行循环：木火土金水（相生顺序）
const wuXingOrder = ['木', '火', '土', '金', '水'];

/**
 * 判断 dayEl 对 lineEl 的六亲关系
 * - 同我者 → 兄弟
 * - 我生者 → 子孙
 * - 生我者 → 父母
 * - 我克者 → 妻财
 * - 克我者 → 官鬼
 */
function getLiuQin(dayEl, lineEl) {
  if (dayEl === lineEl) return '兄弟';
  const dayIdx = wuXingOrder.indexOf(dayEl);
  const lineIdx = wuXingOrder.indexOf(lineEl);
  // 我生者：dayIdx+1 (mod 5)
  if (lineIdx === (dayIdx + 1) % 5) return '子孙';
  // 生我者：dayIdx-1 (mod 5) = dayIdx+4 (mod 5)
  if (lineIdx === (dayIdx + 4) % 5) return '父母';
  // 我克者：dayIdx+2 (mod 5)
  if (lineIdx === (dayIdx + 2) % 5) return '妻财';
  // 克我者：dayIdx+3 (mod 5) = dayIdx-2 (mod 5)
  if (lineIdx === (dayIdx + 3) % 5) return '官鬼';
  return '兄弟';
}

/**
 * 获取五行
 */
function getElement(zhiOrGan) {
  if (zhiElement[zhiOrGan]) return zhiElement[zhiOrGan];
  if (ganElement[zhiOrGan]) return ganElement[zhiOrGan];
  return '土';
}

// ============================================================
// 日干支计算
// ============================================================

function getDayGanZhi(date) {
  // 基准日：2024-01-01 是 甲辰年 甲子月 甲子日
  // 但实际干支纪日需要查表或用公式
  // 2024-01-01 (周一) = 甲子日 (经验证)
  // 实际上 2024-01-01 的日干支需要校准
  // 经查：2024年1月1日 = 庚子日 (实际上不确定)
  // 我们用一个已知的锚点：
  // 2024-02-10 (除夕) = 辛亥日 → 干支序号 48 (辛亥: 辛=7, 亥=11, 48 = (7-1)*某个计算...)
  // 更简单的方法：用已知锚点推算
  // 2000-01-07 是 甲子日（干支序号 0）
  const base = new Date(2000, 0, 7); // 2000-01-07 = 甲子日
  base.setHours(12, 0, 0, 0);
  const target = new Date(date);
  target.setHours(12, 0, 0, 0);
  const diff = Math.round((target - base) / 86400000);
  const ganIdx = ((diff % 10) + 10) % 10;
  const zhiIdx = ((diff % 12) + 12) % 12;
  return { gan: tianGan[ganIdx], zhi: diZhi[zhiIdx] };
}

// ============================================================
// 抛铜钱模拟
// ============================================================

/**
 * 三枚铜钱摇一次
 * 正面(字)=阳=3, 背面(花)=阴=2
 * 三枚总和：
 *   3+3+3=9 → 老阳(阳动)，记为阳，变阴
 *   3+3+2=8 → 少阴(阴)，记为阴，不变
 *   3+2+2=7 → 少阳(阳)，记为阳，不变
 *   2+2+2=6 → 老阴(阴动)，记为阴，变阳
 *
 * 简化：正面数 3=阳动, 2=阴(少阴), 1=阳(少阳), 0=阴动
 */
function tossCoin() {
  const heads = [0, 1, 2].reduce((sum) => sum + (Math.random() < 0.5 ? 1 : 0), 0);
  if (heads === 3) return '阳动'; // 老阳
  if (heads === 2) return '阴';   // 少阴
  if (heads === 1) return '阳';   // 少阳
  return '阴动';                   // 老阴
}

/**
 * 模拟完整六次摇卦
 */
function simulateCoins() {
  const results = [];
  for (let i = 0; i < 6; i++) {
    results.push(tossCoin());
  }
  return results;
}

/**
 * 从输入解析卦象
 * 输入格式：六个0/1/2/3的数字
 * 0=少阳(阳不动)，1=少阴(阴不动)，2=老阳(阳动)，3=老阴(阴动)
 */
function parseCoins(input) {
  const results = [];
  for (const char of input) {
    const num = parseInt(char);
    if (num === 0) {
      results.push('阳');
    } else if (num === 1) {
      results.push('阴');
    } else if (num === 2) {
      results.push('阳动');
    } else if (num === 3) {
      results.push('阴动');
    }
  }
  return results;
}

// ============================================================
// 核心排盘：确定卦象及纳甲
// ============================================================

/**
 * 从六爻coins确定上下卦
 * coins[0..2] = 初爻到三爻 = 内卦（下卦）
 * coins[3..5] = 四爻到上爻 = 外卦（上卦）
 */
function getTrigramFromLines(line0, line1, line2) {
  // line0=初爻(底), line2=三爻(顶)
  const b0 = (line0 === '阳' || line0 === '阳动') ? '1' : '0';
  const b1 = (line1 === '阳' || line1 === '阳动') ? '1' : '0';
  const b2 = (line2 === '阳' || line2 === '阳动') ? '1' : '0';
  const pattern = b0 + b1 + b2;
  return baGuaByPattern[pattern];
}

/**
 * 判断爻是否为阳
 */
function isYangYao(coin) {
  return coin === '阳' || coin === '阳动';
}

/**
 * 判断爻是否为动爻
 */
function isDongYao(coin) {
  return coin === '阳动' || coin === '阴动';
}

/**
 * 翻转爻的阴阳
 */
function flipYao(coin) {
  if (coin === '阳') return '阴';
  if (coin === '阴') return '阳';
  if (coin === '阳动') return '阴'; // 老阳变阴
  if (coin === '阴动') return '阳'; // 老阴变阳
  return coin;
}

/**
 * 生成变卦的coins
 */
function getChangedCoins(coins) {
  const hasMoving = coins.some(c => isDongYao(c));
  if (!hasMoving) return null;
  return coins.map(c => isDongYao(c) ? flipYao(c) : c);
}

/**
 * 为一个六爻排纳甲
 * @param {string[]} coins - 6个爻的阴阳状态
 * @param {string} dayGan - 日干
 * @returns {object} 排盘结果
 */
function buildHexagram(coins, dayGan) {
  // 1. 确定内外卦
  const innerGua = getTrigramFromLines(coins[0], coins[1], coins[2]);
  const outerGua = getTrigramFromLines(coins[3], coins[4], coins[5]);

  // 2. 确定卦名
  const key = outerGua + '-' + innerGua;
  const guaName = hexagramByTrigrams[key] || '未知';

  // 3. 确定八宫归属和世应
  const palaceInfo = hexagramPalaceMap[guaName] || { palace: innerGua, index: 0 };
  const { palace, index: palaceIndex } = palaceInfo;
  const rule = palaceRules[palaceIndex];
  const shiPos = rule.shi;  // 世爻位置 (1-6)
  const yingPos = rule.ying; // 应爻位置 (1-6)

  // 4. 日干五行
  const dayElement = ganElement[dayGan] || '土';

  // 5. 为每个爻配纳甲
  const yaoList = [];
  for (let i = 0; i < 6; i++) {
    const pos = i + 1; // 爻位 1-6
    const isInner = pos <= 3;
    const gua = isInner ? innerGua : outerGua;

    // 纳甲天干
    const ganKey = isInner ? 'inner' : 'outer';
    const gan = naJiaGan[gua][ganKey];

    // 纳甲地支
    const zhiIdx = isInner ? (i) : (i - 3);
    const zhi = naJiaZhi[gua][ganKey][zhiIdx];

    // 地支五行
    const zhiEl = zhiElement[zhi] || '土';

    // 六亲
    const liuqin = getLiuQin(dayElement, zhiEl);

    // 六神
    const shenStartIdx = liuShenStartByGan[dayGan] || 0;
    const shenIdx = (shenStartIdx + i) % 6;
    const liushen = liuShenOrder[shenIdx];

    yaoList.push({
      position: pos,
      name: yaoNames[i],
      yang: isYangYao(coins[i]),
      dong: isDongYao(coins[i]),
      coin: coins[i],
      gan,
      zhi,
      ganZhi: gan + zhi,
      element: zhiEl,
      liuqin,
      liushen,
      isShi: pos === shiPos,
      isYing: pos === yingPos
    });
  }

  return {
    guaName,
    innerGua,
    outerGua,
    innerSymbol: baGua[innerGua],
    outerSymbol: baGua[outerGua],
    palace,
    palacePosition: rule.position,
    palaceElement: baGuaElement[palace],
    shiPos,
    yingPos,
    yaoList,
    dongCount: coins.filter(c => isDongYao(c)).length
  };
}

// ============================================================
// 吉凶判断
// ============================================================

function judgeFortune(hexagram, changedHexagram) {
  const { dongCount, yaoList, palace, palaceElement } = hexagram;
  const lines = [];

  // 动爻数判断
  if (dongCount === 0) {
    lines.push('静卦 — 事情稳定，无动爻则看用神与日辰关系');
  } else if (dongCount === 1) {
    lines.push('独发 — 一爻独发，事情由该爻主导，专注可成');
  } else if (dongCount === 2) {
    lines.push('两爻齐动 — 两件事相互关联，需协调分析');
  } else if (dongCount === 3) {
    lines.push('三爻齐动 — 变数较多，以变卦为断');
  } else if (dongCount === 4) {
    lines.push('四爻齐动 — 以不变的二爻为断');
  } else if (dongCount === 5) {
    lines.push('五爻齐动 — 以不变的一爻为断');
  } else if (dongCount === 6) {
    lines.push('六爻皆动 — 乾坤两卦以用辞断，其余以变卦断');
  }

  // 分析动爻的六亲
  const dongYao = yaoList.filter(y => y.dong);
  for (const y of dongYao) {
    let meaning = '';
    switch (y.liuqin) {
      case '父母':
        meaning = '文书、长辈、合同、消息之事';
        break;
      case '兄弟':
        meaning = '竞争、同辈、破财、阻碍之事';
        break;
      case '子孙':
        meaning = '福气、子息、解忧、消灾之事';
        break;
      case '妻财':
        meaning = '财运、妻室、粮食、收入之事';
        break;
      case '官鬼':
        meaning = '官府、丈夫、疾病、灾祸之事';
        break;
    }
    lines.push(`  ${y.name}(${y.ganZhi}) ${y.liuqin}动 → ${meaning}`);
  }

  // 世爻分析
  const shiYao = yaoList.find(y => y.isShi);
  if (shiYao) {
    lines.push(`世爻在${shiYao.name}(${shiYao.ganZhi})，${shiYao.liuqin}持世`);
    // 世爻旺衰简化判断
    if (shiYao.liuqin === '子孙') {
      lines.push('  子孙持世，主忧愁消失，凡事顺遂');
    } else if (shiYao.liuqin === '妻财') {
      lines.push('  妻财持世，主财利可得，利于求财');
    } else if (shiYao.liuqin === '兄弟') {
      lines.push('  兄弟持世，主竞争破财，需防小人');
    } else if (shiYao.liuqin === '父母') {
      lines.push('  父母持世，主劳碌辛苦，文书之事');
    } else if (shiYao.liuqin === '官鬼') {
      lines.push('  官鬼持世，主忧虑不安，利于求官');
    }
  }

  // 应爻分析
  const yingYao = yaoList.find(y => y.isYing);
  if (yingYao) {
    lines.push(`应爻在${yingYao.name}(${yingYao.ganZhi})，为对方、为所测之事`);
  }

  // 变卦提示
  if (changedHexagram) {
    lines.push(`变卦为${changedHexagram.guaName}（${changedHexagram.innerGua}${changedHexagram.outerGua}）`);
  }

  return lines.join('\n');
}

// ============================================================
// 生成报告
// ============================================================

function generateReport(hexagram, changedHexagram, question, dayGanZhi) {
  const {
    guaName, innerGua, outerGua, innerSymbol, outerSymbol,
    palace, palacePosition, palaceElement,
    shiPos, yingPos, yaoList, dongCount
  } = hexagram;

  const fortune = judgeFortune(hexagram, changedHexagram);

  let report = `
================================
        六爻纳甲排盘
================================

【占卜信息】
  事项：${question}
  日干支：${dayGanZhi.gan}${dayGanZhi.zhi}日
  动爻数：${dongCount}个

【卦象】
  卦名：${guaName}
  外卦：${outerGua}${outerSymbol}  内卦：${innerGua}${innerSymbol}
  所属：${palace}宫(${palaceElement}) ${palacePosition}
  世爻：第${shiPos}爻  应爻：第${yingPos}爻

【本卦 六爻排盘】（从上到下，上爻→初爻）
`;

  // 从上爻(6)到初爻(1)输出
  for (let i = 5; i >= 0; i--) {
    const y = yaoList[i];
    const yangSymbol = y.yang ? '━━━' : '━ ━';
    const dongSymbol = y.dong ? (y.yang ? ' ○' : ' ×') : '  ';
    const shiYingTag = y.isShi ? ' 世' : (y.isYing ? ' 应' : '   ');
    const liuqinTag = y.liuqin.padEnd(3, '　');

    report += `  ${y.name} ${yangSymbol}${dongSymbol} ${liuqinTag} ${y.ganZhi}(${y.element}) ${y.liushen}${shiYingTag}\n`;
  }

  // 变卦输出
  if (changedHexagram) {
    report += `
【变卦 ${changedHexagram.guaName}】（从上到下，上爻→初爻）
  外卦：${changedHexagram.outerGua}${changedHexagram.outerSymbol}  内卦：${changedHexagram.innerGua}${changedHexagram.innerSymbol}
  所属：${changedHexagram.palace}宫(${changedHexagram.palaceElement}) ${changedHexagram.palacePosition}
`;
    for (let i = 5; i >= 0; i--) {
      const y = changedHexagram.yaoList[i];
      const yangSymbol = y.yang ? '━━━' : '━ ━';
      const fromDong = hexagram.yaoList[i].dong;
      const dongSymbol = fromDong ? ' →' : '  ';
      const shiYingTag = y.isShi ? ' 世' : (y.isYing ? ' 应' : '   ');
      const liuqinTag = y.liuqin.padEnd(3, '　');

      report += `  ${y.name} ${yangSymbol}${dongSymbol} ${liuqinTag} ${y.ganZhi}(${y.element}) ${y.liushen}${shiYingTag}\n`;
    }
  }

  report += `
================================
        吉凶判断
================================
${fortune}

================================
        建议
================================
${dongCount === 0 ? '静卦无动，观用神旺衰与日辰生克关系而断。' :
    dongCount === 1 ? '独发之爻为事之主，宜专注该爻所临六亲所主之事。' :
    dongCount === 6 ? '六爻全动，变化极多，宜以变卦综合判断。' :
    '多爻齐动，事有多端，需综合世应、用神、动爻变化分析。'}
`;

  return report;
}

// ============================================================
// 主入口
// ============================================================

const args = process.argv.slice(2);

if (args[0] === '--help' || args[0] === '-h') {
  console.log(`
六爻纳甲预测

用法:
  node liuyao.js                    # 模拟摇卦
  node liuyao.js 010203            # 指定6个爻(0=少阳,1=少阴,2=老阳,3=老阴)
  node liuyao.js 010203 婚姻       # 指定爻+问题

爻值说明:
  0 = 少阳（阳不动）━━━
  1 = 少阴（阴不动）━ ━
  2 = 老阳（阳动）  ○ → 变阴
  3 = 老阴（阴动）  × → 变阳

示例:
  node liuyao.js
  node liuyao.js 012013 事业
  node liuyao.js 222222 诉讼
`);
} else if (args.length >= 1 && /^\d{6}$/.test(args[0])) {
  // 指定爻象
  const coins = parseCoins(args[0]);
  const question = args.length >= 2 ? args.slice(1).join(' ') : '占卜事宜';

  // 计算日干支
  const dayGanZhi = getDayGanZhi(new Date());

  // 排盘
  const hexagram = buildHexagram(coins, dayGanZhi.gan);

  // 变卦
  const changedCoins = getChangedCoins(coins);
  const changedHexagram = changedCoins ? buildHexagram(changedCoins, dayGanZhi.gan) : null;

  console.log(generateReport(hexagram, changedHexagram, question, dayGanZhi));
} else {
  // 模拟摇卦
  console.log('摇卦中...\n');
  const coins = simulateCoins();
  const question = args.length > 0 ? args.join(' ') : '占卜事宜';

  // 计算日干支
  const dayGanZhi = getDayGanZhi(new Date());

  // 排盘
  const hexagram = buildHexagram(coins, dayGanZhi.gan);

  // 变卦
  const changedCoins = getChangedCoins(coins);
  const changedHexagram = changedCoins ? buildHexagram(changedCoins, dayGanZhi.gan) : null;

  // 显示摇卦结果
  const coinDisplay = coins.map(c => {
    if (c === '阳') return '少阳';
    if (c === '阴') return '少阴';
    if (c === '阳动') return '老阳○';
    return '老阴×';
  });

  console.log(`摇得：[${coinDisplay.join(', ')}]\n`);
  console.log(generateReport(hexagram, changedHexagram, question, dayGanZhi));
}
