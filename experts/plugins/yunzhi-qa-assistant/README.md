# 腾讯云知识问答专家

基于腾讯云知（乐享）知识库的检索增强问答专家，封装乐享 MCP 的语义向量检索能力（`search_kb_embedding_search`），提供端到端的「权限校验 → 查询改写 → 并行检索 → 引用式回答」流水线。

## 类型

Agent 型（单专家）

## 功能

- **MCP 权限判断**：调用 `whoami` 校验是否绑定乐享 MCP 个人 Token；未绑定 / 401 时按规范话术引导用户去 `https://lexiangla.com/mcp?company_from=CSIG` 获取 LEXIANG_TOKEN（默认 `COMPANY_FROM=CSIG`，无需用户提供）。
- **查询改写与泛化**：覆盖主关键词保留、缩写补全、子问题拆解、意图补全、同义词扩展、时间语义转换共 6 条规则，输出 3~6 条并行检索 Query。
- **并行语义检索**：每次问答默认且仅调用 `mcp__lexiang__search_kb_embedding_search` 进行多路召回；**仅在 embedding 完全无召回 / 全部低相关 / 缺精确实体命中时**，才兜底启用 `search_kb_search` 关键词检索。按 `target_id` 去重并按相关性过滤排序。
- **引用式答案生成**：严格基于检索片段，使用 `[citation:X]` 内联引用，输出结构化 Markdown，附文档标题与原文链接。
- **拒答策略**：知识库无相关结果则回复“未检索到相关内容”，不可使用联网检索功能。

## 技能

| 技能名 | 说明 |
|--------|------|
| `yunzhi-qa` | 云知知识问答能力封装，包含查询改写、答案生成、整体架构三份参考文档 |

## 使用示例

- WorkBuddy售前介绍资料
- 腾讯云在海外金融行业的客户案例有哪些
- 腾讯云智能体开发平台相比竞对产品有哪些优势?

## 头像

头像已自动生成在 `avatars/` 目录下。如需替换为自定义头像，要求：

- 格式：PNG（推荐）或 JPG
- 尺寸：512×512 px
- 大小：单张不超过 500KB

## 打包

```bash
zip -r yunzhi-qa-assistant.zip yunzhi-qa-assistant/
```
