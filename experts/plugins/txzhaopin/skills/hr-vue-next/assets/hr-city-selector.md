# HrCitySelector 省市选择器

## 组件概述

`HrCitySelector` 是一个省市选择器组件，支持单选、多选模式，支持搜索、自定义数据源等功能。

## 引入方式

```javascript
import { HrCitySelector } from '@tencent/hr-vue-next';
```

## 代码示例

### 基础用法

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">基础单选</span>
      <hr-city-selector v-model="value1" placeholder="基础单选" />
    </div>
    <div class="block">
      <span class="demonstration">基础多选</span>
      <hr-city-selector v-model="value2" :map="map" placeholder="基础多选" @change="change" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref(1);
const value2 = ref([1]);
const map = { multiple: true };
const change = (val) => {
  console.log(val);
};
</script>
```

### 清除不匹配选项

```vue
<template>
  <hr-city-selector v-model="value" clearUnmatchedOptions :map="map" />
</template>
<script setup>
import { ref } from 'vue';
const map = { multiple: true };
const value = ref(['这个会被过滤', 18, '不展示']);
</script>
```

### 可搜索

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">不可搜索</span>
      <hr-city-selector v-model="value1" :map="map" :filterable="false" />
    </div>
    <div class="block">
      <span class="demonstration">可搜索</span>
      <hr-city-selector v-model="value2" :map="map" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref([]);
const value2 = ref([]);
const map = { multiple: true };
</script>
```

### 语言设置

```vue
<template>
  <hr-city-selector v-model="value" :map="map" lang="en" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref([]);
const map = { multiple: true };
</script>
```

### 层级数

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">仅展示一级</span>
      <hr-city-selector v-model="value1" :map="map" :level="1" />
    </div>
    <div class="block">
      <span class="demonstration">默认展示二级</span>
      <hr-city-selector ref="selector" :map="map" v-model="value2" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref([]);
const value2 = ref([]);
const map = { multiple: true };
</script>
```

### 显示完整路径

```vue
<template>
  <hr-city-selector v-model="value" :map="map" :showAllLevels="false" :filterable="false" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref([]);
const map = { multiple: true };
</script>
```

### 尺寸

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">默认尺寸</span>
      <hr-city-selector v-model="value1" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">中等尺寸</span>
      <hr-city-selector size="medium" :map="map" v-model="value2" />
    </div>
    <div class="block">
      <span class="demonstration">较小尺寸</span>
      <hr-city-selector size="small" :map="map" v-model="value3" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref([]);
const value2 = ref([]);
const value3 = ref([]);
const map = { multiple: true };
</script>
```

### 自定义数据源

```vue
<template>
  <hr-city-selector v-model="value" :map="map" :promise="customGetRegion"></hr-city-selector>
</template>
<script setup>
import { ref } from 'vue';
const value = ref(3);
const map = {
  value: 'value',
  label: 'label',
};
const customGetRegion = new Promise((resolve, reject) => {
  const remoteData = [
    {
      value: 2,
      label: '上海',
      children: [
        { value: 3, label: '普陀' },
        { value: 4, label: '黄埔' },
        { value: 5, label: '徐汇' },
      ],
    },
    {
      value: 6,
      label: '江苏',
      children: [
        { value: 7, label: '南京' },
        { value: 8, label: '苏州' },
        { value: 9, label: '无锡' },
      ],
    },
    {
      value: 10,
      label: '浙江',
      children: [
        { value: 11, label: '杭州' },
        { value: 12, label: '宁波' },
        { value: 13, label: '嘉兴' },
      ],
    },
    {
      value: 18,
      label: '陕西',
      children: [
        { value: 19, label: '西安' },
        { value: 20, label: '延安' },
      ],
    },
    {
      value: 21,
      label: '新疆维吾尔族自治区',
      children: [
        { value: 22, label: '乌鲁木齐' },
        { value: 23, label: '克拉玛依' },
      ],
    },
  ];
  setTimeout(() => {
    resolve(remoteData);
  }, 300);
});
</script>
```

### Tag折叠展示

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">默认显示所有Tag</span>
      <hr-city-selector v-model="value1" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">折叠展示Tag</span>
      <hr-city-selector v-model="value2" :map="map" collapseTags :tagsLength="7" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref([1, 2]);
const value2 = ref([1, 2]);
const map = { multiple: true };
</script>
```

## API

### 属性

| 参数            | 说明                             | 类型    | 可选值             | 默认值  |
| --------------- | -------------------------------- | ------- | ------------------ | ------- |
| v-model / modelValue | 绑定值                      | Array/String/Number   | —      | —       |
| size            | 输入框尺寸                       | String  | medium/small              | —       |
| level           | 层级数                           | Number  | 1、2               | 2       |
| disabled        | 是否禁用                         | Boolean | —                  | false   |
| lang            | 语言                             | String  | 中文: zh，英文: en | zh      |
| collapseTags    | 多选模式下是否折叠Tag            | Boolean | —                  | false   |
| tagsLength      | Tag最大展示文字数, 最小1         | Number  | —                  | 13      |
| showAllLevels   | 输入框中是否显示选中值的完整路径 | Boolean | —                  | true    |
| clearUnmatchedOptions  | 回显时清除不存在选项列表中的选项    | Boolean   | —      | false    |
| showTotal       | 是否显示后置的已选数量           | Boolean | —                  | false   |
| placeholder     | 占位符                           | String  | —                  | —       |
| filterable      | 是否可搜索选项                   | Boolean | —                  | true    |
| separator       | 选项分隔符                       | String  | —                  | 斜杠'/' |
| map             | 映射配置，具体见下表             | Object  | —                  | —       |
| promise         | 获取层级省市数据的方法           | Promise | —                  | —       |
| customClass     | 自定义类名                      | String                | —            | —          |

### 事件

| 事件名称 | 说明                 | 回调参数                                               |
| -------- | -------------------- | ------------------------------------------------------ |
| change   | 选中项发生变化时触发 | 目前的选中项, 包含label、value、path数组、fullName、fullOptions数组。 TS 类型： `CascaderSelectedOption[]` |

### 方法

| 方法名          | 说明           | 参数                                        | 返回值                                        |
| --------------- | -------------- | ------------------------------------------- | ------------------------------------------- |
| clearSelected   | 用于清空选中项 | —                                           | —                                           |
| getCheckedNodes | 获取选中的节点 | (leafOnly) 是否只是叶子节点，默认值为 false | 选中值节点数组。TS类型： `CascaderTreeNode[]`   |
| getCheckedData  | 获取选中的数据   | —                          |目前的选中项, 包含label、value、path数组、fullName、fullOptions数组。 TS 类型： `CascaderSelectedOption[]`|

### map 配置

| 参数     | 说明                                                                                               | 类型    | 可选值 | 默认值     |
| -------- | -------------------------------------------------------------------------------------------------- | ------- | ------ | ---------- |
| value    | 指定选项的值为选项对象的某个属性值                                                                 | String  | —      | 'value'    |
| label    | 指定选项标签为选项对象的某个属性值                                                                 | String  | —      | 'label'    |
| children | 指定选项的子选项为选项对象的某个属性值                                                             | String  | —      | 'children' |
| emitPath | 在选中节点改变时，是否返回由该节点所在的各级菜单的值所组成的数组，若设置 false，则只返回该节点的值 | Boolean | —      | false      |
| multiple | 是否多选                                                                                           | Boolean | —      | false       |
