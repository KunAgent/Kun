# 论文模式：多源论文搜索与 Agent 检索计划

> 状态：计划文档（2026-09-26）。P0 已在 `227fad596` 落地，P1-P5 待实现。
> 适用范围：Work 论文模式（`workSurface: 'papers'`）、Kun `paper_search` 工具、主进程论文服务。

## 1. 目标

把“找论文”从单一来源的发现页，升级为一套统一的检索能力：

1. **一个引擎，两种入口**：GUI 搜索页和 Agent 工具调用同一份多源检索实现，结果一致。
2. **Agent 是主角**：用户用自然语言描述研究问题，Agent 负责拆解检索式、多轮检索、引文扩展、阅读摘要、筛选排序，最后产出可一键入库的结构化论文清单。
3. **免费优先、来源透明**：默认只用无需 key 的公开来源；可选 key 只用于提高限额；每个来源的成功/失败/耗时都对用户可见。
4. **检索到阅读闭环**：结果可以直接导入文献库、拿到开放获取 PDF、送进对话上下文、导出 BibTeX、订阅成每日推送。

非目标：不接 Sci-Hub 等来源不合规的下载渠道；不做付费数据库（IEEE/ACM 仅保留接口占位）；不在渲染进程直接发外部请求。

## 2. 现状（P0，已完成）

| 层 | 位置 | 内容 |
|---|---|---|
| 检索引擎 | `kun/src/services/paper-search/` | 7 个来源连接器 + 并发调度 + 合并排序 + 模型输出格式化 |
| Agent 工具 | `kun/src/adapters/tool/paper-search-tool-provider.ts` | `paper_search`，仅在 `agentSurface === 'write'` 时下发 |
| 注册 | `kun/src/server/runtime-composition-registry.ts`、`runtime-composition-config.ts` | 启动与设置热更新两处都要注册 |
| 主进程 | `src/main/services/paper/paper-search-service.ts` | 走应用代理调用同一引擎；IPC `paper-discover:search` |
| 共享类型 | `src/shared/paper/paper-search.ts` | 从 kun 重导出类型与来源常量 |
| GUI | `src/renderer/src/components/paper/discover/PaperSearchView.tsx`、`PaperSearchResults.tsx` | 搜索页、来源开关、年份、排序、导入、“Agent 深度搜索”按钮 |

已接来源与实测情况（2026-09）：

| 来源 id | 接口 | 摘要 | 引用数 | 备注 |
|---|---|---|---|---|
| `arxiv` | export.arxiv.org Atom API | 有 | 无 | 词项 AND 组合，支持 submittedDate 年份过滤 |
| `openalex` | `works?filter=title_and_abstract.search:` | 有（倒排索引还原） | 有 | `search=` 已变为全文检索，噪声大，不要用 |
| `semantic_scholar` | graph/v1 paper/search | 有 | 有 | 无 key 常见 429；已做一次延迟重试；env `KUN_SEMANTIC_SCHOLAR_API_KEY` |
| `venues` | papers.cool `/venue/search` | 有 | 无 | ICLR/NeurIPS/ICML/ACL/CVPR 等录用论文 |
| `paperscool` | papers.cool `/arxiv/search` | 有 | 无 | 与 arXiv 互补，排序不同 |
| `crossref` | `works?query.bibliographic=` | 部分（JATS） | 有 | 全学科，相关性一般，默认关闭 |
| `europepmc` | REST search, resultType=core | 有 | 有 | 生物医学，默认关闭 |

合并规则：DOI → arXiv id → papers.cool id → 归一化标题，任一命中即合并；分数用 RRF（k=60），多来源共同靠前的论文排名更高。

已知缺口：

- Agent 的最终结果只是对话里的文字，不能一键导入；`paper_search` 的工具卡片显示原始文本。
- 没有引文扩展（references / citations），Agent 只能靠关键词检索。
- 来源 key、启用状态只能靠环境变量，没有设置界面。
- 没有缓存和按域名限速，Agent 连续调用容易触发 429。
- DOI 导入只用 Crossref 给的 PDF 链接，开放获取 PDF 命中率低。
- dblp 接口被反爬页面拦截，未接入。

## 3. 总体架构

```
Renderer 搜索页 ──IPC paper-discover:*──> main paper-search-service ─┐
                                                                     ├─> kun/src/services/paper-search (引擎)
Kun agent loop ──tool call──> paper_* tools ─────────────────────────┘        │
      │                                                                        ├─ sources/*   (连接器)
      └─ paper_report ──tool result meta.paperList──> kun-mapper ──> 对话 paper-list 块   ├─ cache / rate limit
                                                                               └─ oa-resolver (P3)
```

