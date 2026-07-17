# 面试助手 · 快速开始（v4.0 路由式架构）

> **快速选择词**：面试助手 / mianshizhushou / interview-assistant。  
> 面向腾讯全集团面试官 / 招聘经理 / HR 的一站式面试执行工具，支持按候选人岗位/BG 自动加载胜任力模型与面试方案。

---

## 🧭 v4.0 架构变更（必看）

v4.0 把 v3.6 的单文件 SKILL.md（2729 行 / 143KB）拆为**主路由 + flows 子模块**，每次调用 context 节省 80%+：

```
SKILL.md（主路由 ≈ 415 行）       ← 每次必读：Router-0 + 核心硬规则 + M-Auto 规格
flows/
  ├── T.md                         ← 待办查询（T + T2）
  ├── S.md                         ← 面试安排（S-Index/S-0/S-A/S-B/S-C/S-D/S-E）
  ├── M.md                         ← M-0 ~ M-4 模型选择入口
  ├── A-resume-detail.md           ← 按 RID 拉简历详情（v4.1：批量搜简历已迁至 zhaopin-operations / zhaopin-social-operations）
  ├── B-resume-eval.md             ← 评简历（B1/B2/B3）
  ├── C-quiz.md                    ← 出题 / 面试计划
  ├── D-evaluation.md              ← 面评 D-1 ~ D-6（含面评质量检测）
  ├── startup.md                   ← 启动检查与工作流约束
  └── mcp-appendix.md              ← MCP 调用技术附录
```

