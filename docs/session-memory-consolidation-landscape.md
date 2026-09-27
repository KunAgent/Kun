# 历史会话沉淀与存储回收方案调研

> 调研日期：2026-09-27
> 范围：长期对话记忆、会话摘要、Agent memory、历史会话归档/删除、来源证据和长期记忆评测。
> 说明：网上不存在一个统一实现“把旧聊天压缩成知识库并删除原始会话”的标准方案。本文选择了具有代表性的论文、开源项目、基础设施和产品实践，重点比较它们如何处理“保留什么、如何召回、原始数据是否删除”。

## 结论先行

1. 大多数长期记忆系统优化的是“未来能否找回有用信息”，不是“如何释放原始聊天的磁盘空间”。它们通常把原始事件保留为来源、episodic memory 或 recall storage，再额外生成 facts、profile、summary 或 graph。
2. 最常见的成熟形态是双层或多层：
   - 短期层：最近消息、当前线程、工作上下文；
   - 长期层：session episode、事实/偏好、实体关系、用户画像或可检索的原始片段。
3. 真正安全的删除通常不是记忆系统自动决定的，而是独立的数据保留产品能力：用户控制、来源删除、TTL、合规策略、回收审计和可恢复窗口。
4. A-MEM 很适合指导 Kun 的后续“记忆关系与演化”阶段，但它主要解决记忆节点的动态组织、链接和演化，没有直接解决本项目的 thread 目录回收、崩溃恢复、删除幂等和用户审批。
5. 对 Kun 来说，最稳妥的边界仍然是：session 层拥有候选选择、沉淀、checkpoint、回收和 job；Memory 层只提供现有公共写入/读取能力。Tier-1 safe reclaim 可以先做灰度，Tier-2 整体删除应保持显式 opt-in。

## 比较维度

本文对每个方案统一看六件事：

- **触发**：实时、模型主动调用、窗口超限、会话结束，还是后台定时。
- **记忆单元**：turn、segment、session episode、fact、profile、graph node/edge。
- **来源证据**：是否能追溯到原始会话、时间、版本和作用域。
- **更新方式**：append、update、supersede、invalidate、delete 或重新摘要。
- **原始会话策略**：保留、归档、标记、TTL 后删除，还是没有定义。
- **检索方式**：全文、关键词、向量、图遍历、时间过滤或混合排序。

## 代表性方案

### 1. A-MEM：动态组织记忆节点，而不是会话存储回收

