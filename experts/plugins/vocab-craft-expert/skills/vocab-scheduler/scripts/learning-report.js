#!/usr/bin/env node
/**
 * 生成学习统计报告
 * 用法: node learning-report.js --period <week|month|all>
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

const period = params.period || 'week';

// 读取进度文件
const progressFile = path.join(process.cwd(), '.workbuddy', 'memory', 'vocab-progress.json');

if (!fs.existsSync(progressFile)) {
  console.error('错误: 未找到学习进度文件');
  process.exit(1);
}

const progress = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
const today = new Date().toISOString().split('T')[0];

// 计算学习天数
const startDate = new Date(progress.stats.startDate);
const todayDate = new Date(today);
const totalDays = Math.floor((todayDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

// 计算各状态词数
let stateCount = { new: 0, doing: 0, review: 0, known: 0, wrong: 0 };
for (const [word, state] of Object.entries(progress.wordStates || {})) {
  if (stateCount[state.state] !== undefined) {
    stateCount[state.state] += 1;
  }
}

// 计算未来7天复习负载
const upcomingReview = {};
for (let i = 0; i < 7; i++) {
  const d = new Date(todayDate);
  d.setDate(d.getDate() + i);
  const dateStr = d.toISOString().split('T')[0];
  upcomingReview[dateStr] = (progress.reviewSchedule[dateStr] || []).length;
}

// 计算平均每日学习量
const avgDaily = totalDays > 0 ? Math.round(progress.stats.totalLearned / totalDays) : 0;

// 预估剩余天数
const remainingWords = progress.dictLength - progress.stats.totalLearned;
const estimatedRemaining = avgDaily > 0 ? Math.ceil(remainingWords / avgDaily) : '未知';

// 正确率估算（基于错词比例）
const totalAttempted = progress.stats.totalLearned;
const wrongCount = Object.values(progress.wordStates || {}).filter(s => s.state === 'wrong').length;
const accuracy = totalAttempted > 0 ? (((totalAttempted - wrongCount) / totalAttempted) * 100).toFixed(1) : '100.0';

const report = {
  period: period,
  generatedAt: today,
  overview: {
    dict: progress.dictName,
    dictLength: progress.dictLength,
    startDate: progress.stats.startDate,
    totalDays: totalDays,
    streakDays: progress.stats.streakDays,
    pushTime: progress.pushTime
  },
  progress: {
    totalLearned: progress.stats.totalLearned,
    totalMastered: progress.stats.totalMastered,
    progressPercent: ((progress.stats.totalLearned / progress.dictLength) * 100).toFixed(1) + '%',
    remainingWords: remainingWords,
    estimatedRemainingDays: estimatedRemaining
  },
  performance: {
    avgDailyWords: avgDaily,
    accuracy: accuracy + '%',
    wrongPoolSize: progress.wrongWords.length,
    weakPoolSize: progress.weakWords.length
  },
  wordStates: stateCount,
  upcomingReviewLoad: upcomingReview,
  topWrongWords: progress.wrongWords.slice(0, 10)
};

console.log(JSON.stringify(report, null, 2));
