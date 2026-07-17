---
name: Tencent Cloud Security CLI
description: This skill should be used when the user asks to "query security alerts", "check host vulnerabilities", "list WAF domains", "describe firewall rules", "check container security", "query KMS keys", "manage secrets", "run tccli commands for security products", or needs to interact with Tencent Cloud security products (CWP, WAF, CFW, TCSS, CSIP, KMS, SSM, BH, CDS) via tccli CLI.
version: 0.1.0
---

# 腾讯云安全 tccli 操作技能

Execute tccli commands for Tencent Cloud security products, including query construction, pagination handling, JSON output parsing, and cross-product correlation analysis.

## 真实性与抗幻觉原则（强制遵守）

- **不编造数据**：所有数值、IP、资产信息必须来自实际 API 返回，严禁凭空编造。
- **不猜测字段枚举**：Status、Level、Type 等枚举字段的值含义不得凭记忆猜测。`references/capi/{product}.{Action}.md`（命名规则：产品名小写.Action名.md，如 `cwp.DescribeMalWareList.md`）收录了各 Action 关键字段的枚举说明，解析 API 返回或构造 Filter 时优先查阅。
- **不虚构 API**：只调用确实存在的 tccli Action，不确定时先通过 `scripts/tccli_cli.py {product} {Action} help --detail` 验证（禁止裸 `tccli ... help`）。
- **如实报告**：API 调用失败或数据为空时如实告知，不得用虚构数据填充。
- **区分事实与推断**：API 返回的事实数据与分析推断必须明确区分标注。
- **承认不知道**：信息不足时直接说明，不给出无依据的回答。

## Supported Products

| Product | tccli Module | Core Capability |
|---------|-------------|-----------------|
| 主机安全 CWP | `cwp` | Vulnerability, baseline, intrusion detection |
| Web 应用防火墙 WAF | `waf` | Domain protection, attack logs, rule management |
| 云防火墙 CFW | `cfw` | Edge protection, NAT firewall, access control |
| 容器安全 TCSS | `tcss` | Container compliance, image vulnerabilities |
| 安全中心 CSIP | `csip` | Asset risk, attack topology, compliance |
| 密钥管理 KMS | `kms` | Key creation, rotation, encryption/decryption |
| 凭据管理 SSM | `ssm` | Secret storage, rotation, retrieval |
| 堡垒机 BH | `bh` | Asset management, access control, audit |
| 数据安全 CDS | `cds` | Data classification, compliance assessment |

## Workflow

1. **Environment check**: Confirm tccli is installed and configured. If unknown, execute `python3 ${CODEBUDDY_PLUGIN_ROOT}/skills/tc-sec/scripts/check_all.py` to check installation status and product enablement in one step.
2. **Requirement analysis**: Identify target product, operation type (query/modify/export), and filter conditions (time range, asset IP, risk level).
3. **Command construction**: Select the correct tccli module and Action, fill required parameters, set pagination (Limit/Offset) and output format (`--output json`). All commands must go through `scripts/tccli_cli.py`. Workflow 模板中的 Action 已验证，可直接执行无需 help 预检；模板外 Action 需 help 确认（确认多个必须用 `tccli_cli.py batch` 批量并发，禁止逐条串行）。help 也走 wrapper：`python3 scripts/tccli_cli.py {product} {Action} help --detail`，禁止裸 `tccli ... help`。
4. **Full execution**: 直接用 `wf.batch`/`wf.page` 全量采集——`wf.page` 首页即返回 TotalCount 与首页数据并自动分页补全，无需单独的小 Limit 探测阶段。仅自由探索且参数不确定时才用小 Limit 试探。
5. **Result parsing**: Extract key fields from JSON output, format as Markdown tables, annotate TotalCount and pagination status.
6. **Security recommendations**: Provide risk remediation suggestions, policy optimization directions, or alert correlation analysis based on results.
7. **直接回答用户问题**：报告产出后，必须在对话中直接回答用户的原始问题——从报告或 API 结果中提取与问题最相关的结论，用简洁自然语言回复。**不能仅说"报告已生成，请查看 HTML"**，要主动给出明确答案（如"当前有 X 个高危漏洞"）。内容优先级：用户关心的核心问题最前，补充说明在后。

