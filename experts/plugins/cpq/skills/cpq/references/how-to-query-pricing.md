# 询价（D 段）：为腾讯云产品行查价并产出对客临时报价

> **定位**：本文是**独立的 D 询价段**。给**腾讯云产品行**查价，产出一份对客的临时报价文件 `phase4_1.md`，**不写 CPQ、不调用 `row add`**。
>
> **与 C 完全解耦**：D **不依赖** C（选品，见 [how-to-select-product.md](./how-to-select-product.md)）的搜索 / 确认产物。可单独跑（A → D）；也可先 C 后 D（此时多数行已有 SPUID，直接走精确路）。谁先谁后、跑哪个由用户决定。
>
> **独立可执行**：D 读 A（`phase1.md`）/ B（`phase2.md`）的腾讯云产品行 + `context.md`，逐行按 SPUID 分叉询价，把价格与四层编码写回 `phase4_1.md`。

---

## 启动条件（D 入口 · 需 AI 判断）

用户**要价、且不落单**时进入 D：

- 典型措辞："询价 / 查价 / 补刊例价 / 估价 / 多少钱 / 给客户看个价 / 对客临时报价 / 生成对客报价单 / 生成刊例价"。
- ❌ 用户已确认要**建 CPQ 配置单 / 走报价器流程 / 落库** → 那是 **C 选品落库**，不是 D。
- ⚠️ 有歧义时（分不清用户要"只补价格"还是"落库选品"）→ **主动问用户**，不要替用户决定。

---

## 前导 gate（机器门控 · 替代旧 D040 硬门控）

进入询价前**必须**机器校验：**A 已完成、B 已完成或明确跳过**，数据格式合规。**不再**要求"询价前必走完选品 Phase 2.5/2.6/3/4"。

| 校验项           | 通过标准                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| A 完成           | `context.md`（含 `context-done`）+ `phase1.md`（含 `phase1-done` 且带 `competitor` 字段）存在且格式合规                   |
| B 完成或明确跳过 | `competitor>0` → `phase2.md` 存在且含 `phase2-done`；`competitor=0` → `context.md` 须标 `b_status=skipped(no_competitor)` |
| 数据格式         | 上述文件首行 `site` 一致、表格列结构合规、`done` 标记字段齐全                                                             |

```bash
node scripts/check-phase4-1-gate.mjs --session-dir <CPQ_SESSION_DIR>
```

- 任一不过 → **停止询价**，回退补齐对应步骤（A 或 B）。
- 通过后逐行按 SPUID 分叉（下文 two_lane）。

---

## 输入契约

| 项       | 内容                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------- |
| 前置     | 上面的前导 gate 通过                                                                               |
| 输入     | 腾讯云产品行 = `phase1.md` 原生腾讯云行 + `phase2.md` 我方对标产品；`context.md` 的 SPUID 覆盖信息 |
| 询价范围 | 仅对腾讯云产品行询价。无对标的友商行（B 中 `我方对标产品=-`）不进入 D                              |

> 询价行集合受 `verify-phase4-1-source.mjs` 校验：`phase4_1.md` 每一行的 row_id 必须来自 `phase1.md` / `phase2.md`，防止"凭空冒出来的行"。

---

## 逐行 SPUID 分叉（two_lane）

```
逐行判断该行是否有 SPUID
   │
   ├─ 有 SPUID ──► 【精确路】SPU 询价（单步，失败即留空，不降级）
   │                cpq product price --spu-ids <id> --pay-mode <prepay|postpay> [--currency USD --oversea]
   │                  成功（latestPrice 非 null）→ 填价，询价链路 spu-hit，状态 已询价
   │                  失败（null / 报错）        → 留空，询价链路 spu-miss，状态 刊例价不可得
   │
   └─ 无 SPUID ──► 【预估路】① 主力 → ② 兜底（②前必有 ①miss 证据）
                    ① inquiry-price-parallel（整批并发，主力）
                       concluded 有价 → 填价（远端原文逐字），询价链路 ①hit，状态 已询价
                                       └ 顺手回填「四层编码」列（远端返回的四层定义）
                       failed / timeout / aborted / asking 已耗尽 / 无价
                                                     → 询价链路 ①miss(<原因>)，**强制漏到 ②**
                    ② tencent-cloud-pricing（tcloud-price，逐行兜底）
                       quote 成功 → 填价，询价链路 …→②hit，状态 已询价
                                   └ 若 ① 未拿到四层 → 用 tcloud 返回的四层回填「四层编码」列
                       仍无价 → 询价链路 …→②miss(<原因>)，留空，状态 规格不可询 / 产品未注册
```

