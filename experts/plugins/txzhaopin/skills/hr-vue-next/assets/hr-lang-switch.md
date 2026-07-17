# HrLangSwitch 语言切换器

## 组件概述

`HrLangSwitch` 是一个语言切换器组件，用于语言切换的场景。

## 引入方式

```javascript
import { HrLangSwitch } from '@tencent/hr-vue-next';
```

## 代码示例

### 基础语言切换器

当传入主动传入lang为props时，组件会使用外部接受的lang参数为默认语言。当未传入lang参数时，组件会默认从localStorage.getItem('hr-sys-def-lang')获取当前语言，都没有的情况下则默认为'zh'中文语言。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-lang-switch></hr-lang-switch>
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
        <hr-lang-switch size="small" />
      </div>
      <div class="block">
        <span class="demonstration">中尺寸</span>
        <hr-lang-switch size="medium" />
      </div>
      <div class="block">
        <span class="demonstration">大尺寸</span>
        <hr-lang-switch size="large" />
      </div>
    </div>
  </template>
  <script setup>
  </script>
```

### 模式

```vue
<template>
    <div class="example_flex_box">
      <div class="block">
        <span class="demonstration">黑色</span>
        <div class="mode-box">
            <hr-lang-switch mode="black" />
        </div>
      </div>
      <div class="block">
        <span class="demonstration">白色</span>
        <div class="mode-box mode-white">
            <hr-lang-switch mode="white" />
        </div>
      </div>
    </div>
  </template>
  <script setup>
  </script>
  <style lang="less">
  .mode-box {
    padding: 20px 45px;
  }
  .mode-white {
    background-color: #125FFF;
  }
</style>
```

### 组件同步切换示例

```vue
<template>
    <div class="example_flex_box">
      <div class="block">
        <span class="demonstration">点击按钮切换右侧组件语言</span>
        <hr-lang-switch ref="langSwitchRef" @onSwitch="onSwitch" />
      </div>
      <div class="block">
        <span class="demonstration">跟随语言切换变化组件</span>
        <t-button>{{ label }}</t-button>
      </div>
    </div>
  </template>
  <script setup>
  import { ref, onMounted } from "vue"
  const langSwitchRef = ref(null)
  const label = ref('确认')
  onMounted(() => {
      const lang = langSwitchRef.value?.getLang()
      onSwitch(lang)
  })
  const onSwitch = (curLang) => {
      label.value = curLang === 'zh' ? '确认' : 'confirm'
  }
  </script>
```

## API

### 属性

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| -- | -- | -- | -- | -- |
| lang | 当前语言，不传组件内部默认zh | String | zh/en | - |
| size | 组件尺寸大小 | String | small/medium/large | medium |
| fontColor | 组件文字颜色 | String | - | - |
| mode | 组件模式 | String | black/white | black |
| iconOnly | 是否仅显示icon | Boolean | - | false |

### 事件

| 事件名称 | 说明 | 回调参数 |
| -- | -- | -- |
| onSwitch | 点击时触发 | 当前的切换语言 |
