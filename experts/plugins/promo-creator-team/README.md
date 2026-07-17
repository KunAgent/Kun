# Promo Creator Team — 宣传片创作专家团

> 6 位专业角色分 6 阶段协作，从产品 URL 到可发布的 60-90 秒宣传片 MP4。

## 专家团概览

这是一个 WorkBuddy Team 型专家团，由 1 位主理人和 5 位专业成员组成，覆盖产品宣传片制作的全流程。

### 团队成员

| 角色 | 名字 | 职责 |
|------|------|------|
| 🎬 制片人（主理人） | Max | 任务编排、阶段调度、暂停确认、交付汇总 |
| 💡 创意策略师 | Bella | 产品研究、卖点提炼、视觉风格推荐、叙事结构 |
| 🎨 分镜师 | Sean | 逐镜头 7 维画面描述、动效设计、素材标注 |
| 📦 素材制作人 | Ada | Pack A（AI 生成）+ Pack B（网络搜索）素材生产 |
| ✂️ 剪辑师兼动效师 | Ethan | HyperFrames HTML、GSAP 动画、视频渲染 |
| 🎵 音乐总监 | Melody | BGM 风格设计、卡点表、Mureka Prompt |

### 工作流程

```text
用户: "帮我做一个 XX 的宣传片" / github.com/xxx/xxx
  │
  ├─ Phase 1: 创意简报 → Bella → 01-brief.md        [PAUSE 1]
  ├─ Phase 2: 分镜脚本 → Sean → 02-storyboard.md     [PAUSE 2]
  ├─ Phase 3: 素材生产 → Ada → 03-asset-plan.md      [PAUSE 3]
  ├─ Phase 4: 剪辑合成 → Ethan → 04-edl.md + HTML
  ├─ Phase 5: BGM 设计 → Melody → 06-music-plan.md   [PAUSE 4]
  └─ Phase 6: 渲染交付 → Ethan → final/promo.mp4     [PAUSE 5]
```

## 4 种视觉风格

1. **Apple 发布会风** — 科技产品、AI、SaaS（默认）
2. **瑞士国际主义风** — 数据产品、工程工具
3. **赛博科技风** — CLI 工具、开源项目
4. **极简商务风** — B2B、企业服务

## 快速使用

对专家团说：

```text
帮我做一支产品宣传片
```

或者：

```text
给这个 GitHub 仓库做一支 60 秒 Apple 风产品宣传片：
https://github.com/owner/project
```

## 目录结构

```text
promo-creator-team/
├── .workbuddy-plugin/
│   └── plugin.json              # 配置文件
├── avatars/                     # 头像目录
│   ├── team.png
│   ├── promo-team-lead.png
│   ├── brief-strategist.png
│   ├── storyboard-artist.png
│   ├── asset-producer.png
│   ├── video-editor.png
│   └── music-director.png
├── agents/                      # Agent 定义
│   ├── promo-team-lead.md       # 主理人
│   ├── brief-strategist.md      # 创意策略师
│   ├── storyboard-artist.md     # 分镜师
│   ├── asset-producer.md        # 素材制作人
│   ├── video-editor.md          # 剪辑师
│   └── music-director.md        # 音乐总监
├── skills/                      # 共享技能
│   └── bgm-prompting/
│       ├── SKILL.md
│       ├── references/
│       └── scripts/
├── settings.json                # 主理人设置
└── README.md                    # 本文件
```

## 环境依赖

- Node.js 22+
- HyperFrames CLI
- FFmpeg
- Python 3.10+（可选，用于 Mureka BGM 生成）
- `MUREKA_API_KEY`（可选，用于实际生成 BGM）

## License

MIT.
