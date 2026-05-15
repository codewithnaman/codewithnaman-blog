---
title: 'Idempotency in Payment Systems'
description: 'How to design idempotent APIs that safely handle retries without duplicate charges.'
pubDate: 2026-04-12
author: 'jane-doe'
tags: [fintech, idempotency, api-design, reliability]
categories: [FinTech, Backend]
draft: false
toc: true
---

In payment processing, charging a customer twice is not a bug — it's a regulatory violation. Network failures, client retries, and timeout ambiguity mean the same payment request can arrive multiple times. Idempotency keys are the mechanism that prevents duplicates.

Here's how we implemented idempotency across a distributed payment pipeline processing 2M+ transactions daily.

## The Problem

When a client sends a payment request and the connection times out, it doesn't know whether:

1. The request never reached the server
2. The server processed it but the response was lost
3. The server is still processing it

The client's only safe option is to retry. But if the server already processed the original request, the retry creates a duplicate charge.

```
Client                          Server
  │── POST /payments ──────────→│
  │   { amount: 5000 }          │
  │                             │── Process payment...
  │   ←── (timeout) ────────────│
  │                             │── ...charge card $50.00 ✓
  │                             │── Send response...
  │                             │── (response lost)
  │── POST /payments ──────────→│  ← RETRY
  │   { amount: 5000 }          │── Process payment again...
  │                             │── ...charge card $50.00 ✓ ← DUPLICATE!
```

## The Solution: Idempotency Keys

The client generates a unique key for each logical request and includes it in the header:

```
POST /v1/payments
Idempotency-Key: idemp-key-abc123-def456
Content-Type: application/json

{
  "amount": 5000,
  "currency": "USD",
  "payment_method": "pm_card_visa"
}
```

The server uses this key to ensure the same request is only processed once:

```python
import hashlib
from datetime import datetime, timedelta

class IdempotencyManager:
    def __init__(self, redis_client):
        self.redis = redis_client
        self.ttl = 86400 * 7  # 7 days

    def check_idempotency(self, key: str) -> dict | None:
        """Return cached response if this key was already processed."""
        cached = self.redis.get(f"idemp:{key}")
        if cached:
            return json.loads(cached)
        return None

    def store_response(self, key: str, response: dict, status_code: int):
        """Cache the response for future retries."""
        data = {
            'status_code': status_code,
            'body': response,
            'created_at': datetime.utcnow().isoformat(),
        }
        self.redis.setex(
            f"idemp:{key}",
            self.ttl,
            json.dumps(data),
        )
```

## Atomic Processing

The critical requirement: checking for an existing key and storing a new one must be atomic. Otherwise, two concurrent requests with the same key could both pass the check and both process the payment.

```python
def process_payment_with_idempotency(
    request: PaymentRequest,
    idempotency_key: str,
) -> PaymentResponse:
    """Process payment with atomic idempotency guarantee."""

    # Try to acquire a lock for this idempotency key
    lock_key = f"lock:idemp:{idempotency_key}"
    lock = redis_lock.Lock(redis, lock_key, expire=30)

    if not lock.acquire(blocking=False):
        # Another request with the same key is being processed
        # Wait and check for the result
        time.sleep(0.5)
        cached = idempotency_manager.check_idempotency(idempotency_key)
        if cached:
            return PaymentResponse.from_cached(cached)
        raise ConcurrentRequestError("Request still processing")

    try:
        # Double-check: maybe another request completed while we waited
        cached = idempotency_manager.check_idempotency(idempotency_key)
        if cached:
            return PaymentResponse.from_cached(cached)

        # Process the payment
        result = payment_processor.charge(request)

        # Store response for future retries
        idempotency_manager.store_response(
            idempotency_key, result.to_dict(), 200
        )

        return result
    finally:
        lock.release()
```

## Key Generation

Clients should generate idempotency keys using a UUID or similar:

```python
import uuid

def create_idempotency_key() -> str:
    """Generate a unique idempotency key."""
    return f"idemp-{uuid.uuid4().hex}"

# Usage
response = httpx.post(
    "https://api.example.com/v1/payments",
    headers={"Idempotency-Key": create_idempotency_key()},
    json={"amount": 5000, "currency": "USD"},
)
```

Important rules for key generation:

- **Never reuse keys** for different logical requests
- **Use UUIDs** — they're designed for uniqueness
- **Don't derive keys from request content** — two identical requests are still different logical operations

## Idempotency in Distributed Systems

In a distributed payment pipeline, the idempotency check must happen before any side effect:

```
Client → API Gateway → [Idempotency Check] → Payment Processor → [Ledger] → [Settlement]
                              │
                              └─ If key exists, return cached response immediately
```

Every downstream service must also be idempotent:

```python
class LedgerService:
    def record_transaction(self, txn: Transaction):
        """Idempotent: same transaction ID produces same result."""
        try:
            self.db.execute("""
                INSERT INTO ledger_entries
                    (transaction_id, account_id, amount, type)
                VALUES ($1, $2, $3, $4)
            """, txn.id, txn.account_id, txn.amount, txn.type)
        except UniqueViolationError:
            # Already recorded — this is fine
            return self.db.fetch(
                "SELECT * FROM ledger_entries WHERE transaction_id = $1",
                txn.id
            )
```

## TTL and Cleanup

Idempotency keys don't need to be stored forever. We use a 7-day TTL, which covers:

- Client retry windows (typically seconds to minutes)
- Dispute windows for identifying duplicate charges
- Debugging and audit requirements

```python
# Cleanup expired keys (handled automatically by Redis TTL)
# But we also log key creation for audit purposes
def log_idempotency_key(key: str, request_hash: str):
    db.execute("""
        INSERT INTO idempotency_audit
            (key, request_hash, created_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO NOTHING
    """, key, request_hash)
```

## Lessons Learned

1. **Idempotency is not optional** — every payment endpoint must support it
2. **Check before processing** — the idempotency check must be the first operation
3. **Use distributed locks** — concurrent retries must not both process
4. **Cache the response** — retries should return the exact same response
5. **Make downstream services idempotent too** — the API gateway is not enough

---

_Questions about payment systems? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
