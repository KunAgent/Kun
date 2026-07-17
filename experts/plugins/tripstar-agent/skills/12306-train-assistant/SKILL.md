---
name: 12306-train-assistant
description: 12306 查询与订票辅助技能，支持余票查询、经停站查询、中转换乘、候补查询与提交/取消、登录状态检查、密码登录与二维码登录、下单与支付链接获取；当用户提到火车票、高铁票、经停站、中转、候补或 12306 查票时触发。
description_zh: "12306 全功能辅助：余票/中转/候补/下单/支付，需登录账号"
description_en: "Full 12306 assistant: ticket query, transfer, waitlist, booking and payment"
version: 0.1.7
allowed-tools: Bash,Read
icon: 🚄
---

# 12306 CLI Skill 🚄

## 目标

用本仓库的 `client.py` 完成 12306 相关查询与下单辅助，优先覆盖：

- 余票查询：`left-ticket`
- 中转换乘：`transfer-ticket`
- 中转下单：`transfer-book`
- 经停站：`route`（支持 `--train-code` 自动解析）
- 登录态检查：`status`
- 二维码登录：`qr-login-create`
- 候补管理：`candidate-queue` / `candidate-orders` / `candidate-submit` / `candidate-cancel` / `candidate-pay`
- 支付信息：`order-pay`
- 需要登录的操作：`passengers` / `orders` / `order-no-complete` / `book` / `transfer-book` / `order-pay` / `candidate-submit` / `candidate-cancel` / `candidate-pay`

## 触发信号

用户提到下列需求时触发本技能：

- “查明天北京到上海余票”
- “G1033 经停站”
- “深圳到拉萨怎么中转”
- “把第1个中转方案下单”
- “候补排队状态怎么样”
- “12306 登录状态”

## 执行原则

1. 默认用 `text` 输出（便于用户阅读）；仅在用户明确要求结构化数据时加 `--json`。
2. 解析相对日期（今天/明天/后天）为 `YYYY-MM-DD` 后再执行命令。
3. 站名支持中文/拼音/三字码，直接传给命令即可。
4. `route` 优先用 `--train-code`，减少用户提供 `train_no` 的负担。
5. 失败时先给出可执行修复建议（缺参数、日期格式、站名不匹配、风控限制等）。
6. `book`/`transfer-book` 成功后优先告知订单号，并提示下一步执行 `order-pay` 获取支付参数；若网页支付不可用，建议去 12306 App 的“待支付订单”继续支付。
7. `qr-login-create` 会自动后台启动登录检查；扫码确认后统一用 `status` 判断是否已登录。

## 常用示例

### 示例 1：余票查询

```bash
python3 client.py left-ticket --date 2026-03-23 --from 北京南 --to 上海虹桥
python3 client.py left-ticket --date 2026-03-23 --from 北京 --to 上海 --limit 10 --json
```

### 示例 2：中转换乘

```bash
python3 client.py transfer-ticket --date 2026-03-23 --from 深圳 --to 拉萨 --limit 10
python3 client.py transfer-ticket --date 2026-03-23 --from 深圳 --to 拉萨 --middle 西安 --json
```

### 示例 2.1：中转下单

```bash
# 先预检（不最终提交）
python3 client.py transfer-book --date 2026-03-23 --from 成都 --to 广安 --plan-index 1 --seat second_class --passengers 张三 --dry-run

# 正式提交
python3 client.py transfer-book --date 2026-03-23 --from 成都 --to 广安 --plan-index 1 --seat second_class --passengers 张三
```

### 示例 3：经停站

```bash
# 推荐：直接用车次号，脚本自动解析 train_no
python3 client.py route --train-code C956 --date 2026-03-23 --from 南部 --to 南充北

# 已知 train_no 时可直查
python3 client.py route --train-no 760000C95604 --date 2026-03-23 --from NBE --to NCE
```

### 示例 4：登录与状态

```bash
python3 client.py status
python3 client.py login --username <账号> --password <密码>
python3 client.py login --username <账号> --id-last4 <证件后4位> --send-sms
python3 client.py login --username <账号> --id-last4 <证件后4位> --sms-code <6位验证码>

# 二维码登录流程
python3 client.py qr-login-create
python3 client.py status
```

### 示例 5：乘车人与订单

