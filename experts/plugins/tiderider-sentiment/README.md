# TideRider Sentiment Analyst

A data-driven game sentiment analysis expert for WorkBuddy. Connects to Google BigQuery to analyze player reviews across platforms, perform topic attribution, version trend analysis, and generate premium HTML reports.

## Features

- **舆情异动归因**：通过 anomaly_details 表的 Remark 四模块（典型讨论/发酵主贴/热门评论/KOL），精准定位异动原因并提供证据链接
- **Multi-platform sentiment analysis**: Steam, Discord, Reddit, Twitter, App Stores
- **Version trend comparison**: Track sentiment changes across game updates
- **Topic attribution**: Identify and rank complaint/praise topics by community consensus
- **Player behavior deep-dives**: Playtime segmentation, abandonment analysis, disillusionment curves
- **Steam specialist**: ext_json field analysis (playtime portraits, refund analysis, review changes)
- **Premium report generation**: Dark-themed HTML reports with Chart.js visualizations

## 首次使用配置

本专家需要连接 Google BigQuery 数据库读取舆情数据，首次使用前需配置凭证：

1. **获取凭证**：企业微信联系 **chandwang**，获取 BigQuery Service Account JSON 凭证文件和配置指引
2. **保存到本地**：将凭证文件保存到你电脑的任意位置（建议路径如 `~/Documents/tiderider.json`）
3. **安装依赖**：确保本地 Python 环境已安装 `google-cloud-bigquery`（见下方）

> 💡 凭证 JSON 文件中已包含 `project_id`，**无需额外提供或配置 Project ID**，连接时自动读取。
>
> 💡 **凭证问题、权限问题、任何配置疑问？** 企业微信联系 **chandwang**

### 环境要求

- Python 3.9+（系统自带即可）
- `google-cloud-bigquery` Python 包

安装方法：
```bash
pip install google-cloud-bigquery
```

> 如果你的系统有多个 Python 版本，请确保安装到正确的环境中（如 `pip3 install google-cloud-bigquery` 或 `python3 -m pip install google-cloud-bigquery`）

## Quick Start

1. 安装专家到 WorkBuddy
2. 首次使用时提供 BigQuery 凭证文件路径（仅此一步，无需填写 Project ID）
3. 开始提问：「帮我分析一下 PoE2 最近两周的舆情」

## Supported Games

See `skills/bigquery-sentiment/references/games.json` for the full list of supported game UIDs.

## 数据表说明

| 表 | 用途 | 优先级 |
|---|------|--------|
| `tiderider.anomaly_details` | 舆情异动归因（含Remark四模块+证据链接） | ⭐ 异动问题第一优先 |
| `tiderider.opinion_feeds` | 清洗后评论数据（目前仅Subway系列） | 统计问题第一优先 |
| `opinion.feeds` | 原始评论数据（所有游戏） | 统计问题回退 |
| `tiderider.key_document_collection_extra` | 官方/大V内容 | 舆情总结第一引用源 |

## Skills Included

| Skill | Description |
|-------|-------------|
| `bigquery-sentiment` | Core sentiment query templates, game UID mapping, query rules, anomaly analysis workflow |
| `steam-deep-analysis` | Steam-specific ext_json analysis: playtime portraits, abandonment, disillusionment, community consensus, refund analysis |

## Report Style

Reports use a premium dark theme with:
- Deep navy background (`#0b1020`)
- Glowing card borders
- Chart.js v4 visualizations
- Color-coded sentiment indicators (green=positive, red=negative, amber=neutral)

## License

Proprietary - TideRider Team
