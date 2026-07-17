# cpq CLI 使用指南

查询和写入 CPQ 系统的命令行工具。

## 注意

小O沙箱环境下（SANDBOX_SIGNATURE、SANDBOX_TOKEN_KEY、SANDBOX_STAFFNAME、SANDBOX_ID 齐全），CLI 自动使用 sandbox-token 认证，无需手动登录。


## 安装与调用约定

**调用**：

```bash
cpq {command}
```


### 认证机制

CLI 自动检测运行环境，按优先级选择认证方式：

| 优先级 | 环境 | 检测条件 | 认证方式 |
|--------|------|----------|----------|
| 1 | sandbox-token | `SANDBOX_SIGNATURE` + `SANDBOX_TOKEN_KEY` + `SANDBOX_STAFFNAME` + `SANDBOX_ID` 存在 | 自动使用沙箱 token，无需登录 |
| 2 | client-token | 无上述环境变量 | 需执行 `command-auth` |

沙箱/平台环境下 `command-auth` 会直接跳过并提示无需操作。

不确定命令参数时，先执行 `cpq help {command}` 查看说明。

## 报价单操作

```bash
cpq search [keyword] [--all] [--site <site>] [--intl] [--tce] [-p page] [-s size]  # 搜索报价单（默认国内站）
cpq info {code}                                    # 查看报价单详情
cpq cpq360 {code}                                  # 报价单全景视图
cpq url {code}                                     # 获取报价单链接（自动判断国内/国际站）
cpq create {project_code} [--oversea]              # 创建报价单（国际站加 --oversea）
cpq copy {code}                                    # 复制报价单
cpq share {code} {staffname}                       # 转交报价单
cpq rename {code} --name "新名称"                  # 修改报价单名称
cpq delete {code}                                  # 删除报价单
cpq save --cpqcode {code}                          # 保存草稿
cpq submit --cpqcode {code}                        # 提交审批
cpq calc-discount --path {path} --cpqcode {code}   # 计算整单折扣策略
```

### project search — 搜索项目

```bash
cpq project search [keyword] [--uin <uin>] [--oversea|--domestic] [-p page] [-s size]
```

**参数**：

| 参数 | 说明 |
|------|------|
| `keyword` | 搜索关键词（项目编号/名称，可选） |
| `--uin <uin>` | 按 UIN 筛选（可选） |
| `--oversea` | 仅搜索国际站项目（可选） |
| `--domestic` | 仅搜索国内站项目（可选） |
| `-p, --page <n>` | 页码（默认 1） |
| `-s, --size <n>` | 每页数量（默认 20） |

**示例**：
```bash
cpq project search 客户A
cpq project search --uin 100001234567
cpq project search --oversea -p 2
```

### search 参数

| 参数             | 说明                                                                              |
| ---------------- | --------------------------------------------------------------------------------- |
| `keyword`        | 搜索关键词（可选），支持报价单编号、名称、项目编号、项目名称、销售、客户名称、UIN |
| `--all`          | 查询全部报价单（默认只查自己创建的）                                              |
| `--site <site>`  | 站点过滤：`domestic`(国内站,默认) \| `intl`(国际站) \| `tce` \| `all`(全部)       |
| `--intl`         | 等价于 `--site intl`（国际站）                                                    |
| `--tce`          | 等价于 `--site tce`                                                               |
| `-p, --page <n>` | 页码（默认 1）                                                                    |
| `-s, --size <n>` | 每页数量（默认 20）                                                               |

## 产品搜索与浏览

### 匹配规则（quick-search 和 batch-search 通用）

搜索通过远程服务执行，范围包含**产品名称**和**直接父级目录名称**，两者使用相同的匹配规则：

### quick-search — 逐条搜索
按关键词搜索产品，无需 `--cpqcode`。返回 Markdown 表格。
```bash
cpq product quick-search -q "云服务器 CVM 标准型S5"
cpq product quick-search -q "Redis" -c "数据库"     # 按分类筛选
cpq product quick-search -q CVM --oversea            # 搜索国际站产品
cpq product quick-search -q CVM --stdout  # 结果输出到 stdout（数据量大时推荐）
```

**参数**：
- `-q, --keyword <keyword>` — 搜索关键词（必填）
- `-c, --category <category>` — 按产品分类筛选（可选）
- `--oversea` — 搜索国际站产品（可选）
- `--stdout` — 将**全量** JSON 结果输出到 stdout（**必须用此参数**，不加则控制台只显示前 20 条）；需要落文件时用 shell 重定向：`cpq product quick-search ... --stdout > "$CPQ_SESSION_DIR/result.json"`
- `-o, --output <filepath>` — ⚠️ 已弃用，**禁止使用**：写入路径为沙箱内部路径，后续命令无法访问

