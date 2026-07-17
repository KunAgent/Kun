# 间隔重复记忆算法参考文档

## 1. 艾宾浩斯遗忘曲线

德国心理学家赫尔曼·艾宾浩斯（Hermann Ebbinghaus）在1885年发表的研究表明，人类记忆遵循指数衰减规律。初始记忆在最初几小时内遗忘最快，随后遗忘速度逐渐减缓。

### 遗忘规律
| 学习后时间 | 记忆保持率 |
|-----------|-----------|
| 20分钟 | 58% |
| 1小时 | 44% |
| 8小时 | 36% |
| 1天 | 34% |
| 2天 | 28% |
| 6天 | 25% |
| 31天 | 21% |

## 2. 本系统复习间隔设计

基于遗忘曲线，在记忆衰减到临界点时安排复习，实现最优记忆强化：

### 复习时间表
```
Day 0: 首次学习（新词）
Day 1: 第1次复习（24小时后，记忆保持约34%）
Day 3: 第2次复习（间隔2天）
Day 7: 第3次复习（间隔4天）
Day 14: 第4次复习（间隔7天）
Day 29: 第5次复习（间隔15天）
Day 59: 第6次复习（间隔30天）→ 进入长期记忆，标记为"已掌握"
```

### 间隔数组
```javascript
const REVIEW_INTERVALS = [1, 2, 4, 7, 15, 30]; // 单位：天
```

## 3. 单词状态机

### 状态定义
| 状态 | 标识 | 说明 |
|------|------|------|
| 新词 | `new` | 尚未学习，在词库队列中等待 |
| 学习中 | `doing` | 首次学习完成，等待进入复习轮次 |
| 待复习 | `review` | 在复习调度中，按间隔时间复习 |
| 已掌握 | `known` | 完成全部6轮复习，进入长期记忆 |
| 错词 | `wrong` | 在练习中答错，需要强化复习 |

### 状态转换规则
```
new → doing       : 首次学习完成
doing → review    : 第二天到达第1次复习时间
review → review   : 每次复习正确，推进到下一轮间隔
review → known    : 第6次复习正确
review → wrong    : 复习时答错
wrong → review    : 连续3次答对，回归正常复习轨道
doing → wrong     : 首次学习时拼写错误
```

## 4. 错词强化策略

### 进入错词本条件
- 跟打模式中拼写错误
- 默写模式中拼写错误
- 复习模式中标记为"不认识"

### 错词复习频率
- 错词不受间隔复习时间表约束
- 每日额外安排 5-10 个错词复习
- 从错词本中随机抽取（优先最近加入的）

### 移出错词本条件
- 在后续练习中连续 3 次回答正确
- 正确计数存储在 `wordStates[word].correctStreak` 中
- 移出后回归正常复习轨道（从当前 reviewCount 继续）

## 5. 每日任务生成算法

### 伪代码
```
function generateDailyTask(progress):
  today = currentDate()
  
  // 1. 错词（最高优先级）
  wrongBatch = sample(progress.wrongWords, min(10, len(wrongWords)))
  
  // 2. 到期复习词
  reviewBatch = []
  for word in progress.reviewSchedule[today]:
    reviewBatch.append(word)
  
  // 3. 新词
  newBatch = dictWords[lastLearnIndex : lastLearnIndex + perDayStudyNumber]
  
  // 4. 组装任务
  return {
    wrong: wrongBatch,       // 错词强化
    review: reviewBatch,     // 到期复习
    new: newBatch,           // 新词学习
    totalCount: len(wrongBatch) + len(reviewBatch) + len(newBatch)
  }
```

### 任务优先级
1. 错词强化（必须完成）
2. 到期复习词（必须完成）
3. 新词学习（可根据时间调整数量）

## 6. 进度持久化方案

### 存储位置
`.workbuddy/memory/vocab-progress.json`

### 关键字段
```json
{
  "currentDict": "cet6",           // 当前词库ID
  "perDayStudyNumber": 20,         // 每日新词量
  "lastLearnIndex": 145,           // 已学到的位置
  "pushTime": "08:00",             // 推送时间
  "automationId": "auto-xxx",      // 关联的自动化ID
  "stats": {
    "totalLearned": 145,           // 总学习词数
    "totalMastered": 89,           // 已掌握词数
    "totalWrong": 23,              // 错词池当前数
    "streakDays": 7,               // 连续打卡天数
    "startDate": "2026-05-01",     // 开始日期
    "lastLearnDate": "2026-05-03"  // 最后学习日期
  },
  "wrongWords": [...],             // 错词列表
  "weakWords": [...],              // 薄弱词列表
  "reviewSchedule": {              // 按日期的复习安排
    "2026-05-04": ["word1", ...],
    "2026-05-05": ["word2", ...]
  },
  "wordStates": {                  // 每个词的状态
    "word1": {
      "state": "review",
      "reviewCount": 3,
      "lastReview": "2026-05-01",
      "nextReview": "2026-05-08",
      "correctStreak": 0
    }
  }
}
```

## 7. 常见过滤词（不计入学习）

以下为高频简单词，在分析文章生词时自动过滤：
```
a, an, the, i, my, me, you, your, he, his, she, her, it,
what, who, where, how, when, which,
be, am, is, was, are, were, do, did, can, could, will, would,
to, of, for, at, in, that, this, and, not, no, yes
```