> ⚠️ **强制 fallback 规则（2026-06-22 修订 · 已机器化）**：① `inquiry-price-parallel`
> 跑完后，主流程必须读 `<run_dir>/summary.xlsx` 逐行检查 `status` 列。**任何**满
> 足以下条件的行都必须**自动**走 ② tcloud 兜底，不能直接以 ① 的失败结果落盘
> phase4_1.md：
>
> - `status` ∈ {`failed`, `timeout`, `aborted_by_user`}
> - `status = concluded` 但 `price_info` 为空
>
> 只有 ② 也失败的行才允许标 `①miss→②miss(...)` 落盘。这条规则避免了用户已经看到
> `① failed` 后还要手动一行行问"能不能再试 ②"——主流程必须自动尝试。
>
> **🔒 机器门控（写盘阶段强制）**：本规则已下沉到两个机器 gate（详见下文「询价链
> 路列」段）：
>
> - **Gate 1（行级 · 必跑）**：`fill-phase4-1.mjs` 写盘前 + `check-phase4-1-funnel-gate.mjs`
>   都校验：含 `①miss` 的行必须续打 ② (`→②hit` 或 `→②miss`)；任何 `①miss(failed)`
>   类直接收尾的行都会被拒绝写盘。
> - **Gate 2（计数级 · 当 `<session>/inquiry-run/summary.xlsx` 存在时跑）**：将
>   inquiry-run 标的"应兜底行数"与 phase4_1.md 中"触达 ② 的行数"做交叉对账，少
>   打 ② 即写盘失败。这条把"AI 自觉读 summary.xlsx"做成机器拦截，避免主流程绕过。
>
> 旁路开关：`CPQ_SKIP_FUNNEL_GATE=1`（仅排障 / 测试用，不要在生产路径开）。

**两条路的关键差异**：

- **精确路（有 SPUID）** = 单步 `cpq product price`，失败即留空，**不**降级到 ①/②（SPUID 已是权威锚点，远端预估反而引入噪声）。
- **预估路（无 SPUID）** = ① → ② 两层漏斗，**② 只在 ① 没询到价时**对该行执行。漏斗顺序固定为 **① `inquiry-price-parallel` 主力 → ② `tencent-cloud-pricing` 兜底**。

> **不额外标注"预估"**：无 SPUID 行的价格与有 SPUID 行**统一呈现**。透明度补偿放在「询价规格摘要」列——必须呈现**补全后的实际询价规格**（见下）。

### 询价链路列（机器证据 · 漏斗门控锚点）

预估路逐行维护「询价链路」列，是漏斗门控的唯一证据列：

| 该行情况       | 「询价链路」取值          |
| -------------- | ------------------------- |
| ① 命中         | `①hit`                    |
| ① 没价、② 命中 | `①miss(timeout)→②hit`     |
| ①② 都没价      | `①miss→②miss(规格不可询)` |
| 精确路命中     | `spu-hit`                 |
| 精确路失败     | `spu-miss`                |

`check-phase4-1-funnel-gate.mjs` 与 `fill-phase4-1.mjs` 写盘前都跑两条校验：

**Gate 1 · 行级漏斗双向规则**

- 正向：含 `②` 的行必须含 `①miss`（防止跳过 ① 直接 ②）
- 反向：含 `①miss` 的行必须续打 ②（→②hit 或 →②miss 任一），**禁止**以 `①miss(failed)` 类形式直接收尾
- 精确路 `spu-hit` / `spu-miss` 整行豁免

