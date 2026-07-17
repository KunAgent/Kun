# Agent 整体架构

> 腾讯云知识问答专家的端到端流水线说明。

---

## 总览

```
用户原始问题
    ↓
[Phase 1] MCP 权限判断
    ├─ 已绑定 → 进入 Phase 2
    ├─ 401 / 过期 → 引导续期，终止
    └─ 未绑定 → 仅引导用户通过 https://lexiangla.com/mcp?company_from=CSIG 获取 LEXIANG_TOKEN，终止
    ↓
[Phase 2] 问题泛化模块（生成多个检索 Query）
    ├─ 主关键词保留
    ├─ 缩写补全
    ├─ 子问题拆解
    ├─ 意图补全
    ├─ 同义词扩展
    └─ 时间语义转换
    ↓
[Phase 3] 检索模块（embedding 优先 → keyword 兜底）
    ├─ ① search_kb_embedding_search（语义向量，每次都先跑）
    ├─ ② 判断：是否所有 Query 都无召回 / 全部低相关 / 缺少精确实体命中？
    │     ├─ 否 → 直接进入排序过滤
    │     └─ 是 → 启用 search_kb_search（关键词）兜底
    └─ ③ entry_describe_ai_parse_content（精读高分召回，按需）
    ↓
[结果排序与过滤] Rerank、按 target_id 去重、相关性阈值过滤
    ↓
[Phase 4] 总结生成模块
    ├─ 严格基于检索结果
    ├─ [citation:X] 内联引用
    ├─ 结构化 Markdown 输出
    └─ 附文档标题 + 原文链接
    ↓
[拒答策略]
    └─ 知识库无结果 / 全部低于阈值 → 直接拒答（禁止使用联网搜索兜底）
```

---

## Phase 1：MCP 权限判断（前置门禁）

### 检测方法

按以下优先级尝试：

1. 调用 `mcp__lexiang__whoami`（成功即通过）。
2. 若客户端未暴露 `mcp__lexiang__*` 工具，使用 Streamable HTTP JSON-RPC 直连：
   ```python
   import requests, json, os
   url = "https://mcp.lexiang-app.com/mcp?company_from=<COMPANY_FROM>"
   headers = {"Authorization": f"Bearer {os.environ['LEXIANG_TOKEN']}"}
   payload = {"jsonrpc":"2.0","id":1,"method":"tools/call",
              "params":{"name":"whoami","arguments":{}}}
   resp = requests.post(url, headers=headers, json=payload, timeout=10)
   ```

### 三种结果分支

#### ✅ 成功（200 + 用户信息）

记录返回的 `company.company_domain`（用于后续生成原文链接），简短播报：

```
✅ 乐享 MCP 已就绪
👤 当前用户：{name}
🏢 绑定企业：{company_name}
```

#### ❌ 401 / Token 过期

```
🔒 检测到乐享 MCP 令牌已过期或无效。
请打开链接，点击「续期」按钮重新获取 LEXIANG_TOKEN：
https://lexiangla.com/mcp?company_from=CSIG

完成续期后，把新的 LEXIANG_TOKEN 告诉我即可。
```

#### ❌ 工具不存在 / 未配置 / 连接失败

仅简洁提示用户去查询 Token，**不要回显完整的 mcp.json 配置块**：

```
⚠️ 你尚未绑定乐享（云知）MCP，无法检索知识库。

请打开下方链接获取你的 LEXIANG_TOKEN（lxmcp_ 开头）：
https://lexiangla.com/mcp?company_from=CSIG

拿到 Token 后告诉我，我会帮你完成绑定（默认 COMPANY_FROM=CSIG）。
```

> ⚠️ **绝不**回显完整 Token，**也不要**主动展示 mcp.json 配置块。
> 默认 `COMPANY_FROM=CSIG`，无需让用户提供。

---

## Phase 2：问题泛化模块