原则：

- 引擎代码只依赖 `fetch`，不依赖 Electron 或 Kun 运行时，方便两边复用和单测。
- 所有外部请求在 main 或 Kun 进程；渲染进程只拿结构化结果。
- 工具 schema 只在 Work 界面下发，保持 Code/Design 的稳定前缀和缓存命中不受影响。
- 新增来源只改 `kun/src/services/paper-search/`，GUI 从 `PAPER_SEARCH_SOURCES` 自动生成开关。

## 4. 分阶段计划

### P1 Agent 结果结构化（最高优先级）

目标：Agent 检索的过程和结论在对话里以论文卡片呈现，可勾选、批量导入、在搜索页打开。

#### P1.1 `paper_search` 工具结果带结构化元数据

- 工具输出改为对象：`{ text: string, papers: PaperSearchHit[], sources: PaperSearchSourceReport[] }`。
  - `text` 仍是 `formatPaperSearchForModel` 的紧凑文本，保证模型读到的内容和 token 量不变。
  - 需要确认 `local-tool-host-runtime.ts` 对对象输出的序列化方式：若对象会被 `JSON.stringify` 整体送进模型，就改为把结构化部分放进工具结果的 `meta`（参照 `render_chart` 的 `chartSpec` 链路），`output` 只保留文本。
- `papers` 只保留卡片需要的字段，摘要截断到 600 字，单次最多 40 条，避免事件文件膨胀（参考 `RuntimeEventRecorder` 的体积约束）。

#### P1.2 新工具 `paper_report`

Agent 在检索结束时调用，提交最终推荐清单：

```ts
// input schema
{
  title?: string,               // 清单标题，如 "Repository-level code agents 核心论文"
  summary?: string,             // 2-3 句方向概括（Markdown）
  papers: Array<{
    id: string,                 // arXiv id / DOI / papers.cool id，必须来自本轮 paper_search 结果
    title: string,
    reason: string,             // 一句话推荐理由
    group?: string,             // 可选分组：基础工作 / 方法 / 基准 / 综述
    priority?: 'must' | 'should' | 'optional'
  }>                            // 1-30 篇
}
```

- 执行时用本轮 `paper_search` 缓存（P2.3）补全作者、年份、venue、摘要、PDF；找不到的 id 标记为未验证，不静默丢弃。
- 输出 `meta.paperList`；模型侧只回一行确认，不重复整张清单。
- `shouldAdvertise` 同 `paper_search`。工具描述里说明：必须先用 `paper_search` 检索，id 不能编造。

#### P1.3 渲染链路

参照图表块的实现：

1. `src/renderer/src/agent/paper-list-adapter.ts`：`paperListFromToolItem(item)`，做第二道 zod 校验，与 `chart-spec-adapter.ts` 同构。
2. `src/renderer/src/agent/kun-mapper-events.ts`：工具结果事件中识别 `paper_report`，带出 `meta.paperList`。
3. `src/renderer/src/store/chat-projection-reducer.ts`：新增 `kind: 'paper-list'` 块；`src/renderer/src/agent/types.ts` 增加类型。
4. `src/renderer/src/components/chat/derive-turn-sections.ts`：新块参与排序，位置与图表块一致。
5. `src/renderer/src/components/chat/PaperListBlock.tsx`（新）：
   - 顶部是标题、概括、“全部导入”和“在搜索页打开”；
   - 卡片按分组展示，含标题、作者、年份·venue、推荐理由、优先级标记、导入按钮、已在库中标记；
   - 支持勾选后批量导入，导入进度复用 `paper-jobs` 的任务环。
6. `paper_search` 的工具卡片：展开后显示紧凑结果列表（标题 + 来源 + 导入），默认折叠，只显示“检索 xxx · 3 个来源 · 24 篇”。

#### P1.4 搜索页的 Agent 模式

- `PaperSearchView` 顶部增加“快速搜索 / Agent 检索”两个标签。
- 点击“Agent 深度搜索”后：记录 `{ threadId, turnId }` 到 `usePaperModeStore.discover.agentSearch`；页面显示该回合的实时进度（已执行的检索式、每轮返回数量），数据来自现有 SSE 事件流，不新建通道。
- 回合结束且有 `paper-list` 块时，在搜索页 Agent 标签中渲染同一个 `PaperListBlock`。
- 助手面板未打开时自动打开，替代现在的“请先打开右侧对话面板”提示。