## Command Construction

### 统一入口

所有 tccli 命令必须通过 `scripts/tccli_cli.py` 执行，禁止直接调用 `tccli`。该包装脚本为每次调用创建独立临时 HOME 以避免并发冲突，并禁止 `configure` 子命令：

```bash
python3 scripts/tccli_cli.py {product} {Action} ...
```

### Basic Format

```bash
python3 scripts/tccli_cli.py {product} {Action} --param1 value1 --param2 value2 --output json
```

### Pagination

```bash
python3 scripts/tccli_cli.py {product} {Action} --Limit 100 --Offset 0 --output json
python3 scripts/tccli_cli.py {product} {Action} --Limit 100 --Offset 100 --output json
```

### JSON Parameters

When parameter values are objects or arrays:

```bash
python3 scripts/tccli_cli.py {product} {Action} --Filters '[{"Key":"Status","Values":["1"]}]' --output json
```

### Common Parameter Patterns

| Scenario | Pattern | Example |
|----------|---------|---------|
| Filter | `--Filters` JSON array | `--Filters '[{"Key":"Level","Values":["1"]}]'` |
| Time range | `--StartTime` / `--EndTime` | `--StartTime "2025-01-01 00:00:00"` |
| Pagination | `--Limit` / `--Offset` | `--Limit 100 --Offset 0` |
| Sort | `--Order` / `--By` | `--Order desc --By Level` |

## 高频用法速查（直接复用，无需查其他文档）

所有 workflow 脚本统一导入段（之后即可用 `wf.*`）：
```python
import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
T=wf.T; PY=wf.PY
```

| 场景 | 用法 |
|------|------|
| 并发查询多个 API | `wf.out(wf.batch([[PY,T,product,action,...,"--output","json"],...]))` |
| 逐个详情（按域名/ID） | `wf.out(wf.pmap(fn,items))`，`fn(item)->(key,value)`，fn 内用 `wf.exec([PY,T,...])` |
| 单条查询 | `wf.exec([PY,T,product,action,...,"--output","json"])` |
| 全量分页（统一入口） | `wf.page(product,action,list_key,filters=[{"Key":"K","Values":["v"]}],extra=["--StartTime",s,"--EndTime",e])`。自动探测分页/filter 位置（顶层 vs --Filter 对象内，csip 等），filters 可选，无需选 pagef/pageo |
| 时间参数 | `wf.time("now")`/`wf.time("start-of","day")`/`wf.time_range(24,"h")`/`wf.time_date_range(7,"d")` |
| 批量预检 Action help | `subprocess.run([PY,T,"batch",json.dumps([[p,a,"help","--detail"],...])])` → `{f"{p}.{a}":help文本}` |
| 生成报告 | `import report_html as H; H.wrap(title,body,period=,sources=,unavailable=)`（默认含 header+footer） |
| 报告 body 渲染 | `H.section(title,H.table(headers,rows),H.finding_crit(...))` 等组件函数，数据驱动不手拼 HTML。**para/ul 字符串里 `<b>`/`<code>` 标签自动保留；卡片数值纯色 `("95","c-high")`，表格突出 `("36294","critical")`；wf.exec 返回 dict 勿再 json.loads** |
| 错误判断 | `"Error" in d`（失败统一返回 `{"Error":{"Code","Message"}}`） |

> workflow 模板里的 Action 已验证，直接 `wf.batch`/`wf.page` 全量采集，**无需 help 预检、无需小 Limit 探测**。仅模板外 Action 才 help 确认（多个必须用 `tccli_cli.py batch` 批量提交列表，禁止逐条串行）。

## 数据准确性原则（最高优先级）

在执行任何操作前，必须评估 Limit 和 Filter 参数对最终报告数值准确性的影响：

