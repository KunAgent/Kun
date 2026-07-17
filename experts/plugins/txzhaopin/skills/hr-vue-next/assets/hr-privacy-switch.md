# PrivacySwitch 隐私开关

隐私开关组件，用于控制敏感信息的显示/隐藏状态。

## 基础用法

### 基础示例

```vue
<template>
  <hr-privacy-switch></hr-privacy-switch>
</template>
```

### 双向绑定

通过 `v-model` 控制隐私模式的开启状态。

```vue
<template>
  <t-space direction="vertical">
    <hr-privacy-switch v-model="visible"></hr-privacy-switch>
    <t-button @click="visible = !visible">切换</t-button>
  </t-space>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const visible = ref(true);
</script>
```

### 自定义文案

通过 `showText` 和 `hideText` 属性自定义显示/隐藏时的文案。

```vue
<template>
  <t-space direction="vertical">
    <hr-privacy-switch showText="看得见" hideText="看不见"></hr-privacy-switch>
    <hr-privacy-switch>
      <template #showText>
        <span>😐显示了</span>
      </template>
      <template #hideText>
        <span>😐隐藏了</span>
      </template>
    </hr-privacy-switch>
  </t-space>
</template>
```

### 仅图标模式

设置 `iconOnly` 为 `true` 时，只显示图标，不显示文案。

```vue
<template>
  <hr-privacy-switch iconOnly></hr-privacy-switch>
</template>
```

### 图标风格

通过 `variant` 属性设置图标风格，支持 `outline`（线框）和 `fill`（填充）两种风格。

```vue
<template>
  <t-space direction="vertical">
    <hr-privacy-switch variant="outline"></hr-privacy-switch>
    <hr-privacy-switch variant="fill"></hr-privacy-switch>
  </t-space>
</template>
```

### 自定义颜色

通过 `color` 属性设置文字颜色。

```vue
<template>
  <t-space direction="vertical">
    <hr-privacy-switch color="red"></hr-privacy-switch>
    <hr-privacy-switch color="#00ff00"></hr-privacy-switch>
    <hr-privacy-switch color="rgb(0, 0, 255)"></hr-privacy-switch>
  </t-space>
</template>
```

### 尺寸

通过 `size` 属性设置图标尺寸，支持 `large`、`medium`、`small` 或自定义尺寸值。

```vue
<template>
  <t-space direction="vertical">
    <hr-privacy-switch size="large"></hr-privacy-switch>
    <hr-privacy-switch size="medium"></hr-privacy-switch>
    <hr-privacy-switch size="small"></hr-privacy-switch>
    <hr-privacy-switch size="50px"></hr-privacy-switch>
    <hr-privacy-switch size="3em"></hr-privacy-switch>
  </t-space>
</template>
```

## API

### Props

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| v-model / modelValue | 隐私模式开启状态 | Boolean | true/false | true |
| size | 图标尺寸 | String | large/medium/small/20px/3em等 | medium |
| variant | 图标风格 | String | outline/fill | outline |
| color | 文字颜色 | String | - | - |
| showText | 显示时的文案 | String/slot | - | 显示 |
| hideText | 隐藏时的文案 | String/slot | - | 隐藏 |
| iconOnly | 仅展示图标 | Boolean | true/false | false |

### Events

| 事件名 | 说明 | 回调参数 |
| --- | --- | --- |
| change | 隐私模式状态改变时触发 | (value: boolean) |

### Slots

| 插槽名 | 说明 |
| --- | --- |
| showText | 自定义显示时的文案 |
| hideText | 自定义隐藏时的文案 |
