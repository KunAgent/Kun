# IHR 网关接口能力

`ihr-cli interface` 用于复用当前登录态调用 IHR 网关接口。它适合查询或操作组织、员工、考勤、招聘、薪资、社保、绩效等 i人事业务数据。

## 执行前确认

```bash
ihr-cli interface --help
ihr-cli interface +get --help
ihr-cli interface +post --help
```

如果 help 中没有对应 shortcut 或参数，读取当前在线文档：

```bash
python skills/ihr-cli-operator/scripts/extract_ihr_docs.py --search "业务关键词"
```

## 当前已知模式

```bash
ihr-cli interface +get /gateway/sk/check_user -H "IHR-Request-Origin: hrclaw" --dry-run
ihr-cli interface +post /your/business/path -H "IHR-Request-Origin: hrclaw" --json '{"demo":true}' --dry-run
```

实际路径、请求方法、query、body 参数名和 dry-run 支持情况必须以当前 help 与文档为准。
真实业务接口调用不能只停留在 dry-run。读操作或经用户确认后的写操作必须用 `ihr-cli interface +get/+post` 执行，并确认返回非空业务数据后再给确定性结论。

## 接口选择

1. 用户给出明确路径时，使用该路径并核对方法。
2. 用户只给业务描述时，搜索在线文档标题和内容。
3. 找到候选接口后，先向用户说明将调用的业务对象、方法、路径和影响范围。
4. 读操作可直接执行；写操作必须先 dry-run 或确认。

## 请求头要求

所有发往 iHR360 系统的接口调用都必须带：

```bash
-H "IHR-Request-Origin: hrclaw"
```

缺少该请求头时，不要继续执行业务接口。

## 业务域索引

当前文档目录通常覆盖：

- 组织：组织架构、职位体系、职级体系、编制管理、组织设置
- 员工：花名册、合同管理、异动、入职、离职、员工报表
- 考勤：排班、出勤记录、加班、外出、补卡、出差、考勤异常、日报、月报、考勤档案
- 招聘：职位管理、AI 招聘助理、渠道管理
- 薪资：数据采集、薪资核算、成本管理、预算、薪税通、薪资档案、薪资项目、薪资报表
- 社保：福利方案、增减清单、福利台账、福利档案
- 智慧绩效：目标管理、OKR、考核管理、指标库、绩效档案、设置

目录会持续变化；不要把本索引当成完整清单。

## 输出规范

- 默认输出业务摘要、数量、关键字段和下一步建议。
- 员工、薪资、社保、绩效、合同、候选人数据默认脱敏或汇总。
- 用户明确要求完整 JSON 时，仍需避免输出 token、cookie 和登录态。
