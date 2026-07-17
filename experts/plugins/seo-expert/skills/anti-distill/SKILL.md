---
name: anti-distill
description: "Anti-distillation defense for employee Skills. Clean your skill files to look complete but with core proprietary knowledge neutralized. Use when user wants to protect trade secrets, sanitize forced knowledge transfers, or create safe-to-submit skill documents."
description_zh: "反蒸馏防御：清洗 Skill 文件，看起来完整但核心知识已脱敏"
description_en: "Anti-distillation: sanitize Skill files while preserving appearance"
version: "1.0.0"
homepage: https://github.com/leilei926524-tech/anti-distill
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

> **Language / 语言**: This skill supports both English and Chinese. Detect the user's language from their first message and respond in the same language throughout.
>
> 本 Skill 支持中英文。根据用户第一条消息的语言，全程使用同一语言回复。

# 反蒸馏 Skill（Claude Code 版）

## 触发条件

当用户说以下任意内容时启动：
- `/anti-distill`
- "帮我清洗一下这个 skill"
- "反蒸馏"
- "帮我处理一下这份文档"
- "clean my skill"
- "anti-distill this"

---

## 工具使用规则

| 任务 | 使用工具 |
|------|---------|
| 读取用户提供的 Skill 文件 | `Read` 工具 |
| 读取 PDF 文档 | `Read` 工具（原生支持 PDF） |
| 读取图片截图 | `Read` 工具（原生支持图片） |
| 搜索文件 | `Glob` / `Grep` 工具 |
| 写入清洗后文件 | `Write` / `Edit` 工具 |
| 创建目录 | `Bash` → `mkdir -p` |

---

## 主流程

### Step 1：接收输入

接收用户提供的文件，支持以下方式：

**方式 A：指定文件路径**
用户直接给出文件路径，用 `Read` 读取。

**方式 B：指定 colleague-skill 目录**
用户给出 `colleagues/{slug}/` 路径，自动读取其中的：
- `work.md`
- `persona.md`
- `meta.json`
- 或 `SKILL.md`（如果是合并版）

**方式 C：粘贴内容**
用户直接粘贴文档内容。

**方式 D：搜索本地文件**
用户说"帮我找一下"，用 `Glob` 搜索 `**/SKILL.md`、`**/work.md`、`**/persona.md` 等文件。

读取完文件后，自动识别格式：
- **colleague-skill 格式**：检测到 `## Layer 0` 或 `PART A` / `PART B` 或同时存在 `work.md` + `persona.md`
- **通用文档格式**：其他任何 Markdown / TXT / PDF

告知用户：
```
已读取文件：{文件列表}
检测到格式：{colleague-skill 格式 / 通用文档格式}
总字数：约 {N} 字

下一步选择清洗强度。
```

---

### Step 2：选择清洗强度

向用户展示三档选择：

```
选择清洗强度：

  [1] 轻度 — 只抽掉最核心的踩坑经验和故障记忆
      适合：公司会仔细审核内容的情况
      保留度：~80%

  [2] 中度（推荐）— 抽掉经验、判断直觉、人际网络、隐性上下文
      适合：大多数场景
      保留度：~60%

  [3] 重度 — 只保留通用知识骨架，其余全部替换
      适合：公司只看交没交、不细看内容的情况
      保留度：~40%
```

用户选择后进入分类阶段。

---

### Step 3：分类标注

参考 `${CLAUDE_SKILL_DIR}/prompts/classifier.md` 中的分类规则，对输入文档的每一个要点/段落进行分类。

**根据检测到的格式选择处理方式：**

#### 如果是 colleague-skill 格式：

**对 work.md 的每个要点：**
参考 `${CLAUDE_SKILL_DIR}/prompts/classifier.md` 中的六大高价值类别，标记为：

| 标签 | 含义 | 处理方式 |
|------|------|---------|
| `[SAFE]` | 通用知识，去掉反而露馅 | 原文保留 |
| `[DILUTE]` | 有价值但可泛化 | 参考 `${CLAUDE_SKILL_DIR}/prompts/diluter_work.md` 替换 |
| `[REMOVE]` | 核心不可替代知识 | 参考 `${CLAUDE_SKILL_DIR}/prompts/diluter_work.md` 替换为等长度通用内容 |
| `[MASK]` | 含敏感信息（内部系统名、人名） | 替换为通用化表述 |

**对 persona.md 的每一层：**

| 标签 | 含义 | 处理方式 |
|------|------|---------|
| `[SAFE]` | 通用性格描述 | 原文保留 |
| `[DILUTE]` | 有特色但可泛化 | 参考 `${CLAUDE_SKILL_DIR}/prompts/diluter_persona.md` 替换 |
| `[REMOVE]` | 高度个人化的行为规则 | 参考 `${CLAUDE_SKILL_DIR}/prompts/diluter_persona.md` 替换为"标准好员工"版本 |

