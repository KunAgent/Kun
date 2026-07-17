#!/usr/bin/env node
/**
 * 生成每日学习任务
 * 用法: node generate-daily-task.js [--date YYYY-MM-DD]
 * 
 * 读取学习进度文件，按照间隔重复算法生成当日任务：
 * 1. 错词强化（最高优先级，最多10个）
 * 2. 到期复习词（必须完成）
 * 3. 新词学习（按每日目标量）
 */

const fs = require('fs');
const path = require('path');

// 解析参数
const args = process.argv.slice(2);
const params = {};
for (let i = 0; i < args.length; i += 2) {
  if (args[i] && args[i].startsWith('--')) {
    params[args[i].replace('--', '')] = args[i + 1];
  }
}

const today = params.date || new Date().toISOString().split('T')[0];

// 读取进度文件
const progressFile = path.join(process.cwd(), '.workbuddy', 'memory', 'vocab-progress.json');

if (!fs.existsSync(progressFile)) {
  console.error('错误: 未找到学习进度文件。请先运行 init-progress.js 初始化。');
  process.exit(1);
}

const progress = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));

// 1. 错词强化批次
const wrongBatch = [];
if (progress.wrongWords && progress.wrongWords.length > 0) {
  const maxWrong = Math.min(10, progress.wrongWords.length);
  // 优先最近加入的错词
  const shuffled = [...progress.wrongWords].sort(() => Math.random() - 0.5);
  wrongBatch.push(...shuffled.slice(0, maxWrong));
}

// 2. 到期复习词
const reviewBatch = [];
if (progress.reviewSchedule && progress.reviewSchedule[today]) {
  reviewBatch.push(...progress.reviewSchedule[today]);
}
// 也检查过期未复习的（昨天及之前遗留的）
const todayDate = new Date(today);
for (const [dateStr, words] of Object.entries(progress.reviewSchedule || {})) {
  const schedDate = new Date(dateStr);
  if (schedDate < todayDate && words.length > 0) {
    reviewBatch.push(...words);
  }
}

// 3. 新词批次
const newWordCount = progress.perDayStudyNumber || 20;
const startIdx = progress.lastLearnIndex || 0;
const endIdx = startIdx + newWordCount;

// 输出任务摘要
const task = {
  date: today,
  dict: progress.currentDict,
  dictName: progress.dictName,
  newWords: {
    count: newWordCount,
    startIndex: startIdx,
    endIndex: endIdx
  },
  reviewWords: {
    count: reviewBatch.length,
    words: reviewBatch
  },
  wrongWords: {
    count: wrongBatch.length,
    words: wrongBatch
  },
  totalCount: newWordCount + reviewBatch.length + wrongBatch.length,
  stats: {
    totalLearned: progress.stats.totalLearned,
    totalMastered: progress.stats.totalMastered,
    streakDays: progress.stats.streakDays,
    dictLength: progress.dictLength,
    progressPercent: ((progress.stats.totalLearned / progress.dictLength) * 100).toFixed(1)
  }
};

// 检查是否已完成词库
if (startIdx >= progress.dictLength) {
  task.newWords.count = 0;
  task.newWords.note = '词库已学完，仅复习';
  task.totalCount = reviewBatch.length + wrongBatch.length;
}

// 计算预计用时（每词约1.5分钟）
task.estimatedMinutes = Math.ceil(task.totalCount * 1.5);

console.log(JSON.stringify(task, null, 2));
