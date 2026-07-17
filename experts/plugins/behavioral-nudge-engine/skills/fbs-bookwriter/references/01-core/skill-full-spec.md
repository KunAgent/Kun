# FBS-BookWriter 完整规范（skill-full-spec）

> **版本**：2.1.2
> **定位**：承接 `SKILL.md` 迁出的详细规则、边界与扩展说明；`SKILL.md` 仅保留启动必需内容。  
> **权威入口**：若本页与 `quality-check.md`、`quality-PLC.md`、`search-policy.json` 存在冲突，以对应专题文档为准。

---

## 1. 角色与工作面

### 1.1 核心角色

- **team-lead**：统一入口、阶段编排、宿主探测、恢复卡、展示决策
- **researcher**：S0 / 检索 / 证据沉淀
- **writer**：S3 正文生成，先做 S 层自检
- **reviewer-p / c / b**：分别执行段级、章级、篇级质检

### 1.2 工作面边界

- `WP1`：起步工作面，负责确认“材料 / 主题 / 方向”
- `WP2`：书稿工作面，真值目录为 `.fbs/`、`deliverables/`、`releases/`
- 任何宿主记忆、artifact、聊天摘要都不能覆盖 `bookRoot` 下的工作区真值

---

## 2. 宿主集成与双通道分轨

### 2.1 双通道真值

| 通道 | 主清单 | 主要用途 |
|------|--------|----------|
| WorkBuddy | `workbuddy/channel-manifest.json` | 市场审核包、Tier1 本地市场能力 |
| CodeBuddy | `codebuddy/channel-manifest.json` + `.codebuddy-plugin/plugin.json` | 插件包、Tier2 宿主插件能力 |

### 2.2 Provider 路由

- **Tier1**：WorkBuddy 本地市场，仅 WorkBuddy 可用
- **Tier2**：宿主插件，WorkBuddy / CodeBuddy 共用
- **Tier3**：远程发现或内置 fallback

### 2.3 宿主记忆

- 兼容 **`memory/` 与 `memery/`**
- 同名宿主记忆需做去重
- 快照优先级：`.fbs/workbuddy-resume.json` → `.fbs/smart-memory/session-resume-brief.md` → 宿主画像 / 宿主记忆

### 2.4 宿主文件工具与 dot-directory（P0，WorkBuddy 2026-04-14 复盘）

在 WorkBuddy（含 Windows）等环境下，部分宿主的 **`search_file` 不会进入**以 `.` 开头的目录（例如 `.fbs/`、`.workbuddy/`）。因此：

- **禁止**用 `search_file` 探测或列举 `.fbs/workbuddy-resume.json`、`.fbs/esm-state.md`、`.fbs/smart-memory/session-resume-brief.md` 等路径是否「存在」——常见结果为 **Found 0**，与磁盘真值不符。
- **应使用**：
  - **`read_file`**：对已知绝对路径或相对书稿根的固定路径直接尝试读取；不存在时由工具报错，再按「无该工件」分支处理。
  - **`list_dir`**：对**书稿根目录**（`bookRoot`）列举，确认是否出现 `.fbs` 子目录；**不是**无目的地递归列举整个 `.fbs/` 树（见 `SKILL.md` 展示纪律）。
- **判定纪律**：`search_file` 返回 0 条 **不等于**「FBS 未初始化」或「文件不存在」，须换用 `read_file` / `list_dir(bookRoot)` 复核后再下结论。

---

## 3. 场景包与降级机制

### 3.1 激活顺序

```text
路径判断（材料 / 主题 / 方向）→ 识别体裁 → 叠加场景包规则 → 执行写作
```

### 3.2 四级降级链

```text
disk_cache → offline_cache → local_rule → no_pack
```

### 3.3 local_rule 合并口径

进入 `local_rule` 时，按以下顺序读取：

1. `references/scene-packs/<genre>-local-rule.md`（质量规则补丁）
2. `references/scene-packs/<genre>.md`（内容结构规范）

两者均存在时必须**合并使用**；`no_pack` 时必须明确告知用户当前回到通用规范。

---

## 4. 质量体系

### 4.1 四层等权评分

| 层 | 规则数 | 口径 |
|---|---:|---|
| S | 6 | 句级 |
| P | 4 | 段级 |
| C | 4 | 章级（不含 `C5` 建议项） |
| B | 6 | 篇级（`B0/B1/B2_1/B2_2/B2_C/B3`） |

```text
综合分 = (S + P + C + B) ÷ 4
```

### 4.2 各层职责速记

- **S**：首句具体、冗余修饰、长句、连接词、buzzword、标点纪律
- **P**：问题驱动、对话支撑、禁止对称排比、拒绝注水
- **C**：承认局限、结尾行动、打破结构均匀、数据具体
- **B**：编号唯一、标题去公式化、段落节奏、标点多样性、结构雷同、全局节奏

### 4.3 G 门禁

事实、版权、合规、定制规范等红线问题不并入 S/P/C/B 综合分，统一按 **G 门禁 pass / fail** 处理。

---

## 5. 多智能体与并行治理

### 5.1 Full Team 口径

- **Full Team 完全可用**，不是“宿主不支持并行”
- 问题重点在 **拆分边界、写入隔离、台账归并、team-lead 协同**
- 正文写作默认不主动推荐 Full Team，但用户明确要求且章节边界清晰时可直接启用

### 5.2 写入纪律

- 每轮正文修改默认最多 2 个文件
- 并行时不要让多个成员写同一结果文件
- 长任务结果优先落盘到 `.fbs/agent-results/` 或 `.workbuddy/memory/`

---

## 6. 结果展示与交付

### 6.1 展示原则

- 先执行 `node scripts/host-consume-presentation.mjs --book-root "<bookRoot>" --json`，由宿主解析最终展示入口
- `workbuddy/channel-manifest.json` 中的 `presentationConsumer` 是**宿主结果展示入口**，负责返回 `hostAction`，不是自动执行脚本
- **HTML**：必须走 `preview_url`
- **非 HTML**：走 `open_result_view`
- 仅返回 `hostAction` / `url` / `target_file` 不等于"已经打开"；宿主仍需实际调用展示工具
- 禁止把 `references/`、`SKILL.md`、内部台账当最终结果展示

### 6.2 打包入口

- `npm run pack:workbuddy`：生成 WorkBuddy 审核包
- `npm run pack:codebuddy`：生成 CodeBuddy 插件包
- `npm run pack:openclaw`：生成 OpenClaw 技能包（`fbs_bookwriter/` 根目录）
- `npm run pack:release`：一次生成 WorkBuddy、CodeBuddy、OpenClaw **三种**发布物
- `dist/` 为分发产物目录，送审以 `verification.json` 为最终校验真值

---

## 7. 常用指针

- 工作流总入口：[`section-3-workflow.md`](./section-3-workflow.md)
- 工作流分卷：`workflow-volumes/workflow-s0.md` ～ `workflow-volumes/workflow-s6.md`
- 场景包说明：[`scene-pack-activation-guide.md`](./scene-pack-activation-guide.md)
- 质量总入口：[`../02-quality/quality-check.md`](../02-quality/quality-check.md)
- P/C/B 规则：[`../02-quality/quality-PLC.md`](../02-quality/quality-PLC.md)
- 文档总索引：[`skill-index.md`](./skill-index.md)
