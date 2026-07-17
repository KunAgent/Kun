# 面试助手 — 踩坑经验与版本历史

> 本文档收录面试助手 skill 开发过程中遇到的坑、版本变更记录、参数陷阱。
> 供维护者和后续开发者参考，不放入主 SKILL.md 以保持整洁。

## 版本历史（内部参考，不影响使用）

### v3.6 (2026-05-12) - 测评数据解读硬规则

**背景**：写某候选人面试计划时，把接口返回的 `qualityAssessmentResults[].result = 2` 错误解读成「2 分 🔴 红点」，并基于这个虚构的红点编了 Q7/Q8 追问题和「倾向不推」判据。用户纠正：这是**档位（1 低 / 2 中 / 3 高）**，不是分数；**只有 1 档才预警**，2/3 档都是正常的。

**硬规则新增**（写入所有出题/面评场景）：

1. **测评数据尺度口径**
   - `qualityAssessmentResults[].result` 和 `childDimensions[].result` 是**档位**，取值 1/2/3
   - 映射：**1=低（预警）/ 2=中（正常）/ 3=高（优秀）**
   - `totalscore` 和 `scoreLevel` 在 MCP 接口里**恒为 0 和 null**，不是真实分数，不要引用
   - 原始分（1-10 尺度）只在招活前端和 PDF 报告里，**MCP 接口拿不到**

2. **输出表达硬规则**
   - ❌ 禁止把档位说成"X 分"
   - ❌ 禁止对档位 2 或 3 标红点 / 标"偏低" / 标"红灯"
   - ❌ 禁止基于 2/3 档生成"测评红点验证"题或"反驳测评"评分档位
   - ✅ 只对档位 1 生成预警题；档位 2/3 按"测评无预警，不作为本轮判断依据"处理
   - ✅ 输出表格必须明确写"档位"而非"分"，并附映射说明

3. **数据边界诚实披露**
   - 若用户询问"原始分"或"更细测评数据"，必须明确说「MCP 接口层不返回，需登录招活前端查 PDF 报告」，不要编
   - 不要从不存在的字段推断不存在的结论

### v3.5 (2026-05-12)
- 版本号统一：frontmatter 与正文统一为 v3.5
- 移除正文中的版本更新日志块（原 lines 222-253），移到本文件
- 清除正文中的版本标签（v2.5/v2.4/v2.3/v2.2/v2.1/v1.1 等），保持正文整洁
- 清除正文中的日期戳（2026-05-09 实测 等），便于对外分享
- 参数类型陷阱、踩坑记录保留在此文件，主文档只保留使用说明

### v1.1.0 (2026-05-12)
- 🆕 核心硬规则新增「本轮环节优先从数据读」：C-1 先尝试从 T 待办 / `interviewRecords.flows` / `currentStep` 自动识别本轮环节，命中就不问用户
- 🆕 编码处理规则细化 4 条反"乱编"禁令：禁止基于终端乱码碎片猜测、禁止伪造数据继续输出、输出前回溯抽样自检、所有基于简历的论断必须可溯源
- 🆕 T→C 联动升级：走「面试出题」时自动把 `step_txt` / `position_txt` / `recruit_type` 打包带入 C-1，免去用户重选
- 🆕 C-1 拆为 Step A（自动识别）+ Step B（兜底询问），并要求面试计划顶部显示"环节来源"

### v2.5 (2026-05-09)
- 新增 Router-0 通识路由：当 M-Auto 命中失败（找不到专属模型）时，走 SearchAPI 动态发现通用 API，不阻塞主流程
- 面试安排流程（S-A）明确：post_order_add 可一步落时段+发通知，不再需要 add+change 两步

### v2.4 (2026-05-09)
- D-1 面评流程增强：拉转写 + 双版本面评；使用 tencent-meeting-mcp 获取会议转写

### v2.3 (2026-05-09)
- 面试安排 S-B 踩坑：stateId=1 时 post_order_change 不可用，需走 post_order_add 覆盖

### v2.2 (2026-05-09)
- M-0 模型选择前置：进入 B/C/D 前强制走选模型流程

### v2.1 (2026-05-09)
- S-A 一步下单验证：post_order_add 一步完成时段+通知

### v1.1 (2026-05-12 原始)
- 初始版本：M-Auto 模型路由 + T/T2 待办 + S 面试安排 + D 面评


---

## 参数类型陷阱（最重要！）

### post_order_change vs post_order_add 参数差异

| 参数 | `post_order_add` | `post_order_change` |
|---|---|---|
| 确认时间字段名 | `timeConfirmed` | `isConfirmTime` |
| 字段类型 | **字符串** `"true"`/`"false"` | **布尔值** `true`/`false` |
| `id` 类型 | 不需要 `id`（用 `traceId`） | **整数**（不是字符串！） |
| `staffName` | 不需要 | **必填**，否则报 500 |

### 各接口 id 参数类型对照

