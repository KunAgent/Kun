# HrPositionLevel 职级选择器

## 组件概述

`HrPositionLevel` 是一个职级选择器组件，用于选择职级，支持单选、多选、搜索、限制选择范围等功能。

## 引入方式

```javascript
import { HrPositionLevel } from '@tencent/hr-vue-next';
```

## 代码示例

### 基础用法

提供2种方式选择职级，单选和多选。职级选择器目前默认使用多选模式。
1. 展开下拉面板选择
2. 输入关键字搜索，使用下拉菜单展示筛选后的职级

默认多选，`v-model` 的值为当前被选中的职级选项的 **value** 属性值。可通过 `map.multiple` 属性设置多选，`v-model` 的值为当前被选中的职级选项的 **value** 属性值集合。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">基础单选</span>
      <hr-position-level v-model="value1" @change="selectorChange" placeholder="基础单选" />
    </div>
    <div class="block">
      <span class="demonstration">基础多选</span>
      <hr-position-level v-model="value2" @change="selectorChange" :map="map" placeholder="基础多选" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref([]);
const map = { multiple: true };
const selectorChange = (val) => {
  console.log(val);
};
</script>
```

### 多选Tag展示

多选模式下，默认情况下会展示所有已选中的选项的Tag，你可以使用`collapseTags`来折叠Tag。可以使用`tagsLength`来设置Tag最大展示文字数。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">默认显示所有Tag</span>
      <hr-position-level v-model="value1" :map="map" @change="selectorChange" />
    </div>
    <div class="block">
      <span class="demonstration">折叠展示Tag</span>
      <hr-position-level v-model="value2" :map="map" @change="selectorChange" collapseTags :tagsLength="7" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref([]);
const value2 = ref([]);
const map = { multiple: true };
const selectorChange = (val) => {
  console.log(val);
};
</script>
```

### 限制职级选择范围

用于仅提供某条件下的职级选择。提醒: 动态切换条件时，会清空已有选项。

可通过 `range.positionSystemTypeIdList` 属性设置仅选择某通道族体系类型下的职级;可通过 `range.positionSystemIdList` 属性设置仅选择对应通道族体系下的职级（默认是[1],管理职级）;可通过 `range.positionClanIdList` 属性设置仅选择某职位族下的职级;可通过 `range.positionLevelIdList` 属性设置仅选择对应职级Id的职级。

```vue
<template>
  <div class="example_flex_box">
    <div class="block block-3">
      <span class="demonstration">管理职级</span>
      <hr-position-level :range="range" v-model="value" :map="map" />
    </div>
    <div class="block block-3">
      <span class="demonstration">专业职级</span>
      <hr-position-level :range="range2" v-model="value2" :map="map" />
    </div>
    <div class="block block-3">
      <span class="demonstration">海外职级</span>
      <hr-position-level :range="range3" v-model="value3" :map="map" collapseTags :filterable="false" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value = ref([60, 61]);
const value2 = ref([]);
const value3 = ref([]);
const range = {
  positionSystemTypeIdList: [0], // 通道族体系类型Id集合
  positionSystemIdList: [1], // 通道族体系集合 1代表管理职级 默认是 1
  positionClanIdList: [15], // 职位族Id集合
  positionLevelIdList: [60, 61, 62], // 职级Id集合
};
const range2 = {
  positionSystemIdList: [2], // 通道族体系集合 2代表专业职级
};
const range3 = {
  positionSystemIdList: [3], // 通道族体系集合 3代表海外职级
};
const map = { multiple: true };
</script>
```

### 多语言

设置选项展示的语言。属性 `lang` 定义了展示语言，默认中文，可选值`en`。

```vue
<template>
  <hr-position-level v-model="value" :map="map" lang="en" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref([]);
const map = { multiple: true };
</script>
```

### 仅展示最后一级

可以仅在输入框中显示选中项最后一级的职级，而不是选中职级所在的完整路径。属性 `showAllLevels` 定义了是否显示完整的路径，将其赋值为`false`则仅显示最后一级。

```vue
<template>
  <hr-position-level v-model="value" :map="map" :showAllLevels="false" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref([60, 61]);
const map = { multiple: true };
</script>
```

### 可搜索