验收：

- 输入“帮我找 2024 年以来关于仓库级代码 Agent 修复 issue 的论文”，Agent 至少执行 3 次 `paper_search`，最后调用 `paper_report`，对话中出现可批量导入的卡片列表。
- 刷新或重开会话后，清单卡片能从事件重放中恢复。
- `paper_report` 中不存在的 id 显示“未验证”，不会导入失败后静默消失。

测试：adapter 解析单测、projection reducer 单测（新增、重放、覆盖）、`paper_report` 工具执行单测（补全、未验证 id）、PaperListBlock 交互单测。

### P2 来源、稳定性与设置

#### P2.1 新来源

| 来源 id | 接口 | 价值 | 注意 |
|---|---|---|---|
| `openreview` | api2.openreview.net `notes/search` | ICLR 等投稿和评审，含 withdrawn/rejected | 需要区分 venue 状态；限速 |
| `pubmed` | E-utilities esearch + efetch | 生物医学权威来源，带 MeSH | efetch XML 取摘要；无 key 3 req/s |
| `dblp` | dblp search API | CS 会议覆盖最全 | 目前被反爬页拦截；先做可用性探测，失败则在来源列表中显示“不可用”，不进默认 |
| `hal` | api.archives-ouvertes.fr | 法国开放仓储，含全文 | — |
| `zenodo` | zenodo.org/api/records | 数据集、软件、预印本 | 结果类型要过滤为 publication |
| `core` | api.core.ac.uk/v3 | 开放获取全文聚合 | 需要免费 key，未配置时隐藏 |
| `biorxiv` | 通过 Europe PMC `SRC:PPR` 查询 | 预印本 | bioRxiv 官方 API 不支持关键词检索 |

每个连接器：`paper-search-<source>.ts`，导出连接器函数和纯解析函数，解析函数用录制的真实响应片段做单测。

#### P2.2 设置与凭据

- 设置结构：`write.paperMode.search`：
  - `enabledSources: PaperSearchSource[]`（搜索页默认勾选）；
  - `semanticScholarApiKey`、`coreApiKey`、`openAlexMailto`、`unpaywallEmail`（邮件类只是 polite pool 标识）。
- key 走现有安全凭据存储，不写进明文 settings；Kun 侧通过 `capabilities.paperSearch` 配置下发，工具 builder 用 getter 读取，热更新生效。
- 设置页：Settings → Work → 论文模式里新增“论文检索”分组，每个来源一行，包括开关、说明、可选 key 输入和“测试连接”按钮（调用一次小查询，显示耗时或错误）。
- 保留 env 变量作为兜底，优先级低于设置。

#### P2.3 缓存与限速

- 引擎内加 `PaperSearchCache`：键为 `source + query + limit + years`，TTL 15 分钟，LRU 200 条；Agent 同一轮重复检索直接命中。
- 按域名令牌桶：Semantic Scholar 1 rps（有 key 时 10 rps），arXiv 1 次/3 秒（官方要求），NCBI 3 rps，其余 5 rps。排队超过来源超时视为失败。
- 连续 429 的来源在 5 分钟内自动降级：搜索页显示“限流中”，Agent 工具结果里提示改用其他来源。
- OpenAlex / Crossref 请求带 `mailto`，进入 polite pool。

#### P2.4 查询质量

- 中文查询：搜索页检测到 CJK 字符时提示“建议用英文关键词”，并提供“翻译为英文检索”按钮，调用现有写作补全模型通道做一次翻译。Agent 路径由模型自行转写。
- 每个来源分别做查询适配：arXiv 去停用词，Crossref 用 `query.bibliographic`，PubMed 保留原始布尔语法。
- 合并时标题相似度从“完全相等”放宽为 token Jaccard ≥ 0.9 且年份差 ≤ 1，减少预印本与正式版重复。

验收：7 个默认来源各自的解析单测；缓存命中单测；限速器单测（假时钟）；设置热更新后工具立即使用新 key。

### P3 开放获取 PDF 与入库

#### P3.1 OA 解析链

新增 `kun/src/services/paper-search/paper-oa-resolver.ts`（纯 fetch，main 复用），按顺序尝试：

