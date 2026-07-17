#!/usr/bin/env node
/**
 * 梅花易数占卜脚本
 * 支持：报数起卦、时间起卦、方位起卦
 */

const tianGan = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const diZhi = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

// 先天八卦数
const baGuaNum = {
  '乾': 1, '兑': 2, '离': 3, '震': 4,
  '巽': 5, '坎': 6, '艮': 7, '坤': 8
};

// 八卦属性
const baGuaInfo = {
  '乾': { element: '金', symbol: '☰', trait: '刚健', color: '白色', direction: '西北' },
  '兑': { element: '金', symbol: '☱', trait: '喜悦', color: '白色', direction: '西' },
  '离': { element: '火', symbol: '☲', trait: '明亮', color: '红色', direction: '南' },
  '震': { element: '木', symbol: '☳', trait: '震动', color: '青色', direction: '东' },
  '巽': { element: '木', symbol: '☴', trait: '入', color: '绿色', direction: '东南' },
  '坎': { element: '水', symbol: '☵', trait: '险陷', color: '黑色', direction: '北' },
  '艮': { element: '土', symbol: '☶', trait: '阻止', color: '黄色', direction: '东北' },
  '坤': { element: '土', symbol: '☷', trait: '柔顺', color: '黄色', direction: '西南' }
};

// 64卦象（简化版）
const hexagrams = {
  '11': { name: '乾为天', gua: '乾', trait: '元亨利贞', meaning: '大吉大利' },
  '12': { name: '天地否', gua: '否', trait: '不交不通', meaning: '诸事不顺' },
  '13': { name: '天风姤', gua: '姤', trait: '遇也', meaning: '偶遇机缘' },
  '21': { name: '地天泰', gua: '泰', trait: '天地交泰', meaning: '万事亨通' },
  '22': { name: '坤为地', gua: '坤', trait: '元亨利牝马之贞', meaning: '柔顺有利' },
  '31': { name: '火天大有', gua: '大有', trait: '元亨', meaning: '收获丰富' },
  '32': { name: '火地晋', gua: '晋', trait: '康候用锡马', meaning: '晋升发展' },
  '33': { name: '雷天大壮', gua: '大壮', trait: '利贞', meaning: '气势正盛' },
  '41': { name: '风地观', gua: '观', trait: '盥而不荐', meaning: '观察时机' },
  '42': { name: '风雷益', gua: '益', trait: '利有攸往', meaning: '受益匪浅' },
  '51': { name: '水地比', gua: '比', trait: '吉原筮元永贞', meaning: '亲和友善' },
  '52': { name: '水山蹇', gua: '蹇', trait: '利西南不利东北', meaning: '艰难险阻' },
  '61': { name: '山地剥', gua: '剥', trait: '不利有攸往', meaning: '需要隐忍' },
  '62': { name: '山地艮', gua: '艮', trait: '止也', meaning: '适可而止' },
  '71': { name: '泽地萃', gua: '萃', trait: '利见大人', meaning: '人才汇聚' },
  '72': { name: '泽山咸', gua: '咸', trait: '亨利贞', meaning: '感情顺利' },
  '81': { name: '雷地豫', gua: '豫', trait: '利建侯行师', meaning: '安乐祥和' },
  '82': { name: '雷风恒', gua: '恒', trait: '亨无咎利贞', meaning: '恒久稳定' }
};

// 64卦映射（先天八卦数序：乾1 兑2 离3 震4 巽5 坎6 艮7 坤8）
// 键 = "上卦数" + "下卦数"
const simpleHexagrams = {
  '11': '乾为天', '12': '天泽履', '13': '天火同人', '14': '天雷无妄',
  '15': '天风姤', '16': '天水讼', '17': '天山遁', '18': '天地否',
  '21': '泽天夬', '22': '兑为泽', '23': '泽火革', '24': '泽雷随',
  '25': '泽风大过', '26': '泽水困', '27': '泽山咸', '28': '泽地萃',
  '31': '火天大有', '32': '火泽睽', '33': '离为火', '34': '火雷噬嗑',
  '35': '火风鼎', '36': '火水未济', '37': '火山旅', '38': '火地晋',
  '41': '雷天大壮', '42': '雷泽归妹', '43': '雷火丰', '44': '震为雷',
  '45': '雷风恒', '46': '雷水解', '47': '雷山小过', '48': '雷地豫',
  '51': '风天小畜', '52': '风泽中孚', '53': '风火家人', '54': '风雷益',
  '55': '巽为风', '56': '风水涣', '57': '风山渐', '58': '风地观',
  '61': '水天需', '62': '水泽节', '63': '水火既济', '64': '水雷屯',
  '65': '水风井', '66': '坎为水', '67': '水山蹇', '68': '水地比',
  '71': '山天大畜', '72': '山泽损', '73': '山火贲', '74': '山雷颐',
  '75': '山风蛊', '76': '山水蒙', '77': '艮为山', '78': '山地剥',
  '81': '地天泰', '82': '地泽临', '83': '地火明夷', '84': '地雷复',
  '85': '地风升', '86': '地水师', '87': '地山谦', '88': '坤为地'
};