详见 [`query-rewriting.md`](./query-rewriting.md)。

**最低质量门槛**：

- 至少 3 条 Query；
- 至少覆盖 1 次缩写补全（若问题含缩写）；
- 至少覆盖 1 次同义词扩展；
- 时间相关问题必须做时间语义转换。

---

## Phase 3：检索模块（embedding 优先，keyword 兜底）

### 工具优先级（强约束 · 2026-05-18 更新）

| 优先级 | 工具 | 触发条件 |
|--------|------|----------|
| **P0：默认首选** | `mcp__lexiang__search_kb_embedding_search` | **每次问答都先且仅跑这一个工具**，对 Phase 2 产出的多条 Query 并行调用 |
| **P1：兜底** | `mcp__lexiang__search_kb_search` | **仅在以下条件成立时启用**：① embedding 对所有 Query 都返回空 chunks；或 ② 召回全部低相关 / 与问题无关；或 ③ 用户问题含精确产品名 / 错误码 / API 名 / 文件名，但 embedding 召回里没有这类精确命中 |
| **P2：精读** | `mcp__lexiang__entry_describe_ai_parse_content` | 高分片段不足以回答时，对前 3~5 个 entry 精读正文 |
| **P2：元信息** | `mcp__lexiang__entry_describe_entry` | 需要确认 entry_type / extension / target_id 时使用 |

> ⚠️ **不要默认并行跑两路检索**——除非满足上面的兜底触发条件，否则只跑 embedding_search。
> 这一规则的目的：减少 token / 上下文浪费，提高检索专注度。

### 批量执行（合并执行策略）

为避免逐条审批中断用户，**必须**把多 Query 检索合并为一次脚本执行，例如：

```python
# 伪代码：默认只跑 embedding；按条件判断是否兜底 keyword
queries = [...]  # Phase 2 产出
all_hits = []
for q in queries:
    # ⚠️ 必须：
    #   1) filters.keyword 包装 query
    #   2) _mcp_fields 强制必传 JSON 数组，追加 chunks.content 才能拿到正文片段
    #      默认只返回 chunks.target_type / chunks.target_id / chunks.entry_id
    hits = call_mcp("search_kb_embedding_search", {
        "filters": {"keyword": q},
        "limit": 10,
        "_mcp_fields": ["@default", "chunks.content"],
    })
    all_hits.extend(hits)

# 去重（按 target_id 合并 content 片段，保留最长/最相关的一条）
dedup = {}
for h in all_hits:
    k = h["target_id"]
    if k not in dedup or len(h.get("content", "")) > len(dedup[k].get("content", "")):
        dedup[k] = h
top = list(dedup.values())[:10]

# 兜底触发：只有 embedding 完全没命中或全部低相关，才启用 keyword 检索
need_fallback = (
    len(top) == 0
    or all(not (h.get("content") or "").strip() for h in top)
    or has_precise_entity_but_no_match(queries, top)
)
if need_fallback:
    for q in queries:
        # keyword 接口的 docs.title 默认就返回，但 docs.content 仍需显式追加
        kw_hits = call_mcp("search_kb_search", {
            "keyword": q,
            "limit": 10,
            "highlight": True,
            "_mcp_fields": ["@default", "docs.content"],
        })
        # ... 合并去重排序
```

### `_mcp_fields` 与默认字段速查

> 来源：`mcp__lexiang__get_tool_schema` 实测，2026-05-19 校准。

| 接口 | Default Returned（不传 `_mcp_fields` 也能拿） | 必须显式追加才能拿 |
|---|---|---|
| `search_kb_embedding_search` | `chunks.target_type`、`chunks.target_id`、`chunks.entry_id`、`next_page_token`、`prev_page_token` | **`chunks.content`**（命中片段正文，必须追加） |
| `search_kb_search` | `docs.id`、`docs.title`、`docs.target_type`、`docs.target_id`、`docs.space_id`、`docs.team_id`、`docs.created_at`、`docs.edited_at`、`docs.has_breadcrumb`、`docs.parse_status.*`、`total`、`took`、`page_token`、`team`、`space`、`breadcrumbs` | **`docs.content`**（正文）；另可按需追加 `docs.file_type`、`docs.tags` 等 |

