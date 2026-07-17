# 报价行金额批量设置

## 适用场景

选品完成后，为报价行批量填入预估消耗、折后价等**金额数值字段**。

> 本文档只覆盖金额等数值字段的批量写入；折扣、一口价等优惠类型/策略的设置见 [how-to-preference-one-row.md](./how-to-preference-one-row.md)。

## 前提条件

- 已通过用户提供的 Excel 数据或其他方式获得了每个报价行的金额数据
- 如果尚未拥有每个报价行的金额数据，**跳过本步骤**，并提示用户："当前缺少报价行的金额数据"
- **返佣数据来源**：Phase 1 产物（`phase1.md`）中的 `返佣（%）` 列。当该列有非 `-` 的值时，必须在批量更新 JSON 中写入 `rebate` 字段

## 批量更新流程

当已有每个报价行的金额数据时，优先使用批量更新方式：

1. 将所有报价行的金额数据组装为**单个 JSON 对象**（以报价行节点 ID 为 key）
2. **必须使用 `--compress` 模式传输**（避免 JSON 引号在 shell 传输中被破坏）：
   ```python
   import json, zlib, base64
   items = {...}  # 所有报价行的金额数据
   compressed = base64.b64encode(zlib.compress(json.dumps(items).encode())).decode()
   # 执行: cpq row batch-update --compress {compressed} --cpqcode {code}
   ```
3. CLI 会校验并批量执行；若某些行校验失败，根据错误信息修复对应字段后重新执行

> ⚠️ **禁止使用 `--items` 直接传 JSON 字符串**——shell 引号转义极易导致解析失败。必须用 `--compress`。

### JSON 格式

JSON 格式为 `{ [nodeId]: { [fieldName]: value } }`：

```json
{
  "14824_prepay": {
    "priceBeforeDiscount": "2826.60",
    "priceAfterDiscount": "1130.64",
    "priceAfterDiscountDeleteTax": "1066.64",
    "rebate": "0"
  },
  "11499_prepay": {
    "priceBeforeDiscount": "70448.05",
    "priceAfterDiscount": "28179.22",
    "priceAfterDiscountDeleteTax": "26584.17",
    "rebate": "5"
  }
}
```

### 可更新字段说明

| 字段名 | 含义 | 格式 |
|---|---|---|
| `priceBeforeDiscount` | 预估消耗（折前金额） | 字符串数字，如 `"2826.60"` |
| `priceAfterDiscount` | 折后含税金额 | 字符串数字 |
| `priceAfterDiscountDeleteTax` | 折后不含税金额 | 字符串数字，= 折后含税 ÷ 1.06 |
| `rebate` | 返佣/返点比例 | 字符串数字，如 `"0"`、`"5"`、`"10"`；来自 Phase 1 产物的 `返佣（%）` 列，非 `-` 时必须写入 |
| `taxRate` | 税率 | 字符串，默认 `"6"` |
| `remark` | 备注 | 字符串 |

> 优惠字段 `preference` 的设置规则见 [how-to-preference-one-row.md](./how-to-preference-one-row.md)，本文档不覆盖。

### nodeId 命名规则

`nodeId` = `{spuId}_{payMode}`。payMode 必须从 `row list` 返回的实际 nodeId 中取，**禁止自行拼接**。

如果必须从售卖模式中文名推断，映射如下（CLI 支持中文和英文，自动标准化）：

| 售卖模式（中文） | payMode |
|---|---|
| 按量计费 | `postpay` |
| 包年包月 | `prepay` |
| 一次性付费 | `onetimepay` |
| 容量预留 | `crpay` |
| 竞价实例 | `spotpay` |
| 预留实例 | `ripay` |

> 直接使用中文（如 `17468_一次性付费`）或英文（如 `17468_onetimepay`）均可，CLI 自动转换。

### 组装建议

把全单所有报价行的金额数据合并进**同一个 JSON 对象**，通过 `--compress` 一次性传入

### 返佣字段写入规则（强制）

- Phase 1 产物中 `返佣（%）` 列**非 `-`** 时，**必须**在 batch-update JSON 中写入 `"rebate": "<值>"`
- 即使返佣为 `0`，也必须显式写入 `"rebate": "0"`，**不得省略**
- `返佣（%）` 列为 `-` 时，不写入 `rebate` 字段（由系统使用默认值）
- **验证（强制自检）**：batch-update JSON 写完后，逐行检查：Phase 1 中 `返佣（%）` 非 `-` 的行，在 JSON 中是否都有对应的 `rebate` 字段；遗漏即为违规，必须补齐
