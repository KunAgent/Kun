# HrDictSelector 基础字典选择器

## 组件说明

根据不同的字典名称，使用下拉菜单展示对应的选项并选择内容。

字典项参考 [核心人事业务字段管理](https://hr-core.woa.com/web/dictionaryView/dictionary?key=30)

## 基础单选

适用于广泛的基础单选，用Tag展示已选内容。

```vue
<template>
    <div class="example_init_box">
        <hr-dict-selector v-model="value" type="1" placeholder="请选择" @change="change"/>
    </div>
</template>
<script setup>
import { ref } from 'vue';
const value = ref('');
const change = (val) => {
  console.log(val);
}
</script>

<style lang="less" scoped></style>
```

## 基础多选

适用性较广的基础多选，用Tag展示已选内容。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
      <hr-dict-selector v-model="value1" multiple type="1" />
    </div>
    <div class="block">
      <hr-dict-selector
        v-model="value2"
        multiple
        type="1"
        :tagsLength="3"
        :filterable="false"
        collapse-tags
      />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref([]);
const value2 = ref([]);
</script>
<style lang="less" scoped></style>
```

## 有排除选项

排除选项不会显示在下拉菜单中。

```vue
<template>
  <div class="example_init_box">
    <hr-dict-selector v-model="value" type="2" :exclude="exclude" placeholder="请选择" />
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value = ref('');
const exclude = ['正式', '外聘', '实习'];
</script>
<style lang="less" scoped></style>
```

## 自定义选项

可以自定义下拉菜单中的选项。

```vue
<template>
  <div class="example_flex_box">
    <div class="block">
        <hr-dict-selector v-model="value1" :data="items1" labelMap="name" valueMap="mark" />
    </div>
    <div class="block">
        <hr-dict-selector v-model="value2" :promise="promise" />
    </div>
  </div>
</template>
<script setup>
import { ref } from 'vue';
const value1 = ref('');
const value2 = ref('');
const items1 = [
  { name: 'T族', mark: '选项1' },
  { name: 'P族', mark: '选项2' }
]
const promise = new Promise((resolve, reject) => {
  // 获取远程数据源
  const remoteData = [
    { label: 'M族', value: '选项1' },
    { label: 'S族', value: '选项2' }
  ];
  setTimeout(() => {
    resolve(remoteData);
  }, 300)
})
</script>
<style lang="less" scoped></style>
```

## API

### 属性 (Props)

| 参数 | 说明 | 类型 | 可选值 | 默认值 |
| --- | --- | --- | --- | --- |
| v-model / modelValue | 绑定值 | Array / String / Number | — | — |
| type | 字典名称, 目前支持的值见字典表 | String / Number | — | — |
| multiple | 是否多选 | Boolean | — | false |
| size | 输入框尺寸 | String | medium / small | — |
| disabled | 是否禁用 | Boolean | — | false |
| collapse-tags | 多选时是否将选中值按文字的形式展示 | Boolean | — | false |
| tagsLength | 多选时Tag最大展示文字数, 最小1 | Number | — | 13 |
| placeholder | 占位符 | String | — | 请选择 |
| filterable | 是否可搜索选项 | Boolean | — | true |
| showTotal | 多选时是否显示后置的已选数量 | Boolean | — | false |
| no-match-text | 搜索条件无匹配时显示的文字 | String | — | 无匹配数据 |
| exclude | 排除选项 | Array | — | [] |
| data | 自定义选项 | Array | — | [] |
| promise | 覆盖组件内部获取选项数据源的默认方法 | Promise | — | — |
| labelMap | 指定选项标签为选项对象的某个属性值 | String | — | 'label' |
| valueMap | 选项的值为选项对象的某个属性值 | String | — | 'value' |
| customClass | 自定义类名 | String | — | — |

### 事件 (Events)

| 事件名称 | 说明 | 回调参数 |
| --- | --- | --- |
| change | 选中项发生变化时触发 | 目前的选中项 |
| visible-change | 下拉框出现/隐藏时触发 | 出现则为 true，隐藏则为 false |
| remove-tag | 多选模式下移除tag时触发 | 移除的tag值 |
| clear | 单选模式下用户点击清空按钮时触发 | — |
| blur | 当 input 失去焦点时触发 | (event: Event) |
| focus | 当 input 获得焦点时触发 | (event: Event) |