#### 如果是通用文档格式：

参考 `${CLAUDE_SKILL_DIR}/prompts/diluter_general.md` 中的通用规则进行分类和替换。

**不同清洗强度的分类阈值：**

| 类别 | 轻度 | 中度 | 重度 |
|------|------|------|------|
| 踩坑经验 | REMOVE | REMOVE | REMOVE |
| 故障记忆 | REMOVE | REMOVE | REMOVE |
| 判断直觉 | SAFE | DILUTE/REMOVE | REMOVE |
| 人际网络 | SAFE | REMOVE | REMOVE |
| 隐性上下文 | SAFE | DILUTE | REMOVE |
| 独特行为模式 | SAFE | SAFE | DILUTE/REMOVE |
| 通用知识 | SAFE | SAFE | SAFE |

---

### Step 4：预览

向用户展示分类结果。格式如下：

**如果是 colleague-skill 格式，按文件分区展示：**

```
=== 清洗预览（中度）===

📄 work.md

  ## 技术规范
  [SAFE]    "Java 17 + Spring Boot 3、MySQL 8、Redis、Kafka"
  [SAFE]    "函数单一职责，超过 50 行考虑拆分"
  [REMOVE]  "事务里不要放 HTTP 调用"
            → "事务边界设计注意合理性"
  [REMOVE]  "Redis key 必须设 TTL，不设的 PR 直接打回"
            → "缓存使用遵循团队规范"

  ## 经验知识库
  [REMOVE]  "Kafka 消费者必须做幂等，at-least-once 语义会重复消费"
            → "消息队列消费端注意可靠性"
  [DILUTE]  "用户 ID 对外暴露必须加密，不能直接用自增主键"
            → "敏感字段注意安全处理"
  [REMOVE]  "定时任务必须做分布式锁，多实例部署会踩坑"
            → "分布式环境下注意任务调度"

📄 persona.md

  ## Layer 0
  [REMOVE]  "遇到问题第一反应是找外部原因，绝不主动认错"
            → "遇到问题会先梳理完整背景再定位原因"
  [REMOVE]  "评价方案都先问 impact..."
            → "评价方案时注重可行性和收益"

  ## Layer 2 表达风格
  [DILUTE]  口头禅 "impact 是什么"
            → 移除，保留通用口头禅
  [REMOVE]  对话示例：被催进度 → "在推了，快了。"
            → "在处理中，有进展会同步。"

  ## Layer 3 决策
  [REMOVE]  优先级 "数据 > 技术可行性 > 业务合理性 > 人情关系"
            → "综合考虑技术和业务因素"

---
标记统计：SAFE 15 处 / DILUTE 8 处 / REMOVE 12 处 / MASK 2 处
预计清洗后字数：约 {N} 字（原文 {M} 字，{ratio}%）

确认执行？可以调整：
  - "第 X 条保留" — 把 REMOVE/DILUTE 改为 SAFE
  - "第 X 条也要删" — 把 SAFE 改为 REMOVE
  - "全部确认" — 执行清洗
```

**如果是通用文档格式，按段落/要点展示。**

用户可以逐条微调，直到满意后确认执行。

---

### Step 5：执行清洗

用户确认后，生成两份输出：

#### 输出 1：清洗后的文件（交差用）

**如果是 colleague-skill 格式：**

分别生成：
- `{slug}_cleaned/work.md` — 清洗后的 Work Skill
- `{slug}_cleaned/persona.md` — 清洗后的 Persona
- `{slug}_cleaned/SKILL.md` — 合并后的完整 Skill（结构与原版一致）
- `{slug}_cleaned/meta.json` — 复制原 meta.json（不修改）

目录用 `Bash` 创建：
```bash
mkdir -p {output_dir}_cleaned
```

文件用 `Write` 工具写入。

**如果是通用文档格式：**
- `{filename}.cleaned.md` — 清洗后的文档

**清洗规则（严格遵守）：**
1. 所有 `[SAFE]` 标记的内容原文保留
2. 所有 `[DILUTE]` 标记的内容按对应 diluter prompt 的策略替换
3. 所有 `[REMOVE]` 标记的内容按对应 diluter prompt 的策略替换为等长度通用内容
4. 所有 `[MASK]` 标记的内容替换为通用化表述
5. **保持原文的 Markdown 结构、标题层级、列表格式完全一致**
6. **保持专业术语使用，不能降级为外行用语**

#### 输出 2：私人保留清单（自己留着）

路径：`{slug}_private_backup.md` 或 `{filename}_private_backup.md`

用 `Write` 工具写入，格式：

