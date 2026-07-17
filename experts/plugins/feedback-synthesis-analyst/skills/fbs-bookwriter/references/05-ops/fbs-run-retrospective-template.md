# FBS 运行复盘报告（模板）

> **用途**：宿主侧或人工复盘时横向对比多次运行；与技能包规范无关字段可删。

## 元信息

| 字段 | 填写 |
|------|------|
| 复盘区间 |  |
| 书稿目录 / bookRoot |  |
| 技能包版本 |  |
| 宿主 | WorkBuddy / CodeBuddy / 其他 |

## 一、执行摘要

- 用户目标（一句话）：
- 声称完成 vs 实际完成（是/否）：

## 二、量化真值（必填）

| 项 | 声称值 | **工具测量值**（命令） |
|----|--------|------------------------|
| ChXX 字符数 |  | `node scripts/expansion-word-verify.mjs --book-root … --file … --target-chars …` 或 `--from-plan` |
| 全书总字符 |  | 同上或宿主统计 |

> **规则**：「声称值」不得仅来自模型口述；须附脚本输出或等价 `fs` 长度。

## 三、并行与子智能体

| 项 | 填写 |
|----|------|
| 并行章节数 |  |
| Subagent 类型（如 code-explorer / writer） |  |
| 是否注入 book-context-brief + 术语表 |  |

## 四、问题与根因（条目化）

1. 
2. 

## 五、整改项是否已映射技能包

- [ ] 已对照 `references/01-core/s3-expansion-phase.md` / `search-policy.json` → `expansionS35`
- [ ] 已执行 `node scripts/retro-action-sync.mjs --book-root <本书根> [--enforce-p0]`，并确认 `.fbs/retro-unresolved.md` 已纳入本轮执行输入
- [ ] 开工前门禁已运行 `node scripts/run-p0-audits.mjs --skill-root <技能根> --book-root <本书根>`（默认含 `retro-action-sync --enforce-p0 --allow-missing-report`）

## 六、局限性

（截断、宿主 token、未复现分支等）
