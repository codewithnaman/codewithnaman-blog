---
title: 'Algorithmic Trading Backtesting'
description: 'Building a robust backtesting framework for algorithmic trading strategies.'
pubDate: 2026-01-18
author: 'alex-chen'
tags: [trading, backtesting, algorithms, systems]
categories: [FinTech, Engineering]
draft: false
toc: true
---

A backtesting framework lets you evaluate trading strategies against historical data before risking real capital. But a naive backtester produces misleading results — it assumes perfect fills, zero slippage, and infinite liquidity. The gap between backtest and live performance is where most algorithmic trading strategies die.

We built an event-driven backtesting engine that models slippage, fees, and market impact realistically. Here's the architecture.

## Event-Driven Architecture

Unlike vectorized backtesters (which process entire arrays at once), an event-driven engine processes events one at a time, simulating real-time trading:

```python
from dataclasses import dataclass
from enum import Enum
from typing import Protocol

class EventType(Enum):
    MARKET_DATA = "market_data"
    SIGNAL = "signal"
    ORDER = "order"
    FILL = "fill"
    COMMISSION = "commission"

@dataclass
class Event:
    type: EventType
    timestamp: datetime
    data: dict

class Strategy(Protocol):
    def on_market_data(self, event: Event) -> list[Event]: ...
    def on_fill(self, event: Event) -> None: ...

class BacktestEngine:
    def __init__(self, strategy: Strategy, broker: Broker, data_feed: DataFeed):
        self.strategy = strategy
        self.broker = broker
        self.data_feed = data_feed
        self.event_queue: PriorityQueue[Event] = PriorityQueue()

    def run(self, start: datetime, end: datetime):
        for bar in self.data_feed.iter(start, end):
            # 1. Market data event
            md_event = Event(EventType.MARKET_DATA, bar.timestamp, {'bar': bar})
            self.event_queue.put(md_event)

            # 2. Process events in order
            while not self.event_queue.empty():
                event = self.event_queue.get()
                self._dispatch(event)

    def _dispatch(self, event: Event):
        if event.type == EventType.MARKET_DATA:
            signals = self.strategy.on_market_data(event)
            for signal in signals:
                self.event_queue.put(signal)

        elif event.type == EventType.SIGNAL:
            order = self.broker.create_order(event.data)
            fill_event = Event(EventType.FILL, event.timestamp, {'fill': order.fill()})
            self.event_queue.put(fill_event)

        elif event.type == EventType.FILL:
            self.strategy.on_fill(event)
```

## Realistic Slippage Model

Slippage is the difference between the expected price and the actual fill price. We model it based on order size relative to market volume:

```python
class SlippageModel:
    def __init__(self, base_slippage_bps: float = 1.0):
        self.base_slippage_bps = base_slippage_bps

    def calculate_fill_price(
        self,
        order_price: float,
        side: Side,
        order_size: int,
        avg_volume: int,
        spread: float,
    ) -> float:
        """Calculate realistic fill price with slippage."""

        # Volume-based slippage: larger orders move the market more
        volume_impact = (order_size / max(avg_volume, 1)) * 0.1

        # Spread-based slippage: market orders cross the spread
        spread_impact = spread / 2 if order_size > avg_volume * 0.01 else 0

        # Base slippage (market noise)
        base = order_price * (self.base_slippage_bps / 10000)

        total_slippage = base + volume_impact + spread_impact

        if side == Side.BUY:
            return order_price + total_slippage
        else:
            return order_price - total_slippage
```

## Commission and Fee Modeling

Real trading has costs. Our broker model includes commissions, exchange fees, and SEC fees:

```python
class CommissionModel:
    def calculate(self, order: Order, fill_price: float) -> float:
        """Calculate total trading costs."""

        # Per-share commission
        commission = order.quantity * 0.005  # $0.005 per share

        # Exchange fees (maker/taker)
        if order.is_maker:
            exchange_fee = order.quantity * 0.002  # Rebate for maker
        else:
            exchange_fee = order.quantity * 0.003  # Fee for taker

        # SEC fee (sell orders only, $8 per $1M)
        sec_fee = 0
        if order.side == Side.SELL:
            sec_fee = (order.quantity * fill_price) * 0.000008

        # FINRA TAF ($0.000145 per share, max $7.27)
        taf = min(order.quantity * 0.000145, 7.27)

        return commission + exchange_fee + sec_fee + taf
```

## Performance Metrics

The engine calculates realistic performance metrics:

```python
class PerformanceAnalyzer:
    def analyze(self, trades: list[Trade], equity_curve: list[float]) -> dict:
        returns = np.diff(equity_curve) / equity_curve[:-1]

        return {
            'total_return': f"{(equity_curve[-1] / equity_curve[0] - 1) * 100:.2f}%",
            'sharpe_ratio': self.sharpe(returns),
            'max_drawdown': self.max_drawdown(equity_curve),
            'win_rate': self.win_rate(trades),
            'profit_factor': self.profit_factor(trades),
            'avg_trade': np.mean([t.pnl for t in trades]),
            'total_commissions': sum(t.commission for t in trades),
            'total_slippage': sum(t.slippage_cost for t in trades),
            'trades_per_day': len(trades) / self.trading_days,
        }

    def sharpe(self, returns: np.ndarray, risk_free_rate: float = 0.04) -> float:
        """Annualized Sharpe ratio."""
        excess_returns = returns - risk_free_rate / 252
        return np.mean(excess_returns) / np.std(excess_returns) * np.sqrt(252)

    def max_drawdown(self, equity: list[float]) -> float:
        """Maximum peak-to-trough drawdown."""
        peak = np.maximum.accumulate(equity)
        drawdown = (equity - peak) / peak
        return np.min(drawdown) * 100
```

## Avoiding Overfitting

The biggest risk in backtesting is overfitting — creating a strategy that works perfectly on historical data but fails in live trading.

```python
class WalkForwardOptimizer:
    """Walk-forward optimization to prevent overfitting."""

    def optimize(self, strategy, data, train_months: int = 6, test_months: int = 3):
        """Train on rolling windows, test on unseen data."""
        results = []

        for start in range(0, len(data) - train_months - test_months, test_months):
            train_data = data[start:start + train_months]
            test_data = data[start + train_months:start + train_months + test_months]

            # Optimize parameters on training data
            best_params = self.find_best_params(strategy, train_data)

            # Test on unseen data
            engine = BacktestEngine(strategy(**best_params), ...)
            result = engine.run(test_data)
            results.append(result)

        return {
            'in_sample': [r for r in results if r.phase == 'train'],
            'out_of_sample': [r for r in results if r.phase == 'test'],
        }
```

If the out-of-sample performance is significantly worse than in-sample, the strategy is overfit.

## Lessons Learned

1. **Model costs realistically** — commissions and slippage can turn a profitable strategy into a loser
2. **Use event-driven architecture** — vectorized backtesters hide timing issues
3. **Walk-forward test everything** — a single backtest is not evidence of a good strategy
4. **Include market impact** — your orders move prices, especially for illiquid securities
5. **Track slippage separately** — it's the biggest source of backtest-to-live divergence

---

_Questions about algorithmic trading? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
