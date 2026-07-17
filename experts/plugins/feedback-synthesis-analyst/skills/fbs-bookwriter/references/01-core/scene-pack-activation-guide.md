# 场景包激活与执行指南（用户侧摘要）

> **版本**：2.1.2
> **P0-4 修复说明**：本文件补充了原 `references/01-core/` 中完全缺失的场景包执行规范（用户侧），解决用户侧文档断层问题。  
> **详细企业侧规范**：见 `references/04-business/`（企业版授权，本包不含）。  
> **场景包兜底规范**：见 `references/scene-packs/`（随 Skill 发布的降级第3级内置规范）。

---

## 场景包是什么

**场景包**是按写作垂直场景定制的规则集合，包含体裁规范、质量标准、术语词表、章节模板等，覆盖特定领域的写作惯例和交付格式要求。当前版本内置 **8个场景包**：

| 包名 | 场景 | 激活方式 |
|------|------|---------|
| `general` | 通用书籍/知识类 | **内置，无需授权码，默认激活** |
| `genealogy` | 家谱/家史 | 说"写家谱"或"家族史"即自动匹配 |
| `consultant` | 顾问/咨询报告 | 说"写顾问报告"或"咨询白皮书" |
| `ghostwriter` | 代撰/影子写作 | 说"代写"或"帮我写" |
| `training` | 培训教材/课程 | 说"写培训手册"或"课程讲义" |
| `personal-book` | 个人传记/回忆录 | 说"写自传"或"个人故事" |
| `whitepaper` | 白皮书/研究报告 | 说"写白皮书"或"行业报告" |
| `report` | 调查报告/深度报道 | 说"写调查报告"或"深度报道" |

---

## 场景包激活流程（用户侧）

### 自动激活（推荐）

AI 会根据你的描述**自动识别目标体裁**，无需手动指定：

```
用户：「我想写一本白皮书，关于AI在制造业的应用」
  → AI 先识别目标体裁为 whitepaper
  → 若当前已完成在线校验/满足门槛，则加载 whitepaper 增强规则
  → 若未完成校验、门槛不足或远端不可达，则明确告知并回退 general
```

> **注意**：自动识别只代表“知道你想写什么”，不代表增强场景包已经无条件生效。离线基础版与在线增强版的差异，见 [`offline-online-upgrade-guide.md`](./offline-online-upgrade-guide.md)。

### 手动指定

如需强制使用特定场景包，在对话中明确说明：

```
用户：「用家谱场景包，帮我整理我家的家族历史」
  → 激活 genealogy 场景包
  → 按家谱体裁规范展开：家族溯源、世系图、人物传记等
```

### 场景包与路径 A/B/C 的关系

场景包在路径判断**之后**叠加，不影响路径选择逻辑：

```
路径判断（有无素材/主题）→ 路径 A/B/C → 叠加场景包规则 → 执行写作
```

---

## 降级机制（四级降级链）

当场景包无法正常加载时，按以下顺序降级：

| 级别 | 触发条件 | 行为 |
|------|---------|------|
| 1️⃣ disk_cache | 场景包服务暂时不可达 | 使用本地磁盘缓存（24小时内有效） |
| 2️⃣ offline_cache | 无网络 | 使用离线缓存版本 |
| 3️⃣ local_rule | 缓存也失效 | 先读 `references/scene-packs/<包名>-local-rule.md`（质量规则补丁），再叠加 `references/scene-packs/<包名>.md`（内容规范）；两者均存在时合并使用 |
| 4️⃣ no_pack | 所有降级均失败 | **明确告知用户"当前以通用规范执行，场景包不可用"**，不静默降级 |

> **承诺**：任何降级都会明确告知，不会静默切换；no_pack 状态下仍可正常写作，只是缺少垂直场景定制规则。

### L3 降级路径详解（v2.1.1 收口）

进入 L3 时，运行时按以下顺序读取并合并规则：

```
1. references/scene-packs/<包名>-local-rule.md   ← 体裁感知质量规则补丁（Q层叠加）
2. references/scene-packs/<包名>.md              ← 内容结构规范（S0要素 / S2大纲 / 检索策略等）
3. 合并后统一写入 .fbs/scene-pack-status.json  ← 供后续阶段读取当前降级状态
```

**合并口径**：`-local-rule.md` 优先提供质量补丁，主文件继续提供内容结构、初始化问题、大纲和检索建议；两者并存时不是二选一，而是**叠加使用**。

**各场景包 L3 文件位置**：


| 场景包 | local-rule 文件 | 内容规范文件 |
|--------|----------------|-------------|
| general | `scene-packs/general-local-rule.md` | `scene-packs/general.md` |
| genealogy | `scene-packs/genealogy-local-rule.md` | `scene-packs/genealogy.md` |
| consultant | `scene-packs/consultant-local-rule.md` | `scene-packs/consultant.md` |
| ghostwriter | `scene-packs/ghostwriter-local-rule.md` | `scene-packs/ghostwriter.md` |
| training | `scene-packs/training-local-rule.md` | `scene-packs/training.md` |
| personal-book | `scene-packs/personal-book-local-rule.md` | `scene-packs/personal-book.md` |
| whitepaper | `scene-packs/whitepaper-local-rule.md` | `scene-packs/whitepaper.md` |
| report | `scene-packs/report-local-rule.md` | `scene-packs/report.md` |

**L3 告知规范**：降级至 L3 时，须在响应开头输出场景包对应的"L3 离线告知模板"（见各 local-rule 文件末尾），明确说明可用能力范围。

---

## local-rule 编写规范

### 必备章节

每个 `references/scene-packs/*-local-rule.md` 至少应包含以下 5 段：

1. **适用范围**：说明该 local-rule 绑定的体裁、典型触发词与适用边界。
2. **质量补丁**：明确覆盖哪些 `S/P/C/B` 规则、阈值或额外门禁。
3. **内容约束**：补充该体裁特有的章节结构、素材要求、禁写项或术语约束。
4. **降级说明**：描述 local-rule 与主场景包文件的叠加关系，避免被误当成完整场景包替代物。
5. **L3 离线告知模板**：提供一段用户可见话术，说明当前为离线 / 降级执行。

### 推荐模板

```markdown
# <场景名> local-rule

## 适用范围
- 体裁：
- 触发词：
- 不适用边界：

## 质量补丁
- S层：
- P/C/B层：
- 额外门禁：

## 内容约束
- 章节结构：
- 素材 / 数据要求：
- 禁写项：

## 与主场景包的关系
- 主文件负责：
- local-rule 负责：
- 合并顺序：local-rule → 主文件

## L3 离线告知模板
- 当前以 <场景名> local-rule 离线执行，已启用的能力有：...
```

### 命名与边界

- 文件名固定为 `references/scene-packs/<包名>-local-rule.md`。
- `local-rule` 只负责**质量补丁与降级兜底**，不应复制主场景包全文。
- 若体裁需要额外术语表、模板或案例，应在主文件中索引，由 local-rule 只保留最小必要规则。

---

## 场景包与质量标准


启用场景包后，S/P/C/B 质检体系会叠加场景包专属标准：
- `general`：通用中文长文档标准
- `whitepaper/report`：学术引用格式、数据来源标注、摘要必填
- `genealogy`：人名/时间一致性、家族关系逻辑自洽
- 其他场景包：见各包专属规范（企业版授权用户可访问）

