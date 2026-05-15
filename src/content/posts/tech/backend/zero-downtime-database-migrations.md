---
title: 'Zero-Downtime Database Migrations'
description: 'Strategies for running database migrations without service interruptions.'
pubDate: 2025-08-28
author: 'naman-gupta'
tags: [backend, database, migrations, devops]
categories: [Backend, Engineering]
draft: false
toc: true
---

Database migrations are the most dangerous part of any deployment. A bad migration can lock tables for hours, corrupt data, or take down your entire application. At scale, you can't afford downtime — which means you can't afford traditional migrations.

We've deployed 200+ schema changes to production with zero downtime using the expand-contract pattern. Here's how it works.

## The Problem with Traditional Migrations

A traditional migration looks like this:

```sql
-- DANGEROUS: This locks the orders table during migration
ALTER TABLE orders ADD COLUMN status VARCHAR(50) DEFAULT 'pending';
```

On a table with 50M rows, this `ALTER TABLE` can take 30+ minutes. During that time:

- Writes are blocked
- Reads may be blocked (depending on the database)
- Your application is degraded or down

## The Expand-Contract Pattern

Instead of changing the schema in one step, we do it in three phases across multiple deployments:

### Phase 1: Expand (Add the new column)

```sql
-- SAFE: Adding a nullable column is fast (metadata-only in PostgreSQL 11+)
ALTER TABLE orders ADD COLUMN status VARCHAR(50);
```

This is fast because the column is nullable with no default. Existing rows have `NULL` for the new column.

```python
# Application code: write to BOTH old and new columns
def create_order(data: dict):
    db.execute("""
        INSERT INTO orders (customer_id, total, old_status, status)
        VALUES ($1, $2, $3, $4)
    """, data['customer_id'], data['total'],
               data['old_status'], map_status(data['old_status']))
```

Deploy this code change first. Now both columns are being written.

### Phase 2: Backfill (Populate existing rows)

```python
# Backfill script — runs in batches to avoid locking
def backfill_status(batch_size: int = 1000):
    offset = 0
    while True:
        rows = db.execute("""
            SELECT id, old_status FROM orders
            WHERE status IS NULL
            LIMIT $1 OFFSET $2
        """, batch_size, offset)

        if not rows:
            break

        for row in rows:
            db.execute("""
                UPDATE orders SET status = $1 WHERE id = $2
            """, map_status(row['old_status']), row['id'])

        offset += batch_size
        time.sleep(0.1)  # Don't overwhelm the database
```

Run this as a background job. It may take hours for large tables, but it doesn't block normal operations.

### Phase 3: Contract (Remove the old column)

Once the backfill is complete and all application code reads from the new column:

```sql
-- SAFE: The old column is no longer used
ALTER TABLE orders DROP COLUMN old_status;
```

Deploy this in a separate release, after confirming no code references the old column.

## Real-World Example: Adding an Index

Adding an index on a large table can lock writes. The solution:

```sql
-- PostgreSQL: CREATE INDEX CONCURRENTLY doesn't block writes
CREATE INDEX CONCURRENTLY idx_orders_customer_id
    ON orders (customer_id);
```

```python
# In your migration tool
class Migration:
    def up(self):
        # CONCURRENTLY is essential for zero-downtime
        self.execute("CREATE INDEX CONCURRENTLY idx_orders_customer_id ON orders (customer_id)")

    def down(self):
        self.execute("DROP INDEX CONCURRENTLY idx_orders_customer_id")
```

Note: `CONCURRENTLY` takes longer than a regular index creation, but it doesn't block writes.

## Renaming a Column

Column renames require the full expand-contract cycle:

```sql
-- Phase 1: Add new column
ALTER TABLE users ADD COLUMN display_name VARCHAR(255);

-- Deploy code that writes to both, reads from new
```

```python
# Code reads from new, falls back to old
def get_display_name(user: dict) -> str:
    return user.get('display_name') or user.get('name')
```

```sql
-- Phase 2: Backfill
UPDATE users SET display_name = name WHERE display_name IS NULL;

-- Phase 3: Drop old column (in a later deployment)
ALTER TABLE users DROP COLUMN name;
```

## Handling Rollbacks

Every migration must be reversible:

```python
class AddOrderStatus(Migration):
    def up(self):
        self.execute("ALTER TABLE orders ADD COLUMN status VARCHAR(50)")

    def down(self):
        # Only safe if no data has been written to the new column
        # Otherwise, you'll lose data
        self.execute("ALTER TABLE orders DROP COLUMN status")
```

For irreversible migrations (like deleting a column with data), the rollback requires restoring from backup — which is why we avoid destructive operations.

## Migration Tooling

We use a custom migration runner that enforces safety rules:

```python
class SafeMigrationRunner:
    DANGEROUS_OPERATIONS = [
        'DROP TABLE',
        'DROP COLUMN',
        'ALTER TABLE.*SET DEFAULT',  # Rewrites all rows
        'CREATE INDEX ',  # Without CONCURRENTLY
    ]

    def validate(self, migration: Migration):
        sql = migration.sql
        for pattern in self.DANGEROUS_OPERATIONS:
            if re.search(pattern, sql, re.IGNORECASE):
                if not migration.has_safety_flag:
                    raise UnsafeMigrationError(
                        f"Migration contains dangerous operation: {pattern}. "
                        f"Add safety flag or split into expand-contract phases."
                    )
```

## Lessons Learned

1. **Never block writes in production** — if a migration locks tables, it's the wrong migration
2. **Expand-contract is slower but safer** — accept the extra deployments
3. **Backfill in batches** — never update millions of rows in a single transaction
4. **Test migrations on production-sized data** — a migration that works on 1K rows may fail on 50M
5. **Have a rollback plan** — every migration should be reversible without data loss

---

_Questions about database migrations? Find me on [GitHub](https://github.com) or [Twitter](https://x.com)._
