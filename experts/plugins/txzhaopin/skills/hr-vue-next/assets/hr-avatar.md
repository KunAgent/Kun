# HrAvatar 头像

## 组件概述

`HrAvatar` 是一个头像组件，用于显示用户的头像和姓名。

## 引入方式

```javascript
import { HrAvatar } from '@tencent/hr-vue-next';
```

## 代码示例

### 基础头像

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-avatar username="cxyxhhuang(黄鑫杰)"></hr-avatar>
    </div>
  </div>
</template>
<script setup>
</script>
```

### 附加文本行

```vue
<template>
    <div class="example_flex_box">
      <div class="block">
        <hr-avatar username="cxyxhhuang(黄鑫杰)" extraText="人力资源平台部"></hr-avatar>
      </div>
    </div>
  </template>
  <script setup>
  </script>
```

### 溢出显示tooltip

```vue
<template>
  <div class="example_flex_box">
    <div class="block" style="max-width: 150px">
      <hr-avatar username="cxyxhhuang(黄鑫杰)" extraText="人力资源平台部"></hr-avatar>
    </div>
  </div>
</template>
<script setup></script>
```

### 自定义文字颜色

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-avatar 
        username="cxyxhhuang(黄鑫杰)" 
        extraText="人力资源平台部" 
        usernameColor="rgba(0, 52, 181, 1)" 
        extraTextColor="rgba(38, 111, 232, 1)">
      </hr-avatar>
    </div>
  </div>
</template>
<script setup>
</script>
```

### 尺寸

```vue
<template>
    <div class="example_flex_box">
      <div class="block">
        <span class="demonstration">小尺寸</span>
        <hr-avatar username="cxyxhhuang(黄鑫杰)" avatarSize="small" extraText="人力资源平台部" ></hr-avatar>
      </div>
      <div class="block">
        <span class="demonstration">中尺寸</span>
        <hr-avatar username="cxyxhhuang(黄鑫杰)" avatarSize="medium" extraText="人力资源平台部" ></hr-avatar>
      </div>
      <div class="block">
        <span class="demonstration">大尺寸</span>
        <hr-avatar username="cxyxhhuang(黄鑫杰)" avatarSize="large" extraText="人力资源平台部" ></hr-avatar>
      </div>
    </div>
  </template>
  <script setup>
  </script>
```

## API

### 属性

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| -- | -- | -- | -- | -- |
| avatarSize | 头像尺寸 | String | small/medium/large | medium |
| username | 头像名称 | String | - | - |
| extraText | 补充文本 | String | - | - |
| usernameColor | 头像名称字体颜色 | String | - | #000000e6 |
| extraTextColor | 补充文本字体颜色 | String | - | #00000099 |
| avatarOnly | 是否只显示头像，不显示文字 | Boolean | - | false |
| useTooltips | 文字溢出是否显示tooltip | Boolean | - | true |
| layout | 头像布局，分为'horizontal'左右布局和'vertical'上下布局 | String | vertical/horizontal | horizontal |
