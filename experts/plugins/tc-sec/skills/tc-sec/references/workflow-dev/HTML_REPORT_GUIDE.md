# HTML 报告生成指南

Workflow 脚本生成最终报告时，使用 `scripts/report_html.py` 提供的预置 CSS 和 HTML 骨架，避免每次重复生成样式代码，减少输出 token 和生成耗时。

## 脚本位置

```
${CODEBUDDY_PLUGIN_ROOT}/skills/tc-sec/scripts/report_html.py
```

## 使用方式

### 方式一：Python import（推荐）

在 workflow 脚本中直接 import 使用：

```python
import sys,os,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import report_html as H

body='<div class="section"><h2>标题</h2><p>内容</p></div>'
html=H.wrap("每日安全报告",body,period="2026-06-23 00:00:00 ~ 14:00:00 CST",sources=["主机安全 CWP"],unavailable=["WAF"])
with open("/tmp/report.html","w") as f:
    f.write(html)
```

### 方式二：命令行调用

```bash
# 获取纯 CSS
python3 scripts/report_html.py css

# 获取 HTML 头部（含 DOCTYPE、<head>、CSS、<body> 开始）
python3 scripts/report_html.py head "报告标题"

# 获取 HTML 页脚（含固定声明文案、</body>、</html>）
python3 scripts/report_html.py foot

# 将 body 内容通过 stdin 传入，输出完整 HTML
echo '<div class="section">...</div>' | python3 scripts/report_html.py wrap "报告标题"
```

## API 说明

### 报告骨架

| 函数 | 参数 | 返回 |
|------|------|------|
| `head(title)` | 报告标题字符串 | `<!DOCTYPE html>` 到 `<div class="container">` |
| `header(title, period=None, sources=None, unavailable=None)` | 标题 + 统计周期 + 数据来源 + 未开通产品 | 报告头部块（深蓝渐变背景，含日期/周期/来源） |
| `foot(gen_time=None)` | 可选时间字符串，默认自动调用 time_util.py | 页脚声明 + `</body></html>` |
| `wrap(title, body, gen_time=None, period=None, sources=None, unavailable=None, with_header=True)` | 标题 + body + 可选时间/周期/来源 + 是否含 header | 完整 HTML 文档（默认自动拼接 header） |
| `_CSS` | — | 纯 CSS 字符串（可直接嵌入自定义模板） |

> `wrap` 默认 `with_header=True`，会在 body 前自动拼接 `header()`，无需手动调用。传 `period`/`sources`/`unavailable` 填充头部元信息；不传则 header 只显示标题与报告日期。

### 数据驱动渲染（优先用，避免手拼 HTML 标签）

AI 传结构化数据（list/tuple），函数输出 HTML。**比手拼 `body+='<tr><td>...'` 省约 60% 字符**，且 badge 着色自动处理。

| 函数 | 参数 | 说明 |
|------|------|------|
| `table(headers, rows, cls="")` | 表头列表 + 行列表 | 单元格可为字符串(含HTML标签自动保留)/(值,level)元组 |
| `cards(items)` | `[(label,value,sub),...]` | **统计卡片网格**（label+大数值），勿用于内容卡片。卡片数值着色支持三种写法：`(label,(value,"c-high"))` / `(label,value,"c-high")` / `(label,value,"high")`，后两者是常见易错写法已显式支持，不会把 level 当副标题渲染成可见文字 |
| `section(title, *blocks)` | 标题 + 若干块 | `<div class="section"><h2>title</h2>...blocks...</div>` |
| `finding(title, *blocks, crit=False)` | 标题 + 若干块 + crit | 告警/分析条目，crit=True 红色边框 |
| `finding_crit(title, *blocks)` | 标题 + 若干块 | 等价 `finding(...,crit=True)`，免记关键字参数顺序 |
| `ul(items)` / `ol(items)` | 字符串/raw/`(值,level)` 列表 | 无序/有序列表（字符串含 HTML 标签自动保留） |
| `badge(text, level)` | 文本 + level | 徽章（带背景圆角），用于表格突出数字 |
| `color(text, level)` | 文本 + level | 纯色文字（无背景），适合卡片数值 |
| `note(*parts)` / `para(*parts)` | 多段文本/HTML | 提示框 / 段落，字符串含 HTML 标签自动保留 |
| `code(text)` | 文本 | 等宽代码片段（命令/日志），自动换行限宽 |
| `html(s)` / `raw(html)` | 已含 HTML 标签的字符串 | 标记不转义；通常无需，para/ul 已自动保留白名单标签 |

