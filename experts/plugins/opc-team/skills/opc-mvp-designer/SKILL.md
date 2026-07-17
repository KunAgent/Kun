---
name: opc-mvp-designer
description: Define the smallest viable experiment and MVP for a selected one-person company opportunity. Use when Codex needs to explain what MVP means when needed, verify prerequisites, ask one question at a time, present multiple MVP options, and write user-confirmed outputs into `opc-doc/`.
---

# MVP 设计

## 目标

帮助用户确定“最先验证什么、用什么最小形式去验证”，而不是替用户直接定一个产品。

## 核心原则

- 默认读写当前工作目录下的 `opc-doc/`
- 教学模式下先解释 MVP 不是“简陋产品”，而是“最小验证”
- 默认一次只问一个问题；如果几个问题都很轻、彼此紧密相关，可以合并成 2 到 3 个
- 默认给 3 个 MVP 方案，并附加 `4. 我有自己的方案`
- 用户确认后再写入正式结果
- 不直接给推荐结论，只做方案分析
- **本阶段只做"验证什么、用什么最小形式验证"，不进入内容创作或交付细节**

## 本阶段边界

### 本步做什么

- 确认最优先需要验证的假设
- 选定最小验证形式（服务先行 / 内容验证 / 工具原型等类别）
- 明确成功标准和 MVP 边界

### 本步不做什么（以下属于后续阶段，不要提前进入）

- ❌ 不写具体内容选题、文案或帖子（属于 opc-asset-ops）
- ❌ 不设计完整转化路径（属于 opc-conversion-loop）
- ❌ 不设计交付 SOP 或运营细节（属于 opc-asset-ops）

**越界检测**：如果出现"第一篇帖子写什么""具体怎么做这次验证""文案怎么写"等执行话题，先记录，再说：
> "这些执行细节会在转化闭环和资产沉淀阶段处理。现在先把验证路径的框架确认好。"

## 本步骤必须完成什么

1. 明确当前最先要验证的假设
2. 明确最小验证形式
3. 明确成功标准
4. 明确 MVP 边界
5. 明确人机分工

## 优先确认顺序

1. 最优先验证的假设
2. 最小验证形式
3. 成功标准
4. MVP 边界
5. 人机分工

## 完成标准

- 已形成可执行的 MVP 方案
- 用户已确认当前主验证路径

## 本步需要解释什么

教学模式下先解释：

- MVP 的作用是验证假设
- 不是功能越多越好
- 一人公司更适合先跑通最小闭环

## 输入

优先读取：

- `opc-doc/outputs/04-business-model/risky-assumptions.md`

如果依赖不完整，先建议回到 `opc-business-model-design`。

## 执行步骤

1. 解释本步作用
2. 默认一次只问一个问题；如果几个问题都很轻、彼此紧密相关，可以合并成 2 到 3 个，例如：
   - 你最想先验证的假设是哪一个？
   - 你更愿意用服务、内容还是工具来验证？
3. 每轮回答后，给简短反馈
4. 生成 3 个 MVP 方案，例如：
   - 服务先行版
   - 内容验证版
   - 工具原型版
5. 每个方案说明验证什么、适合什么情况、优点和代价
6. 默认增加 `4. 我有自己的方案`
7. 让用户选择、组合、修改，或直接提出自己的版本
8. 用户确认后，再写入正式结果

## 输出

对话层必须包含：

1. 本步解释
2. 当前要验证的假设摘要
3. 3 个 MVP 方案 + `4. 我有自己的方案`
4. 每个方案的适用情况、优点和代价
5. 请用户确认或修改

## 落盘检查点（阶段必须完成，不可跳过）

用户明确确认 MVP 方案后，**立即**使用 Write 工具在文件系统上创建以下文件，然后才能进入下一阶段。在对话中描述结论不等于落盘。

**写入文件：**

- `opc-doc/outputs/06-mvp-design/mvp-spec.md`（验证假设 + 最小验证形式 + MVP 边界）
- `opc-doc/outputs/06-mvp-design/experiment-plan.md`（成功标准 + 验证周期）
- `opc-doc/outputs/06-mvp-design/human-ai-split.md`（人工 vs AI 分工说明）

**更新状态文件：**

- `opc-doc/state/current-stage.json`（写入：`{"stage": "06-mvp-design", "status": "completed", "next_stage": "07-conversion-loop", "summary": "一句话 MVP 核心"}`）
- `opc-doc/state/assumptions.json`（更新已验证/待验证假设状态）

**落盘完成后，在对话中告知用户：**
> "✅ MVP 方案已保存。下次对话可以从转化闭环继续。"

**只有落盘完成后，才可以提示进入 `opc-conversion-loop`。**

## 何时调用其他 skills

只有在用户确认 MVP 方案后，才进入 `opc-conversion-loop`。

## 异常处理

- 如果用户想一次验证太多东西，必须帮助他收缩成单一主验证目标
- 如果上下文没有明确选定方向，不进入 MVP 设计
