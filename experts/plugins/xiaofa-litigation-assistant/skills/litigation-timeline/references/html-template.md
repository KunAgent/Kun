# HTML 打印模板参考

## 完整HTML模板结构

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>案件名称</title>
    <style>
        /* CSS样式 */
    </style>
</head>
<body>
    <!-- 第1页：时间轴 -->
    <div class="page">
        <!-- 页面内容 -->
    </div>

    <!-- 第2页：事件明细表 -->
    <div class="page">
        <!-- 页面内容 -->
    </div>

    <!-- 第3页：综合分析 -->
    <div class="page">
        <!-- 页面内容 -->
    </div>
</body>
</html>
```

## 页面基础设置CSS

```css
@page {
    size: A4 portrait;
    margin: 1.2cm;
}

body {
    font-family: "Microsoft YaHei", "SimSun", "Microsoft JhengHei", sans-serif;
    font-size: 11pt;
    line-height: 1.4;
    color: #333;
    background: #fff;
}

.page {
    width: 210mm;
    min-height: 297mm;
    margin: 0 auto;
    padding: 1.2cm;
    background: #fff;
    position: relative;
    page-break-after: always;
}

.page:last-child {
    page-break-after: avoid;
}

@media print {
    body {
        background: #fff;
    }
    .page {
        margin: 0;
        box-shadow: none;
    }
}
```

## 字号规范CSS

```css
h1 {
    font-size: 18pt;
    text-align: center;
    color: #2c3e50;
    margin-bottom: 5pt;
    border-bottom: 2px solid #3498db;
    padding-bottom: 8pt;
    word-wrap: break-word;
    overflow-wrap: break-word;
    hyphens: auto;
}

h2 {
    font-size: 14pt;
    color: #34495e;
    margin: 12pt 0 6pt 0;
    padding-left: 8pt;
    border-left: 4px solid #3498db;
}

h3 {
    font-size: 12pt;
    color: #555;
    margin: 8pt 0 4pt 0;
}
```

## 时间轴样式CSS

```css
/* 阶段标题 */
.phase-title {
    font-size: 11pt;
    font-weight: bold;
    color: #fff;
    padding: 4pt 10pt;
    margin: 10pt 0 6pt 0;
    border-radius: 3px;
}

/* 时间轴容器 */
.timeline {
    position: relative;
    margin: 6pt 0;
}

.timeline::before {
    content: '';
    position: absolute;
    left: 70pt;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #bdc3c7;
}

.timeline-item {
    position: relative;
    margin: 6pt 0;
    padding-left: 90pt;
}

.timeline-date {
    position: absolute;
    left: 0;
    width: 60pt;
    font-size: 8pt;
    color: #7f8c8d;
    text-align: right;
    padding-right: 6pt;
    line-height: 1.3;
}

.timeline-content {
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 3px;
    padding: 5pt 8pt;
    position: relative;
}

.timeline-content::before {
    content: '';
    position: absolute;
    left: -5px;
    top: 8px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 2px solid #fff;
}

.timeline-icon {
    display: inline-block;
    margin-right: 4pt;
    font-size: 11pt;
}

.timeline-title {
    font-weight: bold;
    color: #2c3e50;
    font-size: 10pt;
}

.timeline-evidence {
    font-size: 8pt;
    color: #7f8c8d;
    margin-top: 2pt;
}
```

## 阶段配色CSS

```css
/* 申请/履约期 */
.phase-apply .timeline-content {
    border-left: 3px solid #87CEEB;
    background: #f0f8ff;
}

.phase-apply .timeline-content::before {
    background: #87CEEB;
}

.phase-apply .phase-title {
    background: #5dade2;
}

/* 驳回/违约期 */
.phase-reject .timeline-content {
    border-left: 3px solid #FF7F50;
    background: #fff5ee;
}

.phase-reject .timeline-content::before {
    background: #FF7F50;
}

.phase-reject .phase-title {
    background: #e74c3c;
}

/* 复审/协商期 */
.phase-appeal .timeline-content {
    border-left: 3px solid #FFD700;
    background: #fffaf0;
}

.phase-appeal .timeline-content::before {
    background: #FFD700;
}

.phase-appeal .phase-title {
    background: #f39c12;
    color: #fff;
}

/* 诉讼期 */
.phase-litigation .timeline-content {
    border-left: 3px solid #DDA0DD;
    background: #faf5ff;
}

.phase-litigation .timeline-content::before {
    background: #9370DB;
}

.phase-litigation .phase-title {
    background: #9b59b6;
}
```

## 表格样式CSS

```css
table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0;
    font-size: 10pt;
}

th, td {
    border: 1px solid #ddd;
    padding: 4pt 6pt;
    text-align: left;
    vertical-align: top;
}

th {
    background: #3498db;
    color: #fff;
    font-weight: bold;
    font-size: 10pt;
}

tr:nth-child(even) {
    background: #f8f9fa;
}
```

## 争议焦点样式CSS

```css
.dispute-item {
    background: #fff5f5;
    border-left: 3px solid #e74c3c;
    padding: 6pt 10pt;
    margin: 6pt 0;
}

.dispute-title {
    font-weight: bold;
    color: #c0392b;
    font-size: 10pt;
    margin-bottom: 3pt;
}

.dispute-claim {
    font-size: 9pt;
    margin: 2pt 0;
}

