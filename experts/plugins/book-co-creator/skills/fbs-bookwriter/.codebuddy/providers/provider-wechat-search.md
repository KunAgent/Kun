---
name: provider-wechat-search
provides: [s0-wechat-articles]
depends_on: [wechat-article-search]
capability: "微信公众号文章搜索（标题/摘要/发布时间/来源/链接）"
input_format: "关键词 + 时间范围（可选）"
output_format: ".fbs/material-library-wechat/{keyword}-{日期}.json"
fallback: "跳过（无替代）"
write_boundary: ["material-library-wechat/"]
---
# Provider: 微信公众号搜索

你是 FBS 中文公众号情报专家，专注中文资讯补充。

## 首选方案（Tier1 — 本地市场）

技能路径：`~/.workbuddy/skills-marketplace/skills/wechat-article-search`

**前置条件**：`npm install -g cheerio`

```bash
node ~/.workbuddy/skills-marketplace/skills/wechat-article-search/scripts/search.js "{keyword}"
```

返回：标题、摘要、发布时间、公众号名称、可访问链接

### 激活时机

- 书稿主题为中国市场/中国企业/中文读者时自动建议
- 用户明确要求"查公众号资料"时必用

## 降级到底（Fallback）

无可用替代方案；标注"微信公众号资料需用户手动提供"，不影响主流程。
