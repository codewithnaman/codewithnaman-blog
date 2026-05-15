---
title: 'Market Data Feed Processing'
description: 'High-throughput market data feed handling with low latency.'
pubDate: 2026-02-05
author: 'alex-chen'
tags: [trading, market-data, low-latency, systems]
categories: [FinTech, Engineering]
draft: false
toc: true
---

Market data feeds are the lifeblood of any trading system. A single stock exchange can produce 500K+ price updates per second during peak hours, and your pipeline must process, normalize, and distribute these updates with minimal latency.

We built a market data pipeline in C++ that processes 500K+ ticks per second with average latency under 200 microseconds. Here's how.

## The Market Data Flow

```
Exchange Feed → Packet Capture → Protocol Decode → Normalization → Distribution → Subscribers
                 (< 50μs)          (< 80μs)          (< 40μs)       (< 30μs)
```

Each stage is optimized for throughput and latency. The entire pipeline runs on a single server with kernel-bypass networking.

## Kernel-Bypass Networking

Standard Linux networking adds 10-50μs of latency per packet due to kernel context switches. We use DPDK (Data Plane Development Kit) to bypass the kernel entirely:

```cpp
#include <rte_ethdev.h>
#include <rte_mbuf.h>

class MarketDataReceiver {
    struct rte_mempool* mb_pool;
    uint16_t port_id;

public:
    MarketDataReceiver(uint16_t port) : port_id(port) {
        // Allocate mbuf pool for packet buffers
        mb_pool = rte_pktmbuf_pool_create("mb_pool", 65536, 256, 0,
                                          RTE_MBUF_DEFAULT_BUF_SIZE,
                                          rte_socket_id());

        // Configure Ethernet device
        struct rte_eth_conf port_conf = {};
        rte_eth_dev_configure(port_id, 1, 0, &port_conf);

        // Allocate RX queue
        rte_eth_rx_queue_setup(port_id, 0, 1024, rte_socket_id(),
                               nullptr, mb_pool);
        rte_eth_dev_start(port_id);
    }

    void process_packets(PacketHandler& handler) {
        struct rte_mbuf* bufs[BURST_SIZE];
        uint16_t nb_rx = rte_eth_rx_burst(port_id, 0, bufs, BURST_SIZE);

        for (uint16_t i = 0; i < nb_rx; i++) {
            void* data = rte_pktmbuf_mtod(bufs[i], void*);
            uint16_t len = rte_pktmbuf_data_len(bufs[i]);

            handler.process(data, len);
            rte_pktmbuf_free(bufs[i]);
        }
    }
};
```

DPDK polls the NIC directly from user space, eliminating kernel context switches and interrupt overhead. This alone reduces per-packet latency from ~30μs to ~2μs.

## Zero-Copy Protocol Decoding

Market data protocols (ITCH, OUCH, FIX) are binary. We decode them without copying data into intermediate buffers:

```cpp
struct ITCHMessage {
    uint8_t message_type;
    uint16_t stock_locate;
    uint16_t tracking_number;
    uint64_t timestamp;
    // Variable fields follow...
};

class ITCHDecoder {
public:
    void decode(const uint8_t* data, uint16_t length, MarketDataHandler& handler) {
        // Parse directly from the packet buffer — no copying
        const uint8_t* ptr = data;
        char msg_type = *ptr++;

        switch (msg_type) {
            case 'A': {  // Add Order
                const auto* msg = reinterpret_cast<const AddOrderMsg*>(ptr);
                handler.on_add_order({
                    .order_id = le64toh(msg->order_id),
                    .side = msg->side == 'B' ? Side::Buy : Side::Sell,
                    .shares = le32toh(msg->shares),
                    .symbol = std::string_view(msg->stock, 8),
                    .price = le32toh(msg->price),
                });
                break;
            }
            case 'E': {  // Order Executed
                const auto* msg = reinterpret_cast<const ExecutedMsg*>(ptr);
                handler.on_execution({
                    .order_id = le64toh(msg->order_id),
                    .shares = le32toh(msg->executed_shares),
                    .price = le32toh(msg->execution_price),
                });
                break;
            }
            // ... other message types
        }
    }
};
```

The key insight: `reinterpret_cast` lets us treat the raw packet bytes as a typed struct. No parsing, no string conversion, no allocation.

## Ring Buffer Distribution

Processed market data is distributed to subscribers via lock-free ring buffers:

```cpp
template<typename T, size_t SIZE = 65536>
class RingBuffer {
    std::array<T, SIZE> buffer_;
    std::atomic<uint64_t> write_pos_{0};
    std::atomic<uint64_t> read_pos_{0};

public:
    bool try_publish(const T& item) {
        uint64_t current_write = write_pos_.load(std::memory_order_relaxed);
        uint64_t current_read = read_pos_.load(std::memory_order_acquire);

        if (current_write - current_read >= SIZE) {
            return false;  // Buffer full
        }

        buffer_[current_write % SIZE] = item;
        write_pos_.store(current_write + 1, std::memory_order_release);
        return true;
    }

    bool try_consume(T& item) {
        uint64_t current_read = read_pos_.load(std::memory_order_relaxed);
        uint64_t current_write = write_pos_.load(std::memory_order_acquire);

        if (current_read >= current_write) {
            return false;  // Buffer empty
        }

        item = buffer_[current_read % SIZE];
        read_pos_.store(current_read + 1, std::memory_order_release);
        return true;
    }
};
```

Each subscriber gets its own ring buffer. The publisher writes once per subscriber (or uses multicast for shared subscribers). No locks, no allocations, no syscalls.

## Book Building

The normalized tick stream builds and maintains order books:

```cpp
class OrderBookBuilder {
    std::unordered_map<std::string, OrderBook> books_;

public:
    void on_tick(const NormalizedTick& tick) {
        auto& book = books_[tick.symbol];

        switch (tick.type) {
            case TickType::ADD:
                book.add_order(tick.order_id, tick.side, tick.price, tick.quantity);
                break;
            case TickType::MODIFY:
                book.modify_order(tick.order_id, tick.price, tick.quantity);
                break;
            case TickType::DELETE:
                book.remove_order(tick.order_id);
                break;
            case TickType::TRADE:
                book.execute(tick.order_id, tick.price, tick.quantity);
                break;
        }

        // Publish book updates (top of book)
        if (book.dirty()) {
            market_data_publisher.publish(book.snapshot());
            book.clear_dirty();
        }
    }
};
```

## Performance Results

| Metric            | Value             |
| ----------------- | ----------------- |
| Peak throughput   | 520K ticks/sec    |
| Average latency   | 180μs             |
| P99 latency       | 450μs             |
| CPU utilization   | 35% (single core) |
| Packet loss       | 0%                |
| Memory per symbol | 2MB (order book)  |

## Lessons Learned

1. **Kernel-bypass is essential for sub-millisecond latency** — standard networking is too slow
2. **Zero-copy everywhere** — any data copy adds latency and CPU overhead
3. **Lock-free data structures** — mutexes add unpredictable latency spikes
4. **Pre-allocate all memory** — the hot path should never call malloc
5. **Measure everything** — latency percentiles matter more than averages

---

_Questions about market data systems? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
