# Batch Quote

用户要求批量报价、多产品报价、表格/CSV 报价或规格矩阵报价时，允许 Agent 写临时 Python、Node.js 或 shell 脚本循环调用 `tcloud-price`。脚本只负责批量执行、解析 JSON、汇总结果；不得绕过 CLI 自行计算价格，不得生成任何派生报价。

## 执行流程

1. 先确认站点与缺参处理偏好：`a 我自己补充`、`b 默认填充`、`c 默认填充，不对我再改`。
2. 对每个涉及产品运行 `tcloud-price schema --site <cn|intl> --product <code>`，用 schema 对每条记录做参数分类。
3. 参数未补齐的记录先标记为 `pending`，不要调用 `quote` 制造噪音错误。
4. 参数完整后，脚本低并发或串行调用 `tcloud-price quote ...`；捕获每条记录的输入、命令、exit code、stdout、stderr 和 JSON 摘要。
5. 登录态错误只允许触发一次 `tcloud-price auth refresh --site <cn|intl>` 后重试受影响记录；仍失败则标记 `failed`。

## 价格来源追踪

每条输出金额都必须保留来源：`recordId`、完整 `command`、`exitCode`、本次成功 stdout JSON，以及引用的 JSON 字段路径（如 `totalPrice`、`originalPrice`、`breakdown[0].discountPrice`）。`success` 只能展示成功 JSON 已返回的金额；`pending` 和 `failed` 一律不给金额，不得用单价 × 用量、汇率换算、小时价转月价、年包转月价、相近档位外推或失败记录中的局部信息补齐。

如用户要求总计，只允许对同币种、同计费周期、同语义的 `success.totalPrice` 做机械加总，并且必须标注"仅汇总成功记录"。存在任何 `pending` 或 `failed` 时，不能把总计表述为完整报价，也不能为失败项估算金额。

## 缺参分类

| 类别 | 含义 | 处理 |
|------|------|------|
| provided | 用户、CSV 或表格已给值 | 可进入报价队列 |
| defaultable | 缺失，但 `schema/help` 或 CLI 内置参数配置有明示默认值 | 按 a/b/c 偏好处理 |
| required | 缺失且无明示默认值 | 必须由用户补齐，未补齐保持 `pending` |

`required` 字段在任何偏好下都不能由 Agent 或脚本补默认值。

## a/b/c 分支

- 选 `a 我自己补充`：把 `defaultable` 和 `required` 都按"产品 / 条目 ID / 业务字段名 / 缺失条数"汇总给用户补齐。
- 选 `b 默认填充`：仅自动填充 `defaultable`；`required` 仍汇总追问。结果中列出默认填充过的字段。
- 选 `c 默认填充，不对我再改`：同 `b`，但默认填充清单必须逐条列出；用户修正时只重跑受影响记录。

## 汇总输出

批量结果按四段输出：

- `success`：成功报价记录，展示业务规格、总价和明细；除非用户明确要求简化，逐条展开每条记录的 `breakdown[]` 全部报价项。
- `pending`：未补齐规格的记录，列出缺失业务字段，不给金额。
- `defaulted`：仅在 `b/c` 下出现，列出产品、条目 ID、字段和默认值。
- `failed`：CLI 执行失败记录，列出命令和关键 stdout/stderr，不给替代金额。

批量报价继承主 `SKILL.md` 的输出展示契约。每条成功记录的价格摘要和报价明细都必须稳定保留 `官网原价`、`官网折后价`、`折扣` 三列；命令未返回字段时保留列并写 `未返回` 或 `无法确认`，不得自行补折扣或只输出单一总价。只有用户明确要求"汇总表即可"、"只要总价"或指定 CSV / JSON 格式时，才允许把明细收起。

只有 `pending=0` 且 `failed=0` 时，才能表述为全部完成。任一记录失败或缺参时，都要明确成功、待补充、失败的数量。
