---
title: 'Payment Reconciliation Engine'
description: 'Building a robust payment reconciliation system for accurate financial reporting.'
pubDate: 2026-02-25
author: 'jane-doe'
tags: [fintech, reconciliation, financial, engineering]
categories: [FinTech, Engineering]
draft: false
toc: true
---

Payment reconciliation is the process of matching your internal transaction records against what your payment gateways actually processed. It sounds simple until you're processing 100K+ transactions daily across 5 gateways, each with different reporting formats, time zones, and settlement schedules.

We built an automated reconciliation engine that runs daily, identifies mismatches, and generates reports for the finance team. Here's how it works.

## The Reconciliation Pipeline

```
Internal Ledger ──┐
                  ├──→ Match Engine ──→ Mismatches ──→ Alerting
Gateway Reports ──┘                       │
                                          └──→ Auto-Resolve ──→ Ledger Update
```

```python
from dataclasses import dataclass
from datetime import date

@dataclass
class Transaction:
    id: str
    amount: int  # In cents
    currency: str
    status: str
    gateway: str
    gateway_ref: str
    created_at: date

@dataclass
class ReconciliationResult:
    matched: list[tuple[Transaction, Transaction]]
    unmatched_internal: list[Transaction]
    unmatched_gateway: list[Transaction]
    mismatched_amounts: list[tuple[Transaction, Transaction]]
```

## Fetching Gateway Reports

Each gateway provides reports differently. We built adapters for each:

```python
class GatewayAdapter:
    """Base class for gateway report adapters."""

    def fetch_report(self, date: date) -> list[dict]:
        raise NotImplementedError

class StripeAdapter(GatewayAdapter):
    def fetch_report(self, date: date) -> list[dict]:
        """Fetch Stripe's daily payout report via API."""
        charges = stripe.Charge.list(
            created={'gte': int(date.timestamp()), 'lt': int((date + timedelta(1)).timestamp())},
            limit=100,
        )
        return [
            {
                'gateway_ref': ch.id,
                'amount': ch.amount,
                'currency': ch.currency,
                'status': ch.status,
                'fee': ch.balance_transaction.fee if ch.balance_transaction else 0,
            }
            for ch in charges.auto_paging_iter()
        ]

class PayPalAdapter(GatewayAdapter):
    def fetch_report(self, date: date) -> list[dict]:
        """Fetch PayPal's transaction report via SFTP."""
        # PayPal provides daily CSV files via SFTP
        csv_content = self.sftp.download(f"reports/transactions_{date:%Y%m%d}.csv")
        return parse_paypal_csv(csv_content)
```

## The Matching Algorithm

The core of reconciliation is matching internal transactions against gateway records:

```python
def reconcile(
    internal_txns: list[Transaction],
    gateway_txns: list[dict],
    gateway: str,
) -> ReconciliationResult:
    """Match internal transactions against gateway records."""

    # Index gateway transactions by reference
    gateway_by_ref = {t['gateway_ref']: t for t in gateway_txns}
    gateway_by_amount = {}
    for t in gateway_txns:
        gateway_by_amount.setdefault(t['amount'], []).append(t)

    matched = []
    unmatched_internal = []
    mismatched_amounts = []

    for txn in internal_txns:
        if txn.gateway != gateway:
            continue

        # Try exact match by gateway reference
        gateway_txn = gateway_by_ref.get(txn.gateway_ref)

        if gateway_txn:
            if gateway_txn['amount'] == txn.amount:
                matched.append((txn, gateway_txn))
            else:
                mismatched_amounts.append((txn, gateway_txn))
        else:
            # Try fuzzy match by amount and date
            candidates = gateway_by_amount.get(txn.amount, [])
            if candidates:
                # Pick the closest by timestamp
                best = min(candidates, key=lambda g: abs(
                    (g.get('timestamp', 0) or 0) - int(txn.created_at.timestamp())
                ))
                matched.append((txn, best))
                gateway_by_ref[best['gateway_ref']] = None  # Mark as used
            else:
                unmatched_internal.append(txn)

    # Gateway transactions not in our system
    used_refs = {g['gateway_ref'] for _, g in matched}
    unmatched_gateway = [
        g for g in gateway_txns
        if g['gateway_ref'] not in used_refs
    ]

    return ReconciliationResult(
        matched=matched,
        unmatched_internal=unmatched_internal,
        unmatched_gateway=unmatched_gateway,
        mismatched_amounts=mismatched_amounts,
    )
```

## Handling Common Mismatches

Not all mismatches are errors. We auto-resolve known patterns:

```python
def auto_resolve(result: ReconciliationResult) -> ReconciliationResult:
    """Auto-resolve known mismatch patterns."""
    resolved_mismatches = []
    remaining_mismatches = []

    for internal, gateway in result.mismatched_amounts:
        diff = gateway['amount'] - internal.amount

        # Gateway fee deduction (expected)
        if diff < 0 and abs(diff) == gateway.get('fee', 0):
            resolved_mismatches.append({
                'type': 'gateway_fee',
                'internal': internal,
                'gateway': gateway,
                'fee': abs(diff),
            })
            continue

        # Currency conversion difference (expected within 0.5%)
        if abs(diff / internal.amount) < 0.005:
            resolved_mismatches.append({
                'type': 'currency_conversion',
                'internal': internal,
                'gateway': gateway,
                'diff': diff,
            })
            continue

        # Unknown mismatch — needs manual review
        remaining_mismatches.append((internal, gateway))

    return ReconciliationResult(
        matched=result.matched,
        unmatched_internal=result.unmatched_internal,
        unmatched_gateway=result.unmatched_gateway,
        mismatched_amounts=remaining_mismatches,
    )
```

## Reporting

The daily report goes to the finance team:

```python
def generate_daily_report(results: dict[str, ReconciliationResult]) -> dict:
    """Generate reconciliation summary report."""
    total_matched = sum(len(r.matched) for r in results.values())
    total_unmatched = sum(len(r.unmatched_internal) for r in results.values())
    total_mismatches = sum(len(r.mismatched_amounts) for r in results.values())

    report = {
        'date': date.today().isoformat(),
        'summary': {
            'total_internal': sum(
                len(r.matched) + len(r.unmatched_internal) + len(r.mismatched_amounts)
                for r in results.values()
            ),
            'matched': total_matched,
            'match_rate': f"{total_matched / max(total_matched + total_unmatched, 1) * 100:.2f}%",
            'unmatched': total_unmatched,
            'mismatches': total_mismatches,
        },
        'by_gateway': {
            gateway: {
                'matched': len(r.matched),
                'unmatched': len(r.unmatched_internal),
                'mismatches': len(r.mismatched_amounts),
            }
            for gateway, r in results.items()
        },
        'action_required': [
            {
                'internal_id': txn.id,
                'gateway_ref': g.get('gateway_ref'),
                'internal_amount': txn.amount,
                'gateway_amount': g['amount'],
                'diff': g['amount'] - txn.amount,
            }
            for r in results.values()
            for txn, g in r.mismatched_amounts
        ],
    }

    return report
```

## Lessons Learned

1. **Normalize data early** — each gateway has different formats; normalize before matching
2. **Expect mismatches** — fees, currency conversion, and timing differences are normal
3. **Auto-resolve known patterns** — don't alert on expected differences
4. **Run reconciliation daily** — the longer you wait, the harder it is to investigate
5. **Keep raw gateway reports** — you'll need them for audits and debugging

---

_Questions about payment reconciliation? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
