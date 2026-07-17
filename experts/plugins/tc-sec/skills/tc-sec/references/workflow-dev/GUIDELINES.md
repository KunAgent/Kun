# Workflow 脚本编写规范

Workflow 脚本由 AI 实时生成并执行，必须遵循以下原则确保代码简短、可靠、可运行。

## 核心原则

- **极简**：代码越短越好，减少生成 token 和出错概率
- **优先用 wf**：并发执行、分页、时间参数、落盘等样板一律用 `scripts/wf.py` 封装（见第 16 节），禁止手写 `def run` / `ThreadPoolExecutor` / 分页样板
- **可运行**：生成即可执行，不依赖额外安装或配置
- **防御性**：假设任何外部调用都可能失败，必须兜底（wf 已内置）
- **无注释**：代码自解释，不写任何注释

## 1. 必填参数检查

每个 Action 调用前必须确认必填参数已就绪。缺少必填参数会导致 API 报错浪费一次调用。

（以下片段假定已执行导入段：`T=wf.T; PY=wf.PY`，见第 11 节骨架）

```python
# 错误：直接调用，缺少必填参数
cmds=[[PY,T,"kms","DescribeKey","--output","json"]]

# 正确：确保 KeyId 已获取
if not key_ids:
    wf.out({"Error":{"Code":"NoKeyIds","Message":"no key_ids from phase1"}})
else:
    cmds=[[PY,T,"kms","DescribeKey","--KeyId",k,"--output","json"] for k in key_ids]
```

对于不确定参数是否必填的 Action，先用 `--help` 确认（help 输出非 JSON，`wf.exec` 会返回 `{"Error":{"Code":"ParseFailed",...}}`，从 `Message` 读 help 文本）。批量预检多个 Action 用 `tccli_cli.py batch` 一次性并发（见 agent 预检示例）：

```python
wf.exec([PY,T,product,action,"--help"])
```

## 2. 确认 Action 存在

禁止凭记忆编造 Action 名称。不确定时先验证：

```python
d=wf.exec([PY,T,product,"help"])
# 从 d["Error"]["Message"] 或 d 中确认 Action 存在后再调用
```

生成脚本时优先使用已在 workflow 参考文件中出现过的 Action，这些已经过验证。

## 3. 变量命名

使用极短变量名，减少生成 token：

| 用途 | 命名 | 示例 |
|------|------|------|
| tccli_cli.py 路径 | `T` | `T=wf.T` |
| 命令列表 | `cmds` | `cmds=[...]` |
| 解析后数据 | `d` | `d=wf.exec(...)` |
| 结果字典 | `res` | `res=wf.batch(cmds)` |
| 时间值 | `start`,`end`,`td` | `start,end=wf.time_range(24,"h")` |
| 自定义 map 回调 | `f`,`check` | `def f(k): return k,wf.exec(...)` |

## 4. 不写注释

脚本中禁止任何形式的注释。原因：

- workflow 脚本是一次性执行的，无需维护
- 注释增加生成 token，降低效率
- 变量命名和代码结构已足够表达意图

```python
# 错误：写注释
# 获取今日起始时间
start=wf.time("start-of","day")

# 正确：零注释
start=wf.time("start-of","day")
```

## 5. 错误处理兜底

错误处理（subprocess 检查 + `json.loads` try/except + 落盘兜底）已封装在 `wf.exec` / `wf.batch` 内部，调用方无需手写 `run` 函数。多阶段脚本中，后续阶段必须检查前置阶段的数据是否有效：

```python
keys=res.get("kms.ListKeys",{}).get("Keys",[])
if not keys:
    wf.out({"Error":{"Code":"NoKeys","Message":"no keys found","raw":res.get("kms.ListKeys")}})
else:
    pass  # 继续处理
```

## 6. 并发控制

并发执行已封装在 `wf.batch` / `wf.pmap` / `wf.page` 中，默认 `max_workers=5`：

```python
res=wf.batch(cmds)                       # 标准并发，key=f"{product}.{action}"
details=wf.pmap(check_key,key_ids)       # 自定义 map 并发，fn(item)->(key,value)
```

并发档位：

- 默认 `max_workers=5`，避免触发 API 限频
- 批量操作（如逐个查询详情）不超过 `max_workers=5`
- 独立 API 调用（如不同产品的概览查询）可显式 `wf.batch(cmds,workers=len(cmds))`

