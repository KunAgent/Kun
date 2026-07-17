# 组合动画

worklet 动画系统提供三种组合动画方式，可对基础动画（timing/spring/decay）进行编排。

## sequence — 序列动画

依次执行传入的动画。

### 签名

```
AnimationObject worklet.sequence(AnimationObject ...animationN)
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| animationN | AnimationObject | 一个或多个动画对象（可变参数） |

### 返回值

`AnimationObject`，可直接赋值给 SharedValue。

### 示例

```js
const { shared, sequence, timing, spring } = wx.worklet

const offset = shared(0)

// 先 timing 到 100，再 spring 回到 0
offset.value = sequence(timing(100), spring(0))

// 多段序列
offset.value = sequence(
  timing(100, { duration: 200 }),
  timing(200, { duration: 300 }),
  spring(0)
)
```

---

## repeat — 重复动画

重复执行动画。

### 签名

```
AnimationObject worklet.repeat(
  AnimationObject animation,
  number numberOfReps,
  boolean reverse,
  function callback
)
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| animation | AnimationObject | 是 | 要重复的动画 |
| numberOfReps | number | 是 | 重复次数。**负值时一直循环**，直到被取消 |
| reverse | boolean | 否 | 反向运行，每周期结束动画由尾到头运行。仅对 timing 和 spring 生效 |
| callback | function | 否 | 完成回调（worklet 函数） |

### 返回值

`AnimationObject`，可直接赋值给 SharedValue。

### 示例

```js
const { shared, repeat, timing } = wx.worklet

const offset = shared(0)

// 重复 2 次，带反向
offset.value = repeat(timing(70), 2, true)

// 无限循环
offset.value = repeat(timing(100, { duration: 500 }), -1, true)

// 带完成回调
offset.value = repeat(timing(70), 3, true, (finished) => {
  'worklet'
  if (finished) {
    console.log('所有重复完成')
  }
})
```

### 停止无限循环

```js
const { cancelAnimation } = wx.worklet

// 取消动画即可停止无限循环
cancelAnimation(offset)
```

---

## delay — 延迟动画

延迟执行动画。

### 签名

```
AnimationObject worklet.delay(number delayMS, AnimationObject delayedAnimation)
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| delayMS | number | 是 | 等待时间（毫秒） |
| delayedAnimation | AnimationObject | 是 | 要延迟执行的动画 |

### 返回值

`AnimationObject`，可直接赋值给 SharedValue。

### 示例

```js
const { shared, delay, timing } = wx.worklet

const offset = shared(0)

// 延迟 1 秒后执行动画
offset.value = delay(1000, timing(70))
```

---

## 组合使用示例

### 先延迟，再序列执行，然后重复

```js
const { shared, delay, sequence, repeat, timing, spring } = wx.worklet

const offset = shared(0)

// 延迟 500ms → timing 到 100 → spring 回 0
offset.value = delay(500, sequence(
  timing(100, { duration: 200 }),
  spring(0)
))

// 无限循环的脉动效果
offset.value = repeat(
  sequence(
    timing(1, { duration: 500 }),
    timing(0, { duration: 500 })
  ),
  -1,
  false
)
```

### 交错动画（多个元素）

```js
Page({
  onLoad() {
    const items = [this._offset1, this._offset2, this._offset3]
    items.forEach((offset, i) => {
      // 每个元素间隔 100ms
      offset.value = delay(i * 100, timing(100, { duration: 300 }))
    })
  }
})
```