```bash
python3 client.py passengers --limit 50
python3 client.py orders --where G --page-size 20
python3 client.py orders --where H --start-date 2026-02-01 --end-date 2026-03-01
python3 client.py order-no-complete
python3 client.py order-no-complete --any --json
```

### 示例 6：订票（预检与提交）

```bash
# 只校验，不最终提交
python3 client.py book --date 2026-03-23 --from 北京南 --to 上海虹桥 --train-code G101 --seat second_class --passengers 张三 --dry-run

# 正式提交
python3 client.py book --date 2026-03-23 --from 北京南 --to 上海虹桥 --train-code G101 --seat second_class --passengers 张三

# 单人选座（D 会自动归一化为 1D）
python3 client.py book --date 2026-03-23 --from 北京南 --to 上海虹桥 --train-code G101 --seat second_class --passengers 张三 --choose-seats D

# 不下单，仅获取订单支付信息（普通/中转通用）
python3 client.py order-pay --pay-channel alipay
```

### 示例 7：候补查询

```bash
# 候补排队状态
python3 client.py candidate-queue

# 候补订单（进行中）
python3 client.py candidate-orders

# 候补订单（已处理）
python3 client.py candidate-orders --processed --start-date 2026-03-11 --end-date 2026-04-09 --limit 20

# 提交候补（建议目标席别余票为“无”时）
python3 client.py candidate-submit --date 2026-03-23 --from 北京南 --to 上海虹桥 --train-code G101 --seat second_class

# 取消候补
python3 client.py candidate-cancel --reserve-no <候补单号>

# 候补支付参数（自动读取 reserve_no）
python3 client.py candidate-pay

# 候补支付参数（指定 reserve_no）
python3 client.py candidate-pay --reserve-no <候补单号>
```

## 每个命令参数说明

### 全局参数（所有命令可用）

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--timeout` | 否 | `15` | 请求超时时间（秒） |
| `--json` | 否 | 关闭 | 以 JSON 输出结果 |

### `left-ticket` 余票查询

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--date` | 是 | 无 | 出发日期，`YYYY-MM-DD` |
| `--from` | 是 | 无 | 出发站（中文/拼音/三字码） |
| `--to` | 是 | 无 | 到达站（中文/拼音/三字码） |
| `--purpose` | 否 | `ADULT` | 乘客类型 |
| `--endpoint` | 否 | `queryG` | 余票接口类型，`queryG` 或 `queryZ` |
| `--limit` | 否 | `20` | 文本输出时最多展示行数 |

### `transfer-ticket` 中转换乘

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--date` | 是 | 无 | 出发日期，`YYYY-MM-DD` |
| `--from` | 是 | 无 | 出发站 |
| `--to` | 是 | 无 | 到达站 |
| `--middle` | 否 | 空 | 指定换乘站，不传则自动推荐 |
| `--result-index` | 否 | `0` | 分页游标 |
| `--can-query` | 否 | `Y` | 是否继续查询更多方案（`Y/N`） |
| `--show-wz` | 否 | 关闭 | 显示无座方案 |
| `--purpose` | 否 | `00` | 中转接口乘客类型参数 |
| `--channel` | 否 | `E` | 中转接口渠道参数 |
| `--endpoint` | 否 | `queryG` | 中转接口类型，`queryG` 或 `queryZ` |
| `--limit` | 否 | `20` | 文本输出时最多展示方案数 |

### `transfer-book` 提交中转订单

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--date` | 是 | 无 | 出发日期，`YYYY-MM-DD` |
| `--from` | 是 | 无 | 出发站 |
| `--to` | 是 | 无 | 到达站 |
| `--middle` | 否 | 空 | 指定换乘站，不传则自动推荐 |
| `--plan-index` | 否 | `1` | 选择第几个中转方案（从 1 开始） |
| `--result-index` | 否 | `0` | 中转查询分页游标 |
| `--can-query` | 否 | `Y` | 是否继续查询更多方案（`Y/N`） |
| `--show-wz` | 否 | 关闭 | 显示无座方案 |
| `--seat` | 是 | 无 | 席别（如 `second_class` / `O` / `一等座`） |
| `--passengers` | 是 | 无 | 乘客姓名，多个用逗号分隔 |
| `--purpose` | 否 | `00` | 中转乘客类型编码 |
| `--channel` | 否 | `E` | 中转接口渠道参数 |
| `--endpoint` | 否 | `queryG` | 中转接口类型（`queryG/queryZ`） |
| `--max-wait-seconds` | 否 | `30` | 排队轮询最长等待秒数 |
| `--poll-interval` | 否 | `1.5` | 排队轮询间隔（秒） |
| `--dry-run` | 否 | 关闭 | 只检查不提交最终确认 |