## 7. 输出格式

脚本最终输出必须是合法 JSON，便于后续解析：

```python
wf.out(res)
```

- 使用 `ensure_ascii=False` 保留中文（wf.out 已内置）
- 使用 `indent=2` 便于阅读
- 错误信息也必须是 JSON 格式

## 8. 路径构造

脚本导入 `wf` 后直接用 `wf.T` 构造命令，无需手写路径回退链（wf 内部已解析）：

```python
import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
T=wf.T
```

`sys.path.insert` 这一行是导入本地模块（wf / report_html）所必需的，所有脚本共用；之后的命令构造用 `wf.T`，禁止硬编码路径。

## 9. 分页处理

分页采集统一用 `wf.page`，自动按 `TotalCount` 分页并发补采并合并列表，返回的 dict 保留 `TotalCount`。**分页参数位置（顶层 vs 嵌在 --Filter 对象内）和 filter 位置由 wf.page 自动探测，调用方无需选函数、无需 help 预检**：

```python
# 无 filter
res["cwp.DescribeVulList"]=wf.page("cwp","DescribeVulList","VulInfoList")

# 带 extra 参数（时间范围等）
start,end=wf.time_range(7,"d")
res["waf.DescribeAttackLogs"]=wf.page("waf","DescribeAttackLogs","Logs",extra=["--StartTime",start,"--EndTime",end])

# 带 filter（filters 为 Python list，元素 {"Key"/"Name":..., "Values":[...]} 两种键名都接受）
res["cwp.DescribeVulList"]=wf.page("cwp","DescribeVulList","VulInfoList",filters=[{"Key":"VulLevel","Values":["1"]}])

# csip 风险列表（Limit/Offset 嵌在 --Filter 对象内，wf.page 自动 fallback，无需特殊处理）
res["csip.DescribeRiskCenterAssetViewVULRiskList"]=wf.page("csip","DescribeRiskCenterAssetViewVULRiskList","Data")

# csip 带 filter（Key/Name 都行，wf.page 自动适配为 csip 的 Name/Values 塞进 --Filter JSON）
res["csip.DescribeRiskCenterAssetViewVULRiskList"]=wf.page("csip","DescribeRiskCenterAssetViewVULRiskList","Data",filters=[{"Key":"Level","Values":["extreme"]}])
```

`wf.page` 首页读 `TotalCount`，若已采量 < TotalCount 则并发拉取剩余页并 `extend` 合并到 `list_key`，统计数值仍以返回 dict 的 `TotalCount` 为准。

### wf.page 自动探测机制（无需调用方关心）

`wf.page(product, action, list_key, filters=None, limit=100, workers=5, extra=None)` 内部按序尝试，失败自动 fallback，对调用方透明：

1. **顶层分页**（cwp/waf/cfw 等主流 API）：`--Limit`/`--Offset` + 顶层 `--Filters`（若传 filters）。
2. 若顶层分页被 tccli 以 `Unknown options: --Limit/--Offset`（及 `--Filters`）拒绝（Limit/Offset 嵌在 `--Filter` 对象内，如 csip `DescribeRiskCenter*`），**自动 fallback 到对象内分页**：用整体 `--Filter` JSON 一次性传 `Limit`/`Offset`/`Filters`，filter 自动从 `{Key,Values}` 适配为 csip 的 `{Name,Values}`。
3. 真失败（权限/未开通/网络，Message 不含 `Unknown options`）**不触发 fallback**，原样返回 Error，与"分页位置错"无歧义区分。

> **关键**：不再有 `pagef`/`pageo`，也不需要 help 预检 `--Filter` 结构来选函数。任何 Action 直接 `wf.page` 即可，分页/filter 位置错会自动重试，**不会因选错函数而事后重写脚本**。fallback 仅多一次首页往返（只对 csip 这类 API 触发），可忽略。

> **csip filter 适配**：csip 的过滤条件在 `--Filter` 对象内的 `Filters` 数组，字段是 `Name`/`Values`（非顶层 `--Filters` 的 `Key`/`Values`）。`wf.page` fallback 时自动转换，调用方传 `Key` 或 `Name` 都行。实测整体 `--Filter` JSON 传法最可靠（点号路径 `--Filter.Filters '[...]'` 对嵌套数组常返回空，已弃用）。

