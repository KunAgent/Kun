# 智能记忆架构说明

> **版本**：2.1.1  
> **状态**：🟢 **主链已落地，宿主桥接为可选增强，宿主融合记忆已并入 v2.1.1 主入口**  
> **本文用途**：澄清当前仓库中"智能记忆"相关脚本的**主真值、层级关系、入口约定**，避免继续出现文档与实现多套并存。  
> **v2.1.0 补充**：WorkBuddy 记忆能力审计结论（6个缺陷 D1-D6）+ 宿主融合增强路线图（E1-E14）

---

## 架构结论（先看这一节）

当前仓库里与"智能记忆"相关的能力，应按 **三层 + 若干相邻模块** 理解：

### 1. 核心真值层

- **主入口**：`scripts/smart-memory-core.mjs`
- **职责**：
  - 定义 `.fbs/smart-memory/memory.json` 的核心数据结构
  - 负责确定性动作：`reset / decouple / check-boundary / analyze-wb / create-milestone / cleanup / export`
  - 负责"千人千面"架构中的用户画像层、学习特征层、应用层、整理分析层
- **结论**：凡是涉及**数据结构、持久化、边界控制、里程碑管理**，都以 `smart-memory-core.mjs` 为准

### 2. 交互包装层

- **主入口**：`scripts/smart-memory-natural.mjs`
- **职责**：
  - 把"重置记忆 / 查看风格 / 脱离个性化 / 分析环境"这类自然语言指令映射到记忆操作
  - 提供更适合宿主对话交互的命令入口
- **结论**：`smart-memory-natural.mjs` 是**交互层包装**，不是底层数据结构真值源

### 3. 项目初始化编排层

- **主入口**：`scripts/init-project-memory.mjs`
- **职责**：
  - 初始化项目级记忆工件
  - 串联 `apply-book-memory-template.mjs`、`generate-book-context-index.mjs`
  - 在**宿主可选桥接脚本存在时**，追加 WorkBuddy 摘要 / 环境快照输出
- **结论**：它是**编排器**，不是记忆内核

### 4. 宿主可选桥接层

- **可选脚本**：
  - `workbuddy-memory-digest.mjs`
  - `workbuddy-environment-snapshot.mjs`
- **职责**：
  - 把宿主侧（如 WorkBuddy）的用户档案、环境信息整理成适合本书工程读取的摘要
  - 生成 `.fbs/workbuddy-memory-digest.json`、`.fbs/workbuddy-environment.json`
- **结论**：这两项属于**宿主桥接增强能力**，允许缺省，不应被误解为本 skill 的内核主入口

---

## 当前推荐分层

| 层级 | 主文件 | 是否主真值 | 说明 |
|------|--------|------------|------|
| 核心真值层 | `smart-memory-core.mjs` | 是 | 定义数据结构与确定性动作 |
| 交互包装层 | `smart-memory-natural.mjs` | 否 | 自然语言命令入口 |
| 项目初始化编排层 | `init-project-memory.mjs` | 否 | 初始化项目级工件，按需串联桥接脚本 |
| 宿主可选桥接层 | `workbuddy-memory-digest.mjs` / `workbuddy-environment-snapshot.mjs` | 否 | 依赖宿主扩展，缺失时允许跳过 |

---

## 与 v2.0.2 相邻模块的关系

以下脚本**与智能记忆强相关，但不与内核同级**：

| 脚本 | 当前定位 | 与智能记忆的关系 |
|------|----------|------------------|
| `style-learning.mjs` | 能力模块 | 负责风格学习，可向学习特征层写入结果 |
| `session-state-manager.mjs` | 能力模块 | 负责会话状态恢复，不替代记忆核心模型 |
| `template-recommender.mjs` | 能力模块 | 基于历史偏好推荐模板，不直接定义记忆结构 |
| `workbuddy-user-profile-bridge.mjs` | 宿主桥接能力 | 读取宿主用户画像，为 intake 或个性化提供输入 |
| `exa-search-enhancer.mjs` | 搜索增强模块 | 与记忆并列协作，不属于记忆内核 |

**重要结论**：
- 上述脚本可以被描述为"智能记忆相关能力"
- 但不应再被写成与 `smart-memory-core.mjs` **并列的另一套主架构**

---

## 推荐对外口径

后续所有文档，统一采用下面这套描述：

### 对外一句话版本

> FBS-BookWriter 的智能记忆采用 **核心引擎 + 自然语言入口 + 宿主可选桥接** 的分层结构：
> `smart-memory-core.mjs` 负责真值与持久化，`smart-memory-natural.mjs` 负责对话式操作，WorkBuddy 摘要 / 环境快照属于可选宿主桥接增强。

### 对内维护版本

- **核心动作** 以 `smart-memory-core.mjs` 为准
- **自然语言体验** 以 `smart-memory-natural.mjs` 为准
- **项目初始化** 以 `init-project-memory.mjs` 为准
- **宿主桥接输出** 以 `workbuddy-memory-digest.mjs` / `workbuddy-environment-snapshot.mjs` 为准，但二者允许缺省

