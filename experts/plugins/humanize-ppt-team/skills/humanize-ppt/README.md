<div align="center">

# Humanize PPT

## 基于 AST 理论的人感 PPT 大纲导演 Skill

**先把资料变成人愿意听的大纲，再交给HTML PPT Skill做风格探索，生成页面，做演讲模式和部署上线**

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-green?style=flat-square)](https://learnprompt.github.io/humanize-ppt/)
[![Release](https://img.shields.io/github/v/release/LearnPrompt/humanize-ppt?style=flat-square)](https://github.com/LearnPrompt/humanize-ppt/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](LICENSE)

[在线 Demo](https://learnprompt.github.io/humanize-ppt/) · [English](README.en.md) · [AST 理论](docs/AST-theory.md) · [OPC 工作流](docs/OPC-workflow.md) · [Agent Teams](docs/agent-teams.md)

</div>

---

## 这是什么

Humanize PPT 是一个 **PPT 大纲导演**，不是又一个HTML PPT模板库，也不是普通的文本润色工具。

用 AST 理论把原始资料拆成：

- 观众是谁；
- 观众看之前是什么状态；
- 看完以后应该变成什么状态；
- 中间最大的认知张力是什么；
- 每一页如何推动状态转移；

然后再把这份干净的生产说明书交给下游Skill生成HTML PPT和视频，比如op7418/guizang-ppt-skill、zarazhangrui/frontend-slides、heygen-com/hyperframes和lewislulu/html-ppt-skill

## 核心判断

> **PPT 不只是信息容器，而是观众状态改变器。**

AI 直接生成 PPT 时，容易出问题的地方已经不是页面不够漂亮了，模型把自己的解释过程、中间推理痕迹和结构噪音都写进了页面里。

Humanize PPT 的作用是先把资料“洗干净”，重组成一条适合讲解、适合演示、适合下游生成的观众路径。

## V0.1 能做什么

V0.1 先验证一个最小闭环：

```text
原始资料
→ 生成大纲：Humanize PPT / AST Outline Director
→ 风格探索：frontend-slides和guizang-ppt-skill
→ 演讲模式：lewislulu/html-ppt-skill
→ 静态上线：frontend-slides
```

当前包含：

- `SKILL.md`：Agent Skill 入口；
- `docs/AST-theory.md`：AST 理论；
- `docs/OPC-workflow.md`：Outline / Produce / Complete 工作流；
- `contracts/`：输出契约模板；
- `scripts/humanize_ppt_v1.py`：本地最小 Demo Runner；
- `examples/`：脱敏测试素材。

## 快速开始

```bash
git clone https://github.com/LearnPrompt/humanize-ppt.git
cd humanize-ppt

python3 scripts/humanize_ppt_v1.py   --source examples/01-ai-tool-update/source.md   --out .humanize-ppt-runs/ai-tool-update   --title "AI 工具更新，不只是功能清单"

open .humanize-ppt-runs/ai-tool-update/styles/index.html
open .humanize-ppt-runs/ai-tool-update/presenter/index.html
```

也可以跑 Hermes 安装讲解案例：

```bash
python3 scripts/humanize_ppt_v1.py   --source examples/02-hermes-install-guide/source.md   --out .humanize-ppt-runs/hermes-install   --title "把 Hermes 装成一个真正能干活的 Agent"
```

## 输出结果

```text
out/
  deck_brief.md
  ast_outline.md
  slide_plan.json
  speaker_intent.md
  asset_manifest.md
  video_slots.json
  styles/
    index.html
    guizang-stable.html
    zara-editorial.html
    zara-contrast.html
  presenter/
    index.html
    notes.json
  deploy/
    index.html
    presenter.html
```

## 在线 Demo

- 首页：https://learnprompt.github.io/humanize-ppt/
- AI 工具更新风格探索：https://learnprompt.github.io/humanize-ppt/demo/styles/index.html
- AI 工具更新演讲模式：https://learnprompt.github.io/humanize-ppt/demo/presenter/index.html
- Hermes 安装讲解风格探索：https://learnprompt.github.io/humanize-ppt/demo/hermes-install/styles/index.html
- Hermes 安装讲解演讲模式：https://learnprompt.github.io/humanize-ppt/demo/hermes-install/presenter/index.html

## License

MIT
