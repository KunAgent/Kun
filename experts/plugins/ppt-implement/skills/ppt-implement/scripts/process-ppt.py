import sys
import subprocess
import os
import re
import json

def get_relative_path(file_path):
    """Convert absolute path to relative path from project root.
    
    Example:
    - /path/to/project/frontend/src/slides/slide-1.js -> frontend/src/slides/slide-1.js
    - /path/to/project/frontend/index.html -> frontend/index.html
    
    Assumes script is executed from project root where 'frontend' directory exists.
    """
    # Find 'frontend' in the path and extract from there
    if '/frontend/' in file_path:
        idx = file_path.find('/frontend/')
        return file_path[idx + 1:]  # +1 to skip the leading '/'
    elif file_path.endswith('/frontend'):
        return 'frontend'
    # If already relative path
    if file_path.startswith('frontend/'):
        return file_path
    return file_path

def start_server(relative_path):
    """Start the PPT preview server if conditions are met.
    
    Conditions:
    - file path contains 'slides/slide-1.js'
    """
    if 'slides/slide-1.js' not in relative_path:
        return
    
    plugin_root = os.environ.get('CODEBUDDY_PLUGIN_ROOT', '')
    print(f"[start_server] CODEBUDDY_PLUGIN_ROOT: {plugin_root}")
    subprocess.run(
        f'{plugin_root}/.genie/scripts/node/process start --restart > /dev/null 2>&1 &',
        shell=True
    )
    print(f"[start_server] command executed")

def capture_screenshot(relative_path):
    """Capture screenshot for PPT poster if conditions are met.
    
    Conditions:
    - file path contains 'data/slide-1.js'
    """
    if 'data/slide-1.js' not in relative_path:
        return
    
    plugin_root = os.environ.get('CODEBUDDY_PLUGIN_ROOT', '')
    project_dir = os.environ.get('CODEBUDDY_PROJECT_DIR', '')
    print(f"[capture_screenshot] CODEBUDDY_PLUGIN_ROOT: {plugin_root}")
    print(f"[capture_screenshot] CODEBUDDY_PROJECT_DIR: {project_dir}")
    subprocess.run(
        f'python3 {plugin_root}/.genie/scripts/python/capture_screenshot.py {project_dir}/docs/posters/app/app-poster.png > /dev/null 2>&1 &',
        shell=True
    )
    print(f"[capture_screenshot] command executed")

def update_index_html(relative_path):
    """Update index.html based on the modified file.
    
    If file path matches slides/slide-\\d+.js pattern, insert a script tag
    before </body> in frontend/index.html.
    """
    # Check if file matches slides/slide-\d+.js pattern
    match = re.search(r'slides/slide-\d+\.js$', relative_path)
    if not match:
        return
    
    # Extract the relative src path (e.g., /src/slides/slide-1.js)
    slide_file = match.group(0)  # e.g., slides/slide-1.js
    src_path = f'/src/{slide_file}'
    
    index_html_path = 'frontend/index.html'
    
    if not os.path.exists(index_html_path):
        print(f"index.html not found: {index_html_path}")
        return
    
    try:
        with open(index_html_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        script_tag = f'<script type="module" src="{src_path}"></script>'
        
        # Check if script tag already exists
        if script_tag in content:
            return
        
        # Insert script tag before </body>
        new_content = content.replace('</body>', f'    {script_tag}\n  </body>')
        
        with open(index_html_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        
        print(f"Added script tag for {src_path} to index.html")
    except Exception as e:
        print(f"Error updating index.html: {e}")

def update_pages_json(relative_path):
    """Update pages.json based on the modified file.
    
    If file path matches slides/slide-\\d+.js pattern, update docs/pages.json
    to include the page entry for this slide.
    """
    # Check if file matches slides/slide-\d+.js pattern
    match = re.search(r'slides/slide-(\d+)\.js$', relative_path)
    if not match:
        return
    
    page_num = int(match.group(1))
    
    docs_dir = 'docs'
    pages_json_path = os.path.join(docs_dir, 'pages.json')
    
    # Create docs directory if not exists
    if not os.path.exists(docs_dir):
        os.makedirs(docs_dir)
    
    # Read existing pages.json or create empty list
    pages = []
    if os.path.exists(pages_json_path):
        try:
            with open(pages_json_path, 'r', encoding='utf-8') as f:
                pages = json.load(f)
        except (json.JSONDecodeError, Exception):
            pages = []
    
    # Check if page entry already exists
    existing_page_nums = {p.get('pageNum') for p in pages}
    if page_num in existing_page_nums:
        return
    
    # Add new page entry
    new_entry = {
        "pageKey": f"ppt-{page_num}",
        "title": "",
        "url": f"/index.html?page={page_num}",
        "poster": "",
        "pageNum": page_num
    }
    pages.append(new_entry)
    
    # Sort by pageNum
    pages.sort(key=lambda x: x.get('pageNum', 0))
    
    # Write updated pages.json
    try:
        with open(pages_json_path, 'w', encoding='utf-8') as f:
            json.dump(pages, f, indent=2, ensure_ascii=False)
        print(f"Updated pages.json with page {page_num}")
    except Exception as e:
        print(f"Error updating pages.json: {e}")

def check_project_type():
    """Check if project type is 'ppt' from docs/project.json.
    
    Returns True if project_type is 'ppt', False otherwise.
    """
    project_json_path = 'docs/project.json'
    
    if not os.path.exists(project_json_path):
        return False
    
    try:
        with open(project_json_path, 'r', encoding='utf-8') as f:
            project_config = json.load(f)
        return project_config.get('project_type') == 'ppt'
    except (json.JSONDecodeError, Exception):
        return False

def main(file_path):
    # Check if file_path is valid
    if not file_path or file_path == 'null' or file_path.strip() == '':
        return
    
    # Check project type first
    if not check_project_type():
        return
    
    # Convert absolute path to relative path
    relative_path = get_relative_path(file_path)
    print(f"Processing file: {relative_path}")

    start_server(relative_path)
    capture_screenshot(relative_path)
    update_index_html(relative_path)
    update_pages_json(relative_path)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        main(sys.argv[1])
    else:
        print("No file path provided")
