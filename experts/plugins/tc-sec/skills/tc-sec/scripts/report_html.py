#!/usr/bin/env python3
"""HTML report template for tc-sec workflow scripts."""
import os,sys
import base
import wf

_CSS_PATH=base.script_path("base_style.css")
with open(_CSS_PATH,encoding="utf-8") as _f:
    _CSS=_f.read().strip()

def _now():
    return wf.time("now")

def _today():
    return wf.time("today")

def header(title, period=None, sources=None, unavailable=None):
    """Generate report header block.

    Args:
        title: Report title, e.g. "每日安全报告"
        period: Time period string, e.g. "2026-06-17 00:00:00 ~ 14:25:52 CST"
        sources: List of active product names, e.g. ["主机安全 CWP", "容器安全 TCSS"]
        unavailable: List of unavailable products, e.g. ["WAF", "CFW"]
    """
    today=_today()
    date_str=base.format_date_cn(today)

    meta1=f'报告日期：{date_str}'
    if period:
        # period 已自带"<标签>："前缀（如"数据时点："/"查询范围："）时不再附加"统计周期："
        ps=str(period)
        if "：" in ps[:8] or ":" in ps[:8]:
            meta1+=f' &nbsp;|&nbsp; {ps}'
        else:
            meta1+=f' &nbsp;|&nbsp; 统计周期：{ps}'

    meta2=""
    if sources:
        meta2+="数据来源："+"·".join(str(s) for s in sources if s is not None)
    if unavailable:
        if meta2:
            meta2+=" &nbsp;|&nbsp; "
        meta2+="⚠️ "+" / ".join(str(s) for s in unavailable if s is not None)+" 未开通"

    lines=f'<div class="header">\n<h1>\U0001f510 {title}</h1>\n'
    lines+=f'<div class="meta">{meta1}</div>\n'
    if meta2:
        lines+=f'<div class="meta">{meta2}</div>\n'
    lines+='</div>\n'
    return raw(lines)

# ---------- 数据驱动渲染：AI 传结构化数据，函数输出 HTML，避免手拼标签 ----------

_LEVELS={"critical","high","medium","low","info"}

def _level_of(v):
    """判断 v 是否为合法着色 level：纯 level（"high"）或带 c- 前缀（"c-high"）。是则返回去前缀的 level，否则 None。"""
    if not isinstance(v,str):
        return None
    if v in _LEVELS:
        return v
    if v.startswith("c-") and v[2:] in _LEVELS:
        return v[2:]
    return None

class raw:
    """标记已渲染的 HTML 片段，传入 _cell/_text/ul/table/para 等时不转义。raw('<b>x</b>') 或 raw(H.code('...'))。
    支持 raw+raw / raw+str 拼接（返回 raw），以及 str(raw)/f-string 取 .html。"""
    __slots__=("html",)
    def __init__(self, html):
        self.html = html.html if isinstance(html, raw) else str(html)
    def __str__(self): return self.html
    def __add__(self, other): return raw(self.html+(_cell(other)))
    def __radd__(self, other): return raw(_cell(other)+self.html)

import re as _re

# 文本中允许保留的 HTML 标签白名单，其余 < > 转义。
# 这样 agent 写 para("触发时间: <b>14:03</b>") 或单元格放 <code>cmd</code> 直接生效。
_TAG_WHITELIST = _re.compile(r'<(/?)(b|strong|i|em|u|code|span|div|br|p|ul|ol|li|h[1-6])(\s[^>]*)?(/?)>', _re.IGNORECASE)


def _esc(s):
    """严格转义（转义所有 < > & "）。raw 对象先取 .html。用于 badge/color 的值等纯数据。"""
    if isinstance(s, raw):
        return s.html
    return str(s).replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;")


def _smart(s):
    """智能转义：保留白名单 HTML 标签（含其属性，如 <code class="x">、<span class="badge...">），
    标签之间的文本转义 < > &。用于 para/note/ul/ol/table 单元格——agent 可直接写 <b>/<code>/<span>。
    raw 对象原样输出。"""
    if isinstance(s, raw):
        return s.html
    s = str(s)
    out = []
    i = 0
    for m in _TAG_WHITELIST.finditer(s):
        # 标签前的文本：转义 < > &（不转义 "，文本内容里无需）
        out.append(s[i:m.start()].replace("&","&amp;").replace("<","&lt;").replace(">","&gt;"))
        out.append(m.group(0))  # 白名单标签整体保留（含属性）
        i = m.end()
    out.append(s[i:].replace("&","&amp;").replace("<","&lt;").replace(">","&gt;"))
    return "".join(out)