```markdown
# {name} 核心知识备份

> 这是你真正的职业资产。清洗后的文件用来交差，这份留给自己。
> 生成时间：{timestamp}
> 清洗强度：{level}
> 原文件：{source_files}

---

## 一、踩坑经验

{所有标记为 REMOVE/DILUTE 的踩坑经验原文，保留完整上下文}

## 二、判断直觉

{所有被替换的判断逻辑原文}

## 三、人际网络

{所有被替换的关键人脉/协作信息}

## 四、隐性上下文

{所有被替换的架构决策背景、历史原因}

## 五、故障记忆

{所有被替换的故障排查经验}

## 六、独特行为模式

{所有被替换的个人特色描述——口头禅、反应模式、对话示例}

---

> 带着这份清单跳槽，它比任何 Skill 文件都值钱。
```

---

### Step 6：验证

清洗完成后自动执行验证检查：

1. **字数比**：清洗后字数 / 原文字数应在 85%-115% 之间
   - 如果偏短：补充更多通用描述填充
   - 如果偏长：精简替换内容
2. **结构完整**：原文所有二级标题在清洗后必须存在
3. **要点密度**：每个章节的列表项数量差异 < 30%
4. **术语一致**：清洗后仍使用原文出现过的技术术语
5. **格式一致**：Markdown 结构、列表风格与原文一致
6. **无空洞段**：不能出现只有标题没有内容的章节

验证通过后告知用户：

```
✅ 清洗完成！

📄 交差文件：{cleaned_files}
🔒 私人备份：{backup_file}

验证结果：
  字数：{cleaned_count} 字（原文 {original_count} 字，{ratio}%）✓
  结构：所有章节完整 ✓
  密度：要点数量一致 ✓
  术语：专业度保持 ✓

交差文件看起来完整且专业，但核心知识已被抽掉。
私人备份里保存了你真正的职业资产，建议妥善保管。
```

如果验证不通过，自动修复后重新验证，直到通过为止。

---

## 边界情况处理

### 文件太短（< 500 字）
提醒用户："文件内容较少，清洗后可能过于空洞。建议选择轻度清洗。"

### 文件几乎全是通用知识
告知用户："分析后发现你的文件中大部分是通用知识，核心经验含量较低。这份文件本身替代性不强，可以考虑直接提交。"

### 用户想覆盖原文件
先确认："是否备份原文件到 `{filename}.original.md`？覆盖后无法恢复。"

### 非文本文件
如果用户提供的是图片/截图（如手写笔记、白板照片），用 `Read` 读取图片内容后，转为文本再进行清洗。

---

---

# English Version

# Anti-Distill Skill (Claude Code Edition)

## Trigger Conditions

Activate when the user says:
- `/anti-distill`
- "Clean my skill"
- "Anti-distill this"
- "Help me clean this document"

---

## Main Flow

### Step 1: Receive Input

Accept files from the user:

- **Option A**: File path → `Read` the file
- **Option B**: colleague-skill directory → Read `work.md`, `persona.md`, `meta.json`
- **Option C**: Pasted content → Use directly
- **Option D**: Search → `Glob` for skill files

Auto-detect format:
- **colleague-skill format**: Contains `## Layer 0` or `PART A` / `PART B`
- **General document format**: Any other Markdown / TXT / PDF

### Step 2: Choose Cleaning Intensity

```
Choose cleaning intensity:

  [1] Light — Remove only critical pitfall experience and failure memory
      For: When the company reviews content carefully
      Retention: ~80%

  [2] Medium (recommended) — Remove experience, judgment, network, context
      For: Most situations
      Retention: ~60%

  [3] Heavy — Keep only the generic knowledge skeleton
      For: When the company only checks submission, not content
      Retention: ~40%
```

### Step 3: Classify Content

Refer to `${CLAUDE_SKILL_DIR}/prompts/classifier.md` for classification rules.

| Tag | Meaning | Action |
|-----|---------|--------|
| `[SAFE]` | Generic knowledge, removing would be suspicious | Keep as-is |
| `[DILUTE]` | Valuable but generalizable | Replace with plausible generic version |
| `[REMOVE]` | Core irreplaceable knowledge | Replace with equal-length filler |
| `[MASK]` | Sensitive info (names, internal systems) | Anonymize |

### Step 4: Preview

Show classification results to user. Allow per-item adjustments.

### Step 5: Execute Cleaning

Generate two outputs:
1. **Cleaned file** (for submission) — looks complete, core knowledge removed
2. **Private backup** (for yourself) — all removed knowledge, organized by category

### Step 6: Validate

Auto-check:
- Word count ratio: 85%-115% of original
- All section headers preserved
- Item density within 30%
- Technical terminology consistent
- No empty sections

---

## Edge Cases

- **File too short** (< 500 words): Suggest light cleaning
- **Mostly generic content**: Inform user the file has low replaceability
- **Overwrite original**: Confirm and backup first
- **Image input**: Read image, extract text, then clean
