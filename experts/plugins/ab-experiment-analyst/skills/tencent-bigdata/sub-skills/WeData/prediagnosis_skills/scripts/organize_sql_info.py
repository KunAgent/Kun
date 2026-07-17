import json
from argparse import ArgumentParser
from typing import Dict, List, Optional
from pathlib import Path

class ProcessSQLInfo:
    """Class for processing sliced SQL information and generating diagnosis hints."""

    def __init__(self):
        pass

    def process_table_info(self, table_details: List[Dict], sql_query: str) -> str:
        # Process table details to generate optimization material
        table_infos = []
        for table_detail in table_details:
            table_name = table_detail.pop('tableName')
            current_info = [f"  - 表名: {table_name}"]
            table_description = table_detail.get('description')
            if table_description:
                current_info.append(f"    - 表描述: {table_description}")
            current_info.append(f"    - 列信息")
            columns = table_detail['columns']
            # 只保留在SQL中出现的列，以免上下文长度过长
            for column in columns:
                if column['name'] in sql_query:
                    current_info.append(f"      - 列名: {column['name']}, 列类型: {column['type']}")
            current_info.append("    - 分区列信息")
            partition_columns = table_detail['partitionColumns']
            for par_column in partition_columns:
                current_info.append(f"      - 列名: {par_column['name']}, 列类型: {par_column['type']}")
            
            def calculate_size(table_size: Optional[int]) -> str:
                if not table_size:
                    return None
                
                if table_size > 1024 ** 4:
                    return f"{table_size // (1024 ** 4)} TB"
                elif table_size > 1024 ** 3:
                    return f"{table_size // (1024 ** 3)} GB"
                elif table_size > 1024 ** 2:
                    return f"{table_size // (1024 ** 2)} MB"
                elif table_size > 1024:
                    return f"{table_size // 1024} KB"
                elif table_size > 0:
                    return f"{table_size} B"
                else:
                    return 0
            
            temp_table = bool(table_detail['tempTable'])
            total_size = calculate_size(table_detail['totalSize'])
            if total_size:
                current_info.append(f"    - 表大小: {total_size}")
            elif temp_table:
                current_info.append(f"    - 表大小: 临时表, 无需考虑表规模")
            elif total_size == 0:
                current_info.append(f"    - 表大小: 空表")
            
            partition_size = calculate_size(table_detail['partitionSize'])
            if partition_size:
                current_info.append(f"    - 分区大小: {partition_size}")
            elif temp_table:
                current_info.append(f"    - 分区大小: 临时表, 无需考虑分区规模")
            elif partition_size == 0:
                current_info.append(f"    - 分区大小: 空分区")

            table_infos.append('\n'.join(current_info))
        
        return '\n'.join(table_infos)

    def process_complexity_info(self, complexity_details: Dict) -> str:
        # Process complexity information to generate optimization material
        complexity_infos = []
        if 'operators' in complexity_details:
            operator_info = list(set(complexity_details.pop('operators')))
            operator_info = ", ".join(operator_info)
            if operator_info:
                complexity_infos.append(f"  - 关键算子包括:\n{operator_info}")
        if 'udf' in complexity_details:
            udf_info = list(set(complexity_details.pop('udf')))
            udf_info = ", ".join(udf_info)
            if udf_info:
                complexity_infos.append(f"  - 用户自定义函数有: {udf_info}")
        if 'fieldCount' in complexity_details:
            field_count = complexity_details.pop('fieldCount')
            if field_count > 0:
                complexity_infos.append(f"  - 查询字段个数为: {field_count}")
        return "\n".join(complexity_infos)

    def process_sliced_sql(self, details: Dict, idx: int) -> str:
        sql_query = details['sql']
        optim_material_list = [f'第{idx}条SQL为:\n```sql\n{sql_query}\n```']
        business_requirement = details.get('business_requirement')
        if business_requirement:
            optim_material_list.append(f'该SQL业务需求为: {business_requirement}')
        table_content = '未能获取表信息'
        if 'table' in details:
            if (table_infos := self.process_table_info(details['table'], sql_query)):
                table_content = f'该SQL涉及的表(包括实体表和临时表)的详细信息包括:\n{table_infos}'
        optim_material_list.append(table_content)
        # 利用其他信息
        if (complexity_infos := self.process_complexity_info(details)):
            optim_material_list.append(f'该SQL复杂性分析:\n{complexity_infos}')
        compilation = details.get('compilation', [])
        # Support both list (new format) and string (legacy format)
        if isinstance(compilation, list):
            # Filter out entries containing 'Encountered ";"'
            filtered = [c for c in compilation if 'Encountered ";"' not in c]
            if filtered:
                optim_material_list.append(f'该SQL编译结果:\n' + '\n'.join(filtered))
            else:
                optim_material_list.append(f'该SQL编译结果: 无')
        elif compilation and 'Encountered ";"' not in compilation:
            optim_material_list.append(f'该SQL编译结果:\n{compilation}')
        else:
            optim_material_list.append(f'该SQL编译结果: 无')
        return '\n'.join(optim_material_list)

    def process_all_sliced_sqls(self, sliced_sql_details: List[Dict], supplement_knowledge: List[str] = None) -> str:
        diag_hints_list = ['## 输入数据']
        for i, sql_details in enumerate(sliced_sql_details, start=1):
            diag_hint = self.process_sliced_sql(sql_details, i)
            diag_hints_list.append(diag_hint)
        if supplement_knowledge:
            diag_hints_list.append('## 补充背景')
            for knowledge in supplement_knowledge:
                diag_hints_list.append(f'  - {knowledge}')
        return '\n\n'.join(diag_hints_list)

if __name__ == "__main__":
    parser = ArgumentParser(description="Process sliced SQL details and generate diagnosis hints.")
    parser.add_argument("--input_path", type=str, help="Path to JSON file containing sliced SQL details", required=True)
    parser.add_argument("--output_path", type=str, help="Path to output file for diagnosis hints", required=True)
    args = parser.parse_args()

    input_path = Path(args.input_path)
    output_path = Path(args.output_path)

    processor = ProcessSQLInfo()
    raw_data = json.loads(input_path.read_text())
    # Support both raw list and structured input with supplement_knowledge
    if isinstance(raw_data, dict):
        sliced_sql_details = raw_data.get('sliced_sql_details', raw_data.get('data', []))
        supplement_knowledge = raw_data.get('supplement_knowledge', [])
    else:
        sliced_sql_details = raw_data
        supplement_knowledge = []
    diag_hints = processor.process_all_sliced_sqls(sliced_sql_details, supplement_knowledge)
    output_path.write_text(diag_hints)
    

    