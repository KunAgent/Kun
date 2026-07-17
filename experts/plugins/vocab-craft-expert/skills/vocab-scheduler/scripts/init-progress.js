#!/usr/bin/env node
/**
 * 初始化学习进度文件
 * 用法: node init-progress.js --dict <词库ID> --daily <每日词量> --push <推送时间HH:MM>
 */

const fs = require('fs');
const path = require('path');

// 解析命令行参数
const args = process.argv.slice(2);
const params = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace('--', '');
  params[key] = args[i + 1];
}

const dict = params.dict || 'cet6';
const daily = parseInt(params.daily) || 20;
const push = params.push || '08:00';

// 支持的词库列表
const SUPPORTED_DICTS = {
  'cet4': { name: 'CET-4 大学英语四级', length: 4500 },
  'cet6': { name: 'CET-6 大学英语六级', length: 6000 },
  'kaoyan': { name: '考研英语', length: 5500 },
  'ielts': { name: 'IELTS 雅思', length: 8000 },
  'toefl': { name: 'TOEFL 托福', length: 8000 },
  'gre': { name: 'GRE', length: 12000 },
  'sat': { name: 'SAT', length: 4000 },
  'gmat': { name: 'GMAT', length: 3000 },
  'tem4': { name: '专业四级', length: 8000 },
  'tem8': { name: '专业八级', length: 13000 },
  'gaokao': { name: '高考英语', length: 3500 },
  'zhongkao': { name: '中考英语', length: 1600 },
  'programmer': { name: '程序员词汇', length: 2000 }
};

if (!SUPPORTED_DICTS[dict]) {
  console.error(`错误: 不支持的词库 "${dict}"`);
  console.log('支持的词库:', Object.keys(SUPPORTED_DICTS).join(', '));
  process.exit(1);
}

const today = new Date().toISOString().split('T')[0];
const dictInfo = SUPPORTED_DICTS[dict];
const estimatedDays = Math.ceil(dictInfo.length / daily);

// 生成进度文件
const progress = {
  currentDict: dict,
  dictName: dictInfo.name,
  dictLength: dictInfo.length,
  perDayStudyNumber: daily,
  lastLearnIndex: 0,
  pushTime: push,
  automationId: null,
  stats: {
    totalLearned: 0,
    totalMastered: 0,
    totalWrong: 0,
    streakDays: 0,
    startDate: today,
    lastLearnDate: null
  },
  wrongWords: [],
  weakWords: [],
  reviewSchedule: {},
  wordStates: {}
};

// 确定输出路径
const outputDir = path.join(process.cwd(), '.workbuddy', 'memory');
const outputFile = path.join(outputDir, 'vocab-progress.json');

// 创建目录
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 写入文件
fs.writeFileSync(outputFile, JSON.stringify(progress, null, 2), 'utf-8');

console.log('=== 学习计划初始化成功 ===');
console.log(`词库: ${dictInfo.name} (${dictInfo.length} 词)`);
console.log(`每日新词: ${daily} 个`);
console.log(`推送时间: 每天 ${push}`);
console.log(`预计完成: ${estimatedDays} 天`);
console.log(`进度文件: ${outputFile}`);
console.log('========================');
