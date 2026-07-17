# NLU 指令系统（可执行版，问题导向）

> 本章回答一个核心问题：如何把用户自然语言，稳定映射到 S0-S6 工作流动作。

- 返回主文档：[`SKILL.md`](../../SKILL.md)
- 相关章节：[`section-3-workflow.md`](./section-3-workflow.md) / [`section-4-commands.md`](./section-4-commands.md)
- 当前版本：`2.1.2`

---

## 1. 设计目标

1. 先识别意图，再路由流程，避免空转追问。
2. 高频意图优先规则匹配，低频意图交给语义推断。
3. 误触发时提供可回退动作，不中断会话。
4. 和执行链门禁保持一致（断链、结构、质量）。

---

## 2. 顶级意图池（16项）

| 意图 | 中文触发示例 | 路由 |
|---|---|---|
| `WRITE_BOOK` | 写书、写手册、写白皮书、定大纲、拆书改写 | S0/S1 |
| `ACTIVATE_MATERIAL` | 激活原料、盘点素材、整理资料 | S0-A |
| `CONTINUE` | 继续、接着写、往下写 | 当前任务继续 |
| `REVIEW` | 自检、审一审、质量检查 | Critic 审核 |
| `EXPORT` | 导出、打包、下载 | S4 构建输出 |
| `STRATEGY` | 换策略、改细节、切模式 | S2 策略重选 |
| `STATUS` | 到哪了、进度如何、还在吗 | 进度/心跳回显 |
| `STOP` | 停止、取消、中断 | 安全收束 |
| `HELP` | 怎么用、指令、帮我 | 指令引导 |
| `CONFIRM_TOPIC` | 是的、确认、没错 | 主题确认后推进 |
| `CHECK_BALANCE` | 查看乐包、乐包余额、我的乐包、还有多少乐包 | 查询本地乐包账本并回显余额 |
| `UPGRADE_HINT` | 怎么解锁、如何升级、怎么获得乐包、还差多少 | 显示场景包解锁说明与乐包获取方式 |
| `FULL_BOOK_VIEW` | 全书视图、书的全貌、目录总览、全书章节 | 输出当前书的完整章节状态 |
| `LIST_COMMANDS` | 全部指令、所有命令、指令列表、有哪些指令 | 输出 section-4-commands.md 摘要 |
| `OTHER` | 兜底输入 | fallback -> HELP |

---

## 3. 识别优先级

1. **显式命令命中**：直接路由。
2. **同义词/口语命中**：映射到目标意图。
3. **上下文纠偏**：结合最近阶段状态。
4. **兜底**：命中 `OTHER`，回退 `HELP` 并给出下一步按钮。

> 2.1.2 补充：运行时识别以 `intent-canonical.json` 为单真源，采用 Top-K 候选与置信分带。`好/可以/嗯` 等弱信号不再直接执行高风险动作。

---

## 4. 机读结构（供脚本消费）

```yaml
# fbs-nlu-intents.yaml
version: "2.1.1"
intents:
  - id: ACTIVATE_ONLY
    zh_triggers: ["福帮手", "福帮手写书skill"]
    en_triggers: ["fbs-bookwriter", "activate skill"]
    routes_to: "activate_only"
    priority: P0

  - id: WRITE_BOOK
    zh_triggers: ["写书", "写手册", "写白皮书", "写行业指南", "定大纲", "写章节", "扩写", "加厚", "进入扩写阶段", "拆书改写", "海外本地化改写", "爆款结构改写"]
    en_triggers: ["write book", "write guide", "start"]
    routes_to: "S0/S1"
    priority: P0

  - id: ACTIVATE_MATERIAL
    zh_triggers: ["激活原料", "原料盘点", "整理素材", "盘点材料"]
    en_triggers: ["activate material", "inventory"]
    routes_to: "S0-A"
    priority: P0

  - id: CONTINUE
    zh_triggers: ["继续", "接着写", "往下写"]
    en_triggers: ["continue", "go on"]
    routes_to: "resume_current"
    priority: P0

  - id: REVIEW
    zh_triggers: ["检查质量", "审一审", "自检"]
    en_triggers: ["review", "quality check"]
    routes_to: "critic_review"
    priority: P1

  - id: EXPORT
    zh_triggers: ["导出", "打包", "下载", "生成文件"]
    en_triggers: ["export", "download", "pack"]
    routes_to: "S4"
    priority: P1

  - id: STRATEGY
    zh_triggers: ["换策略", "改深度", "切换模式"]
    en_triggers: ["change strategy", "change mode"]
    routes_to: "S2"
    priority: P1

  - id: STATUS
    zh_triggers: ["进度如何", "到哪了", "还在吗", "没反应"]
    en_triggers: ["status", "progress", "any update"]
    routes_to: "status_echo"
    priority: P1

  - id: STOP
    zh_triggers: ["停止", "取消", "中断", "退出", "退出福帮手", "关闭福帮手"]
    en_triggers: ["stop", "cancel", "exit", "exit skill"]
    routes_to: "safe_stop"
    priority: P0

  - id: HELP
    zh_triggers: ["怎么用", "帮帮我", "指令"]
    en_triggers: ["help", "how to"]
    routes_to: "command_guide"
    priority: P1

  - id: CONFIRM_TOPIC
    zh_triggers: ["确认", "是的", "没错"]
    en_triggers: ["confirm", "yes", "proceed"]
    routes_to: "topic_confirmed_continue"
    priority: P1

  - id: CHECK_BALANCE
    zh_triggers: ["查看乐包", "查乐包", "我的乐包", "乐包余额", "乐包多少", "还有多少乐包", "余额", "我的余额", "乐包剩多少", "还剩多少乐包"]
    en_triggers: ["check balance", "my credits"]
    routes_to: "credits_balance_display"
    priority: P1

  - id: UPGRADE_HINT
    zh_triggers: ["怎么解锁", "如何升级", "怎么获得乐包", "怎么赚乐包", "还差多少", "如何获得更多乐包", "乐包有什么用"]
    en_triggers: ["how to unlock", "upgrade hint", "earn credits"]
    routes_to: "upgrade_hint_display"
    priority: P1

  - id: FULL_BOOK_VIEW
    zh_triggers: ["全书视图", "书的全貌", "目录总览", "全书章节", "看看全书"]
    en_triggers: ["full book view", "book overview"]
    routes_to: "full_book_status"
    priority: P1

  - id: LIST_COMMANDS
    zh_triggers: ["全部指令", "所有命令", "指令列表", "有哪些指令", "命令清单"]
    en_triggers: ["list commands", "all commands"]
    routes_to: "command_list_display"
    priority: P1

  - id: OTHER
    zh_triggers: []
    en_triggers: []
    routes_to: "fallback_help"
    priority: P2
```

---

## 5. 与执行链对齐要求

- 严格模式下，`audit:all` 必须通过：
  - 查询优化账本
  - 待核实台账
  - 断链审计
  - 结构守卫
- NLU 文档更新时，同步更新：
  - `scripts/nlu-optimization.mjs`
  - `scripts/nlu-optimization-enhanced.mjs`
  - `scripts/consistency-audit.mjs`

---

## 6. 回归建议

- 先跑：`npm run quality:audit`
- 再跑：`npm run audit:all -- --skill-root . --book-root ./FBS-BookWriter --strict`
- 最后跑：`node scripts/consistency-audit.mjs`
