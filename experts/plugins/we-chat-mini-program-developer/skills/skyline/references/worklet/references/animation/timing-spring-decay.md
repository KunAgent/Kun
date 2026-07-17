# 基础动画类型

worklet 动画系统提供三种基础动画类型，都返回 `AnimationObject`，可直接赋值给 `SharedValue`。

## timing — 基于时间的动画

### 签名

```
AnimationObject worklet.timing(number toValue, Object options, function callback)
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| toValue | number | 是 | 目标值 |
| options | Object | 否 | 动画配置 |
| callback | function | 否 | 完成回调（取消返回 false，完成返回 true） |

### options 配置

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| duration | number | 300 | 动画时长（毫秒） |
| easing | function | `Easing.inOut(Easing.quad)` | 动画曲线，参考 Easing 模块 |

### 示例

```html
<view id="moved-box"></view>
<view id="btn" bind:tap="tap">点击驱动小球移动</view>
```

```js
const { shared, timing, Easing } = wx.worklet
Page({
  onLoad() {
    const offset = shared(0)
    this.applyAnimatedStyle('#moved-box', () => {
      'worklet'
      return {
        transform: `translateX(${offset.value}px)`
      }
    })
    this._offset = offset
  },
  tap() {
    this._offset.value = timing(300, {
      duration: 500,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1)
    })
  }
})
```

---

## spring — 基于物理的弹簧动画

### 签名

```
AnimationObject worklet.spring(number|string toValue, Object options, function callback)
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| toValue | number \| string | 是 | 目标值 |
| options | Object | 否 | 动画配置 |
| callback | function | 否 | 完成回调 |

### options 配置

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| damping | number | 10 | 阻尼系数 |
| mass | number | 1 | 重量系数，值越大移动越慢 |
| stiffness | number | 100 | 弹性系数 |
| overshootClamping | boolean | false | 动画是否可以在指定值上反弹 |
| restDisplacementThreshold | number | 0.01 | 弹簧静止时的位移 |
| restSpeedThreshold | number | 2 | 弹簧静止的速度 |
| velocity | number | 0 | 初速度 |

### 示例：手势松开回弹

```html
<pan-gesture-handler onGestureEvent="handlepan">
  <view class="circle"></view>
</pan-gesture-handler>
```

```js
const { shared, spring } = wx.worklet
Page({
  onLoad() {
    const offset = shared(0)
    this.applyAnimatedStyle('.circle', () => {
      'worklet'
      return {
        transform: `translateX(${offset.value}px)`
      }
    })
    this._offset = offset
  },
  handlepan(evt) {
    'worklet'
    if (evt.state === GestureState.ACTIVE) {
      this._offset.value += evt.deltaX
    } else if (evt.state === GestureState.END) {
      this._offset.value = spring(0)
    }
  }
})
```

### 调参建议

| 效果 | damping | stiffness | mass |
|------|---------|-----------|------|
| 轻快弹跳 | 5 | 200 | 0.5 |
| 默认弹簧 | 10 | 100 | 1 |
| 厚重缓慢 | 20 | 50 | 2 |
| 紧绷无弹跳 | 20 | 200 | 1 |

---

## decay — 基于滚动衰减的动画

### 签名

```
AnimationObject worklet.decay(Object options, function callback)
```

> 注意：decay 不需要 `toValue` 参数，目标值由初速度和衰减速率决定。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| options | Object | 否 | 动画配置 |
| callback | function | 否 | 完成回调 |

### options 配置

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| velocity | number | 0 | 初速度 |
| deceleration | number | 0.998 | 衰减速率（0-1 之间，越大衰减越慢） |
| clamp | Array | [] | 边界值，长度为 2 的数组 `[min, max]` |

### 示例：手势松开惯性滑动

```html
<pan-gesture-handler onGestureEvent="handlepan">
  <view class="circle"></view>
</pan-gesture-handler>
```

```js
const { shared, decay } = wx.worklet
Page({
  onLoad() {
    this._offset = shared(0)
    this.applyAnimatedStyle('.circle', () => {
      'worklet'
      return {
        transform: `translateX(${this._offset.value}px)`
      }
    })
  },
  handlepan(evt) {
    'worklet'
    if (evt.state === GestureState.ACTIVE) {
      this._offset.value += evt.deltaX
    } else if (evt.state === GestureState.END) {
      this._offset.value = decay(
        {
          velocity: evt.velocityX,
          clamp: [-200, 200]
        },
        () => {
          'worklet'
          console.info('decay finish')
        }
      )
    }
  }
})
```

---

## 动画回调

三种动画类型都支持 `callback` 回调参数（worklet 函数）：

```js
offset.value = timing(100, { duration: 300 }, (finished) => {
  'worklet'
  if (finished) {
    console.log('动画正常完成')
  } else {
    console.log('动画被取消')
  }
})
```

- `finished === true`：动画正常完成
- `finished === false`：动画被 `cancelAnimation` 或新动画中断

## 三种动画对比

| 特性 | timing | spring | decay |
|------|--------|--------|-------|
| 需要 toValue | ✅ | ✅ | ❌ |
| 持续时间 | 固定（duration） | 由物理参数决定 | 由初速度和衰减决定 |
| 可自定义曲线 | ✅（Easing） | ❌（物理模拟） | ❌（指数衰减） |
| 典型场景 | 平滑过渡 | 弹性回弹 | 惯性滑动 |
| 可设边界 | ❌ | ❌ | ✅（clamp） |
