# WXSS Flex 布局属性

本文档定义 Skyline WXSS 支持的 Flex 布局属性。

> ✅ 以下 Flex 属性的所有值**完全支持**（除特别标注外）。

---

## 容器属性

### flex-direction / flex-wrap
```bnf
flex-direction = row | row-reverse | column | column-reverse
flex-wrap = nowrap | wrap | wrap-reverse
```
flex-direction 默认值：`column`（`rendererOptions.skyline.defaultDisplayBlock: true` 时为 `row`）

### align-items / align-self / align-content / justify-content
```bnf
align-items = stretch | center | flex-start | flex-end | baseline
            | normal | start | end | self-start | self-end
align-self = auto | stretch | center | flex-start | flex-end | baseline
           | start | end | self-start | self-end | normal
align-content = stretch | center | flex-start | flex-end
              | space-between | space-around | space-evenly
              | normal | start | end | baseline
justify-content = center | flex-start | flex-end
                | space-between | space-around | space-evenly
                | start | end | left | right | baseline | stretch
```
align-items 默认值：`stretch`（`rendererOptions.skyline.defaultDisplayBlock: true` 时为 `normal`）
align-content 默认值：`normal`

---

## 项目属性

### flex / flex-grow / flex-shrink / flex-basis / order
```bnf
flex = none | auto | [ <flex-grow> <flex-shrink>? || <flex-basis> ]
flex-grow = <number>          /* 默认 0 */
flex-shrink = <number>        /* 默认 1 */
flex-basis = <length>         /* 默认 auto */
order = <integer>             /* 默认 0 */
```

---

## 不可用属性

### justify-items ⛔
```bnf
justify-items = stretch | center | flex-start | flex-end | start | end | self-start | self-end | left | right
```
> ⛔ 不可用

---

*本文档基于 Skyline 官方文档与实际测试生成。*