**Gate 2 · inquiry-run 强证据交叉对账**（仅当 `<session>/inquiry-run/summary.xlsx` 存在时跑）

- 调用 `list-tcloud-fallback-rows.mjs` 拿到 `needs_fallback`（应兜底行数）
- phase4_1.md 中含 `→②` 痕迹的行数必须 ≥ `needs_fallback`
- 计数级强约束，不依赖 `source_row_index ↔ row_id` 逐行回连

```bash
# 单跑 gate（不写盘 · 排查时用）
node scripts/check-phase4-1-funnel-gate.mjs --session-dir <CPQ_SESSION_DIR>

# 写盘脚本本身已内嵌同款 gate · 偷懒不会通过
node scripts/fill-phase4-1.mjs --session-dir <CPQ_SESSION_DIR>

# 想知道"哪些行该走 ②"
node scripts/list-tcloud-fallback-rows.mjs --run-dir <session>/inquiry-run
```

---

## 询价工具调用方式（强制）

### 精确路：`cpq product price`（有 SPUID 行查刊例价）

`cpq` 随 plugin 安装注册到 PATH，直接调用（无需绝对路径）：

- `site=cn`：`cpq product price --spu-ids <id> --pay-mode <prepay|postpay> --fmt json`
- `site=intl`：`cpq product price --spu-ids <id> --pay-mode <prepay|postpay> --currency USD --oversea --fmt json`
- `latestPrice` 非 null → 提取价格，标 `已询价`；`latestPrice: null` / 报错 → 留空标 `刊例价不可得`（**精确路不降级**）。

> 刊例价是按计费单位的单价，**无需收集实例规格**。

### 预估路 ①：`inquiry-price-parallel`（无 SPUID 行主力，整批并发）

委托同 plugin 下 `inquiry-price-parallel` skill 整批并发询价；价格取远端返回 `[价格]` 段原文，逐字回填。四层编码取远端返回 `[四层]` 段原文 —— 落在该 run 的 `summary.xlsx` **`four_layer` 列**（成功结论才填，远端查不到则该列为空）；D 段从该列逐字读出，放进该行的「四层编码」列，再经 `fill-phase4-1.mjs` 写盘。

> **🔒 委托调用规约（CPQ → inquiry-price-parallel · 2026-06-22 修订）**
>
> CPQ 主流程把 D 段委托给 `inquiry-price-parallel` 时 **必须** 按以下方式落 RUN*DIR；
> 否则 `fill-phase4-1.mjs` / 强制 fallback 规则定位 `summary.xlsx` 会发生"目录漂移"
> （主 agent 用了 `inquiry-price-parallel` 默认的 `<workspace>/.tmp/inquiry-price-runs/run*<ts>\_<rand>`
> 路径 → 与本次 CPQ 会话目录脱钩 → 后续段读不到正确产物）：
>
> ```bash
> # CPQ_SESSION_DIR 由 A 段 resolve-session-dir.mjs 解析得到（参见 cpq-session-dir.md）
> export CPQ_DELEGATION=1                    # _cpq_delegate_gate 信号 3 · 显式声明委托
> RUN_DIR="$CPQ_SESSION_DIR/inquiry-run"     # 固定子目录名 · 与 _cpq_delegate_gate 信号 2 路径推断对齐
> mkdir -p "$RUN_DIR"
> # 然后按 inquiry-price-parallel SKILL.md 步骤 2-6 走 · 把上面的 $RUN_DIR 透传进去
> ```
>
> ❌ **禁止**：让 `inquiry-price-parallel` 走它的"默认 `<workspace>/.tmp/inquiry-price-runs/run_<ts>_<rand>`"
> 路径——那是用户独立调用场景的默认值；在 CPQ 委托下使用会丢失会话目录关联。
>
> ✅ **校验**：调用完成后读 `$RUN_DIR/summary.xlsx` 必须能读到；`$RUN_DIR` 应等于
> `$CPQ_SESSION_DIR/inquiry-run`（不是别的随机路径）。

