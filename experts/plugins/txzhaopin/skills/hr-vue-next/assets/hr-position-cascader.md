# HrPositionCascader 职位级联选择器

## 组件概述

`HrPositionCascader` 是一个职位级联选择器组件，当能一次性获取有清晰层级结构的职位集合时，可通过级联选择器逐级查看并选择。

## 引入方式

```javascript
import { HrPositionCascader } from '@tencent/hr-vue-next';
```

## 代码示例

### 基础用法

适用广泛的基础选择，提供2种方式选择职位，用 Tag 展示已选职位。职位级联选择器目前默认使用单选模式。
1. 展开级联面板选择
2. 输入关键字搜索，使用下拉菜单展示筛选后的职位

提醒: 请避免在选择后动态改变选择器的宽度，这会造成 Tag 区域样式显示问题。`v-model` 的值为当前被选中的职位选项的 **value** 属性值。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">基础单选</span>
      <hr-position-cascader v-model="value1" placeholder="基础单选" />
    </div>
    <div class="block">
      <span class="demonstration">基础多选</span>
      <hr-position-cascader v-model="value2" placeholder="基础多选" :map="map" @change="change" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref([]);
const map = { multiple: true };
const change = (val) => {
  console.log(val);
};
</script>
```

### 定制需要显示的职位簇

可通过 `includeClans` 方法设置需要显示的职位簇，它是由对应 **value** 值组成的数组。

```vue
<template>
  <hr-position-cascader ref="selector" v-model="value" :map="map" :includeClans="includeClans" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref([]);
const includeClans = [1, 6, 14];
const map = { multiple: true };
</script>
```

### 级联面板展示层级

设置显示的级联层级数。可通过 `level` 来设置显示层级数，默认三级。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">仅展示一级</span>
      <hr-position-cascader v-model="value1" :level="1" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">仅展示二级</span>
      <hr-position-cascader ref="selector" v-model="value2" multiple :level="2" :map="map" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref([1]);
const value2 = ref([1]);
const map = { multiple: true };
</script>
```

### 多选Tag展示

多选模式下，默认情况下会展示所有已选中的选项的Tag，你可以使用`collapseTags`来折叠Tag。可以使用`tagsLength`来设置Tag最大展示文字数。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">默认显示所有Tag</span>
      <hr-position-cascader v-model="value1" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">折叠展示Tag</span>
      <hr-position-cascader v-model="value2" collapseTags :map="map" :tagsLength="7" />
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

### 仅展示最后一级

可以仅在输入框中显示选中项最后一级的职级，而不是选中职级所在的完整路径。属性 `showAllLevels` 定义了是否显示完整的路径，将其赋值为`false`则仅显示最后一级。

```vue
<template>
  <hr-position-cascader v-model="value" :showAllLevels="false" :map="map" :filterable="false" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref([]);
const map = { multiple: true };
</script>
```

### 多语言

属性 `lang` 定义了展示语言，默认中文，可选值`en`。

```vue
<template>
  <hr-position-cascader v-model="value" lang="en" :map="map" @change="change" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref([]);
const map = { multiple: true };
const change = (val) => {
  console.log(val);
};
</script>
```

### 可搜索

可以使用`filterable`属性来开启搜索功能, 默认开启搜索功能。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">不可搜索</span>
      <hr-position-cascader v-model="value1" :filterable="false" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">可搜索</span>
      <hr-position-cascader v-model="value2" :map="map" />
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
  <hr-position-cascader v-model="value" clearUnmatchedOptions :map="{ multiple: true }" />
