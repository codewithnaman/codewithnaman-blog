---
title: 'Order Book Implementation'
description: 'Designing and implementing a high-performance order book for trading systems.'
pubDate: 2025-12-22
author: 'vikas-pathneja'
tags: [trading, order-book, low-latency, systems]
categories: [FinTech, Engineering]
draft: false
toc: true
---

A limit order book (LOB) is the core data structure of any exchange or trading venue. It maintains all outstanding buy and sell orders, matches them according to price-time priority, and produces executions. Getting the data structures right is the difference between microsecond and millisecond latency.

We implemented a limit order book in Go with O(log n) add/cancel operations and benchmarked it at 2M+ operations per second. Here's the implementation.

## Data Structures

The order book uses two price-sorted maps (bids descending, asks ascending), each containing price levels with FIFO order queues:

```go
type Side int

const (
    Buy Side = iota
    Sell
)

type Order struct {
    ID        string
    Symbol    string
    Side      Side
    Price     int64 // In cents to avoid floating point
    Quantity  int64
    Remaining int64
    Timestamp time.Time
}

type PriceLevel struct {
    Price    int64
    Orders   *list.List // FIFO queue of orders at this price
    Volume   int64      // Total volume at this price
}

type OrderBook struct {
    Symbol    string
    Bids      *PriceTree // Red-black tree, descending
    Asks      *PriceTree // Red-black tree, ascending
    OrderIndex map[string]*OrderEntry // OrderID → (price, side, element)
}

type OrderEntry struct {
    Order *Order
    Side  Side
    Level *PriceLevel
    Elem  *list.Element
}
```

We use a red-black tree (`github.com/emirpasic/gods/trees/redblacktree`) for price levels, giving us O(log n) lookups for best bid/ask and price-level insertion.

## Adding Orders

```go
func (ob *OrderBook) AddOrder(order *Order) []Fill {
    var fills []Fill

    // Try to match against the opposite side
    opposite := ob.asks
    if order.Side == Sell {
        opposite = ob.bids
    }

    for order.Remaining > 0 {
        best := ob.bestPrice(opposite)
        if best == nil {
            break
        }

        // Check price compatibility
        if order.Side == Buy && best.Price > order.Price {
            break
        }
        if order.Side == Sell && best.Price < order.Price {
            break
        }

        // Match with orders at the best price level
        matchFills := ob.matchAtLevel(order, best)
        fills = append(fills, matchFills...)

        // Remove empty price level
        if best.Orders.Len() == 0 {
            opposite.Remove(best.Price)
        }
    }

    // Rest goes to the book
    if order.Remaining > 0 {
        ob.addToBook(order)
    }

    return fills
}

func (ob *OrderBook) addToBook(order *Order) {
    tree := ob.Bids
    if order.Side == Sell {
        tree = ob.Asks
    }

    // Find or create price level
    level, _ := tree.Get(order.Price)
    if level == nil {
        level = &PriceLevel{
            Price:  order.Price,
            Orders: list.New(),
        }
        tree.Put(order.Price, level)
    }

    pl := level.(*PriceLevel)
    elem := pl.Orders.PushBack(order)
    pl.Volume += order.Remaining

    ob.OrderIndex[order.ID] = &OrderEntry{
        Order: order,
        Side:  order.Side,
        Level: pl,
        Elem:  elem,
    }
}
```

## Matching Logic

```go
func (ob *OrderBook) matchAtLevel(incoming *Order, level *PriceLevel) []Fill {
    var fills []Fill

    for level.Orders.Len() > 0 && incoming.Remaining > 0 {
        front := level.Orders.Front()
        resting := front.Value.(*Order)

        fillQty := min(incoming.Remaining, resting.Remaining)

        // Create fill
        fill := Fill{
            BuyOrderID:  selectID(incoming, resting, Buy),
            SellOrderID: selectID(incoming, resting, Sell),
            Price:       resting.Price, // Resting order's price
            Quantity:    fillQty,
            Timestamp:   time.Now(),
        }
        fills = append(fills, fill)

        // Update quantities
        incoming.Remaining -= fillQty
        resting.Remaining -= fillQty

        // Remove filled resting order
        if resting.Remaining == 0 {
            level.Orders.Remove(front)
            delete(ob.OrderIndex, resting.ID)
        }
    }

    level.Volume = calculateVolume(level.Orders)
    return fills
}
```

## Canceling Orders

```go
func (ob *OrderBook) CancelOrder(orderID string) error {
    entry, ok := ob.OrderIndex[orderID]
    if !ok {
        return ErrOrderNotFound
    }

    // Remove from price level
    entry.Level.Orders.Remove(entry.Elem)
    entry.Level.Volume -= entry.Order.Remaining

    // Remove empty price level
    if entry.Level.Orders.Len() == 0 {
        tree := ob.Bids
        if entry.Side == Sell {
            tree = ob.Asks
        }
        tree.Remove(entry.Level.Price)
    }

    delete(ob.OrderIndex, orderID)
    return nil
}
```

Cancel is O(log n) for the tree removal plus O(1) for the linked list removal (we store the element pointer).

## Concurrency Model

The order book uses a single goroutine with a channel-based API. All operations are serialized through the channel, eliminating the need for locks:

```go
type Engine struct {
    books   map[string]*OrderBook
    input   chan Request
    output  chan Response
}

func (e *Engine) Run() {
    for req := range e.input {
        book := e.books[req.Symbol]
        if book == nil {
            book = NewOrderBook(req.Symbol)
            e.books[req.Symbol] = book
        }

        var resp Response
        switch req.Type {
        case ReqAdd:
            fills := book.AddOrder(req.Order)
            resp = Response{Type: RespFill, Fills: fills}
        case ReqCancel:
            err := book.CancelOrder(req.OrderID)
            resp = Response{Type: RespCancel, Error: err}
        case ReqSnapshot:
            resp = Response{Type: RespSnapshot, Book: book.Snapshot()}
        }

        e.output <- resp
    }
}
```

This model guarantees deterministic ordering — requests are processed in the order they arrive on the channel.

## Benchmarks

```
BenchmarkAddOrder-10         2,100,000    570 ns/op    128 B/op    3 allocs/op
BenchmarkCancelOrder-10      3,800,000    315 ns/op     48 B/op    1 allocs/op
BenchmarkMatchOrder-10       1,200,000    980 ns/op    256 B/op    5 allocs/op
BenchmarkSnapshot-10           450,000   2650 ns/op   1024 B/op   12 allocs/op
```

At 2M+ operations per second, the Go implementation is fast enough for most trading venues. For ultra-low-latency HFT, you'd move to C++ with custom allocators and kernel-bypass networking.

## Lessons Learned

1. **Single goroutine is fast enough** — don't add concurrency until you've measured
2. **Store element pointers** — O(1) cancellation requires direct access to the linked list node
3. **Use integers for prices** — floating point introduces rounding errors in matching
4. **Benchmark with realistic data** — synthetic benchmarks don't capture real order flow patterns
5. **Go is fast enough for most venues** — you only need C++ for sub-microsecond HFT

---

_Questions about order book implementation? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
