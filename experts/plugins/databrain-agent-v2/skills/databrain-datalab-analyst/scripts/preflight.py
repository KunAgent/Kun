#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Databrain Skill 前置条件检查脚本

功能：
1. 检查必需环境变量
2. 验证 Token 有效性
3. 输出诊断信息

使用方式：
    python preflight.py [--scene <1|2|3>] [--verbose]

场景说明：
    1 - 内网客户端 (OpenClaw/BoxAI)
    2 - 外网客户端 (Claude Code)
    3 - 平台服务 (Databrain 平台内)
"""

import os
import sys
import json
import argparse
import urllib.request
import urllib.error
from datetime import datetime

# 颜色输出
class Colors:
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    CYAN = '\033[96m'
    RESET = '\033[0m'
    BOLD = '\033[1m'

def color_print(msg: str, color: str = ''):
    """带颜色的打印（Windows 终端兼容）"""
    try:
        if sys.platform == 'win32':
            import ctypes
            kernel32 = ctypes.windll.kernel32
            kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
    except:
        color = ''
    print(f"{color}{msg}{Colors.RESET if color else ''}")

def check_env_var(name: str, required: bool = True, default: str = None) -> tuple:
    """检查环境变量"""
    value = os.environ.get(name, default)
    if value:
        if 'TOKEN' in name.upper():
            display = f"{value[:10]}...{value[-4:]}" if len(value) > 20 else "***"
        else:
            display = value
        return True, display
    return not required, None

def verify_token(host: str, token: str, verbose: bool = False) -> tuple:
    """验证 Token 有效性"""
    url = f"{host}/api/v1/permission/user/info"
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {token}' if not token.startswith('Bearer ') else token
    }
    
    if verbose:
        color_print(f"  验证地址: {url}", Colors.CYAN)
    
    try:
        req = urllib.request.Request(url, headers=headers, method='GET')
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            if data.get('code') == 200:
                user_info = data.get('data', {})
                username = user_info.get('username', 'unknown')
                return True, f"用户: {username}"
            else:
                return False, f"API 返回错误: {data.get('msg', 'unknown')}"
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return False, "Token 无效或已过期"
        elif e.code == 403:
            return False, "Token 无权限"
        return False, f"HTTP 错误: {e.code}"
    except urllib.error.URLError as e:
        return False, f"网络错误: {e.reason}"
    except Exception as e:
        return False, f"验证失败: {str(e)}"

def get_scene_config(scene: int) -> dict:
    """获取场景配置"""
    configs = {
        1: {
            'name': '内网客户端',
            'suffix': '',
            'default_host': 'https://databrain.intlgame.com',
            'token_source': 'OpenClaw 环境变量自动注入',
            'required_vars': ['DATABRAIN_TOKEN'],
            'optional_vars': ['DATABRAIN_HOST'],
        },
        2: {
            'name': '外网客户端',
            'suffix': '-global',
            'default_host': 'https://databrain-global.intlgame.com',
            'token_source': 'Token 管理页面获取',
            'required_vars': ['DATABRAIN_TOKEN'],
            'optional_vars': ['DATABRAIN_HOST'],
        },
        3: {
            'name': '平台服务',
            'suffix': '-service',
            'default_host': None,
            'token_source': '上层服务动态传入',
            'required_vars': ['DATABRAIN_TOKEN', 'DATABRAIN_HOST'],
            'optional_vars': ['DATABRAIN_DISPLAY_HOST'],
        },
    }
    return configs.get(scene, configs[3])

def run_preflight(scene: int = 3, verbose: bool = False, verify: bool = True) -> bool:
    """执行前置条件检查"""
    config = get_scene_config(scene)
    all_passed = True
    
    color_print(f"\n{'='*50}", Colors.CYAN)
    color_print(f" Databrain Knowledge Analyst 前置条件检查", Colors.BOLD)
    color_print(f" 场景: {config['name']} (场景 {scene})", Colors.CYAN)
    color_print(f" 时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", Colors.CYAN)
    color_print(f"{'='*50}\n", Colors.CYAN)
    
    # 1. 检查必需环境变量
    color_print("📋 检查必需环境变量:", Colors.BOLD)
    for var in config['required_vars']:
        default = config['default_host'] if var == 'DATABRAIN_HOST' else None
        passed, value = check_env_var(var, required=True, default=default)
        if passed and value:
            color_print(f"  ✅ {var}: {value}", Colors.GREEN)
        else:
            color_print(f"  {var}: 未设置", Colors.RED)
            all_passed = False
    
    # 2. 检查可选环境变量
    if config['optional_vars']:
        color_print("\n📋 检查可选环境变量:", Colors.BOLD)
        for var in config['optional_vars']:
            default = config['default_host'] if var == 'DATABRAIN_HOST' else None
            passed, value = check_env_var(var, required=False, default=default)
            if value:
                color_print(f"  ✅ {var}: {value}", Colors.GREEN)
            else:
                color_print(f"  ⚠️  {var}: 未设置 (将使用默认值)", Colors.YELLOW)
    
    # 3. 验证 Token 有效性
    if verify and all_passed:
        color_print("\n🔐 验证 Token 有效性:", Colors.BOLD)
        token = os.environ.get('DATABRAIN_TOKEN', '')
        host = os.environ.get('DATABRAIN_HOST', config['default_host'])
        
        if host and token:
            passed, msg = verify_token(host, token, verbose)
            if passed:
                color_print(f"  ✅ Token 有效 - {msg}", Colors.GREEN)
            else:
                color_print(f"  Token 无效 - {msg}", Colors.RED)
                all_passed = False
        else:
            color_print(f"  ⚠️  跳过验证 (缺少 Host 或 Token)", Colors.YELLOW)
    
    # 4. 输出结果
    color_print(f"\n{'='*50}", Colors.CYAN)
    if all_passed:
        color_print(" ✅ 前置条件检查通过！可以开始使用 Skill", Colors.GREEN)
    else:
        color_print(" 前置条件检查未通过，请检查上述问题", Colors.RED)
        color_print(f"\n💡 提示: Token 获取方式 - {config['token_source']}", Colors.YELLOW)
    color_print(f"{'='*50}\n", Colors.CYAN)
    
    return all_passed

def main():
    parser = argparse.ArgumentParser(
        description='Databrain Knowledge Analyst 前置条件检查',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
场景说明:
  1 - 内网客户端 (OpenClaw/BoxAI)
  2 - 外网客户端 (Claude Code)
  3 - 平台服务 (Databrain 平台内)  - 默认

示例:
  python preflight.py                    # 默认场景3（平台服务）
  python preflight.py --scene 1          # 内网客户端
  python preflight.py --scene 3 --verbose  # 详细模式
  python preflight.py --no-verify        # 跳过 Token 验证
        """
    )
    parser.add_argument('--scene', '-s', type=int, choices=[1, 2, 3], default=3,
                        help='使用场景 (1=内网, 2=外网, 3=平台服务，默认3)')
    parser.add_argument('--verbose', '-v', action='store_true',
                        help='显示详细信息')
    parser.add_argument('--no-verify', action='store_true',
                        help='跳过 Token 有效性验证')
    
    args = parser.parse_args()
    
    success = run_preflight(
        scene=args.scene,
        verbose=args.verbose,
        verify=not args.no_verify
    )
    
    sys.exit(0 if success else 1)

if __name__ == '__main__':
    main()
