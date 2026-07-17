# 从已有报价单复制产品到新报价单

将一张或多张源报价单中的产品行精确复制到目标报价单。

---

## 核心概念

**报价行的唯一标识是 `spuId_payMode`**（如 `14582_postpay`、`14582_prepay`）。同一个 SPU ID 在不同付费模式下是不同的报价行。所有对比、统计、删除操作必须以完整节点ID为最小粒度。

---

## 操作流程

### Step 1：提取源报价单节点ID

对每张源报价单执行：

```bash
cpq row list --cpqcode {source_cpqcode} --fields "id"
```

提取所有节点ID（格式 `{spuId}_{payMode}`），多张源报价单的结果合并去重，得到**源节点ID集合**。

### Step 2：创建目标报价单

```bash
cpq create {project_code}
```

### Step 3：批量添加产品

直接用源节点ID（`spuId_payMode` 格式）作为 `--spu-ids` 的输入，精确添加对应售卖模式的产品行，分批执行（每批 ≤ 100 个）：

```bash
cpq row add --cpqcode {target_cpqcode} --spu-ids "14582_postpay,14582_prepay,14584_postpay,..."
```

> 传入 `spuId_payMode` 格式可精确指定售卖模式，不会自动展开其他付费变体。

添加后检查结果，记录未能添加的条目。常见失败原因：

- 产品已下架（可售卖状态为"停止全面支持"）
- SPU ID 对应的不是公有云四层产品（如 TCE 专有云产品）

### Step 4：保存

```bash
cpq save --cpqcode {target_cpqcode}
```

### Step 5：验证

清除本地缓存后重新拉取，确认最终行数与源一致：

```bash
rm -r ~/.huijin/cache/{target_cpqcode}
cpq row list --cpqcode {target_cpqcode} --fields "id"
```

验证公式：`目标行数 = 源节点ID集合数量 - 未能添加数量`

---

## 约束

1. **必须用完整节点ID添加**：直接传 `spuId_payMode` 给 `--spu-ids`，确保精确复制源报价单的售卖模式组合
2. **未能添加的行必须报告**：不得静默跳过，需列出产品名称和原因
3. **save 后必须验证**：`save` 提示"成功"不等于服务端持久化成功，必须清缓存后重新 `row list` 确认
