---
name: yunzhi-qa
description: |
  Tencent Yunzhi (Lexiang) knowledge base Q&A capability. Wraps the lexiang MCP `search_kb_embedding_search` tool with query rewriting, parallel retrieval, dedup, citation-grounded answer generation. When the knowledge base has no relevant hits, explicitly refuses to answer (no web search fallback). Activates whenever the user asks a question that should be answered from the bound Lexiang knowledge base.
  触发词：云知问答、乐享检索、知识库问答、kb_embedding_search、search_kb_embedding_search、查知识库、问知识库、检索增强、RAG、citation
---

# 腾讯云知识问答专家能力（Tencent Yunzhi Knowledge Q&A Expert）

## 功能说明

封装腾讯云知（乐享）MCP 的 **语义向量搜索** 能力（`search_kb_embedding_search`），并叠加：

- **MCP 权限判断**：调用 `whoami` 校验绑定状态，未绑定/过期时按规范引导用户。
- **查询改写与泛化**：缩写补全、子问题拆解、意图补全、同义词扩展、时间语义转换。
- **并行召回与去重**：多 Query 并发检索 → 按 `target_id` 去重 → 相关性过滤。
- **引用式答案生成**：基于检索片段产出带 `[citation:X]` 的结构化 Markdown 回答，附文档标题与原文链接。
- **拒答策略**：知识库无相关结果时直接拒答（明确告知"未在乐享知识库检索到相关内容"），**禁止使用联网搜索兜底**，**禁止基于通用知识凭空作答**。

## 调用方式

主要调用全限定名工具（建议直接调用，避免 `tool_search` 长参数碎片化）：

| 优先级 | 工具 | 用途 |
|--------|------|------|
| **P0（默认首选）** | `mcp__lexiang__whoami` | 前置门禁：校验 MCP 是否就绪、获取 `company_domain` |
| **P0（默认首选）** | `mcp__lexiang__search_kb_embedding_search` | **语义向量检索（每次问答的默认且唯一首选检索工具）**。**必传 `_mcp_fields` 才能拿到正文片段**：`{"filters": {"keyword": "<query>"}, "limit": 10, "_mcp_fields": ["@default", "chunks.content"]}`。⚠️ `_mcp_fields` 是 **JSON 数组**（不是字符串）；默认返回只含 `chunks.target_type / chunks.target_id / chunks.entry_id`，**不带 content 也不带 title**，必须显式列出 `chunks.content`。 |
| **P1（仅作兜底）** | `mcp__lexiang__search_kb_search` | 关键词检索。**仅在 embedding_search 对所有 Query 都返回空 / 全部低相关时**作为兜底使用，不在常规流程中并行调用。**必传 `_mcp_fields` + `highlight`**：`{"keyword": "<query>", "limit": 10, "highlight": true, "_mcp_fields": ["@default", "docs.content"]}`。说明：`docs.title` 在 keyword 接口里属于 Default Returned，不必额外列出；但 `docs.content` 仍需追加。 |
| **P2（按需精读）** | `mcp__lexiang__entry_describe_ai_parse_content` | 精读 Phase 3 高分召回的正文（可选，召回片段不足时启用）；**仅对 `target_type=kb_entry` 调用，disknode 会 403**。 |
| **P2（按需精读）** | `mcp__lexiang__entry_describe_entry` | 拿条目元信息（标题 `entry.name` / `entry_type` / `extension`），用于答案佐证。⚠️ 工具名是 `entry_describe_entry`，**不是** `entry_describe`。 |

### `_mcp_fields` 使用规范（强制）

1. 任何 search 工具调用都**必须**传 `_mcp_fields`，否则只返回定位字段，Phase 4 无内容可引用。
2. **类型必须是 JSON 数组**：`["@default", "chunks.content"]`；不要传 JSON 字符串 `"[\"@default\",\"chunks.content\"]"`（不生效）。
3. `@default` 保留 schema 标记为 Default Returned 的所有字段，再追加你需要的非默认字段。
4. 想看某工具的完整 Output Fields，直接调 `mcp__lexiang__get_tool_schema`，输出表里 `Default Returned=✅` 的就是默认会回的，未打勾的需要显式列入 `_mcp_fields`。