</template>
<script setup>
import { ref } from 'vue';
const value = ref(['这个会被过滤', 46, '不展示']);
</script>
```

### 尺寸

可通过 `size` 属性指定输入框的尺寸，除了默认的大小外，提供了**medium**、**small**尺寸。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <span class="demonstration">默认尺寸</span>
      <hr-position-cascader v-model="value1" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">中等尺寸</span>
      <hr-position-cascader size="medium" v-model="value2" :map="map" />
    </div>
    <div class="block">
      <span class="demonstration">较小尺寸</span>
      <hr-position-cascader size="small" v-model="value3" :map="map" />
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

选择器内置的职位数据是在初始时从远程服务器拉取的，用户可替换自己的数据源。`getPositionData` 属性接收一个 `Promise`，完成状态时的返回值为有清晰层级结构的职位集合，如果数据源字段与选择器默认要求的 **value，label，children** 不一致，可通过 `map` 属性进行映射。

```vue
<template>
  <hr-position-cascader v-model="value" :map="map" :getPositionData="customGetPositionData"></hr-position-cascader>
</template>
<script setup>
import { ref } from 'vue';
const value = ref([]);
const map = {
  value: 'id',
  label: 'name',
  multiple: true,
};
const customGetPositionData = () => {
  const remoteData = [
    {
      id: '1',
      name: '技术类',
      children: [
        {
          id: '1-1',
          name: '软件开发',
          children: [
            { id: '1-1-1', name: '后台开发' },
            { id: '1-1-2', name: '测试开发' },
          ],
        },
        {
          id: '1-2',
          name: '技术运营',
        },
        {
          id: '1-3',
          name: '技术研究',
          children: [
            { id: '1-3-1', name: '机器学习' },
            { id: '1-3-2', name: '计算机视觉' },
          ],
        },
      ],
    },
    {
      id: '2',
      name: '产品类',
      children: [
        { id: '2-1', name: '产品经理' },
        { id: '2-2', name: '游戏策划' },
      ],
    },
  ];
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve(remoteData);
    }, 300);
  });
};
</script>
```

## API

### 属性

| 参数            | 说明                                                                      | 类型    | 可选值             | 默认值  |
| --------------- | ------------------------------------------------------------------------- | ------- | ------------------ | ------- |
| v-model / modelValue | 绑定值                                                               | Array/String/Number    | —    | —       |
| size            | 输入框尺寸                                                                | String  | medium/small              | —       |
| level           | 层级数                                                                    | Number  | 1、2、3            | 3       |
| lang            | 语言                                                                      | String  | 中文: zh，英文: en | zh      |
| disabled        | 是否禁用                                                                  | Boolean | —                  | false   |
| collapseTags    | 多选模式下是否折叠Tag                                                     | Boolean | —                  | false   |
| tagsLength      | Tag最大展示文字数, 最小1                                                  | Number  | —                  | 13      |
| showTotal       | 是否显示后置的已选数量                                                    | Boolean | —                  | true    |
| placeholder     | 占位符                                                                    | String  | —                  | —       |
| filterable      | 是否可搜索选项                                                            | Boolean | —                  | true    |
| separator       | 选项分隔符                                                                | String  | —                  | 斜杠'/' |
| clearUnmatchedOptions  | 回显时清除不存在选项列表中的选项                                   | Boolean               | —                  | false    |
| includeClans    | 由需要包含的职位簇value组成的数组, 不设置时默认全部加载, 具体职位簇见下表 | Array   | —                  | —       |
| map             | 映射配置，具体见下表                                                      | Object  | —                  | —       |
| getPositionData | 获取层级职位数据的方法                                                    | Promise | —                  | —       |
| customClass     | 自定义类名                                                                | String                | —            | —          |

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

### 职位簇 (PostionClan)

| 职位簇值 | 名称           | 职位簇值 | 名称         | 职位簇值 | 名称              |
| -------- | -------------- | -------- | ------------ | -------- | ----------------- |
| 1        | 管理族         | 6        | 操作族       | 14       | 产品/项目族（PD） |
| 15       | 管理族（LS）   | 17       | 专业族（SC） | 18       | 技术族（TE）      |
| 19       | 市场族（MA）   | 20       | 客服族       | 22       | 设计族（DG）      |
| 101      | Tencent Global |
