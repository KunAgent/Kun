# 天御营销保护专家（Tianyu Marketing Guardian）

腾讯云天御营销保护专家 · Agent 型 WorkBuddy 专家。

> 替您守护每一场营销活动，在文旅、零售、Token、医疗挂号等场景自动盯活动、查漏召、调策略护预算。

## 目录结构

```
天御营销保护专家/
├── .codebuddy-plugin/
│   └── plugin.json
├── avatars/
│   └── expert.png                 # 512×512 PNG，正式发布前替换
├── agents/
│   └── tianyu-marketing-guardian.md
├── skills/
│   └── tencent-rce-skill/         # 共享的腾讯云天御风控 Skill
│       ├── SKILL.md
│       ├── AGENT.md
│       ├── AGENT_unix.md
│       └── AGENT_windows.md
└── README.md
```

## 配置要点

- `expertType`: `agent`
- `agentName`: `tianyu-marketing-guardian`
- `categoryId`: `11-SecurityCompliance`
- 依赖 Skill: `tencent-rce-skill`（与"天御账号保护"、"天御交易保护"共用同一份 RCE Skill 源）

## ⚠️ 待补项（发布前确认）

1. **`avatars/expert.png`** 已配置（512×512 px、PNG-8、约 100KB，满足 ≤500KB 规范）。
2. **`displayDescription.zh`** 已按规范裁剪至 50 字（40-50 字区间）。
3. **`author.email`** 已回填为 `tommyttan@tencent.com`。

## 打包

```bash
zip -r 天御营销保护专家.zip 天御营销保护专家/
```
