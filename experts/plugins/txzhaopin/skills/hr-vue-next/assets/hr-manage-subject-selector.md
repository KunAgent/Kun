# HrManageSubjectSelector 管理主体选择器

## 组件概述

`HrManageSubjectSelector` 是一个管理主体选择器组件，用于选择管理主体，支持单选、多选、搜索等功能。

## 引入方式

```javascript
import { HrManageSubjectSelector } from '@tencent/hr-vue-next';
```

## 代码示例

### 单选

组件提供单选和多选两种选择方式，默认是单选。`v-model` 的值为当前被选中的选项的 `value` 属性值。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">基础单选</span>
      <hr-manage-subject-selector v-model="value1" placeholder="基础单选" filterable />
    </div>
    <div class="block">
      <span class="demonstration">有默认值</span>
      <hr-manage-subject-selector v-model="value2" placeholder="有默认值" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref(10101);
</script>
```

### 多选

适用性较广的基础多选，用Tag展示已选内容。设置`map.multiple`属性即可启用多选，此时`v-model`的值为当前选中值所组成的数组。默认情况下选中值会以 Tag 的形式展现，你也可以设置`collapse-tags`属性将它们合并为一段文字。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">基础多选</span>
      <hr-manage-subject-selector v-model="value1" :map="map" filterable @change="change" />
    </div>
    <div class="block">
      <span class="demonstration">折叠展示Tag</span>
      <hr-manage-subject-selector v-model="value2" :map="map" collapse-tags @change="change" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref([]);
const value2 = ref([10101, 10224]);
const map = { multiple: true };
const change = (val) => {
  console.log(val);
};
</script>
```

### 限制管理主体选择范围

排除选项不会显示在下拉菜单中。使用`range.manageUnitTypeIdList`属性设置仅选择某类型下的管理主体;使用`range.manageUnitIdList`属性设置仅选择某些管理主体。

```vue
<template>
  <hr-manage-subject-selector v-model="value" :map="map" :range="range" placeholder="请选择" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref([]);
const range = {
  manageUnitTypeIdList: [102, 103],
  manageUnitIdList: [10301, 10304, 8663],
};
const map = { multiple: true };
</script>
```

### 多语言

设置选项展示的语言。属性 `lang` 定义了展示语言，默认中文，可选值`en`。

```vue
<template>
  <hr-manage-subject-selector v-model="value" :map="map" lang="en" />
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
  <hr-manage-subject-selector v-model="value" :map="map" :showAllLevels="false" :tagsLength="7" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref([]);
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
      <hr-manage-subject-selector v-model="value1" :map="map" :filterable="false" />
    </div>
    <div class="block">
      <span class="demonstration">可搜索</span>
      <hr-manage-subject-selector v-model="value2" :map="map" />
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
  <hr-manage-subject-selector v-model="value" clearUnmatchedOptions :map="{ multiple: true }" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref(['这个会被过滤', 10101, '不展示']);
</script>
```

### 选中值模式

设置选中值的展示及返回值。通过valueMode属性设置选中值模式，默认onlyLeaf 选中值仅呈现叶子节点；parentFirst 表示当子节点全部选中时，仅父节点在选中值里面；all 表示父节点和子节点全部会出现在选中值里面。可选项：onlyLeaf/parentFirst/all

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">all模式</span>
      <hr-manage-subject-selector
        ref="selector1"
        v-model="value1"
        valueMode="all"
        :map="{ multiple: true }"
      />
    </div>
    <div class="block">
      <span class="demonstration">parentFirst模式</span>
      <hr-manage-subject-selector
        ref="selector2"
        v-model="value2"
        @change="selectorChange"
        :map="{ multiple: true }"
        valueMode="parentFirst"
        placeholder="parentFirst模式"
      />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref([]);
const value2 = ref([]);
const selector1 = ref(null);
const selector2 = ref(null);
const selectorChange = (val) => {
  console.log(val, value2.value);
};
</script>
```

### 尺寸

可通过 `size` 属性指定输入框的尺寸，除了默认的大小外，提供了**medium**、**small**尺寸。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">默认尺寸</span>
      <hr-manage-subject-selector v-model="value1" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">中等尺寸</span>
      <hr-manage-subject-selector size="medium" :map="map" v-model="value2" />
    </div>
    <div class="block">
      <span class="demonstration">较小尺寸</span>
      <hr-manage-subject-selector size="small" :map="map" v-model="value3" />
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

可以自定义下拉菜单中的选项。使用 `data` 属性来设置选项数据源，或者使用`promise`来设置访问选项数据源的方法。如果你的数据源中不包含 `value` 和 `label` 默认字段，可以通过 `valueMap` 和`labelMap` 属性来指定。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-manage-subject-selector v-model="value1" :data="remoteData" :map="map" />
    </div>
    <div class="block">
      <hr-manage-subject-selector v-model="value2" :promise="promise" :map="map" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref('L3');
const value2 = ref('L4');
const map = {
  label: 'mark',
  value: 'group',
};
const remoteData = [
  {
    group: 'L1',
    mark: '集团本部',
    children: [
      {
        group: 'L3',
        mark: '测试',
      },
    ],
  },
  {
    group: 'L2',
    mark: '投资公司',
    children: [
      {
        group: 'L4',
        mark: '测试投资',
      },
      {
        group: 'L4',
        mark: 'test',
      }
    ],
  },
];
const promise = new Promise((resolve, reject) => {
  // 获取远程数据源
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
| v-model / modelValue | 绑定值                                                                               | Array/String/Number | —                  | —       |
| size            | 输入框尺寸                                                                           | String                | medium/small              | —       |
| disabled        | 是否禁用                                                                             | Boolean               | —                  | false   |
| placeholder     | 占位符                                                                               | String                | —                  | —       |
| lang            | 语言                                                                                 | String                | 中文: zh，英文: en | zh      |
| range           | 限制选项范围，具体见下表                                                             | Object                | —                  | —       |
| collapseTags    | 多选模式下是否折叠Tag                                                                | Boolean               | —                  | false   |
| tagsLength      | Tag最大展示文字数, 最小1                                                             | Number                | —                  | 13      |
| filterable      | 是否可搜索选项                                                                       | Boolean               | —                  | true    |
| showAllLevels   | 输入框中是否显示选中值的完整路径                                                     | Boolean               | —                  | true    |
| clearUnmatchedOptions  | 回显时清除不存在选项列表中的选项                                              | Boolean               | —                  | false    |
| valueMode           | 选中值模式。all 表示父节点和子节点全部会出现在选中值里面；parentFirst 表示当子节点全部选中时，仅父节点在选中值里面；onlyLeaf 表示无论什么情况，选中值仅呈现叶子节点 |  String | onlyLeaf/parentFirst/all |onlyLeaf |
| data            | 自定义选项                                                                           | Array                 | —                  | —     |
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
| multiple | 是否多选                                                                                           | Boolean | —      | false       |

### range 配置

| 参数                 | 说明               | 类型  | 可选值 | 默认值 |
| -------------------- | ------------------ | ----- | ------ | ------ |
| manageUnitTypeIdList | 管理主体类型Id集合 | Array | —      | —      |
| manageUnitIdList     | 管理主体Id集合     | Array | —      | —      |