可以使用`filterable`属性来开启搜索功能, 默认开启搜索功能。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">不可搜索</span>
      <hr-position-level v-model="value1" :map="map" :filterable="false" />
    </div>
    <div class="block">
      <span class="demonstration">可搜索</span>
      <hr-position-level v-model="value2" :map="map" />
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

### 回显过滤

可通过 `clearUnmatchedOptions` 属性指定回显清除不存在选项中的值。

```vue
<template>
  <hr-position-level v-model="value" clearUnmatchedOptions :map="{ multiple: true }" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref(['这个会被过滤', 97, '不展示']);
</script>
```

### 尺寸

可通过 `size` 属性指定输入框的尺寸，除了默认的大小外，提供了**medium**、**small**尺寸。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">默认尺寸</span>
      <hr-position-level v-model="value1" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">中等尺寸</span>
      <hr-position-level size="medium" v-model="value2" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">较小尺寸</span>
      <hr-position-level size="small" v-model="value3" :map="map" />
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

默认职级数据从远程服务器获取。使用 `data` 属性来设置选项数据源，或者使用`promise`来设置访问选项数据源的方法。如果你的数据源中不包含 `value` 和 `label` 默认字段，可以通过 `valueMap` 和`labelMap` 属性来指定。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-position-level v-model="value1" :data="remoteData" :map="map" />
    </div>
    <div class="block">
      <hr-position-level v-model="value2" :promise="promise" :map="map" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const map = {
  value: 'group',
  label: 'mark',
};
const value1 = ref('L3');
const value2 = ref('L3');
const remoteData = [
  {
    group: 'L1',
    mark: '管理族',
    children: [
      {
        group: 'L3',
        mark: 'L3',
      },
    ],
  },
  {
    group: 'S2',
    mark: '专业族',
    children: [
      {
        group: 'S4',
        mark: 'S4',
      },
      {
        group: 'S5',
        mark: 'S5',
      },
    ],
  },
];
const promise = new Promise((resolve, reject) => {
  setTimeout(() => {
    resolve(remoteData);
  }, 300);
});
</script>
```

## API

### 属性

| 参数            | 说明                                                                                 | 类型                  | 可选值             | 默认值  |
| --------------- | ------------------------------------------------------------------------------------ | --------------------- | ------------------ | ------- |
| v-model / modelValue | 绑定值                                                                           | Array/String/Number | —                  | —       |
| size            | 输入框尺寸                                                                           | String                | medium/small              | —       |
| disabled        | 是否禁用                                                                             | Boolean               | —                  | false   |
| placeholder     | 占位符                                                                               | String                | —                  | —       |
| lang            | 语言                                                                                 | String                | 中文: zh，英文: en | zh      |
| range           | 限制选项范围，具体见下表                                                             | Object                | —                  | —       |
| collapseTags    | 多选模式下是否折叠Tag                                                                | Boolean               | —                  | false   |
| tagsLength      | Tag最大展示文字数, 最小1                                                             | Number                | —                  | 13      |
| filterable      | 是否可搜索选项                                                                       | Boolean               | —                  | true    |
| showAllLevels   | 输入框中是否显示选中值的完整路径                                                     | Boolean               | —                  | true    |
| clearUnmatchedOptions  | 回显时清除不存在选项列表中的选项                                               | Boolean               | —                  | false    |
| data            | 自定义选项                                                                           | Array                 | —                  | [ ]     |
| promise         | 覆盖组件内部获取选项数据源的默认方法，`resolve` 函数的参数需要是一个由选项组成的数组 | Promise               | —                  | —       |
| showTotal       | 是否显示后置的已选数量                                                               | Boolean               | —                  | false   |
| separator       | 选项分隔符                                                                           | String                | —                  | 斜杠'/' |
| map             | 映射配置，具体见下表                                                                 | Object                | —                  | —       |
| customClass     | 自定义类名                                                                           | String                | —                  | —       |

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
| multiple | 是否多选                                                                                           | Boolean | —      | true       |

### range 配置

| 参数                     | 说明                 | 类型  | 可选值 | 默认值 |
| ------------------------ | -------------------- | ----- | ------ | ------ |
| positionSystemTypeIdList | 通道族体系类型Id集合 | Array | —      | [0]    |
| positionSystemIdList     | 通道族体系Id集合     | Array | —      | [1]    |
| positionClanIdList       | 职位族Id集合         | Array | —      | -      |
| positionLevelIdList      | 职级Id集合           | Array | —      | -      |
