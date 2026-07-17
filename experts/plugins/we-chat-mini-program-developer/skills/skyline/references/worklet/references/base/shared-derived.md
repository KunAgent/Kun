# SharedValue 与 DerivedValue

## SharedValue

### worklet.shared(initialValue)

创建共享变量 `SharedValue`，用于跨线程共享数据和驱动动画。

**签名**：`SharedValue worklet.shared(any initialValue)`

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| initialValue | `number \| string \| bool \| null \| undefined \| Object \| Array \| Function` | 初始值，可通过 `.value` 属性读写 |

**返回值**：`SharedValue` 类型值，可被 worklet 函数捕获。

### 基本用法

```js
const { shared } = wx.worklet

// 创建共享变量
const offset = shared(0)

// 读取值
console.log(offset.value) // 0

// 修改值
offset.value = 100
```

### 在 worklet 函数中使用

```js
const offset = wx.worklet.shared(0)
const someWorkletFn = () => {
  'worklet'
  console.log('offset: ', offset.value)
}
```

### 跨线程同步

SharedValue 最重要的能力是**跨线程同步数据**。普通变量被 worklet 函数捕获后会被序列化拷贝，后续修改无法同步。SharedValue 则可以：

```js
const { shared, runOnUI } = wx.worklet

const offset = shared(0)
function someWorklet() {
  'worklet'
  console.log(offset.value) // 输出新值 1
}
offset.value = 1
runOnUI(someWorklet)()
```

### 驱动动画

SharedValue 可驱动节点样式变化，配合 `applyAnimatedStyle` 使用：

```js
Page({
  onLoad() {
    const offset = wx.worklet.shared(0)
    this.applyAnimatedStyle('#box', () => {
      'worklet'
      return {
        transform: `translateX(${offset.value}px)`
      }
    })
    this._offset = offset
  },
  tap() {
    this._offset.value = 200  // 直接赋值
    // 或使用动画
    this._offset.value = wx.worklet.timing(200)
  }
})
```

## DerivedValue

### worklet.derived(updaterWorklet)

基于已有 SharedValue 生成衍生共享变量，类比 `computed` 计算属性。

**签名**：`DerivedValue worklet.derived(WorkletFunction updaterWorklet)`

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| updaterWorklet | `WorkletFunction` | worklet 函数，被立即执行，返回值作为初始值。当捕获的 SharedValue 变化时自动重新执行 |

**返回值**：`DerivedValue` 类型值（也是 SharedValue 类型），可被 worklet 函数捕获。

### 基本用法

```js
const { shared, derived } = wx.worklet

const progress = shared(0)
const offset = derived(() => {
  'worklet'
  return progress.value * 255
})

// progress.value 变化时，offset 自动更新
progress.value = 0.5
// offset.value 自动变为 127.5
```

### 多 SharedValue 依赖

DerivedValue 可依赖多个 SharedValue，任一变化都会触发重新计算：

```js
const { shared, derived } = wx.worklet

const x = shared(0)
const y = shared(0)
const distance = derived(() => {
  'worklet'
  return Math.sqrt(x.value * x.value + y.value * y.value)
})
```

## cancelAnimation

### worklet.cancelAnimation(sharedValue)

取消由 SharedValue 驱动的动画。

**签名**：`worklet.cancelAnimation(SharedValue sharedValue)`

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| sharedValue | `SharedValue` | 需要取消动画的共享变量 |

### 用法示例

```js
const { shared, timing, cancelAnimation } = wx.worklet

const offset = shared(0)

// 启动动画
offset.value = timing(100)

// 取消动画（offset 停留在当前值）
cancelAnimation(offset)
```

### 常见场景：手势中断动画

```js
handlepan(evt) {
  'worklet'
  if (evt.state === GestureState.BEGAN) {
    // 手指按下时取消正在进行的动画
    cancelAnimation(this._offset)
  } else if (evt.state === GestureState.ACTIVE) {
    this._offset.value += evt.deltaX
  } else if (evt.state === GestureState.END) {
    // 手指松开时启动弹簧动画
    this._offset.value = spring(0)
  }
}
```
