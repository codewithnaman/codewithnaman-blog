---
title: 'Monolith to Event-Driven Architecture'
description: 'Step-by-step guide to migrating from a monolith to an event-driven architecture.'
pubDate: 2025-12-28
author: 'naman-gupta'
tags: [architecture, event-driven, migration, kafka]
categories: [Architecture, System Design]
draft: false
toc: true
---

Two years ago, our core platform was a single 2M-line Java monolith deployed as one massive WAR file. It took 45 minutes to build, 20 minutes to deploy, and required a 4-hour maintenance window for releases.

Today, it's 23 microservices communicating through an event backbone, deploying independently, and handling 10x the traffic with a fraction of the operational overhead.

This is the story of how we did it — and what we'd do differently.

## The Breaking Point

The monolith wasn't always a problem. For the first five years, it served us well. But as the team grew from 10 to 80 engineers, the cracks appeared:

- **Merge conflicts** were a daily occurrence
- **Build times** grew from 5 to 45 minutes
- **Deployments** required coordinating 12 teams
- **Database migrations** needed approval from three VPs
- **On-call** meant being paged for services you didn't own

The final straw was a Black Friday incident where a memory leak in the reporting module took down checkout. In a monolith, everything shares the same JVM — one bad actor takes everyone down.

## The Strategy: Strangler Fig Pattern

We chose the **Strangler Fig** pattern: gradually replace pieces of the monolith by routing traffic to new services, one bounded context at a time.

```
                    ┌─────────────┐
                    │   API       │
                    │   Gateway   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐ ┌──▼───┐ ┌──────▼──────┐
       │  Monolith   │ │ New  │ │    New      │
       │  (shrinking)│ │Svc A │ │   Svc B     │
       └─────────────┘ └──────┘ └─────────────┘
```

### Phase 1: Identify Bounded Contexts

We used **Domain-Driven Design** to identify natural boundaries:

| Bounded Context    | Lines of Code | Team         |
| ------------------ | ------------- | ------------ |
| User Management    | 180K          | Identity     |
| Order Processing   | 340K          | Commerce     |
| Payment Processing | 220K          | Payments     |
| Inventory          | 150K          | Supply Chain |
| Reporting          | 280K          | Analytics    |
| Notifications      | 90K           | Engagement   |

### Phase 2: Build the Event Backbone

Before extracting any services, we needed a communication layer. We chose **Apache Kafka** for:

- Ordered, partitioned event streams
- Replay capability for debugging and new service onboarding
- Decoupled producer/consumer lifecycles

The key insight: **events flow out of the monolith first**. New services consume these events but don't yet write back. This gives us a safe migration path.

```java
// Monolith publishes events for every significant action
@EventListener
public void onOrderCreated(OrderCreatedEvent event) {
    kafkaTemplate.send("orders.created", event.getOrderId(), event);
}

@EventListener
public void onPaymentProcessed(PaymentProcessedEvent event) {
    kafkaTemplate.send("payments.processed", event.getPaymentId(), event);
}
```

### Phase 3: Extract Services One at a Time

We extracted services in order of **independence** — starting with services that had the fewest dependencies on other monolith components.

#### First Extraction: Notifications

Notifications was the ideal first candidate:

- It only _reads_ data (sends emails/SMS based on events)
- No other service depends on it synchronously
- Failure is non-critical (queued retries)

```go
// New notification service (Go)
func (s *Service) HandleOrderCreated(ctx context.Context, event OrderCreated) error {
    template, err := s.templates.Get("order_confirmation")
    if err != nil {
        return err
    }
    return s.emailer.Send(ctx, event.CustomerEmail, template, event)
}
```

The migration process for each service:

1. **Dual-write** — monolith continues handling the domain, new service consumes events
2. **Shadow traffic** — route copy of production traffic to new service, compare outputs
3. **Cutover** — switch API gateway routing to new service
4. **Decommission** — remove monolith code for that domain

### Phase 4: Database Decomposition

The hardest part wasn't the code — it was the **shared database**. Our monolith had 847 tables, all in one PostgreSQL instance.

We used the **outbox pattern** to safely decompose:

```sql
-- Outbox table in the monolith database
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    aggregate_type VARCHAR(50),
    aggregate_id VARCHAR(100),
    event_type VARCHAR(100),
    payload JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    processed BOOLEAN DEFAULT FALSE
);
```

A CDC (Change Data Capture) connector reads the outbox table and publishes to Kafka. This ensures **exactly-once** event delivery without modifying application code.

## The Results

| Metric                | Before               | After               |
| --------------------- | -------------------- | ------------------- |
| Deploy frequency      | Weekly               | 50+ per day         |
| Deploy duration       | 4 hours              | 3 minutes           |
| Build time            | 45 minutes           | 2 minutes           |
| P99 latency           | 800ms                | 120ms               |
| Team autonomy         | Coordinated releases | Independent deploys |
| Incident blast radius | Entire platform      | Single service      |

## What We'd Do Differently

### 1. Invest in Observability Earlier

We spent the first six months flying blind. Every service extraction was a leap of faith. If we could redo it, we'd build comprehensive tracing and metrics **before** the first extraction.

### 2. Don't Over-Engineer the Event Schema

We started with a complex protobuf schema that required a central team to approve changes. We've since moved to a simpler JSON schema with backward compatibility rules enforced by CI.

### 3. Extract the Database Sooner

We waited too long to decompose the database. The shared database became a coordination bottleneck even after the code was split.

### 4. Set Clear Success Metrics

"Microservices" isn't a goal — it's a means to an end. We should have defined success metrics upfront: deploy frequency, lead time, MTTR, and team velocity.

## The Bottom Line

Migration to event-driven microservices isn't about technology — it's about **organizational scalability**. The monolith wasn't failing technically; it was failing as a coordination mechanism for 80 engineers.

The event backbone gave us the decoupling we needed. The strangler fig pattern gave us a safe migration path. But the real win was giving each team ownership of their services, their databases, and their deployment timelines.

---

_Questions about the migration? Find me on [GitHub](https://github.com) or drop a comment below._
