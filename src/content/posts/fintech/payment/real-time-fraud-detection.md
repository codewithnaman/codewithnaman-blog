---
title: 'Real-Time Fraud Detection'
description: 'Building a real-time fraud detection system using machine learning.'
pubDate: 2026-03-10
author: 'jane-doe'
tags: [fintech, fraud-detection, ml, real-time]
categories: [FinTech, AI]
draft: false
toc: true
---

Fraud costs merchants an average of 3.6% of revenue annually. Traditional rule-based fraud systems catch obvious attacks but miss sophisticated fraud patterns. We built an ML-powered fraud scoring system that evaluates every transaction in under 100ms, reducing fraud losses by 42% while keeping false positives below 1%.

Here's the architecture and implementation.

## The Scoring Pipeline

Every payment transaction flows through the fraud engine before authorization:

```
Payment Request → Feature Extraction → Model Scoring → Decision Engine → Approve/Review/Reject
                      (< 30ms)            (< 40ms)         (< 10ms)
```

```python
import numpy as np
from dataclasses import dataclass

@dataclass
class FraudScore:
    score: float          # 0.0 to 1.0
    risk_level: str       # "low", "medium", "high"
    factors: list[str]    # Top contributing factors
    model_version: str

class FraudEngine:
    def __init__(self, model, feature_store, rule_engine):
        self.model = model
        self.feature_store = feature_store
        self.rule_engine = rule_engine

    async def evaluate(self, transaction: Transaction) -> FraudScore:
        # 1. Extract features (< 30ms)
        features = await self.feature_store.get_features(transaction)

        # 2. Score with ML model (< 40ms)
        score = self.model.predict(features)

        # 3. Apply business rules (< 10ms)
        decision = self.rule_engine.apply(score, transaction)

        return FraudScore(
            score=score,
            risk_level=decision.risk_level,
            factors=self.model.explain(features),
            model_version=self.model.version,
        )
```

## Feature Engineering

The quality of fraud detection depends entirely on features. We compute 50+ features per transaction:

```python
class FeatureExtractor:
    async def extract(self, txn: Transaction) -> dict:
        features = {}

        # Transaction features
        features['amount'] = txn.amount
        features['amount_log'] = np.log1p(txn.amount)
        features['is_international'] = txn.country != txn.card_country

        # Velocity features (from Redis)
        features['txns_last_hour'] = await self.redis.get(
            f"velocity:{txn.customer_id}:1h"
        )
        features['txns_last_24h'] = await self.redis.get(
            f"velocity:{txn.customer_id}:24h"
        )
        features['total_amount_24h'] = await self.redis.get(
            f"volume:{txn.customer_id}:24h"
        )

        # Behavioral features
        features['time_since_last_txn'] = await self.get_time_since_last(txn.customer_id)
        features['new_device'] = txn.device_id not in await self.get_known_devices(txn.customer_id)
        features['new_shipping_address'] = txn.shipping_address not in await self.get_known_addresses(txn.customer_id)

        # Historical fraud features
        features['customer_chargeback_rate'] = await self.get_chargeback_rate(txn.customer_id)
        features['ip_fraud_score'] = await self.get_ip_risk(txn.ip_address)

        return features
```

Velocity features are computed in real-time using Redis:

```python
async def update_velocity(self, customer_id: str, amount: int):
    """Update velocity counters in Redis."""
    pipe = self.redis.pipeline()

    # Increment transaction counts
    pipe.incr(f"velocity:{customer_id}:1h")
    pipe.incr(f"velocity:{customer_id}:24h")

    # Add to amount totals
    pipe.incrbyfloat(f"volume:{customer_id}:1h", amount)
    pipe.incrbyfloat(f"volume:{customer_id}:24h", amount)

    # Set TTLs
    pipe.expire(f"velocity:{customer_id}:1h", 3600)
    pipe.expire(f"velocity:{customer_id}:24h", 86400)
    pipe.expire(f"volume:{customer_id}:1h", 3600)
    pipe.expire(f"volume:{customer_id}:24h", 86400)

    await pipe.execute()
```

## Model Architecture

We use a gradient boosting model (XGBoost) for its speed and interpretability:

```python
import xgboost as xgb

class FraudModel:
    def __init__(self, model_path: str):
        self.model = xgb.Booster()
        self.model.load_model(model_path)
        self.version = self._get_version(model_path)

    def predict(self, features: dict) -> float:
        """Return fraud probability (0.0 to 1.0)."""
        dmatrix = xgb.DMatrix([features])
        return float(self.model.predict(dmatrix)[0])

    def explain(self, features: dict) -> list[str]:
        """Return top factors contributing to the score."""
        dmatrix = xgb.DMatrix([features])
        shap_values = self._compute_shap(dmatrix)

        # Return top 3 contributing features
        top_features = sorted(
            zip(features.keys(), shap_values[0]),
            key=lambda x: abs(x[1]),
            reverse=True
        )[:3]

        return [f"{feat}: {value:+.3f}" for feat, value in top_features]
```

## Decision Engine

The raw model score is combined with business rules:

```python
class FraudRuleEngine:
    def apply(self, score: float, txn: Transaction) -> FraudDecision:
        # Hard rules (always reject)
        if txn.amount > 1000000:  # $10,000
            return FraudDecision.REJECT

        if txn.card_country in SANCTIONED_COUNTRIES:
            return FraudDecision.REJECT

        # Score-based decisions
        if score > 0.85:
            return FraudDecision.REJECT

        if score > 0.60:
            return FraudDecision.REVIEW  # Manual review

        if score > 0.30 and txn.amount > 50000:
            return FraudDecision.REVIEW

        return FraudDecision.APPROVE
```

## Model Monitoring

Fraud patterns evolve constantly. We monitor model performance in production:

```python
def monitor_model_performance(scores: list[FraudScore], outcomes: list[bool]):
    """Track model accuracy and drift."""
    # Precision: of flagged transactions, how many were actually fraud?
    flagged = [s for s in scores if s.score > 0.60]
    true_positives = sum(1 for s, o in zip(flagged, outcomes) if o)
    precision = true_positives / len(flagged) if flagged else 0

    # Recall: of actual fraud, how many did we catch?
    actual_fraud = sum(1 for o in outcomes if o)
    recall = true_positives / actual_fraud if actual_fraud else 0

    metrics.gauge("fraud_model.precision", precision)
    metrics.gauge("fraud_model.recall", recall)
    metrics.gauge("fraud_model.avg_score", np.mean([s.score for s in scores]))

    # Alert on drift
    if precision < 0.70:
        alert("fraud_model", f"Precision dropped to {precision:.2%}")
```

## Results

| Metric              | Before ML | With ML |
| ------------------- | --------- | ------- |
| Fraud rate          | 1.8%      | 1.05%   |
| False positive rate | 2.5%      | 0.8%    |
| Avg decision time   | 200ms     | 75ms    |
| Manual review load  | 100%      | 35%     |

## Lessons Learned

1. **Features matter more than models** — invest in feature engineering first
2. **Velocity features catch the most fraud** — sudden changes in behavior are the strongest signal
3. **Monitor for drift** — fraud patterns change; retrain models monthly
4. **Keep rules alongside ML** — hard rules catch edge cases the model hasn't seen
5. **Sub-100ms is achievable** — precompute features, use lightweight models

---

_Questions about fraud detection? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
