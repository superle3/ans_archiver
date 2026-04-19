import asyncio
import random
import time
from typing import TypedDict

from aiohttp import ClientHandlerType, ClientRequest, ClientResponse


class Stats(TypedDict):
    count: int
    requests_per_second: float
    rate_limit: float
    urls: list[str]
    start_time: float


class RateLimitMiddleware:
    """
    Very simple RPS limiter with jitter.
    """

    def __init__(
        self,
        rate_limit: float | int,
        jitter_factor: float,
    ):
        self._rate_limit = rate_limit
        self._jitter_factor = jitter_factor
        self._stats: Stats = {
            "count": 0,
            "requests_per_second": 0.0,
            "rate_limit": rate_limit,
            "urls": [],
            "start_time": -1,
        }

        self._lock: asyncio.Lock | None = None
        self._next_allowed_time: float = -1

    async def __call__(
        self,
        request: ClientRequest,
        handler: ClientHandlerType,
    ) -> ClientResponse:
        host = request.url.host
        if not host:
            return await handler(request)
        self._stats["count"] += 1
        self._stats["urls"].append(str(request.url))

        if self._rate_limit <= 0:
            return await handler(request)

        base_interval = 1.0 / self._rate_limit

        if self._jitter_factor > 0:
            interval = base_interval * (1.0 + self._jitter_factor * random.random())
        else:
            interval = base_interval
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            now = time.monotonic()
            t = self._next_allowed_time

            slot = max(now, t)
            self._next_allowed_time = slot + interval
            if self._stats["start_time"] < 0:
                self._stats["start_time"] = now - interval
                self._stats["requests_per_second"] = self._rate_limit
            else:
                elapsed = slot - self._stats["start_time"]
                self._stats["requests_per_second"] = self._stats["count"] / elapsed

        sleep_duration = slot - now
        if sleep_duration > 0:
            await asyncio.sleep(sleep_duration)
        return await handler(request)

    def get_stats(self) -> str:
        return (
            f"Count: {self._stats['count']}, \n"
            f"Requests per second: {self._stats['requests_per_second']:.2f}, \n"
            f"Rate Limit: {self._stats['rate_limit']}, \n"
            f"URLs: {len(self._stats['urls'])}, \n"
        )
