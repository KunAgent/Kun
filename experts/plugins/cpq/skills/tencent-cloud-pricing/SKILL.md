---
name: tencent-cloud-pricing
description: >-
  CPQ 的内部子能力 · 通过 `tcloud-price` CLI 查询腾讯云国内站与国际站产品下单价格、报价、
  费用估算，**仅由 cpq skill 在其询价子流程中调用**，禁止 agent 在响应用户请求时直接加载本
  skill。即使用户输入命中"CVM / COS / CDB / Redis / CLB / WAF / VOD / TRTC / SMS /
  CKafka / NLB / SCF / TKE / Lighthouse / DNSPod 等腾讯云产品多少钱 / 估价 / 刊例价 /
  报价"等关键词，也**必须**先加载父级 cpq skill，由 cpq 主流程按其内部路由判断是否进入本
  skill；用户请求里没有显式提到 cpq 时，应优先加载 cpq skill 走主流程，而不是直接进入本
  skill。本 skill 不承担站点判定（cn/intl）、客户分层、缺参偏好（a/b/c）、配置单上下文等
  主流程职责，只负责把 cpq 主流程已经裁决过的产品 + 规格转成 `tcloud-price quote` 命令并把
  成功 JSON 原样回传，覆盖国内站 128 款与国际站 64 款产品，国内站 CNY、国际站 USD。
---

# Tencent Cloud Pricing

## 🔒 调用契约（最高优先级）

本 Skill 是 **CPQ 流程的内部子能力**，**不是用户级入口**。所有客户报价相关任务的统一入口是
`cpq` skill。

- ✅ **唯一允许的进入方式**：由 `cpq` skill 在其询价编排阶段显式调用
- ❌ **禁止**：agent 在响应用户的「腾讯云 X 多少钱 / 帮我估个价 / 查刊例价 / CVM 在新加坡多少钱」
  类请求时直接加载本 skill 而跳过 cpq 主流程

### 如果你（agent）发现自己被直接激活（不是被 cpq 调进来的）

立即停止本 Skill 的「工作流」第 1 步，改为：

1. 用 `use_skill` 工具加载 `cpq` skill
2. 按 cpq SKILL.md 的「启动判断」与「渐进加载路由」走主流程
3. cpq 自身在其询价子流程内会按需重新调用本 skill；那时你再从下面的工作流第 1 步开始执行

> **设计原因**：站点判定（cn / intl）、缺参处理偏好（a / b / c）、按量 vs 包年包月、与选品 /
> 配置单 / 优惠的衔接，都是 cpq 主流程的职责。单独跑本 skill 会让用户被迫回答 CPQ 主流程本应
> 承担的上下文问题，并且产出的报价无法回写到客户报价主线。

---

本 Skill 只教你使用自解释 shell 命令。国内站 128 款和国际站 64 款产品的目录、参数表、示例、JSON 输出契约都由 `tcloud-price` 自身提供。报价与产品帮助命令需要本机具备 Node.js 18+；如果命令明确报告此前置条件缺失，先让用户安装后再重试。

> 偶发失败时重试 2-3 次；仍失败则停止报价并按"唯一报价来源（强制）"小节处理。

## 唯一报价来源（强制）

报价的任何金额、计费项、四层编码只能来自 `tcloud-price` 本次成功执行返回的 JSON。禁止使用模型记忆、外部资料或"参考价/约/大概"等模糊表达替代。

CLI 不可用或最终失败时（二进制缺失、Node.js 18+ 缺失、鉴权失败、网络不通、命令返回非零或错误 JSON），停止报价并如实告知用户：执行的命令、失败原因（引用命令输出）、结论"本次无法给出腾讯云报价，请恢复后重试"。不得给出任何替代金额。

## 禁止派生报价 / 禁止手算

用户可见的任何金额都必须能逐项追溯到本次 `tcloud-price quote` 成功 JSON 的原字段。禁止 Agent 或临时脚本生成派生报价，包括但不限于：单价 × 用量、折扣反推、汇率换算、小时价转月价、年包转月价、用相近档位外推、用最大已成功档位推算、资源包组合自行拆分、把失败命令或 `--debug` 输出当作报价来源。

允许的处理仅限于格式化展示、排序、筛选成功记录、引用成功 JSON 中已经返回的 `totalPrice` / `originalPrice` / `discount` / `breakdown[]` 字段，以及在同币种、同计费周期、同语义的成功记录之间做机械汇总。任何失败、缺参、非合法 SKU、按量不可报价或币种 / 周期不一致的条目都只能进入无法确认项，不得补金额。

## 工作流