### `route` 经停站查询

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--train-code` | 二选一 | 无 | 车次号（如 `C956`、`G1033`），会自动解析 `train_no` |
| `--train-no` | 二选一 | 无 | 内部车次号（如 `760000C95604`） |
| `--date` | 是 | 无 | 查询日期，`YYYY-MM-DD` |
| `--from` | 是 | 无 | 区间出发站 |
| `--to` | 是 | 无 | 区间到达站 |
| `--endpoint` | 否 | `queryG` | 仅 `--train-code` 模式下用于解析 `train_no` |
| `--purpose` | 否 | `ADULT` | 仅 `--train-code` 模式下用于解析 `train_no` |
| `--limit` | 否 | `200` | 文本输出时最多展示站点数 |

### `login` 登录

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--username` | 是 | 无 | 12306 用户名/邮箱/手机号 |
| `--password` | 否 | 交互输入或 `KYFW_PASSWORD` | 登录密码 |
| `--id-last4` | 否 | 无 | 证件号后 4 位，短信验证场景需要 |
| `--sms-code` | 否 | 无 | 6 位短信验证码 |
| `--send-sms` | 否 | 关闭 | 仅发送短信验证码，不执行完整登录 |

### `status` 登录状态检查

无专属参数，仅使用全局参数。

### `qr-login-create` 生成二维码登录图片（自动后台检查，不阻塞）

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--appid` | 否 | `otn` | 二维码登录 appid |

### `passengers` 乘车人查询

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--limit` | 否 | `200` | 文本输出最多展示人数 |

### `orders` 订单查询

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--where` | 否 | `G` | `G` 未出行/近期，`H` 历史订单 |
| `--start-date` | 否 | 自动计算 | 查询起始日期，`YYYY-MM-DD` |
| `--end-date` | 否 | 今天（`--where H` 时为昨天） | 查询结束日期，`YYYY-MM-DD`；历史订单场景必须早于今天 |
| `--page-index` | 否 | `0` | 页码 |
| `--page-size` | 否 | `8` | 每页条数 |
| `--query-type` | 否 | `1` | 查询类型：`1` 按订票日期，`2` 按乘车日期 |
| `--train-name` | 否 | 空 | 按订单号/车次/姓名筛选（对应接口字段 `sequeue_train_name`） |

### `order-no-complete` 查询 1 条未完成订单

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--any` | 否 | 关闭 | 默认仅返回可支付订单（`pay_flag=Y`）；开启后返回第一条未完成订单 |

### `candidate-queue` 候补排队状态

无专属参数，仅使用全局参数。

### `candidate-orders` 候补订单查询

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--processed` | 否 | 关闭 | 查询已处理候补订单；默认查询进行中 |
| `--page-no` | 否 | `0` | 页码 |
| `--start-date` | 否 | 今天 | 查询起始日期，`YYYY-MM-DD` |
| `--end-date` | 否 | 起始日期+29天 | 查询结束日期，`YYYY-MM-DD` |
| `--limit` | 否 | `20` | 文本输出最多展示条数 |

### `candidate-submit` 提交候补订单

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--date` | 是 | 无 | 出发日期，`YYYY-MM-DD` |
| `--from` | 是 | 无 | 出发站 |
| `--to` | 是 | 无 | 到达站 |
| `--train-code` | 是 | 无 | 目标车次（如 `G101`） |
| `--seat` | 是 | 无 | 席别（如 `second_class` / `O` / `一等座`） |
| `--passengers` | 否 | 空 | 乘客姓名，多个用逗号分隔；不传时默认选首位乘车人 |
| `--purpose` | 否 | `ADULT` | 乘客类型 |
| `--endpoint` | 否 | `queryG` | 余票接口类型 |
| `--force` | 否 | 关闭 | 即使余票不是“无”也尝试提交候补 |
| `--max-wait-seconds` | 否 | `30` | 候补排队轮询最长等待秒数 |
| `--poll-interval` | 否 | `1.0` | 候补排队轮询间隔秒数 |

