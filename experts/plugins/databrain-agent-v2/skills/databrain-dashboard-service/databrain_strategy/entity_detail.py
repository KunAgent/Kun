from typing import Dict
import requests
import os
from loguru import logger

from dashboard_common.config import globalvar as gl
from dashboard_common.rainbow_utils import init_rainbow

def get_entity_detail(id: str) -> Dict[str, any]:
    if id == "":
        logger.error("id cannot be empty")
        raise Exception("id cannot be empty")
    rb_system_json = gl.get_value("rb_system_json", expected_type=dict)
    if rb_system_json == None:
        logger.error("请先调用init_rainbow初始化")
        raise Exception("请先调用init_rainbow初始化")
    databrain_config = rb_system_json.get("databrain_config")
    if databrain_config == None:
        logger.error("Rainbow没有databrain_config")
        raise Exception("Rainbow没有databrain_config")
    host = databrain_config.get("host")
    if host == None:
        logger.error("databrain_config没有host")
        raise Exception("databrain_config没有host")
    token = databrain_config.get("token")
    if token == None:
        logger.error("databrain_config没有token")
        raise Exception("databrain_config没有token")
    
    url = f"{host}/api/v1/intelligence_pc/chatbi/get_entity_detail"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    }
    data = {
        "entity_type": "auto",
        "level": "custom",
        "ids": [
            id
        ],
        "custom_fields": [
            "release_dates_by_platform"
        ]
    }
    for attempt in range(2):  
        try:
            resp = requests.post(url, headers=headers, json=data)
            logger.info("Response:", resp.json())
            break  # Exit the loop if the request is successful
        except requests.exceptions.RequestException as e:
            logger.warning(f"Attempt {attempt + 1} failed: {e}")
            if attempt == 1:  
                logger.error("Request failed.")
                raise e
    
    return resp.json()

if __name__ == "__main__":
    # 测试例子
    gl.set_value("ENV", os.environ.get("ENVIRONMENT", "local"))
    init_rainbow("databrain_host.base", {"rb_system_json": "system.json"})
    
    print(get_entity_detail("c00002645"))