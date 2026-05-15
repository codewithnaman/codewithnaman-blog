---
title: 'Message Queue Comparison'
description: 'Comparing Kafka, RabbitMQ, and Redis Streams for different use cases.'
pubDate: 2025-08-10
author: 'naman-gupta'
tags: [backend, kafka, rabbitmq, redis, messaging]
categories: [Backend, Engineering]
draft: false
toc: true
---

Message queues are the nervous system of a distributed application. But choosing between Kafka, RabbitMQ, and SQS isn't about which is "best" — it's about which trade-offs match your workload.

After running all three in production, here's a practical decision framework based on real operational experience.

## Throughput Comparison

We benchmarked each system on identical hardware (c6i.4xlarge, 16 vCPU, 32GB RAM):

| Metric             | Kafka      | RabbitMQ    | SQS         |
| ------------------ | ---------- | ----------- | ----------- |
| Max publish rate   | 800K msg/s | 50K msg/s   | 3K msg/s    |
| Max consume rate   | 1M msg/s   | 40K msg/s   | 3K msg/s    |
| Avg latency (p99)  | 10ms       | 5ms         | 250ms       |
| Message size limit | 1MB        | 128MB       | 256KB       |
| Retention          | Unlimited  | Until ack'd | 14 days max |

Kafka dominates on throughput. RabbitMQ wins on latency. SQS is the slowest but requires zero infrastructure management.

## Ordering Guarantees

Ordering is where the differences become stark:

```python
# Kafka: ordering per partition key
producer.send(
    topic='orders',
    key=b'customer_123',  # Same key = same partition = ordered
    value=b'{"event": "order.created", "customer": "123"}'
)
producer.send(
    topic='orders',
    key=b'customer_123',
    value=b'{"event": "payment.received", "customer": "123"}'
)
# Guaranteed: order.created is consumed before payment.received

# RabbitMQ: no ordering guarantee across consumers
channel.basic_publish(
    exchange='orders',
    routing_key='order_events',
    body=b'{"event": "order.created"}'
)
# Multiple consumers may receive messages out of order

# SQS: standard queue has no ordering; FIFO queue has ordering but limited throughput
sqs.send_message(
    QueueUrl=FIFO_QUEUE_URL,
    MessageBody='{"event": "order.created"}',
    MessageGroupId='customer_123',  # FIFO only
)
```

**Ordering summary:**

| System       | Ordering          | Guarantee                 |
| ------------ | ----------------- | ------------------------- |
| Kafka        | Per partition key | Strict within partition   |
| RabbitMQ     | Per queue         | Strict if single consumer |
| SQS Standard | None              | Best effort only          |
| SQS FIFO     | Per message group | Strict within group       |

## Operational Complexity

This is often the deciding factor:

### Kafka

```bash
# Minimum production Kafka setup:
# - 3 ZooKeeper nodes (or KRaft mode)
# - 3+ Kafka brokers
# - Topic management
# - Partition rebalancing
# - Consumer group coordination
```

Kafka has the highest operational overhead. You're managing a distributed system with many moving parts. Confluent Cloud reduces this but at a premium cost.

### RabbitMQ

```bash
# RabbitMQ setup:
# - 3-node cluster (mirrored queues)
# - Queue/exchange declarations
# - Vhost management
```

RabbitMQ is simpler than Kafka but still requires cluster management. The management UI is excellent for debugging.

### SQS

```python
# SQS setup:
import boto3
sqs = boto3.client('sqs')
queue = sqs.create_queue(QueueName='my-queue')
# That's it. No infrastructure to manage.
```

SQS has zero operational overhead. You don't manage servers, clusters, or partitions. The trade-off is less control and higher per-message cost at scale.

## Decision Framework

### Choose Kafka when:

- You need high throughput (100K+ messages/second)
- Event replay is valuable (new service onboarding, debugging)
- You need streaming analytics (Kafka Streams, ksqlDB)
- You can handle operational complexity

```python
# Kafka excels at event streaming
from kafka import KafkaConsumer

consumer = KafkaConsumer(
    'orders.events',
    bootstrap_servers=['kafka:9092'],
    auto_offset_reset='earliest',  # Can replay from beginning
    group_id='analytics-service',
)

for message in consumer:
    process_event(message.value)
```

### Choose RabbitMQ when:

- You need complex routing patterns (topic exchanges, headers)
- Low latency is critical (< 10ms)
- You need message TTL, dead letter queues, or priority queues
- Moderate throughput (under 50K messages/second)

```python
# RabbitMQ excels at complex routing
channel.exchange_declare(exchange='orders', exchange_type='topic')
channel.queue_bind(exchange='orders', queue='email_notifications',
                   routing_key='order.*.created')
channel.queue_bind(exchange='orders', queue='inventory_updates',
                   routing_key='order.*.shipped')
```

### Choose SQS when:

- You want zero infrastructure management
- Throughput needs are moderate (under 3K messages/second)
- You're already on AWS
- You don't need event replay

```python
# SQS excels at simple task queues
sqs.send_message(
    QueueUrl=QUEUE_URL,
    MessageBody=json.dumps({'task': 'send_email', 'to': 'user@example.com'}),
    DelaySeconds=60,  # Built-in delay queue
)
```

## Our Production Setup

We use all three, each for its strengths:

```
Event Streaming (Kafka):
  - Order events (replay needed for new services)
  - User activity tracking (high throughput)
  - Audit log (unlimited retention)

Task Distribution (RabbitMQ):
  - Email/SMS notifications (complex routing)
  - Report generation (priority queues)
  - Webhook delivery (dead letter queues)

Simple Queues (SQS):
  - Lambda triggers (native AWS integration)
  - Background jobs (low throughput, zero ops)
  - Batch processing (visibility timeouts)
```

## Lessons Learned

1. **Match the tool to the workload** — no single queue handles everything well
2. **Throughput needs change** — design for 10x your current load
3. **Ordering is expensive** — only require it when you actually need it
4. **Dead letter queues are mandatory** — failed messages need somewhere to go
5. **Monitor queue depth** — growing queues are your earliest failure indicator

---

_Questions about message queues? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
