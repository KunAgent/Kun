# 信息产权、场景包坐标与记忆仲裁

> **目的**：把「用户话 / 磁盘真值 / 系统策略」三类信息分开，避免模型把摘要、画像或场景包规则当成用户本轮新指令。与 `fbs-runtime-hints.json`、`session-resume-brief` 机读计量、`intake-router` 的 `compliance` 字段对齐。

---

## 1. 三类产权

| 类别 | 典型来源 | 处理原则 |
|------|----------|----------|
| **用户主权** | 当前气泡、当轮确认 | 最高优先级；摘要与记忆不得覆盖 |
| **世界状态** | `.fbs/`、`chapter-status.md`、已交付文件 | 以磁盘为准；变更需写入或经用户确认 |
| **系统策略** | 场景包、`SKILL.md` 流程、质检规则 | 只读引用；不冒充用户命令 |

---

## 2. 场景包坐标（单先验）

- **推断**：`intake-runtime-hooks.mjs` 的 `inferScenePackIdFromText` → `scenePackId`。
- **主规则**：`references/scene-packs/<scenePackId>.md`
- **质量补丁（L3）**：`references/scene-packs/<scenePackId>-local-rule.md`
- **首响**：不向用户朗读全文；`intake-router` JSON 的 `firstResponseContext.scenePackCoordinate` 仅提供 **相对路径锚点**，进入对应阶段再 `read_file`。

---

## 3. 记忆仲裁（冲突时听谁）

1. **用户最新明确陈述** 覆盖旧摘要与旧记忆条目。
2. **本书** `.fbs/smart-memory/` 与 **`session-exit` 原子写** 的恢复卡 / brief，优先于未落盘的闲聊推断。
3. **宿主系统级记忆**（如 `~/.workbuddy`）与本书冲突时：**以用户当轮确认 + 本书写盘** 为准（见 `fbs-runtime-hints.json` → `hostMemory`）。

---

## 4. 与上下文引擎的关系

- `runtime.contextEngine.scenePackId` 与场景包推断一致时，**压缩条数/字数上限**为该坐标下的策略；见 `scripts/lib/context-engine.mjs`。
- 若未跑 `intake-router`，`session-resume-brief.md` 顶部仍提示以 **最近一次 intake JSON** 的 `policy` 为准。
