# CountdownButton 倒计时按钮

倒计时按钮组件，用于发送验证码等需要倒计时限制的场景。

## 基础用法

### 基础示例

默认倒计时10秒，也可以通过 `duration` 属性设置倒计时时间。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">默认倒计时10秒</span>
      <hr-countdown-button ref="button1" @click="buttonClick(1)"/>
    </div>
    <div class="block">
      <span class="demonstration">设置倒计时30秒</span>
      <hr-countdown-button ref="button2" :duration="30" @timeout="timeout" @click="buttonClick(2)"/>
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue'
const button1 = ref(null)
const button2 = ref(null)
// 重新倒计时
const buttonClick = (num) => {
  const refValue = num === 1 ? button1.value : button2.value
  refValue.startCountdown()
}
const timeout = () => {
  console.log('timeout');
};
</script>
```

### 透传 TButton 属性

组件支持透传所有 TButton 属性，如 `theme`、`variant`、`ghost` 等。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">描边按钮</span>
      <hr-countdown-button ref="button1" theme="primary" variant="outline" @click="buttonClick(1)"/>
    </div>
    <div class="block dark">
      <span class="demonstration">幽灵按钮</span>
      <hr-countdown-button ref="button2" variant="outline" theme="primary" ghost @click="buttonClick(2)"/>
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue'
const button1 = ref(null)
const button2 = ref(null)
// 重新倒计时
const buttonClick = (num) => {
  const refValue = num === 1 ? button1.value : button2.value
  refValue.startCountdown()
}
</script>
<style>
.dark{
  background: #000;
}
</style>
```

### 禁用状态

通过 `disableOnCountdown` 属性控制禁用时机：`true` 为倒计时期间禁用，`false` 为倒计时结束禁用。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">倒计时期间禁用</span>
      <hr-countdown-button ref="button1" @click="buttonClick(1)"/>
    </div>
    <div class="block">
      <span class="demonstration">倒计时结束禁用</span>
      <hr-countdown-button ref="button2" :disableOnCountdown="false" :duration="30" @timeout="timeout" @click="buttonClick(2)"/>
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue'
const button1 = ref(null)
const button2 = ref(null)
// 重新倒计时
const buttonClick = (num) => {
  const refValue = num === 1 ? button1.value : button2.value
  refValue.startCountdown()
}
const timeout = () => {
  console.log('timeout');
};
</script>
```

### 手动控制倒计时

设置 `autoCountdown` 为 `false` 可关闭自动倒计时，通过调用组件方法 `startCountdown()` 手动开始倒计时。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <t-button @click="startCountdown" theme="default" variant="base" style="margin-bottom: 20px;">手动触发开始计时</t-button>
      <hr-countdown-button ref="startBtn" :autoCountdown="false"/>
    </div>
    <div class="block">
      <t-button @click="resetCountdown" theme="default" variant="base" style="margin-bottom: 20px;">重新计时</t-button>
      <hr-countdown-button ref="resetBtn"/>
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const startBtn = ref(null);
const resetBtn = ref(null);
const startCountdown = () => {
  startBtn.value.startCountdown();
}
const resetCountdown = () => {
  resetBtn.value.startCountdown();
}
</script>
```

### 尺寸

通过 `size` 属性设置按钮尺寸。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">小</span>
      <hr-countdown-button size="small" ref="button1" @click="buttonClick(1)"/>
    </div>
    <div class="block">
      <span class="demonstration">中</span>
      <hr-countdown-button size="medium" ref="button2" @click="buttonClick(2)"/>
    </div>
    <div class="block">
      <span class="demonstration">大</span>
      <hr-countdown-button size="large" ref="button3" @click="buttonClick(3)"/>
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue'
const button1 = ref(null)
const button2 = ref(null)
const button3 = ref(null)
// 重新倒计时
const buttonClick = (num) => {
  const refValue = num === 1 ? button1.value : num === 2 ? button2.value :  button3.value 
  refValue.startCountdown()
}
</script>
```

### 自定义文案

通过 `countdownText` 和 `text` 属性或插槽自定义按钮文案。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">传参控制</span>
      <hr-countdown-button ref="button1" :countdownText="countdownText" :text="text" @click="buttonClick(1)"></hr-countdown-button>
    </div>
    <div class="block">
      <span class="demonstration">插槽控制</span>
      <hr-countdown-button ref="button2" :duration="180" @click="buttonClick(2)">
        <template #countdownText="{ duration }">
          {{ `这个是插槽控制倒计时文案，剩余${formatTime(duration)}` }}
        </template>
        <template #text>
          {{ text }}
        </template>
      </hr-countdown-button>
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue'
const countdownText = '这个是传参控制倒计时文案，剩余{duration}秒'
const text = '倒计时结束文案'
const button1 = ref(null)
const button2 = ref(null)
const formatTime = (time) => {
  const minutes = Math.floor(time / 60);
  const seconds = String(time % 60).padStart(2, '0');
  return `${minutes}分${seconds}秒`;
}
// 重新倒计时
const buttonClick = (num) => {
  const refValue = num === 1 ? button1.value : button2.value
  refValue.startCountdown()
}
</script>
```

## API

### Props

组件使用 TButton，默认透传所有 TButton 属性，参考 [TButton](https://tdesign.tencent.com/vue-next/components/button?tab=api)

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| countdownText | 倒计时期间文本，传入{duration}将会替换为倒计时剩余时间 | String/Slot | - | {duration}秒 |
| text | 倒计时结束时文本 | String/Slot | - | 继续 |
| duration | 倒计时时间，单位秒 | Number | - | 10 |
| autoCountdown | 自动倒计时 | Boolean | true/false | true |
| disableOnCountdown | true倒计时期间禁用按钮，false倒计时结束禁用按钮 | Boolean | true/false | true |
| size | 按钮尺寸 | String | large/medium/small | medium |
| onTimeout | 倒计时结束触发回调 | Function | - | - |
| onClick | 点击时触发 | Function | - | - |

### Events

| 事件名称 | 说明 | 回调参数 |
| --- | --- | --- |
| timeout | 倒计时结束触发 | - |
| click | 点击时触发 | - |

### Methods

| 方法名称 | 说明 | 参数 |
| --- | --- | --- |
| startCountdown | 开始/重置倒计时 | - |

### Slots

| 插槽名 | 说明 | 作用域参数 |
| --- | --- | --- |
| countdownText | 自定义倒计时期间文案 | { duration: number } |
| text | 自定义倒计时结束文案 | - |