### 预估路 ②：`tencent-cloud-pricing` 的 `tcloud-price`（逐行兜底）

委托同 plugin 下 `tencent-cloud-pricing` skill 的 `tcloud-price` 本地二进制。**禁止 npx / npm 调用**。

```bash
tcloud-price quote --site <cn|intl> --product <code> <规格参数>
```

> ⚠️ 必须读 [tencent-cloud-pricing/SKILL.md](../../tencent-cloud-pricing/SKILL.md) 「唯一报价来源（强制）」段：价格金额 / 计费项只能来自工具本次成功返回的 JSON 或 `cpq product price` 刊例价；CLI 不可用 / 登录失败 / 非零退出 → 停止报价并如实告知，不得给替代金额；规格枚举 / 默认值 / 计费模式不得由 AI 凭常识猜测。

---

## 规格收集（仅预估路按需问，不要全问）

精确路（`cpq product price`）查刊例价**无需收集规格**。以下仅适用于走预估路（无 SPUID）的行。

1. **先按原文确认缺参处理偏好（一次性，整批生效）**：`a` 用户自己补 / `b` 默认填充 / `c` 默认填充且不再改。
2. **按行算缺什么**：对每个产品代码（去重）调 `tcloud-price help --site <cn|intl> --product <code>` 读必填规格，与已有信息求差集，得到本行还缺哪些参数（典型：地域、实例规格、购买时长、数量、磁盘 / 流量）。多行可并行加速。
3. **按选项执行**：`a` → 把缺项以**人话**列给用户（不暴露 CLI 参数名）等补齐；`b`/`c` → 用 `help/schema` 默认值或 CLI 内置默认填充，**禁止**用模型常识填规格。

---

## 价格铁律

- 价格值与单位**只来自工具实际返回**：精确路 `cpq product price` 的 `latestPrice`；① 远端 `[价格]` 段原文；② `tcloud-price quote` 的 `originalPrice` / `totalPrice`。
- 本地**零解析 / 零换算 / 零推算**。价格展示必须**同时**给原价和折扣价。
- 找不到价 → **留空**，**禁止**建议或推测产品名 / 规格（这与 C 选品 / winback 语义不同——D 是询价收尾，不再做选品）。
- ❌ 禁止凭模型记忆 / 网络资料 / 历史价格填价。
- ❌ 禁止本阶段调用 `row add` / `row import` / `row update`（D 不落库）。

---

## 四层编码列（D → C 数据反哺）

预估路（无 SPUID）逐行经过 ①/② 两个非 SPU 工具时，**两个工具的返回都带四层定义**。只要某行**过了任一非 SPU 工具并拿到四层**，就把四层编码（如 `p_cvm/sp_cvm_ma9`）逐字回填该行「四层编码」列。

- 来源：① 命中取 inquiry 的 `summary.xlsx` `four_layer` 列（远端 `[四层]` 段原样搬运）；① 没拿到、② 命中取 tcloud 返回的四层。
- **试过但没收割到 → 写显式 `未找到`（强证据 · 跨段契约）**：某行确实过了 ①/② 至少一个非 SPU 工具、但都没拿到四层时，「四层编码」列**必须写 `未找到`**（而非留空）。这是给 C 的"D 已试过且失败"显式证据，C 据此短路、不再重复查（见 [how-to-query-four-layer.md](./how-to-query-four-layer.md)「先复用中间表已有结论」）。
  - **`未找到` ≠ 空**：`未找到` = "D 试过、确实没有"；空 / `-` = "D 没跑到这行 / 没试"（精确路、或该行未进 D）。对 C 含义不同，不可混用。
- 价格铁律同样适用：四层编码只来自工具实际返回，本地零推断；写不出真实编码只能写 `未找到`，禁编造。
- **意义**：若用户**先 D 询价、后 C 选品**，这些行的 `phase4_1.md` 已带四层，C 可直接 `row add --four-layer-codes` 命中，省掉一次四层兜底查询。
- 有 SPUID 的精确路**不**回填四层（SPUID 已是权威锚点）。

---

## 询价规格摘要列（透明度补偿 · 不标"预估"但要透明）