- **Limit 陷阱**：当用户需要统计总量、趋势分析或生成报告时，使用 Limit 截断数据会导致数值失真。例如：用户问"有多少高危漏洞"，若仅查询 Limit=100 的结果并以此作为总数报告，而实际 TotalCount=500，则报告严重失准。正确做法是以 TotalCount 为准，或完成全量分页采集。
- **Filter 陷阱**：过滤条件会缩小数据范围，如果报告中未明确标注过滤条件，读者会误以为数值代表全量。例如：用户要求"安全概览报告"，若查询时添加了 `Level=1` 的 Filter 却未在报告中说明，则读者会误以为报告覆盖了所有等级。
- **正确使用方式**：
  - Limit 和 Filter 可以正常使用，但必须确保最终呈现的数值不会因此产生误导
  - 用于探测性查询（验证参数、查看数据结构）时可自由使用 Limit
  - 用于生成报告或统计时，必须使用 TotalCount 作为总数来源，而非当前返回的记录条数
  - 使用 Filter 时，报告中必须明确标注筛选条件，使读者清楚数据范围
  - 当用户需求涉及"总计"、"全部"、"概览"等全量语义时，优先不加 Filter 或明确标注

## 沙盒环境与权限提升

你可能运行在沙盒环境中，对文件系统和命令执行有访问限制。当命令因"文件未找到"、"权限不足"或"命令不存在"而失败时：

- **不要立即更换方法或放弃**：第一次失败很可能是沙盒权限限制，而非真正的路径/命令错误。
- **等待用户批准权限提升**：用户可以在提示中批准权限，授权后重试相同命令即可成功。
- **重试策略**：同一命令因权限失败后，告知用户需要权限并等待，而非自行切换到其他方案。只有在用户明确表示无法提升权限时，才考虑替代方案。
- **典型场景**：`python3 scripts/tccli_cli.py` 首次执行被拒 → 等待用户授权 → 重试成功。

## Execution Principles

- **Read-only first**: Execute query requests directly; confirm with user before any modify/delete operations.
- **Parameter validation**: Verify required parameters are complete before execution. Use `python3 scripts/tccli_cli.py {product} {Action} help --detail` when uncertain (禁止裸 `tccli ... help`，help 也必须走 wrapper).
- **Error handling**: On API errors, check SecretId/SecretKey configuration, parameter format, and permissions.
- **Large result sets**: When TotalCount is large, prompt user whether to collect all data or add filters to narrow scope.
- **Sensitive information**: Display IPs, key IDs fully (needed for security operations), but remind user about information protection.
- **Cross-product correlation**: When security events span multiple products, proactively suggest correlated queries for complete context.

## Output Standards

- **最终报告以 HTML 格式呈现**，使用结构化 HTML 标签（`<table>`、`<h2>`、`<ul>` 等）组织内容，便于在浏览器中查看和分享。
- 列表数据使用 `<table>` 展示，标注 TotalCount 和当前展示范围。
- 关键安全字段（风险等级、告警状态、影响范围）使用颜色或加粗高亮标注。
- For modify operations, show before/after state comparison.
- Extract error Code and Message, provide troubleshooting suggestions.
- Default to showing Top 50 for results exceeding 50 records, with total count noted.
- **报告页脚（固定）**：无论 HTML 还是 Markdown 格式，报告末尾必须包含以下两行固定文案（时间通过 `time_util.py now` 动态生成）：
  ```
  本报告由腾讯云安全专家自动生成 · 数据来源：腾讯云安全产品 API 实时查询
  报告生成时间：{生成时间} CST · 未经人工审核，处置前请结合业务实际情况确认
  ```

## API Reference Discovery

When uncertain about an API's parameters or behavior, use help commands. **help 与正式调用一样必须走 `scripts/tccli_cli.py`，严禁裸 `tccli ... help`**（裸调会绕过并发隔离的临时 HOME，且 `--help` 在多数产品上不是合法 help 语法，会报未知参数）。统一用位置参数式 `help --detail`（与批量预检 `tccli_cli.py batch` 的写法一致），不要用 `--help`：

```bash
python3 scripts/tccli_cli.py {product} help
python3 scripts/tccli_cli.py {product} {Action} help --detail
```

