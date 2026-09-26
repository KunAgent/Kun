## Context

动机见 proposal.md。当前 GUI 默认模型摘要，Runtime 还支持启发式摘要；两者均属于现有摘要策略。

- `history-compaction-service.ts` 以 revision/CAS 提交压缩，`compaction-history.ts` 从最新摘要投影模型历史，同时保留可见消息。其旧摘要合并和内部 context squash 不能直接充当永久窗口索引。
- `model-context-profile.ts`、请求估算和 overflow recovery 已协调输入、输出预留及硬容量；新模式必须使用同一容量口径。
- 设置经过 Shared defaults/normalize/merge、Main `kun-runtime-model-config.ts` / `kun-runtime-config-service.ts` 到 Kun config。单改 UI 或 `summaryMode` 会遗漏归一化与热更新。
- Service Manager 是标准数据唯一物理所有者；Runtime 通过 ports 操作数据，GUI 仅走现有 HTTP/SSE。

参考核对（2026-09-14）：

| PR | 借鉴内容 | Kun 适配决策 |
| --- | --- | --- |
| [#27438](https://github.com/openai/codex/pull/27438) | 窗口编号和剩余 token 提示；25/50/75% 阈值 | 使用 Kun 当前请求容量估计；输入和工具结果也能触发提示 |
| [#27488](https://github.com/openai/codex/pull/27488) | 模型调用 `new_context` 后同 turn 无摘要换窗 | 使用互斥控制工具和持久检查点，明确保护并行结果 |
| [#39827](https://github.com/openai/codex/pull/39827) | history/notes 工具，受限参数和输出 | 本地 Manager 实现；不复制其 OpenAI provider 和 Codex backend 认证限制 |

以下字段、阈值补充和恢复策略是本项目设计选择，不声称是上游 PR 的原样实现。

## Goals / Non-Goals

**Goals:** 可关闭的完整策略；换窗不调用摘要模型；模型按需取回证据；提交、重放和分叉确定；不同 provider 共用能力。

**Non-Goals:** 不替换长期记忆，不做向量检索，不接入 Codex 后端，不改变任务预算/goal/token 用量计费，不清空 UI 历史，不添加第二个运行时或诊断面板。

## Decisions

### 1. 独立布尔开关和 turn 快照

新增 `agents.kun.contextCompaction.windowModeEnabled: boolean = false`，映射到 Runtime `contextCompaction.windowModeEnabled`。缺失及 GUI 非布尔输入归一为 false；Runtime 严格校验类型。不扩展 `summaryMode` 枚举。

设置位于“设置 → 实验室”，名称“窗口式上下文（实验性）”，说明“让模型保存笔记并切换上下文，旧对话可按需检索；关闭后使用摘要压缩”。保存保留摘要模型、阈值和尾部预算。接受 turn 时冻结模式，热更新从下一 turn 生效；自动续跑及子任务继承发起 turn 的模式，各有独立窗口状态。

替代方案：将新方式混入摘要模型下拉框会把窗口管理与摘要生成混为一谈；修改正在运行的 turn 会使工具声明与执行权限不一致。

### 2. 策略选择覆盖所有自动压缩入口

新增小型策略协调服务，接入自动预检、send-boundary 和 provider overflow；旧 `HistoryCompactionService` 继续负责摘要。窗口模式在软阈值提醒保存笔记/换窗，达到现有硬阈值或输入加输出即将超限时执行一次确定性换窗，再重新构建请求。不得隐式调用摘要降级。

显式 `/compact` 始终使用现有摘要服务；窗口模式下将其登记为 `summary` 类型窗口边界，下一请求重新初始化预算。关闭开关不会展开全部旧历史：从最后已提交边界的有效历史继续使用摘要策略。

保留 overflow 的“无已提交部分输出才能单次恢复”规则。新窗口初始上下文本身过大、无空间释放或再次 overflow 时仅失败当前 turn，禁止反复清窗。现有内存压力触发的自动压缩也须经过策略入口，不能暗中摘要。

### 3. 当前窗口预算，不是累计任务用量

使用模型 profile 的有效容量、完整请求估算和输出预留，计算非负剩余输入空间。计入 system、tools、动态 context、附件及新输入；provider 最近一次同窗口实际使用量仅作校准，不使用跨窗口累计账单 token。

窗口开始附加一次预算上下文，25/50/75% 使用率各至多提示一次；一轮跨多个阈值只发送当前最高阈值提示并标记较低阈值已覆盖。软阈值另作一次可执行提示。入队消息、工具输出和模型切换均重新计算；提示本身计入预算。

窗口编号、预算、笔记目录指针放在稳定 system 前缀之后。固定模式工具集合在 turn 内保持顺序和 schema 稳定；关闭模式不得注入新工具或预算提示。已有任务预算和 cache usage 不重置。

### 4. 独立检查点和安全换窗

增加版本化 `context_window` item/event 契约，不伪造空摘要依赖 `replacedTokens > 0` 判断。检查点含窗口 id、前一窗口、原因（model/pressure/overflow/manual-summary）、源历史 revision、切分位置、初始化引用和幂等 operation id。

窗口 0 对应首次启用时已存历史；仅能查询此前实际保留的数据，不承诺恢复以前被 squash 的内部记录。新窗口不自动携带旧用户消息、助手文本、工具结果和摘要。初始化重建当前权威环境、客户端能力、权限、goal/plan 状态和仍有效的 skill pins，附带当前任务消息 id 与最近窗口/笔记的有界指针，指导模型按需读取；不把笔记全文或历史升级成 system 指令。

`new_context({})` 是当前 agent 的控制工具。工具批次预检查发现它与其他调用混用时，拒绝该批次且不执行副作用，要求独立调用。已存在未完成工具、审批或输入请求时不提交换窗。同一 operation 重放只返回已提交结果。

顺序：保存原始历史 -> 建立持久边界 -> CAS 原子提交检查点 -> 发 SSE -> 清理旧请求压力/read tracker -> 构建新上下文 -> 同一 turn 继续。不跨越仍未提交的历史；CAS 冲突只重建纯变换，不重跑工具。

换窗边界之后收到的 steering/user input 在新窗口保留；之前的已提交输入仍能按 id 查询。取消在提交前不改变窗口，提交后保留边界且不继续采样；重启依据持久检查点恢复，不重复换窗。禁止连续两次无普通模型/工具工作进展的换窗，并保留现有 turn 步数限制。

### 5. 本地历史和笔记

通过专用 port / Manager 数据操作扩展，Runtime 不直接写第二份标准存储。窗口索引记录 item 范围并复用标准对话数据，不以 `events.jsonl` 作为唯一历史源；原始可查询记录必须在旧投影 squash 前保留。分页读取/搜索采用流式或有界扫描，不将所有窗口加载成常驻数组。

为 endpoint 通用性，模型使用扁平名称：

| 工具 | 行为 |
| --- | --- |
| `history_list_windows` | 分页列出窗口、原因和时间 |
| `history_list_items` | 窗口内按序列出消息元数据 |
| `history_read_item` | 按 item id 分段读取文本或附件引用 |
| `history_search_contents` | 文字检索并返回 item/window id 与截断片段 |
| `notes_list_files_by_prefix` / `notes_read_file` | 列出/分段读取逻辑笔记 |
| `notes_search_contents` | 搜索笔记文本 |
| `notes_append_to_file` / `notes_write_file` | 幂等追加或按 revision 整体替换 |

所有工具从可信执行上下文取得 thread/agent 身份，不允许参数指定任意其他线程。笔记是线程私有逻辑路径，不是 workspace 文件；拒绝绝对路径、`..`、NUL 和越界路径。写入带 revision，追加带 operation id，冲突可重读重试。

本地初始限制：列表每页默认 20/最多 100；检索 query 最多 1024 字符；单次读写文本最多 16 KiB UTF-8；单文件 256 KiB、每线程最多 100 文件/总计 2 MiB。输出同时受 16 KiB 和 min(现有工具 token 上限, 4096) 限制；返回结构化 truncated/cursor，不截断成无效 JSON。请求和响应均在进入下一次模型历史前受限。大附件仅返回受现有访问权限约束的引用。

笔记内容不会自动进入长期记忆，也不影响其现有生命周期策略。查询返回的数据标注为历史证据；旧指令不获得新的权限。

### 6. 恢复、分叉与呈现

同线程 resume 保留窗口编号、阈值标记和笔记。fork 复制分叉点可见历史、边界及该时点笔记快照到新线程，后续写入互不影响；因此笔记需保留版本与提交序列。子代理只访问自己的历史/笔记，不因继承模式获得父线程读取权。

归档保持可恢复；删除线程按现有删除机制移除关联索引、笔记版本及专用历史数据。禁用不删除数据或破坏新边界解析。旧配置无需批量迁移，首次启用才建立窗口状态。

新增事件经过 contracts -> Main SSE -> preload 通用桥 -> mapper/projection -> 时间线，显示“已切换上下文窗口”，手动摘要仍显示摘要。窗口切换不产生新任务，不隐藏原始消息，不恢复已移除的 runtime 面板。

## Risks / Trade-offs

- 模型换窗前未记笔记而丢失工作焦点 -> 初始化提供精确任务/历史指针；验收包含无需笔记的历史恢复；默认关闭。
- 换窗会降低旧对话缓存复用，检索增加调用 -> 固定前缀不变，分页有界；验证记录摘要调用数、检索开销和任务成功率，不承诺必然省 token。
- 持久历史和笔记版本增长 -> 复用标准数据、限额、有界扫描、线程删除级联；不得通过静默删旧窗口满足内存限制。
- provider 无法使用工具 -> 启用 turn 前报告能力不支持，不能执行不可恢复的清窗；现有摘要模式仍可使用。
- 边界与并发消息竞争 -> 原子 revision 提交、幂等操作和恢复测试，工具批次独占检查。

## Migration Plan

1. 先新增向后兼容的数据/事件读取和设置默认值，再接入工具与策略，最后展示独立开关。
2. 存量配置补 false，不改摘要参数；存量会话按需初始化窗口索引。
3. 关闭开关是功能回退路径，保留新数据读取能力和全部历史。旧二进制不认识新 item 时不得宣传可直接降级；二进制回滚需对应数据备份/兼容导出。
4. 文档提案阶段运行 OpenSpec strict 校验与 diff 检查；实施阶段按 tasks.md 完成跨层测试和构建。

## Desktop Acceptance Record

2026-09-15 使用开发版 Kun 和 MiniMax-M3 完成真实桌面验收。测试时开启“设置 → 实验室 → 窗口式上下文（实验性）”，使用唯一标记 `KUN-WINDOW-HISTORY-B5D8` 建立旧窗口内容，并要求模型实际调用 `new_context({})`，禁止用文字模拟。换窗后模型报告窗口 1、总容量 `1000k tokens`、剩余约 `1000k tokens`，随后继续同一 turn。重启桌面 Runtime 后，再要求模型依次执行 `history_list_windows`、`history_search_contents` 和 `history_read_item`。工具结果确认窗口 0 与窗口 1 均存在，并从窗口 0 的原始 user item 读回完整标记和原始请求。时间线保留原消息，只显示一个窗口切换边界。

验收过程暴露并修复了以下问题：

| 发现 | 根因 | 修复和回归覆盖 |
| --- | --- | --- |
| Anthropic Messages 路线换窗后的首个请求返回 `messages: []`，provider 以 HTTP 400 拒绝 | 新窗口只剩 system 初始化，Anthropic 请求必须至少包含一条 message | 仅当 system 中存在窗口初始化的 `Current task message:` 指针且投影消息为空时，添加 continuation user cue；普通 system-only 请求保持原行为。三种 endpoint 适配器测试覆盖该条件。 |
| 模型读取旧任务后再次调用 `new_context`，形成递归换窗倾向 | continuation cue 只要求读取当前任务，没有明确说明换窗已完成及继续原任务 | cue 明确声明 `new_context` 已完成、禁止本 turn 再次调用，并要求先读取当前任务 item 后只继续换窗后的工作。完整 AgentLoop 验证只提交一次换窗。 |
| 检查点提交后重启，窗口边界从有效历史中消失 | history healing 未识别 `context_window` item，将其当作未知记录过滤 | `normalizeLoadedItem` 保留版本化窗口检查点；新增重启回归测试断言检查点原样存活。 |
| 检查点已提交但初始化写入前崩溃时，普通恢复不能补初始化 | 初始化补全只存在于同 operation id 的重放路径 | 恢复从历史推导完整检查点，并同步调用幂等 `ensureInitialization`；固定 item id 保证多次恢复只补一次。 |
| 恢复后预算错误显示接近 100% 使用 | 恢复阶段用 `capacityTokens: 1` 建立预算状态，后续策略误认为容量已校准 | 恢复只保存窗口身份和 pending 阈值标记；首个真实请求按当前模型 profile 建立容量，再一次性水合标记。 |
| 同一 turn 跨窗口后的第二次合法压力无法换窗 | operation id 只含 thread/turn，跨窗口仍被当作同一操作 | operation id 加入 current window id；同压力点保持幂等，跨窗口可创建新边界。 |
| 无进展保护可被检查点、初始化及 `new_context` 控制记录绕过 | 守卫把控制记录计作普通工作 | 仅统计普通 assistant/tool 工作；纯控制记录后的连续换窗被拒绝。 |
| send-boundary 重试沿用旧窗口初始化 | fallback 请求没有从新历史重新收集窗口指令 | fallback 使用其 notice 和新历史重新生成 context instructions 后再组合请求。 |
| 首窗口阈值标记重启后重复 | `win-0` 在首次预算状态产生时尚未建立可持久化窗口身份 | 策略通过 `establishWindow` 建立首窗口身份并持久化阈值标记。 |
| 设置测试支持文件超过 700 行门禁 | 开关移动到实验室后增加的标签使共享测试文件越界 | 将实验室标签拆到独立测试 fixture，保持文件职责和行数门禁。 |

最终验证包括生产构建、Kun 与根工程 typecheck、OpenSpec strict validation、文件行数和 whitespace 检查。窗口相关核心回归为 80/80，设置 UI 回归为 22/22。根全量测试为 6063 passed；11 个 self-update 用例因本机缺少 `@rpath/libnode.127.dylib` 保持既有环境失败，另外 4 个并发/PTY 波动用例以单 worker 重跑为 30/30 passed。验收任务在 Runtime 再次重启后仍可列出两个窗口并读取旧窗口标记。
