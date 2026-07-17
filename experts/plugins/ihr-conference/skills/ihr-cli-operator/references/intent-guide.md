# 意图路由

当用户请求难以判断归属哪个 `ihr-cli` 域时，使用本指南。

## 快速路由

| 用户意图 | 使用域 | 说明 |
|---|---|---|
| 安装、升级、登录、API Token、状态、配置 base URL | base CLI | 读取 `cli-install-auth.md` |
| 搜索历史面谈、会议、访谈、会话记录 | `conference` | 优先使用 shortcut |
| 读取面谈/会议会话文档预览 | `conference` | 需要 conference session ID |
| 直接调用 `/gateway/...` 或已知 IHR 网关路径 | `interface` | 复用当前登录态 |
| 查询组织、部门、职位、职级、编制 | `interface` | 先从文档搜索具体接口 |
| 查询员工、花名册、合同、入转调离 | `interface` | 注意个人信息摘要化 |
| 查询考勤、排班、日报、月报、补卡、加班 | `interface` | 注意时间范围 |
| 招聘、候选人、职位、渠道 | `interface` | 注意候选人隐私 |
| 薪资、个税、预算、成本、薪资档案 | `interface` | 高敏感数据，默认只摘要 |
| 社保、福利、增减员、台账 | `interface` | 高敏感数据，默认只摘要 |
| 绩效、OKR、指标库、考核档案 | `interface` | 高敏感数据，默认只摘要 |

## 判断规则

- 用户提到“面谈”“会议记录”“历史会话”“会话文档”时，优先查 `ihr-cli conference --help`。
- 用户提供明确路径如 `/gateway/sk/check_user`，优先查 `ihr-cli interface --help`。
- 用户只描述业务对象而没有接口路径时，先用在线文档搜索业务关键词，再映射到 `interface`。
- 用户请求写入、提交、审批、删除、导入或批量修改时，先确认是否有 dry-run 或预览能力。

## 跨域场景

如果用户想“先搜面谈，再读文档”，顺序是：

```bash
ihr-cli conference +search --help
ihr-cli conference +search ...
ihr-cli conference +documents --help
ihr-cli conference +documents ...
```

如果用户想“查某个业务数据但不知道接口”，顺序是：

```bash
ihr-cli interface --help
python skills/ihr-cli-operator/scripts/extract_ihr_docs.py --search "业务关键词"
ihr-cli interface +get/+post ... -H "IHR-Request-Origin: hrclaw"
```
