import requests
import json
import traceback

# prob环境 0323 GLM版本
SESSION = "http://llmapp.woa.com/api/v1/chatflows/dc48a83d-331f-4351-82a7-7c5515e76714/sessions"
PREDICTION = "http://llmapp.woa.com/api/v1/sessions/{session_id}/prediction"


# print("Setting:", SESSION, PREDICTION)



def create_session():
    response = requests.post(SESSION)
    return response.json()

def run(query, tables=[], user="", cmk=None, cmk_id=None):
    if not tables:
        raise ValueError("tables must not be empty")
    if not user:
        raise ValueError("user must be provided")
    if not cmk or not cmk_id:
        raise ValueError("cmk and cmk_id must be provided for authentication")

    data = {
        "question": query,
        "stream": True
    }
    variables = {
        "vars": {
            "username": user, # used for sql task submission
            "wedata_config": {
                "candidate_tables": tables,
            },
            "auth": {
                "username": user,
                "cmk": cmk,
                "cmk_id": cmk_id,
            },
    }
    }
    # print(variables)


    # 使用json表单发起请求，变量名为override_config，代表使用外部配置去“覆盖”画布中的已有配置；画布的配置信息由各个业务决定
    data["override_config"] = variables
    # 使用json表单发起请求
    session_id = create_session()['id']

    # print(f"session_id: {session_id}")
    url = PREDICTION.format(session_id=session_id)
    response = requests.post(url, json=data, stream=True)
    result_res = {}
    res_store = []
    try:
        for line in response.iter_lines():
            decoded_line = line.decode("utf-8")
            res = json.loads(decoded_line)
            # if "type" not in res:
            #     continue
            
            if res["type"] == "tool" and 'stream' in res['data']:
                should_save = res['data']["stream"]
            elif "action" in res["data"] and res["data"]["action"] == "database-query":
                should_save = ""
                res_obj = res['data']
            else:
                should_save = str(res['data'])
            if res_store and res["type"] == res_store[-1]['type']:
                res_store[-1]["output"] += should_save
            else:
                res_store.append({"type": res["type"], "output": should_save})
                

            if res["type"] == "tool" and 'stream' in res['data']:
                # print(res['data']["stream"], end="")
                # print(f"(Action:{res['data']['action']}", "Steam Output:", res['data']["stream"])
                # print(res)
                pass
            elif res["type"] == "tool" and 'stream' not in res['data']:
                pass
                # print(res)
            else:
                # pass
                if "Tauth authentication failed" in  str(res):
                    print(res)
            try:
                if res["type"] == "tool" and res["data"]["action"] == "database-query" and 'stream' not in res['data']:
                    sql_list = res["data"]["plan"]
                    print("Planing:", sql_list)
                    sql_list = res["data"]["sql_list"]
                    user_prompt = res["data"]["user_prompt"]
                    db_query_action_input = res
                    # print("SQL list result:", sql_list)
                    for i, sql_ in enumerate(sql_list):
                        print("="*30 + f"SQL {i+1}" + "="*30)
                        print(sql_)
                        print("="*60)
                    # print("="*60)
                    # print('++++ 原始回答:\n', res["data"]['模型回答'])
                    # print("="*60)
                    # print('++++ user_prompt:', user_prompt)
                    result_res = res
            except:
                pass 
    except Exception as e:
        print("ERROR STOP:", e)
        print(traceback.print_exc())
    return result_res


if __name__ == "__main__":
    import argparse

    # Usage:
    # python3 sql_gen_api.py --query "2月1号与3月1号的 用户数 对比" --table "bg_monitor.wedata_fore" --user_name "" --cmk "" --cmk_id ""
    parser = argparse.ArgumentParser(description="SuperSQL code generation API caller")
    parser.add_argument("--query", type=str, required=True, help="Natural language query for SQL generation")
    parser.add_argument("--table", type=str, required=True, help="Candidate table name, e.g. db.table")
    parser.add_argument("--user_name", type=str, required=True, help="Username for task submission")
    parser.add_argument("--cmk", type=str, default=None, help="CMK key for authentication")
    parser.add_argument("--cmk_id", type=str, default=None, help="CMK ID for authentication")
    args = parser.parse_args()

    print("== INPUT ==")
    print("query:", args.query)
    print("table:", args.table)
    print("user:", args.user_name)
    # print("cmk:", f"(len={len(args.cmk)})" if args.cmk else None)
    print("cmk:", args.cmk if args.cmk else None)
    print("cmk_id:", args.cmk_id)
    print("===========") 
    test_result = run(args.query, tables=[args.table], user=args.user_name, cmk=args.cmk, cmk_id=args.cmk_id)