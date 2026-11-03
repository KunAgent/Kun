[Back to PPTD format index](format.md)

## 1. Global Conventions

### Syntax
- Uses **YAML 1.2** syntax
- For special characters such as `:`, `#`, `{`, `}`, the value must be wrapped in quotes or written with a block scalar instead
- For fields with many special characters such as `content.text`, a block scalar (`|`) should be used as its own block, to prevent content like `style="..."` from being parsed incorrectly

### Coordinate System and Units
- All geometry and size units are **px**; the origin `(0, 0)` is the top-left corner of the page
- Default presentation sizes: 16:9 → `[960, 540]`; 4:3 → `[720, 540]`. Default poster sizes: 16:9 → `[1280, 720]`; 9:16 → `[720, 1280]`; 4:3 → `[1280, 960]`; 3:4 → `[960, 1280]`; 1:1 → `[1080, 1080]`
- This specification defines 1px = 1pt (i.e., `fontSize: 18` is 18pt in PPTX)
- Element stacking order is determined by the order of the `Page.elements` array; the later an element, the higher its layer

### Style Priority and Default Values

For property values that conflict, the first source with a value is found by searching the following priorities from top to bottom; when none of the levels is set, fall back to the default values at the end of that section.

> The following rule applies to all subsections of this section: `lineHeight` (a multiple) and `lineHeightPx` (fixed px) are mutually exclusive; when both are set, `lineHeightPx` takes precedence.

#### 1. Text Styles Inside a Text Box

