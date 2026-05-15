---
title: 'Event Sourcing & CQRS Pattern'
description: 'Deep dive into event sourcing and CQRS patterns for building scalable systems.'
pubDate: 2026-01-15
author: 'naman-gupta'
tags: [architecture, event-sourcing, cqrs, ddd]
categories: [Architecture, System Design]
draft: false
toc: true
---

Event sourcing and CQRS are patterns that sound elegant in theory but messy in practice. After implementing them in our order management system — processing 50K+ orders daily — I can confirm: they're powerful, but they come with real complexity.

This post covers what worked, what didn't, and the decisions I'd make differently.

## Why Event Sourcing?

Our order system had a problem: we needed a complete audit trail for compliance, but our CRUD-based approach made it nearly impossible to reconstruct "what happened" when something went wrong. Orders would mysteriously change status, and we had no way to trace why.

Event sourcing flips the model: instead of storing current state, we store every state change as an immutable event.

```python
from dataclasses import dataclass
from datetime import datetime
from enum import Enum

class OrderStatus(Enum):
    CREATED = "created"
    PAID = "paid"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"

@dataclass
class OrderEvent:
    event_id: str
    order_id: str
    event_type: str
    data: dict
    timestamp: datetime
    version: int

# Events, not state updates
events = [
    OrderEvent("evt_001", "ord_123", "OrderCreated", {"customer_id": "cust_456", "total": 9999}, ...),
    OrderEvent("evt_002", "ord_123", "PaymentReceived", {"method": "card", "amount": 9999}, ...),
    OrderEvent("evt_003", "ord_123", "OrderShipped", {"carrier": "fedex", "tracking": "FX123"}, ...),
]
```

The current state of an order is derived by replaying all its events. This gives us a perfect audit trail for free.

## CQRS: Separating Reads from Writes

CQRS (Command Query Responsibility Segregation) pairs naturally with event sourcing. Commands mutate state by producing events; queries read from materialized views optimized for specific use cases.

```
Commands → Event Store → Event Handlers → Read Models → Queries
```

```python
class OrderCommandHandler:
    def __init__(self, event_store: EventStore, event_bus: EventBus):
        self.event_store = event_store
        self.event_bus = event_bus

    def handle_ship_order(self, command: ShipOrderCommand):
        # Load current state by replaying events
        events = self.event_store.get_events(command.order_id)
        order = Order.replay(events)

        # Apply command, producing new event
        order.ship(command.carrier, command.tracking_number)
        new_event = order.pending_events[-1]

        # Append atomically
        self.event_store.append(new_event)
        self.event_bus.publish(new_event)
```

The read models are updated asynchronously by event handlers:

```python
@event_handler("OrderShipped")
def update_order_summary(event: OrderEvent):
    """Update the read-optimized order summary table."""
    db.execute("""
        UPDATE order_summaries
        SET status = 'shipped',
            tracking_number = $1,
            carrier = $2,
            shipped_at = $3
        WHERE order_id = $4
    """, event.data['tracking'], event.data['carrier'],
        event.timestamp, event.order_id)
```

## The Event Store

We used PostgreSQL as our event store with append-only semantics:

```sql
CREATE TABLE order_events (
    id UUID PRIMARY KEY,
    order_id VARCHAR(50) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    version INTEGER NOT NULL,
    data JSONB NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(order_id, version)
);

CREATE INDEX idx_order_events_order_id ON order_events(order_id);
```

The `UNIQUE(order_id, version)` constraint prevents duplicate events and ensures optimistic concurrency. If two processes try to append version 5 simultaneously, one will fail.

## Snapshotting

Replaying hundreds of events to reconstruct state is slow. We added snapshots every 50 events:

```python
def get_order_state(order_id: str) -> Order:
    # Get latest snapshot
    snapshot = snapshot_store.get(order_id)
    from_version = snapshot.version if snapshot else 0

    # Replay only events after snapshot
    events = event_store.get_events(order_id, from_version=from_version)

    if snapshot:
        order = Order.from_snapshot(snapshot.data)
    else:
        order = Order()

    for event in events:
        order.apply(event)

    return order
```

This reduced state reconstruction from ~200ms to ~15ms for typical orders.

## Challenges We Faced

### Event Schema Evolution

Events are immutable, but their schemas evolve. We handle this with schema versioning:

```python
@dataclass
class OrderCreatedV1:
    customer_id: str
    total: int

@dataclass
class OrderCreatedV2:
    customer_id: str
    total: int
    currency: str  # New field

def migrate_event(event: dict) -> OrderEvent:
    if event['version'] == 1 and event['type'] == 'OrderCreated':
        event['data']['currency'] = 'USD'  # Default for old events
        event['version'] = 2
    return event
```

### Eventual Consistency

Read models are eventually consistent. The API might return stale data for a few hundred milliseconds after a write. We handle this with:

- **Read-your-writes consistency**: After a command, return the new state directly rather than querying the read model
- **Version headers**: Include `X-Event-Version` in responses so clients know if their data is current

### Debugging Complexity

When something goes wrong, you can't just `SELECT * FROM orders WHERE id = ?`. You need to replay events. We built a debug tool that shows the event timeline:

```
ord_123:
  v1  OrderCreated     {customer: cust_456, total: $99.99}
  v2  PaymentReceived  {method: card, amount: $99.99}
  v3  OrderShipped     {carrier: fedex, tracking: FX123}
  v4  OrderDelivered   {signed_by: J. Smith}
```

## When to Use Event Sourcing

Event sourcing is overkill for most CRUD applications. Use it when:

- You need a complete audit trail (compliance, financial systems)
- You need to reconstruct past state ("what did this order look like yesterday?")
- You want to build multiple read models from the same data
- Temporal queries are important ("how many orders were in 'shipped' status at 3pm?")

Skip it when you just need to store and retrieve current state.

## Lessons Learned

1. **Start with the event schema** — design events around business concepts, not database tables
2. **Version events from day one** — you will need to evolve them
3. **Snapshot early** — don't wait until replay is slow
4. **Build debug tooling first** — you'll need it before you think you do
5. **Accept eventual consistency** — design your UX around it, don't fight it

---

_Questions about event sourcing? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