1. 结果自带的 `pdfUrl`（arXiv、OpenReview、S2 openAccessPdf、OpenAlex best_oa_location）；
2. arXiv 反查：DOI 对应的 arXiv 版本（OpenAlex locations / S2 externalIds）；
3. Unpaywall `v2/{doi}?email=`（需配置邮箱）；
4. Europe PMC / PMC 全文 PDF；
5. CORE 下载链接（有 key 时）。

- 每一步都校验 `%PDF-` 魔数和大小上限（复用 `paper-http` 的 `expectPdf` 与 `PAPER_PDF_MAX_BYTES`）。
- 对下载的 PDF 做标题一致性检查：取首页文本与标题的 token 相似度，低于阈值则丢弃，防止拿到错的 PDF。

#### P3.2 导入改造

- `paper-unit-service.ts` 的 DOI 分支：Crossref 元数据 + OA 解析链取 PDF；取不到时仍创建只有元数据的单元，并在库里标记“缺 PDF”，可用现有“补下载缺失 PDF”批量补。
- 搜索结果导入时把已有元数据（摘要、venue、引用数、来源）一并传给导入接口，减少重复请求：`paperImport({ input, prefetchedMeta })`，并在 schema 中新增可选字段。
- 批量导入：搜索页和 PaperListBlock 的多选导入，串行执行，复用任务环展示进度；已在库中的跳过。

#### P3.3 去重

- 入库前按 DOI、arXiv id、papers.cool id、标题 + 年份四种方式匹配已有单元（扩展 `findPaperUnitByIds`）。
- 搜索结果的“已在库中”判断同样四路匹配，而不只是 id 相等。

验收：DOI-only 论文（如 ICSE 论文）导入后有 PDF 的比例明显提升（以 20 篇样本对比改造前后）；错配 PDF 被拦截；批量导入 10 篇无重复单元。

### P4 深度检索能力

#### P4.1 `paper_citations` 工具

```ts
{ id: string, direction: 'references' | 'citations', limit?: number, year_from?: number }
```

- 数据源：Semantic Scholar `/paper/{id}/references|citations`，失败时用 OpenAlex `referenced_works` / `cites:` 过滤。
- 输出同 `paper_search` 的紧凑列表格式，并进入同一缓存，`paper_report` 可引用这些 id。
- 典型用法：先检索找到 2-3 篇种子论文，再向前追引用、向后追被引，覆盖关键词检索漏掉的工作。

#### P4.2 `paper_details` 工具

- 输入 id，返回完整摘要、TLDR（S2）、研究领域、venue 全称、开放获取状态、代码链接（从摘要 / Papers with Code 数据提取，可选）。
- 用于 Agent 在推荐前核实细节，避免只凭截断摘要下结论。

#### P4.3 检索 Agent 画像

- 在 `kun/src/delegation/builtin-profiles.ts` 增加 `literature-researcher` 画像：只读，只能用 `paper_search`、`paper_citations`、`paper_details`、`web_fetch`，默认最多 12 步。
- 论文助手在大范围综述时可以并行派出 2-3 个子 Agent，分别负责不同子方向，最后汇总成一个 `paper_report`。
- 搜索页“Agent 检索”的提示词随之更新为：先规划子方向，再决定是否并行委派。

#### P4.4 检索提示词治理

- 把现在写在 i18n 里的 Agent 检索提示词迁到 Kun 的 Work 模式说明中（论文模式片段），GUI 只发送用户问题和范围参数，避免多语言版本不一致。
- 该片段放在动态上下文，不进入稳定前缀。

验收：以 3 个真实研究问题做对比，开启引文扩展后推荐清单的相关论文数不下降，且至少覆盖 1 篇关键词检索未返回的高相关论文；并行委派时总耗时低于串行。

### P5 搜索页体验

- **检索历史**：最近 20 条查询和条件，存在 localStorage，读写包 try/catch。
- **筛选**：只看有 PDF、只看会议论文、最低引用数、按来源过滤；都在已返回结果上即时筛选。
- **多选操作**：批量导入、导出 BibTeX（复用现有导出）、“发给助手”，即把选中论文作为上下文附加到对话。
- **订阅检索**：把当前查询保存为订阅，在“发现 → 订阅”中每天自动跑一次，只显示新增论文，复用 feeds 的存储与 UI。
- **结果详情侧栏**：点击卡片在右侧显示完整摘要、全部作者、所有来源链接、引用数趋势（OpenAlex `counts_by_year`），不跳出应用。
- **键盘**：`/` 聚焦搜索框，`↑` `↓` 移动选中，`Enter` 展开，`i` 导入。
- **空状态和错误**：来源全部失败时给出代理设置入口；单个来源失败时可以点击查看错误详情并单独重试。