**Priority chain:**
1. Rich-text semantic tags such as `<u>`, `<sup>`, `<strong>` in [Text.content.text](#textcontent)
2. Inline properties set in `<span style="...">`
3. Paragraph properties set in `<p style="...">`
4. **Style fields set directly on [Text.content](#textcontent)** (distinct from the theme style referenced by `style`; including `color`, `fontSize`, `fontFamily`, `bold`, `italic`, `backgroundColor`, `lineHeight`, `lineHeightPx`, `letterSpacing`, `marginTop`)
5. The [TextStyleConfig](#textstyleconfig) theme style referenced by [Text.content.style](#textcontent)
6. Default values:

| Property | Default value |
|---|---|
| color | `#000000` |
| backgroundColor | Not applied |
| fontSize | `18` |
| fontFamily | `"MiSans"` |
| bold | `false` |
| italic | `false` |
| lineHeight | `1` |
| lineHeightPx | Not applied |
| letterSpacing | `0` |
| marginTop | `0` |

#### 2. Table Cell Styles

**Priority chain:**
1. Rich-text semantic tags such as `<u>`, `<sup>`, `<strong>` in [Cell.text](#cell)
2. Inline properties set in `<span style="...">`
3. Paragraph properties set in `<p style="...">`
4. [Cell](#cell) inline fields
5. The [TextStyleConfig](#textstyleconfig) referenced by [Cell.textStyle](#cell) (**applies only to text fields**; does not include `fill` / `border` / `align`)
6. Position-category styles of [TableStyleConfig](#tablestyleconfig)
   - On row vs column conflicts, [TableStyleConfig.rowOverColumn](#tablestyleconfig) decides the winner; default `true` = row wins
   - Row categories: `TableStyleConfig.firstRowStyle` / `TableStyleConfig.lastRowStyle`
   - Column categories: `TableStyleConfig.firstColumnStyle` / `TableStyleConfig.lastColumnStyle`
7. [TableStyleConfig.bodyStyles](#tablestyleconfig): applies to data rows other than the first and last rows, cycled by data-row index
8. [TableStyleConfig.cellStyle](#tablestyleconfig): the baseline cell style for the whole table
9. Default values

| Property | Default value |
|---|---|
| color | `#000000` |
| backgroundColor | Not applied |
| fontSize | Auto-adapts based on cell height |
| fontFamily | `"MiSans"` |
| bold | `false` |
| italic | `false` |
| lineHeight | `1` |
| lineHeightPx | Not applied |
| letterSpacing | `0` |
| marginTop | `0` |
| fill | Not applied (transparent) |
| border | `{style: solid, width: 1, color: "#000000"}` |
| align | `["center", "middle"]` |

#### 3. Chart Styles

Charts involve multiple kinds of styles (series body colors, fonts, data labels, axis/legend visibility, etc.), each with its own independent priority chain, explained below.

**3.1 Series body color priority chain:**
1. A series' explicit `fill` / `lineColor` / `areaColor` (field names differ per type; see [Color Mechanism](#52-color-mechanism))
2. The same-named field for the corresponding type in [Chart.seriesDefaults](#seriesdefaults)
3. The [Theme.colors](#theme) theme color cycle (colors are picked in the order the series appear in the array)

> [scatter](#scatter) is an exception: marker color resolves as `marker.fill > series.fill > theme color cycle`; marker.border likewise takes precedence over series.border.
>
> For each type's specific color fields, derivation rules, and role mappings, see [§5.2 Color Mechanism](#52-color-mechanism).

**3.2 Font priority chain:**
1. Sub-component `fontFamily` ([TitleConfig](#titleconfig) / [LegendConfig](#legendconfig) / [DataLabelConfig](#datalabelconfig) / [AxisConfig.label](#axisconfig) / [SpokeAxisConfig.label](#spokeaxisconfig))
2. [Chart.fontFamily](#chart)
3. Theme default ([Theme](#theme) or the PPTX master font)

**3.3 dataLabels priority chain:**
1. `series[i].dataLabels`
2. [Chart.dataLabels](#chart) (global default)
3. Not shown (equivalent to `show: false`)

> Sub-fields follow a **one-level shallow merge**: `series.dataLabels` only overrides the sub-fields it explicitly provides; unprovided ones fall back from [Chart.dataLabels](#chart); if neither provides them, the per-type default applies (see [dataLabels.content value quick reference](#55-datalabelscontent-value-quick-reference)).

**3.4 `seriesDefaults` merge rules:**

[Chart.seriesDefaults](#seriesdefaults)`[type]` provides common defaults for all series of that type, merged with each series via a **one-level deep merge**:
- **Scalar fields** (string / number / boolean): the series' explicit value overrides defaults
- **Object fields** (`marker` / `dataLabels` / `border` / `upBars` / `downBars` / `totalBars` / gradient `fill` objects, etc.): recursive one-level shallow merge — same-named fields of defaults and series are spread respectively, with sub-fields overridden by the nearest source
- **Array fields** (`fill: []` / `colorScheme: []`): the series replaces defaults as a whole, with no element-level merging
- `type` and `encode` are not allowed inside seriesDefaults
- Only multi-series types support seriesDefaults: `bar / line / area / scatter / bubble / candlestick / radar`

Counterintuitive example:
```yaml
seriesDefaults:
  bar: {marker: {shape: circle, size: 8}}
series:
  - type: bar
    marker: {size: 12}     # after merge: {shape: circle, size: 12}, not {size: 12}
```

**3.5 `boolean | Config` field convention:**

Fields of the form `boolean | XxxConfig` (`marker` / `legend` / `AxisConfig.label / axisLine / gridLine` / `SpokeAxisConfig.label / axisLine / gridLine` / `colorbar`) uniformly follow:
- `false` = off
- `true` = on with default configuration
- Object `{...}` = on + custom configuration

> **The only exception**: [scatter.marker](#scatter) cannot be `false` (a scatter plot without a marker has nothing to render).

---

### Multi-File Structure
A PPTD project consists of a main entry file and individual page files:
```
project/
  slides_name.pptd     # main entry (size/theme/title + page reference list)
  media/               # media resources such as images and videos
  pages/               # page file directory
    1_cover.page       # one .page file per page
    2_intro.page
```
**Path rules:**
1. **Fully self-contained**: all referenced files must be located inside the folder containing the `.pptd` file; **referencing files outside the directory is not allowed**
2. **Only relative paths are supported** (relative to the directory containing the `.pptd` file):
   - The `pages` list in `.pptd`: `pages/1_cover.page`
   - Image paths in `.page`: `media/image1.jpg`
3. **Media supports URLs**: `Image.src`, and the [ImageFill](#fill).src of `background` / `fill`, may be `https://...` (only jpg/jpeg/png/gif supported)

**Main entry is required:** everything must be loaded through the `.pptd` main entry file; a `.page` cannot be passed alone to the `convert`/`check` commands

---

## 2. Shared Types
The following types are reused in multiple places and are defined together up front. Element sections reference them by type name without repeating the expansion

### Color
```ts
type Color = string;
```
> Supports opaque **HEX6** (`#RRGGBB`), alpha **HEX8** (`#RRGGBBAA`), and [Theme.colors](#theme) theme color references (e.g. `$primary`)

### FontFamily
```ts
type FontFamily = string | { latin: string; ea: string };
```
| Form | Example | Description |
|------|------|------|
| String | `"MiSans"` | Chinese and English use the same font uniformly |
| Object | `{latin: "Arial", ea: "MiSans"}` | Explicitly specify Latin (latin) and East Asian (ea) fonts separately |

See [fonts.md](../fonts.md) for the list of available fonts

### Alignment
```ts
type HorizontalAlign = "left" | "center" | "right" | "justify" | "distributed";
type VerticalAlign   = "top"  | "middle" | "bottom";
type Alignment       = [HorizontalAlign, VerticalAlign];
```
| Value | Description |
|----|------|
| `left` / `center` / `right` | Horizontal left / center / right alignment |
| `justify` | Justified (last line not stretched) |
| `distributed` | Distributed (last line stretched) |
| `top` / `middle` / `bottom` | Vertical top / middle / bottom alignment |

### LineStyle
```ts
type LineStyle = "solid" | "dash" | "dot";
```

### Border
```ts
interface Border {
  style?: LineStyle;  // default: "solid"
  width?: number;     // default: 1
  color?: Color;      // default: "#000000"
}
```

#### BorderSpec
[Cell](#cell) and [CellStyle](#cellstyle) support an array form of `Border` to set the four side borders separately

```ts
type BorderSpec = null
                | Border
                | [Border | null, Border | null]
                | [Border | null, Border | null, Border | null, Border | null];
```

| Form | Meaning |
|------|------|
| `null` | Explicit clear: no border on any of the four sides (used to override a border set higher up the inheritance chain)|
| `Border` | Same on all four sides |
| Two-element array `[Border\|null, Border\|null]` | `[top-bottom, left-right]` |
| Four-element array `[Border\|null, Border\|null, Border\|null, Border\|null]` | `[top, right, bottom, left]` (clockwise) |

> A `null` inside the array means no border at the corresponding position; a top-level `null` clears everything.

### Shadow

```ts
interface Shadow {
  blur: number;                // blur radius
  color: Color;
  offset?: [number, number];   // default: [0, 0]; [x, y] offset
}
```

### ColorStop

```ts
interface ColorStop {
  position: number;  // constraint: [0, 1]
  color: Color;
}
```

### ImageFit / ImageCrop

```ts
interface ImageFit {
  mode: "fill" | "contain" | "cover";
}

interface ImageCrop {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}
```

> **Constraint:** the four fields of `ImageCrop` are analogous, default 0. A positive value crops inward from the corresponding edge proportionally (inset); a negative value expands outward toward the corresponding edge proportionally and pads with transparent pixels (outset). Must ensure `left + right < 1` and `top + bottom < 1`, otherwise the source rectangle degenerates.

| ImageFit.mode | Description |
|---|---|
| `cover` | Fills the container, keeps aspect ratio, may crop |
| `contain` | Shows the image completely, keeps aspect ratio, may leave blank space |
| `fill` | Stretches to fill, may distort |

### Fill

```ts
type Fill = SolidFill | GradientFill | ImageFill;

interface SolidFill {
  type: "solid";
  color: Color;
}

interface GradientFill {
  type: "gradient";
  gradientType: "linear" | "radial";
  stops: ColorStop[];                // constraint: at least 2
  angle?: number;                    // default: 0; only effective for linear
}

interface ImageFill {
  type: "image";
  src: string;                       // URL or relative path
  fit?: ImageFit;                    // default: {mode: "cover"}
  crop?: ImageCrop;                  // always applied; see the rendering order with fit below
  opacity?: number;                  // default: 1; constraint: [0, 1]
}
```

> `GradientFill.angle` takes values in `[0, 360)`; `0` means left to right, increasing clockwise. Examples: `90` = top→bottom, `180` = right→left.

> **ImageFill rendering order:** `crop` (adjust the source rectangle proportionally: positive values crop inward, negative values expand outward and pad with transparent pixels) → `fit` (adapt to the fill container per mode). The specific semantics of each `fit.mode` value are consistent with the "rendering logic" discussion in the [Image](#image-image) section.

**Examples:**

```yaml
# Solid
fill:
  type: solid
  color: "$primary"

# Gradient
fill:
  type: gradient
  gradientType: linear
  angle: 90
  stops:
    - {position: 0, color: "$primary"}
    - {position: 1, color: "$accent"}

# Image
fill:
  type: image
  src: "media/bg.jpg"
  fit: {mode: cover}
  opacity: 0.9
```

---
