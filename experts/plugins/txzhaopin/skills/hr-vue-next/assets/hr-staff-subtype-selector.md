# HrStaffSubtypeSelector 员工子类型选择器

## 组件概述

`HrStaffSubtypeSelector` 是一个员工子类型选择器组件，可通过级联选择器逐级查看并选择员工子类型。

## 引入方式

```javascript
import { HrStaffSubtypeSelector } from '@tencent/hr-vue-next';
```

## 代码示例

### 基础用法

适用广泛的基础选择，提供2种方式选择员工子类型，用 Tag 展示已选员工子类型。员工子类型级联选择器目前默认使用单选模式。
1. 展开级联面板选择
2. 输入关键字搜索，使用下拉菜单展示筛选后的员工子类型

提醒: 请避免在选择后动态改变选择器的宽度，这会造成 Tag 区域样式显示问题。`v-model` 的值为当前被选中的员工子类型选项的 **value** 属性值。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">基础单选</span>
      <hr-staff-subtype-selector v-model="value1" placeholder="基础单选" />
    </div>
    <div class="block">
      <span class="demonstration">基础多选</span>
      <hr-staff-subtype-selector v-model="value2" :map="map" placeholder="基础多选" @change="change" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const map = {
  multiple: true,
};
const value1 = ref('');
const value2 = ref([]);
const change = (e) => {
  console.log(e);
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
      <hr-staff-subtype-selector v-model="value1" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">折叠展示Tag</span>
      <hr-staff-subtype-selector v-model="value2" collapseTags :tagsLength="7" :map="map" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const map = {
  multiple: true,
};
const value1 = ref([164, 162]);
const value2 = ref([164, 162]);
</script>
```

### 限制展示的员工类型

属性 `includeStaffTypeList` 定义了展示员工类型的集合，默认全展示。

```vue
<template>
  <hr-staff-subtype-selector v-model="value" :includeStaffTypeList="includeStaffTypeList" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref('');
const includeStaffTypeList = [2, 5, 6, 7];
</script>
```

### 级联面板展示层级

设置显示的级联层级数。可通过 `level` 来设置显示层级数，默认二级。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">仅展示一级</span>
      <hr-staff-subtype-selector v-model="value1" :level="1" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">默认展示二级</span>
      <hr-staff-subtype-selector ref="selector" v-model="value2" :map="map" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const map = {
  multiple: true,
};
const value1 = ref([]);
const value2 = ref([]);
</script>
```

### 仅展示最后一级

可以仅在输入框中显示选中项最后一级的职级，而不是选中职级所在的完整路径。属性 `showAllLevels` 定义了是否显示完整的路径，将其赋值为`false`则仅显示最后一级。

```vue
<template>
  <hr-staff-subtype-selector v-model="value" :showAllLevels="false" :map="map" :filterable="false" />
</template>
<script setup>
import { ref } from 'vue';
const map = {
  multiple: true,
};
const value = ref([]);
</script>
```

### 可搜索

可以使用`filterable`属性来开启搜索功能, 默认开启搜索功能。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">不可搜索</span>
      <hr-staff-subtype-selector v-model="value1" :map="map" :filterable="false" />
    </div>
    <div class="block">
      <span class="demonstration">可搜索</span>
      <hr-staff-subtype-selector v-model="value2" :map="map" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const map = {
  multiple: true,
};
const value1 = ref([]);
const value2 = ref([]);
</script>
```

### 多语言

属性 `lang` 定义了展示语言，默认中文，可选值`en`。

```vue
<template>
  <hr-staff-subtype-selector v-model="value" lang="en" :map="map" />
</template>
<script setup>
import { ref } from 'vue';
const map = {
  multiple: true,
};
const value = ref([]);
</script>
```

### 回显过滤

可通过 `clearUnmatchedOptions` 属性指定回显清除不存在选项中的值。

```vue
<template>
  <hr-staff-subtype-selector v-model="value" clearUnmatchedOptions :map="{ multiple: true }" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref(['这个会被过滤', 162, '不展示']);
</script>
```

### 选中值模式

设置选中值的展示及返回值。通过valueMode属性设置选中值模式，默认onlyLeaf 选中值仅呈现叶子节点；parentFirst 表示当子节点全部选中时，仅父节点在选中值里面；all 表示父节点和子节点全部会出现在选中值里面。可选项：onlyLeaf/parentFirst/all

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">all模式</span>
      <hr-staff-subtype-selector
        ref="selector1"
        v-model="value1"
        valueMode="all"
        :map="{ multiple: true }"
      />
    </div>
    <div class="block">
      <span class="demonstration">parentFirst模式</span>
      <hr-staff-subtype-selector
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
      <hr-staff-subtype-selector v-model="value1" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">中等尺寸</span>
      <hr-staff-subtype-selector size="medium" v-model="value2" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">较小尺寸</span>
      <hr-staff-subtype-selector size="small" v-model="value3" :map="map" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const map = {
  multiple: true,
};
const value1 = ref([]);
const value2 = ref([]);
const value3 = ref([]);
</script>
```

### 自定义数据源

选择器内置的员工子类型数据是在初始时从远程服务器拉取的，用户可替换自己的数据源。`promise` 属性接收一个 `Promise`，完成状态时的返回值为有清晰层级结构的员工子类型集合，如果数据源字段与选择器默认要求的 **value，label，children** 不一致，可通过 `map` 属性进行映射。

```vue
<template>
  <hr-staff-subtype-selector v-model="value" :map="map" :promise="promise"></hr-staff-subtype-selector>
</template>
<script setup>
import { ref } from 'vue';
const map = {
  value: 'group',
  label: 'mark',
};
const value = ref('L3');
const promise = new Promise((resolve, reject) => {
  const remoteData = [
    {
      group: 'L1',
      mark: '正式',
      children: [
        {
          group: 'L3',
          mark: '正式合同制',
        },
      ],
    },
    {
      group: 'L2',
      mark: '外包',
      children: [
        {
          group: 'L4',
          mark: '人力外包',
        },
        {
          group: 'L5',
          mark: '项目外包',
        }
      ],
    },
  ];
  setTimeout(() => {
    resolve(remoteData);
  }, 300);
});
</script>
```

## API

### 属性

| 参数            | 说明                             | 类型    | 可选值             | 默认值  |
| --------------- | -------------------------------- | ------- | ------------------ | ------- |
| v-model / modelValue | 绑定值                       | String/Number/Array   | —    | —       |
| size            | 输入框尺寸                       | String  | medium/small              | —       |
| level           | 层级数                           | Number  | 1、2               | 2       |
| disabled        | 是否禁用                         | Boolean | —                  | false   |
| lang            | 语言                             | String  | 中文: zh，英文: en | zh      |
| collapseTags    | 多选模式下是否折叠Tag            | Boolean | —                  | false   |
| tagsLength      | Tag最大展示文字数, 最小1         | Number  | —                  | 13      |
| showAllLevels   | 输入框中是否显示选中值的完整路径 | Boolean | —                  | true    |
| showTotal       | 是否显示后置的已选数量           | Boolean | —                  | false   |
| includeStaffTypeList  | 可展示的员工类型集合（默认全展示）    | Array | —         | -    |
| placeholder     | 占位符                           | String  | —                  | —       |
| filterable      | 是否可搜索选项                   | Boolean | —                  | true    |
| clearUnmatchedOptions  | 回显时清除不存在选项列表中的选项    | Boolean | —          | false    |
| valueMode           | 选中值模式。all 表示父节点和子节点全部会出现在选中值里面；parentFirst 表示当子节点全部选中时，仅父节点在选中值里面；onlyLeaf 表示无论什么情况，选中值仅呈现叶子节点 |  String | onlyLeaf/parentFirst/all |onlyLeaf |
| separator       | 选项分隔符                       | String  | —                  | 斜杠'/' |
| map             | 映射配置，具体见下表             | Object  | —                  | —       |
| promise         | 获取层级员工子类型数据的方法     | Promise | —                  | —       |
| customClass     | 自定义类名                      | String | —                  | —          |

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
