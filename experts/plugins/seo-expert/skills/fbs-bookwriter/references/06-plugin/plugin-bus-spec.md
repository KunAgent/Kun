# Plugin Bus 协议规范 v3.0
# FBS-BookWriter × WorkBuddy 技能生态整合

> **版本**：3.0 · **日期**：2026-04-11  
> **定位**：FBS 技能生态调度层的技术协议文档  
> **适用场景**：team-lead 在各 S 阶段调用 Provider 时的标准流程

---

## 一、核心设计原则

```
FBS 专注：内容质量控制（S/P/C/B质检 / 证据驱动写作 / GLOSSARY术语锁定）
Plugin Bus 借力：三层技能生态（本地市场 > 已安装插件 > 远程发现）
```

**关键规则**：
- 调用任何技能前，**必须先检查 Tier1 本地市场**（`~/.workbuddy/skills-marketplace/skills/`）
- 本地有匹配 → `cp -r` 激活，不走网络
- Provider 调度失败时，按 Tier 顺序降级，**最终兜底到 MD/HTML**
- 每次使用技能后，**告知用户使用了哪个 Tier 的哪个技能**

---

## 二、三层技能获取协议

### 2.1 技能存在性检测

```bash
# Tier1 检测（本地市场）
ls ~/.workbuddy/skills-marketplace/skills/{skill-name}/ 2>/dev/null \
  && echo "TIER1_AVAILABLE" || echo "TIER1_NOT_FOUND"

# Tier2 检测（已安装插件）
ls ~/.workbuddy/skills/{skill-name}/ 2>/dev/null \
  && echo "TIER2_AVAILABLE" || echo "TIER2_NOT_FOUND"
```

### 2.2 技能激活协议

**Tier1 激活**（推荐：零网络延迟）：
```bash
cp -r ~/.workbuddy/skills-marketplace/skills/{skill-name} \
      {bookRoot}/.codebuddy/skills/{skill-name}
# 或直接从原路径读取 SKILL.md 调用
```

**Tier2 调用**：直接通过宿主插件系统调用已安装技能（WorkBuddy UI 可见）。

**Tier3 安装**（需网络，仅在 Tier1/Tier2 均无时）：
```bash
# 通过 find-skills 发现
# 然后按官方方式安装
```

---

## 三、Provider 状态声明格式

每个 Provider 调用结束后，向用户输出一行状态：

```
[Provider] {provider_name} ({tier_level})：{简短结果描述}
# 示例：
[Provider] deep-research (Tier1)：完成 AI Agent 主题调研，生成 23 条素材记录
[Provider] docx-delivery (Tier1→Tier2 降级)：minimax-docx 不可用，使用 docx 生成 Word
[Provider] pdf-literature (Fallback)：PDF 技能均不可用，已生成 HTML，建议浏览器打印
```

---

## 四、S 阶段 × Provider 调度速查表 v3.0

| S阶段 | 核心 Provider (Tier1) | 辅助 (Tier1) | 可选 (Tier1) | 全部不可用兜底 |
|-------|---------------------|-------------|-------------|-------------|
| **S0** | deep-research + multi-search | citation-manager | wechat-search + pdf-literature | 纯 web_search 摘要 |
| **S1** | —（MD规划） | xlsx-data | — | 只有文本大纲 |
| **S2** | —（MD Brief） | — | pptx-delivery（deck-generator） | 无法会议展示 |
| **S3** | FBS 内置（写作核心） | citation-provider | xlsx / pdf | 手动管理引用 |
| **S4** | FBS 内置（P/C/B并行） | quality-panel（content-ops） | xlsx-data + docx-delivery | 只有 JSON 报告 |
| **S5** | docx-delivery（minimax-docx） | pdf-literature（minimax-pdf） | pptx + xlsx | 只有 MD+HTML |
| **S6** | 按转化类型选择（见下） | — | 全部可选 Provider | 只有 MD 摘要 |

### S6 转化类型 → Provider 映射

| 转化类型 | 首选 Provider (Tier1) |
|---------|---------------------|
| 白皮书/正式文档 | docx-delivery (minimax-docx) |
| 培训课件/演讲 PPT | pptx-delivery (deck-generator) |
| 数据分析报告 | xlsx-data (minimax-xlsx) |
| 社交媒体分发 | content-transform (content-factory) |
| 学习产品（播客/测验/思维导图） | learning-products (notebooklm-studio) |
| 书名/文案进化优化 | copy-optimizer (autoresearch) |
| 质量打磨（第三方视角） | quality-panel (content-ops) |

---

## 五、Provider 错误处理协议

### 5.1 三级错误处理

```
L1（技能不存在）→ 自动切换下一 Tier，告知用户已降级
L2（技能执行报错）→ 记录错误，切换 Tier，不终止书稿流程
L3（所有 Tier 均失败）→ 使用 Fallback，明确告知用户当前能力边界
```

### 5.2 错误通报格式（三段式）

```
1. 发生了什么：{Provider名} (Tier{N}) 执行失败，原因：{简短原因}
2. 影响是什么：{对当前阶段的影响评估}
3. 建议怎么做：{已自动降级到 Tier{N+1} / 使用 Fallback / 建议用户操作}
```

禁止说"抱歉"、"对不起"；直接给解决方案。

---

## 六、本地市场技能安装记录

当 team-lead 从本地市场激活某个技能时，记录到 `.fbs/provider-activations.jsonl`：

```json
{"ts":"ISO8601","provider":"deep-research","tier":1,"action":"cp_from_marketplace","bookRoot":"...","status":"activated"}
```

此记录用于：
- 防止重复激活（幂等性保证）
- 会话快照（workbuddy-resume.json）中记录当前已激活 Provider 列表
- 下次会话恢复时直接加载已激活 Provider，无需重新检测
