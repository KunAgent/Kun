# `opc-doc/` 目录契约

所有 OPC skills 默认共享当前工作目录下的 `opc-doc/`。

推荐结构：

```text
opc-doc/
├── inputs/
├── state/
│   ├── current-stage.json
│   ├── decisions.json
│   └── assumptions.json
│   └── user-preferences.json
├── outputs/
│   ├── 00-orchestrator/
│   ├── 01-resource-audit/
│   ├── 02-niche-positioning/
│   ├── 03-value-proposition/
│   ├── 04-business-model/
│   ├── 05-opportunity-score/
│   ├── 06-mvp-design/
│   ├── 07-conversion-loop/
│   ├── 08-asset-ops/
│   └── 09-dashboard-review/
└── reviews/
```

通用规则：

1. 优先读已有文件，不重复提问。
2. 每个阶段都要先在对话里给摘要、解释和选择项，再写正式文件。
3. 如果有结构化结论，额外输出 `.json`。
4. 发生关键决策时更新 `decisions.json`。
5. 产生待验证假设时更新 `assumptions.json`。
6. 记录用户偏好与模式时，写入 `user-preferences.json`。
7. `opc-doc/` 不存在时，不要求预先初始化模板；由触发的 skill 按需创建最小目录。
8. 依赖上游产物的 skill，必须先检查前置文件是否存在。
9. 如果当前对话和 `opc-doc/` 都不足以支撑该阶段，直接建议先调用前置 skill，不要硬推断。
10. 重要决策默认提供 3 个候选方案，并附加 `4. 我有自己的方案`，由用户确认后再落盘。
11. 方案展示时只给分析，不给结论性推荐。

## 落盘机制（强制）

**"写入"的定义**：写入 = 使用 Write 工具在文件系统上真实创建或更新文件。在对话里描述结论不等于落盘。

**落盘触发时机**：用户明确确认当前阶段结论后（说"好的""就用这个""确认"等），立即执行落盘，不等到对话结束。

**落盘顺序**：
1. 先写各阶段 outputs 文件（内容文件）
2. 再更新 `opc-doc/state/current-stage.json`（状态文件）
3. 再更新 `opc-doc/state/decisions.json`（决策记录）

**落盘确认**：文件写入完成后，在对话中明确告知用户：
> "✅ 本阶段结论已保存到 opc-doc/。下次对话开始时可以继续从这里推进。"

**落盘失败处理**：如果写入遇到错误，不要静默跳过，要在对话中说明并重试。

## 会话恢复机制（强制）

每次新会话开始时，必须先执行以下读取步骤，再提任何问题：

1. 读取 `opc-doc/state/current-stage.json`（判断当前所在阶段）
2. 读取 `opc-doc/state/decisions.json`（了解已做的关键决策）
3. 读取当前阶段对应的 outputs 目录下的文件
4. 在对话中给用户一份"上次进度摘要"，例如：
   > "我找到了上次的记录。你目前已完成资源盘点和利基定位，确认的主利基是[X]，上次停在价值主张阶段。要继续吗？"

如果 `opc-doc/` 不存在或文件为空，视为全新开始，直接进入首轮流程。

## `current-stage.json` 格式

```json
{
  "stage": "02-niche-positioning",
  "status": "completed",
  "completed_at": "ISO 时间戳",
  "next_stage": "03-value-proposition",
  "summary": "一句话描述本阶段核心结论"
}
```
