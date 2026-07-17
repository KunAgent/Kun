# WXSS 变换、过渡与动画

本文档定义 Skyline WXSS 支持的变换、过渡和动画属性。

> ✅ 以下属性**完全支持**。

---

## 变换属性

### transform
```bnf
transform = none | <transform-function>+

<transform-function> = matrix() | matrix3d()
    | translate() | translateX() | translateY() | translateZ() | translate3d()
    | scale() | scaleX() | scaleY() | scaleZ() | scale3d()
    | rotate() | rotateX() | rotateY() | rotateZ() | rotate3d()
    | skew() | skewX() | skewY()
    | perspective()
```

### transform-origin / opacity
```bnf
transform-origin = <length> && <length> && <length>?   /* 默认 50% 50% 0 */
opacity = <number>                                       /* 默认 1 */
```

---

## 过渡属性

### transition
```bnf
transition-property = none | <animatable-property>#    /* 默认 all */
transition-duration = <time>#              /* 默认 0s */
transition-timing-function = <timing-function>#    /* 默认 ease */
transition-delay = <time>#                 /* 默认 0s */

<animatable-property> = all | none
    | transform | transform-origin | opacity
    | width | height | min-width | max-width | min-height | max-height
    | margin | margin-top | margin-right | margin-bottom | margin-left
    | padding | padding-top | padding-right | padding-bottom | padding-left
    | top | right | bottom | left
    | flex | flex-grow | flex-shrink | flex-basis
    | border | border-width | border-color | border-radius
    | border-top-width | border-right-width | border-bottom-width | border-left-width
    | border-top-color | border-right-color | border-bottom-color | border-left-color
    | border-top-left-radius | border-top-right-radius | border-bottom-left-radius | border-bottom-right-radius
    | border-top | border-right | border-bottom | border-left
    | background-color | background-position | background-size | background
    | background-position-x | background-position-y
    | filter | backdrop-filter | box-shadow | z-index
    | text-decoration-color
    | mask | mask-size | mask-position | mask-position-x | mask-position-y
```
> ⚠️ 通过继承生效的属性不支持 transition/animation：`color`、`font-size`、`font-weight`、`line-height`、`letter-spacing`、`word-spacing` 等。

---

## 动画属性

### animation
```bnf
animation-name = [ none | <custom-ident> | <string> ]#
animation-duration = <time>#
animation-timing-function = <timing-function>#
animation-delay = <time>#
animation-iteration-count = [ infinite | <number> ]#
animation-direction = [ normal | reverse | alternate | alternate-reverse ]#
animation-fill-mode = [ forwards | both ]#
animation-play-state = [ running | paused ]#
```
> ⚠️ animation-fill-mode：`none` 和 `backwards` 虽可写但实际表现均为 `forwards`

### @keyframes
```bnf
@keyframes <animation-name> {
  <keyframe-selector># { <declaration-list> }
}
<keyframe-selector> = from | to | <percentage>
```

---

## 缓动函数

```bnf
<timing-function> = linear | ease | ease-in | ease-out | ease-in-out
    | steps( <integer> [ , start | end | jump-* ]? )
    | cubic-bezier( <number> , <number> , <number> , <number> )
```

---

## 优化属性

### will-change
```bnf
will-change = auto | contents
```
> ⚠️ 仅支持 `auto` 和 `contents`，不支持 `scroll-position` 和 `<custom-ident>`

---

*本文档基于 Skyline 官方文档与实际测试生成。*
