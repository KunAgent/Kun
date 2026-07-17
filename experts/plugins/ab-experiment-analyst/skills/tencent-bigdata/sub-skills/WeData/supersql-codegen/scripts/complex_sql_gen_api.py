import requests
SESSION = "http://llmapp.woa.com/api/v1/chatflows/1029b535-a9f1-49e0-a0e2-9c5b8899bd44/sessions"
PREDICTION = "http://llmapp.woa.com/api/v1/sessions/{session_id}/prediction"

def create_session():
    response = requests.post(SESSION)
    return response.json()


def query(session_id, payload):
    response = requests.post(PREDICTION.format(session_id=session_id), json=payload)
    return response.json()

def run(question, tables=[], user="", cmk=None, cmk_id=None):
    if not tables:
        raise ValueError("tables must not be empty")
    if not user:
        raise ValueError("user must be provided")
    if not cmk or not cmk_id:
        raise ValueError("cmk and cmk_id must be provided for authentication")

    session_id = create_session()["id"]
    # print(session_id)
    
    payload = {
        "question": question + "。" + "，".join(tables),
        "override_config": {
            "vars": {
                "username": user,
                "auth": {
                    "username": user,
                    "cmk": cmk,
                    "cmk_id": cmk_id,
                },
            }
        },
    }
    response = query(session_id, payload)
    print("=======生成SQL======")
    print(response['data']['observation'])
    print("===================")

if __name__ == "__main__":
    import argparse

    # Usage:
    # python3 complex_sql_gen_api.py --query "查询数据地图昨天访问量" --table "bg_monitor.wedata_fore" --user_name "" --cmk "" --cmk_id ""
    parser = argparse.ArgumentParser(description="SuperSQL complex code generation API caller")
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
    print("cmk:", f"(len={len(args.cmk)})" if args.cmk else None)
    print("cmk_id:", args.cmk_id)
    print("===========")
    run(question=args.query, tables=[args.table], user=args.user_name, cmk=args.cmk, cmk_id=args.cmk_id)