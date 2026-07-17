# Four-Level Billing Items

四层查询只在用户明确要求四层计费项、四层编码、`ProductCode`、`SubProductCode`、`ValueItemCode`、`ValueSubItemCode` 时触发。不要用模型记忆、命名规律或历史经验补四层。

优先在报价命令后追加 `--with-four-level`，使用报价响应直返的四层信息：

```text
tcloud-price quote --site <cn|intl> --product <code> ... --with-four-level
```

详细教程以内置命令文档为准：

```text
tcloud-price four-level help
```

如需判断哪些产品需要 CLS fallback 补查，可查看：

```text
tcloud-price four-level products --site cn
```

`four-level products` 只列需要 CLS fallback 的产品，不是四层能力覆盖清单。许多产品可从报价响应直接返回四层信息；如果需要手工补查，再按 `four-level help` 的教程把报价总价换算为分传给 `four-level query`。

查不到四层时，说明无法确认并停止补查；不得推断编码。
