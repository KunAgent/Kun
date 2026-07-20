# server/
> L2 | 父级: /Users/rubick/Documents/kun/AGENTS.md

成员清单

auth.ts: Bearer token 鉴权工具，供 routes 入口复用。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
http-server.ts: Fetch-style HTTP dispatcher，连接 router 与 Node server。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
index.ts: server 模块导出入口。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
node-http-server.ts: Node HTTP server 适配层，负责监听端口和请求桥接。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
read-json-body.ts: 带可配置字节上限的流式 JSON 请求体读取与 400/413 错误响应工具，避免无界缓冲。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
response.ts: JSON/text/error response helpers。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
router.ts: 轻量 route matcher，支持 path params 与 method 分发。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
runtime-factory.ts: server composition root，组装模型、工具、memory、review 和 HTTP routes；DeepResearch 注入已批准 Workspace 根目录、免费优先且 DeepSeek 模型联网末级兜底的 Web 搜索级联及 fail-closed 多 Provider 客户端，run 级模型/Provider 贯穿全部研究与写作节点；环境变量可显式关闭模型联网搜索。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
sse.ts: SSE 事件流编码和响应工具。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/approvals.ts: approval gate HTTP routes。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/attachments.ts: attachment upload/download routes。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/debug-llm.ts: LLM round debug routes。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/events.ts: runtime event stream/replay routes。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/health.ts: health check route。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/index.ts: HTTP route registry，挂载 sessions、turns、research、usage 等端点。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/memory.ts: memory CRUD/search routes。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/research.ts: DeepResearch HTTP routes，严格校验有界 create DTO/活跃极端保护并处理 create/list/get/scope/approve/cancel 请求；旧轮次字段仅兼容接收，进入预算解析时丢弃。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/review.ts: review service routes。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/runtime-error.ts: route error normalization helpers。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/runtime-info.ts: runtime info/capability diagnostics route。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/server-runtime.ts: ServerRuntime 结构类型，描述 routes 可访问的 runtime 能力。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/sessions.ts: session list/get/archive/fork/resume routes。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/skills.ts: skill listing and metadata routes。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/threads.ts: thread CRUD/search routes。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/turns.ts: turn creation/cancel/resume routes。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/usage.ts: usage snapshot routes。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/user-inputs.ts: structured user input resolution routes。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
routes/workspace.ts: workspace status/inspection routes。[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

法则: 成员完整·一行一文件·父级链接·技术词前置