def _cell(v, smart=True):
    """渲染一个单元格/文本片段：
    - raw 对象 → 原样输出不转义
    - ("值","critical") 元组 → badge 徽章（带背景），值用 _esc 严格转义
    - ("值","c-critical") 元组 → 纯色文字（无背景，c- 前缀），值用 _esc 严格转义
    - ("值","warning") / ("值","") 等非合法 level 的 2-tuple → 退化为取首元素当普通文本渲染（不泄露元组 repr）
    - 3+元组 / 嵌套tuple / dict → 取首个标量元素当普通文本（防 str(tuple)/str(dict) 泄露 repr）
    - None → 空串（不渲染字面 "None"）
    - 字符串 → smart=True 保留白名单标签（默认，agent 可写 <b>/<code>）；smart=False 严格转义
    level 取值：critical/high/medium/low/info（可带 c- 前缀表示纯色无背景）
    """
    for _ in range(8):  # 递归深度兜底，防病态自引用结构死循环
        if v is None:
            return ""
        if isinstance(v, raw):
            return v.html
        if isinstance(v,(tuple,list)) and len(v)==2:
            lv=_level_of(v[1])
            if lv:
                if v[1].startswith("c-"):
                    return f'<span class="{lv}">{_esc(v[0])}</span>'
                return f'<span class="badge badge-{lv}">{_esc(v[0])}</span>'
            v=v[0]  # 非法 level 的 2-tuple → 取首元素继续渲染
            continue
        if isinstance(v,(tuple,list)):
            v=v[0] if len(v)>0 else ""  # 非法长度 → 取首元素继续（处理嵌套/3-tuple）
            continue
        if isinstance(v,dict):
            v=next(iter(v.values()),"")  # dict → 取首个 value 继续
            continue
        return _smart(v) if smart else _esc(v)
    return _smart(v) if smart else _esc(v)

def _r(html):
    """把已渲染 HTML 字符串包成 raw 对象，使其传给其他渲染函数时不被转义。"""
    return raw(html)

def html(s):
    """标记一段已含 HTML 标签的字符串不转义（raw 的语义化别名）。如 html(f'触发时间: <b>{t}</b>')。"""
    return raw(s)

def badge(text, level):
    """单个徽章：badge('36294','critical') -> <span class="badge badge-critical">36294</span>（带背景）。返回 raw。
    level 非法/None → 退化为普通 <span>（不生成 badge-None 无效类）。"""
    lv=_level_of(level)
    cls=f' class="badge badge-{lv}"' if lv else ""
    return _r(f'<span{cls}>{_esc(text)}</span>')

def color(text, level):
    """纯色文字（无背景）：color('95','high') -> <span class="high">95</span>。返回 raw。适合卡片数值。
    level 非法/None → 退化为普通 <span>（不生成 class="None"）。"""
    lv=_level_of(level)
    cls=f' class="{lv}"' if lv else ""
    return _r(f'<span{cls}>{_esc(text)}</span>')

def table(headers, rows, cls=""):
    """表格。headers 表头列表，rows 行列表（每行是单元格列表，单元格可为字符串或 (值,level) 元组）。返回 raw。"""
    c=f' class="{cls}"' if cls else ""
    h="".join(f"<th>{_esc(x)}</th>" for x in headers if x is not None)
    body="".join("<tr>"+"".join(f"<td>{_cell(c)}</td>" for c in r)+"</tr>" for r in rows)
    return _r(f'<table{c}><tr>{h}</tr>{body}</table>')

def cards(items):
    """统计卡片网格。items 元素可为：
    - (label, value)            普通卡片
    - (label, (value,"c-high")) 卡片数值着色（纯色无背景，c- 前缀；与 _cell 着色约定一致）
    - (label, value, level)     卡片数值着色，level=critical/high/medium/low/info（或带 c- 前缀）。常见易错写法，显式支持避免 level 被误当 sub 渲染成可见文字
    - (label, value, sub)       带 sub 副标题；当 sub 不是合法 level 时才当副标题
    返回 raw。"""
    cells=""
    for it in items:
        it=tuple(it) if isinstance(it,(tuple,list)) else (it,)
        label=it[0] if len(it)>0 else ""
        value=it[1] if len(it)>1 else ""
        third=it[2] if len(it)>2 else None
        sub=""
        if third is not None:
            lv=_level_of(third)
            if lv:                      # 第三元素是 level → 对 value 着色，不渲染 sub
                value=(value,"c-"+lv)
            else:                        # 第三元素是普通文本 → 当副标题
                sub=f'<div class="sub">{_esc(third)}</div>'
        cells+=f'<div class="card"><div class="label">{_esc(label)}</div><div class="value">{_cell(value)}</div>{sub}</div>'
    return _r(f'<div class="summary-cards">{cells}</div>')