> **着色约定**（level=critical/high/medium/low/info）：
> - `("值","high")` → 徽章 `<span class="badge badge-high">值</span>`（带背景，用于表格）
> - `("值","c-high")` → 纯色 `<span class="high">值</span>`（无背景，`c-` 前缀，用于卡片数值）
> - `("值","warning")` / `("值","")` 等**非合法 level 的 2-tuple** → 退化为取首元素当普通文本渲染（不会泄露成 `('值','warning')` 字面量）。所以批量给单元格包 2-tuple 时，level 写不合法也不报错、不泄露，但不会着色
> - 纯字符串 → 转义；`html(...)`/`raw(...)` → 原样输出不转义
> - **卡片数值着色**：`cards()` 里给数值着色有三法：`("风险主机",("95","c-high"))`、`("风险主机","95","c-high")`、`("风险主机","95","high")` 均可。第三元素若不是合法 level（如 `"8核16G"`）才当副标题 sub。**禁止把 level 字符串当普通文本塞进 value/sub，否则会渲染出可见的 `c-high` 文字**

> **优先用组件函数，不要手拼 `body+='<tr><td>...'`**——数据驱动比手拼 HTML 省约 60% 字符，badge 着色自动处理。所有组件函数返回 `raw` 对象，可互相嵌套、可用 `+` 拼接、可直传 `wrap` 的 body。

## 防错要点（必读，避免渲染出错）

> **`para`/`note`/`ul`/`ol`/`table` 单元格的字符串里可直接写 HTML 标签**（`<b>`/`<code>`/`<span class="...">`/`<br/>`/`<strong>`/`<em>`/`<div>` 等，含属性），函数自动保留白名单标签（含属性，引号不转义）、转义其余 `< >`。所以 `H.para("触发时间: <b>14:03</b>")`、`H.table(["详情"],[["<code>VM-0-5</code>"]])`、`H.para('<span class="badge badge-critical">高</span>')` 都直接生效，无需 `html()`。白名单外的标签（如 `<script>`）会被转义。仅整段已知 HTML 才用 `H.html(s)`。

1. **`wf.exec`/`wf.batch` 已返回解析后的 dict/list，不要再 `json.loads`**。
2. **组件函数返回值（code/badge/color 等是 raw）不要拼进 f-string/字符串拼接**，用多段传参或直接写标签：
   - ❌ `H.para("总数："+H.code("36294"))` —— 拼接后 `<code>` 被转义
   - ✅ `H.para("总数 ",H.code("36294")," 台")` 或 `H.para("总数 <code>36294</code> 台")`（标签直接写）
3. **body 拼多个块用 `+`**（raw 支持 `+`）；单个可直接传 `wrap`。
4. **`cards()` 仅用于统计卡片网格**（label + 大数值），不要拿来做告警详情/内容卡片——告警详情用 `finding()`/`finding_crit()`。
5. **`finding` 的 crit 是关键字参数，须放在位置块后**：`finding(title, b1, b2, crit=True)`；嫌麻烦用 `finding_crit(title, b1, b2)`（等价 crit=True）。
6. **着色两套**：`("95","high")` → badge 带背景（表格突出用）；`("95","c-high")` → 纯色无背景（卡片数值用，`c-` 前缀）。level 只认 critical/high/medium/low/info。`cards()` 里 `(label,value,level)` 三元组也支持着色，不会把 level 当副标题。
7. **长命令/日志用 `H.code(text)`**，自带等宽 + 自动换行 + 限宽，不会撑爆表格；也可在单元格直接写 `<code>...</code>`。
8. **模板占位符必须替换**：`references/template/*.md` 里的 `{total_keys}`、`{}` 等是**结构占位符**，仅供参考章节结构，**不是可执行填充**。生成报告时必须用 `H.*` 组件函数把真实 API 数值填进去，**禁止把含 `{...}` 占位符的模板原文直接塞进 `para()`/body**——否则报告里会出现 `发现 {} 条密钥告警` 这种未填充文字。每个数值都来自 `wf.exec`/`wf.batch` 返回的 dict，按 `res["xxx"]["TotalCount"]` 等取真实值后填入。

## 渲染示例

