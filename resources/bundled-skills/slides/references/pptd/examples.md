[Back to PPTD format index](format.md)

#### Examples

**Bar chart (stacked)**

```yaml
- elementId: c1
  elementType: chart
  bounds: [50, 100, 600, 400]
  data:
    cols: [quarter, revenue, cost]
    rows:
      - [Q1, 120, 220]
      - [Q2, 132, 182]
      - [Q3, 101, 191]
      - [Q4, 134, 234]
  seriesDefaults:
    bar: {stack: value}
  series:
    - type: bar
      encode: {x: quarter, y: revenue}
      name: Revenue
      fill: "$primary"
    - type: bar
      encode: {x: quarter, y: cost}
      name: Expenses
      fill: "$accent"
```

**Line chart (multi-series differentiation)**

```yaml
- elementId: c2
  elementType: chart
  bounds: [50, 100, 600, 400]
  data:
    cols: [month, actual, target, baseline]
    rows:
      - [Jan, 72, 65, 50]
      - [Feb, 85, 70, 50]
      - [Mar, null, 78, 50]
      - [Apr, 90, 82, 50]
  yAxis: {min: 0, max: 100, gridLine: {color: "#f0f0f0"}}
  series:
    - type: line
      encode: {x: month, y: actual}
      name: Actual
      lineColor: "#5470c6"
      lineStyle: solid
      width: 3
      smooth: true
    - type: line
      encode: {x: month, y: target}
      name: Target
      lineColor: "#ee6666"
      lineStyle: dash
      smooth: true
    - type: line
      encode: {x: month, y: baseline}
      name: Baseline
      lineColor: "#999999"
      lineStyle: dot
      width: 1
      marker: false
```

**Area chart (stream stacking)**

```yaml
- elementId: c3
  elementType: chart
  bounds: [50, 80, 700, 400]
  title: Traffic Evolution by Channel
  data:
    cols: [week, web, app, partner]
    rows:
      - [W1, 200, 120, 80]
      - [W2, 240, 160, 90]
      - [W3, 260, 200, 110]
      - [W4, 280, 240, 130]
  seriesDefaults:
    area: {stack: stream}
  series:
    - type: area
      encode: {x: week, y: web}
      name: Web
      areaColor: "#5470c6"
    - type: area
      encode: {x: week, y: app}
      name: App
      areaColor: "#91cc75"
    - type: area
      encode: {x: week, y: partner}
      name: Partner
      areaColor: "#fac858"
```

**Bubble chart (multi-series grouping)**

```yaml
- elementId: c5
  elementType: chart
  bounds: [50, 80, 700, 420]
  title: User Distribution
  xAxis: {title: Age}
  yAxis: {title: "Annual income (10K)"}
  data:
    cols: [age_s, inc_s, pop_s, age_w, inc_w, pop_w, age_m, inc_m, pop_m]
    rows:
      - [22, 5, 120, 28, 12, 380, 45, 40, 180]
      - [null, null, null, 35, 25, 260, 52, 60, 90]
  seriesDefaults:
    bubble:
      sizeScale: sqrt
      sizeRange: [8, 48]
  series:
    - type: bubble
      encode: {x: age_s, y: inc_s, size: pop_s}
      name: Students
      fill: "#5470c6"
    - type: bubble
      encode: {x: age_w, y: inc_w, size: pop_w}
      name: White-collar
      fill: "#91cc75"
    - type: bubble
      encode: {x: age_m, y: inc_m, size: pop_m}
      name: Management
      fill: "#ee6666"
```

**Candlestick chart (with MA5 overlay line)**

```yaml
- elementId: c6
  elementType: chart
  bounds: [50, 80, 700, 420]
  title: Stock Price Trend
  data:
    cols: [date, open, high, low, close, ma5]
    rows:
      - ["2024-01-01", 100, 110, 95, 108, null]
      - ["2024-01-02", 108, 115, 105, 112, null]
      - ["2024-01-03", 112, 118, 109, 116, null]
      - ["2024-01-04", 116, 120, 110, 113, null]
      - ["2024-01-05", 113, 117, 108, 115, 112.8]
  yAxis: {title: Price}
  series:
    - type: candlestick
      encode: {x: date, open: open, close: close, low: low, high: high}
      upBars: {fill: "#ee6666"}
      downBars: {fill: "#5470c6"}
    - type: line
      encode: {x: date, y: ma5}
      name: MA5
      smooth: true
      width: 2
      lineColor: "#fac858"
```

**Waterfall chart**

