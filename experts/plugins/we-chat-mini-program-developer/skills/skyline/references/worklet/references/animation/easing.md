# Easing 缓动函数

`Easing` 模块实现了常见的动画缓动函数，可从 `wx.worklet` 对象中读取。动画效果参考：https://easings.net/

```js
const { Easing, timing } = wx.worklet

// 使用 Easing 配合 timing
offset.value = timing(100, {
  duration: 300,
  easing: Easing.ease
})
```

## 预置动画函数

### Easing.bounce

简单的反弹效果。

```js
Easing.bounce(t)
```

### Easing.ease

简单的惯性动画。

```js
Easing.ease(t)
```

### Easing.elastic

简单的弹性动画，类似弹簧来回摆动，**高阶函数**。默认弹性为 1，会稍微超出一次。弹性为 0 时不会过冲。

```js
Easing.elastic(bounciness = 1)
```

## 标准缓动函数

### Easing.linear

线性函数，`f(t) = t`

```js
Easing.linear(t)
```

### Easing.quad

二次方函数，`f(t) = t * t`

```js
Easing.quad(t)
```

### Easing.cubic

立方函数，`f(t) = t * t * t`

```js
Easing.cubic(t)
```

### Easing.poly

高阶函数，返回幂函数。

```js
Easing.poly(n)
```

- `poly(4)` → 四次方（easeInQuart）
- `poly(5)` → 五次方（easeInQuint）

## 其它数学函数

### Easing.bezier

三次贝塞尔曲线，效果同 CSS `transition-timing-function`。调试参数可借助可视化工具：https://cubic-bezier.com/

```js
Easing.bezier(x1, y1, x2, y2)

// 等价于 CSS cubic-bezier(0.25, 0.1, 0.25, 1)
Easing.bezier(0.25, 0.1, 0.25, 1)
```

### Easing.circle

圆形曲线。

```js
Easing.circle(t)
```

### Easing.sin

正弦函数。

```js
Easing.sin(t)
```

### Easing.exp

指数函数。

```js
Easing.exp(t)
```

## 缓动方式

以上效果均有三种缓动方式，都是**高阶函数**：

### Easing.in(easing)

正向运行缓动函数。

```js
Easing.in(Easing.sin)  // 等价于直接使用 Easing.sin
```

### Easing.out(easing)

反向运行缓动函数。

```js
Easing.out(Easing.sin)
```

### Easing.inOut(easing)

前半程正向，后半程反向。

```js
Easing.inOut(Easing.sin)
```

### 缓动方式示例（以 sin 为例）

| 方式 | 代码 | 效果 |
|------|------|------|
| 正向（默认） | `Easing.in(Easing.sin)` | easeInSine |
| 反向 | `Easing.out(Easing.sin)` | easeOutSine |
| 正反 | `Easing.inOut(Easing.sin)` | easeInOutSine |

## 完整函数速查表

| 函数 | 类型 | 参数 | 说明 |
|------|------|------|------|
| `linear(t)` | 直接调用 | t: number | 线性 |
| `quad(t)` | 直接调用 | t: number | 二次方 |
| `cubic(t)` | 直接调用 | t: number | 三次方 |
| `poly(n)` | 高阶函数 | n: number | n 次方 |
| `sin(t)` | 直接调用 | t: number | 正弦 |
| `circle(t)` | 直接调用 | t: number | 圆形 |
| `exp(t)` | 直接调用 | t: number | 指数 |
| `bounce(t)` | 直接调用 | t: number | 反弹 |
| `ease(t)` | 直接调用 | t: number | 惯性 |
| `elastic(b)` | 高阶函数 | b: number (默认1) | 弹性 |
| `bezier(x1,y1,x2,y2)` | 高阶函数 | 四个控制点 | 贝塞尔曲线 |
| `in(easing)` | 高阶函数 | easing: function | 正向缓动 |
| `out(easing)` | 高阶函数 | easing: function | 反向缓动 |
| `inOut(easing)` | 高阶函数 | easing: function | 正反缓动 |

## 常用组合

```js
const { Easing } = wx.worklet

// timing 默认曲线
Easing.inOut(Easing.quad)

// 平滑加减速
Easing.inOut(Easing.cubic)

// 自定义贝塞尔
Easing.bezier(0.25, 0.1, 0.25, 1)

// 弹性效果
Easing.out(Easing.elastic(1))

// 反弹效果
Easing.out(Easing.bounce)
```
