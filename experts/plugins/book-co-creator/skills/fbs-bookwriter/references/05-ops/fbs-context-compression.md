# 上下文压缩策略（P1 B1）

## 双轨语境（首响 vs 写作中）

| 层级 | 对应行为 | 目的 |
|------|----------|------|
| **首响层** | `intake-router` 默认快速路径、`contextEngine` 截断 `info`/`warnings` | 防爆窗、首响可交互；对标「网关卫生」思想 |
| **写作层** | 长回合对话、章级讨论、结构化写入 `session-resume-brief` | 主策略；依赖磁盘真值与摘要前缀，不重复灌 SKILL 全文 |

二者阈值与职责不同是**刻意设计**：首响求快，写作求稳。

---

长会话时，优先使用**磁盘真值**而非重复注入全文：

1. **不要**在单轮内重复 `read_file SKILL.md`（见 SKILL 速查卡）。
2. **优先读**：`.fbs/workbuddy-resume.json`、`.fbs/smart-memory/session-resume-brief.md`、`chapter-status.md`。
3. **跨轮摘要**：超长章节讨论前，将「术语锁定、待办、用户约束」写入 `session-resume-brief` 或 `writing-notes` 下的 brief，再进入下一章。
4. **宿主记忆**：仅存短摘要与可检索条目；与本书冲突时以 **`.fbs/` 写盘** 与用户最新陈述为准（见 `runtime-mandatory-contract`）。

---

## 长会话结构化摘要（可选，P2）

超长对话（如 30 分钟以上）除恢复卡外，可在 **`session-exit` 前后**由 Agent 将**关键决策**写入 `.fbs/smart-memory/session-resume-brief.md` 或 `writing-notes/` 下 brief，建议包含：

- 已确认：**书名、目标读者、体量、目录粒度**（及白皮书/书籍取向若已选）。
- **已产生/变更的文件路径**（大纲、素材索引等）。
- **未决问题**（例如白皮书版式细则待填）。
- **用户偏好**（偏好「先确认再执行」、接受 AI 推荐等，仅记可复用策略，不记临时闲聊）。

机读示例（可嵌入 front matter 或 JSON 块，非强制 schema）：

```json
{
  "sessionRef": "可选-宿主会话 id",
  "decisions": ["确认书名：《…》", "目录从 9 章改为白皮书 8 章"],
  "openIssues": ["白皮书封面与品牌规范待确认"],
  "userPreferencesHint": { "batchConfirm": true }
}
```