调用方式（强制）：

- `_mcp_fields` 必须是 **JSON 数组**（不是 JSON 字符串）：`["@default", "chunks.content"]`
- `@default` 保留默认字段 + 追加项；不写 `@default` 会**只返回**列出的字段
- 想看完整 Output Fields，直接调 `mcp__lexiang__get_tool_schema`

### 链接生成

> 🎯 **核心规则**：按 `target_type` 区分**云知 1.0**（旧版团队文档）和**云知 2.0**（乐享 AI 知识库）两套 URL 模板。
> ❌ **不要用** `/teams/{team_id}/docs/{xxx}` 这种早期 docs 文档模板——实测对 `kb_file` / `kb_video` 类型 404。

| `target_type` | 文档版本 | 推荐 URL |
|---------------|---------|----------|
| `disknode` | **云知 1.0**（旧版团队文档 / 网盘节点） | `https://{domain}/docs/{target_id}` |
| `kb_entry` | **云知 2.0**（乐享 AI 知识库条目；含 page/file/video/folder） | `https://{domain}/pages/{target_id}` |
| `kb_smartsheet` | 云知 2.0 智能表 | `https://{domain}/pages/{target_id}` |
| `attachment` | 附件 | 不直接出查看 URL，调附件下载接口 |
| `ai_external_doc` | 外部抓取的公开文档（如腾讯云官网） | 用原文档自带 URL，或不附链接 |

其中 `{target_id}` = `search_kb_*` 返回的 `chunks[].target_id`。

⚠️ `entry_describe_entry` 返回的 `entry.target_id` 对 `kb_file` 是底层存储 file_id（与 `entry.id` 不同），**只用于附件下载等内部接口**，不能拿来拼查看页 URL。

⚠️ 同一文档可能既以 `disknode` 又以 `kb_entry` 形式被召回（同步双轨期），此时两条都是有效链接，但优先用 `kb_entry`（2.0）版本。

`{domain}` 取自 Phase 1 的 `whoami` 返回；缺失默认 `https://csig.lexiangla.com`。

`{domain}` 取自 Phase 1 的 `whoami` 返回；缺失默认 `https://csig.lexiangla.com`。

### 错误兜底

| 错误 | 处理 |
|------|------|
| 401 | 回到 Phase 1 引导续期 |
| `tool_search` 返回碎片化 JSON | 改用全限定名 `mcp__lexiang__search_kb_embedding_search` 直接调用 |
| 客户端未暴露 mcp 工具 | 走 Streamable HTTP JSON-RPC 兜底链路 |
| 召回为空 / 全部低分 | 转 Phase 4 的「拒答策略」（禁止联网搜索） |

---

## Phase 4：总结生成模块

详见 [`answer-generation.md`](./answer-generation.md)。

**最低质量门槛**：

- 关键论点 100% 有 `[citation:X]`；
- 链接 100% 来自检索返回，无虚构；
- 对比题强制表格、步骤题强制有序列表；
- 输出末尾必须有「参考资料」+「信息来源说明」两个区块。

---

## 拒答策略

当 Phase 3 的相关性整体偏低（例如 top1 score 也不达标），或召回为空时：

1. **直接拒答**，明确告知用户："抱歉，我在你绑定的乐享知识库中未检索到与该问题直接相关的内容。"
2. 给出建设性建议：换用更具体的关键词重新提问，或确认资料是否已上传至当前知识库。
3. **严禁调用 WebSearch / WebFetch 等联网工具兜底**。
4. **严禁基于通用知识凭空作答 / 编造**。
