# 定时任务 Prompt

## 任务1：每日新闻推送（早9点）

- **name**: "新闻搭子-每日推送"
- **rrule**: `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYHOUR=9;BYMINUTE=0`
- **status**: ACTIVE
- **cwds**: skill 所在目录（`/Users/xz/.workbuddy/skills/news-buddy-skill`）
- **prompt**:

```
加载并执行 AI新闻搭子 skill（路径：{SKILL_DIR}/SKILL.md）的完整推送流程。

严格按 SKILL.md 中 P1→P2→P3 的步骤执行，不要自行发挥：

P1：执行 --daily-update + --get-profile 获取画像和 search_dimensions
P2：固定4次搜索（先检测 tencent-news-cli 是否可用，走路径A或路径B），筛选5条
P3：按 SKILL.md 中的「概览卡片」模板输出（每条4字段：card_title / summary / how_brief / source_link），每字段独占一行，字段间用emoji前缀区分

关键约束（务必遵守）：
- 禁止输出 SCQA、S/C/Q/A、情境/冲突/核心问题 等任何框架术语
- 禁止输出方括号格式如【】
- card_title 用朋友聊天口吻，体现"跟你有什么关系"
- summary 必须结合画像具体角度，2-3句话
- how_brief 是一句话行动建议
- 最后执行 --mark-shown 标记已展示
- 推送5条，不多不少
```

## 任务2：每日画像更新（晚12点）

- **name**: "新闻搭子-画像更新"
- **rrule**: `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU;BYHOUR=0;BYMINUTE=0`
- **status**: ACTIVE
- **cwds**: skill 所在目录（`/Users/xz/.workbuddy/skills/news-buddy-skill`）
- **prompt**:

```
执行 AI新闻搭子的每日画像更新（脚本路径：{SKILL_DIR}/scripts/news-buddy.cjs）：

1. 运行 node {SKILL_DIR}/scripts/news-buddy.cjs --daily-update
2. 如果输出中有 merge_suggestions，执行合并操作（先 --update-profile --add remove 再 add）
3. 如果你对用户有新的观察（正则无法覆盖的偏好），写入 notes 字段
4. 输出一句简短的画像更新摘要（如"衰减了X个，boost了Y个，清理了Z个"）
```

## 创建后话术

```
搞定！我已经帮你设置好了 ✅

📰 每天早上 9 点 — 自动推送跟你相关的新闻
🔄 每天晚上 12 点 — 自动更新你的兴趣画像

明天早上 9 点你就会收到第一条推送了。
现在要先看看今天有什么跟你相关的新闻吗？
```

## 重要提醒

定时任务有独立的 prompt，不会自动读取 SKILL.md 的最新内容。如果 SKILL.md 有重大更新（如输出格式变化、新增约束），需要同步更新定时任务的 prompt。使用 WorkBuddy 的 automation_update 工具修改。
