# TextOverflow 文本溢出

文本溢出组件，当文字单行/多行溢出时显示省略号，鼠标移入时通过 tooltip 显示完整内容。

## 基础用法

### 基础示例

通过 `content` 属性传入文本内容，`maxWidth` 设置最大宽度。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-text-overflow maxWidth="210px" :content="content"></hr-text-overflow>
    </div>
  </div>
</template>
<script setup>
import { ref } from "vue"
const content = ref('文字单行/多行溢出时省略，鼠标移入时可用tooltip显示完整数据的文本显示组件。')
</script>
```

### 多行省略

通过 `lines` 属性设置文字最多显示几行。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">默认单行</span>
      <hr-text-overflow :content="content" maxWidth="100px"></hr-text-overflow>
    </div>
    <div class="block">
      <span class="demonstration">两行</span>
      <hr-text-overflow :content="content" maxWidth="100px" :lines="2"></hr-text-overflow>
    </div>
    <div class="block">
      <span class="demonstration">三行</span>
      <hr-text-overflow :content="content" maxWidth="100px" :lines="3"></hr-text-overflow>
    </div>
  </div>
</template>
<script setup>
  import { ref } from 'vue';
  const content = ref('文字单行/多行溢出时省略，鼠标移入时可用tooltip显示完整数据的文本显示组件。');
</script>
```

### 插槽用法

支持默认插槽和 tooltip 的 content 插槽。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">不使用插槽</span>
      <hr-text-overflow :content="content" maxWidth="100px"></hr-text-overflow>
    </div>
    <div class="block">
      <span class="demonstration">默认插槽</span>
      <hr-text-overflow :content="content" maxWidth="100px">
        <h3>文字单行/多行溢出时省略，鼠标移入时可用tooltip显示完整数据的文本显示组件。</h3>
      </hr-text-overflow>
    </div>
    <div class="block">
      <span class="demonstration">tooltip提示框content插槽</span>
      <hr-text-overflow maxWidth="100px">
        文字单行/多行溢出时省略，鼠标移入时可用tooltip显示完整数据的文本显示组件。
        <template #content>
          <h3>文字单行/多行溢出时省略，鼠标移入时可用tooltip显示完整数据的文本显示组件。</h3>
        </template>
      </hr-text-overflow>
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const content = ref('文字单行/多行溢出时省略，鼠标移入时可用tooltip显示完整数据的文本显示组件。');
</script>
```

## API

### Props

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| lines | 文字最多显示几行 | Number | - | 1 |
| content | 文本内容 | String/slot | - | - |
| maxWidth | 文本最大宽度 | String | - | 100% |

> t-tooltip 可透传属性详情请见：[t-tooltip组件文档](https://tdesign.tencent.com/vue-next/components/tooltip?tab=api)

### Slots

| 插槽名 | 说明 |
| --- | --- |
| default | 自定义显示的文本内容 |
| content | 自定义 tooltip 提示框的内容 |
