# cwp.DescribeRaspEvents 字段说明

> RASP 应用防护事件（漏洞防御/内存马）接口。

## Status（事件状态）

| 值 | 含义 |
|----|------|
| `0` | 待处理 |
| `1` | 已防御 |
| `2` | 已处理 |

## SubType（子类型）

| 值 | 含义 |
|----|------|
| `vul_defence` | 漏洞防御 |
| `memshell_scan` | 内存马扫描 |
| `memshell_inject` | 内存马注入 |
