# HrWecom 企业微信

## 组件概述

`HrWecom` 是一个企业微信组件，以链接形式呈现，核心功能为一键快速唤起企业微信即时聊天窗口，适用于客服系统、员工通讯录、内部协作等场景，提升用户沟通效率。

## 引入方式

```javascript
import { HrWecom } from '@tencent/hr-vue-next';
```

## 代码示例

### 基础企业微信

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-wecom username="cxyxhhuang(黄鑫杰)"></hr-wecom>
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
        <hr-wecom username="cxyxhhuang(黄鑫杰)" size="small"></hr-wecom>
      </div>
      <div class="block">
        <span class="demonstration">中尺寸</span>
        <hr-wecom username="cxyxhhuang(黄鑫杰)" size="medium"></hr-wecom>
      </div>
      <div class="block">
        <span class="demonstration">大尺寸</span>
        <hr-wecom username="cxyxhhuang(黄鑫杰)" size="large"></hr-wecom>
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
| underLine | 是否显示下划线 | Boolean | - | false |
| size | 组件尺寸大小 | String | small/medium/large | middle |
| username | 需要跳转的对应用户名 | String | - | - |