**返回字段**：类型（产品/目录）、ID、spuId、名称、匹配度、命中词、未命中词、售卖模式、可售卖状态、互斥产品、目录路径。

**使用要点**：

- **必须加 `--stdout`** 才能拿到全量结果；不加只显示前 20 条
- 产品节点的 spuId 可直接用于 `row add --spu-ids`
- 互斥产品列显示与当前产品存在互斥关系的产品（spuName + spuId），添加产品前注意检查
- 国际站搜索加 `--oversea`，返回英文产品名和路径

### batch-search — 批量搜索
多关键词一次搜索，不限数量。默认输出 JSON 到文件，控制台只显示摘要。

```bash
cpq product batch-search -q "CVM 标准型S5" "Redis 标准版" \
  --stdout                     # 推荐：输出到 stdout
cpq product batch-search --json '[{"keyword":"CVM 标准型S5"}]' \
  --stdout                     # JSON 数组输入，输出到 stdout
cpq product batch-search -q "CVM" --stdout   # 输出到 stdout
cpq product batch-search -q "CVM" --fmt table                      # 表格形式输出到控制台
cpq product batch-search -q "CVM" --oversea                        # 搜索国际站产品
```

**默认输出**：**必须加 `--stdout`** 才能拿到全量 JSON；不加只在控制台显示摘要。需要落文件时用 shell 重定向：`... --stdout > "$CPQ_SESSION_DIR/batch.json"`，**禁止用 `-o`**（沙箱路径，后续命令无法访问）。

**输出格式**：

```json
{
  "hits": [{ "keyword": "CVM 标准型S5", "results": [{ "id": "21793", "spuId": "21793", "name": "云服务器CVM-标准型S5（预付费）", "type": "产品", "mutexSpus": [{"spuId": 123, "spuName": "xxx"}], ... }] }],
  "misses": [{ "keyword": "蓝盾流水线", "reason": "no_match" }],
  "summary": { "total": 3, "hitCount": 2, "missCount": 1 }
}
```

**互斥产品检测**：搜索结果中每个产品自带 `mutexSpus` 字段，列出与其互斥的产品列表。添加产品前直接查看此字段即可判断互斥关系，无需单独执行互斥检测命令。

### product search — 在线搜索（需要初始化 Store）

```bash
cpq product search -q {keyword} --cpqcode {code}
```

### product price — 查询 SPU 刊例价

根据 spuId 查询产品的刊例价信息，无需 `--cpqcode`。

```bash
cpq product price --spu-ids 14737                              # 查询单个 SPU 刊例价
cpq product price --spu-ids 307,22279                          # 查询多个 SPU
cpq product price --spu-ids 307 --pay-mode prepay              # 只查预付费模式
cpq product price --spu-ids 307 --currency USD --oversea       # 国际站 USD 币种
cpq product price --spu-ids 307 --fmt json                     # JSON 格式输出
```

**参数**：

- `--spu-ids <id1,id2,...>` — spuId 列表（逗号分隔，必填）
- `--pay-mode <prepay|postpay>` — 售卖模式筛选（可选，不传则查询所有模式）
- `--currency <CNY|USD>` — 币种（可选，默认 CNY）
- `--oversea` — 国际站查询（可选，默认国内站）
- `--fmt json` — 以 JSON 格式输出原始数据（可选）

**返回信息**：每个 SPU 每种售卖模式对应的刊例价信息（定价类型、单位、价格明细等）。

### 搜索失败处理

| 失败情况                  | 处理方式                               |
| ------------------------- | -------------------------------------- |
| 产品显示 `✗(停止销售)` 等 | 该产品已退市，排除或联系产委申请白名单 |

## 报价行操作

```bash
cpq row add --spu-ids {spuId1},{spuId2_payMode} --cpqcode {code}           # 按 SPU ID 添加产品（单次最多 100 个，建议每批 50-100 个）
cpq row add --four-layer-codes {code1},{code2} --cpqcode {code}    # 按四层编码添加（单次最多 100 个，建议每批 50-100 个）
cpq row import [--month {YYYY-MM}] --cpqcode {code}                # 按客户账单导入（覆盖当前产品）
cpq row list [-p page] [-s pageSize] [--fields f1,f2] --cpqcode {code}  # 列出报价行
cpq row search -k {keyword} --cpqcode {code}                       # 搜索报价行
cpq row inspect --ids {id1,id2} --cpqcode {code}                   # 查看行详情
cpq row cat --id {id} --key {key} --cpqcode {code}                 # 查看行指定字段
cpq row update --id {id} --key {key} --value {val} --cpqcode {code}  # 修改行字段
cpq row batch-update --items {json} --cpqcode {code}               # 批量修改行字段
cpq row batch-update --compress {base64} --cpqcode {code}          # 批量修改（压缩传输，强烈推荐）
cpq row rm --ids {id1,id2} --cpqcode {code}                        # 删除报价行
```