> **extra 的两种模式**：`extra` 附加的参数在顶层分页和对象内分页两种模式下都会拼到命令行。若某参数也嵌在 `--Filter` 内（如 csip 的时间），需自行确认；一般 extra 用于顶层参数（`--StartTime`/`--EndTime` 等）。

## 10. 数值统计准确性（最高优先级）

Limit 截断是 workflow 脚本中最常见的数据失真来源。统计数值必须以 API 返回的 `TotalCount` 字段为准，绝不能以当前页返回的记录条数作为总数。

### 典型错误

```python
d=wf.exec([PY,T,"cwp","DescribeVulList","--Limit","10","--output","json"])
# 错误：用返回列表长度作为总数
total=len(d.get("VulInfoList",[]))  # 得到 10，实际可能有 500 条
```

### 正确做法

```python
d=wf.exec([PY,T,"cwp","DescribeVulList","--Limit","10","--output","json"])
# 正确：以 TotalCount 为准
total=d.get("TotalCount",0)  # 得到 500
```

### 统计场景规则

| 场景 | 数值来源 | 说明 |
|------|----------|------|
| 报告中的"总计 X 条" | `TotalCount` 字段 | 禁止用 `len(list)` |
| 分级统计（高/中/低） | 分别带 Filter 查询各级别的 `TotalCount` | 或使用专用统计 API |
| 趋势/环比 | 各时间段分别查询 `TotalCount` | 禁止从单次截断结果推算 |
| 详情展示 | 当前页 `len(list)` | 仅用于展示条目，非统计 |

### 防御性输出

`wf.batch`/`wf.exec` 返回的 data 本身即包含 API 原始的 `TotalCount`，报告中直接取 `res["cwp.DescribeVulList"]["TotalCount"]` 即可。当实际采集量（`len(list_key)`）小于 `TotalCount` 时，报告中必须标注"仅展示前 N 条，共 TotalCount 条"，或用 `wf.page` 触发分页采集补全数据。

`wf.page` 单 Action 采集总量上限 `MAX_TOTAL=10000`，超量时自动截断到 10000 并在返回 dict 加 `_Capped=True`、`_CappedAt=10000`。报告中检测到 `_Capped` 时必须标注"数据量过大，仅采集前 10000 条，共 TotalCount 条"，统计仍以 `TotalCount` 为准。

`wf.exec` 内置 `_extract_json` 容错提取（处理 tccli 偶发混杂输出），解析失败返回 `{"Error":{"Code":"ParseFailed",...},"dump":<落盘路径>}`，可读 dump 文件排查。

### Filter 对统计的影响

使用 Filter 缩小范围时，报告中必须明确标注筛选条件，否则读者会误以为数值代表全量：

```python
# 查询高危漏洞数量（用 wf.exec 直接传 Filters JSON 字符串）
d=wf.exec([PY,T,"cwp","DescribeVulList","--Filters",'[{"Key":"VulLevel","Values":["1"]}]',"--Limit","1","--output","json"])
high_count=d.get("TotalCount",0)  # 这是"高危"的总数，不是全部漏洞总数
```

报告中应写"高危漏洞 X 条"而非"漏洞 X 条"。

### 探测性查询 vs 统计性查询

> 这是 Limit 的使用技巧说明，**不是强制流程阶段**。workflow 路径直接用 `wf.page`/`wf.batch` 全量采集，无需单独的"小 Limit 探测"步骤——`wf.page` 首页即返回 TotalCount 与首页数据并自动分页补全。

- **探测性查询**（验证参数、查看结构）：可用小 Limit（如 10），不用于统计。仅自由探索且参数不确定时使用。
- **统计性查询**（生成报告数值）：必须读取 `TotalCount`，Limit 仅控制详情展示量

```python
# 探测：验证 Action 可用，查看返回结构
d=wf.exec([PY,T,"cwp","DescribeVulList","--Limit","1","--output","json"])

# 统计：获取真实总数
real_total=d.get("TotalCount",0)  # 这才是报告中应使用的数值
```

## 11. 标准脚本骨架

所有 workflow 脚本应遵循此结构（用 wf 封装，~13 行）：

```python
import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
T=wf.T; PY=wf.PY

cmds=[
    [PY,T,"product","Action","--output","json"],
]

wf.out(wf.batch(cmds))
```

