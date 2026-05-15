---
title: 'Vector Databases at Scale'
description: 'How to handle billions of embeddings while keeping sub-100ms query latency.'
pubDate: 2026-04-25
author: 'john-smith'
tags: [ai, vector-database, milvus, pinecone]
categories: [AI, Engineering]
draft: false
toc: true
---

Vector databases are the backbone of any production AI system. But with dozens of options available, choosing the right one requires understanding trade-offs that benchmarks alone won't reveal.

We spent three months benchmarking Pinecone, Weaviate, Milvus, and pgvector under realistic production workloads. Here's what we found.

## Test Setup

Our benchmark simulates a RAG pipeline workload:

- **Dataset**: 10M vectors of 1536 dimensions (OpenAI text-embedding-3-small output)
- **Write pattern**: Bulk load of 10M vectors, then 1K inserts/sec sustained
- **Read pattern**: 500 QPS of top-10 nearest neighbor queries with metadata filters
- **Hardware**: Consistent across managed services; self-hosted on c6i.4xlarge instances

```python
import time
import numpy as np

def benchmark_insert(client, vectors: np.ndarray, batch_size: int = 1000) -> float:
    """Measure sustained insert throughput."""
    start = time.time()
    for i in range(0, len(vectors), batch_size):
        batch = vectors[i:i + batch_size]
        client.upsert(batch)
    elapsed = time.time() - start
    return len(vectors) / elapsed  # vectors per second

def benchmark_query(client, queries: np.ndarray, top_k: int = 10) -> dict:
    """Measure query latency distribution."""
    latencies = []
    for q in queries:
        start = time.time()
        client.query(q, top_k=top_k)
        latencies.append((time.time() - start) * 1000)

    latencies.sort()
    return {
        'p50': latencies[len(latencies) // 2],
        'p95': latencies[int(len(latencies) * 0.95)],
        'p99': latencies[int(len(latencies) * 0.99)],
    }
```

## Results Summary

| Metric              | Pinecone | Weaviate | Milvus  | pgvector |
| ------------------- | -------- | -------- | ------- | -------- |
| Bulk load (10M vec) | 12 min   | 28 min   | 8 min   | 45 min   |
| Sustained insert    | 1,200/s  | 800/s    | 2,100/s | 400/s    |
| Query P50           | 18ms     | 22ms     | 12ms    | 35ms     |
| Query P99           | 85ms     | 120ms    | 65ms    | 180ms    |
| Metadata filter + Q | 25ms     | 30ms     | 18ms    | 55ms     |
| Monthly cost (est.) | $1,200   | $600     | $400    | $200     |

## Pinecone: The Managed Option

Pinecone is the easiest to get started with. No infrastructure to manage, automatic scaling, and a clean API. But the costs add up quickly at scale.

```python
import pinecone

pc = pinecone.Pinecone(api_key=API_KEY)
index = pc.Index('production-embeddings')

# Upsert with metadata
index.upsert(vectors=[
    {"id": "doc_1", "values": embedding, "metadata": {"source": "docs", "version": "2.1"}}
])

# Query with metadata filter
results = index.query(
    vector=query_embedding,
    top_k=10,
    filter={"source": {"$eq": "docs"}},
    include_metadata=True
)
```

**Best for**: Teams that want to focus on AI features, not infrastructure. The premium is worth it if your team is small or you need to ship fast.

## Weaviate: The Hybrid Choice

Weaviate's strength is its built-in hybrid search — combining vector similarity with BM25 keyword search out of the box. This eliminated the need for a separate Elasticsearch cluster in our stack.

```yaml
# Weaviate schema with hybrid search enabled
classes:
  - class: Document
    vectorizer: none
    properties:
      - name: content
        dataType: [text]
        indexSearchable: true
      - name: source
        dataType: [string]
        indexFilterable: true
```

Weaviate's Go-based architecture is efficient, but the Python client has some rough edges around batch operations. We had to implement custom retry logic for bulk loads.

## Milvus: The Performance King

Milvus consistently delivered the best query performance in our tests. Its C++ core and GPU acceleration options make it the choice for latency-sensitive workloads.

```python
from pymilvus import connections, Collection

connections.connect(host='milvus', port='19530')
collection = Collection('embeddings')

# Create index with IVF_FLAT for speed
index_params = {
    "index_type": "IVF_FLAT",
    "metric_type": "IP",
    "params": {"nlist": 2048}
}
collection.create_index("embedding", index_params)

# Search with filter
results = collection.search(
    data=[query_embedding],
    anns_field="embedding",
    param={"nprobe": 32},
    limit=10,
    expr="source == 'docs'"
)
```

The trade-off: Milvus has the steepest operational complexity. You're managing etcd, MinIO, and multiple Milvus components. Not ideal for small teams.

## pgvector: The Pragmatic Choice

pgvector won on cost and operational simplicity. If you already run PostgreSQL, adding vector search is just an extension away.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE embeddings (
    id UUID PRIMARY KEY,
    embedding vector(1536),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX ON embeddings USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 2048);

-- Hybrid query
SELECT id, metadata,
       1 - (embedding <=> $1::vector) AS similarity
FROM embeddings
WHERE metadata->>'source' = 'docs'
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

The performance gap is real — pgvector is 2-3x slower than dedicated vector databases. But for workloads under 1M vectors with moderate QPS, it's more than adequate.

## Decision Framework

Choose based on your constraints:

| If you need...           | Choose   |
| ------------------------ | -------- |
| Fastest time to market   | Pinecone |
| Hybrid search built-in   | Weaviate |
| Lowest query latency     | Milvus   |
| Lowest cost / simplicity | pgvector |
| GPU acceleration         | Milvus   |
| Existing Postgres infra  | pgvector |

## Lessons Learned

1. **Benchmark with your actual data** — synthetic benchmarks lie; use your real embedding distribution
2. **Factor in operational cost** — managed services save engineering time but cost more at scale
3. **Test metadata filtering** — vector search is fast everywhere; filtered search reveals real differences
4. **Plan for growth** — what works at 100K vectors may not work at 10M
5. **Don't over-optimize early** — start with pgvector, migrate when you actually hit limits

---

_Questions about vector database selection? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
