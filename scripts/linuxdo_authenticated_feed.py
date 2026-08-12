#!/usr/bin/env python3
import asyncio
import json
import sys
from typing import Any
from urllib.parse import quote

from curl_cffi.requests import AsyncSession


BASE_URL = "https://linux.do"
RETRYABLE_STATUSES = {429, 502, 503, 504, 522, 524}
TOPIC_LIMIT = 5


async def request_json(session: AsyncSession, url: str, headers: dict[str, str], retry_count: int) -> dict[str, Any]:
    for attempt in range(retry_count + 1):
        try:
            response = await session.get(url, headers=headers)
            if response.status_code == 200:
                return response.json()
            if response.status_code not in RETRYABLE_STATUSES or attempt >= retry_count:
                raise RuntimeError(f"HTTP {response.status_code}")
        except RuntimeError:
            raise
        except Exception as error:
            if attempt >= retry_count:
                raise RuntimeError(type(error).__name__) from None
        await asyncio.sleep(2**attempt)
    raise RuntimeError("请求失败")


def topic_to_item(topic: dict[str, Any], detail: dict[str, Any]) -> dict[str, Any]:
    first_post = (detail.get("post_stream", {}).get("posts") or [{}])[0]
    topic_id = topic.get("id") or detail.get("id")
    slug = topic.get("slug") or detail.get("slug") or "topic"
    return {
        "title": detail.get("title") or topic.get("title") or "",
        "link": f"{BASE_URL}/t/{quote(str(slug), safe='')}/{topic_id}",
        "content": first_post.get("cooked") or "",
        "author": first_post.get("display_username") or first_post.get("name") or first_post.get("username") or "",
        "date": detail.get("created_at") or topic.get("created_at"),
        "image": detail.get("image_url") or topic.get("image_url") or "",
    }


async def main() -> None:
    request = json.load(sys.stdin)
    cookie = str(request.get("cookie") or "").strip()
    username = str(request.get("username") or "").strip()
    retry_count = min(max(int(request.get("retryCount") or 0), 0), 10)
    if not cookie or not username:
        raise RuntimeError("缺少登录配置")

    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cookie": cookie,
        "Referer": f"{BASE_URL}/u/{quote(username, safe='')}/activity/topics",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "X-Requested-With": "XMLHttpRequest",
        "Discourse-Logged-In": "true",
    }
    created_url = f"{BASE_URL}/topics/created-by/{quote(username, safe='')}.json?no_definitions=true&order=created"

    async with AsyncSession(
        impersonate="chrome146",
        timeout=60,
        verify=False,
        allow_redirects=True,
    ) as session:
        created = await request_json(session, created_url, headers, retry_count)
        topics = (created.get("topic_list", {}).get("topics") or [])[:TOPIC_LIMIT]
        items = []
        for topic in topics:
            detail_url = f"{BASE_URL}/t/topic/{topic['id']}.json"
            detail = await request_json(session, detail_url, headers, retry_count)
            items.append(topic_to_item(topic, detail))
    print(json.dumps({"ok": True, "items": items}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(json.dumps({"ok": False, "error": f"Linux.do登录补全失败: {error}"}, ensure_ascii=False))
        raise SystemExit(1)