说明：当前实现会继续执行候补确认与排队查询；若超时会返回“仍在排队中”，可继续用 `candidate-orders`/`candidate-queue` 查看。

### `candidate-cancel` 取消候补订单

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--reserve-no` | 是 | 无 | 候补单号（reserve_no） |

### `candidate-pay` 候补支付参数获取

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--reserve-no` | 否 | 自动读取 | 候补单号；不传则尝试从 `candidate-queue` 自动读取 |
| `--pay-channel` | 否 | 空 | 支付渠道：`alipay` / `wechat` / `unionpay` |

### `order-pay` 订单支付参数（不下单，普通/中转通用）

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--pay-channel` | 否 | 空 | 支付渠道：`alipay` / `wechat` / `unionpay` |

### `book` 订票

| 参数 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `--date` | 是 | 无 | 出发日期，`YYYY-MM-DD` |
| `--from` | 是 | 无 | 出发站 |
| `--to` | 是 | 无 | 到达站 |
| `--train-code` | 是 | 无 | 目标车次（如 `G101`） |
| `--seat` | 是 | 无 | 席别（如 `second_class` / `O` / `一等座`） |
| `--passengers` | 是 | 无 | 乘客姓名，多个用逗号分隔 |
| `--purpose` | 否 | `ADULT` | 乘客类型 |
| `--endpoint` | 否 | `queryG` | 余票接口类型 |
| `--choose-seats` | 否 | 空 | 选座（如 `1D`；单人可传 `D`） |
| `--max-wait-seconds` | 否 | `30` | 排队轮询最长等待秒数 |
| `--poll-interval` | 否 | `1.5` | 排队轮询间隔（秒） |
| `--dry-run` | 否 | 关闭 | 只检查不提交最终确认 |

## 参数提取规则

- 出发站：`--from`
- 到达站：`--to`
- 日期：`--date`（格式 `YYYY-MM-DD`）
- 经停场景：用户给车次号（如 `G1033`、`C956`）时用 `--train-code`
- 经停场景：用户给内部号（如 `760000C95604`）时用 `--train-no`
- 查询区间优先用用户提供的 `from/to`

## 输出策略

- 默认输出文本结果并概括关键信息。
- 若用户说“返回 JSON / 机器可读”，添加 `--json` 并返回结构化摘要。
- `book`/`transfer-book` 成功时应突出 `order_id`，并提示用户执行 `order-pay` 获取支付参数。

## 示例工作流

### 示例 A：余票

用户：“查明天北京到上海余票”

```bash
python3 client.py left-ticket --date <明天日期> --from 北京 --to 上海
```

### 示例 B：经停站

用户：“C956 经停哪些站”

如果用户未给日期或区间，先补齐最小参数（日期、from、to）；拿到后执行：

```bash
python3 client.py route --train-code C956 --date <日期> --from <出发站> --to <到达站>
```

### 示例 C：中转

用户：“深圳到拉萨怎么中转”

```bash
python3 client.py transfer-ticket --date <日期> --from 深圳 --to 拉萨 --limit 10
```

### 示例 C.1：中转下单

用户：“把第1个中转方案给我下单，二等座，乘客张三”

```bash
python3 client.py transfer-book --date <日期> --from <出发站> --to <到达站> --plan-index 1 --seat second_class --passengers 张三

# 下单成功后，单独获取支付参数/二维码
python3 client.py order-pay --pay-channel alipay
```

### 示例 D：候补

用户：“帮我看看候补订单有没有兑现”

```bash
python3 client.py candidate-orders --processed --start-date <起始日期> --end-date <结束日期> --limit 20
```

## 限制与注意

1. 中转结果来自 12306 推荐，不保证覆盖所有可行组合。
2. 可能触发风控（如 `error.html`），需提示用户稍后重试或降低频率。
3. 订票链路依赖登录态与乘车人信息，建议先 `status`/`passengers`。
4. 相对日期必须换算成绝对日期再执行命令。
5. 支付阶段统一走 `order-pay`；脚本会尝试返回支付二维码/链接；也要主动提示用户去 12306 App 的“待支付订单”支付。
