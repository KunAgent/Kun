# 模板文件格式规范

每个定时任务模板是 `templates/` 目录下的一个 markdown 文件。
模板维护者（用户本人）按本规范新增、修改、删除模板。

---

## 一、文件命名

- 文件名即模板 id，使用 kebab-case，全英文。
- 示例：`daily-interview-todo.md`、`weekly-process-pipeline.md`、`monthly-recruit-funnel-report.md`
- 一个文件 = 一个模板。

---

## 二、模板结构（强制）

每个模板文件必须包含以下结构（用 frontmatter + 正文）：

```markdown
---
id: daily-interview-todo
name: 面试待办·今日播报
category: 招聘类               # 招聘类 | 自定义
defaultName: 面试待办-Daily-{HHMM}  # 自动化创建时使用，{HHMM} 等占位符会替换
scheduleType: recurring         # recurring | once
rrule: FREQ=DAILY;BYHOUR=9;BYMINUTE=0
configurable:                   # 用户可调参数
  - key: time
    label: 触发时间
    type: time
    default: "09:00"
  - key: cwds
    label: 工作目录
    type: path
    default: "$CURRENT_WORKSPACE"
  - key: webhook
    label: 推送 Webhook（可选）
    type: string
    default: ""
    optional: true
---

# 面试待办·今日播报

## 任务描述
（一句话告诉用户这个任务会做什么）

## prompt
> 这里是会被注入到 automation 的 prompt 字段的内容。
> 可以包含 {占位符}，由 configurable 字段提供值。

## 适用场景
- 谁适合用
- 什么时候用

## 注意事项
- 依赖的工具 / 连接器
- 可能产生的副作用
```

---

## 三、占位符约定

| 占位符 | 说明 | 来源 |
|--------|------|------|
| `{HHMM}` | 用户选定的时间，例 `0900` | configurable.time |
| `{HH:MM}` | 同上但带冒号，例 `09:00` | configurable.time |
| `{cwds}` | 工作目录 | configurable.cwds |
| `{webhook}` | 用户提供的 Webhook | configurable.webhook |
| `$CURRENT_WORKSPACE` | 当前工作区路径（运行时由 skill 用 cwd 解析） | skill 注入 |

---

## 四、index.md 同步规则

每次新增或删除模板文件时，**必须**同步更新 `templates/index.md`：
- 把模板加进对应分类的列表
- 写一句简短描述
- 标注是否需要外部依赖（如 Webhook、连接器）

skill 在跑模板入口时只读 `index.md`，不会扫描整个目录。

---

## 五、示例：最简模板

```markdown
---
id: daily-interview-todo
name: 面试待办·今日播报
category: 招聘类
defaultName: 面试待办-Daily-{HHMM}
scheduleType: recurring
rrule: FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0
configurable:
  - key: webhook
    label: 企业微信群机器人 Webhook（可选 · 配了结果就推到群）
    type: string
    default: ""
    optional: true
---

# 面试待办·今日播报

## 任务描述
工作日每天 9:00 汇总今日面试安排 + 推荐待办 + 逾期待填面评。

## prompt
> 使用 recruit-mcp 查询今日面试安排和推荐待办，汇总成一屏播报。
> 如果用户配了 webhook {webhook}，把结果推送到对应企微群。
```

---

## 六、模板的"无侵入"原则

- 模板**只描述任务和默认参数**，不描述用户身份、不硬编码任何个人 Webhook/Token。
- 个人化数据（如群 Webhook）只能通过 `configurable` 字段问用户。
- 模板可以引用 skill 内的其他 reference 文件，但不要引用 skill 外的文件。

---

## 七、通知渠道（产出报告类模板必带 · CRITICAL）

> 定时任务跑完结果默认只在 IDE / WorkBuddy 对话窗口出现，人不在电脑前会错过。
> **凡是产出"报告/清单/播报/汇总"的模板，必须支持把结果推送到企业微信群**。

### 模板侧要做两件事

1. **frontmatter `configurable` 加 webhook 项**（标准写法）：
   ```yaml
     - key: webhook
       label: 企业微信群机器人 Webhook（可选 · 配了结果就推到群）
       type: string
       default: ""
       optional: true
   ```

2. **正文加「## 通知推送」段**，告诉 agent：用户配了 webhook 就在 prompt 末尾追加 curl 推送指令，没配就保持只在对话窗口输出。推送格式（企微 markdown，≤4096 字节）见 `references/notify-channel.md`。

### Agent 侧硬规则（写在 SKILL.md §三点五）

- 配置产出报告类任务时，**必须主动问"结果发到哪"**，不允许默认"只在对话窗口"静默创建。
- 用户选推群 → 引导拿群机器人 Webhook（企微群「…」→「群机器人」→「添加机器人」）。
- 收到 webhook **不回显完整 URL**，只填进 prompt 占位符 `{webhook}`。

> ⚠️ 纯提醒类模板（不产出报告）可不带 webhook 项，但招聘类模板一般都会产出播报/报告，建议标配。