---

## 数据结构真值

### 默认目录

```text
<book-root>/.fbs/smart-memory/
└── memory.json
```

### 真值文件说明

- `memory.json` 是项目级智能记忆持久化文件
- 主结构由 `smart-memory-core.mjs` 维护
- `smart-memory-natural.mjs` 读取/更新时，也应视其为同一份真值文件，而不是另一套格式

### 结构分层

- **用户画像层**：原始用户信息（隔离）
- **学习特征层**：词汇、句式、语气、格式、修辞等可学习特征
- **应用层**：按学习结果对内容进行适配
- **整理分析层**：变化监控、里程碑、清理任务
- **元数据层**：学习次数、最后重置、最后脱钩、记忆大小等

---

## CLI 入口说明

### 核心动作入口

```bash
node scripts/smart-memory-core.mjs <action> <project-root> [options]
```

**适用动作**：
- `reset`
- `decouple`
- `check-boundary`
- `analyze-wb`
- `create-milestone`
- `cleanup`
- `export`

### 自然语言入口

```bash
node scripts/smart-memory-natural.mjs <project-root> "<自然语言指令>"
```

> 注：自然语言入口更适合宿主对话或人工调用；涉及精确参数控制时，优先使用 `smart-memory-core.mjs`。

### 项目初始化入口

```bash
node scripts/init-project-memory.mjs --book <book-root> [--skill <skill-root>]
```

**初始化脚本负责的事**：
- 创建/补齐项目级记忆上下文工件
- 调用书稿记忆模板与上下文索引生成
- 在宿主桥接脚本存在时追加：
  - WorkBuddy 摘要
  - 环境快照

**不负责的事**：
- 不替代 `smart-memory-core.mjs` 的内核动作
- 不承诺宿主桥接脚本一定随包提供

---

## 旧工具映射（更新版）

| 旧/相关工具 | 当前层级 | 推荐理解 |
|-------------|----------|----------|
| `workbuddy-user-profile-bridge.mjs` | 宿主桥接能力 | 提取宿主画像，供 intake / 个性化参考 |
| `exa-search-enhancer.mjs` | 搜索增强模块 | 搜索增强，与记忆解耦 |
| `session-state-manager.mjs` | 会话能力模块 | 会话恢复，不替代记忆真值 |
| `template-recommender.mjs` | 推荐能力模块 | 基于历史偏好推荐模板 |
| `style-learning.mjs` | 学习能力模块 | 可向学习特征层提供输入 |
| `smart-memory-natural.mjs` | 交互包装层 | 自然语言操作入口 |
| `smart-memory-core.mjs` | 核心真值层 | 智能记忆的结构与动作真值 |

---

## 落地状态判断

### 已落地主链

- `smart-memory-core.mjs`
- `smart-memory-natural.mjs`
- `init-project-memory.mjs`
- `style-learning.mjs`
- `session-state-manager.mjs`
- `template-recommender.mjs`
- `workbuddy-user-profile-bridge.mjs`
- `exa-search-enhancer.mjs`

### 可选/依赖宿主增强

- `workbuddy-memory-digest.mjs`
- `workbuddy-environment-snapshot.mjs`

这两项**不应再被文档写成默认必备内核脚本**。

---

## 文档维护原则

后续所有文档在提到"智能记忆"时，必须遵守：

1. **先写层级，再写脚本名**  
   先说明"核心 / 交互 / 桥接"，再列出具体脚本

2. **禁止把桥接脚本写成核心真值**  
   `workbuddy-memory-digest.mjs` 与 `workbuddy-environment-snapshot.mjs` 只能描述为宿主可选桥接

3. **禁止把能力模块写成另一套主架构**  
   `style-learning.mjs`、`session-state-manager.mjs`、`template-recommender.mjs` 是相邻能力，不是第二套内核

4. **机读契约优先与实现对齐**  
   `references/05-ops/search-policy.json` 中的说明应与本文件保持一致

---

## 结论

从现在开始，本仓库里的智能记忆体系以以下口径为准：

- **真值引擎**：`smart-memory-core.mjs`
- **对话入口**：`smart-memory-natural.mjs`
- **项目初始化编排**：`init-project-memory.mjs`
- **宿主可选桥接**：`workbuddy-memory-digest.mjs`、`workbuddy-environment-snapshot.mjs`
- **相邻能力模块**：`style-learning.mjs`、`session-state-manager.mjs`、`template-recommender.mjs`、`workbuddy-user-profile-bridge.mjs`、`exa-search-enhancer.mjs`

这份分层既能解释当前代码现实，也能作为后续文档、脚本注册和测试补齐的统一口径。

---

## v2.1.0 补充：WorkBuddy 记忆能力审计与宿主融合路线图

> **审计日期**：2026-04-11  
> **审计范围**：WorkBuddy v1.100.0 原生记忆体系 vs FBS v2.0.2 智能记忆系统  
> **结论**：FBS 当前建立了一套**与宿主并行的独立记忆系统**，存在 6 个缺陷，建议迁移到"宿主融合记忆"范式。

