---
name: video-content-collector
description: |
  AI/科技内容采集技能，封装 feedgrab 深度抓取与 multi-search-engine 广度搜索两大工具。
  供灵阅（ling-reader）调用，用于从微信公众号、X、YouTube、B站、GitHub等平台采集视频素材原料。
  触发词：采集内容、抓取资讯、搜索热点、feedgrab、multi-search-engine、采集报告
---

# video-content-collector — 内容采集技能

## 功能说明

封装视频生成团队的内容采集工具链，提供两种互补的采集能力：

1. **feedgrab**：深度抓取，支持微信公众号、X/Twitter、YouTube、B站、GitHub等10+平台的内容提取和视频自动转录
2. **multi-search-engine**：广度搜索，集成16个搜索引擎（7中文+9英文），支持时间过滤和高级语法

## 安装依赖

```bash
pip install feedgrab
```

multi-search-engine 通过 WorkBuddy Skill 工具加载，无需额外安装。

## feedgrab 常用命令

```bash
# 微信公众号搜索
feedgrab mpweixin-so "[关键词]" --limit 5

# X/Twitter 搜索
feedgrab x-so "[关键词]" --limit 5

# YouTube 搜索（含字幕提取）
feedgrab ytb-so "[关键词]" --limit 3

# B站搜索
feedgrab bilibili-so "[关键词]" --limit 5

# GitHub 搜索
feedgrab github-so "[关键词]" --limit 5

# 直接抓取指定URL
feedgrab url "[目标URL]"

# 抓取并下载视频字幕
feedgrab ytb-url "[YouTube URL]" --transcript
```

## multi-search-engine 常用搜索

```
# 中文搜索（近7天）
关键词 + qdr:w

# 英文搜索
LLM progress 2025 qdr:w

# 指定平台
site:mp.weixin.qq.com [关键词]
```

## 输出格式要求

每条采集内容必须包含：
- 标题、来源平台、来源URL、发布时间
- 核心摘要（50-150字）
- 关键要点（3-5条）
- 金句摘录（原文引用）
- 适合做视频的切入角度
- 质量评分（1-5星）

详见 @references/output-template.md

## 注意事项

- 优先采集近7天内容，时效性优先
- 同一事件多篇报道保留最有价值的一篇
- 质量>数量：宁可5篇精品，不要50篇低质
- 所有金句摘录必须标注来源页面URL
