# README.md

## 项目背景

`tc-sec` 是 `sain-wb-plugin` 仓库中的一个 **WorkBuddy / CodeBuddy 专家插件**（"腾讯云安全产品专家"）。它是一个 agent 型专家，驱动 `tccli` 命令行操作腾讯云安全产品（CWP、WAF、CFW、TCSS、CSIP、KMS、SSM、BH、CDS），完成告警分析、风险识别、报告生成等安全运维任务。

> 仓库根 `CLAUDE.md` 定义了最高优先级的硬约束：**所有 plugin / skill 开发必须兼容 mac/linux/windows，用 Python 脚本替代 shell 脚本，且尽量只用标准库。每次改动后都要验证这一点。** 本目录下所有代码都受此约束。

验证脚本的方式是直接运行：

```bash
# 环境/产品开通自检
python3 skills/tc-sec/scripts/check_all.py

# 单独验证某个工具脚本
python3 skills/tc-sec/scripts/tccli_cli.py {product} {Action} help --detail
python3 skills/tc-sec/scripts/time_util.py range 24 h
```

## 架构

插件由 `.codebuddy-plugin/plugin.json` 声明两类组件，分别承担不同职责——理解二者的分工是上手关键：

1. **Agent**（`agents/tc-sec.md`）— 专家的系统提示词 / 人格。定义工作流程、并发执行规范、命令构造规范、数据准确性原则、抗幻觉原则。这是"行为规则"层。
2. **Skill**（`skills/tc-sec/SKILL.md`）— 可操作知识，**渐进式加载**。SKILL.md 是入口索引，按需引用 `references/` 下的模板与工作流。这是"操作手册"层。

注意目录嵌套：技能内容在 `skills/tc-sec/`（插件的 `skills/` 目录下还有一层同名 `tc-sec/` 技能目录）。`plugin.json` 用 `"skills": ["../skills/tc-sec"]` 引用它。

### 执行层：scripts/

所有实际能力都封装在 `skills/tc-sec/scripts/` 的 Python 工具里，agent/workflow 通过 `subprocess` 调用它们，而不是直接执行原生命令：

| 脚本 | 职责 | 关键约束 |
|------|------|----------|
| `base.py` | **操作系统与执行环境探测层**，统一封装平台差异（Python 解释器名、tccli 路径、真实/隔离 HOME、插件根路径、各脚本路径、日期中文格式化） | 所有 OS 相关探测收敛于此，其他脚本 `import base` 获取，不再关心 python/python3、win32/posix |
| `tccli_cli.py` | **所有 tccli 调用的唯一入口**，支持单条调用与 `batch` 子命令（单进程内并发，每子命令独立隔离 HOME）；任何模式都不 `sys.exit`，始终输出合法 JSON；内置 Action 访问控制（白/黑名单，见 `tccli_cli_config.json`） | 见下方"为什么必须走包装器" |
| `wf.py` | workflow 辅助库，封装并发执行（batch/pmap）、分页（page，统一入口自动探测顶层/--Filter 对象内分页位置）、时间参数（time*）、中间数据落盘；内部 import base，暴露 `wf.T`/`wf.PY` | workflow 脚本用 `wf.*` 替代手写 ThreadPoolExecutor/分页样板 |
| `time_util.py` | 生成所有时间参数（now/ago/range/start-of/ts 等） | 禁止用系统 `date` 或手写时间字符串 |
| `report_html.py` | HTML 报告骨架，`import report_html as H` 后用 `H.wrap(title, body)`；CSS 从 `base_style.css` 加载 | 禁止在 workflow 里重复手写 CSS |
| `base_style.css` | 报告预置样式表，由 report_html.py 加载 | 可独立维护 |
| `sc_grep.py` | 跨平台 ripgrep 统一入口，参数与 `rg` 完全一致 | rg 缺失时自动降级安装 |
| `check_tccli_installed.py` / `check_products_enabled.py` / `check_all.py` | 环境与产品开通自检，输出 JSON | — |

### 知识层：references/

SKILL.md 按场景渐进加载这三类参考：

- `references/template/` — 10 个报告模板（风险评估、告警分析、漏洞、基线合规、攻击事件、应急响应、策略审计、密钥凭据等）。
- `references/workflow/` — 8 个标准安全运维工作流（今日告警、安全周报、漏洞态势、攻击分析、资产风险、事件调查、防火墙审计、密钥检查），每个含可执行的并发脚本模板。
- `references/workflow-dev/` — `GUIDELINES.md`（AI 实时生成 workflow 脚本的硬性规范）+ `HTML_REPORT_GUIDE.md`。