def section(title, *blocks):
    """区块：<div class="section"><h2>title</h2>...blocks...</div>。blocks 可为字符串/raw/其他渲染函数返回值。返回 raw。"""
    return _r(f'<div class="section"><h2>{_esc(title)}</h2>{_join(blocks)}</div>')

def finding(title, *blocks, crit=False):
    """发现块：告警/分析条目。crit=True 用红色边框。blocks 可为字符串/raw/函数返回值。返回 raw。
    注意 crit 是关键字参数，必须放在位置块之后：finding(t, b1, b2, crit=True)。或用 finding_crit() 免记顺序。"""
    c=" crit" if crit else ""
    return _r(f'<div class="finding{c}"><h3>{_esc(title)}</h3>{_join(blocks)}</div>')

def finding_crit(title, *blocks):
    """严重发现块（红色边框），等价 finding(title, *blocks, crit=True)，免记关键字参数顺序。返回 raw。"""
    return finding(title, *blocks, crit=True)

def ul(items):
    """无序列表。items 元素可为字符串(含HTML标签自动保留)/raw/(值,level)。返回 raw。"""
    return _r("<ul>"+"".join(f"<li>{_cell(x,smart=True)}</li>" for x in items)+"</ul>")

def ol(items):
    """有序列表。返回 raw。"""
    return _r("<ol>"+"".join(f"<li>{_cell(x,smart=True)}</li>" for x in items)+"</ol>")

def note(*parts):
    """黄色提示框。parts 为多段文本/HTML，每段单独渲染。返回 raw。"""
    return _r(f'<p class="note">{_join(parts)}</p>')

def para(*parts):
    """段落。parts 为多段文本/HTML，每段单独渲染。如 para('总数 ', H.code('36294'), ' 台')。返回 raw。
    字符串段中的 <b>/<code>/<span> 等标签自动保留生效，无需 html() 包裹。"""
    return _r(f"<p>{_join(parts)}</p>")

def _join(parts):
    """把多段（字符串/raw/元组/渲染函数返回值）各自过 _cell(smart=True) 后拼接（保留 HTML 标签）。"""
    return "".join(_cell(p, smart=True) for p in parts)

def code(text):
    """等宽代码片段（命令/日志）。返回 raw，可安全嵌入 para/ul 等。None/非 str → 空串，不渲染字面 "None"。"""
    return _r(f'<code class="event-msg">{_esc("" if text is None else text)}</code>')

def head(title="安全报告"):
    return raw(f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
{_CSS}
</style>
</head>
<body>
<div class="container">
''')

def foot(gen_time=None):
    t=gen_time or _now()
    return raw(f'''
<div class="footer">
<p>本报告由腾讯云安全专家自动生成 · 数据来源：腾讯云安全产品 API 实时查询</p>
<p>报告生成时间：{t} CST · 未经人工审核，处置前请结合业务实际情况确认</p>
</div>
</div>
</body>
</html>''')

def wrap(title, body, gen_time=None, period=None, sources=None, unavailable=None, with_header=True):
    """生成完整 HTML 报告。默认在 body 前自动拼接 header()（报告头部：标题/日期/周期/数据来源）。

    Args:
        title: 报告标题
        body: 报告主体 HTML（container 内部）
        gen_time: 可选生成时间，默认 time_util now
        period: 统计周期字符串，如 "2026-06-23 00:00:00 ~ 14:00:00 CST"
        sources: 已开通数据来源产品名列表
        unavailable: 未开通产品名列表
        with_header: 是否包含 header 块，默认 True
    """
    parts = [head(title)]
    if with_header:
        parts.append(header(title, period=period, sources=sources, unavailable=unavailable))
    parts.append(body if isinstance(body, raw) else raw(body))
    parts.append(foot(gen_time))
    return _join(parts)

if __name__=="__main__":
    cmd=sys.argv[1] if len(sys.argv)>1 else "css"
    if cmd=="css":
        print(_CSS)
    elif cmd=="head":
        t=sys.argv[2] if len(sys.argv)>2 else "安全报告"
        print(head(t))
    elif cmd=="foot":
        print(foot())
    elif cmd=="wrap":
        body=sys.stdin.read()
        t=sys.argv[2] if len(sys.argv)>2 else "安全报告"
        print(wrap(t,body))
