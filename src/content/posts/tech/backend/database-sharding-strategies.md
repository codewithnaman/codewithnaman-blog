---
title: 'Database Sharding Strategies'
description: 'Scaling databases with horizontal partitioning techniques.'
pubDate: 2025-09-15
author: 'naman-gupta'
tags: [backend, database, sharding, scaling]
categories: [Backend, Engineering]
draft: false
toc: true
---

Our PostgreSQL database hit a wall at 15M daily writes. Query latency climbed, autovacuum couldn't keep up, and our single 2TB instance was running out of IOPS. Sharding was the only option that didn't require a complete architecture rewrite.

Here's how we sharded PostgreSQL to handle 50M+ daily writes across 8 shards, and the mistakes we made along the way.

## Choosing a Shard Key

The shard key determines data distribution and query patterns. Get it wrong, and you'll have hot shards that bottleneck your entire system.

```python
def select_shard_key(record: dict) -> int:
    """Determine which shard a record belongs to."""
    # BAD: Sequential IDs create hot shards
    # shard_id = record['id'] % NUM_SHARDS

    # BAD: Timestamps create time-based hot shards
    # shard_id = hash(record['created_at']) % NUM_SHARDS

    # GOOD: Hash of a high-cardinality, evenly-distributed field
    shard_id = hash(record['tenant_id']) % NUM_SHARDS
    return shard_id
```

Our selection criteria:

| Criterion          | Why It Matters                              |
| ------------------ | ------------------------------------------- |
| High cardinality   | Ensures even distribution across shards     |
| Query locality     | Most queries should target a single shard   |
| Stable             | Shard assignment shouldn't change over time |
| Multi-tenant aware | All data for a tenant stays on one shard    |

We chose `tenant_id` because 95% of our queries are tenant-scoped, and tenants are evenly distributed in size.

## Sharding Architecture

We used application-level sharding with a routing layer:

```
Application → Shard Router → [
    Shard 0 (tenant_ids: 0-124)
    Shard 1 (tenant_ids: 125-249)
    Shard 2 (tenant_ids: 250-374)
    ...
    Shard 7 (tenant_ids: 875-999)
]
```

```python
class ShardRouter:
    def __init__(self, shard_map: dict):
        self.shard_map = shard_map  # tenant_id → shard_id
        self.connections = {
            i: create_connection(f"shard-{i}.db.internal")
            for i in range(NUM_SHARDS)
        }

    def get_connection(self, tenant_id: int) -> Connection:
        shard_id = self.shard_map.get(tenant_id)
        if shard_id is None:
            shard_id = hash(tenant_id) % NUM_SHARDS
        return self.connections[shard_id]

    def execute(self, tenant_id: int, query: str, params: tuple):
        conn = self.get_connection(tenant_id)
        return conn.execute(query, params)
```

## Cross-Shard Queries

The hardest problem in sharding is queries that span multiple shards. We handle them with a scatter-gather approach:

```python
def cross_shard_query(query: str, params: tuple) -> list[dict]:
    """Execute query across all shards and merge results."""
    results = []

    # Scatter: send query to all shards in parallel
    with concurrent.futures.ThreadPoolExecutor(max_workers=NUM_SHARDS) as executor:
        futures = {
            executor.submit(
                conn.execute, query, params
            ): shard_id
            for shard_id, conn in router.connections.items()
        }

        # Gather: collect and merge results
        for future in concurrent.futures.as_completed(futures):
            shard_results = future.result()
            results.extend(shard_results)

    # Post-process: sort, limit, aggregate
    return sorted(results, key=lambda x: x['created_at'], reverse=True)[:100]
```

Cross-shard queries are 5-10x slower than single-shard queries, so we minimize them by:

1. Designing queries to be tenant-scoped whenever possible
2. Maintaining a global index for frequently cross-shard queried fields
3. Using materialized views for cross-shard aggregations

## Rebalancing

As tenants grow, shards become imbalanced. We rebalance by migrating tenants between shards:

```python
def rebalance_shards():
    """Move tenants from overloaded shards to underloaded ones."""
    shard_sizes = get_shard_sizes()
    avg_size = sum(shard_sizes.values()) / NUM_SHARDS

    overloaded = [s for s, size in shard_sizes.items() if size > avg_size * 1.3]
    underloaded = [s for s, size in shard_sizes.items() if size < avg_size * 0.7]

    for source in overloaded:
        for target in underloaded:
            # Find smallest tenant on overloaded shard
            tenant = get_smallest_tenant(source)
            if not tenant:
                break

            migrate_tenant(tenant, source, target)
            shard_sizes[source] -= tenant.size
            shard_sizes[target] += tenant.size

def migrate_tenant(tenant_id: int, source: int, target: int):
    """Migrate a tenant's data between shards with zero downtime."""
    # Phase 1: Dual-write to both shards
    enable_dual_write(tenant_id, source, target)

    # Phase 2: Copy existing data
    copy_data(tenant_id, source, target)

    # Phase 3: Verify data consistency
    verify_consistency(tenant_id, source, target)

    # Phase 4: Switch reads to new shard
    update_shard_map(tenant_id, target)

    # Phase 5: Disable dual-write and clean up
    disable_dual_write(tenant_id, source)
    delete_data(tenant_id, source)
```

## Monitoring

We track shard health with these metrics:

```python
SHARD_METRICS = {
    'write_throughput': 'writes per second per shard',
    'read_throughput': 'reads per second per shard',
    'storage_used': 'GB per shard',
    'query_latency_p99': 'ms per shard',
    'replication_lag': 'seconds per shard',
    'connection_count': 'active connections per shard',
}

def alert_on_imbalance():
    """Alert when shard sizes diverge significantly."""
    sizes = get_shard_sizes()
    max_size = max(sizes.values())
    min_size = min(sizes.values())

    if max_size / min_size > 2.0:
        send_alert(
            f"Shard imbalance: largest shard is {max_size/1024:.1f}GB, "
            f"smallest is {min_size/1024:.1f}GB"
        )
```

## Lessons Learned

1. **Choose your shard key carefully** — changing it later requires a full data migration
2. **Plan for cross-shard queries from day one** — they will happen, and they're slow
3. **Automate rebalancing** — manual shard management doesn't scale
4. **Monitor shard balance continuously** — imbalance creeps up gradually
5. **Test failure scenarios** — what happens when one shard goes down?

---

_Questions about database sharding? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