确认多个 Action 必须用 `tccli_cli.py batch` 批量并发（见高频用法速查表），禁止逐条串行 help。

## Additional Resources

### Report Templates

报告模板位于 `references/template/` 子目录，支持渐进式加载（通过 frontmatter 头部判断适用场景后再加载完整内容）。

| 模板 | 文件 | 适用场景 |
|------|------|----------|
| 风险评估报告 | `references/template/risk_report.md` | 安全风险汇总、资产风险盘点、合规风险评估 |
| 告警分析报告 | `references/template/alert_analysis.md` | 告警汇总、告警趋势分析、告警处置跟踪 |
| 资产盘点报告 | `references/template/asset_inventory.md` | 资产清单、暴露面分析、防护覆盖评估 |
| 漏洞扫描报告 | `references/template/vulnerability_report.md` | 主机/容器/Web 漏洞扫描结果汇总 |
| 基线合规报告 | `references/template/baseline_compliance.md` | 安全基线检查、等保合规、CIS 基准 |
| 攻击事件分析 | `references/template/attack_analysis.md` | WAF 攻击日志、入侵溯源、攻击态势 |
| 安全巡检报告 | `references/template/security_inspection.md` | 日常巡检、安全周报/月报 |
| 事件响应报告 | `references/template/incident_response.md` | 应急响应、事件调查、事后复盘 |
| 策略配置审计 | `references/template/policy_audit.md` | 防火墙规则审计、WAF 策略审计 |
| 密钥凭据审计 | `references/template/secret_key_audit.md` | KMS 密钥审计、SSM 凭据安全检查 |

**使用方式**：根据用户需求选择对应模板，加载后按实际数据填充占位符。模板结构可灵活调整——根据数据实际情况增删章节，但保持报告整体结构一致性。

### Workflow References

工作流参考位于 `references/workflow/<name>/` 子目录，每个子目录包含：

- `README.md` — 工作流的 triggers / 涉及产品 / 候选 Action / 数据完整性说明（人类可读，agent 用于理解上下文）。
- `run.py` — **直达 HTML 报告脚本**，已内置批量采集 + 风险聚合 + HTML 渲染，**无需 Action help 预检、无需手写工作流脚本**。

| 工作流 | 子目录 | 触发场景 | 涉及产品 |
|--------|--------|----------|----------|
| 今日告警报告 | `references/workflow/daily_alert_report/` | 今日告警、新增告警、告警日报 | CWP, WAF, CFW, TCSS |
| 安全周报巡检 | `references/workflow/weekly_security_inspection/` | 安全周报、一周安全、安全巡检 | All |
| 漏洞态势分析 | `references/workflow/vulnerability_status/` | 漏洞情况、漏洞报告、漏洞统计 | CWP, TCSS |
| 攻击事件分析 | `references/workflow/attack_analysis/` | 攻击分析、被攻击了、攻击态势 | WAF, CFW, CWP |
| 资产风险概览 | `references/workflow/asset_risk_overview/` | 资产风险、风险概览、安全态势 | CSIP, CWP |
| 安全事件调查 | `references/workflow/incident_investigation/` | 事件调查、入侵分析、应急响应 | CWP, WAF, CFW, BH |
| 防火墙策略审计 | `references/workflow/firewall_policy_review/` | 策略审计、规则检查、防火墙审计 | CFW, WAF |
| 密钥凭据检查 | `references/workflow/secret_key_health_check/` | 密钥检查、凭据审计、KMS 检查 | KMS, SSM |

**直达调用方式（首选，命中 trigger 时 1 步出报告）**：

```bash
# 输出到 stdout（适合管道或重定向）
python3 ${CODEBUDDY_PLUGIN_ROOT}/skills/tc-sec/references/workflow/<name>/run.py > /tmp/report.html

# 写入指定目录（自动命名为 <name>.html）
python3 ${CODEBUDDY_PLUGIN_ROOT}/skills/tc-sec/references/workflow/<name>/run.py /tmp/reports
```