既然不额外标"预估"，就用「询价规格摘要」列**强制呈现本次询价实际依据的规格**：

- 预估路 ①/②：当远端 / tcloud 在原始规格不足时**补全了规格**（如补了实例族、地域、计费周期），摘要必须写**补全后的实际规格**，而不是用户原始那行的残缺规格。
- 精确路（SPUID）：写 SPU 对应的规格摘要。

目的：用户一眼能看出"这个价格是按什么规格询出来的"，避免无 SPUID 行因规格被远端补全而产生"价格对不上需求"的误解。

---

## 产物 `phase4_1.md`（唯一写盘入口 = `fill-phase4-1.mjs`）

⚠️ **禁止 AI 手写 `phase4_1.md`**。把询价行整理成 `phase4_1-input.json` 后，用脚本组装写盘（脚本统一计数、校验摘要与必需列、生成 `done` 标记）：

```bash
node scripts/fill-phase4-1.mjs --session-dir <CPQ_SESSION_DIR>
```

产物结构：

- 首行 `<!-- site: cn -->` 或 `<!-- site: intl -->`，与上游一致。
- **`## 摘要` 段（五要点 · 给下游机读）**：本阶段做了什么 / 关键判断 / 给主 agent 的路由建议 / 给下游 subagent 的用法（四层编码列可复用）/ 异常·留空·失败行。
- **`## 数据` 段**：表头 = 腾讯云产品行（产品名 / 规格 / 站点 / 地域 / 售卖模式 / SPUID 等）+ 右侧追加询价列：**询价规格摘要** / 原价 / 折扣价 / 单位·币种 / 计费周期 / 询价来源 / 询价链路 / **四层编码** / 报价单链接 / 询价状态。表头**必含**「四层编码」「询价规格摘要」两列。
- **① 会话追溯列（可选）**：走预估路 ① 的行可带 `①conversation_id` / `①结论` 两列，原样搬运 `inquiry-price-parallel` 返回的 `task_states[task_id].conversation_id` / `conclusion`，便于人工点回刊例价助手会话页追溯本次询价对话；精确路 / 未走 ① 的行填 `-`。`fill-phase4-1.mjs` 对这类额外列一律透传。
- 末行 `<!-- phase4_1-done: total=<N> quoted=<Q> blank=<B> via_spu=<S> via_parallel=<P1> via_tcloud=<P2> -->`，满足 `quoted+blank=total` 且 `via_spu+via_parallel+via_tcloud=quoted`。
- **只产 `phase4_1.md`**，禁止生成 xlsx / docx 富格式（沿用 [how-to-select-product.md](./how-to-select-product.md) 临时文件「格式硬约束」）；`<CPQ_SESSION_DIR>` 解析见 [cpq-session-dir.md](./cpq-session-dir.md)。

### 询价状态取值

| 询价状态       | 触发条件                                              | 价格列 |
| -------------- | ----------------------------------------------------- | ------ |
| `已询价`       | 精确路 `latestPrice` 非 null；或 ①/② 成功返回含价     | 填价   |
| `刊例价不可得` | 精确路 `cpq product price` 返回 null / 报错（不降级） | 留空   |
| `产品未注册`   | 预估路 ①② 均判定 pricing 工具不覆盖此产品             | 留空   |
| `规格不可询`   | 预估路必填规格无法补齐 / `quote` 返回错误 JSON        | 留空   |
| `用户取消`     | 用户在规格收集阶段明确放弃此行                        | 留空   |

---

## 完成后行为

向用户输出：

1. 价格版临时文件路径（`phase4_1.md`）。
2. 命中率（按来源拆分：精确 SPU `via_spu` / 刊例价助手 `via_parallel` / 购买页 `via_tcloud`）。
3. 留空行原因（刊例价不可得 / 产品未注册 / 规格不可询 / 用户取消）。
4. 若用户随后想落库 → 提示可发起 **C 选品**（D 的 `phase4_1.md` 四层编码列可被 C 复用）；D 本身流程在此结束，**不写 CPQ**。
