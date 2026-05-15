---
title: 'System Design: Real-Time Payment Processing at Scale'
description: 'A deep dive into the architecture behind processing millions of payment transactions per day with sub-second latency and 99.99% availability.'
pubDate: 2026-04-28
author: 'jane-doe'
tags: [system-design, fintech, architecture, distributed-systems]
categories: [System Design, FinTech]
draft: false
toc: true
---

Building a payment processing system that handles millions of transactions daily while maintaining sub-second latency and 99.99% availability is one of the hardest challenges in software engineering. Money movement leaves zero room for error.

In this post, I'll break down the architecture of a real-time payment processing system, covering everything from API design to disaster recovery.

## Requirements

- **Throughput**: 10K transactions per second peak
- **Latency**: P99 < 500ms end-to-end
- **Availability**: 99.99% (less than 52 minutes downtime per year)
- **Consistency**: Exactly-once processing semantics
- **Compliance**: PCI DSS Level 1, SOC 2 Type II
- **Idempotency**: Safe retries on network failures

## High-Level Architecture

```
Client → API Gateway → Payment Orchestrator → [Fraud Check → Ledger → Settlement]
```

The system follows a **pipeline architecture** where each stage is independently scalable and fault-isolated.

### API Gateway

The gateway handles:

- TLS termination with mutual TLS for partner integrations
- Request validation and schema enforcement
- Rate limiting per API key
- Idempotency key extraction

```yaml
# Idempotency is enforced at the gateway level
POST /v1/payments
Headers:
  Idempotency-Key: uuid-v4
  X-Request-ID: uuid-v4
```

### Payment Orchestrator

The orchestrator is the brain of the system. It:

1. Validates the idempotency key (deduplicates retries)
2. Routes to the appropriate payment rail (card, ACH, wire, real-time)
3. Coordinates the fraud check, ledger update, and settlement stages
4. Handles compensation on failure (Saga pattern)

We use a **state machine** to track payment lifecycle:

```
PENDING → VALIDATING → FRAUD_CHECK → LEDGER_UPDATE → SETTLEMENT → COMPLETED
                                                        ↓
                                                 FAILED → COMPENSATING → REVERSED
```

## The Ledger Problem

The most critical component is the ledger. Every transaction must be recorded with **double-entry bookkeeping** — every debit has a corresponding credit. This isn't just best practice; it's a regulatory requirement.

### Why Not Just Use a Database?

You _can_ use a database, but you need to be very careful:

```sql
-- WRONG: Race condition between read and write
BEGIN;
SELECT balance FROM accounts WHERE id = ?; -- reads 1000
-- concurrent transaction also reads 1000
UPDATE accounts SET balance = balance - 100 WHERE id = ?; -- sets 900
-- other transaction also sets 900, but should be 800
COMMIT;
```

The correct approach uses **row-level locking** or **optimistic concurrency control**:

```sql
-- CORRECT: Atomic update with balance check
UPDATE accounts
SET balance = balance - 100,
    version = version + 1
WHERE id = ? AND balance >= 100 AND version = ?;
```

### Event Sourcing for Auditability

We store every ledger change as an immutable event:

```json
{
  "event_id": "evt_abc123",
  "type": "debit",
  "account_id": "acc_xyz789",
  "amount": 10000,
  "currency": "USD",
  "reference": "pay_def456",
  "timestamp": "2026-04-28T10:30:00Z",
  "balance_after": 490000
}
```

This gives us:

- Complete audit trail for compliance
- Ability to reconstruct any account state at any point in time
- Natural integration with event-driven downstream systems

## Fraud Detection

Fraud checks run in parallel with payment validation to minimize latency. Our fraud engine:

1. Checks velocity rules (transactions per minute/hour/day)
2. Runs ML-based risk scoring
3. Validates device fingerprint against known patterns
4. Checks against watchlists and sanctions databases

```go
type FraudCheck struct {
    VelocityRules  []VelocityRule
    RiskScore      float64
    DeviceTrust    DeviceTrustLevel
    SanctionsMatch bool
}

func (fc *FraudCheck) Decision() FraudDecision {
    if fc.SanctionsMatch {
        return Reject
    }
    if fc.RiskScore > 0.85 {
        return Review
    }
    if fc.ViolatesAnyVelocityRule() {
        return Reject
    }
    return Approve
}
```

## Disaster Recovery

### Multi-Region Active-Active

We run in three regions with **active-active** traffic distribution:

- US-East (primary)
- US-West (secondary)
- EU-West (tertiary)

Each region can handle 100% of traffic independently. DNS-based failover switches traffic in under 60 seconds.

### Data Replication

Ledger events are replicated asynchronously across regions using a **conflict-free replicated data type (CRDT)** approach. Since ledger events are append-only and ordered by timestamp, conflicts are rare and resolvable.

### Recovery Point Objective (RPO)

- **Ledger**: RPO = 0 (synchronous replication within region)
- **Analytics**: RPO = 5 minutes (async cross-region)

### Recovery Time Objective (RTO)

- **Full region failover**: RTO < 2 minutes
- **Database restore from backup**: RTO < 15 minutes

## Monitoring & Alerting

We track four golden signals:

| Signal     | Alert Threshold                |
| ---------- | ------------------------------ |
| Latency    | P99 > 500ms for 5 minutes      |
| Traffic    | >20% deviation from baseline   |
| Errors     | >0.1% error rate for 2 minutes |
| Saturation | CPU > 80% for 10 minutes       |

Every payment transaction is traced with OpenTelemetry, giving us end-to-end visibility across all services.

## Key Takeaways

1. **Idempotency is non-negotiable** — every endpoint must handle retries safely
2. **Double-entry bookkeeping prevents entire classes of bugs** — treat money like money
3. **Event sourcing makes compliance audits trivial** — regulators love immutable logs
4. **Design for failure** — assume every dependency will fail and plan accordingly
5. **Measure everything** — you can't improve what you can't observe

---

_This is part of a series on building production systems. Next up: event-driven architecture patterns for financial services._
