---
name: vocab-scheduler
description: |
  词汇学习调度与记忆管理技能。负责学习计划生成、间隔复习调度、进度追踪和自动化推送。
  触发词：背单词、学词汇、每日推送、复习计划、学习进度、记忆曲线、错词复习
---

# 词汇学习调度器

## 功能说明
提供词汇学习的核心调度能力，包括：
- 每日学习任务生成（新词 + 复习词 + 错词）
- 基于艾宾浩斯遗忘曲线的间隔复习计算
- 学习进度持久化存储与读取
- WorkBuddy 自动化流程创建与管理
- 学习统计报告生成

## 数据存储
学习进度文件路径：`.workbuddy/memory/vocab-progress.json`

首次使用时初始化：
```bash
node scripts/init-progress.js --dict <词库ID> --daily <每日词量> --push <推送时间>
```

## 核心算法

### 间隔复习计算
参考 @references/spaced-repetition.md 了解完整的记忆间隔算法。

### 每日任务生成流程
1. 读取进度文件获取 lastLearnIndex
2. 从词库中取 [lastLearnIndex, lastLearnIndex + perDayStudyNumber) 作为新词
3. 遍历 reviewSchedule，取出今日到期的复习词
4. 从 wrongWords 中取最多 10 个作为错词强化
5. 组装任务卡片返回

### 进度更新
每次学习结束后：
1. 更新 lastLearnIndex += 实际新学词数
2. 为新学词写入 reviewSchedule（+1d, +2d, +4d, +7d, +15d, +30d）
3. 更新 wordStates 中每个词的状态
4. 更新错词本（新增错词 / 移除连续3次正确的词）
5. 更新统计数据

## 调用方式
- 初始化：`node scripts/init-progress.js --dict <dict> --daily <n> --push <HH:MM>`
- 生成任务：`node scripts/generate-daily-task.js`
- 更新进度：`node scripts/update-progress.js --results <JSON结果>`
- 查看报告：`node scripts/learning-report.js --period <week|month>`

## 注意事项
- 进度文件必须在每次学习后及时更新
- 复习调度严格按照间隔天数执行
- 错词连续正确 3 次后自动移出错词本
- 完成全部 6 轮复习的词标记为"已掌握"
