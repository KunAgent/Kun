import json
import time
from typing import Any, Dict

import jwt
import aiohttp
from loguru import logger
import asyncio
from async_lru import alru_cache


class CubeClient:
    max_wait_time = 20
    request_backoff = 1

    def __init__(self, endpoint: str, api_secret: str, security_context: dict):
        self.endpoint = endpoint
        self.api_secret = api_secret
        self.security_context = security_context
        self.token = None
        self._refresh_token()

    def _generate_token(self):
        return jwt.encode(self.security_context, self.api_secret, algorithm="HS256")

    def _refresh_token(self):
        self.token = self._generate_token()

    async def _request(self, route: str, **params):
        request_time = time.time()
        headers = {"Authorization": self.token}
        url = f"{self.endpoint.rstrip('/')}/{route}"
        serialized_params = {k: json.dumps(v) for k, v in params.items()}

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, params=serialized_params) as response:
                    response_data = await response.json()

                    while response_data.get("error") == "Continue wait":
                        if time.time() - request_time > self.max_wait_time:
                            logger.error(
                                f"Request timed out after {self.max_wait_time} seconds", log_type="latency"
                            )
                            return {"error": "Request timed out"}
                        logger.warning(
                            f"Request incomplete, polling again in {self.request_backoff} second(s)"
                        )
                        await asyncio.sleep(self.request_backoff)
                        async with session.get(url, headers=headers, params=serialized_params) as retry_response:
                            response_data = await retry_response.json()

                    if response.status == 403:
                        logger.warning("Received 403, attempting token refresh")
                        self._refresh_token()
                        headers["Authorization"] = self.token
                        async with session.get(url, headers=headers, params=serialized_params) as retry_response:
                            response_data = await retry_response.json()

                    return response_data

        except Exception as e:
            logger.error(f"Request failed: {str(e)}")
            return {"error": f"Request failed: {str(e)}"}

    @alru_cache(maxsize=128, ttl=1800)  # 30分钟缓存，数据描述变化极少
    async def describe(self) -> Dict[str, Any]:
        return await self._request("meta")

    async def query(
        self, query: Dict[str, Any], cast_numerics: bool = True
    ) -> Dict[str, Any]:
        response = await self._request("load", query=query)
        if cast_numerics:
            response = self._cast_numerics(response)
        return response

    def _cast_numerics(self, response: Dict[str, Any]) -> Dict[str, Any]:
        if response.get("data") and response.get("annotation"):
            numeric_keys = set()
            dimensions_and_measures = dict(
                response["annotation"].get("dimensions", {}),
                **response["annotation"].get("measures", {}),
            )
            for column_name, column in dimensions_and_measures.items():
                if column.get("type") == "number":
                    numeric_keys.add(column_name)

            for row in response["data"]:
                for key in numeric_keys:
                    try:
                        row[key] = float(row[key])
                        if row[key].is_integer():
                            row[key] = int(row[key])
                    except (ValueError, TypeError):
                        pass
        return response
