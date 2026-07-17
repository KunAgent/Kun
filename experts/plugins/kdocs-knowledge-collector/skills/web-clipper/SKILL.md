---
name: web-clipper
description: "将网页内容剪藏并自动保存为金山文档智能文档（.otl）。 当用户提供 URL 并要求「保存网页」、「收藏网页」、「剪藏」、「网页存到文档」时使用。 若需要存入知识库，请使用 knowledge-save 技能。
"
homepage: 
version: 1.5.7
---

# 网页收藏

网页收藏技能可以将任意网页内容保存为金山文档。

> 本技能依赖 `kdocs` 技能的基础文档操作能力（认证、文件管理等），请确保已安装该技能。详见 `references/core/` 目录。

---

## 能力范围



---

## 操作指南

### 通用操作路由

| 意图 | 路由 |
|------|------|
| 读取文档内容 | `read_file`（统一入口，按后缀自动返回 Markdown 或结构化数据） |
| 创建/写入 | `create_file_with_content`（统一入口，新建文档并写入内容，返回 link_url） |
| 局部更新 | 改块/改段/改单元格，已有目标文档上的修改 → 按「支持的文档类型」→ 对应 reference |
| 类型专属能力 | 条件格式、导出转换、翻译、PDF 拆分、幻灯片主题、数据校验 | 按「支持的文档类型」→ 对应 reference 中的专属功能章节 |
| 获取文件标识指南 | **必读** `references/file-locating-guide.md` |

### 高频流程指引

#### 网页剪藏

> **当用户要求保存网页/URL 到金山文档时，直接调用 `scrape_url`。禁止先用 `web_fetch`、`web_search` 或浏览器抓取内容。**

**触发识别**：用户消息中同时包含 **URL**（非金山文档链接）+ **保存/存到/收藏/剪藏** 等意图词时，走此流程。

```
步骤 1: scrape_url(url="https://example.com")
        → 返回 job_id

步骤 2: scrape_progress(job_id=xxx)
        → 轮询（每 2-5 秒），status 判定：
          1  = 完成 → 直接从返回值获取 link_url
          -1 = 失败 → 检查 URL 或重试
          其他 = 进行中 → 继续轮询

步骤 3: 向用户展示 link_url（scrape_progress 完成时已返回）
```

---
## 风险控制

以下工具不可逆，调用前必须向用户确认（详细约束见各工具参考文档的「操作约束」区）：

`cancel_share`

---

## 工具组合速查

| 用户需求 | 推荐工具组合 |
|----------|-------------|
| 将网页内容保存为金山文档 | `scrape_url` → `scrape_progress`（轮询至完成，返回 link_url） |
