#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Draw.io 文件语法检查工具

用法:
    python check_drawio_syntax.py <文件路径或目录路径>
    
示例:
    python check_drawio_syntax.py diagram.drawio        # 检查单个文件
    python check_drawio_syntax.py ./diagrams           # 检查目录
    python check_drawio_syntax.py .                    # 检查当前目录
"""

import os
import sys
import xml.etree.ElementTree as ET
import base64
import zlib
from pathlib import Path


class DrawioSyntaxChecker:
    """Draw.io 文件语法检查器"""
    
    def __init__(self):
        self.total_files = 0
        self.valid_files = 0
        self.invalid_files = 0
        self.errors = []
    
    def check_xml_wellformed(self, file_path):
        """检查 XML 是否格式良好（标签是否正确闭合等）"""
        try:
            tree = ET.parse(file_path)
            return True, tree, None
        except ET.ParseError as e:
            return False, None, f"XML 解析错误: {str(e)}"
        except Exception as e:
            return False, None, f"文件读取错误: {str(e)}"
    
    def check_drawio_structure(self, tree, file_path):
        """检查 draw.io 特定的结构"""
        errors = []
        root = tree.getroot()
        
        # 检查根元素是否为 mxfile
        if root.tag != 'mxfile':
            errors.append(f"根元素应该是 'mxfile'，但找到的是 '{root.tag}'")
            return errors
        
        # 检查必要的属性
        if 'host' not in root.attrib and 'version' not in root.attrib:
            errors.append("警告: mxfile 缺少 'version' 或 'host' 属性")
        
        # 检查是否有 diagram 元素
        diagrams = root.findall('diagram')
        if len(diagrams) == 0:
            errors.append("错误: 没有找到 'diagram' 元素")
            return errors
        
        # 检查每个 diagram
        for idx, diagram in enumerate(diagrams):
            diagram_errors = self.check_diagram(diagram, idx)
            errors.extend(diagram_errors)
        
        return errors
    
    def check_mxGraphModel(self, mxGraphModel, diagram_index):
        """检查 mxGraphModel 结构"""
        errors = []
        
        # 检查 root 元素
        root_elem = mxGraphModel.find('root')
        if root_elem is None:
            errors.append(f"Diagram {diagram_index}: mxGraphModel 中缺少 'root' 元素")
            return errors
        
        # 检查基本的 cell 结构
        cells = root_elem.findall('mxCell')
        if len(cells) < 2:
            errors.append(f"Diagram {diagram_index}: 警告 - root 中至少应该有 2 个 mxCell（id='0' 和 id='1'）")
        else:
            # 检查是否存在 id='0' 和 id='1' 的基础 cell
            cell_ids = [cell.get('id') for cell in cells]
            if '0' not in cell_ids:
                errors.append(f"Diagram {diagram_index}: 缺少 id='0' 的根 mxCell")
            if '1' not in cell_ids:
                errors.append(f"Diagram {diagram_index}: 缺少 id='1' 的图层 mxCell")
        
        # ── 新增检测 1：base64 图标格式检测 ──────────────────────────
        base64_nodes = []
        for cell in cells:
            style = cell.get('style', '')
            if 'data:image/svg+xml;base64,' in style:
                base64_nodes.append(cell.get('id', '(无id)'))
        if base64_nodes:
            errors.append(
                f"Diagram {diagram_index}: ⚠️  以下节点使用了被禁止的 base64 图标格式"
                f"（会导致图标显示为灰色文件图标），请改用 URL 编码格式：{base64_nodes}"
            )
        
        # ── 新增检测 2：连线缺少显式连接点检测 ──────────────────────
        edge_missing_conn = []
        for cell in cells:
            if cell.get('edge') == '1':
                style = cell.get('style', '')
                cell_id = cell.get('id', '(无id)')
                # 检查是否缺少 exitX/exitY 或 entryX/entryY
                missing = []
                if 'exitX' not in style:
                    missing.append('exitX')
                if 'exitY' not in style:
                    missing.append('exitY')
                if 'entryX' not in style:
                    missing.append('entryX')
                if 'entryY' not in style:
                    missing.append('entryY')
                if missing:
                    edge_missing_conn.append(f"id={cell_id}（缺少 {', '.join(missing)}）")
        if edge_missing_conn:
            errors.append(
                f"Diagram {diagram_index}: ⚠️  以下连线缺少显式连接点属性，可能导致线条穿越图标："
                f" {edge_missing_conn}"
            )
        
        # ── 新增检测 3：重复 ID 检测 ──────────────────────────────────
        seen_ids = {}
        duplicate_ids = []
        for cell in cells:
            cid = cell.get('id')
            if cid is not None:
                if cid in seen_ids:
                    duplicate_ids.append(cid)
                else:
                    seen_ids[cid] = True
        if duplicate_ids:
            errors.append(
                f"Diagram {diagram_index}: ❌ 发现重复的 mxCell id，会导致 Draw.io 行为异常：{duplicate_ids}"
            )
        
        return errors
    
    def check_diagram(self, diagram, index):
        """检查单个 diagram 元素"""
        errors = []
        
        # 检查 diagram 是否有 id 属性
        if 'id' not in diagram.attrib:
            errors.append(f"Diagram {index}: 缺少 'id' 属性")
        
        # 检查 diagram 是否有子元素（未压缩格式）
        mxGraphModel = diagram.find('mxGraphModel')
        if mxGraphModel is not None:
            # 未压缩格式，直接检查 mxGraphModel
            return self.check_mxGraphModel(mxGraphModel, index)
        
        # 获取 diagram 内容（压缩格式）
        content = diagram.text
        if not content or content.strip() == '':
            errors.append(f"Diagram {index}: 内容为空（既没有子元素也没有文本内容）")
            return errors
        
        # 检查是否是压缩内容（Base64 编码）
        try:
            # 尝试解码 Base64
            decoded = base64.b64decode(content)
            
            # 尝试解压
            try:
                decompressed = zlib.decompress(decoded, -zlib.MAX_WBITS)
                # 解码为 UTF-8 字符串
                xml_content = decompressed.decode('utf-8')
                
                # 解析解压后的 XML
                try:
                    # URL decode
                    from urllib.parse import unquote
                    xml_content = unquote(xml_content)
                    
                    # 解析 mxGraphModel
                    inner_tree = ET.fromstring(xml_content)
                    
                    # 检查是否为 mxGraphModel
                    if inner_tree.tag != 'mxGraphModel':
                        errors.append(f"Diagram {index}: 解压后的根元素应该是 'mxGraphModel'，但找到的是 '{inner_tree.tag}'")
                    else:
                        # 检查 mxGraphModel 结构
                        model_errors = self.check_mxGraphModel(inner_tree, index)
                        errors.extend(model_errors)
                    
                except ET.ParseError as e:
                    errors.append(f"Diagram {index}: 解压后的内容不是有效的 XML: {str(e)}")
                except Exception as e:
                    errors.append(f"Diagram {index}: 解析解压内容时出错: {str(e)}")
                    
            except zlib.error:
                # 可能未压缩，尝试直接解析
                try:
                    xml_content = decoded.decode('utf-8')
                    inner_tree = ET.fromstring(xml_content)
                    if inner_tree.tag != 'mxGraphModel':
                        errors.append(f"Diagram {index}: 内容根元素应该是 'mxGraphModel'")
                except:
                    errors.append(f"Diagram {index}: 内容既不是有效的压缩数据，也不是有效的 XML")
                    
        except base64.binascii.Error:
            # 不是 Base64，可能是纯 XML
            try:
                inner_tree = ET.fromstring(content)
                if inner_tree.tag != 'mxGraphModel':
                    errors.append(f"Diagram {index}: 内容根元素应该是 'mxGraphModel'")
            except ET.ParseError as e:
                errors.append(f"Diagram {index}: 内容不是有效的 XML: {str(e)}")
        except Exception as e:
            errors.append(f"Diagram {index}: 处理内容时出错: {str(e)}")
        
        return errors
    
    def check_file(self, file_path):
        """检查单个文件"""
        print(f"\n检查文件: {file_path}")
        print("-" * 80)
        
        self.total_files += 1
        
        # 第一步：检查 XML 格式
        is_valid, tree, error = self.check_xml_wellformed(file_path)
        
        if not is_valid:
            print(f"❌ 失败: {error}")
            self.invalid_files += 1
            self.errors.append({
                'file': file_path,
                'error': error
            })
            return False
        
        print("✓ XML 格式良好")
        
        # 第二步：检查 draw.io 特定结构
        structure_errors = self.check_drawio_structure(tree, file_path)
        
        if structure_errors:
            print(f"❌ 发现 {len(structure_errors)} 个结构问题:")
            for err in structure_errors:
                print(f"  - {err}")
            self.invalid_files += 1
            self.errors.append({
                'file': file_path,
                'errors': structure_errors
            })
            return False
        
        print("✓ Draw.io 结构正确")
        print("✅ 文件验证通过")
        self.valid_files += 1
        return True
    
    def scan_directory(self, path):
        """扫描目录下的所有 draw.io 文件或检查单个文件"""
        path_obj = Path(path)
        
        if not path_obj.exists():
            print(f"错误: 路径 '{path}' 不存在")
            return
        
        # 判断是文件还是目录
        if path_obj.is_file():
            # 单个文件模式
            if not (path_obj.suffix == '.drawio' or path_obj.suffix == '.xml'):
                print(f"错误: '{path}' 不是 .drawio 或 .xml 文件")
                return
            
            print(f"检查单个文件: {path_obj.name}")
            print("=" * 80)
            self.check_file(str(path_obj))
            
        elif path_obj.is_dir():
            # 目录模式
            # 查找所有 .drawio 和 .xml 文件
            drawio_files = list(path_obj.rglob('*.drawio'))
            xml_files = list(path_obj.rglob('*.xml'))
            
            all_files = drawio_files + xml_files
            
            if not all_files:
                print(f"在目录 '{path}' 中没有找到 .drawio 或 .xml 文件")
                return
            
            print(f"找到 {len(all_files)} 个文件需要检查")
            print("=" * 80)
            
            for file_path in all_files:
                self.check_file(str(file_path))
        else:
            print(f"错误: '{path}' 不是有效的文件或目录")
            return
        
        # 打印总结
        print("\n" + "=" * 80)
        print("检查完成！")
        print("=" * 80)
        print(f"总文件数: {self.total_files}")
        print(f"✅ 有效文件: {self.valid_files}")
        print(f"❌ 无效文件: {self.invalid_files}")
        
        if self.invalid_files > 0:
            print(f"\n发现问题的文件列表:")
            for error_info in self.errors:
                print(f"\n📄 {error_info['file']}")
                if 'error' in error_info:
                    print(f"   {error_info['error']}")
                elif 'errors' in error_info:
                    for err in error_info['errors']:
                        print(f"   - {err}")


def main():
    """主函数"""
    if len(sys.argv) < 2:
        print("用法: python check_drawio_syntax.py <文件路径或目录路径>")
        print("\n示例:")
        print("  python check_drawio_syntax.py diagram.drawio        # 检查单个文件")
        print("  python check_drawio_syntax.py ./diagrams           # 检查目录")
        print("  python check_drawio_syntax.py .                    # 检查当前目录")
        sys.exit(1)
    
    target_path = sys.argv[1]
    
    checker = DrawioSyntaxChecker()
    checker.scan_directory(target_path)
    
    # 根据结果设置退出码
    if checker.invalid_files > 0:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