### 售卖模式（payMode）

`row add --spu-ids` 的 `{spuId}_{payMode}` 格式和 `row update`/`batch-update` 的 nodeId 中，payMode 支持以下值（中文和英文均可，CLI 自动标准化）：

| 售卖模式 | payMode（英文） | 中文名 |
|---|---|---|
| 按量计费 | `postpay` | 按量计费 |
| 包年包月 | `prepay` | 包年包月 |
| 一次性付费 | `onetimepay` | 一次性付费 |
| 容量预留 | `crpay` | 容量预留 |
| 竞价实例 | `spotpay` | 竞价实例 |
| 预留实例 | `ripay` | 预留实例 |

示例：`row add --spu-ids 17468_onetimepay,14824_onetimepay --cpqcode {code}`

### `--compress` 用法（批量更新必须使用）

`--compress` 是 `--items` 的替代参数，**CLI 场景下必须优先使用**，避免 JSON 引号在 shell 传输中被破坏。

生成方式（Python）：
```python
import json, zlib, base64
items = {"18512_postpay": {"priceBeforeDiscount": "1000", "preference": {"preferenceType": "discount", "value": 85}}}
compressed = base64.b64encode(zlib.compress(json.dumps(items).encode())).decode()
# 然后传入: cpq row batch-update --compress {compressed} --cpqcode {code}
```

生成方式（Node.js）：
```javascript
const zlib = require('zlib');
const items = {"18512_postpay": {"priceBeforeDiscount": "1000", "preference": {"preferenceType": "discount", "value": 85}}};
const compressed = zlib.deflateSync(Buffer.from(JSON.stringify(items))).toString('base64');
// 然后传入: cpq row batch-update --compress ${compressed} --cpqcode ${code}
```

支持 gzip、zlib、raw deflate 任意压缩格式，CLI 自动识别。

## 客户信息

```bash
cpq customer info --cpqcode {code}                                 # 查询客户年消和分层
cpq customer set --key {key} --value {value} --cpqcode {code}      # 设置客户信息
```

`customer set` 仅支持以下两个 key：

| key | 含义 | value 格式 | 示例 |
|-----|------|-----------|------|
| `customerYearExpenseCompetitor` | 客户在友商年消（元） | 数字字符串 | `"0"`、`"1000000"` |
| `period` | 优惠季度有效期 | `YYYY-QN,YYYY-QN`（开始季度,结束季度）| `"2026-Q2,2027-Q1"` |

> ⚠️ `period` 注意事项：
> - 格式必须是 `YYYY-QN,YYYY-QN`，Q1-Q4 对应四个季度，**不接受日期格式**
> - 开始季度**不能早于当前季度**（如当前是 2026-Q2，则开始不能填 2026-Q1 或更早）
> - "最近4个季度"= 从当前季度起连续 4 个季度，如当前 2026-Q2 → `"2026-Q2,2027-Q1"`

## 通用

```bash
cpq sessions                 # 列出所有已加载的报价单
cpq help [command]           # 查看命令帮助
```

## 使用约定

- 获取结构化数据时追加 `--fmt json`；面客展示转成简洁中文
- ⚠️ **写入类命令（`row add`/`row import`/`row update`/`row batch-update`/`row rm`/`customer set`）只在本地会话内存中生效，不会自动同步到服务端**。必须在写入操作完成后显式执行 `cpq save --cpqcode {code}` 才能持久化。不 save 则线上数据为空/旧状态
- 阶段性完成后用 `cpq save --cpqcode {code}` 保存（**强制，不可省略**）
- `save` 后建议用 `cpq info {code}` 验证报价行数量，确认持久化成功
- 批量更新、删除、提交等高影响动作，执行前先确认影响范围
- 金额字段（`priceBeforeDiscount`、`priceAfterDiscount` 等）单位为**元**

## 错误处理

| 错误信号                  | 处理方式                                                        |
| ------------------------- | --------------------------------------------------------------- |
| `success: false` + errors | 读取 errors 修正参数，不要只重试                                |
| `HTTP_ERROR`              | 检查网络连接                                                    |
| `row add` 部分失败        | 汇报成功/失败明细                                               |
| bash 输出乱码             | 用 `{command} 2>"$CPQ_SESSION_DIR/cpq_out.txt"; echo "done"` 重定向到会话目录后读取文件 |

## 术语规范

| 术语       | 含义                                               |
| ---------- | -------------------------------------------------- |
| **SPU ID** | 产品标识符，`row add --spu-ids` 的输入             |
| **报价行** | 报价单中的行项目，一个 SPU ID 可能展开为多条报价行 |
| **产品**   | 面客语言，用户清单中的一个产品条目                 |

汇报结果时应同时说明 SPU ID 数和最终报价行数。