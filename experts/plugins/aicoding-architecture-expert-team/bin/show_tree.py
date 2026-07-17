#!/usr/bin/env python3
"""展示 myteam 目录树结构"""

import os
from pathlib import Path

MYTEAM_DIR = Path(__file__).parent.parent

def show_tree(directory, prefix="", max_depth=4, current_depth=0):
    if current_depth > max_depth:
        return
    
    items = sorted(directory.iterdir(), key=lambda x: (x.is_file(), x.name))
    for i, item in enumerate(items):
        if item.name.startswith(".DS_Store") or item.name.startswith("__pycache__"):
            continue
        is_last = i == len(items) - 1
        connector = "└── " if is_last else "├── "
        line = prefix + connector + item.name
        
        if item.is_dir():
            line += "/"
            print(line)
            new_prefix = prefix + ("    " if is_last else "│   ")
            show_tree(item, new_prefix, max_depth, current_depth + 1)
        else:
            print(line)

print("myteam/ 目录结构\n")
print("myteam/")
show_tree(MYTEAM_DIR, max_depth=4)