### 工具调用优先级规则（强约束）

1. **第一步永远是** `whoami`，没通过不进入检索。
2. **常规检索阶段只跑** `search_kb_embedding_search`，对 Phase 2 产出的多条 Query **批量并行调用一次**，去重排序后判断结果。
3. **是否启用 `search_kb_search` 兜底，按以下条件判断（满足任一即启用）**：
   - `search_kb_embedding_search` 对**所有 Query** 都返回 `chunks=[]`（彻底无召回）；
   - 或召回总数虽 > 0，但**全部相关性极低** / 与问题主题明显无关（典型表现：全是同名混淆词、无任何关键 entity 命中）；
   - 或用户问题包含**精确的产品名 / 错误码 / API 名 / 文件名**这类适合 BM25 的强字面信号，且 embedding 召回里**没有**这类精确命中。
4. **不要默认并行跑两路检索**，避免重复消耗 token / 上下文。
5. 兜底后仍无结果 → 进入 Phase 4 的「拒答策略」（**禁止启用联网搜索**）。

## 参考资料

- 查询改写完整规则：`@references/query-rewriting.md`
- 答案生成与引用规则：`@references/answer-generation.md`
- 整体 Agent 流水线说明：`@references/agent-architecture.md`

## 输出格式

Markdown 结构，必须包含：

1. **简明结论**：1~3 句直击问题核心，关键处带 `[citation:X]`。
2. **详细说明**：按需段落 / 列表 / 表格，**对比题用表格**，**步骤题用有序列表**。
3. **参考资料**：每条 `[citation:X]` 列出文档标题 + 原文链接（必要时附 1~2 行片段）。
4. **信息来源说明**：标注命中文档数；明确"仅基于乐享知识库（不使用联网搜索）"。

## 注意事项

1. **未绑定 MCP / 401 时不得继续检索**，按 `references/agent-architecture.md` 中的话术引导。**默认 `COMPANY_FROM=CSIG`**，未绑定时仅引导用户通过 `https://lexiangla.com/mcp?company_from=CSIG` 获取 `LEXIANG_TOKEN`，**无需让用户提供 COMPANY_FROM**，**也不要回显完整的 mcp.json 配置块**。
2. **改写阶段必须覆盖**：缩写补全 + 子问题拆解 + 同义词扩展（缺一不可）。
3. **链接生成（⚠️ 按 target_type 区分云知 1.0 / 2.0 两套规则）**：

   | `target_type` | 文档版本 | URL 模板 |
   |---|---|---|
   | `disknode` | **云知 1.0**（旧版团队文档/网盘节点） | `https://{domain}/docs/{target_id}` |
   | `kb_entry` | **云知 2.0**（乐享 AI 知识库条目，含 page/file/video/folder） | `https://{domain}/pages/{target_id}` |
   | `kb_smartsheet` | 云知 2.0 智能表 | `https://{domain}/pages/{target_id}` |
   | `attachment` | 附件 | 按需调附件下载接口，不直接出查看 URL |
   | `ai_external_doc` | **外部抓取的文档**（如 cloud.tencent.com 等公开来源） | 不属于云知体系，应使用原文档自带 URL 或不附链接 |

   - `{target_id}` 取 search 返回的 `chunks[].target_id`；`{domain}` 取自 `whoami` 返回的 `company.company_domain`，缺失默认 `https://csig.lexiangla.com`。
   - **绝对不要使用** `https://{domain}/teams/{team_id}/docs/{xxx}` 这种模板（实测 404）。
   - `entry_describe_entry` 返回的 `entry.target_id` 对 `kb_file` 是底层存储 file_id（≠ entry.id），**只用于附件下载等内部接口，不能拼查看页 URL**。
   - 兜底原则：若 target_type 未在上表中且需要给链接，优先尝试 `/pages/{target_id}`（云知 2.0 会自动重定向）。
4. **批量检索合并执行**：多 Query 在一次脚本中完成，避免逐条审批。
5. **港澳台 / 政治敏感问题** 直接拒答，不进入检索流程。
6. **不得回显完整 Token**。
7. **拒答优先于联网兜底**：知识库召回为空 / 全部低相关时，直接拒答，**禁止调用 WebSearch / WebFetch 等联网工具**。