```python
import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import report_html as H

body=H.section("主机安全概览",
    H.cards([("总主机","117"),("在线","84"),("风险主机",("95","c-high")),("未装Agent",("16","c-medium"))])
)
body+=H.section("主机安全 CWP — 安全事件统计",
    H.table(["事件类型","事件数","影响主机数","风险等级"],[
        ["反弹Shell",("36,294","critical"),"16",("高","high")],
        ["异常登录",("31,355","critical"),"63",("高","high")],
        ["爆破攻击","8","3",("低","low")],
    ])
)
body+=H.section("今日重点告警分析",
    H.finding("1. 反弹Shell攻击 — 172.16.48.74",
        H.para(H.html("触发时间: <b>2026-06-23 14:03:46</b> | 等级: "),H.badge("高危","critical")),
        H.para("攻击者通过反弹Shell控制该主机。"),
        H.ul(["立即隔离主机 172.16.48.74，断开网络","排查 172.16.64.36:3389 是否为跳板机"]),
        crit=True)
)
body+=H.section("处置建议",H.ol(["隔离 172.16.48.74","修复 74 台主机 2237 个高危漏洞"]))
html=H.wrap("今日安全报告",body,period="2026-06-23 00:00:00 ~ 15:09:41 CST",sources=["主机安全 CWP"],unavailable=["CFW 云防火墙"])
```

## 可用 CSS 类速查

### 布局

| 类名 | 用途 |
|------|------|
| `.container` | 页面最大宽度容器 |
| `.header` | 报告头部（深蓝渐变背景） |
| `.header .meta` | 头部副标题/元信息 |
| `.summary-cards` | 概览卡片网格 |
| `.card` / `.card .label` / `.card .value` / `.card .sub` | 单个统计卡片 |
| `.section` | 白色内容区块 |
| `.section h2` / `.section h3` | 区块标题 |

### 表格

| 类名 | 用途 |
|------|------|
| `table` / `th` / `td` | 标准表格样式（无需额外类名） |
| `tr:hover` | 行悬停高亮 |

### 徽章（风险等级）

| 类名 | 颜色 | 用途 |
|------|------|------|
| `.badge.badge-critical` | 红色 | 严重 |
| `.badge.badge-high` | 橙色 | 高危 |
| `.badge.badge-medium` | 黄色 | 中危 |
| `.badge.badge-low` | 绿色 | 低危 |
| `.badge.badge-info` | 蓝色 | 信息 |

### 文字颜色

| 类名 | 用途 |
|------|------|
| `.critical` | 红色数值 |
| `.high` | 橙色数值 |
| `.medium` | 黄色数值 |
| `.low` | 绿色数值 |
| `.info` | 蓝色数值 |

### 告警与发现

| 类名 | 用途 |
|------|------|
| `.alert-box` | 红色左边框告警框 |
| `.alert-box.warn` | 黄色左边框警告框 |
| `.alert-box.info` | 蓝色左边框信息框 |
| `.finding` | 发现条目（紫色左边框） |
| `.finding.crit` | 严重发现条目（红色左边框） |

### 评分

| 类名 | 用途 |
|------|------|
| `.score-gauge` | 评分容器（flex 布局） |
| `.score-circle.score-red` | 红色评分圆圈 |
| `.score-circle.score-orange` | 橙色评分圆圈 |
| `.score-circle.score-green` | 绿色评分圆圈 |

### 其他

| 类名 | 用途 |
|------|------|
| `.event-msg` | 等宽字体事件消息（命令、日志等） |
| `.note` | 黄色背景备注框 |
| `.footer` | 页脚（居中灰色小字） |

## 典型 workflow 脚本中的用法

```python
import sys,os,json,glob
_R=os.environ.get("CODEBUDDY_PLUGIN_ROOT") or (glob.glob(os.path.expanduser("~/.workbuddy/plugins/marketplaces/*/plugins/tc-sec"))+[""])[0]
sys.path.insert(0,os.path.join(_R,"skills","tc-sec","scripts"))
import wf
import report_html as H
T=wf.T; PY=wf.PY

cmds=[[PY,T,"cwp","DescribeGeneralStat","--output","json"]]
res=wf.batch(cmds)

body='<div class="section"><h2>主机安全概览</h2>'
body+='<table><tr><th>指标</th><th>数值</th></tr>'
body+='</table></div>'

out=H.wrap("每日安全报告",body,period="2026-06-23 00:00:00 ~ 14:00:00 CST",sources=["主机安全 CWP"])
path=os.path.join(wf._TMP,f"report_{wf._TS}.html")
with open(path,"w") as f:
    f.write(out)
print(json.dumps({"report_path":path},ensure_ascii=False))
```

## 注意事项

- body 内容只需写 `<div class="container">` 内部的 HTML，head/foot 会自动包裹外层结构
- 页脚声明文案是固定的，不要修改
- 生成时间默认通过 `time_util.py now` 获取，也可手动传入
- 报告文件写入系统临时目录，不要写入脚本目录