验收：窄窗口（900px）下布局不溢出；深色模式下所有标签与卡片可读；所有新文案 7 种语言齐全。

## 5. 文件改动清单（按阶段）

| 阶段 | 新增 | 修改 |
|---|---|---|
| P1 | `kun/src/adapters/tool/paper-report-tool.ts`、`src/renderer/src/agent/paper-list-adapter.ts`、`src/renderer/src/components/chat/PaperListBlock.tsx` | `paper-search-tool-provider.ts`、`kun-mapper-events.ts`、`chat-projection-reducer.ts`、`agent/types.ts`、`derive-turn-sections.ts`、`PaperSearchView.tsx`、`paper-mode-store.ts` |
| P2 | `paper-search-openreview.ts`、`paper-search-pubmed.ts`、`paper-search-hal.ts`、`paper-search-zenodo.ts`、`paper-search-core.ts`、`paper-search-cache.ts`、`paper-search-rate-limit.ts`、设置分组组件 | `paper-search-types.ts`、`paper-search.ts`、`app-settings-paper-mode.ts`、`app-settings-kun.ts`、kun `contracts/capabilities*.ts`、两处注册 |
| P3 | `paper-oa-resolver.ts` | `paper-unit-service.ts`、`paper-reader.ts`（IPC schema）、`PaperDiscoverParts.tsx`（批量导入） |
| P4 | `paper-citations-tool.ts`、`paper-details-tool.ts` | `builtin-profiles.ts`、`kun/src/loop/work-mode.ts` |
| P5 | `PaperSearchFilters.tsx`、`PaperSearchDetailPane.tsx` | `PaperSearchView.tsx`、`PaperSearchResults.tsx`、feeds 相关存储 |

所有文件保持 700 行以内；`PaperSearchView.tsx` 在 P1.4 后接近上限时，把 Agent 标签拆成 `PaperAgentSearchPane.tsx`。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 公共 API 限流或条款变化 | 令牌桶 + 缓存 + 自动降级；来源失败只影响自身；设置里可单独关闭 |
| 抓取 papers.cool HTML 结构变动 | 解析函数有真实片段单测；解析为空时报“结构变化”而不是“0 结果” |
| 工具输出过大拖慢事件回放 | 结构化字段裁剪和条数上限；大结果走 artifact 通道 |
| Agent 编造 id | `paper_report` 只接受本轮检索出现过的 id，其余标记未验证 |
| 下载到错误 PDF | 标题一致性校验 + 魔数校验 |
| 工具 schema 影响缓存命中 | 仅 Work 界面下发；schema 固定，不含动态内容 |
| 主进程直接引用 kun 源码 | 引擎目录只依赖标准 `fetch`，禁止引入 Kun 运行时模块，并加 lint 约束或单测守卫 |

## 7. 验证方式

- 每个阶段：`npm run typecheck`、相关 vitest、`npm run build:kun`、`npm run check:file-lines`、`npm run lint`。
- 连接器：纯解析函数离线单测 + 一个手动运行的实时冒烟脚本（不进 CI），输出每个来源的数量和耗时。
- GUI：重启 `npm run dev` 后在论文模式实际验证搜索页、Agent 检索、对话卡片、导入、深色模式和窄窗口。
- Agent 质量：固定 3 个研究问题做回归样本，记录检索次数、推荐篇数、人工判定的相关率，改提示词或工具时对比。

## 8. 建议顺序与工作量

| 顺序 | 内容 | 预估 |
|---|---|---|
| 1 | P1.1-P1.3 结构化结果与对话卡片 | 1.5 天 |
| 2 | P2.3 缓存与限速、P2.2 设置与凭据 | 1.5 天 |
| 3 | P1.4 搜索页 Agent 模式 | 1 天 |
| 4 | P3 OA PDF 与批量导入 | 1.5 天 |
| 5 | P4.1-P4.2 引文扩展与详情工具 | 1 天 |
| 6 | P2.1 新来源（OpenReview、PubMed 优先） | 1.5 天 |
| 7 | P4.3-P4.4 检索 Agent 画像与提示词治理 | 1 天 |
| 8 | P5 搜索页体验 | 2 天 |

先做 1-3，Agent 检索就能完整闭环：检索、筛选、结构化清单、一键入库。其余按使用反馈推进。