**统一参数协议（8 个 run.py 共享，由 `scripts/wf_run.py` 实现）**：

```bash
python3 .../<name>/run.py [out_dir] \
    [--out-dir DIR]                                          # 等价于位置参数
    [--include CWP,WAF | --exclude CFW]                      # 产品裁剪，互斥
    [--hours N | --days N]                                   # 时间窗（仅相关工作流生效）
    [--top N]                                                # Top 表 N 值（攻击源 IP / 漏洞 / 高危规则 等）
    [--severity-min critical|high|medium|low|info]           # 等级阈值（含等级字段的工作流）
    [--limit N]                                              # 单次 wf.batch 的 Limit（默认 100）
    [--detail-max N]                                         # 二阶段抽样上限（仅 secret_key/firewall）
    [--target-ip IP] [--target-uuid UUID] [--target-quuid QUUID]   # 仅 incident_investigation
```

参数优先级：CLI flag > ENV > 默认值。等价 ENV：`TC_SEC_INCLUDE` / `TC_SEC_EXCLUDE` / `TC_SEC_HOURS` / `TC_SEC_DAYS` / `TC_SEC_TOP` / `TC_SEC_SEVERITY_MIN` / `TC_SEC_LIMIT` / `TC_SEC_DETAIL_MAX` / `TC_SEC_TARGET_IP` / `TC_SEC_TARGET_UUID` / `TC_SEC_TARGET_QUUID`。

未指定 `--include` / `--exclude` 时，默认产品集 = 该工作流 README frontmatter 的 `products:` 字段。

**设计边界（重要，避免滥用参数）**：

`run.py` 只暴露**值类参数**（数量、阈值、时间窗、产品集），不暴露任何会改变 API 字段名 / Filter 键 / 时间字段的参数。每个 API 的 Filter 字段名（Name / Key / FilterField）、时间字段（FromTime / StartTime）、list_key（Data / List / SecurityDynamics 等）都在 run.py 里按真实签名固化，不接受参数化覆盖——否则极易出现"参数名看起来合理但 API 实际不接受"的静默失败。

正确的"两段式"用法：

1. **脚本阶段（机械可控的灵活）**：用 `--include / --exclude / --hours / --days / --top / --severity-min / --limit` 控制数据范围，把已知字段、已知聚合维度的报告生成出来。
2. **agent 阶段（语义层的灵活）**：HTML 生成后，**当用户有具体问题时（如"有多少高危漏洞"、"本周有没有攻击"），必须用 Read 读取 HTML 再用 Edit 在 body 最前插入一段直答摘要（1～3 句话，直接给出结论数字/判断），确保打开 HTML 第一眼看到答案**。此外当你有额外的业务侧解读、跨产品观察、风险建议需要补充时，同样用 Read + Edit 直接编辑——调整措辞、追加交叉对比、剔除无关章节。**与用户问题完全无关的章节可以直接从 HTML 中移除**（如用户只问漏洞，告警/策略章节可删）。无任何额外内容时不必强行编辑。编辑时遵循**内容优先级原则：用户关心的核心问题放最前，补充说明、拓展背景、额外信息依次置后**，确保读者第一眼看到最相关的结论。这部分应由 agent 直接在 HTML 上编辑，**而不是**反过来要求脚本支持更多花式参数。

**与 check_products_enabled 联动（推荐）**：先探测哪些产品开通，再用 `--include` 把 `run.py` 的查询范围缩到开通的产品上，避免无意义的 Error 块：

```bash
python3 ${CODEBUDDY_PLUGIN_ROOT}/skills/tc-sec/scripts/check_products_enabled.py all   # 列出已开通产品
python3 .../workflow/daily_alert_report/run.py --include CWP,TCSS /tmp/reports         # 只查这两个
```

**示例**：

