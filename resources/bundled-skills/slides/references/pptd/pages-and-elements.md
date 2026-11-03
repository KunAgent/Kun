[Back to PPTD format index](format.md)

## 3. Main Entry File (.pptd)

### Presentation

```ts
interface Presentation {
  version: "v2";                // required, fixed to "v2" (version identifier)
  title?: string;              // default: no title
  customFonts?: CustomFont[];  // default: no custom fonts are loaded
  size: [number, number];      // [width, height]; see "Coordinate System and Units" for PPT and poster recommendations
  theme?: Theme;
  pages: string[];             // list of relative paths to page files, e.g. "pages/cover.page"
}
```

**Example:**

```yaml
version: v2
title: Annual Work Summary
size: [960, 540]
customFonts:
  - family: Noto Serif SC
    src: "https://fonts.googleapis.com/css2?family=Noto+Serif+SC"
theme:
  colors:
    primary: "#2563EB"
    accent: "#F59E0B"
    text: "#1F2937"
  textStyles:
    title:
      fontSize: 40
      color: "$primary"
    body:
      fontSize: 18
      color: "$text"
      lineHeight: 1.6
  tableStyles:
    default:
      firstRowStyle:
        fill: {type: solid, color: "$primary"}
        color: "#ffffff"
        bold: true
      bodyStyles:
        - {fill: {type: solid, color: "#f8fafc"}}
        - {fill: {type: solid, color: "#ffffff"}}
pages:
  - pages/1_cover.page
  - pages/2_content.page
```

### Theme

The theme centrally manages colors, text styles, and table styles. Use `$<key>` in relevant fields to reference the theme:

| Theme type | Referencing field | Example |
|---|---|---|
| `colors` | Any [Color](#color) field | `$primary` |
| `textStyles` | [TextContent.style](#textcontent) / [Cell.textStyle](#cell) | `$title` |
| `tableStyles` | [Table.style](#table-table) | `$default` |

```ts
interface Theme {
  colors?: Record<string, Color>;
  textStyles?: Record<string, TextStyleConfig>;
  tableStyles?: Record<string, TableStyleConfig>;
}
```

#### TextStyleConfig

```ts
interface TextStyleConfig {
  color?: Color;
  fontSize?: number;
  fontFamily?: FontFamily;
  bold?: boolean;                    // bold
  italic?: boolean;                  // italic
  backgroundColor?: Color;           // text background color (e.g., text highlight)
  lineHeight?: number;               // line-height multiple
  lineHeightPx?: number;             // fixed line height (px); when it conflicts with lineHeight, lineHeightPx prevails
  letterSpacing?: number;
  marginTop?: number;
}
```

> Unset fields fall back along the inheritance chain (see [Style Priority and Default Values](#style-priority-and-default-values) for details)

#### CellStyle

```ts
interface CellStyle extends TextStyleConfig {
  // —— Inherits all properties of TextStyleConfig ——
  //   color / fontSize / fontFamily / bold / italic / backgroundColor / lineHeight / lineHeightPx / letterSpacing / marginTop

  // —— CellStyle-specific ——
  fill?: Fill;                              // background fill
  border?: BorderSpec;                      // border
  align?: Alignment;                        // text alignment
}
```

> Unset fields fall back along the inheritance chain (see [Style Priority and Default Values](#style-priority-and-default-values) for details)

#### TableStyleConfig

```ts
interface TableStyleConfig {
  // —— Cell style: applied to every cell ——
  cellStyle?: CellStyle;

  // —— Row category overrides ——
  firstRowStyle?: CellStyle;  // first-row style
  lastRowStyle?: CellStyle;  // last-row style

  // —— Column category overrides ——
  firstColumnStyle?: CellStyle;
  lastColumnStyle?: CellStyle;

  // —— Alternating row styles ——
  bodyStyles?: CellStyle[];  // data rows other than the first/last row apply these cyclically by data-row index

  // —— Cross-category rule ——
  rowOverColumn?: boolean;            // default: true; whether the row style wins when a cell is covered by both row and column rules
}
```
> **Row/column style rules**: category styles such as `firstRowStyle` / `lastRowStyle` / `firstColumnStyle` / `lastColumnStyle` mean **apply the style independently to every matching cell**, not apply the style to the first row/last column as a whole
> - Writing `firstRowStyle.border: {style: solid, width: 2}` → **every cell of the first row** gets a border on all four sides
> - To add an outer frame to the first row as a whole, use per-side BorderSpec: `border: [<top line>, null, <bottom line>, null]`, then set borders separately on the first-column and last-column cells of the first row


> For fallback rules, see [Style Priority and Default Values](#style-priority-and-default-values)

### CustomFont

```ts
interface CustomFont {
  family: string;  // font family name for use in fontFamily fields
  src: string;     // Google Fonts CSS URL; format: https://fonts.googleapis.com/css2?family=Noto+Serif+SC; only the default weight is supported — weight selection is not supported
}
```

---

## 4. Page Files (.page)

### Page

```ts
interface Page {
  pageType?: "cover" | "table_of_contents" | "chapter" | "content" | "final" | string;  // default: none; category label (does not affect rendering); preset values are recognized as the corresponding page type, arbitrary custom strings are also allowed
  background?: Fill;               // default: {type: solid, color: "#FFFFFF"} (white solid fill)
  notes?: string;                  // default: none; speaker notes; plain text
  elements: Element[];             // the later an element, the higher its layer
  animations?: Animation[];        // default: none; orchestrated in array order; see [Animations](#6-animations)
}
```

**Example:**

```yaml
pageType: cover
background:
  type: solid
  color: "$primary"
notes: Speaker notes
elements:
  - elementId: title1
    elementType: text
    bounds: [100, 200, 760, 80]
    content:
      style: "$title"
      align: [center, middle]
      text: Hello World
```

---

## 5. Elements

### ElementBase

Common properties of all elements.

```ts
interface ElementBase {
  elementId: string;                                                      // constraint: unique within the same page; unique element ID
  elementType: "text" | "shape" | "line" | "image" | "icon" | "table" | "chart";  // element type
  bounds: [number, number, number, number];                               // element size and position, [x, y, width, height]
}

type Element = Text | Shape | Line | Image | Icon | Table | Chart;
```

---

### Text (text box)

```ts
interface Text extends ElementBase {
  elementType: "text";
  rotation?: number;                  // default: 0; degrees, clockwise rotation
  opacity?: number;                   // default: 1; constraint: [0, 1]
  flip?: [boolean, boolean];          // default: [false, false]; [horizontal flip, vertical flip]
  content: TextContent;
}
```

#### TextContent

```ts
interface TextContent {
  text: string;                                // rich text string (block scalar)
  style?: string;                              // references theme.textStyles, written as "$key" (e.g. "$title")

  // —— Style fields (when unset, fall back along the inheritance chain) ——
  color?: Color;
  fontSize?: number;
  fontFamily?: FontFamily;
  bold?: boolean;                              // bold: true=on, false/unset=off
  italic?: boolean;                            // italic: true=on, false/unset=off
  backgroundColor?: Color;                     // text background color (e.g., text highlight)
  lineHeight?: number;                         // line-height multiple
  lineHeightPx?: number;                       // fixed line height (px)
  letterSpacing?: number;
  marginTop?: number;

  // —— Layout fields ——
  textDirection?: "horizontal" | "vertical";   // default: "horizontal"
  wrap?: boolean;                              // default: true; when false, no wrapping, and the part beyond bounds.width overflows the element boundary; explicitly setting false is recommended for single-line text
  align?: Alignment;                           // default: ["left", "top"]

  // —— Visual decoration (unset = not applied) ——
  gradient?: GradientFill;                     // text gradient (applied to the text itself)
  shadow?: Shadow;                             // text shadow
}
```

**Examples:**

```yaml
# Basic: theme style + plain text
- elementId: title-1
  elementType: text
  bounds: [100, 50, 760, 80]
  content:
    style: "$title"
    align: [center, middle]
    text: Annual Work Summary

# Rich text + inline property overrides
- elementId: body-1
  elementType: text
  bounds: [100, 200, 600, 200]
  content:
    fontSize: 20
    color: "$text"
    lineHeight: 1.6
    align: [left, top]
    text: |
      <p><strong>Key achievement</strong>: completed <span style="color:$primary;">3</span> key projects</p>
      <p style="text-align:right"><span style="font-size:14px; color:#6b7280;">—— FY2024</span></p>

# Text gradient + shadow
- elementId: hero-text
  elementType: text
  bounds: [100, 100, 760, 120]
  content:
    align: [center, middle]
    gradient:
      type: gradient
      gradientType: linear
      angle: 90
      stops:
        - {position: 0, color: "$primary"}
        - {position: 1, color: "$accent"}
    shadow:
      blur: 6
      color: "#00000040"
      offset: [0, 3]
    text: |
      <p><span style="font-size:64px;">FUTURE</span></p>
```

#### Rich Text Rules

`TextContent.text` and `Cell.text` follow the rich text rules below for paragraph splitting and for setting paragraph or inline styles.

**Supported tags**

| Tag | Description | Example |
|------|------|------|
| `<p>` | Paragraph; may carry paragraph styles | `<p>paragraph</p>` |
| `<span>` | Inline style; use this tag to set inline styles | `<span style="color:#f00">red</span>` |
| `<strong>` | Bold | `<strong>important</strong>` |
| `<em>` | Italic | `<em>emphasis</em>` |
| `<u>` | Underline | `<u>underline</u>` |
| `<s>` | Strikethrough | `<s>deleted</s>` |
| `<sup>` | Superscript | `E=mc<sup>2</sup>` |
| `<sub>` | Subscript | `H<sub>2</sub>O` |
| `<a>` | Hyperlink; supports `https://`, `http://`, `mailto:`; once set, the hyperlink text style (blue with underline) is applied automatically | `<a href="https://x.com">link</a>` |
| `<ul>` | Unordered list | `<ul><li>item</li></ul>` |
| `<ol>` | Ordered list | `<ol><li>first item</li></ol>` |
| `<li>` | List item; must be used together with `<ul>` or `<ol>` | — |

**style attribute mapping**

`<p>`, `<li>`, and `<span>` may use `style="..."`. Color-type values may all use theme references (e.g. `$primary`), resolved per the [Color](#color) rules.

1. **Paragraph styles (only `<p>` supports them)**

| Property | Description | Values | Example |
| --- | --- | --- | --- |
| `text-align` | Paragraph horizontal alignment | `left` / `center` / `right` / `justify` / `distributed` | `<p style="text-align:center">…</p>` |
| `line-height` | Line height; **unitless** is treated as a `lineHeight` multiple, **with `px`** as a `lineHeightPx` fixed value | number (e.g. `1.5`) or px string (e.g. `24px`) | `<p style="line-height:1.6">…</p>` |
| `margin-top` | Spacing before the paragraph | px string (e.g. `8px`) | `<p style="margin-top:8px">…</p>` |
| `margin-left` | Left margin | px string (e.g. `12px`) | `<p style="margin-left:12px">…</p>` |
| `margin-right` | Right margin | px string (e.g. `12px`) | `<p style="margin-right:12px">…</p>` |

> Do not set `letter-spacing` on `<p>`; to set letter spacing uniformly, use `content.letterSpacing` or `Cell.letterSpacing`.

2. **List-item styles (only `<li>` supports them)**

| Property | Description |
| --- | --- |
| `text-align` | List-item horizontal alignment |
| `line-height` | Line height; value rules same as `<p>` |
| `letter-spacing` | Letter spacing |
| `margin-top` | Spacing before the paragraph |
| `margin-left` | Left margin |
| `list-style` | List style shorthand |
| `list-style-type` | List marker type |
| `list-style-position` | List marker position |
| `list-style-image` | List marker image |

3. **Inline styles (only `<span>` supports them)**

Styles apply only to the text inside that `<span>`.

| Property | Description | Values | Example |
| --- | --- | --- | --- |
| `color` | Text color | [Color](#color) (HEX6 / HEX8 / theme reference) | `<span style="color:$primary">…</span>` |
| `font-size` | Font size | px string (e.g. `24px`) | `<span style="font-size:24px">…</span>` |
| `font-family` | Font family | Font name (e.g. `Arial`, `"Arial, 微软雅黑"`) | `<span style="font-family:Arial">…</span>` |
| `background-color` | Text background color | [Color](#color) (HEX6 / HEX8 / theme reference) | `<span style="background-color:$accent">…</span>` |


```yaml
content:
  align: [left, top]
  lineHeight: 1.2
  text: |
    <p><span style="font-size:32px; color:$primary;">Main Title</span><span style="font-size:18px; color:$secondary;">Subtitle</span></p>
    <p style="text-align:center; line-height:1.8">This paragraph is center-aligned with 1.8x line height</p>
    <p style="text-align:right">This paragraph is right-aligned; line height inherits the default 1.2</p>
```
**Plain-text shorthand**

`content.text` may use plain text directly:
- Single line: `text: "Hello"` ≡ `text: "<p>Hello</p>"`
- Multi-line (block scalar):
  ```yaml
  text: |
    First line
    Second line
  ```
  ≡ `<p>First line</p><p>Second line</p>`
- `<br/>` may be used for a line break within a paragraph, but it is not guaranteed to be preserved on re-conversion after editing. When stable line breaks are needed, use multiple `<p>`.

**LaTeX formulas**

Rich text supports embedding LaTeX formulas with the `\(...\)` delimiters:
- May form their own paragraph, or be mixed with other text inside a `<p>`.
- Rich text tags are **not allowed** inside a formula.
- A formula **only inherits** the `color` and `font-size` styles from its context; other text styles are not passed through.
- A `<p>` tag can wrap a LaTeX formula to control the alignment

```yaml
content:
  text: |
    <p>Pythagorean theorem: \(a^2 + b^2 = c^2\)</p>
    <p>\(\int_0^1 x^2 \mathrm{d}x = \frac{1}{3}\)</p>
```

---

### Shape (shape)

```ts
interface Shape extends ElementBase {
  elementType: "shape";
  rotation?: number;                  // default: 0; degrees, clockwise rotation
  opacity?: number;                   // default: 1; constraint: [0, 1]
  flip?: [boolean, boolean];          // default: [false, false]; [horizontal flip, vertical flip]
  shapeName: string;                  // see ./shapes.md
  adjustments?: number[];             // see ./shapes.md; geometry parameters; default: the default parameter values
  viewBox?: [number, number];         // view box; used only when shapeName="custom", required in that case
  path?: string;                      // SVG shape path; used only when shapeName="custom", required in that case
  fill?: Fill;                        // default: not applied
  border?: Border;                    // default: not applied
  shadow?: Shadow;                    // default: not applied
}
```

> Custom shapes: you may specify `shapeName: "custom"` and use `viewBox` and `path` to define a custom shape; these two parameters have no effect when `shapeName` is not `custom`

> The `adjustments` parameters: reuse the parameter order and quantity defined by OOXML; see ./shapes.md for value constraints.

> **Note**: `shape` does not support embedded text! Add an extra text box to achieve that.

**custom path conventions:**
- `viewBox`: view box, the path coordinate system `[w, h]`
- `path`: SVG path string, supporting the `M / L / H / V / C / S / Q / A / Z` commands.
- Multi-segment paths are supported for shapes such as hollow-outs: make the outer contour **clockwise** (`sweep=1`) and the inner contour **counterclockwise** (`sweep=0`) to achieve a hollow cutout
- **Scaling and aspect ratio**: changing `bounds` resizes the shape (the path needs no rewriting); but the viewBox is stretched independently to bounds — when the ratios differ, the shape distorts. To keep the ratio, require `viewBoxW : viewBoxH = bounds.w : bounds.h`.

**Common shapes**

> See [shapes.md](../shapes.md) for the full 177 shapes.

| shapeName | Description | adjustments default values |
|-----------|------|-------------------|
| `rect` | Rectangle | — |
| `roundRect` | Rounded rectangle | `[16667]` (corner radius) |
| `ellipse` | Ellipse | — |
| `triangle` | Triangle | `[50000]` (horizontal position of apex) |
| `diamond` | Diamond | — |
| `homePlate` | Five-sided arrow | `[50000]` |
| `chevron` | V-shaped arrow | `[50000]` |
| `donut` | Ring | `[25000]` (ring width ratio) |
| `star5` | 5-point star | `[19098, 105146, 110557]` |
| `rightArrow` | Right arrow | `[50000, 50000]` (shaft width, arrowhead length) |
| `wedgeRectCallout` | Rectangle callout | `[-20833, 62500]` |
| `bracePair` | Brace pair | `[8333]` |

**Examples:**

```yaml
# Built-in shape
- elementId: shape-1
  elementType: shape
  bounds: [200, 200, 300, 150]
  shapeName: roundRect
  adjustments: [20000]
  fill: {type: solid, color: "$primary"}
  border: {style: solid, width: 2, color: "$accent"}

# Custom hollow ring (outer contour clockwise + inner contour counterclockwise)
- elementId: shape-2
  elementType: shape
  bounds: [400, 200, 150, 150]
  shapeName: custom
  viewBox: [1000, 1000]
  path: "M500,0 A500,500 0 1 1 499,0 Z M500,200 A300,300 0 1 0 499,200 Z"
  fill: {type: solid, color: "$accent"}
```

---

### Line (line)

```ts
type ArrowType = "arrow" | "stealth" | "diamond" | "oval";

interface Line extends ElementBase {
  elementType: "line";
  rotation?: number;                             // default: 0; degrees, clockwise rotation
  opacity?: number;                              // default: 1; constraint: [0, 1]
  flip?: [boolean, boolean];                     // default: [false, false]; [horizontal flip, vertical flip]
  viewBox: [number, number];                     // path coordinate system [w, h]; points live in this coordinate system, so changing bounds does not require changing points
  points: string;                                // bezier path points "x1,y1 x2,y2 ..."; the first/last points are the start/end the curve passes through, the middle points are control points
  curve?: "sharp" | "round" | "smooth";          // default: "round"; sharp joins / rounded joins / bezier smooth curve
  arrow?: [ArrowType | null, ArrowType | null];  // start arrow, end arrow; default: [null, null] (no arrows at either end)
  border?: Border;                               // default: not applied
  shadow?: Shadow;                               // default: not applied
}
```

> **Constraint:** `points` needs at least 2 points; the first point and the last point are points the curve passes through, the rest are bezier control points; all coordinates must be within `viewBox`.
> **viewBox vs bounds:** at render time, the viewBox is stretched independently to the bounds size; to keep the line from being stretched out of shape, require `viewBoxW : viewBoxH = bounds.w : bounds.h`.

**Examples:**

```yaml
# Normalized coordinates: from top-left to bottom-right, the two middle points are control points
- elementId: l4
  elementType: line
  bounds: [100, 100, 500, 300]
  viewBox: [1, 1]
  points: "0,0 0.2,0 0.8,1 1,1"
  curve: smooth
  border: {style: solid, width: 2, color: "$primary"}

# Bezier arc: passes through the start and end points; the two middle points control the bend direction
- elementId: bezier-arc
  elementType: line
  bounds: [50, 200, 860, 100]
  viewBox: [360, 100]
  points: "0,80 120,0 240,100 360,20"
  curve: smooth
  border: {style: solid, width: 2, color: "$primary"}
```

---

### Image (image)

```ts
interface Image extends ElementBase {
  elementType: "image";
  rotation?: number;                 // default: 0; degrees, clockwise rotation
  opacity?: number;                  // default: 1; constraint: [0, 1]
  flip?: [boolean, boolean];         // default: [false, false]; [horizontal flip, vertical flip]
  src: string;                       // URL or local relative path
  cropShape?: ShapeDef;              // default: rectangle (i.e., no shape cropping)
  fit?: ImageFit;                    // default: {mode: "cover"}
  crop?: ImageCrop;                  // always applied; see the rendering order with fit/cropShape below
  border?: Border;                   // default: not applied
  shadow?: Shadow;                   // default: not applied
}

interface ShapeDef {
  shapeName: string;                 // see ./shapes.md; use "custom" for a custom path
  adjustments?: number[];            // default: use the shape's built-in defaults (see ./shapes.md)
  viewBox?: [number, number];        // used only when shapeName="custom", required in that case
  path?: string;                     // used only when shapeName="custom", required in that case
}
```

> `ShapeDef` fields correspond one-to-one with the shape fields of the [Shape](#shape-shape) element; for detailed conventions (adjustments values and angle conversion, custom path rules, hollow rules, common shape table), see the [Shape](#shape-shape) section.

**Rendering logic:** `crop` (proportionally adjust the source rectangle to get a sub-image: positive values crop inward, negative values expand outward and pad with transparent pixels) → `fit` (adapt the sub-image to the bounds container per mode) → `cropShape` (clip the final display area to the shape outline). All three can be set independently and are applied in the fixed order above.

- `fit.mode="cover"`: scale the sub-image proportionally to fill bounds; the overflow is cropped.
- `fit.mode="contain"`: scale the sub-image proportionally to display it completely; the shortfall is left blank.
- `fit.mode="fill"`: **the sub-image is stretched directly to fill bounds** — although no cropped blank edges are visible in this case, the picture content is still only the sub-region after crop, not the full original image.

**Examples:**

```yaml
- elementId: img-1
  elementType: image
  bounds: [50, 50, 400, 300]
  src: "media/cover.jpg"
  cropShape: {shapeName: roundRect, adjustments: [15000]}
  fit: {mode: cover}
  crop: {top: 0.1, bottom: 0.1, left: 0.05, right: 0.05}   # crop the surrounding proportions first, then apply cover fitting
  shadow:
    blur: 10
    color: "#00000033"
    offset: [0, 4]

# Custom clip outline
- elementId: img-2
  elementType: image
  bounds: [200, 200, 200, 200]
  src: "media/avatar.jpg"
  cropShape:
    shapeName: custom
    viewBox: [1000, 1000]
    path: "M500,0 A500,500 0 1 1 499,0 Z"
  fit: {mode: cover}
```

---

### Icon (icon)

```ts
interface Icon extends ElementBase {
  elementType: "icon";
  rotation?: number;                 // default: 0; degrees, clockwise rotation
  opacity?: number;                  // default: 1; constraint: [0, 1]
  flip?: [boolean, boolean];         // default: [false, false]; [horizontal flip, vertical flip]
  iconName: string;                  // format "style:name"
  fill?: Fill;                       // default: black solid fill
  border?: Border;                   // default: not applied
  shadow?: Shadow;                   // default: not applied
}
```

**iconName format:** `style:name`, using the Font Awesome 7.x free icon library.

| Prefix | Style | Example |
|------|------|------|
| `fas` | Solid (most common) | `fas:house` |
| `far` | Regular | `far:heart` |
| `fab` | Brands | `fab:github` |

Icon search: https://fontawesome.com/search?ic=free-collection

**Example:**

```yaml
- elementId: icon-1
  elementType: icon
  bounds: [100, 100, 48, 48]
  iconName: "fas:lightbulb"
  fill: {type: solid, color: "$primary"}
```

---

### Table (table)

```ts
interface Table extends ElementBase {
  elementType: "table";
  columnWidths: number[];              // array of column-width ratios (not px; relative to the bounds width)
  rowHeights: number[];                // array of row-height ratios (not px; relative to the bounds height)
  rows: Cell[][];                      // 2-D array; merged regions are declared with rowSpan/colSpan, occupied positions are skipped in the array
  style?: string | TableStyleConfig;   // references theme.tableStyles, written as "$key" (e.g. "$default"), or an inline TableStyleConfig object
  fill?: Fill;                         // default: not applied; table-level fill (applied to the whole table, can be overridden by cell fill)
  shadow?: Shadow;                     // default: not applied
}
```

> **PowerPoint limitation:** native tables cannot be rotated/flipped as a whole; whole-table global opacity including text and borders is also not supported. When whole rotation/flip/opacity is needed, render as an image first and treat it as an [Image](#image-image) element.

> **Constraint:** each item of `columnWidths` and `rowHeights` is within `[0, 1]`, and the elements of each sum to 1.

#### Cell

```ts
interface Cell {
  // —— Content ——
  text?: string;             // default: empty cell; rich text string (written as a block scalar), rules same as TextContent.text
  textStyle?: string;        // references theme.textStyles, written as "$key" (e.g. "$body")

  // —— Text styles (when unset, fall back along the inheritance chain) ——
  color?: Color;
  fontSize?: number;
  fontFamily?: FontFamily;
  bold?: boolean;
  italic?: boolean;
  backgroundColor?: Color;             // text background color (e.g., text highlight)
  lineHeight?: number;                 // line-height multiple
  lineHeightPx?: number;               // fixed line height (px)
  letterSpacing?: number;
  marginTop?: number;

  // —— Cell styles (when unset, fall back along the inheritance chain) ——
  fill?: Fill;                         // background fill; supports solid / gradient / image
  border?: BorderSpec;
  align?: Alignment;

  // —— Merging ——
  rowSpan?: number;                    // default: 1
  colSpan?: number;                    // default: 1
}
```

**Basic example (using theme styles):**

```yaml
- elementId: table-basic
  elementType: table
  bounds: [80, 120, 800, 280]
  columnWidths: [0.3, 0.35, 0.35]
  rowHeights: [0.33, 0.33, 0.34]
  style: "$default"
  rows:
    - - text: "Metric"
      - text: "2023"
      - text: "2024"
    - - text: "Revenue (100M CNY)"
      - text: "82.5"
      - text: "96.3"
    - - text: "Net profit (100M CNY)"
      - text: "12.1"
      - text: "15.8"
```

> **Merged-cell rules:** `rowSpan` / `colSpan` declare the merge range; **cells covered by the merged region are omitted from the `rows` array, with no `null` placeholder needed**. For example, after a top-left 2×2 merge, row 0's colSpan=2 covers (0,1), so that row only has two items ((0,0) merged cell + (0,2)); row 1 has (1,0) and (1,1) occupied by the merge, so it only has one item, (1,2).

```yaml
- elementId: table-merged
  elementType: table
  bounds: [100, 100, 600, 400]
  columnWidths: [0.33, 0.33, 0.34]
  rowHeights: [0.33, 0.33, 0.34]
  rows:
    # Row 0: top-left 2×2 merge + C1. The merged (0,1) is omitted
    - - text: "Merged cell"
        fill: {type: solid, color: "$accent"}
        rowSpan: 2
        colSpan: 2
      - text: "C1"
    # Row 1: (1,0) and (1,1) are occupied by the merge → only C2 remains
    - - text: "C2"
    # Row 2: full three columns
    - - text: "A3"
      - text: "B3"
      - text: "C3"
```

---