```yaml
- elementId: c9
  elementType: chart
  bounds: [50, 80, 700, 380]
  title: Cash Flow Waterfall
  data:
    cols: [phase, amount, total]
    rows:
      - [Opening balance, 500, true]
      - [Sales revenue, 300, null]
      - [Operating expenses, -180, null]
      - [Taxes, -60, null]
      - [Closing balance, 560, true]
  series:
    - type: waterfall
      encode: {x: phase, y: amount, isTotal: total}
      totalBars: {fill: "#5470c6"}
      increaseBars: {fill: "#91cc75"}
      decreaseBars: {fill: "#ee6666"}
      dataLabels: {show: true}
```

**Heatmap**

```yaml
- elementId: c10
  elementType: chart
  bounds: [50, 80, 700, 420]
  title: User Activity Heatmap
  data:
    cols: [hour, day, count]
    rows:
      - ["00:00", Mon, 5]
      - ["00:00", Tue, 8]
      - ["06:00", Mon, 22]
      - ["12:00", Mon, 45]
  series:
    - type: heatmap
      encode: {x: hour, y: day, value: count}
      colorScheme: ["#ffffff", "#5470c6"]
      colorScale: {domain: [0, 50]}
```

**Treemap (with hierarchy)**

```yaml
- elementId: c11
  elementType: chart
  bounds: [50, 80, 700, 420]
  title: Budget Allocation
  data:
    cols: [dept, parentDept, budget]
    rows:
      - [Engineering, null, 1000]
      - [Frontend, Engineering, 400]
      - [Backend, Engineering, 600]
      - [Sales, null, 800]
  series:
    - type: treemap
      encode: {category: dept, value: budget, parent: parentDept}
      fill: ["#5470c6", "#91cc75"]
```

**Sankey diagram**

```yaml
- elementId: c13
  elementType: chart
  bounds: [50, 80, 800, 420]
  title: User Conversion Funnel
  data:
    cols: [from, to, users]
    rows:
      - [Ad campaign, Landing page, 10000]
      - [Ad campaign, Direct search, 4000]
      - [Landing page, Sign-up, 3000]
      - [Landing page, Drop-off, 7000]
      - [Sign-up, First order, 1200]
      - [Direct search, First order, 2000]
  series:
    - type: sankey
      encode: {source: from, target: to, flow: users}
      nodeAlign: justify
      fill: ["#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de"]
```

**seriesDefaults + mixing: bar default width + line default smoothing**

```yaml
- elementId: c15
  elementType: chart
  bounds: [50, 80, 700, 420]
  data:
    cols: [month, sales, growth]
    rows:
      - [Jan, 120, 0.10]
      - [Feb, 150, 0.25]
      - [Mar, 180, 0.20]
  yAxis:
    - {title: Sales}
    - {title: Growth rate, label: {numberFormat: "0%"}}
  seriesDefaults:
    bar:
      fill: "#5470c6"
    line:
      smooth: true
      width: 2
      lineColor: "#ee6666"
  barWidth: 0.6
  series:
    - type: bar
      encode: {x: month, y: sales}
      name: Sales
    - type: line
      encode: {x: month, y: growth}
      name: Growth rate
      yAxisIndex: 1
```

**Horizontal bar chart (category axis on the y side)**

```yaml
- elementId: c16
  elementType: chart
  bounds: [50, 80, 600, 360]
  title: Headcount by Department
  data:
    cols: [dept, headcount]
    rows:
      - [Engineering, 120]
      - [Product, 45]
      - [Design, 30]
      - [Operations, 60]
  xAxis: {label: {numberFormat: "#,##0"}}
  yAxis: {label: {fontSize: 12}}
  series:
    - type: bar
      encode: {x: headcount, y: dept}
      fill: "$primary"
      dataLabels: {show: true}
```

---

## 6. Animations

The optional `animations` array can be used to orchestrate animations for elements on the current page. `animations` is a page-level field and references elements in the page's `elements` array through `elementId`. Array order determines the sequence relationships among animations, while `trigger` determines when each animation starts.

```ts
type AnimationEffect =
  | "appear" | "fade-in" | "fly-in" | "zoom-in" | "wipe-in" | "float-in" | "peek-in" | "rise-in"
  | "pulse" | "grow-shrink" | "spin" | "teeter" | "fill-color" | "transparency" | "color-pulse"
  | "disappear" | "fade-out" | "fly-out" | "zoom-out" | "wipe-out" | "float-out"
  | "motion-path";

type AnimationTrigger = "onClick" | "withPrevious" | "afterPrevious";
type AnimationDirection = "up" | "down" | "left" | "right";
type AnimationEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out";

interface Animation {
  elementId: string;                 // required; must reference an existing element on this page
  effect: AnimationEffect;           // required; animation effect
  trigger?: AnimationTrigger;        // default: "onClick"
  direction?: AnimationDirection;    // default: "up"; only used by fly/wipe/peek/float effects
  durationMs?: number;               // default: the default duration of the corresponding effect; constraint: > 0
  delayMs?: number;                  // default: 0; constraint: >= 0
  easing?: AnimationEasing;          // default: "linear"
  repeat?: number;                   // default: 1; constraint: positive integer
  path?: string;                     // required when using motion-path
  color?: string;                    // required for fill-color / color-pulse; 6-digit HEX, with optional #
  amount?: number;                   // required for transparency; target opacity; constraint: [0, 1]
}
```

