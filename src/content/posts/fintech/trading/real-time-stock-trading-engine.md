---
title: 'Building a Real-Time Stock Trading Engine'
description: 'Low-latency order matching engine handling 1M+ orders/day with deterministic execution.'
pubDate: 2026-03-20
author: 'alex-chen'
tags: [trading, low-latency, systems]
categories: [FinTech, Engineering]
draft: false
toc: true
---

A trading engine is one of the most demanding systems you can build. It must match buy and sell orders in microseconds, maintain perfect consistency, and never lose an order. We built an order matching engine in Rust that handles 1M+ orders daily with deterministic execution and P99 latency under 50 microseconds.

Here's the architecture and the decisions that mattered.

## Core Design: Single-Threaded Event Loop

The matching engine runs as a single-threaded event loop. This eliminates concurrency bugs and ensures deterministic ordering — the same sequence of inputs always produces the same sequence of outputs.

```rust
struct TradingEngine {
    order_books: HashMap<Symbol, OrderBook>,
    event_log: EventLog,
    sequence: u64,
}

impl TradingEngine {
    fn process_event(&mut self, event: OrderEvent) -> Vec<ExecutionReport> {
        self.sequence += 1;

        let reports = match event {
            OrderEvent::NewOrder(order) => {
                self.order_books
                    .entry(order.symbol)
                    .or_insert_with(|| OrderBook::new(order.symbol))
                    .add_order(order, self.sequence)
            }
            OrderEvent::CancelOrder(cancel) => {
                self.order_books
                    .get_mut(&cancel.symbol)
                    .map(|book| book.cancel_order(cancel))
                    .unwrap_or_default()
            }
        };

        // Log all events for replay
        self.event_log.append(self.sequence, &event, &reports);

        reports
    }
}
```

Single-threaded might sound like a limitation, but a modern CPU core can process millions of simple operations per second. Our bottleneck is never CPU — it's network I/O.

## Order Book Implementation

The order book maintains buy and sell orders with price-time priority:

```rust
use std::collections::BTreeMap;

struct OrderBook {
    symbol: Symbol,
    bids: BTreeMap<Price, PriceLevel>,  // Descending price
    asks: BTreeMap<Price, PriceLevel>,  // Ascending price
    order_index: HashMap<OrderId, (Price, Side)>,
}

struct PriceLevel {
    orders: VecDeque<Order>,
    total_volume: u64,
}

impl OrderBook {
    fn add_order(&mut self, order: Order, sequence: u64) -> Vec<ExecutionReport> {
        let mut reports = Vec::new();

        // Try to match against the opposite side
        let opposite = if order.side == Side::Buy {
            &mut self.asks
        } else {
            &mut self.bids
        };

        while order.remaining_volume() > 0 {
            let best_price = match order.side {
                Side::Buy => opposite.keys().next().copied(),
                Side::Sell => opposite.keys().next_back().copied(),
            };

            let Some(best) = best_price else { break };

            // Check price compatibility
            if order.side == Side::Buy && best > order.price { break; }
            if order.side == Side::Sell && best < order.price { break; }

            // Execute trade
            let level = opposite.get_mut(&best).unwrap();
            let matched = level.orders.front_mut().unwrap();
            let fill_qty = order.remaining_volume().min(matched.remaining_volume());

            matched.fill(fill_qty, sequence);
            reports.push(ExecutionReport::fill(order.id, matched.id, best, fill_qty));

            if matched.is_filled() {
                level.orders.pop_front();
                if level.orders.is_empty() {
                    opposite.remove(&best);
                }
            }
        }

        // Rest goes to the book
        if order.remaining_volume() > 0 {
            self.add_to_book(order);
            reports.push(ExecutionReport::accepted(order.id));
        }

        reports
    }
}
```

Using `BTreeMap` gives us O(log n) price lookups and automatic price ordering. For the highest-performance implementations, you'd use a fixed-size array with direct indexing, but BTreeMap is fast enough for most use cases.

## Market Data Feed

The engine publishes real-time market data for every state change:

```rust
struct MarketDataPublisher {
    udp_socket: UdpSocket,
    sequence: u64,
}

impl MarketDataPublisher {
    fn publish_trade(&mut self, trade: Trade) {
        self.sequence += 1;

        let msg = TradeMessage {
            msg_type: MessageType::Trade,
            sequence: self.sequence,
            timestamp: Instant::now(),
            symbol: trade.symbol,
            price: trade.price,
            quantity: trade.quantity,
            aggressor: trade.aggressor_side,
        };

        // Serialize to binary format (no JSON — too slow)
        let bytes = msg.to_bytes();
        self.udp_socket.send_to(&bytes, "239.0.0.1:5001").unwrap();
    }
}
```

Market data is published via UDP multicast. Subscribers (trading algorithms, dashboards, risk systems) listen to the multicast group and receive updates in real-time.

## Persistence and Recovery

The engine maintains an append-only event log for crash recovery:

```rust
struct EventLog {
    file: File,
    buffer: Vec<u8>,
}

impl EventLog {
    fn append(&mut self, sequence: u64, event: &OrderEvent, reports: &[ExecutionReport]) {
        let entry = LogEntry {
            sequence,
            timestamp: Instant::now(),
            event: event.clone(),
            reports: reports.to_vec(),
        };

        self.buffer.extend(entry.to_bytes());

        // Flush every 1000 entries or 10ms
        if self.buffer.len() > 65536 {
            self.flush();
        }
    }

    fn flush(&mut self) {
        self.file.write_all(&self.buffer).unwrap();
        self.file.sync_all().unwrap();  // fsync
        self.buffer.clear();
    }
}
```

On restart, the engine replays the event log to reconstruct the order book state. A full day's activity (~1M events) replays in under 30 seconds.

## Latency Optimization

Key optimizations for sub-50μs latency:

```rust
// 1. Pre-allocate memory (no allocations in the hot path)
let mut report_pool = ObjectPool::new(10000, ExecutionReport::default);

// 2. Use stack allocation for small messages
#[repr(C)]
struct OrderMessage {
    msg_type: u8,
    symbol: [u8; 8],
    order_id: u64,
    price: u64,
    quantity: u32,
    side: u8,
} // 32 bytes — fits in cache line

// 3. Busy-wait spinlock instead of mutex for shared state
struct SpinLock<T> {
    inner: UnsafeCell<T>,
    locked: AtomicBool,
}

// 4. Batch network I/O
fn process_batch(&mut self, messages: &[OrderMessage]) -> Vec<ExecutionReport> {
    let mut all_reports = Vec::with_capacity(messages.len() * 2);
    for msg in messages {
        all_reports.extend(self.process_message(msg));
    }
    all_reports
}
```

## Lessons Learned

1. **Single-threaded is simpler and fast enough** — don't add concurrency until you've measured
2. **Deterministic execution is non-negotiable** — replay must produce identical results
3. **Pre-allocate everything** — heap allocation in the hot path adds unpredictable latency
4. **Binary protocols over JSON** — serialization speed matters at microsecond scale
5. **Test with production traffic replay** — synthetic tests don't capture real-world patterns

---

_Questions about trading systems? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
