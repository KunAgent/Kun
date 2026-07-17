# WXSS 背景、边框与视觉效果

本文档定义 Skyline WXSS 支持的背景、边框、滤镜和遮罩属性。

> 标注说明：⚠️ 不支持 | ⛔ 不可用

---

## 背景属性

### background-color / background-image
```bnf
background-color = <color>
background-image = <bg-image>#
<bg-image> = none | <url> | <gradient>
```

### background-position / background-size
```bnf
background-position = <bg-position>#
background-size = <bg-size>#
<bg-size> = auto | cover | contain | <length>{1,2}
```

### background-repeat
```bnf
background-repeat = <repeat-style>#
<repeat-style> = repeat-x | repeat-y | [ repeat | no-repeat ]{1,2}
```

### background-attachment ⛔ / background-clip ⛔ / background-origin ⛔
> ⛔ 以上三个属性不可用
>
> ⚠️ **`background` 简写部分有效**：`background` 简写展开后，`background-attachment`/`background-origin`/`background-clip` 不生效，其余子属性（color/image/repeat/position/position-x/position-y/size）正常生效。

---

## 渐变语法

### linear-gradient
```bnf
<linear-gradient> = linear-gradient( [ <angle> | to <side-or-corner> , ]? <color-stop-list> )
<side-or-corner> = [ left | right ] || [ top | bottom ]
<color-stop-list> = <color-stop> [ , <color-stop> ]+
<color-stop> = <color> [ <length-percentage> [ <length-percentage> ]? ]?
```
> ⚠️ 颜色停止位置仅支持 `%` 和固定长度单位（px、rpx 等）

### radial-gradient
```bnf
<radial-gradient> = radial-gradient( circle [ <size> ]? [ at <position> ]? , <color-stop-list> )
<size> = closest-side | farthest-side | closest-corner | farthest-corner | <length>
```
> ⚠️ 限制：
> - 仅支持 `circle` 形状（不支持 `ellipse`）
> - 尺寸仅支持 `px` 单位
> - 颜色停止位置仅支持 `%` 单位

### conic-gradient
```bnf
<conic-gradient> = conic-gradient( [ from <angle> ]? [ at <position> ]? , <angular-color-stop-list> )
<angular-color-stop-list> = <angular-color-stop> [ , <angular-color-stop> ]+
<angular-color-stop> = <color> [ <angle-percentage> [ <angle-percentage> ]? ]?
<angle-percentage> = <angle> | <percentage>
```
> ✅ `conic-gradient` 完全支持，无额外限制。

### 背景/遮罩多值限制

> ⚠️ 多值数量限制：
> - `background-image` / `mask-image` 最多支持 **2 个值**
> - `background-position` 最多支持 **2 组值**
> - `background-repeat` 最多支持 **2 组值**
> - `background-size` 最多支持 **2 组值**

---

## 边框属性

### border-width / border-style / border-color
```bnf
border-width = <line-width>{1,4}
<line-width> = thin | medium | thick | <length>

border-style = <line-style>{1,4}
<line-style> = none | solid | dotted | dashed

border-color = <color>{1,4}
```
border-color 默认值：`currentColor`

### border-radius / box-shadow
```bnf
border-radius = <length>{1,4} [ / <length>{1,4} ]?
box-shadow = none | <shadow>#
<shadow> = inset? && <length>{2,4} && <color>?
```

---

## 滤镜属性

### filter / backdrop-filter
```bnf
filter = none | <filter-function>
backdrop-filter = none | <filter-function>

<filter-function> = blur() | brightness() | contrast() | grayscale()
    | hue-rotate() | invert() | opacity() | saturate() | sepia()
```
> ⚠️ 不支持多个 filter 函数组合
> ⚠️ 不支持：`url()`, `drop-shadow()`

---

## 遮罩属性

### mask-image / mask-size / mask-repeat / mask-position
```bnf
mask-image = <mask-image-value>#
<mask-image-value> = none | <url>  /* ⚠️ 渐变不支持，仅 url() 可用 */
mask-size = <bg-size>#             /* 默认 auto */
mask-repeat = <repeat-style>#      /* ⚠️ 非标准默认值: no-repeat（Web 标准默认 repeat） */
mask-position = <bg-position>#     /* ✅ 简写有效，自动展开为 x/y */
mask-position-x = <bg-position-value>#   /* 默认 center */
mask-position-y = <bg-position-value>#   /* 默认 center */
```
> ✅ `mask-position` 简写有效：会自动展开为 `mask-position-x` + `mask-position-y`。
> ⚠️ `mask-image` 最多支持 **2 个值**。

### mask-origin ⛔ / mask-clip ⛔ / mask-mode ⛔
> ⛔ 以上属性不可用
>
> ⚠️ **`mask` 简写部分有效**：`mask` 简写展开后，`mask-origin`/`mask-clip` 不生效，其余子属性（mask-image/repeat/position/position-x/position-y/size）正常生效。

---

*本文档基于 Skyline 官方文档与实际测试生成。*
