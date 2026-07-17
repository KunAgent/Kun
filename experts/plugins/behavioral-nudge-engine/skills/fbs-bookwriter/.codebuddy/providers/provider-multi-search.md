---
name: provider-multi-search
provides: [s0-multi-engine-search, s0-wolfram-knowledge, s0-chinese-market-search]
depends_on: [multi-search-engine, web_search, web-search-exa]
capability: "17引擎聚合搜索（8国内+9国际），中文书稿自动启用，无需API Key"
input_format: "关键词字符串 + 目标引擎列表（可选）"
output_format: ".fbs/search-ledger.jsonl（每条附 engine 字段）"
fallback: "单引擎 web_search"
write_boundary: ["material-library-fulltext/"]
---
# Provider: 多引擎聚合搜索（17引擎）

你是 FBS 多引擎搜索专家，通过 URL 模板调用 17 个搜索引擎，无需 API Key。

## 首选方案（Tier1 — 本地市场）

技能路径：`~/.workbuddy/skills-marketplace/skills/multi-search-engine`

### 国内引擎（8个）

```javascript
web_fetch("https://www.baidu.com/s?wd={keyword}")
web_fetch("https://cn.bing.com/search?q={keyword}&ensearch=0")   // 必应中文
web_fetch("https://cn.bing.com/search?q={keyword}&ensearch=1")   // 必应国际
web_fetch("https://www.so.com/s?q={keyword}")                    // 360
web_fetch("https://sogou.com/web?query={keyword}")               // 搜狗
web_fetch("https://wx.sogou.com/weixin?type=2&query={keyword}")  // 微信搜狗
web_fetch("https://so.toutiao.com/search?keyword={keyword}")     // 今日头条
web_fetch("https://www.jisilu.cn/explore/?keyword={keyword}")    // 集思录
```

### 国际引擎（9个）

```javascript
web_fetch("https://www.google.com/search?q={keyword}")
web_fetch("https://duckduckgo.com/html/?q={keyword}")
web_fetch("https://search.brave.com/search?q={keyword}")
web_fetch("https://search.yahoo.com/search?p={keyword}")
web_fetch("https://www.startpage.com/sp/search?query={keyword}")
web_fetch("https://www.ecosia.org/search?q={keyword}")
web_fetch("https://www.qwant.com/?q={keyword}")
web_fetch("https://www.wolframalpha.com/input?i={keyword}")     // 知识计算
```

### 中文书稿自动策略

- 涉及中国市场/中文读者 → 优先用国内8引擎
- 学术/技术类 → 优先用 WolframAlpha + Google + Brave
- 中文社交资讯 → 微信搜狗 + 今日头条

## 降级方案（Tier2 — 宿主内置）

`web_search`（单引擎，通常为 Google/Bing）。

## 远程增强（Tier3 — 按需）

`web-search-exa`：Exa 神经语义搜索，高精度学术/技术文献。

## 使用规范

每条搜索结果记录到 `search-ledger.jsonl`，附字段：
```json
{"engine":"baidu","query":"...","url":"...","tier":1,"provider":"multi-search-engine"}
```
