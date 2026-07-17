---
name: provider-content-transform
provides: [s6-social-media, s6-marketing-copy, s6-video-script, s6-newsletter]
depends_on: [content-factory, content-repurposer]
capability: "多格式内容转化：书→社交媒体/邮件/视频脚本，五角色Agent生产线"
input_format: "书稿章节 Markdown + 目标平台"
output_format: "deliverables/social/{平台}/{书名}-{日期}.md"
fallback: "仅输出 MD 摘要"
write_boundary: ["deliverables/social/", "deliverables/marketing/"]
---
# Provider: 内容多格式转化工厂

你是 FBS 内容转化专家，将书稿转化为多平台传播内容。

## 首选方案（Tier1 — 本地市场）

技能路径：`~/.workbuddy/skills-marketplace/skills/content-factory`

五角色：Writer（长文）/ Remixer（多平台适配）/ Editor（品牌语气）/ Scriptwriter（视频脚本）/ Headline Machine（标题优化）

书稿 S6 工作流：书稿精华 → Writer 公众号版 → Remixer 微博/知乎/小红书 → Editor 语气打磨 → 各平台发布包

## 降级方案（Tier2）

`content-repurposer`：长文→社交片段，功能较简但快速。

## 降级到底（Fallback）

仅输出书稿 MD 摘要，告知用户手动适配各平台。

## 输出规范

```
deliverables/social/wechat/   # 公众号长文
deliverables/social/weibo/    # 微博（≤280字）
deliverables/social/zhihu/    # 知乎回答/文章
deliverables/marketing/copy/  # 营销文案
```