[论文：A-MEM: Agentic Memory for LLM Agents](https://arxiv.org/abs/2502.12110) 采用 Zettelkasten 思路。新记忆会生成结构化 note，包含上下文描述、关键词和标签；系统再寻找与历史记忆的相关连接，并允许新记忆促使旧记忆的上下文和属性演化。其开源实现使用 ChromaDB 做索引和链接。

它的核心价值是：

- 记忆不是孤立的字符串，而是可连接、可演化的节点；
- 新信息可以改变已有记忆的上下文表示；
- 适合做 related memory、关系建议和后续 memory evolution。

它没有直接给出本项目需要的：

- thread 目录何时可以删除；
- 删除前如何做 checkpoint 和 crash recovery；
- 删除后如何恢复原始会话；
- 敏感内容审批和租户级数据保留政策。

**对 Kun 的启示**：A-MEM 应作为 P4/P5 的关系与演化参考，不应成为历史会话回收的 v1 依赖。v1 先产生自包含的 episode，并保留已有 `sources`、`excerpt`、`contentHash`；关系链接等后续再加。

### 2. Mem0：抽取 facts，再和已有 memory 做增量 reconcile

[Mem0 工作原理](https://github.com/mem0ai/mem0/blob/main/docs/core-concepts/how-it-works.mdx) 明确区分 messages 和 memories。默认情况下，它保存从消息中抽取出的 memory，而不是逐字 transcript。典型内容包括用户偏好、项目决策和账户事实；消息元数据会作为 user、app、run 等过滤字段。

Mem0 的典型路径是：

```text
messages
  -> extraction
  -> entity extraction
  -> ADD / UPDATE / DELETE / NOOP
  -> SQL facts + vector index + optional entity/graph store
  -> filtered retrieval
```

重要特点：

- 自动 extraction 路径偏向 additive；事实变化并不默认静默重写旧事实；
- 需要纠正或删除时，使用显式 update/delete；
- 检索组合 semantic、keyword、entity、temporal 等信号；
- 官方文档明确建议不要存 secrets、raw credentials 或未脱敏敏感数据；
- 原始消息不是主要 memory 记录，但 Mem0 的目标是记忆检索，不是替用户自动删除其聊天存档。

**对 Kun 的启示**：durable facts/preferences 继续走审批队列是合理的；episode 可以作为低风险的 reference archive，但不能把“LLM 成功抽取 facts”作为删除原会话的必要条件，否则用户不审批时空间永远回收不了。

### 3. LangMem：hot path 与 background memory manager 并存

[LangMem 官方文档](https://langchain-ai.github.io/langmem/) 同时支持两种形成方式：

- active/hot path：Agent 通过 memory tools 在当前交互中主动记录或搜索；
- background/subconscious path：会话结束或空闲后，在后台抽取、合并、更新知识。

[概念指南](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/) 将记忆操作概括为：接收会话和当前 memory state，调用 LLM 决定扩展或整合 memory，再返回更新后的状态。它支持 schema 化 memory、插入、更新和删除，也强调 memory 的类型、形成时机、存储位置和召回方式必须按应用定制。

**对 Kun 的启示**：我们的“定时沉淀”应该是 background path，不应阻塞正常回合。它与现有 per-turn distillation 可以并存：

- episode：归档 session 的 reference 摘要，负责保留工作过程的压缩入口；
- durable candidates：事实/偏好/决策，继续进入审批流；
- 两者都不互相阻塞，也不要求同一时间完成。

### 4. MemGPT / Letta：把上下文当作分层虚拟内存

[MemGPT 论文](https://arxiv.org/abs/2310.08560) 把 LLM 上下文管理类比为操作系统的虚拟内存：有限的 core memory 在上下文中，recall storage 保存完整历史，archival storage 保存可检索的 facts、experiences 和 preferences。系统通过分页、检索和 Agent 控制来表现出更大的上下文。

[Letta memory blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks) 当前将 memory blocks 作为始终注入上下文的结构化区块，具有 label、description、value 和字符上限，也支持共享和只读 block。它把可变的核心状态与外部 archival memory 分开。

**优点**：层次边界清楚，Agent 可以决定什么时候把内容写入长期存储。
**不足**：这是上下文/Agent runtime 的内存管理，不是历史数据生命周期管理；原始 recall/archive 数据通常仍然保留。
**对 Kun 的启示**：可以借鉴“payload 层级”思路，但不能把“归档到 memory”误认为“磁盘已经释放”。必须单独测量 thread payload bytes。

### 5. Zep / Graphiti：以 episode 为入口的时态知识图谱

[Graphiti 官方文档](https://help.getzep.com/graphiti/getting-started/welcome) 将文本或 JSON episode 增量加入时态知识图谱。图中包含实体、关系和 episodic nodes；随着新 episode 到来，事实关系可以演化。

[Zep 图模型说明](https://help.getzep.com/v2/understanding-the-graph) 进一步区分：

- entity edges：实体间语义事实；
- entity nodes：实体及其相关摘要；
- episodic nodes：原始数据或 chat history 的 episode 表示。

Graphiti/Zep 的关键工程特点：

- 事实具有时间语义，旧事实通常被 invalidated，而不是物理覆盖；
- episode provenance 支持从事实回到来源；
- 检索组合向量、全文和图遍历；
- 保留历史关系可以回答“现在是什么”和“过去是什么”。

**对 Kun 的启示**：如果未来做 P4 relations，应该保留 valid time、observed time、source episode 和 superseded/invalidation 状态。v1 不需要引入图数据库，但应避免设计成只剩一段无来源的 summary。

### 6. EverMemOS：Encoding → Consolidation → Retrieval 的显式流水线

[EverMemOS 开源项目](https://github.com/NetMindAI-Open/EverMemOS) 把长期记忆拆成：

1. Encoding：从对话提取结构化 memory；
2. Consolidation：组织成 episodes、facts、preferences、relations 和 profiles；
3. Retrieval：通过 BM25、embedding 或 agentic search 找回上下文。

[论文](https://arxiv.org/abs/2601.02163) 使用 MemCells 表示 episodic traces、atomic facts 和带时间的 foresight，再把它们组织成更高层的 MemScenes 和 profile。这个方案和我们的目标最接近：它明确承认“单个 session episode”和“长期稳定知识”是不同层次。

**对 Kun 的启示**：采用两种产物是正确的：一个 session episode + 可审批 durable facts。不要让 session summary 直接冒充用户偏好或行为指令。

### 7. LlamaIndex / Summary Memory：解决上下文窗口，不等于知识库

[LlamaIndex memory 文档](https://llamaindex.openml.io/python/framework/module_guides/deploying/agents/memory/) 将 memory 分成短期聊天队列和可选长期抽取。其旧的 [`ChatSummaryMemoryBuffer`](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/memory/chat_summary_memory_buffer.py) 在 token 超限时迭代总结旧消息，并保留最近消息。

这类 rolling summary 的特点：

- 触发简单：token/window 超限；
- 对在线延迟和上下文大小有效；
- 摘要往往覆盖原有上下文，但通常仍依赖 chat store 持久化；
- 不提供本项目所需的“会话完成、归档、checkpoint、TTL、物理字节回收”协议。

**对 Kun 的启示**：不能只复用普通 context compaction 来做存储回收。上下文压缩和数据保留是两种不同操作。

### 8. Generative Agents 与 MemoryBank：记忆流、反思和遗忘

[Generative Agents](https://arxiv.org/abs/2304.03442) 使用完整 experience memory stream，按相关性、近期性和重要性检索，并定期把多个事件反思成更高层的 reflection。

[MemoryBank](https://arxiv.org/abs/2305.10250) 将存储、检索和更新拆开，存储 daily conversations、事件摘要和用户画像，并使用受 Ebbinghaus forgetting curve 启发的更新机制。

这类方案提供了两个有价值的思想：

- 不能把所有消息都当作同等价值；
- “事实事件”和“从事件反思出来的稳定模式”应分开。

但它们通常把 forgetting 作为 memory ranking/strength 更新，而不是安全的物理删除。因此不能直接作为 Kun 的 deletion gate。

### 9. LongMem：模型架构层的长期上下文缓存

[LongMem](https://arxiv.org/abs/2306.07174) 使用冻结的 backbone 作为 memory encoder，再用 SideNet 作为 memory retriever/reader，将长历史缓存到外部 memory bank。它关注的是模型如何利用超长历史，不是本地聊天文件如何归档或删除。

**对 Kun 的启示**：LongMem 与我们的 session retention 处于不同层级，不能因为它支持长历史就推导出可以删除原始 thread。

### 10. 产品实践：ChatGPT 与 Claude 更重视来源控制，而不是静默回收

[ChatGPT Memory 官方说明](https://help.openai.com/en/articles/8590148-memory-in-chatgpt) 明确把 saved memories 与 chat history 分开。删除原始 chat 不一定自动删除独立保存的 memory；要彻底移除某条信息，用户可能需要同时处理 saved memory、原始 chat、文件和连接的数据源。关闭 chat-history reference 也有独立的异步删除与保留窗口。

[Claude 个性化官方说明](https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features) 支持 past chat search、profile preferences、project instructions 和 styles。用户可以关闭过去聊天搜索；若要确保某个历史 chat 不再被搜索，目前的控制方式是删除该 chat。

这说明成熟产品通常遵循：

- memory 与原始 chat 分开管理；
- 用户能看到、修改或删除 memory/source；
- “不再使用”与“物理删除”不是同一个状态；
- 删除传播和异步清理需要明确说明。

这与我们设计的 `safe`、`reclaim-now` 两档是一致的，但 Kun 还需要补齐用户可见的 preview、确认、恢复和审计入口。

### 11. 相关的本地工具：完整保留来源，重建索引而不是删除来源

[OpenPersistentMemory](https://github.com/Concyclics/OpenPersistentMemory) 同时保存完整 conversation JSONL，并通过 FAISS 做两级检索：一部分以 replay conversation 形式返回，一部分以 summary-only memory 形式注入。

[agentic-session-explorer](https://github.com/junxit/agentic-session-explorer) 主要解决本地 Agent session 的浏览、归档和删除，同时特别提醒：删除 session 不会自动删除项目级 memory、store folder 或 prompt-history 等旁路数据。

这类工具的共同经验是：

- 原始文件是最可靠的重建来源；
- 索引可以删、重建或迁移，原始事实不要依赖不可逆摘要；
- 删除一个 session 时必须审计附件、artifact、project memory、SQLite row 和 sidecar 文件。

## 共同架构模式

### 模式 A：不要把“摘要”当成唯一真相

成熟方案大多至少保留一种来源证据：

- 原始 message/event；
- episode node；
- source turn、timestamp、workspace/run；
- content hash、version 或 provenance receipt；
- 可追溯的 facts/edges。

只存一段 LLM summary 的问题是：摘要可能丢失否定、时间、条件、参与者和未完成事项，也无法解释某条 memory 为什么存在。

### 模式 B：session episode 与 durable fact 分离

一次会话的 episode 适合表达“这次发生了什么”；durable fact 适合表达“之后仍然成立什么”。两者的生命周期、权限和更新方式不同：

| 产物 | 例子 | 默认权限 | 生命周期 | 适合删除原始会话的门槛 |
|---|---|---|---|---|
| Episode | 本次迁移讨论完成了哪些工作、哪些问题未解决 | reference | 可归档、可 TTL | 可以作为必要 checkpoint，但要带来源证据 |
| Durable fact | 用户偏好、项目决策、稳定账户事实 | approval-gated | update/supersede/delete | 不应成为删除门槛，否则审批会阻塞回收 |
| Directive | 对 Agent 的行为指令 | 高风险、显式控制 | 用户管理 | 不应由普通历史摘要自动生成 |
| Raw session | 完整消息、事件、文件引用 | 原始数据控制 | retention policy | 删除必须经过独立 retention gate |

### 模式 C：background consolidation，不阻塞 hot path

后台沉淀的优势是可以使用更长输入、更便宜模型和更复杂的 reconcile；代价是它必须处理：

- 会话在抽取期间重新活跃；
- revision 在 checkpoint 前变化；
- 进程在 extracting、materialized、pruning、deleting 中间崩溃；
- 重跑不能生成重复 memory；
- 配置在 job 创建后发生变化。

因此 job 必须持久化输入版本、pipeline version、tier、reclaim mode、checkpoint 和 recovery state，而不是每次按照当前配置重新推断。

### 模式 D：更新通常是 supersede/invalidate，不是静默物理覆盖

Mem0 的 update/delete、Zep 的 temporal invalidation、AgenticMemory 的 supersede 都说明：事实变化需要保留时间和冲突历史。物理删除适用于用户明确删除、数据保留到期或空间回收，不适合作为普通知识更新机制。

### 模式 E：检索需要混合信号

研究和生产系统普遍组合：

- 关键词：名称、ID、路径、错误码、命令；
- 语义：概念相似度；
- 实体：用户、项目、文件、组织；
- 时间：某个事实何时有效、何时被替代；
- 图：关系、因果和多跳关联。

Kun 当前 lexical/FTS 能覆盖精确名称和路径，但对长 episode 的“以前讨论过什么”不够强。v1 应诚实地把 episode 当作可存储的归档知识，而不要承诺 A-MEM/Zep 级别的语义召回。

### 模式 F：删除是跨资源事务，不是删一个 thread directory

一个会话可能同时拥有：

- messages、events、metadata、session snapshot；
- archive/snapshot/recovery copy；
- attachment 和 artifact owner；
- SQLite index row、search index 和 memory source；
- project-level state、history reference 或外部同步记录。

因此“目录不存在”只能证明一部分空间已释放，不能证明所有相关数据都没有 dangling reference。需要分别统计 thread payload bytes、index logical cleanup 和其他资源回收结果。

## 对 Kun 当前方案的评估

### 已经走在正确方向的部分

- session 层拥有 candidate、job、checkpoint、prune/delete 和 metrics；
- episode 与 durable facts 分层；
- source evidence 自包含，使用现有 `excerpt`、`contentHash`、`sources`；
- input-derived idempotency key，不依赖 LLM 输出；
- deterministic verify，不用“LLM 认为摘要足够好”作为删除闸门；
- `safe` 与 `reclaim-now` 分开；
- Tier-1 明确避免把裁剪内容继续写入 `archives/`；
- Tier-2 通过 `ThreadService.delete` lifecycle，而不是后台直接 `rm`；
- 默认关闭、预览优先、后台 bounded run。

### 根据调研应坚持的边界

1. **v1 不引入 A-MEM 的关系图、embedding 或 memory evolution。** 先把存储回收、恢复和证据做好。
2. **Tier-1 safe 是默认实验路径。** 它保留 thread 可见性，并保留一段恢复窗口；Tier-2 只能显式 opt-in，最好第一版只支持手动执行或管理员策略。
3. **删除必须由 retention policy 决定，不由摘要质量决定。** 摘要质量做离线评估；安全 gate 只检查确定性事实。
4. **job 必须冻结配置快照。** job 创建时保存 `reclaimTier`、`reclaimMode`、`archiveTtl` 和 pipeline version；后续运行不能因为全局配置变更而把 safe job 变成 delete job。
5. **重启恢复必须重新做 mutation eligibility check。** 对 `pruning/deleting` 状态也要重新验证 archived、没有 active turn、没有 pending interaction、revision 未变和没有 fork dependency，再决定是否继续。
6. **保留 source evidence 和 recovery manifest。** recovery copy 至少要有固定文件清单、bytes、sha256、jobId、threadId 和 expiry；不要把“摘要已经写入”误认为“原文可恢复”。
7. **增加用户可见控制。** 至少应有 preview、候选原因、预计 bytes、episode 摘要、reclaim mode、TTL、确认和恢复/撤销入口；删除 memory 与删除 source 要能分别操作。
8. **把附件、artifact、索引和外部引用做成 cleanup audit。** 不能只看 thread 目录大小。

## 推荐的 Kun 目标架构

```text
archived + idle thread
        │
        ▼
read-only preview / candidate gates
        │
        ▼
LLM episode extraction + deterministic sensitive filter
        │
        ├── episode: reference, self-contained source evidence
        └── durable candidates: existing approval queue
        │
        ▼
persisted checkpoint
        │
        ▼
safe recovery snapshot / manifest
        │
        ▼
deterministic verify + mutation-time eligibility recheck
        │
        ├── Tier-1: non-archiving trim, keep thread, TTL cleanup
        └── Tier-2: explicit opt-in, lifecycle delete, cross-resource audit
```

建议把状态分成三类，而不是混在一个“memory write”动作里：

```text
materialization state:  episode written / durable candidates queued
retention state:       checkpointed / recovery-held / reclaimable
physical state:        thread retained / trimmed / deleted / resources swept
```

这样既能解释“memory 已经写入但没有权限删除”，也能解释“thread 已删除但附件/索引仍在清理”。

## 推荐落地顺序

### Phase 0：只读预览

- 统计候选 thread、排除原因、payload bytes；
- 生成 episode preview，不写 MemoryStore；
- 展示潜在敏感/活跃/fork/pending 状态；
- 记录 preview 与后续实际执行之间的 revision 差异。

### Phase 1：只沉淀，不回收

- episode 写入与 checkpoint；
- durable candidates 进入审批；
- 统计抽取成功率、敏感拦截率、重复率、source evidence 完整率；
- 观察 lexical/FTS 对 episode 的实际召回。

### Phase 2：Tier-1 safe reclaim 灰度

- 仅 archived、idle、超过最小 payload 的 thread；
- 单次最多处理很少数量；
- safe snapshot 保留 TTL；
- 只在观察到正的 thread payload byte delta 后报告 reclaim；
- 提供 restore/rollback 演练。

### Phase 3：Tier-2 显式删除

- 默认仍关闭；
- 先提供手动确认，不直接依赖每日后台任务；
- 删除前重新检查所有 mutation gates；
- 删除后等待 TTL 再释放 recovery/artifact owners；
- 记录 cleanup audit 和可解释的删除结果。

### Phase 4：A-MEM/Zep/EverMemOS 风格的检索增强

- episode、fact、entity、relation 多种 memory unit；
- hybrid lexical + semantic + temporal retrieval；
- supersede/invalidate 与历史版本；
- 以离线 benchmark 和真实用户反馈决定是否加入关系演化。

## 评测建议

[LongMemEval](https://github.com/xiaowu0162/LongMemEval) 将长期记忆拆成 information extraction、multi-session reasoning、temporal reasoning、knowledge updates 和 abstention 等能力；数据集同时提供短历史、长历史和 oracle retrieval 形式。[LongMemEval-V2](https://xiaowu0162.github.io/longmemeval-v2/) 又增加了 web-agent trajectory 中的静态状态、动态状态、workflow、environment gotchas 和 premise awareness。

Kun 不应只测“摘要是否像人写的”，而应至少测：

| 指标 | 目标 |
|---|---|
| source trace rate | 每个 episode 是否能回到 thread/turn/excerpt/hash |
| sensitive rejection | secrets/credentials 是否在模型调用前拦截 |
| consolidation idempotency | 重跑是否只产生一个确定 memory/job |
| checkpoint safety | checkpoint 不存在时是否永不 prune/delete |
| active-session safety | queued/running/pending/fork/revision 变化是否阻止删除 |
| recovery validity | safe snapshot 是否可校验、TTL 前是否可恢复 |
| payload reclaim | 实际释放的 thread payload bytes，不把 SQLite index 逻辑删除算进去 |
| retrieval recall | episode/facts 对项目名、路径、决策、错误码和时间问题的召回 |
| abstention | 不确定、来源不足或已过期时是否拒答/提示需要原会话 |
| privacy deletion | 删除 memory、删除 source、删除全部关联资源是否最终一致 |

LongMemEval 的系统分数不能直接作为 Kun 的产品结论：不同系统的存储、embedding、reader model、top-k 和 judge 配置差异很大。应建立一套 Kun 自己的匿名 fixture，额外记录“回收前后字节”和“恢复成功率”。

## 最终判断

当前项目的方向不应改成“照搬 A-MEM”。更合理的产品拆分是：

```text
历史会话保留与空间回收 = session retention / storage lifecycle
历史知识沉淀与召回     = memory extraction / retrieval
A-MEM 式关系演化       = future memory graph stage
```

第一阶段先完成可解释、可恢复、可审计的 session lifecycle；第二阶段再提高 memory retrieval；第三阶段才考虑 A-MEM 的动态连接、旧记忆演化和关系建议。这样即使语义检索暂时 no-go，也不会影响最核心的空间优化目标。

## 参考资料

### 论文与评测

- [A-MEM: Agentic Memory for LLM Agents](https://arxiv.org/abs/2502.12110)
- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560)
- [MemoryBank: Enhancing Large Language Models with Long-Term Memory](https://arxiv.org/abs/2305.10250)
- [Augmenting Language Models with Long-Term Memory](https://arxiv.org/abs/2306.07174)
- [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442)
- [Zep: A Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956)
- [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory](https://arxiv.org/abs/2504.19413)
- [EverMemOS: A Self-Organizing Memory Operating System](https://arxiv.org/abs/2601.02163)
- [LongMemEval benchmark](https://github.com/xiaowu0162/LongMemEval)
- [LongMemEval-V2](https://xiaowu0162.github.io/longmemeval-v2/)

### 开源项目与官方文档

- [A-MEM GitHub](https://github.com/agiresearch/A-mem)
- [Mem0 how it works](https://github.com/mem0ai/mem0/blob/main/docs/core-concepts/how-it-works.mdx)
- [LangMem](https://langchain-ai.github.io/langmem/)
- [LangMem conceptual guide](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/)
- [Letta memory blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks)
- [Graphiti documentation](https://help.getzep.com/graphiti/getting-started/welcome)
- [Zep graph concepts](https://help.getzep.com/v2/understanding-the-graph)
- [EverMemOS GitHub](https://github.com/NetMindAI-Open/EverMemOS)
- [LlamaIndex memory documentation](https://llamaindex.openml.io/python/framework/module_guides/deploying/agents/memory/)
- [LlamaIndex ChatSummaryMemoryBuffer](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/memory/chat_summary_memory_buffer.py)
- [OpenPersistentMemory](https://github.com/Concyclics/OpenPersistentMemory)
- [Agentic session explorer](https://github.com/junxit/agentic-session-explorer)

### 产品数据控制

- [OpenAI: Memory in ChatGPT](https://help.openai.com/en/articles/8590148-memory-in-chatgpt)
- [Anthropic: Claude personalization](https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features)

### 发现更多项目的索引

- [Awesome Agent Memory](https://github.com/mnemoverse/awesome-agent-memory)
- [Curated agent memory research](https://github.com/tfatykhov/awesome-agent-memory)