**Example:**

```yaml
elements:
  - elementId: title
    elementType: text
    bounds: [60, 40, 600, 60]
    content: {fontSize: 40, text: Title}
  - elementId: photo
    elementType: image
    bounds: [60, 140, 400, 300]
    src: media/pic.png
animations:
  - elementId: title
    effect: fade-in
    trigger: onClick
  - elementId: photo
    effect: fly-in
    direction: up
    trigger: withPrevious
  - elementId: photo
    effect: pulse
    trigger: afterPrevious
```

### Effects

- Entrance: `appear` appears immediately, `fade-in` fades in, `fly-in` flies in, `zoom-in` zooms in, `wipe-in` wipes in, `float-in` fades in with a short drift (about 10% of the page height and gentler than `fly-in`), `peek-in` slides out from behind the element's own edge mask without fading in, and `rise-in` rises linearly from below the page without fading in
- Emphasis: `pulse` pulses (scales to 110% and rebounds), `grow-shrink` scales to 150%, `spin` rotates 360°, `teeter` rocks from side to side, `fill-color` changes the fill color and preserves the result, `transparency` changes the opacity and preserves the result, and `color-pulse` changes the fill color and then restores the original color
- Exit: `disappear` disappears immediately, `fade-out` fades out, `fly-out` flies out, `zoom-out` zooms out, `wipe-out` wipes out, and `float-out` fades out with a short drift
- Path: `motion-path` moves along a path

| Effect | Default duration |
|---|---|
| `fade-in`, `fade-out`, `fly-in`, `fly-out`, `zoom-in`, `zoom-out`, `wipe-in`, `wipe-out`, `float-in`, `float-out`, `peek-in` | 500ms |
| `pulse` | 600ms |
| `grow-shrink`, `spin`, `fill-color`, `transparency`, `color-pulse` | 2000ms |
| `teeter`, `rise-in` | 1000ms |
| `motion-path` | 2000ms |
| `appear`, `disappear` | Instantaneous; ignores `durationMs` |

### Parameterized Emphasis Effects

| Effect | Parameter | Visual behavior |
|---|---|---|
| `fill-color` | `color`, required | Transitions the fill from its current color to `color` and preserves the target color after the animation ends |
| `transparency` | `amount`, required | Transitions opacity from its current value to `amount` and preserves the target opacity after the animation ends; `0` is fully transparent and `1` is fully opaque |
| `color-pulse` | `color`, required | Transitions the fill color to `color`, then restores the original color without preserving the intermediate state |

```yaml
animations:
  # Highlight a process step: change the fill to amber and preserve it
  - elementId: step-2
    effect: fill-color
    color: "#F59E0B"
    trigger: onClick

  # Dim a secondary element: reduce its opacity to 30%
  - elementId: bg-decoration
    effect: transparency
    amount: 0.3
    trigger: withPrevious

  # Emphasize the current card: pulse red once, then restore the original color
  - elementId: card-current
    effect: color-pulse
    color: "#EF4444"
    trigger: afterPrevious

  # Bring body text in gently
  - elementId: body-text
    effect: float-in
    direction: up
    easing: ease-out
```

### Triggers and Groups

- `onClick` starts a new click group and plays on click
- `withPrevious` starts at the same time as the preceding animation
- `afterPrevious` starts automatically after the preceding animation ends
- If the first animation on a page uses `withPrevious` or `afterPrevious`, the group beginning with it plays automatically when the page is entered
- To make multiple elements enter together after a click, set the first animation to `onClick` and the rest to `withPrevious`
- Use `afterPrevious` for animations that should play sequentially

### direction

`direction` indicates the travel direction or wipe progression direction. For entrance effects, `up` means entering upward from below the page; for exit effects, `up` means leaving the page upward. This field only affects fly/wipe/peek/float effects and is ignored by other effects. Float effects support only `up` and `down`; `rise-in` does not use this field and always rises from below the page.

### motion-path

`path` is an SVG path string. Path coordinates are offsets relative to the element's current position, measured in page px. The path must start with `M 0 0`, contain only one subpath, and may use `L` (line), `Q` / `C` (curves), and `Z` (close). For example, `M 0 0 L 200 -100` moves the element 200px to the right and 100px upward.

The same element may define multiple animations in array order. Keep each page to 1–3 animation groups when possible, prefer simple effects such as fade, fly, and zoom, and avoid applying multiple emphasis effects to the same element in succession.