### 当前缺陷（D1-D6）

| # | 缺陷 | 严重度 | 说明 |
|---|------|--------|------|
| D1 | **与宿主 memery 零交互** | P0 | FBS 从未读取 `~/.workbuddy/memery/`，两套用户画像并行存在但不互通 |
| D2 | **未使用宿主内建记忆工具** | P0 | `update_memory` 和 `conversation_search` 完全未利用 |
| D3 | **记忆仅在 Node.js 脚本层** | P1 | 所有记忆操作依赖 `node` 命令执行，宿主 LLM 无直接访问路径 |
| D4 | **学习算法过于简陋** | P1 | 词汇学习只是 2-4 字中文词频统计，语气学习是关键词计数 |
| D5 | **会话恢复依赖用户手动触发** | P1 | 需用户主动说"继续上次"，宿主不自动注入 |
| D6 | **安全增强版是声明式空壳** | P2 | `smart-memory-security-enhanced.mjs` 定义了 RBAC/ABAC，但 `getKey()` 返回 `randomBytes()`|

### WorkBuddy 原生记忆体系（6层，FBS 当前未充分利用）

| 记忆类型 | 存储位置 | LLM 可达 | 跨项目 | FBS 利用情况 |
|----------|----------|---------|--------|------------|
| 用户画像（memery） | `~/.workbuddy/memery/{UID}_memery.md` | ✅ 系统提示注入 | ✅ | ❌ 未读取 |
| 项目工作日志 | `{workspace}/.workbuddy/memory/` | ✅ 系统提示注入 | ❌ | ✅ 部分使用 |
| 持久知识库 | `update_memory` 工具 | ✅ 跨会话 | ✅ | ❌ **v2.0.3 开始启用** |
| 对话历史 | `conversation_search` | ✅ 搜索接口 | ❌ | ❌ 未使用 |
| 身份文件 | `SOUL/IDENTITY/USER.md` | ✅ 系统提示注入 | ✅ | ⚠️ 桥接器已读 |
| FBS 智能记忆 | `.fbs/smart-memory/` | ❌ 需文件读取 | ❌ | ✅ 自身使用 |

### 宿主融合增强路线图

#### Phase 1：宿主原生能力接入（v2.1.0 目标，P0）

| 编号 | 增强项 | 实现状态 |
|------|--------|----------|
| E1 | 读取 memery 为画像种子（`workbuddy-user-profile-bridge.mjs` 已实现，需在 SKILL.md 入口层激活） | ⚠️ 桥接器存在，未激活 |
| E2 | 使用 `update_memory` 持久化关键记忆（S0/S2/S3/S4/用户偏好） | ✅ **v2.0.3 已在 team-lead 规则中实现** |
| E3 | 使用 `conversation_search` 恢复上下文 | 🔵 v2.1.0 目标 |
| E4 | memery → SmartMemory 单向同步（从 memery 提取画像注入 `userProfile`） | 🔵 v2.1.0 目标 |
| E9 | 宿主自动注入 `session-resume-brief.md`（新会话启动时自动读取） | ✅ **v2.0.3 已在 team-lead 首次接触规则中实现** |

#### Phase 2：学习算法升级（v2.2.0，P1）

| 编号 | 增强项 |
|------|--------|
| E5 | 词汇学习：2-4字正则 → jieba 分词 + TF-IDF + 停用词过滤 |
| E6 | 句式学习：平均句长 → 依存句法分析 + 从句嵌套深度 |
| E7 | 语气学习：关键词计数 → 情感分析模型（或 LLM 辅助评估） |
| E8 | 修辞学习：rhetorical 层空壳 → 实现排比/对偶/引用频率统计 |

#### Phase 3：会话恢复自动化（v2.1.0 目标，P1）

| 编号 | 增强项 |
|------|--------|
| E10 | 里程碑自动同步到 `.workbuddy/memory/` 日志 |
| E11 | 会话快照自动触发（ESM exit hook） |

#### Phase 4：双向桥接与去重（v3.0.0，P2）

| 编号 | 增强项 |
|------|--------|
| E12 | SmartMemory → memery 反向同步（风格偏好写回 memery，其他技能也能受益）|
| E13 | 画像去重（比较 memery 和 SmartMemory.userProfile，合并去重）|
| E14 | 记忆健康度仪表盘（memery 版本号 + SmartMemory 大小 + MEMORY.md 行数）|

### 不做的边界（X1-X4）

| 编号 | 不做 | 原因 |
|------|------|------|
| X1 | 不替代 memery | memery 是宿主管理的全局画像，FBS 应读取而非替代 |
| X2 | 不实现远程 MemoryGraph | FBS 是写作工具，不需要 capability-evolver 的图谱 |
| X3 | 不把 security-enhanced 从声明式改实现式 | 当前用户规模（个人/小团队）不需要企业级安全 |
| X4 | 不合并 CLAUDE.md 体系 | memory-spring-cleaning 面向 CodeBuddy 的 CLAUDE.md 生态，与 WorkBuddy 无关 |
