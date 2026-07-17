<p align="center">
  <h1 align="center">📄 腾讯电子签合同 AI Skill</h1>
  <p align="center">
    为 Agent 赋予合同起草、审查、对比、法条检索能力的智能技能包
    <br />
    <a href="https://qian.tencent.com"><strong>腾讯电子签官网 »</strong></a>
    <br />
    <br />
    <a href="#快速安装">快速安装</a>
    ·
    <a href="#支持的工具">支持的工具</a>
    ·
    <a href="#功能概览">功能概览</a>
    ·
    <a href="#常见问题">FAQ</a>
  </p>
</p>

---

## 功能概览

| 能力 | 说明 |
|------|------|
| **合同起草** | 自然语言描述需求 → AI 生成完整合同文档，支持参考模板 |
| **合同审查** | 上传合同文件 → AI 识别法律风险并给出修改建议 |
| **合同对比** | 上传两份合同 → AI 逐条标注差异（新增/修改/删除） |
| **法条法规检索** | 自然语言描述场景 → 检索相关法律法规条文及依据 |
| **文件上传** | 支持 PDF、Word、DOC 等格式，自动获取资源 ID |

## 特性

- **Token 鉴权** — 仅需一个 SIGN-TOKEN，无需复杂的密钥对
- **纯 Python** — 零第三方依赖，兼容 Python 2.7+ / 3.x
- **模块化架构** — Hub-and-Spoke 模式，按需加载操作指南，弱模型也能精准遵循
- **多工具兼容** — 支持 CodeBuddy / WorkBuddy / Cursor / Claude Code / Codex / OpenCode 等主流 AI 编程工具
- **交互式流程** — 阶段化引导，信息收集 → 确认 → 执行 → 结果展示 → 后续操作

## 项目结构

```
tencent-esign-contract/
├── SKILL.md                       # 技能定义（AI Agent 入口，路由中心）
├── scripts/
│   ├── tencent_esign.py           # CLI 工具（单文件，所有功能）
│   ├── config.json                # API 地址与版本配置
│   ├── pack.sh                    # 打包脚本
│   └── test_evals.py              # 测试验证脚本
├── references/
│   ├── api_references.md          # 详细 API 调用参考
│   ├── draft_guide.md             # 合同起草详细操作指南
│   ├── review_guide.md            # 合同审查详细操作指南
│   ├── compare_guide.md           # 合同对比详细操作指南
│   └── law_search_guide.md        # 法条法规检索详细操作指南
├── evals/
│   └── evals.json                 # 测试用例（25 个场景）
├── icons/                         # 图标资源
├── LICENSE                        # MIT 许可证
└── README.md
```

### Hub-and-Spoke 架构

SKILL.md 采用 Hub-and-Spoke 模式设计，作为路由中心（约 240 行）仅保留强制规则、鉴权、流程概述和用户话术模板。四大业务流程的 JSON 结构、解析步骤、展示规则等实现细节拆分到 `references/` 下的独立指南文件中，模型按需加载，减少注意力稀释，提升指令遵循率。

## 前置要求