/**
 * 报数起卦
 * 报3个数字，第一个取上卦，第二个取下卦，第三个取动爻
 */
function numbersToHexagram(nums) {
  if (nums.length < 3) {
    throw new Error('请报3个数字');
  }

  const num1 = parseInt(nums[0]) % 8 || 8;
  const num2 = parseInt(nums[1]) % 8 || 8;
  const dongYao = parseInt(nums[2]) % 6 || 6;

  const guaNames = ['乾', '兑', '离', '震', '巽', '坎', '艮', '坤'];
  const shangGua = guaNames[(num1 - 1) % 8];
  const xiaGua = guaNames[(num2 - 1) % 8];

  return {
    shangGua,
    xiaGua,
    dongYao,
    hexagram: simpleHexagrams[`${num1}${num2}`] || `${shangGua}${xiaGua}`,
    num1, num2
  };
}

/**
 * 时间起卦
 * 上卦 = (年+月+日) % 8
 * 下卦 = (月+日+时) % 8
 * 动爻 = (年+月+日+时) % 6，若为0则取6
 */
function timeToHexagram(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();

  const num1 = (year + month + day) % 8 || 8;
  const num2 = (month + day + hour) % 8 || 8;
  const dongYao = (year + month + day + hour) % 6 || 6;

  const guaNames = ['乾', '兑', '离', '震', '巽', '坎', '艮', '坤'];
  const shangGua = guaNames[(num1 - 1) % 8];
  const xiaGua = guaNames[(num2 - 1) % 8];

  return {
    shangGua,
    xiaGua,
    dongYao,
    hexagram: simpleHexagrams[`${num1}${num2}`] || `${shangGua}${xiaGua}`,
    num1, num2
  };
}

/**
 * 方位起卦
 * 东南西北对应 1-4
 */
function directionToHexagram(directions) {
  if (directions.length < 2) {
    throw new Error('请提供2个方位');
  }
  
  const dirMap = {
    '东': 4, '东南': 5, '南': 3, '西南': 8,
    '西': 2, '西北': 1, '北': 6, '东北': 7
  };
  
  const num1 = dirMap[directions[0]] || 1;
  const num2 = dirMap[directions[1]] || 2;
  
  return numbersToHexagram([num1, num2, 3]);
}

/**
 * 判断体用关系
 * 传统梅花易数规则：动爻所在的卦为用卦，另一个卦为体卦
 * 动爻1-3在下卦 → 下卦为用，上卦为体
 * 动爻4-6在上卦 → 上卦为用，下卦为体
 */
function getTiYong(shangGua, xiaGua, dongYao) {
  let tiYong;
  if (dongYao >= 1 && dongYao <= 3) {
    // 动爻在下卦 → 下卦为用，上卦为体
    tiYong = { ti: shangGua, yong: xiaGua, gua: '下卦为用，上卦为体' };
  } else {
    // 动爻在上卦 → 上卦为用，下卦为体
    tiYong = { ti: xiaGua, yong: shangGua, gua: '上卦为用，下卦为体' };
  }
  return tiYong;
}

/**
 * 五行生克判断
 */
function getElementRelation(ti, yong) {
  const elements = {
    '乾': '金', '兑': '金', '离': '火', '震': '木',
    '巽': '木', '坎': '水', '艮': '土', '坤': '土'
  };
  
  const tiEl = elements[ti];
  const yongEl = elements[yong];
  
  // 五行相生：木→火→土→金→水→木
  // 五行相克：木→土→水→火→金→木
  const relations = {
    // 用生体 → 大吉（得生助）
    '火木': '用生体 → 大吉', '土火': '用生体 → 大吉', '金土': '用生体 → 大吉',
    '水金': '用生体 → 大吉', '木水': '用生体 → 大吉',
    // 体生用 → 泄气（有耗散）
    '木火': '体生用 → 泄气', '火土': '体生用 → 泄气', '土金': '体生用 → 泄气',
    '金水': '体生用 → 泄气', '水木': '体生用 → 泄气',
    // 体克用 → 有利（我制对方）
    '木土': '体克用 → 有利', '土水': '体克用 → 有利', '水火': '体克用 → 有利',
    '火金': '体克用 → 有利', '金木': '体克用 → 有利',
    // 用克体 → 凶（对方克我）
    '土木': '用克体 → 凶', '水土': '用克体 → 凶', '火水': '用克体 → 凶',
    '金火': '用克体 → 凶', '木金': '用克体 → 凶'
  };

  const key = tiEl + yongEl;
  let result;
  if (tiEl === yongEl) {
    result = '体用比和 → 平稳';
  } else {
    result = relations[key] || '体用相合 → 平稳';
  }
  
  return { tiEl, yongEl, result };
}

