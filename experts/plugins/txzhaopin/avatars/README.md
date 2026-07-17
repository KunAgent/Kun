# Avatars · 头像目录

> 本目录由 WorkBuddy 专家开发规范 v2.0 第七节强制要求。所有头像均通过 `plugin.json` 的相对路径引用（如 `avatars/expert.png`），**不允许**使用 URL。

## 规范要求（必须全部满足）

| 项 | 要求 |
|---|---|
| 格式 | PNG（推荐）或 JPG |
| 尺寸 | **512 × 512 px**（正方形） |
| 大小 | 单张不超过 **500 KB** |
| 风格 | 统一的漫画 / 插画风格，专业自然 |
| 内容 | 符合角色定位，不含违规内容 |

## 本专家包需要的头像

本仓库是 **Agent 型** 专家（`expertType: "agent"`），只需 1 张：

| 文件名 | 用途 |
|---|---|
| `expert.png` | 腾讯招聘专家 · 主头像（对应 `plugin.json.avatar`） |

## 生成指引

当前 `expert.png` 是占位。正式上架前需要替换为合规头像，推荐步骤：

1. 在 WorkBuddy 中安装并调用 `expert-creator` skill
2. 用以下提示词生成（示例）：
   > 为"腾讯招聘专家"生成一张 512×512 PNG 头像：专业女性 HR 形象，商务装，亲和、干练；漫画 / 插画风格；纯色背景；突出"值得信任、经验丰富"。
3. 把生成的图片保存为 `avatars/expert.png`，删除原 `.gitkeep`
4. 运行 `bash scripts/lint-skills.sh` 验证通过

## 自检清单

- [ ] `avatars/expert.png` 存在
- [ ] 尺寸 = 512×512
- [ ] 文件大小 ≤ 500KB
- [ ] 内容符合"招聘/HR 专家"定位，风格专业
- [ ] `plugin.json.avatar` 路径与本目录下文件名一致
