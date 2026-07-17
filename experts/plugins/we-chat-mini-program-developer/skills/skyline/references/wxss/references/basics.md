# WXSS 基础数据类型

本文档定义 Skyline WXSS 支持的基础数据类型。

> 标注说明：
> - ⚠️ **不支持** = 设置后不生效
> - ⛔ **不可用** = 该属性不支持

---

## `<length>`
```bnf
<length> = <number> <length-unit> | <percentage> | auto | <calc()> | <env()>
<length-unit> = px | rpx | vw | vh | vmin | vmax | rem | em
<percentage> = <number>%

<calc()> = calc( <calc-sum> )
<calc-sum> = <calc-product> [ [ '+' | '-' ] <calc-product> ]*
<calc-product> = <calc-value> [ [ '*' | '/' ] <calc-value> ]*
<calc-value> = <number> | <length> | ( <calc-sum> )

<env()> = env( <custom-ident> [ , <length> ]? )
```
支持的 env() 变量：`safe-area-inset-top`, `safe-area-inset-right`, `safe-area-inset-bottom`, `safe-area-inset-left`

> ⚠️ `calc()` 仅支持长度类型计算，**不支持角度类型**。

## `<number>`
```bnf
<number> = <integer> | <decimal>
<integer> = ['+' | '-']? <digit>+
<decimal> = <integer> '.' <digit>+
```

## `<image>`
```bnf
<image> = <url> | <gradient> | none
<url> = url( <string> )
<gradient> = <linear-gradient> | <radial-gradient> | <conic-gradient>
```
> 渐变语法详见 `visual.md`。

## `<color>`
```bnf
<color> = <named-color> | <hex-color> | rgb() | rgba() | hsl() | hsla() | hwb() | currentColor
<hex-color> = '#' <hex-digit>{3,4,6,8}
```

## `<angle>` / `<time>`
```bnf
<angle> = <number> [ deg | grad | rad | turn ]
<time> = <number> [ s | ms ]
```

---

## 语法符号说明

| 符号 | 含义 |
|------|------|
| `=` | 定义 |
| `\|` | 互斥选择 |
| `\|\|` | 可任意组合 |
| `&&` | 必须全部出现（顺序可变） |
| `?` | 可选 |
| `+` | 至少 1 次 |
| `{n,m}` | n 到 m 次 |
| `#` | 逗号分隔列表 |

---

*本文档基于 Skyline 官方文档与实际测试生成。*
