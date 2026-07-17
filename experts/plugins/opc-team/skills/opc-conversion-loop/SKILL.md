---
name: opc-conversion-loop
description: Design a conversion loop for a one-person company from reach to lead capture to purchase. Use when Codex needs to explain conversion concepts when needed, verify MVP prerequisites, ask one question at a time, present multiple conversion-path options, and write user-confirmed outputs into `opc-doc/`.
---

# 转化闭环

## 目标

帮助用户设计“怎么触达、怎么承接、怎么成交”的路径，而不是直接替用户定一条路线。

## 核心原则

- 默认读写当前工作目录下的 `opc-doc/`
- 教学模式下先解释“转化闭环”
- 默认一次只问一个问题；如果几个问题都很轻、彼此紧密相关，可以合并成 2 到 3 个
- 默认给 3 条可选转化路径，并附加 `4. 我有自己的方案`
- 用户确认后再写入正式结果
- 不直接给推荐结论，只做方案分析
- **本阶段只做"触达→承接→成交"的路径结构，不进入具体内容或文案创作**

## 本阶段边界

### 本步做什么

- 确认目标渠道（在哪里触达用户）
- 确认线索承接方式（怎么接住）
- 确认第一次成交动作（怎么完成第一单）
- 确认完整转化路径结构

### 本步不做什么（以下属于后续阶段，不要提前进入）

- ❌ 不写具体内容选题、帖子结构或文案（属于 opc-asset-ops）
- ❌ 不设计具体产品包装话术（属于 opc-asset-ops）
- ❌ 不做运营 SOP 或交付细节（属于 opc-asset-ops）

**越界检测**：如果出现"第一篇帖子怎么写""具体怎么说服用户""封面怎么设计"等话题，先记录，再说：
> "这些属于内容资产阶段的工作。现在先把转化路径的结构确认好，后面的内容才有方向。"

## 本步骤必须完成什么

1. 明确目标渠道
2. 明确线索承接动作
3. 明确低摩擦成交动作
4. 明确完整转化路径

## 优先确认顺序

1. 目标用户最常出现的渠道
2. 线索如何承接
3. 如何发生第一次成交
4. 整条转化路径如何闭环

## 完成标准

- 已形成明确的转化路径方案
- 用户已确认当前主路径

## 本步需要解释什么

教学模式下先解释：

- 转化闭环就是从被看见到最终成交的完整路径
- 关键不只是流量，而是有没有承接和成交动作
- 这一步会决定你如何拿到第一批用户

## 输入

优先读取：

- `opc-doc/outputs/06-mvp-design/*`

如果没有明确 MVP，先建议回到 `opc-mvp-designer`。

## 执行步骤

1. 解释本步目标
2. 默认一次只问一个问题；如果几个问题都很轻、彼此紧密相关，可以合并成 2 到 3 个，例如：
   - 你的目标用户最常出现在哪？
   - 你更擅长内容、私聊还是直接销售？
   - 你愿意先卖低价入口还是直接卖高客单？
3. 每轮回答后，给即时反馈
4. 生成 3 条转化路径，例如：
   - 内容 -> 私信 -> 咨询 -> 成交
   - 内容 -> 表单 -> 诊断 -> 成交
   - 低价产品 -> 升级服务
5. 说明每条路径的适用情况、优点和代价
6. 默认增加 `4. 我有自己的方案`
7. 让用户选择、组合、修改，或直接提出自己的版本
8. 用户确认后，再写入正式结果

## 输出

对话层必须包含：

1. 本步解释
2. 当前渠道与成交理解摘要
3. 3 条转化路径方案 + `4. 我有自己的方案`
4. 每个方案的适用情况、优点和代价
5. 请用户确认或修改

## 落盘检查点（阶段必须完成，不可跳过）

用户明确确认转化路径后，**立即**使用 Write 工具在文件系统上创建以下文件，然后才能进入下一阶段。在对话中描述结论不等于落盘。

**写入文件：**

- `opc-doc/outputs/07-conversion-loop/channel-strategy.md`（目标渠道选择及依据）
- `opc-doc/outputs/07-conversion-loop/content-plan.md`（内容触达方式类别，非具体选题）
- `opc-doc/outputs/07-conversion-loop/conversion-path.md`（完整转化路径：触达 → 承接 → 成交）

**更新状态文件：**

- `opc-doc/state/current-stage.json`（写入：`{"stage": "07-conversion-loop", "status": "completed", "next_stage": "08-asset-ops", "summary": "一句话主转化路径"}`）
- `opc-doc/state/decisions.json`（追加转化路径确认）

**落盘完成后，在对话中告知用户：**
> "✅ 转化闭环方案已保存。下次对话可以从资产沉淀继续。"

**只有落盘完成后，才可以提示进入 `opc-asset-ops` 或 `opc-dashboard-review`。**

## 何时调用其他 skills

只有在用户确认转化路径后，才进入 `opc-asset-ops` 或 `opc-dashboard-review`。

## 异常处理

- 如果渠道太多，帮助用户收缩到 1 到 2 个
- 如果没有线索承接动作，不算闭环
