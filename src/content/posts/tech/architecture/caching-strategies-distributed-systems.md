---
title: 'Caching Strategies for Distributed Systems'
description: 'Implementing effective caching strategies in distributed systems.'
pubDate: 2025-11-05
author: 'naman-gupta'
tags: [architecture, caching, redis, distributed-systems]
categories: [Architecture, System Design]
draft: false
toc: true
---

Caching is the most effective way to improve system performance, but it's also one of the hardest problems in distributed systems. Get caching wrong and you'll serve stale data, lose writes, or create cache stampedes that take down your infrastructure.

After implementing caching across dozens of services, here's a practical guide to choosing and implementing the right caching strategy.

## Cache-Aside (Lazy Loading)

The simplest and most common pattern. The application checks the cache first, and only queries the database on a miss.

```python
import redis
import json

cache = redis.Redis(host='redis', port=6379, db=0)

def get_user(user_id: str) -> dict:
    # 1. Check cache
    cached = cache.get(f"user:{user_id}")
    if cached:
        return json.loads(cached)

    # 2. Cache miss — query database
    user = db.query("SELECT * FROM users WHERE id = ?", user_id)
    if user:
        # 3. Populate cache with TTL
        cache.setex(
            f"user:{user_id}",
            ttl=3600,  # 1 hour
            value=json.dumps(user),
        )

    return user
```

**When to use cache-aside:**

- Read-heavy workloads with infrequent updates
- When stale data is acceptable for short periods
- When you want simple implementation

**Pitfalls:**

- **Cache stampede**: When a popular key expires, thousands of requests hit the database simultaneously
- **Stale data**: Updates bypass the cache until TTL expires

### Preventing Cache Stampedes

Use a lock to ensure only one request repopulates the cache:

```python
import redis_lock

def get_user_with_lock(user_id: str) -> dict:
    cached = cache.get(f"user:{user_id}")
    if cached:
        return json.loads(cached)

    # Only one thread computes the value
    lock = redis_lock.Lock(cache, f"lock:user:{user_id}", expire=10)

    if lock.acquire(blocking=False):
        try:
            # Check cache again (another thread may have populated it)
            cached = cache.get(f"user:{user_id}")
            if cached:
                return json.loads(cached)

            user = db.query("SELECT * FROM users WHERE id = ?", user_id)
            if user:
                cache.setex(f"user:{user_id}", 3600, json.dumps(user))
            return user
        finally:
            lock.release()
    else:
        # Another thread is computing — wait and retry
        time.sleep(0.1)
        return get_user_with_lock(user_id)
```

## Write-Through

Data is written to both the cache and the database simultaneously. The cache always reflects the latest state.

```python
def update_user(user_id: str, data: dict) -> dict:
    # 1. Update database
    updated = db.execute(
        "UPDATE users SET name = ?, email = ? WHERE id = ? RETURNING *",
        data['name'], data['email'], user_id
    )

    # 2. Update cache (synchronously)
    cache.setex(
        f"user:{user_id}",
        ttl=3600,
        value=json.dumps(updated),
    )

    return updated
```

**When to use write-through:**

- Read-after-write consistency is required
- Write frequency is moderate
- Cache misses are expensive

**Trade-offs:**

- Higher write latency (two writes per operation)
- More complex error handling (what if cache write fails?)

## Write-Behind (Write-Back)

Writes go to the cache immediately and are asynchronously flushed to the database. This is the fastest write pattern but carries data loss risk.

```python
import threading
import queue

write_queue = queue.Queue()

def update_user_async(user_id: str, data: dict):
    # 1. Update cache immediately
    cache.setex(f"user:{user_id}", 3600, json.dumps(data))

    # 2. Queue database write for async processing
    write_queue.put({
        'type': 'update_user',
        'user_id': user_id,
        'data': data,
    })

# Background worker flushes writes to database
def write_behind_worker():
    batch = []
    while True:
        try:
            item = write_queue.get(timeout=1)
            batch.append(item)

            # Flush batch every 100 items or 1 second
            if len(batch) >= 100:
                flush_batch(batch)
                batch = []
        except queue.Empty:
            if batch:
                flush_batch(batch)
                batch = []

def flush_batch(batch: list):
    with db.transaction():
        for item in batch:
            db.execute(
                "UPDATE users SET name = ?, email = ? WHERE id = ?",
                item['data']['name'], item['data']['email'], item['user_id']
            )
```

**When to use write-behind:**

- Write throughput is critical (analytics, logging, metrics)
- Occasional data loss is acceptable
- You can tolerate eventual consistency

**Risks:**

- **Data loss** if the cache crashes before flushing
- **Complex recovery** — need to replay the write queue on restart

## Multi-Level Caching

For high-traffic systems, combine local (in-process) and distributed (Redis) caches:

```python
from functools import lru_cache

# L1: In-process cache (fast, but not shared)
@lru_cache(maxsize=10000)
def get_user_l1(user_id: str, version: int) -> dict:
    return get_user_l2(user_id)

# L2: Redis cache (shared, network latency)
def get_user_l2(user_id: str) -> dict:
    cached = cache.get(f"user:{user_id}")
    if cached:
        return json.loads(cached)

    # L3: Database
    user = db.query("SELECT * FROM users WHERE id = ?", user_id)
    if user:
        cache.setex(f"user:{user_id}", 3600, json.dumps(user))
    return user
```

L1 cache handles repeated requests for the same data within a single process, reducing Redis load by 60-80% for hot keys.

## Cache Invalidation

The hardest problem in caching. We use a combination of strategies:

| Strategy          | Approach                            | Use Case                     |
| ----------------- | ----------------------------------- | ---------------------------- |
| TTL               | Expire after fixed duration         | User profiles, product info  |
| Explicit deletion | Delete cache on write               | Session data, preferences    |
| Versioned keys    | Include data version in cache key   | Configuration, feature flags |
| Cache tags        | Tag related keys, invalidate by tag | Product catalog, categories  |

```python
# Versioned keys for configuration
def get_config(key: str) -> dict:
    version = cache.get(f"config:{key}:version")
    return json.loads(cache.get(f"config:{key}:v{version}"))

def update_config(key: str, data: dict):
    version = int(cache.get(f"config:{key}:version") or 0) + 1
    cache.set(f"config:{key}:version", str(version))
    cache.set(f"config:{key}:v{version}", json.dumps(data))
    # Old version naturally becomes unreachable
```

## Lessons Learned

1. **Start with cache-aside** — it's the simplest and works for 80% of use cases
2. **Always set TTLs** — cache entries without TTLs become stale forever
3. **Monitor cache hit rates** — a low hit rate means caching isn't helping
4. **Plan for cache failure** — your system should work (slower) when Redis is down
5. **Invalidation is harder than caching** — design your invalidation strategy before you cache

---

_Questions about caching strategies? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
