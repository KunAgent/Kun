#!/usr/bin/env node
/**
 * 更新学习进度
 * 用法: node update-progress.js --results '<JSON学习结果>'
 * 
 * 学习结果格式:
 * {
 *   "date": "2026-05-03",
 *   "newLearned": 20,
 *   "reviewCompleted": ["word1", "word2"],
 *   "wrongAnswers": ["word3", "word4"],
 *   "correctFromWrong": ["word5"],
 *   "markedWeak": ["word6"],
 *   "timeSpent": 1800
 * }
 */

const fs = require('fs');
const path = require('path');

// 间隔重复配置（天数）
const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30];
const CORRECT_STREAK_TO_REMOVE = 3;

// 解析参数
const args = process.argv.slice(2);
let resultsJson = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--results' && args[i + 1]) {
    resultsJson = args[i + 1];
    break;
  }
}

if (!resultsJson) {
  console.error('错误: 请提供 --results 参数');
  process.exit(1);
}

const results = JSON.parse(resultsJson);
const progressFile = path.join(process.cwd(), '.workbuddy', 'memory', 'vocab-progress.json');

if (!fs.existsSync(progressFile)) {
  console.error('错误: 未找到学习进度文件');
  process.exit(1);
}

const progress = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
const today = results.date || new Date().toISOString().split('T')[0];

// 1. 更新 lastLearnIndex
if (results.newLearned > 0) {
  progress.lastLearnIndex += results.newLearned;
  progress.stats.totalLearned = progress.lastLearnIndex;
}

// 2. 为新学单词写入复习计划
if (results.newWords && results.newWords.length > 0) {
  for (const word of results.newWords) {
    // 初始化词状态
    progress.wordStates[word] = {
      state: 'doing',
      reviewCount: 0,
      lastReview: today,
      nextReview: addDays(today, REVIEW_INTERVALS[0]),
      correctStreak: 0
    };
    // 写入第1次复习时间
    const nextDate = addDays(today, REVIEW_INTERVALS[0]);
    if (!progress.reviewSchedule[nextDate]) {
      progress.reviewSchedule[nextDate] = [];
    }
    progress.reviewSchedule[nextDate].push(word);
  }
}

// 3. 处理复习完成的词
if (results.reviewCompleted && results.reviewCompleted.length > 0) {
  for (const word of results.reviewCompleted) {
    if (progress.wordStates[word]) {
      const state = progress.wordStates[word];
      state.reviewCount += 1;
      state.lastReview = today;
      state.correctStreak = (state.correctStreak || 0) + 1;
      
      if (state.reviewCount >= REVIEW_INTERVALS.length) {
        // 完成所有复习轮次，标记为已掌握
        state.state = 'known';
        state.nextReview = null;
        progress.stats.totalMastered += 1;
      } else {
        // 安排下一轮复习
        state.state = 'review';
        const nextInterval = REVIEW_INTERVALS[state.reviewCount];
        state.nextReview = addDays(today, nextInterval);
        if (!progress.reviewSchedule[state.nextReview]) {
          progress.reviewSchedule[state.nextReview] = [];
        }
        progress.reviewSchedule[state.nextReview].push(word);
      }
    }
  }
}

// 4. 处理答错的词
if (results.wrongAnswers && results.wrongAnswers.length > 0) {
  for (const word of results.wrongAnswers) {
    if (!progress.wrongWords.includes(word)) {
      progress.wrongWords.push(word);
    }
    if (progress.wordStates[word]) {
      progress.wordStates[word].state = 'wrong';
      progress.wordStates[word].correctStreak = 0;
    }
  }
  progress.stats.totalWrong = progress.wrongWords.length;
}

// 5. 处理从错词本中正确回答的词
if (results.correctFromWrong && results.correctFromWrong.length > 0) {
  for (const word of results.correctFromWrong) {
    if (progress.wordStates[word]) {
      progress.wordStates[word].correctStreak = (progress.wordStates[word].correctStreak || 0) + 1;
      
      if (progress.wordStates[word].correctStreak >= CORRECT_STREAK_TO_REMOVE) {
        // 连续正确达标，移出错词本
        progress.wrongWords = progress.wrongWords.filter(w => w !== word);
        progress.wordStates[word].state = 'review';
        // 回归正常复习轨道
        const reviewCount = progress.wordStates[word].reviewCount || 0;
        if (reviewCount < REVIEW_INTERVALS.length) {
          const nextInterval = REVIEW_INTERVALS[reviewCount];
          const nextDate = addDays(today, nextInterval);
          progress.wordStates[word].nextReview = nextDate;
          if (!progress.reviewSchedule[nextDate]) {
            progress.reviewSchedule[nextDate] = [];
          }
          progress.reviewSchedule[nextDate].push(word);
        }
      }
    }
  }
  progress.stats.totalWrong = progress.wrongWords.length;
}

// 6. 处理标记为薄弱的词
if (results.markedWeak && results.markedWeak.length > 0) {
  for (const word of results.markedWeak) {
    if (!progress.weakWords.includes(word)) {
      progress.weakWords.push(word);
    }
  }
}

// 7. 更新连续打卡天数
if (progress.stats.lastLearnDate) {
  const lastDate = new Date(progress.stats.lastLearnDate);
  const todayDate = new Date(today);
  const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
  if (diffDays === 1) {
    progress.stats.streakDays += 1;
  } else if (diffDays > 1) {
    progress.stats.streakDays = 1; // 中断后重新计数
  }
} else {
  progress.stats.streakDays = 1;
}
progress.stats.lastLearnDate = today;

// 8. 清理过期的复习计划条目
for (const dateStr of Object.keys(progress.reviewSchedule)) {
  if (new Date(dateStr) < new Date(today)) {
    delete progress.reviewSchedule[dateStr];
  }
}

// 写入更新后的进度
fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2), 'utf-8');

// 输出摘要
const summary = {
  status: 'success',
  date: today,
  progress: {
    totalLearned: progress.stats.totalLearned,
    totalMastered: progress.stats.totalMastered,
    wrongPoolSize: progress.wrongWords.length,
    streakDays: progress.stats.streakDays,
    dictProgress: `${progress.stats.totalLearned}/${progress.dictLength} (${((progress.stats.totalLearned / progress.dictLength) * 100).toFixed(1)}%)`
  }
};

console.log(JSON.stringify(summary, null, 2));

// 辅助函数：日期加天数
function addDays(dateStr, days) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}
