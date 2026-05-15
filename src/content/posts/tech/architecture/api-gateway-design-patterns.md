---
title: 'API Gateway Design Patterns'
description: 'Common patterns and best practices for API gateway implementation.'
pubDate: 2025-11-20
author: 'naman-gupta'
tags: [architecture, api-gateway, kong, nginx]
categories: [Architecture, Backend]
draft: false
toc: true
---

An API gateway is the front door to your microservice architecture. Every request passes through it, which means it handles authentication, rate limiting, request routing, logging, and often request transformation. Get it wrong, and it becomes your biggest bottleneck. Get it right, and it simplifies every downstream service.

We built a custom API gateway handling 100K+ requests per second across 30+ backend services. Here's the architecture and the patterns that matter.

## Why Build Instead of Buy?

We evaluated Kong, APISIX, and AWS API Gateway before deciding to build. The deciding factors:

- **Custom request transformation** — we needed complex body rewriting that off-the-shelf gateways couldn't handle
- **Tight integration with our auth system** — internal OAuth2 with custom claims
- **Cost at scale** — managed gateways get expensive at 100K+ RPS

If you don't have these requirements, use a managed gateway. Building one is a significant undertaking.

## Core Architecture

Our gateway is built in Go for performance, with a plugin system for extensibility:

```
Client → TLS Termination → Rate Limiter → Auth → Router → Transform → Backend → Response Transform → Client
```

```go
type Gateway struct {
    router       *Router
    rateLimiter  *RateLimiter
    auth         *Authenticator
    plugins      []Plugin
    httpClient   *http.Client
}

func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // 1. Rate limiting
    if !g.rateLimiter.Allow(r) {
        http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
        return
    }

    // 2. Authentication
    ctx, err := g.auth.Authenticate(r.Context(), r)
    if err != nil {
        http.Error(w, "Unauthorized", http.StatusUnauthorized)
        return
    }

    // 3. Route to backend service
    route := g.router.Match(r)
    if route == nil {
        http.Error(w, "Not found", http.StatusNotFound)
        return
    }

    // 4. Execute plugins (request transformation)
    req := r.WithContext(ctx)
    for _, plugin := range g.plugins {
        if err := plugin.Before(req); err != nil {
            http.Error(w, err.Error(), http.StatusBadRequest)
            return
        }
    }

    // 5. Proxy to backend
    resp, err := g.httpClient.Do(req)
    if err != nil {
        http.Error(w, "Bad gateway", http.StatusBadGateway)
        return
    }
    defer resp.Body.Close()

    // 6. Response transformation and return
    for _, plugin := range g.plugins {
        plugin.After(resp)
    }

    g.forwardResponse(w, resp)
}
```

## Rate Limiting

We use a token bucket algorithm with Redis for distributed state:

```go
func (rl *RateLimiter) Allow(r *http.Request) bool {
    key := rl.keyFor(r) // API key, IP, or user ID
    now := time.Now().UnixMilli()

    // Lua script for atomic Redis operation
    script := `
        local tokens = redis.call('HGET', KEYS[1], 'tokens')
        if not tokens then
            redis.call('HMSET', KEYS[1], 'tokens', ARGV[2], 'last', ARGV[3])
            redis.call('EXPIRE', KEYS[1], ARGV[4])
            return 1
        end
        tokens = tonumber(tokens)
        local elapsed = ARGV[3] - redis.call('HGET', KEYS[1], 'last')
        tokens = math.min(ARGV[2], tokens + elapsed * ARGV[5] / 1000)
        if tokens >= 1 then
            redis.call('HMSET', KEYS[1], 'tokens', tokens - 1, 'last', ARGV[3])
            return 1
        end
        return 0
    `

    result, _ := rl.redis.Eval(script, []string{key},
        key, rl.capacity, now, rl.ttl, rl.refillRate).Int()
    return result == 1
}
```