.claim-label {
    font-weight: bold;
    color: #7f8c8d;
}
```

## 页脚样式CSS

```css
.page-footer {
    position: absolute;
    bottom: 1cm;
    left: 1.2cm;
    right: 1.2cm;
    text-align: center;
    font-size: 9pt;
    color: #7f8c8d;
    border-top: 1px solid #ecf0f1;
    padding-top: 6pt;
}
```

## 页面顶部信息样式CSS

```css
.page-header-info {
    text-align: center;
    margin-bottom: 12pt;
    font-size: 10pt;
    color: #7f8c8d;
    padding: 5pt;
    background: #f8f9fa;
    border-radius: 3px;
}
```

## 证据链样式CSS

```css
.evidence-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6pt;
    margin: 8pt 0;
}

.evidence-item {
    background: #e8f5e9;
    border: 1px solid #81c784;
    border-radius: 3px;
    padding: 3pt 8pt;
    font-size: 9pt;
}
```

## 两栏布局CSS

```css
.two-col {
    display: flex;
    gap: 15pt;
    margin: 8pt 0;
}

.two-col > div {
    flex: 1;
}
```

## 完整页面示例 - 第1页（时间轴）

```html
<div class="page">
    <h1>示例案件<br>时间轴图谱</h1>

    <div class="page-header-info">
        案号：（示例）X行终XXXX号 | 案由：示例行政管理 | 商标号：第XXXXXXX号"示例商标"
    </div>

    <h2>案件时间轴</h2>

    <div class="timeline">
        <div class="phase-title phase-apply">申请阶段（2017年1月 - 2019年4月）</div>

        <div class="timeline-item phase-apply">
            <div class="timeline-date">2017-01-17</div>
            <div class="timeline-content">
                <span class="timeline-icon">📄</span>
                <span class="timeline-title">申请注册"示例商标"</span>
                <div class="timeline-evidence">证据：商标申请受理通知书</div>
            </div>
        </div>
        <!-- 更多时间轴项目 -->
    </div>

    <div class="page-footer">第 1 页 / 共 3 页</div>
</div>
```

## 完整页面示例 - 第2页（事件明细表）

```html
<div class="page">
    <h1>示例案件<br>事件明细表</h1>

    <div class="page-header-info">
        案号：（示例）X行终XXXX号 | 商标号：第XXXXXXXX号
    </div>

    <h2>法律阶段划分</h2>
    <table class="phase-table">
        <thead>
            <tr>
                <th>阶段</th>
                <th>时间区间</th>
                <th>状态</th>
                <th>时长</th>
            </tr>
        </thead>
        <tbody>
            <tr style="background: #e3f2fd;">
                <td>申请阶段</td>
                <td>2017-01-17 ~ 2019-04-12</td>
                <td>商标局审查中</td>
                <td>2年3个月</td>
            </tr>
            <!-- 更多行 -->
        </tbody>
    </table>

    <h2>事件明细表</h2>
    <table>
        <thead>
            <tr>
                <th>序号</th>
                <th>时间</th>
                <th>事件</th>
                <th>证据</th>
                <th>法律意义</th>
                <th>主体</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td>1</td>
                <td>2017-01-17</td>
                <td>申请注册"示例商标"</td>
                <td>判决书P2</td>
                <td>确立商标注册申请法律关系</td>
                <td>我方</td>
            </tr>
            <!-- 更多行 -->
        </tbody>
    </table>

    <div class="page-footer">第 2 页 / 共 3 页</div>
</div>
```

## 完整页面示例 - 第3页（综合分析）

```html
<div class="page">
    <h1>示例案件<br>综合分析</h1>

    <div class="page-header-info">
        案号：（示例）X行终XXXX号 | 终审判决日期：示例日期
    </div>

    <h2>一、争议焦点提炼 🔴</h2>

    <div class="dispute-item">
        <div class="dispute-title">🔴 核心争议焦点一：引证商标的合法性</div>
        <p class="dispute-claim"><span class="claim-label">我方主张：</span>引证商标已被撤销</p>
        <p class="dispute-claim"><span class="claim-label">法院认定：</span>引证商标在申请日前有效</p>
    </div>
    <!-- 更多争议焦点 -->

    <h2>二、证据链完整性</h2>
    <div class="evidence-list">
        <div class="evidence-item">✓ 商标申请受理通知书</div>
        <div class="evidence-item">✓ 商标初审公告</div>
        <!-- 更多证据 -->
    </div>

    <h2>三、案件结果分析</h2>
    <table>
        <thead>
            <tr>
                <th>程序</th>
                <th>结果</th>
                <th>时间</th>
            </tr>
        </thead>
        <tbody>
            <!-- 结果行 -->
        </tbody>
    </table>

    <div class="two-col">
        <div>
            <h2>四、案件基本信息</h2>
            <table class="info-table">
                <tbody>
                    <tr><td>案号</td><td>（示例）X行终XXXX号</td></tr>
                    <!-- 更多信息 -->
                </tbody>
            </table>
        </div>
        <div>
            <h2>五、程序信息</h2>
            <table class="info-table">
                <tbody>
                    <tr><td>一审法院</td><td>北京知识产权法院</td></tr>
                    <!-- 更多信息 -->
                </tbody>
            </table>
        </div>
    </div>

    <div class="page-footer">第 3 页 / 共 3 页</div>
</div>
```

## 浏览器兼容性

**推荐浏览器：**
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

**打印设置：**
- 纸张：A4
- 边距：默认或无
- 背景：勾选"打印背景图形"
- 页眉页脚：关闭

## 常见问题

**Q: 时间轴跨页了怎么办？**
A: 调整`.timeline-item`的margin值，减小字号，或减少每个项目的padding。

**Q: 表格行太多怎么办？**
A: 限制事件明细表最多12-15项，超过的项目可以合并或删除非关键事件。

**Q: 黑白打印时看不清颜色？**
A: 确保添加图标（📄⚖️等）辅助区分，使用边框而不是纯色背景。
