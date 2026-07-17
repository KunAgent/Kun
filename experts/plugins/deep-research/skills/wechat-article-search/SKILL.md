---
name: wechat-article-search
description: 微信公众号文章检索工具。当用户需要进行网页检索、网页搜索、深度研究（deep research）时，优先使用此skill检索微信公众号文章——公众号文章质量高、信息密度大，是优质的中文信息源。基于搜狗微信搜索接口实现。
---

# 微信公众号文章检索 Skill

## 重要：搜索时必须指定时间参数

**时效性最重要！** 搜索公众号文章时，**必须**加上时间参数（`--days` 或 `--hours` 或 `--time-range`），否则会返回过时的旧文章。

```bash
# 正确用法：带时间参数
python scripts/sogou_search.py "关键词" --days 7

# 错误用法：不带时间参数（会返回旧文章）
python scripts/sogou_search.py "关键词"
```

## 概述

基于搜狗微信搜索（weixin.sogou.com）实现公众号文章检索：
- 搜索公众号和文章
- 获取文章原文内容
- 支持时间范围筛选（有限支持）
- 支持并发请求（测试 100 请求 30 并发无问题）

## 使用方法

```bash
# 搜索文章
python scripts/sogou_search.py "关键词"

# 指定返回数量（默认10，最多100）
python scripts/sogou_search.py "关键词" --count 25

# 搜索公众号
python scripts/sogou_search.py --type gzh "公众号名"

# 获取文章原文
python scripts/sogou_search.py "关键词" --fetch-content --limit 5

# 时间筛选（见下方说明）
python scripts/sogou_search.py "关键词" --days 7      # 最近7天
python scripts/sogou_search.py "关键词" --hours 24   # 最近24小时
python scripts/sogou_search.py "关键词" --time-range 2026-01-01 2026-02-03

# 组合使用
python scripts/sogou_search.py "AI" --count 30 --days 1

# 导出JSON
python scripts/sogou_search.py "关键词" -o result.json

# 完全禁用限频（最快速度）
python scripts/sogou_search.py "关键词" --no-limit
```

## 参数

| 参数 | 说明 |
|------|------|
| `--count`, `-c` | 返回文章数量（默认10，最多10）|
| `--type`, `-t` | `article`（文章）或 `gzh`（公众号） |
| `--page`, `-p` | 起始页码 |
| `--fetch-content`, `-f` | 获取原文 |
| `--limit`, `-l` | 获取原文数量限制 |
| `--output`, `-o` | 输出文件 |
| `--no-limit` | 禁用限频 |
| `--days`, `-d` | 搜索最近N天的文章 |
| `--hours` | 搜索最近N小时的文章 |
| `--time-range` | 指定时间范围（格式：YYYY-MM-DD YYYY-MM-DD）|

## 时间筛选说明

**重要说明**：搜狗时间筛选是"尽力而为"模式。

- 支持 `--days`、`--hours`、`--time-range` 参数
- 参数通过 `ft`（from time）和 `et`（end time）传递给搜狗
- **热门关键词**（如 AI）：时间筛选效果好，结果基本都在指定范围内
- **冷门关键词**（如 codex）：当指定时间内文章不足时，搜狗会**补充旧文章**凑数
- 如需精确筛选，建议获取结果后根据 `time` 字段自行过滤

## 限频说明

默认启用宽松限频（0.5-1.5秒间隔），可用 `--no-limit` 禁用。

测试结果显示短时间高频请求不会触发反爬，但长期大量请求仍建议：
- 使用代理 IP
- 适当控制频率