| 接口 | `id` 参数类型 | 备注 |
|---|---|---|
| `post_order_change` | **integer** | 最容易被忽略！ |
| `post_order_add` | 不需要 `id` | 用 `candidates[].traceId` 关联 |
| `get_order_detail` | **string** | 与 post_order_change 相反！ |
| `get_order_cancel` | **string** | `"2522058"` 不是 `2522058` |

### noticeType 字段名拼写

- ✅ 正确：`smsToCandidate`, `emailToCandidate`, `wechatMp`
- ❌ 错误：`sms`, `email`, `wechat` （会静默忽略，不报错但也不发通知）

---

## 踩坑记录

### 坑1：post_order_change 返回 500 —— 参数类型错误

**现象**：调用 `post_order_change` 修改面试时间，返回 500 "操作失败，请检查参数是否和HR确认"

**根因**：`isConfirmTime` 传了字符串 `"false"` 而不是布尔值 `false`；`id` 传了字符串而不是整数。

**修正**：严格按照 API 定义的参数类型传参。`post_order_change` 的 `id`=integer，`isConfirmTime`=boolean。

**结论**：`post_order_change` 可以直接用，不需要"取消+重排"兜底（除非订单状态确实不允许修改）。

---

### 坑2：stateId=1 时 post_order_change 不可用

**现象**：候选人单据 stateId=1（"待安排面试时间"），调 `post_order_change` 无论如何都返回 500。

**根因**：系统状态机限制，`stateId=1` 时不允许 `post_order_change`，必须走 `post_order_add`（传 `traceId`）覆盖时段。

**处理**：
```
stateId == 1   → 走 S-A.2（post_order_add，用 traceId）
stateId ∈ (2, 3, 4, 7, 8, 9) → 走 S-B（post_order_change，用 orderId）
stateId ∈ (10, 11) → 拒绝操作（已关单）
```

---

### 坑3：post_order_add 一步下单后 startTime 为空

**现象**：`post_order_add` 返回 `success:true`，但 `get_order_detail` 里 `startTime` 为空。

**根因**：漏传 `interviewTimeList` 或 `timeConfirmed` 参数。

**处理**：按 S-A.2 模板补全参数重下；若仍失败，走 S-A.4 用 `post_order_change` 补时段。

---

### 坑4：get_order_detail 的 id 必须是字符串

**现象**：`get_order_detail` 返回 `TYPE_MISMATCH: expected string, actual number`

**根因**：`id` 传了数字类型，此接口要求字符串。

**修正**：`"id": "2522058"` 而非 `"id": 2522058`

**注意**：这与 `post_order_change` 的 `id` 类型（integer）相反！两个接口不一致，容易搞混。

---

### 坑5：mcporter 终端输出乱码，无法用 Read 直接解析

**现象**：`mcporter call ... > result.json 2>&1` 后，用 Read 工具读取出现中文乱码（如 ``）。

**根因**：终端编码问题，Python `open()` 默认编码与终端不一致。

**处理**：写 Python 脚本用 `repr()` 读取文件内容来调试；或直接用 Python `json.loads()` 解析，不依赖 Read 工具。

**规则（硬规则）**：mcporter 写文件 → 用 Python 脚本读取处理 → 避免直接 Read 解析终端输出。

---

### 坑6：多时段邀约失效

**现象**：`interviewTimeList` 传了多个时段，候选人只收到第一个时段。

**根因**：系统不支持多时段候选选择，`timeConfirmed`/`isConfirmTime` 在多时段时会被忽略。

**处理**：只传 1 个时段；若需多时段，线下沟通后确定单一时段再下单。

---

### 坑7：面试时间填了候选人当地时间

**现象**：面试时间显示错乱，候选人和面试官看到的时间不一致。

**根因**：把候选人当地时间填进了 `interviewTimeList`，应该用**北京时间**。

**处理**：`interviewTimeList` 里的所有时间都按北京时间填；时差对照表只用于和候选人沟通，不填入系统。

---

## 常见错误速查（详细版）

| 现象 | 原因 | 处理 |
|---|---|---|
| `post_order_change` 返 500 | `id` 传了字符串 | `id` 用整数，如 `2522058` 而非 `"2522058"` |
| `post_order_change` 返 500 | `isConfirmTime` 传了字符串 | 用布尔值 `false`/`true` |
| `post_order_change` 返 500 | 没传 `staffName` | 加上 `staffName: "<英文名>"` |
| `get_order_detail` TYPE_MISMATCH | `id` 传了 number | `id` 必须传字符串 |
| `post_order_add` success:true 但 startTime 为空 | 漏传参数 | 补全 `interviewTimeList` + `timeConfirmed` |
| 多时段邀约失效 | 系统不支持 | 只传单时段 |
| 面试时间显示错乱 | 填了当地时间 | 统一用北京时间 |
| `Unknown MCP server` | mcporter cwd 不对 | 设置 `MCPORTER_WORKSPACE` |
| 401 | Token 过期 | 重跑 `tai-oauth` 重建 PAT |

---

*本文档随 skill 维护，遇到新坑请追加至此。*