> `sys.path.insert` 这行用于让 `import wf` 找到 scripts 目录（workflow 脚本是临时生成文件，无法用 `__file__` 自定位），所有脚本共用。脚本内部用 `wf.PY`（= `sys.executable`）构造命令数组，跨平台兼容 python/python3；路径解析、OS 差异由 `base.py`（wf 内部 import）统一处理，脚本无需关心。

## 11.1 脚本执行方式（长脚本必须写文件再执行）

**长脚本（workflow 执行脚本、多阶段脚本、报告生成脚本）必须先写成 `.py` 文件再执行，禁止用 `python3 -c "..."` 一行塞**。原因：写文件后出错可 `edit` 修改重跑，不必整段重新生成；`python3 -c` 一旦出错只能重生成，浪费往返。

执行流程：
1. 用 Write 工具把脚本写到临时目录，文件名带时间戳避免冲突：`{tempdir}/tc-sec_workflow/run_{ts}.py`（`ts` 可用 `wf._TS`）
2. 执行：`python3 {脚本路径}`（或 `wf.PY {脚本路径}`）
3. 若报错：`edit` 修改该文件后重跑，不要重新生成整段脚本

```python
# 脚本写入路径示例（脚本内部不需关心，由 Write 工具写入）
import wf
path=os.path.join(wf._TMP,f"run_{wf._TS}.py")
# Write 工具把脚本内容写入 path，然后执行 python3 path
```

单条短命令（如单个 help 查询、单次 tccli 调用）可直接执行，不必写文件。

## 12. 多阶段脚本

当后续阶段依赖前置阶段结果时，用 `wf.pmap` 并发处理动态列表（`fn(item)->(key,value)`），无需重复路径/线程池样板：

```python
ids=[item["KeyId"] for item in res.get("kms.ListKeys",{}).get("Keys",[])]
if not ids:
    wf.out({"Error":{"Code":"EmptyKeyList","Message":"empty key list"}})
else:
    def check(kid):
        return kid,wf.exec([PY,T,"kms","DescribeKey","--KeyId",kid,"--output","json"])
    wf.out(wf.pmap(check,ids))
```

## 13. 时间参数

所有时间通过 `wf.time*` 系列生成（内部经 `time_util.py`），禁止硬编码或使用系统 `date`：

```python
start=wf.time("start-of","day")
end=wf.time("now")
today=wf.time("today")
start,end=wf.time_range(24,"h")          # 过去24小时到现在，返回 (start,end)
start_d,end_d=wf.time_date_range(7,"d")  # 纯日期范围，返回 (start_date,end_date)
```

## 14. 重复 Action Key 处理

同一产品的同一 Action 可能被调用多次（如不同参数），`wf.batch` 已自动处理 key 冲突（重复 key 追加 `_dup` 后缀）。若需在 key 中包含区分参数，改用 `wf.pmap` 自定义 key：

```python
def run(c):
    label="_".join(c[2:5])
    return label,wf.exec(c)
wf.out(wf.pmap(run,cmds))
```

## 15. 中间数据落盘

中间数据落盘已内置在 `wf.exec` / `wf.batch` 中：每次 API 调用的原始 stdout 在 `json.loads` 之前旁路写入 `{tempdir}/tc-sec_workflow/{product}_{action}_{timestamp}.json`，解析失败时错误返回带 `dump` 路径，可从文件恢复无需重新请求。**调用方无需手写落盘代码。**

要点（由 wf 内部保证）：

- 落盘时机：在 `json.loads` 之前写入原始 stdout，确保解析失败时数据不丢
- 文件名格式：`{product}_{action}_{timestamp}.json`，timestamp 在 wf 模块加载时生成一次
- 存放目录：系统临时目录下的 `tc-sec_workflow/`（通过 `tempfile.gettempdir()` 获取），禁止写入脚本目录
- 错误返回中携带 `dump` 路径，便于后续从文件恢复

## 16. wf.py 公共 API

`scripts/wf.py` 封装并发执行、分页、时间参数、落盘，所有 workflow 脚本通过 `import wf` 调用，减少生成字符数：

