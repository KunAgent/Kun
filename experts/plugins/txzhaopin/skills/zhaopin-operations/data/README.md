# 数据文件说明

本目录包含腾讯校招系统的静态数据文件，用作离线参考。

## 📁 文件列表

### position-tree-raw.json
**原始职位树数据**
- 来源：`GET /tool/resume/api/web/campus_post/campus_position_tree`
- 用途：完整的职位层级结构（包含所有分类和职位）
- 结构：嵌套的树形结构，每个节点包含 `id`、`title`、`children`
- 大小：~433KB

### position-id-mapping.json
**职位ID映射数据**
- 用途：快速查找职位ID与名称的对应关系
- 包含内容：
  - `id_to_name`：ID → 职位名称/路径
  - `name_to_id`：职位名称 → ID列表
  - `category_positions`：分类 → 职位ID列表
  - `top_categories`：五大类（技术/产品/设计/市场/职能）的职位ID数组

### flow-status-raw.json
**原始流程状态数据**
- 来源：`GET /resume/campus/api/v1/dictionary/?types=Flow`
- 用途：完整的招聘流程状态列表（23个状态）
- 结构：数组，每个状态包含 `did`、`name`、`ordering`
- 大小：~6KB

### flow-status-mapping.json
**流程状态映射数据**
- 用途：快速查找流程状态ID与名称的对应关系
- 包含内容：
  - `id_to_name`：状态ID → 状态名称
  - `name_to_id`：状态名称 → 状态ID

## 🔄 数据更新

**更新频率**：建议每季度更新一次

**更新方法**：
```bash
# 1. 获取最新职位树
curl -X GET 'https://zhaopin.woa.com/tool/resume/api/web/campus_post/campus_position_tree' \
  -H 'Cookie: RIO_TOKEN=...' \
  -o position-tree-raw.json

# 2. 运行解析脚本生成映射文件
python parse_positions.py
```

## 📊 数据统计（截至 2026-03-20）

**职位数据：**
- **总节点数**：551
- **职位分类数**：30
- **具体职位数**：521

**一级分类职位数：**
- 技术类：402 个
- 产品类：26 个
- 设计类：32 个
- 市场类：25 个
- 职能类：36 个

**流程状态数据：**
- **流程状态总数**：23 个
- **筛选阶段**：4 个状态
- **面试阶段**：5 个状态
- **Offer阶段**：4 个状态
- **录用阶段**：4 个状态
- **异常/放弃**：4 个状态
- **项目锁定**：2 个状态

## 💡 使用建议

1. **开发调试**：使用这些静态文件作为参考
2. **生产环境**：调用接口获取实时数据（职位可能变更）
3. **离线场景**：当无法访问接口时，使用这些文件提供基础功能

## ⚠️ 注意事项

- 这些数据文件是**快照**，可能与线上实时数据不一致
- 腾讯校招职位会根据业务需求调整，请定期更新
- 如遇到职位ID无效的情况，说明数据已过期，需重新获取