### 一次典型请求的数据流

用户自然语言需求 → agent 识别是否匹配 workflow 模板 → **匹配则直接用 `wf.batch`/`wf.page` 全量采集**（模板 Action 已验证，无需 help 预检、无需小 Limit 探测）；**不匹配（自由探索）才用 `tccli_cli.py batch` 批量预检 Action help --detail**（确认多个必须批量提交列表，禁止逐条串行）→ 原始 JSON 旁路落盘到临时目录（wf 内置）→ 以 `TotalCount` 为准解析统计 → `report_html.py`（CSS 来自 `base_style.css`，wrap 默认含 header）生成带固定页脚的 HTML 报告。workflow 路径 1 次往返拿到全量数据。

> **分页位置自动处理**：`wf.page` 是统一分页入口，自动探测分页/filter 位置。部分 API（csip `DescribeRiskCenter*` 等）的 Limit/Offset 嵌在 `--Filter` 对象内，顶层 `--Limit`/`--Offset` 被 tccli 以 `Unknown options` 拒绝；`wf.page` 检测到该拒绝会**自动 fallback** 到整体 `--Filter` JSON（含 Limit/Offset/Filters）重试一次，filter 自动从 `{Key,Values}` 适配 csip 的 `{Name,Values}`。调用方一律用 `wf.page`，无需关心分页位置、无需 help 预检、不会因选错函数而事后重写脚本（与权限/未开通等真失败无歧义区分，真失败原样返回 Error）。

## 关键约定（违反会导致功能损坏或数据失真）

这些是阅读多个文件才能发现、但必须严格遵守的规则：

- **绝不直接调用原生 `tccli`** —— 一律通过 `tccli_cli.py`。即使包装器调用失败也不得回退到裸 `tccli`，应排查包装器失败原因。`configure` 子命令被显式禁止。
  - *为什么必须走包装器*：tccli 用 `RotatingFileHandler` 写 `~/.tccli/log`、并从 `~/.tccli/` 读配置，多个并发 tccli 进程共享同一 HOME 会产生日志轮转冲突和配置文件竞争。`tccli_cli.py` 为每次调用创建**独立临时 HOME** 并拷贝凭据进去，因此可以任意并发；它还会从混杂输出中抽取出干净的 JSON。`tccli_cli.py batch` 子命令在单进程内并发执行多条调用，每个子命令仍各自独立隔离 HOME。
  - *随机路径如何映射成 HOME*：靠的不是 tccli 的特殊支持，而是**操作系统环境变量机制 + `subprocess.run(env=...)` 的覆盖能力**。`base.make_isolated_home_env` 先 `os.environ.copy()`（**复制**当前进程全部环境再改一个键，而非只传 `{"HOME":tmp_home}`——后者会丢 `PATH`/`PYTHONUTF8`/凭据变量，子进程连 `tccli` 都找不到），再按平台把隔离指针写进去。`_run_one` 用 `subprocess.run([...], env=env)` 启动子进程——`env=` 告诉 OS"用我给的这份环境启动，别继承父进程的"。子进程一启动，它内部所有 `os.path.expanduser("~/.tccli")` 就解析到 `tmp_home`：因为 `expanduser("~")` 在 posix 上**优先读 `HOME` 环境变量**、Windows 上**优先读 `USERPROFILE`**，只有未设置时才回退到密码数据库。于是 tccli 去 `tmp_home/.tccli/log` 写日志、从 `tmp_home/.tccli/` 读凭据——全落在隔离目录里，tccli 对此一无所知，只是老实地读自己的主目录。环境变量天然 per-process，所以 N 个并发 worker 各自的 `env` 里 `HOME` 指向各自的 `tmp_home`，各自 spawn 的子进程 `expanduser("~")` 各得各的目录，零共享。
  - *为什么 Windows 下设 `USERPROFILE` 也生效*：tccli 是 Python 写的，路径解析统一走 `os.path.expanduser`。关键在于 `expanduser` 的跨平台语义——**posix 读 `HOME`、Windows 读 `USERPROFILE` 和 `HOMEDRIVE`+`HOMEPATH`**（CPython 在 Windows 实现里就是按这个顺序查环境变量）。`base.make_isolated_home_env` 在 Windows 分支只设 `USERPROFILE=tmp_home`，正好命中 `expanduser` 的首选源，`~` 直接展开成 `tmp_home`，与 posix 下设 `HOME` 完全等价。Windows 没有 `HOME` 这个变量是正常的（那是 posix 概念），不能在 Windows 上设 `HOME` 期望生效——`expanduser` 在 Windows 不读 `HOME`，会回退到真实用户目录导致隔离失效；同样 posix 上设 `USERPROFILE` 也没用。**所以平台分支不是冗余而是必需**：必须各设各平台 `expanduser` 真正读取的那个变量。这也回答了"为什么 `real_home()` 用 `expanduser("~")` 而非硬编码"——同一套 `expanduser` 语义在真实进程里取真实 HOME、在子进程里取隔离 HOME，自动跨平台对齐，无需 base 里写任何 if-else 路径拼接。
  - *不 exit 契约*：`tccli_cli.py` 任何模式都不 `sys.exit`，始终输出合法 JSON（成功结果或 `{"Error":{"Code","Message"}}`），调用方按 returncode 0 + JSON 解析处理。
  - *Action 访问控制*：`tccli_cli.py` 加载同目录 `tccli_cli_config.json`，对每个 Action 按 **黑名单优先 → 白名单 → 默认拒绝** 判别。`help` 始终放行。`whitelist_regex`/`blacklist_regex` 存**完整正则表达式**，原样 `re.search` 匹配（不隐式锚定、不做任何加工；要锚定开头/全匹配须自带 `^`/`$`）。白名单默认 `^Describe\w*`/`^Get\w*`/`^List\w*`/`^Search\w*` 放行只读类（`\w*` 让裸词与带后缀均放行，是完整表达式而非裸前缀片段）；`whitelist_actions` 精确清单另收 25 个不满足前缀正则但只读的 Action（Export*/LookUpEvents/RaspEventOverview/InquiryPriceDbauditInstance，来源 `local_data/X_capi_usage_analysis.csv`）。黑名单 `blacklist_regex` 硬拦写/触发/高危前缀（Create/Delete/Modify/Update/Stop/Start/Scan/Reset/Remove/Clear/Reboot/Renew/Recover/Release/Rollback/Sync/Bind/Unbind/Enable/Disable/Import/Assume/Chat），**黑名单优先于白名单**——即便误加白名单也会被拦。被拒返回 `{"Error":{"Code":"ActionDenied",...}}`。配置按 mtime 热加载，改完即时生效。