/**
 * 动爻分析
 */
function analyzeDongYao(dongYao) {
  const yaoNames = ['初爻', '二爻', '三爻', '四爻', '五爻', '上爻'];
  return {
    position: yaoNames[dongYao - 1] || '上爻',
    note: dongYao <= 3 ? '下卦动' : '上卦动'
  };
}

/**
 * 生成占卜报告
 */
function generateDivinationReport(hexagramData, type, inputData) {
  const { shangGua, xiaGua, dongYao } = hexagramData;
  const tiYong = getTiYong(shangGua, xiaGua, dongYao);
  const elements = getElementRelation(tiYong.ti, tiYong.yong);
  const yaoInfo = analyzeDongYao(dongYao);
  
  const shangInfo = baGuaInfo[shangGua] || baGuaInfo['乾'];
  const xiaInfo = baGuaInfo[xiaGua] || baGuaInfo['坤'];
  
  // 判断吉凶
  let jiXiong;
  if (elements.result.includes('大吉') || elements.result.includes('比和')) {
    jiXiong = '✅ 吉利';
  } else if (elements.result.includes('凶')) {
    jiXiong = '❌ 需谨慎';
  } else {
    jiXiong = '⚠️ 中平';
  }
  
  const report = `
🔮 【梅花易数占卜】

📋 占卜信息
   类型：${type}
   输入：${inputData}

🎴 卦象
   上卦：${shangGua} ${shangInfo.symbol}（${shangInfo.trait}）
   下卦：${xiaGua} ${xiaInfo.symbol}（${xiaInfo.trait}）
   动爻：${yaoInfo.position}（${yaoInfo.note}）

📊 卦名
   ${hexagramData.hexagram}

⚖️ 体用分析
   体卦：${tiYong.ti}（${elements.tiEl}气）
   用卦：${tiYong.yong}（${elements.yongEl}气）
   关系：${elements.result}
   ${jiXiong}

🎯 综合判断
   ${shangInfo.direction}方向${shangInfo.trait}，${xiaInfo.direction}方向${xiaInfo.trait}
   今日${shangInfo.color}色、${xiaInfo.color}色利于增强运势

💡 建议
   ${elements.result.includes('大吉') || elements.result.includes('比和') 
     ? '可以积极行动，把握机会' 
     : elements.result.includes('凶') 
       ? '宜静不宜动，谨慎行事' 
       : '循序渐进，稳扎稳打'}
`;
  
  return report;
}

// 主入口
const args = process.argv.slice(2);

if (args.length === 0) {
  // 默认时间起卦
  const result = timeToHexagram(new Date());
  console.log(generateDivinationReport(result, '时间起卦', '当前时间'));
} else if (args[0] === '--help' || args[0] === '-h') {
  console.log(`
梅花易数占卜

用法:
  node meihua.js                    # 时间起卦
  node meihua.js 数字1 数字2 数字3   # 报数起卦
  node meihua.js 东 南              # 方位起卦

示例:
  node meihua.js 3 5 2
  node meihua.js 东 南
`);
} else if (args.length === 1 && ['东', '南', '西', '北', '东南', '东北', '西南', '西北'].includes(args[0])) {
  // 单方位 → 用另一个默认方位
  const result = directionToHexagram([args[0], '中']);
  console.log(generateDivinationReport(result, '方位起卦', args[0]));
} else if (args.length === 2 && ['东', '南', '西', '北', '东南', '东北', '西南', '西北'].includes(args[0])) {
  // 两个方位
  const result = directionToHexagram(args);
  console.log(generateDivinationReport(result, '方位起卦', args.join('-')));
} else if (!isNaN(args[0])) {
  // 报数起卦
  try {
    const result = numbersToHexagram(args);
    console.log(generateDivinationReport(result, '报数起卦', args.join('-')));
  } catch (e) {
    console.error('错误:', e.message);
    process.exit(1);
  }
} else {
  // 时间起卦
  const result = timeToHexagram(new Date());
  console.log(generateDivinationReport(result, '时间起卦', '当前时间'));
}