- **Python 2.7+** 或 **Python 3.x**（推荐 3.6+）
- **网络访问** — 需能访问 `appgw.test.ess.tencent.cn`
- **SIGN-TOKEN** — 从 [腾讯电子签](https://qian.tencent.com) 获取

## 快速安装

选择你使用的 AI 工具，直接 clone 到对应的 Skills 目录即可。后续更新只需进入目录执行 `git pull`。

> 每个工具支持**项目级**（仅当前项目生效，可随仓库共享给团队）和**用户级**（全局生效）两种安装范围。

### 安装到当前项目（项目级，推荐团队共享）

将技能安装到当前项目目录下，提交到 Git 后团队成员自动获得。根据你使用的工具选择对应目录：

```bash
# CodeBuddy / WorkBuddy
git clone https://github.com/tencentess/tencent-esign-contract.git .codebuddy/skills/tencent-esign-contract

# Cursor
git clone https://github.com/tencentess/tencent-esign-contract.git .cursor/skills/tencent-esign-contract

# Claude Code
git clone https://github.com/tencentess/tencent-esign-contract.git .claude/skills/tencent-esign-contract

# OpenAI Codex CLI
git clone https://github.com/tencentess/tencent-esign-contract.git .codex/skills/tencent-esign-contract

# OpenCode
git clone https://github.com/tencentess/tencent-esign-contract.git .opencode/skills/tencent-esign-contract
```

安装后建议将 skills 目录提交到版本控制：

```bash
git add .codebuddy/skills/  # 替换为你使用的工具目录
git commit -m "添加腾讯电子签合同 AI 技能"
```

### 安装到用户目录（全局级）

安装到用户 Home 目录下，所有项目均可使用。

### WorkBuddy

WorkBuddy 兼容 CodeBuddy 的 Skills 体系和 OpenClaw 生态：

```bash
git clone https://github.com/tencentess/tencent-esign-contract.git ~/.codebuddy/skills/tencent-esign-contract
```

在 WorkBuddy 设置 → Skills 管理中查看，或通过「导入 Skill」一键导入。

### CodeBuddy IDE / CLI

```bash
# 用户级（全局，所有项目可用）
git clone https://github.com/tencentess/tencent-esign-contract.git ~/.codebuddy/skills/tencent-esign-contract

# 项目级（仅当前项目，可提交 Git 共享给团队）
git clone https://github.com/tencentess/tencent-esign-contract.git .codebuddy/skills/tencent-esign-contract
```

安装后在 CodeBuddy 设置 → Skills 管理页面可查看，或运行 `/skills` 确认已加载。也可通过「导入 Skill」按钮直接导入。

### OpenClaw（龙虾）

兼容所有 OpenClaw 生态工具，安装到 `~/.agents/skills/` 即可被大多数工具识别：

```bash
git clone https://github.com/tencentess/tencent-esign-contract.git ~/.agents/skills/tencent-esign-contract
```

<details>
<summary><b>其他工具（Cursor / Claude Code / Codex / OpenCode）</b></summary>

#### Cursor

```bash
# 用户级（全局）
git clone https://github.com/tencentess/tencent-esign-contract.git ~/.cursor/skills/tencent-esign-contract

# 项目级
git clone https://github.com/tencentess/tencent-esign-contract.git .cursor/skills/tencent-esign-contract
```

也可通过 Cursor Settings → Rules → Add Rule → Remote Rule (GitHub) 直接从仓库导入。

#### Claude Code

```bash
# 用户级（个人全局）
git clone https://github.com/tencentess/tencent-esign-contract.git ~/.claude/skills/tencent-esign-contract

# 项目级（提交到 Git 可共享给团队）
git clone https://github.com/tencentess/tencent-esign-contract.git .claude/skills/tencent-esign-contract
```

运行 `/skills` 查看已加载的技能列表。

#### OpenAI Codex CLI

```bash
# 用户级
git clone https://github.com/tencentess/tencent-esign-contract.git ~/.codex/skills/tencent-esign-contract

# 项目级
git clone https://github.com/tencentess/tencent-esign-contract.git .codex/skills/tencent-esign-contract
```

#### OpenCode

```bash
# 用户级
git clone https://github.com/tencentess/tencent-esign-contract.git ~/.config/opencode/skills/tencent-esign-contract

# 项目级
git clone https://github.com/tencentess/tencent-esign-contract.git .opencode/skills/tencent-esign-contract
```

OpenCode 也兼容 `.claude/skills/` 和 `.agents/skills/` 目录。

</details>

### 更新

```bash
cd <你的安装目录>/tencent-esign-contract
git pull
```

---

## 使用方式

### 1. 配置 Token

首次使用时，AI 助手会自动检测 Token 状态并引导你完成配置。你也可以手动配置：

```bash
# 保存 Token
python3 scripts/tencent_esign.py auth-save <YOUR_TOKEN>

# 验证 Token
python3 scripts/tencent_esign.py auth-validate <YOUR_TOKEN>

# 检查 Token 状态
python3 scripts/tencent_esign.py auth-check
```

Token 获取地址：[https://qian.tencent.com](https://qian.tencent.com)

### 2. 开始对话

安装完成后，直接用自然语言与 AI 助手对话即可：

```
👤 帮我起草一份软件开发合同，甲方是深圳星辰科技，乙方是北京云端数据
👤 审查一下 ~/contracts/sale.pdf 这份合同有没有风险
👤 对比一下这两份合同的差异：v1.pdf 和 v2.pdf
👤 这份合同有没有什么法律问题？
```

AI 助手会自动触发本技能，按阶段引导你完成操作。

### 3. 命令行直接调用

```bash
# 上传文件
python3 scripts/tencent_esign.py upload contract.pdf

# 调用 API
python3 scripts/tencent_esign.py call CreateBatchContractReviewTask '{"ResourceIds":["<id>"]}'

# 等待任务完成
python3 scripts/tencent_esign.py wait-review <task_id>
python3 scripts/tencent_esign.py wait-draft <task_id>
python3 scripts/tencent_esign.py wait-compare <task_id>
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ESIGN_TOKEN` | 鉴权 Token（优先级高于文件存储） | — |
| `ESIGN_BASE_URL` | 自定义 API 地址 | `config.json` 中的值 |

Token 存储优先级：环境变量 `ESIGN_TOKEN` > 文件 `~/.esign-token`

## 验证安装

```bash
# 检查 Python 环境
python3 --version

# 检查脚本是否可运行
python3 scripts/tencent_esign.py version

# 检查 Token 配置
python3 scripts/tencent_esign.py auth-check
```

## 常见问题

<details>
<summary><b>Q: 技能没有被 AI 助手自动识别怎么办？</b></summary>

1. 确认 `SKILL.md` 文件存在于正确的 skills 目录下
2. 重启 AI 工具的会话
3. 在对话中使用关键词（如「合同」「审查」「起草」）触发
4. 使用 `/skills` 命令（支持的工具）查看已加载的技能
</details>

<details>
<summary><b>Q: Token 过期了怎么办？</b></summary>

重新从 [腾讯电子签](https://qian.tencent.com) 获取新的 SIGN-TOKEN，然后：
```bash
python3 scripts/tencent_esign.py auth-save <NEW_TOKEN>
```
</details>

<details>
<summary><b>Q: 支持哪些文件格式？</b></summary>

上传支持 PDF、Word（.doc/.docx）等常见文档格式。起草生成的合同为 DOCX 格式。
</details>

<details>
<summary><b>Q: Python 2 和 Python 3 都没有怎么办？</b></summary>

推荐安装 Python 3：
```bash
# macOS
brew install python3

# Ubuntu/Debian
sudo apt install python3

# Windows
# 从 https://www.python.org/downloads/ 下载安装
```
</details>

<details>
<summary><b>Q: 如何更新到最新版本？</b></summary>

进入安装目录执行 `git pull` 即可：
```bash
cd ~/.cursor/skills/tencent-esign-contract  # 替换为你的安装路径
git pull
```
</details>

## 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

Copyright © 2026 Tencent Technology (Shenzhen) Co., Ltd.
