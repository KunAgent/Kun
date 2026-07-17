---
name: wechat-article-search
description: "搜索微信公众号文章技能。通过微信搜索获取文章列表，覆盖科技/AI、社会热点、财经、教育、职场等各类中文资讯；可按关键词检索并返回标题、概要、发布时间、来源公众号与链接。当用户需要查找微信公众号文章、整理参考资料或快速获取文章信息时使用此技能。"
description_zh: "搜索微信公众号文章（标题、摘要、发布时间、来源账号、链接）"
description_en: "Search WeChat public account articles by keyword"
version: 0.1.0
allowed-tools: Bash,Read
metadata:
  clawdbot:
    emoji: "🔎"
    requires:
      bins:
        - node
---

# 微信公众号文章搜索说明

## 适用场景

- 用户说“帮我搜某个关键词的公众号文章/最近文章”
- 需要快速拿到：标题、摘要、发布时间、公众号名称、可访问链接

## 工作流程

### 步骤1: 确认已安装依赖包
该脚本依赖NodeJS依赖包 `cheerio`，建议先执行全局安装或在项目中安装：

```bash
npm install -g cheerio
```

### 步骤2: 确认搜索词语数量
1、 确认关键词与数量

### 步骤3: 执行搜索命令
1、执行常规搜索命令

```bash
node scripts/search_wechat.js "关键词" 
```

## 特殊流程（可选）
1) 执行包含数量限制的搜索命令

```bash
node scripts/search_wechat.js "关键词"  -n 15
```
2) 如果用户需要保存结果到文件，执行命令

```bash
node scripts/search_wechat.js "关键词" -n 20 -o result.json
```
3) 若想要获取微信文章域名的真实链接”，执行如下命令

```bash
node scripts/search_wechat.js "关键词" -n 5 -r
```

## 参数说明

- `query`：搜索关键词（必填）
- `-n, --num`：返回数量（默认 10，最大 50）
- `-o, --output`：输出 JSON 文件路径（可选）
- `-r, --resolve-url`：尝试把中间链接解析成微信文章真实链接（会额外请求每条结果）

## 输出字段（文章对象）
文章标题、文章地址、文章概要、发布时间、来源公众号名称

## 常见问题处理

- 结果为空：尝试更换关键词、更少的特殊字符、或稍后重试
- 解析真实 URL 失败：这是常态（反爬限制）；可提示用户用浏览器打开中间链接

## 注意事项

- 本工具仅用于学习和研究目的，请勿用于商业用途或大规模爬取。
- 使用本工具时请遵守相关网站的使用条款和规定。
- 过度使用可能导致 IP 被封禁，请谨慎使用。