- **绝不直接读写时间** —— 所有时间参数走 `time_util.py`（workflow 脚本经 `wf.time*`），禁止在 wf/workflow 脚本里 `import datetime` / `time.strftime` / 系统 `date`。`time_util.py` 作为时间后端内部用 datetime 是允许的。
- **OS/路径探测收敛到 base.py** —— 平台差异（python/python3、win32/posix HOME、tccli 路径、插件根路径）全部由 `base.py` 探测，其他脚本 `import base` 获取。workflow 脚本通过 `import wf` 后用 `wf.T`/`wf.PY`（= `sys.executable`）构造命令，禁止硬编码 `python3`。脚本定位 scripts 目录仍需 `sys.path.insert`（workflow 脚本是临时文件，无法 `__file__` 自定位）。
- **数据准确性 > 一切** —— 统计数值必须取 API 返回的 `TotalCount`，**绝不能用 `len(当前页列表)` 当总数**（Limit 截断是最常见的数据失真源）。用 Filter 缩小范围时，报告中必须标注筛选条件。
- **抗幻觉** —— 不凭记忆编造 Action 名称或参数；调用前必须用 `{product} help` / `{product} {Action} help --detail` 确认（批量预检用 `tccli_cli.py batch`）。只能使用 help 输出中列出的参数。所有报告数值必须来自真实 API 返回。
- **AI 生成的 workflow 脚本**必须遵循 `references/workflow-dev/GUIDELINES.md`：优先用 `wf.*`（batch/pmap/page/time*/out）替代手写 `ThreadPoolExecutor`/分页/落盘样板、零注释、极短变量名（`T`/`PY`/`d`/`res`）、默认 `max_workers=5`、落盘已内置在 wf、输出合法 JSON、单代码块不超过 50 行（超出则拆多阶段）。
- **最终报告输出 HTML**，列表用 `<table>` 并标注 TotalCount，末尾必须带固定页脚声明（时间由 `time_util.py now` 动态生成）。
- **只读优先**：查询类操作直接执行；修改/删除类操作必须先向用户确认。
