#!/usr/bin/env python3
"""Generate test case HTML reports from JSON data.

Usage:
    python3 render_html.py <input.json> [output.html]
"""

import json
import sys
import os
from datetime import datetime


def esc(s):
    if not isinstance(s, str):
        return str(s)
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def render(data):
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ALADIN | {esc(data.get('title', '测试用例'))}</title>
{_css()}
</head>
<body>

<h1>ALADIN | {esc(data.get('title', '测试用例文档'))}</h1>
<p>{esc(data.get('requirement', ''))[:120]} | 时间: {now}</p>
<p>总计: {esc(str(data.get('statistics',{}).get('total',0)))} | P0: {esc(str(data.get('statistics',{}).get('p0',0)))} | P1: {esc(str(data.get('statistics',{}).get('p1',0)))} | P2: {esc(str(data.get('statistics',{}).get('p2',0)))}</p>

{_toc(data.get('test_cases', []))}

<h2>测试用例详情</h2>
{_cases(data.get('test_cases', []))}

</body>
</html>"""


def _toc(cases):
    if not cases:
        return ""
    rows = ""
    for c in cases:
        rows += f"<tr><td><a href=\"#{esc(c.get('id',''))}\">{esc(c.get('id',''))}</a></td><td>{esc(c.get('priority',''))}</td><td>{esc(c.get('test_point',''))}</td><td>{esc(c.get('module',''))}</td></tr>"
    return f"""<h2>用例目录</h2>
<table>
<tr><th>ID</th><th>优先级</th><th>名称</th><th>模块</th></tr>
{rows}
</table>"""


def _cases(cases):
    if not cases:
        return ""
    result = ""
    for c in cases:
        steps = c.get("steps", [])
        if isinstance(steps, list):
            steps_html = "".join(f'<div class="step">{i+1}. {esc(s)}</div>' for i, s in enumerate(steps))
        else:
            steps_html = f'<div class="step">{esc(str(steps))}</div>'
        pid = esc(c.get("priority", ""))
        result += f"""<div class="case" id="{esc(c.get('id',''))}">
<strong>[{pid}] {esc(c.get('id',''))}: {esc(c.get('test_point',''))}</strong><br>
模块: {esc(c.get('module',''))}<br>
前置条件: {esc(c.get('precondition',''))}<br>
<br>
测试步骤:<br>
{steps_html}
<br>
预期结果:<br>
<div class="step">&bull; {esc(c.get('expected',''))}</div>
</div>"""
    return result


def _css():
    return """<style>
body{
  font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  margin: 40px;
  line-height: 1.6;
  font-size: 14px;
  color: #222;
}
table{
  border-collapse: collapse;
  width: 100%;
  margin: 20px 0;
}
th, td{
  border: 1px solid #888;
  padding: 8px 12px;
  text-align: left;
}
th{
  background: #f0f0f0;
}
h1{
  font-size: 22px;
  margin-bottom: 8px;
}
h2{
  margin-top: 40px;
  border-bottom: 2px solid #222;
  padding-bottom: 4px;
}
.case{
  margin: 20px 0;
  padding: 14px 16px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.step{
  margin: 4px 0 4px 24px;
}
a{color: #0366d6;text-decoration: none}
a:hover{text-decoration: underline}
</style>"""


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 render_html.py <input.json> [output.html]", file=sys.stderr)
        sys.exit(1)
    input_path = sys.argv[1]
    if not os.path.isfile(input_path):
        print(f"Error: file not found: {input_path}", file=sys.stderr)
        sys.exit(1)
    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    html = render(data)
    output_path = sys.argv[2] if len(sys.argv) >= 3 else f"{os.path.splitext(input_path)[0]}.html"
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"HTML report written to: {output_path}")
    print(output_path)


if __name__ == "__main__":
    main()