Rate limits are configured per route and per client tier:

```yaml
rate_limits:
  default:
    requests: 100
    window: 60s
  premium:
    requests: 1000
    window: 60s
  routes:
    /api/v1/search:
      requests: 30
      window: 60s
    /api/v1/export:
      requests: 5
      window: 60s
```

## Authentication and Authorization

The gateway validates JWTs and enriches requests with user context:

```go
func (a *Authenticator) Authenticate(ctx context.Context, r *http.Request) (context.Context, error) {
    token := extractBearerToken(r)
    if token == "" {
        return nil, errors.New("missing authorization header")
    }

    claims, err := a.verifier.Verify(ctx, token)
    if err != nil {
        return nil, fmt.Errorf("invalid token: %w", err)
    }

    // Check route-level permissions
    route := a.router.Match(r)
    if !claims.HasPermission(route.RequiredPermission) {
        return nil, errors.New("insufficient permissions")
    }

    // Enrich context with user info for downstream services
    ctx = context.WithValue(ctx, "user_id", claims.UserID)
    ctx = context.WithValue(ctx, "org_id", claims.OrgID)
    ctx = context.WithValue(ctx, "roles", claims.Roles)

    return ctx, nil
}
```

Downstream services receive the user context via headers, eliminating the need for each service to validate tokens:

```
X-User-ID: usr_123
X-Org-ID: org_456
X-Roles: admin,billing
```

## Request Transformation

This is where a custom gateway shines. We transform requests to match backend service expectations:

```go
// Version transformation: v1 requests get rewritten to v2 backend format
func TransformV1ToV2(req *http.Request) error {
    if req.URL.Path == "/api/v1/orders" {
        req.URL.Path = "/api/v2/orders"

        // Rewrite request body
        var v1Body struct {
            CustomerID string `json:"customer_id"`
            Items      []struct {
                ProductID string `json:"product_id"`
                Quantity  int    `json:"qty"`
            } `json:"items"`
        }

        if err := json.NewDecoder(req.Body).Decode(&v1Body); err != nil {
            return err
        }

        v2Body := map[string]interface{}{
            "customer": map[string]string{"id": v1Body.CustomerID},
            "line_items": mapItems(v1Body.Items),
            "metadata": map[string]string{"api_version": "v1"},
        }

        body, _ := json.Marshal(v2Body)
        req.Body = io.NopCloser(bytes.NewReader(body))
        req.ContentLength = int64(len(body))
    }
    return nil
}
```

This pattern lets us evolve backend APIs without breaking existing clients.

## Circuit Breaking

When a backend service fails, the gateway should stop sending traffic to it:

```go
type CircuitBreaker struct {
    failures    int
    lastFailure time.Time
    threshold   int
    timeout     time.Duration
    mu          sync.Mutex
}

func (cb *CircuitBreaker) Allow() bool {
    cb.mu.Lock()
    defer cb.mu.Unlock()

    if cb.failures >= cb.threshold {
        if time.Since(cb.lastFailure) > cb.timeout {
            cb.failures = 0 // Half-open: allow one request
            return true
        }
        return false // Circuit is open
    }
    return true
}

func (cb *CircuitBreaker) RecordSuccess() {
    cb.mu.Lock()
    defer cb.mu.Unlock()
    cb.failures = 0
}

func (cb *CircuitBreaker) RecordFailure() {
    cb.mu.Lock()
    defer cb.mu.Unlock()
    cb.failures++
    cb.lastFailure = time.Now()
}
```

## Lessons Learned

1. **Keep the gateway thin** — business logic belongs in services, not the gateway
2. **Add observability from day one** — every request should be traced and logged
3. **Test failure modes** — what happens when Redis is down? When a backend is slow?
4. **Document the contract** — the gateway's behavior should be as well-documented as any API
5. **Plan for hot reloading** — route changes shouldn't require gateway restarts

---

_Questions about API gateway design? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