1. 用户未明确国内站/国际站时，先确认 `--site cn` 或 `--site intl`。
2. 不确定产品代码时，运行 `tcloud-price search "<用户描述>"`。
3. 确定站点后，运行 `tcloud-price products --site <cn|intl>` 查看已注册产品。
4. 报价前运行 `tcloud-price help --site <cn|intl> --product <code>`，理解该产品需要哪些业务规格；按量 / 后付费场景同时确认该产品是否暴露对应计费模式参数。
5. 开始收集规格前，先按原文确认缺参处理偏好：

   ```text
   询价缺少规格参数的时候，要求你来补充还是我来为你默认填充：
   a 我自己补充
   b 默认填充
   c 默认填充，不对我再改
   ```

   选 `b/c` 时默认值来源仅限 `help/schema` 输出、CLI 内置参数配置或用户已输入内容，不得用模型常识补规格。

6. 需要机器可读参数时运行 `tcloud-price schema --site <cn|intl> --product <code>`；返回 JSON 必须包含非空 `parameters` 数组，否则停止并报告工具缺陷。
7. 按用户选择和 `help/schema` 补齐参数后，运行 `tcloud-price quote --site <cn|intl> --product <code> ...`。
8. 报价失败且错误指向鉴权问题时，遵循 CLI 输出的引导完成授权后重试原报价。
9. 其他难以定位的报价失败，可在原命令后加 `--debug` 获取 stderr trace 辅助排障；排障输出不能作为报价金额来源。

任何计算口径、默认值、参数值、规格枚举、计费模式都不能由 Agent 自行猜测。只能来自 `tcloud-price help/schema` 输出、CLI 内置参数配置，或用户明确输入；选择默认填充也不能用模型常识补规格。缺少信息时按用户的缺参处理偏好执行。

报价命令返回非零、JSON 含错误字段、或鉴权失败时，按"唯一报价来源（强制）"小节处理：照实告知失败原因，禁止改用其他渠道或自身经验编造报价。

## 按量报价

按量 / 后付费报价同样走 `tcloud-price quote`，不要自行换算或查文档价。先用 `tcloud-price schema/help --site <cn|intl> --product <code>` 确认该产品是否暴露按量参数；常见参数名包括 `--pay-mode`、`--charge-type`、`--billing-mode`、`--internet-charge-type`，取值可能是 `postPay`、`POSTPAID_BY_HOUR`、`POSTPAID`、`0` 等，以该产品 `help/schema` 为准。

只有 `quote` 成功返回的 JSON 才能作为按量报价来源。页面只有"开通 / 创建"接口、计费说明、静态费率表或资源包用尽后的按量说明时，不视为可报价按量场景；此时应说明当前无法通过 Skill 给出按量报价，不得编造金额。

## 按需读取 references

- 收集规格、处理缺参、组织面向用户的问题时，读取 `references/user-input.md`；不要把 CLI 参数名直接暴露给用户。
- 用户要求批量报价、多产品报价、表格/CSV 报价或规格矩阵报价时，先读取 `references/batch-quote.md`。
- 用户要求四层计费项、四层编码、`ProductCode`、`SubProductCode`、`ValueItemCode`、`ValueSubItemCode` 时，读取 `references/four-level.md`；优先在 `quote` 后追加 `--with-four-level`，`four-level products` 只列需要 CLS fallback 的产品，不是四层能力覆盖清单。

## 输出展示契约

输出默认为标准 JSON。面向用户回答时，只使用命令返回的已确认字段；除非用户明确要求简化、只看总价、只要摘要、JSON、CSV 或纯文本，默认输出最详细的已确认报价信息。

默认回答必须包含：报价结论、配置摘要、价格摘要、报价明细、无法确认项（如有）。报价明细必须逐项展示 `breakdown[]` 返回的全部报价项，不得把多个报价项合并成"其他费用"，不得省略已返回的报价项。

价格摘要和报价明细必须稳定保留三列：`官网原价`、`官网折后价`、`折扣`。字段映射如下：

- 顶层 `originalPrice` → 总官网原价。
- 顶层 `totalPrice` → 总官网折后价 / 实付价。
- 顶层 `discount` → 总折扣。
- `breakdown[].originalPrice` → 报价项官网原价。
- `breakdown[].discountPrice` → 报价项官网折后价。
- `breakdown[].discount` → 报价项折扣。

报价明细默认表头为：`报价项 | 官网原价 | 官网折后价 | 折扣 | 单价 | 单价单位 | 数量/用量 | 说明`。命令未返回某个字段时，列仍必须保留，单元格写 `未返回` 或 `无法确认`；不得用模型常识推断折扣、单价、数量或缺失金额，也不得只展示一个"总价"让用户无法判断折扣口径。

## 命令

```bash
tcloud-price products --site cn
tcloud-price products --site intl
tcloud-price search "新加坡 CVM"
tcloud-price help --site intl --product cos
tcloud-price schema --site cn --product rta_e
command-auth whoami
tcloud-price four-level products --site cn
tcloud-price four-level query --site cn --product cvm --price-cents <分值>
tcloud-price spu resolve --site cn --spu-id <spuId>
tcloud-price spu quote --site cn --spu-id <spuId>
tcloud-price quote --site cn --product rta_e --monthly-spend-wan 2000
```
