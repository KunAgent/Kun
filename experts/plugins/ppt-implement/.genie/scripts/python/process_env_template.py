#!/usr/bin/env python3
"""
处理环境特定的模板文件
从指定的环境目录中读取配置并合并到基础 CODEBUDDY.md 文件中
"""

import os
import sys
import re


def replace_env_vars(content, env_vars):
    """替换内容中的环境变量占位符"""
    result = content
    for key, value in env_vars.items():
        # 替换 ${VAR_NAME} 格式
        result = result.replace(f'${{{key}}}', value)
        # 替换 $VAR_NAME 格式（使用 lambda 避免 value 被当作正则表达式）
        result = re.sub(f'\\${key}(?![A-Z_])', lambda m: value, result)
    return result


def get_available_env_types(project_root):
    """获取所有可用的环境类型（core 目录下的子目录）"""
    core_dir = os.path.join(project_root, '.templates', 'core')
    if not os.path.exists(core_dir):
        return []
    env_types = []
    for item in os.listdir(core_dir):
        item_path = os.path.join(core_dir, item)
        if os.path.isdir(item_path) and item != 'base':
            env_types.append(item)
    return env_types


def process_env_template(project_root, env_type):
    """
    处理指定环境类型的模板文件
    
    Args:
        project_root: 项目根目录
        env_type: 环境类型 (cloudstudio, common, 或其他在 core/ 下的子目录)
    
    Returns:
        bool: 处理是否成功
    """
    # 构建路径
    env_template = os.path.join(project_root, f'.templates/core/{env_type}/CODEBUDDY.md')
    base_template = os.path.join(project_root, 'CODEBUDDY.md')
    # 验证文件是否存在
    if not os.path.exists(env_template):
        print(f"❌ Environment template not found: {env_template}")
        return False
    if not os.path.exists(base_template):
        print(f"❌ Base template not found: {base_template}")
        return False
    try:
        with open(env_template, 'r', encoding='utf-8') as f:
            env_content = f.read()
        with open(base_template, 'r', encoding='utf-8') as f:
            base_content = f.read()
        env_content = replace_env_vars(env_content, dict(os.environ))
        # 在 MANUAL ADDITIONS START 标记之前插入内容
        manual_start = '<!-- MANUAL ADDITIONS START -->'
        if manual_start in base_content:
            # 如果存在标记，在标记前插入
            final_content = base_content.replace(
                manual_start, 
                env_content + '\n\n' + manual_start
            )
        else:
            # 如果不存在标记，追加到文件末尾
            final_content = base_content.rstrip() + '\n\n' + env_content
        # 写回基础模板
        with open(base_template, 'w', encoding='utf-8') as f:
            f.write(final_content)
        print(f"✅ Successfully processed '{env_type}' environment template")
        return True

    except Exception as e:
        print(f"❌ Error processing template: {e}")
        return False


def main():
    """主函数：解析命令行参数并处理模板"""
    if len(sys.argv) < 2:
        print("Usage: process_env_template.py [env_type]")
        print("\nArguments:")
        print("  env_type      - Environment type (default: common)")
        print("\nAvailable environment types:")
        print("  - common: Local development environment")
        print("  - cloudstudio: Cloud Studio environment")
        print("  - (or any other subdirectory under .templates/core/)")
        sys.exit(1)
    # 获取项目根目录
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, f'../../..'))
    # 获取环境类型（默认为 cloudstudio）
    env_type = sys.argv[1] if len(sys.argv) >= 2 else 'common'
    # 验证环境类型是否存在
    available_types = get_available_env_types(project_root)
    if env_type not in available_types:
        print(f"❌ Unknown environment type: '{env_type}'")
        print(f"\nAvailable environment types in .templates/core/:")
        for available_type in available_types:
            print(f"  - {available_type}")
        sys.exit(1)
    # 处理模板
    success = process_env_template(project_root, env_type)
    sys.exit(0 if success else 1)

if __name__ == '__main__':
    main()