```bash
# 只查 CWP+TCSS、聚焦严重/高危、Top 报表 5 条
python3 .../daily_alert_report/run.py --include CWP,TCSS --severity-min high --top 5 /tmp/reports

# 攻击分析窗口缩到过去 6 小时、Top 表展示 20 条
python3 .../attack_analysis/run.py --hours 6 --top 20 /tmp/reports

# 周报覆盖过去 14 天，单页 200 条
python3 .../weekly_security_inspection/run.py --days 14 --limit 200 /tmp/reports

# 入侵调查指定 IP、抽样上限 30 条
python3 .../incident_investigation/run.py --target-ip 1.2.3.4 --detail-max 30 /tmp/reports
```

`run.py` 已内置：批量调用已验证 Action（无需 help 预检、无需小 Limit 探测）、按 TotalCount 自动分页（用 `wf.page`）、未启用 / 调用失败的产品自动标注到 `H.wrap(unavailable=...)`、严重风险聚合 / Top IP 提取 / 风险评分等业务洞察、`report_html` 统一渲染 HTML（含报头 / 页脚 / 数据来源 / 时间周期）。

`--exclude` 把所有产品都排除时，输出仍是合法 HTML，但 body 是一条提示 note，便于上游识别"参数过滤后无可查询产品"。

**何时不走 run.py**：用户的需求与 trigger 偏离较大、或要求自定义维度 / 时间窗 / 过滤条件超出脚本预设范围时，可参考子目录下的 `README.md` 候选 Action 列表，按 `references/workflow-dev/GUIDELINES.md` 临时编排 \`wf.batch\`/\`wf.page\` 脚本。

### Workflow 脚本编写规范

生成 workflow 执行脚本时，必须遵循 `references/workflow-dev/GUIDELINES.md` 中的编写规范，核心要求：

- 必填参数检查：调用前确认参数就绪
- 确认 Action 存在：禁止凭记忆编造
- 优先用 wf：并发执行用 `wf.batch`/`wf.pmap`，分页用 `wf.page`（统一入口，自动探测分页/filter 位置），时间用 `wf.time*`，禁止手写 `def run`/`ThreadPoolExecutor`/分页样板
- 命令数组用 `wf.PY`（= `sys.executable`，跨平台）和 `wf.T` 构造，禁止硬编码 `python3`；OS/路径差异由 `base.py` 统一处理
- 极短变量命名：`T`, `d`, `res` 等
- 零注释：脚本中禁止任何注释
- 错误处理兜底：wf.exec/batch 已内置 try/except
- 数值统计准确性：统计数值以 `TotalCount` 为准，禁止用 `len(list)` 作为总数
- 并发控制：默认 max_workers=5
- 输出合法 JSON：`wf.out(res)`
- 中间数据落盘：已内置在 wf.exec/batch，原始 API 返回在 `json.loads` 前旁路写入系统临时目录 `{tempdir}/tc-sec_workflow/{product}_{action}_{timestamp}.json`，解析失败时可从文件恢复，无需重新请求

详见：[`references/workflow-dev/GUIDELINES.md`](references/workflow-dev/GUIDELINES.md)

### HTML 报告生成

生成最终报告时，必须使用 `scripts/report_html.py` 提供的预置 CSS 和 HTML 骨架，禁止在 workflow 脚本中重复生成样式代码。通过 `import report_html as H` 后调用 `H.wrap(title, body, period=, sources=, unavailable=)` 即可输出完整 HTML 文档（默认自动含报告头部 header + 固定页脚声明）。

详见：[`references/workflow-dev/HTML_REPORT_GUIDE.md`](references/workflow-dev/HTML_REPORT_GUIDE.md)

### Scripts

- **`scripts/sc_grep.py`** - ripgrep (rg) 跨平台统一入口，用法与 `rg` 完全一致
- **`scripts/time_util.py`** - 时间计算工具，所有时间参数必须通过此脚本生成，禁止使用系统 `date` 命令
- **`scripts/tccli_cli.py`** - tccli 统一入口包装，为每次调用创建独立临时 HOME 以避免并发冲突，禁止 configure 子命令，所有 tccli 调用必须通过此脚本
- **`scripts/base.py`** - 操作系统与执行环境探测层，统一封装平台差异（Python 解释器名、tccli 路径、真实/隔离 HOME、插件根路径、各脚本路径），其他脚本通过 `import base` 获取，不再关心 python/python3、win32/posix 等
- **`scripts/wf.py`** - workflow 辅助库，封装并发执行（batch/pmap）、分页（page，自动探测顶层/--Filter 对象内分页位置）、时间参数（time*）、中间数据落盘，workflow 脚本通过 `import wf` 调用以减少生成字符数；内部 import base，暴露 `wf.T`/`wf.PY` 供脚本构造命令
- **`scripts/check_tccli_installed.py`** - 检查 tccli 安装状态和认证配置，返回 JSON 结果（status: ok/not_installed/no_credentials）
- **`scripts/check_products_enabled.py`** - 检查腾讯云安全产品开通状态，支持单产品或 `all` 全量检测
- **`scripts/check_all.py`** - 一次性检查 tccli 安装与所有产品开通状态，返回 JSON；环境自检入口
- **`scripts/wf_run.py`** - 8 个 `run.py` 共享的统一参数解析库，实现 `--include/--exclude/--hours/--days/--top/--severity-min/--limit/--detail-max/--target-*` 等参数协议
- **`scripts/tccli_auth_login.py`** - OAuth 登录入口，调用原生 `tccli auth login` 前台交互，登录后自检并输出 JSON（status: ok/failed/unknown/not_installed）
- **`scripts/tccli_aksk_configure.py`** - AKSK 本地配置页面，仅用标准库启动一次性 loopback Web 服务让用户在浏览器填写 SecretId/SecretKey/Region，密钥不经命令行/对话传输
- **`scripts/report_html.py`** - HTML 报告模板，提供预置 CSS 和 HTML 骨架（head/foot/wrap），workflow 脚本通过 import 调用生成完整报告
- **`scripts/base_style.css`** - 报告预置样式表，由 report_html.py 加载，可独立维护

## 时间计算规范

所有 tccli 命令中涉及的时间参数（StartTime、EndTime 等），必须通过 `scripts/time_util.py` 生成，禁止使用系统 `date` 工具或手动拼写时间字符串。

### 用法速查

```bash
# 当前时间
python3 scripts/time_util.py now
# 输出: 2026-06-16 10:30:00

