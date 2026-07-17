---
name: opc-business-model-design
description: Design a viable business model for a one-person company using Lean Canvas and a simplified Business Model Canvas. Use when Codex needs to explain the business-model concepts when needed, verify niche and value-proposition prerequisites, ask one question at a time, present multiple model choices, and write user-confirmed outputs into `opc-doc/`.
---

# 商业模式设计

## 目标

帮助用户把“这个生意如何成立”拆清楚，而不是直接替用户填完一张画布。

## 核心原则

- 默认读写当前工作目录下的 `opc-doc/`
- 教学模式下先解释 Lean Canvas 和轻量商业模式画布是什么
- 一次只处理一个模块，不一次填完整张画布
- 默认一次只问一个问题；如果几个问题都很轻、彼此紧密相关，可以合并成 2 到 3 个
- 每个关键模块默认给 3 个可选方案，并附加 `4. 我有自己的方案`
- 用户确认后再写入正式结果
- 不直接给推荐结论，只做方案分析
- **本阶段只做"这个生意如何成立"的结构分析，不进入执行层**

## 本阶段边界

### 本步做什么

- 拆解商业模式核心模块（Problem / Solution / Channels / Revenue 等）
- 识别高风险假设
- 确认当前商业模式方向

### 本步不做什么（以下属于后续阶段，不要提前进入）

- ❌ 不做 MVP 设计或产品原型（属于 opc-mvp-designer）
- ❌ 不做获客流程或内容计划（属于转化闭环阶段）
- ❌ 不做具体运营 SOP 或交付流程（属于资产沉淀阶段）

**越界检测**：如果出现"我先做哪个功能""怎么开始第一单""怎么发内容"等话题，先记录，再说：
> "这属于后续 MVP 或执行阶段的范围。我们先把商业模式的假设确认清楚，再推进。"

## 本步骤必须完成什么

优先完成 Lean Canvas 的核心模块：

1. Problem
2. Customer Segments
3. Unique Value Proposition
4. Solution
5. Channels
6. Revenue Streams
7. Cost Structure
8. Key Metrics
9. Unfair Advantage

在此基础上，再用 BMC Lite 做轻量校验。

## 优先确认顺序

1. Problem
2. Customer Segments
3. Unique Value Proposition
4. Solution
5. Channels
6. Revenue Streams
7. Cost Structure
8. Key Metrics
9. Unfair Advantage

## 完成标准

- Lean Canvas 核心模块已完成
- 高风险假设已提炼
- 用户已确认当前商业模式方向

## 本步需要解释什么

教学模式下先解释：

- Lean Canvas 是创业假设的简表
- 商业模式画布是看“价值如何创造、传递、获取”
- 这一步的作用是防止在商模没想清楚时就盲目做产品

## 输入

必须优先读取：

- `opc-doc/outputs/02-niche-positioning/*`
- `opc-doc/outputs/03-value-proposition/*`

如果前置结果不足，先建议回到对应前置 skill。

## 执行步骤

1. 先解释本步作用
2. 默认一次只问一个问题；如果几个问题都很轻、彼此紧密相关，可以合并成 2 到 3 个，并按模块推进，例如：
   - 这类用户最核心的问题是什么？
   - 你打算先卖什么？
   - 用户会通过什么渠道找到你？
   - 你更想怎么收费？
3. 每一轮回答后，给简短反馈，说明当前商模正在成形的哪一部分
4. 对关键模块给 3 个候选方案，例如：
   - 定价方式的 3 个版本
   - 渠道路径的 3 个版本
   - 收入结构的 3 个版本
5. 默认增加 `4. 我有自己的方案`
6. 让用户选、改、混合，或提出自己的版本
7. 在关键模块被确认后，再整理为 Lean Canvas 与 BMC Lite
8. 提炼高风险假设
9. 用户确认后再落盘

## 输出

对话层必须包含：

1. 本步解释
2. 当前商模模块摘要
3. 3 个关键方案候选 + `4. 我有自己的方案`
4. 每个方案的适用情况、优点和代价
5. 请用户确认或修改

## 落盘检查点（阶段必须完成，不可跳过）

用户明确确认核心商模方向后，**立即**使用 Write 工具在文件系统上创建以下文件，然后才能进入下一阶段。在对话中描述结论不等于落盘。

**写入文件：**

- `opc-doc/outputs/04-business-model/lean-canvas.md`（Lean Canvas 核心模块填写结果）
- `opc-doc/outputs/04-business-model/business-model-canvas-lite.md`（BMC Lite 轻量校验）
- `opc-doc/outputs/04-business-model/pricing-notes.md`（收费方式假设）
- `opc-doc/outputs/04-business-model/risky-assumptions.md`（高风险假设清单，供 MVP 阶段优先验证）

**更新状态文件：**

- `opc-doc/state/current-stage.json`（写入：`{"stage": "04-business-model", "status": "completed", "next_stage": "06-mvp-designer", "summary": "一句话商模核心"}`）
- `opc-doc/state/decisions.json`（追加核心商模决策）
- `opc-doc/state/assumptions.json`（写入高风险假设列表）

**落盘完成后，在对话中告知用户：**
> "✅ 商业模式结论已保存。下次对话可以从 MVP 设计继续。"

**只有落盘完成后，才可以提示进入 `opc-mvp-designer`。**

## 何时调用其他 skills

只有在用户确认核心商模后，才进入 `opc-mvp-designer`。

## 异常处理

- 如果用户明显不理解画布类术语，必须用更通俗的说法替代
- 如果收入方式和价值主张冲突，要指出冲突并给备选，而不是直接定案
