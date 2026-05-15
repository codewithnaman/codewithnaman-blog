---
title: 'Distributed Tracing & Observability'
description: 'Implementing distributed tracing and observability in microservices.'
pubDate: 2025-10-18
author: 'naman-gupta'
tags: [architecture, observability, tracing, opentelemetry]
categories: [Architecture, Cloud]
draft: false
toc: true
---

When you have 50+ microservices, a single user request can traverse a dozen services before returning a response. When that request fails or is slow, finding the root cause without distributed tracing is like debugging with your eyes closed.

We implemented OpenTelemetry across our entire platform over six months. Here's the practical guide I wish we had when we started.

## Why OpenTelemetry?

OpenTelemetry (OTel) is the industry standard for observability. It provides:

- **Vendor-neutral instrumentation** — switch backends without changing code
- **Unified API** for traces, metrics, and logs
- **Automatic context propagation** — trace IDs flow through HTTP, gRPC, and message queues
- **Massive ecosystem** — auto-instrumentation for 40+ languages and frameworks

## Trace Propagation

The foundation of distributed tracing is propagating trace context across service boundaries. OTel uses W3C Trace Context headers:

```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             │  │                              │              │
             │  │                              │              └─ flags (sampled)
             │  │                              └─ parent span ID
             │  └─ trace ID
             └─ version
```

Every service must extract this header from incoming requests and inject it into outgoing calls:

```python
from opentelemetry import trace
from opentelemetry.propagate import extract, inject
import httpx

tracer = trace.get_tracer("order-service")

async def process_order(order_id: str, headers: dict):
    # Extract trace context from incoming request
    ctx = extract(headers)

    with tracer.start_as_current_span("process_order", context=ctx) as span:
        span.set_attribute("order.id", order_id)

        # Call payment service — inject trace context
        outgoing_headers = {}
        inject(outgoing_headers)

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "http://payment-service/api/charge",
                json={"order_id": order_id, "amount": 9999},
                headers=outgoing_headers,
            )

        span.set_attribute("payment.status", response.status_code)
        return response.json()
```

## Auto-Instrumentation

Before writing manual spans, enable auto-instrumentation. It captures HTTP clients, database queries, and framework handlers for free:

```python
# At application startup
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.asyncpg import AsyncPGInstrumentor

FastAPIInstrumentor.instrument_app(app)
HTTPXClientInstrumentor().instrument()
AsyncPGInstrumentor().instrument()
```

This alone gave us visibility into 80% of our service interactions with zero code changes.

## Sampling Strategies

Sampling is critical — tracing every request at scale is prohibitively expensive. We use a tiered approach:

```yaml
sampling:
  default:
    type: probabilistic
    rate: 0.01 # 1% of all requests
  errors:
    type: always_on # 100% of failed requests
  slow:
    type: always_on # 100% of requests > 1s
  high_value:
    type: always_on # 100% of premium customer requests
```

```python
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

# Default: 1% sampling
default_sampler = ParentBased(TraceIdRatioBased(0.01))

# Custom sampler: always sample errors and slow requests
class SmartSampler:
    def should_sample(self, span_context, trace_id, name, attributes):
        # Always sample if it's an error span
        if attributes.get("error"):
            return ALWAYS_ON

        # Always sample if it's slow
        if attributes.get("duration_ms", 0) > 1000:
            return ALWAYS_ON

        # Otherwise use probabilistic sampling
        return default_sampler.should_sample(
            span_context, trace_id, name, attributes
        )
```

This gives us complete visibility into problems while keeping storage costs manageable.

## Custom Spans for Business Logic

Auto-instrumentation covers infrastructure, but you need manual spans for business logic:

```python
async def reconcile_payments(order_id: str):
    with tracer.start_as_current_span("reconcile_payments") as span:
        span.set_attribute("order.id", order_id)

        with tracer.start_as_current_span("fetch_gateway_records") as child:
            records = await fetch_from_gateways(order_id)
            child.set_attribute("records.count", len(records))

        with tracer.start_as_current_span("compare_balances") as child:
            mismatches = find_mismatches(records)
            child.set_attribute("mismatches.count", len(mismatches))

        if mismatches:
            span.set_attribute("reconciliation.status", "failed")
            span.add_event("reconciliation_failed", {
                "mismatch_count": len(mismatches),
            })
        else:
            span.set_attribute("reconciliation.status", "success")
```

## Message Queue Tracing

Tracing across async boundaries requires explicit context propagation:

```python
# Producer: inject trace context into message headers
def publish_event(event: dict):
    headers = {}
    inject(headers)  # OTel propagation
    event['headers'] = headers
    kafka_producer.send('orders.events', value=event)

# Consumer: extract trace context and create span
@consumer('orders.events')
def handle_event(message):
    ctx = extract(message.headers)

    with tracer.start_as_current_span(
        "handle_order_event",
        context=ctx,
        kind=trace.SpanKind.CONSUMER,
    ) as span:
        span.set_attribute("event.type", message.value['event_type'])
        process_event(message.value)
```

## Debugging with Traces

With traces in place, debugging becomes dramatically faster:

```
Trace: POST /api/orders (2.3s total)
├── api-gateway: handle_request (2.3s)
│   ├── auth: validate_token (12ms)
│   ├── rate-limiter: check (3ms)
│   └── order-service: create_order (2.2s)
│       ├── db: insert_order (45ms)
│       ├── payment-service: charge (1.8s) ← SLOW
│       │   ├── stripe: create_payment_intent (1.7s) ← ROOT CAUSE
│       │   └── db: record_payment (50ms)
│       └── notification-service: send_email (200ms)
```

The trace immediately shows that Stripe's `create_payment_intent` is the bottleneck — not our code.

## Lessons Learned

1. **Start with auto-instrumentation** — get 80% visibility with zero code changes
2. **Sample intelligently** — always sample errors, probabilistically sample the rest
3. **Propagate context everywhere** — HTTP, gRPC, message queues, even background jobs
4. **Add business attributes** — order IDs, user IDs, and tenant IDs make traces actionable
5. **Set up trace-based alerts** — alert on trace patterns, not just metrics

---

_Questions about observability? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
