---
name: opc-value-proposition
description: Design value propositions for candidate customer segments and help the user choose the strongest one. Use when Codex needs to explain jobs, pains, and gains when needed, check niche-positioning prerequisites, ask one question at a time, present multiple value-proposition options, and write user-confirmed outputs into `opc-doc/`.
---

# 价值主张

## 目标

帮助用户明确“这类人为什么要买你”，并给出可选择的价值主张方案。

## 核心原则

- 默认读写当前工作目录下的 `opc-doc/`
- 教学模式下先解释 jobs、pains、gains
- 一类细分客户对应一类价值主张
- 默认一次只问一个问题；如果几个问题都很轻、彼此紧密相关，可以合并成 2 到 3 个
- 默认给 3 个价值主张方向，并附加 `4. 我有自己的方案`
- 用户确认后再写入正式结果
- 不直接给推荐结论，只做方案分析
- **本阶段只做"为什么买你"的结构化分析，不进入话术设计或内容创作**

## 本阶段边界

### 本步做什么

- 拆解目标用户的 Jobs / Pains / Gains（结构化框架层）
- 分析你的产品/服务如何对应用户需求（框架层）
- 生成 3 个价值主张版本供用户选择（描述性语言，非推广话术）

### 本步不做什么（以下属于后续阶段，不要提前进入）

- ❌ 不写具体广告文案或推广话术（属于资产沉淀阶段）
- ❌ 不设计内容选题或帖子结构（属于资产沉淀阶段）
- ❌ 不做定价策略或收费方案（属于商业模式设计阶段）
- ❌ 不设计转化路径或获客步骤（属于转化闭环阶段）

**越界检测**：如果出现"怎么写标题""小红书文案""怎么说服用户"等执行话题，先记录，再说：
> "这些执行细节很重要，我们会在后续阶段专门处理。现在先把'为什么买你'的逻辑框架确认好。"

## 本步骤必须完成什么

1. 目标细分客户确认
2. Customer Jobs
3. Pains
4. Gains
5. Products / Services
6. Pain Relievers
7. Gain Creators
8. 价值主张版本比较

## 优先确认顺序

1. 目标细分客户
2. Customer Jobs
3. Pains
4. Gains
5. Products / Services
6. Pain Relievers
7. Gain Creators
8. 价值主张版本选择

## 完成标准

- 价值主张画布关键模块已经完整
- 用户已确认当前主打的价值主张版本

## 本步需要解释什么

教学模式下先解释：

- Jobs：用户想完成什么任务
- Pains：用户在完成任务时最痛的阻碍
- Gains：用户理想中想得到的收益
- 价值主张：你准备如何帮助这类用户更好完成任务

## 输入

必须先读取：

- `opc-doc/outputs/02-niche-positioning/segments.md`
- `opc-doc/outputs/02-niche-positioning/target-segment.json`
- `opc-doc/outputs/02-niche-positioning/positioning-statement.md`

如果这些文件缺失，先判断当前对话是否已经明确目标细分和定位。

- 如果没有，先建议调用 `opc-niche-positioning`

## 执行步骤

1. 解释本步目标和术语
2. 默认一次只问一个问题；如果几个问题都很轻、彼此紧密相关，可以合并成 2 到 3 个，例如：
   - 这类用户最想得到的结果是什么？
   - 他们现在最痛的一点是什么？
   - 他们为什么不满意现有方案？
3. 每轮回答后，用白话总结当前 jobs / pains / gains 理解
4. 生成 3 个价值主张版本，例如：
   - 提效型
   - 结果型
   - 降风险型
5. 每个版本都说明适用情况、优点和代价
6. 默认增加 `4. 我有自己的方案`
7. 让用户选择、组合、修改，或直接提出自己的版本
8. 用户确认后，再写入正式结果

## 输出

对话层必须包含：

1. 本步解释
2. 当前 jobs / pains / gains 摘要
3. 3 个价值主张候选 + `4. 我有自己的方案`
4. 每个方案的适用情况、优点和代价
5. 请用户确认或修改

## 落盘检查点（阶段必须完成，不可跳过）

用户明确确认主价值主张版本后，**立即**使用 Write 工具在文件系统上创建以下文件，然后才能进入下一阶段。在对话中描述结论不等于落盘。

**写入文件：**

- `opc-doc/outputs/03-value-proposition/value-proposition-canvas.md`（Jobs / Pains / Gains + Pain Relievers / Gain Creators 完整画布）
- `opc-doc/outputs/03-value-proposition/segment-vp-matrix.md`（目标客群 × 价值主张对应关系）
- `opc-doc/outputs/03-value-proposition/messaging.md`（确认的主价值主张表述，框架层，非广告话术）

**更新状态文件：**

- `opc-doc/state/current-stage.json`（写入：`{"stage": "03-value-proposition", "status": "completed", "next_stage": "04-business-model", "summary": "一句话价值主张核心"}`）
- `opc-doc/state/decisions.json`（追加确认的价值主张版本）

**落盘完成后，在对话中告知用户：**
> "✅ 价值主张结论已保存。下次对话可以从商业模式设计继续。"

**只有落盘完成后，才可以提示进入 `opc-business-model-design`。**

## 何时调用其他 skills

只有在用户确认主价值主张后，才进入 `opc-business-model-design`。

## 异常处理

- 如果用户对术语不熟，必须改用更白话的表达
- 如果多个价值主张都可行，要并列呈现，不要私自替用户拍板