**触发流程**：用户输入 → 主 SKILL.md Router-0 命中类目 → AI **第一动作就是 Read 对应 flows/*.md** → 再执行子模块内的步骤。原 v3.6 单文件保留为 `SKILL.md.v3.6.bak`。

---

## 🎯 一句话说明

贴一个候选人的 RID/链接 → AI 自动从简历提取 BG+岗位+招聘类型 → **自动**加载该岗位的专属胜任力模型 + 该轮的面试方案 → 直接出题/写面评。**不再让你手动选模型**。

---

## ⚡ 核心能力（3 点）

| 项 | 能力说明 |
|---|---|
| 模型选择 | **M-Auto 自动路由**：拉到简历后从 stationTxt/bg_txt/recruitType 自动匹配语义键 |
| 资产形态 | **远程优先**：人才标准、评分锚点、红线、模型、面试设计等敏感原文不在仓库内，统一通过 MCP `get_document` 拉取 |
| 命中失败 | **降级链 + 显式提示**：岗位级 → BG 级 → 集团兜底；远程不可用时输出"内部资产暂不可用"并停在 M-0 |

**其他能力（T/T2/S/A/B/C/D）保持完整**——Router-0 / S 模块 / 编码处理 / 前轮面评保密 / 4 段式 / 双版本面评 / 写面评必先拉转写 ……一个不少。

---

## 🚀 3 分钟 Demo

```
你：查看我的面试待办

面试助手：[列出今天的面试，含候选人 RID]

你：给第 1 个候选人出题

面试助手：
  1. 拉简历 + decode + 三元组提取
  2. 自动路由：bg=WXG, station=backend, recruit=campus, round=tech1
  3. 🎯 已自动匹配模型：model_wxg_backend（来源：auto-matched, 100/100）
     📐 已自动匹配方案：design_wxg_backend_tech1（来源：auto-matched, 90/100）
     🎭 叠加：qizhi_wxg（BG=WXG 自动追加）
  4. 通过 MCP get_document 拉取正文 → 内化使用
  5. 输出 4 段式面试计划（贴在对话正文，不回显模型原文）
```

如果该岗位没配过专属模型，**自动降级**：

```
⚠️ 模型降级加载：model_default_campus（集团校招通用兜底）
   │ 来源：global-fallback
   │ 原因：未找到 BG=IEG · 岗位=AI研究员 · 招聘=校招 的专属模型
   │ 建议：让 HR 在「甄选质量专家」搭建模型后由后端登记到 _remote-assets.yaml
   │ 匹配度：20/100
```

---

## 📦 首次安装

参考 `SKILL.md §「📦 首次使用」`：

```bash
# 1. recruit-mcp（必接）—— 🆕 首选 WorkBuddy 弹窗点「连接」走太湖 SSO，无需手填 Token、不再需要招活 Token
#    仅客户端不支持弹窗时走 CLI（只配太湖一个 header）：
mcporter config add recruit-mcp \
  --url "https://zhaopin.mcp.it.woa.com" \
  --header "Authorization=Bearer <太湖Token>"

# 2. 临时目录
export TMP_DIR="${TMPDIR:-/tmp}"

# 3. 首次会话告诉 AI："我是 zhangsan（张三）"
```

---

## 🆕 面试助手特有：如何添加岗位专属模型

### 资产清单维护（远程权威）

所有人才标准/评分锚点/红线/模型/面试设计统一存储在**后端知识库**，本仓库只维护索引：

```yaml
# references/_remote-assets.yaml
assets:
  model_wxg_backend:
    id: 18                          # 后端给 documentId
    summary: WXG 后台开发胜任力模型
    when_to_load: 候选人 BG=WXG 且岗位族=后端
    used_by: [flows/C-quiz.md, flows/D-evaluation.md, flows/M.md]
    match: { bg: WXG, position_family: backend }
```

### 添加流程

1. **建模/写设计方案**：用 `assessment-quality-expert` skill 完成
2. **登记到知识库**：由后端把正文录入并分配 `documentId`
3. **更新 yaml**：在 `_remote-assets.yaml` 的 `assets:` 节追加条目（注意 summary 写抽象描述，不暴露具体维度名）
4. **生效**：`scripts/match_model.py` 自动按 `match` 字段路由，无需重启

### 岗位中文名 → 英文 code 别名表

`references/models/_station_alias.json` 维护中文岗位名到 code 的映射。匹配规则：

1. 精确匹配（如 `stationTxt="后台开发"` → `backend`）
2. 子串匹配（如 `stationTxt="后台开发-服务端架构师"` 也命中 `backend`）
3. 都没命中 → 兜底 `all`

HR 可以自行扩展这个 JSON 文件。

---

## 🛠️ 目录结构

```
interview-assistant/
├── SKILL.md                                  # 主路由
├── README.md                                 # 本文件
├── flows/                                    # v4.0 流程子模块
│   ├── T.md / S.md / M.md                    # 待办 / 安排 / 模型选择
│   ├── A-resume-detail.md                    # 按 RID 拉简历详情
│   ├── B-resume-eval.md                      # 评简历
│   ├── C-quiz.md                             # 出题/面试计划
│   ├── D-evaluation.md                       # 面评
│   ├── startup.md                            # 启动检查
│   └── mcp-appendix.md                       # MCP 调用附录
├── scripts/
│   ├── match_model.py                        # 三元组 → 语义键自动匹配
│   ├── decode_todo.py / decode_resume.py     # 解码工具
│   ├── format_evaluation.py                  # 面评质量检测
│   └── mcporter_call.py                      # MCP 调用封装
└── references/
    ├── _remote-assets.yaml                   # ⭐ 远程资产索引（语义键 → documentId）
    ├── models/_station_alias.json            # 岗位中文 → code 别名表
    ├── campus-interview-flow-fallback.md     # 校招通用流程矩阵（兜底，可公开）
    ├── pitfalls.md                           # 内部踩坑历史
    ├── jds/                                  # JD 索引（如有）
    ├── templates/                            # 面评/简历输出模板（公开骨架）
    └── transcripts/                          # 转写接口契约
```

---

## ❓ 常见问题（面试助手特有）

### Q1. 我添加了新模型，AI 没自动认到？
→ 在 `references/_remote-assets.yaml` 追加条目（含 `id` / `match` 字段），无需跑索引脚本。

### Q2. 模型/方案的命名规范？
→ yaml 语义键命名建议：`model_<bg>_<position>`、`design_<bg>_<position>_<round>`，半脱敏即可。

### Q3. 同一岗位想要校招/社招两套模型？
→ 在 yaml 里建两条，`match.recruit_type` 分别填 `campus` / `social`。AI 会按简历的 `recruitProject` 字段自动选。

### Q4. 中文岗位名匹配不到怎么办？
→ 编辑 `references/models/_station_alias.json` 加一条映射。匹配 priority：精确 > 子串 > 兜底。

### Q5. AI 路由错了怎么办？
→ 直接说"用 XX 模型"或"用通用模型"会让位给手动选择，回到 M-0 询问流程。

### Q6. assessment-quality-expert 哪里下载？
→ 这个 skill 是腾讯内部 HR 团队搭的胜任力建模工具。**已上架腾讯内部 Knot 平台**：

> 🔗 **下载地址**：<https://knot.woa.com/skills/detail/33552>

在 Knot 页面点"安装"即可一键导入到 `~/.workbuddy/skills/assessment-quality-expert/`。

> 💡 没装 assessment-quality-expert **不影响面试助手的核心能力**——M-Auto 路由器读 `_remote-assets.yaml` + 调 MCP 拉取，模型由后端统一维护。

---

## 📮 维护说明

- **完整流程**：T / T2 / S / A / B / C / D 全部场景流程
- **核心增强**：M-Auto 模型自动路由器（按语义键 + 远程加载，必要时回到 M-0 手动选择）
- **资产管理路径**：
  - **路径 A**（推荐）：HR 用甄选专家搭模型 → 后端登记到知识库 → 维护者更新 `_remote-assets.yaml` → 立即生效
  - **路径 B**（应急）：用户在 M-0 直接粘贴模型给 AI 用，仅当前会话有效

---

**版本**：v4.0（路由式架构）
**发布日期**：2026-05-14
**快速入口**：面试助手 / mianshizhushou / interview-assistant
