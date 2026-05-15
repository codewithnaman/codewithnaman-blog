---
title: 'Building a Distributed Rate Limiter in Go'
description: 'How we designed and implemented a token bucket rate limiter that handles 500K+ requests per second across a multi-region deployment.'
pubDate: 2026-05-10
updatedDate: 2026-05-12
tags: [go, distributed-systems, rate-limiting, backend]
categories: [Engineering, System Design]
draft: false
pinned: true
toc: true
---

Rate limiting is one of those infrastructure problems that sounds simple until you need it to work at scale. A single-instance token bucket is trivial — the real challenge emerges when you need consistent rate limiting across dozens of service instances spanning multiple availability zones.

In this post, I'll walk through the design decisions, trade-offs, and implementation of a distributed rate limiter we built for our payment processing platform.

## The Problem

Our API gateway was handling ~500K requests per second across 40+ instances in three regions. We needed:

- Per-client rate limiting with configurable quotas
- Sub-millisecond latency overhead per request
- Graceful degradation when Redis is unavailable
- Consistent limits across all instances (no per-instance buckets)

The naive approach — a local token bucket per instance — fails immediately. Each instance would allow the full quota, effectively multiplying the limit by the number of instances.

## Design Decisions

### Why Not a Centralized Service?

A single rate-limiting service becomes a bottleneck and a single point of failure. We needed something that could survive partial outages.

### Why Redis?

Redis gives us atomic operations (`INCR`, `EVAL` for Lua scripts) with sub-millisecond latency. It's the standard choice for distributed counters, and our infrastructure already ran Redis clusters for caching.

### Token Bucket vs Sliding Window

We chose the token bucket algorithm for its smooth rate enforcement and natural burst handling. Sliding window log is more precise but requires storing every request timestamp — impractical at our scale.

## Implementation

Here's the core Lua script that runs atomically on Redis:

```lua
-- Token bucket rate limiter
-- KEYS[1] = rate limit key
-- ARGV[1] = capacity (max tokens)
-- ARGV[2] = refill rate (tokens per second)
-- ARGV[3] = current timestamp (milliseconds)
-- ARGV[4] = requested tokens

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1])
local last_refill = tonumber(bucket[2])

if tokens == nil then
    tokens = capacity
    last_refill = now
end

-- Calculate token refill
local elapsed = math.max(0, now - last_refill)
local refill = elapsed * refill_rate / 1000
tokens = math.min(capacity, tokens + refill)

local allowed = 0
if tokens >= requested then
    tokens = tokens - requested
    allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 1)

return {allowed, math.floor(tokens)}
```

The Go wrapper handles Redis connection pooling and fallback behavior:

```go
type RateLimiter struct {
    rdb        *redis.Client
    capacity   int
    refillRate float64
    script     *redis.Script
}

func (rl *RateLimiter) Allow(ctx context.Context, clientID string) (bool, int, error) {
    key := fmt.Sprintf("ratelimit:%s", clientID)
    now := time.Now().UnixMilli()

    result, err := rl.script.Run(ctx, rl.rdb, []string{key},
        rl.capacity, rl.refillRate, now, 1,
    ).IntSlice()

    if err != nil {
        // Fallback: allow request when Redis is unavailable
        // This is a deliberate choice — better to over-allow than deny
        log.Warn("rate limiter fallback, allowing request", "error", err)
        return true, 0, nil
    }

    allowed := result[0] == 1
    remaining := result[1]
    return allowed, remaining, nil
}
```

## Handling Redis Failures

The critical design decision here is **fail-open** vs **fail-closed**. We chose fail-open: when Redis is unreachable, requests are allowed. This is the right choice for our use case because:

1. Rate limiting is a protective measure, not a correctness guarantee
2. Denying legitimate traffic during an outage is worse than temporarily allowing excess traffic
3. Our downstream services have their own circuit breakers

## Results

| Metric               | Before   | After      |
| -------------------- | -------- | ---------- |
| P99 latency overhead | —        | 0.8ms      |
| Max throughput       | N/A      | 520K req/s |
| Redis CPU impact     | —        | <2%        |
| Failover behavior    | Deny all | Allow all  |

## Lessons Learned

1. **Lua scripts are your friend** — atomicity is non-negotiable for distributed counters
2. **Set TTLs on everything** — orphaned rate limit keys waste memory
3. **Monitor the fallback path** — if you're hitting fail-open frequently, your Redis cluster needs attention
4. **Start simple** — we began with a basic fixed-window counter and evolved to token bucket as requirements grew

The full implementation, including tests and benchmark configurations, is available in our open-source repository.

---

_Have questions about distributed rate limiting? Reach out on [GitHub](https://github.com) or [Twitter](https://x.com)._