| 名称 | 签名 | 说明 |
|------|------|------|
| `wf.T` | 常量 | `tccli_cli.py` 绝对路径，用于构造命令数组 |
| `wf.exec(cmd)` | `→ dict` | 单条命令执行+解析+落盘 |
| `wf.batch(cmds,workers=5)` | `→ dict` | 并发批量，key=`f"{product}.{action}"` |
| `wf.pmap(fn,items,workers=5)` | `→ dict` | 自定义 map 并发，`fn(item)->(key,value)` |
| `wf.page(product,action,list_key,filters=None,limit=100,workers=5,extra=None)` | `→ dict` | **统一分页采集**，自动探测分页/filter 位置（顶层 vs --Filter 对象内），保留 TotalCount。filters 为 Python list，元素 `{Key/Name,Values}`；无需选 pagef/pageo（已合并），任何 Action 直接用 |
| `wf.time(cmd,*args)` | `→ str` | 单值时间（now/today/start-of/ago 等） |
| `wf.time_range(value,unit)` | `→ (start,end)` | 时间范围对 |
| `wf.time_date_range(value,unit)` | `→ (start_date,end_date)` | 纯日期范围对 |
| `wf.out(obj)` | 打印 | 输出合法 JSON |

命令数组约定 `[wf.PY,wf.T,product,action,...,"--output","json"]`，`wf.exec`/`batch` 依赖 `c[2]=product`、`c[3]=action` 生成落盘文件名。

### tccli_cli.py batch 子命令

`tccli_cli.py` 除单条调用外，支持 `batch` 子命令在单进程内并发执行多条 tccli 调用（每个子命令独立隔离 HOME），适合一次性预检多个 Action 的 help：

```python
import subprocess,json
r=subprocess.run([PY,T,"batch",json.dumps([["cwp","DescribeVulList","help","--detail"],["cwp","DescribeGeneralStat","help","--detail"]])],capture_output=True,text=True)
d=json.loads(r.stdout)  # {"cwp.DescribeVulList": <help文本>, "cwp.DescribeGeneralStat": <help文本>}
```

`batch` 的参数数组是**透传给 tccli 的参数**（`["product","action",...]`，不带 `python3`/`tccli_cli.py` 前缀），与 `wf.batch` 的 cmds（带 `[PY,T,...]` 前缀）语义不同。`tccli_cli.py` 任何模式下都不 `sys.exit`，始终输出合法 JSON（成功或 `{"Error":{...}}`），调用方按 returncode 0 处理。

### 错误判断约定（统一）

无论 `tccli_cli.py`（单条/batch）还是 `wf.exec`/`wf.batch`，失败时都返回**大写 `Error` 键**的统一结构，调用方用 `"Error" in d` 判断：

```python
d=wf.exec([PY,T,"cwp","DescribeGeneralStat","--output","json"])
if "Error" in d:
    # 失败：d["Error"]["Code"] / d["Error"]["Message"]；wf.exec 解析失败还带 d["dump"]
    pass
else:
    # 成功：d 是 API 返回的 JSON
    total=d.get("TotalCount",0)
```

脚本自身输出的错误也用 `{"Error":{"Code","Message"}}` 格式（如 `wf.out({"Error":{"Code":"EmptyKeyList","Message":"..."}})`），禁止用小写 `error` 键。

> `tccli_cli.py` 内置 Action 访问控制：黑名单优先 → 白名单（默认 `^Describe\w*`/`^Get\w*`/`^List\w*`/`^Search\w*` 完整正则 + 25 个只读精确清单）→ 默认拒绝。写/触发/高危前缀（Create/Delete/Modify/Update/Stop/Start/Scan/Reset/Sync/Bind/Unbind/Enable/Disable/Import/Assume/Chat 等）已被 `blacklist_regex` 硬拦，**黑名单优先于白名单**。被拒返回 `{"Error":{"Code":"ActionDenied",...}}`。`help` 始终放行。配置在 `scripts/tccli_cli_config.json`，按 mtime 热加载。

## 禁止事项

- 禁止写注释
- 禁止使用 `import datetime` 或 `time.strftime` 生成时间
- 禁止直接调用 `tccli`，必须通过 `tccli_cli.py`（经 `wf.T` 或直接 `tccli_cli.py`）
- 禁止硬编码文件路径
- 禁止忽略 JSON 解析错误（wf.exec/batch 已内置 try/except，自定义 fn 中也应调 wf.exec）
- 禁止在报告中使用未经 API 验证的数据
- 禁止单线程串行调用多个独立 API（必须用 wf.batch/pmap 并发）
- 禁止生成超过 50 行的单个代码块（拆分为多阶段）
- 禁止手写 `def run(c)` / `ThreadPoolExecutor` 样板（用 wf.batch/pmap 代替）
- 禁止手写分页 `offsets=range(...)` 样板（用 wf.page 代替）