# 今天日期
python3 scripts/time_util.py today
# 输出: 2026-06-16

# N 单位之前 (单位: m=分钟, h=小时, d=天, w=周)
python3 scripts/time_util.py ago 7 d
# 输出: 2026-06-09 10:30:00

# N 单位之后
python3 scripts/time_util.py offset 2 h
# 输出: 2026-06-16 12:30:00

# 时间范围 (过去N单位到现在, 输出两行: 起始时间 + 结束时间)
python3 scripts/time_util.py range 24 h
# 输出:
# 2026-06-15 10:30:00
# 2026-06-16 10:30:00

# 日期范围 (纯日期格式, 适用于TCSS/CWP等需要date类型参数的API)
python3 scripts/time_util.py date-range 7 d
# 输出:
# 2026-06-09
# 2026-06-16

# 周期起始时间 (day/week/month)
python3 scripts/time_util.py start-of month
# 输出: 2026-06-01 00:00:00

# Unix 时间戳 → 可读格式
python3 scripts/time_util.py fmt 1718500200
# 输出: 2024-06-16 10:30:00

# 可读格式 → Unix 时间戳
python3 scripts/time_util.py ts "2026-06-16 10:30:00"
# 输出: 1781842200

# 当前时间的 Unix 时间戳
python3 scripts/time_util.py ts
```

### 与 tccli 配合示例

```bash
# 查询过去 7 天的告警
START=$(python3 scripts/time_util.py ago 7 d)
END=$(python3 scripts/time_util.py now)
python3 scripts/tccli_cli.py cwp DescribeAlarmIncident --StartTime "$START" --EndTime "$END" --output json

# 查询本月的攻击日志
START=$(python3 scripts/time_util.py start-of month)
END=$(python3 scripts/time_util.py now)
python3 scripts/tccli_cli.py waf DescribeAttackLogs --StartTime "$START" --EndTime "$END" --output json
```
