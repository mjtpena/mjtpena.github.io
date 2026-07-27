---
title: "Using Reference Tables in Citus for Efficient Joins"
author: "Michael John Peña"
draft: false
date: 2022-07-04
tags: ["Azure", "Citus", "PostgreSQL", "Reference Tables", "Performance"]

---

I wrote "Using Reference Tables in Citus for Efficient Joins" to share practical, production-minded guidance on this topic.

## What are Reference Tables?

Reference tables are small tables that:
- Are replicated in full to every worker node
- Can be joined with any distributed table locally
- Are ideal for lookup data, configuration, or dimensional data

## Creating Reference Tables

```sql
-- Lookup tables perfect for reference tables
CREATE TABLE countries (
    id int PRIMARY KEY,
    code char(2),
    name text
);

CREATE TABLE product_categories (
    id int PRIMARY KEY,
    name text,
    description text
);

CREATE TABLE subscription_plans (
    id int PRIMARY KEY,
    name text,
    price decimal,
    features jsonb
);

-- Convert to reference tables
SELECT create_reference_table('countries');
SELECT create_reference_table('product_categories');
SELECT create_reference_table('subscription_plans');
```

## Efficient Joins with Reference Tables

```sql
-- Distributed table
CREATE TABLE orders (
    id bigserial,
    tenant_id int,
    product_category_id int,
    country_id int,
    amount decimal,
    created_at timestamptz,
    PRIMARY KEY (tenant_id, id)
);

SELECT create_distributed_table('orders', 'tenant_id');

-- This join executes locally on each worker
SELECT
    o.id,
    c.name as country,
    pc.name as category,
    o.amount
FROM orders o
JOIN countries c ON o.country_id = c.id
JOIN product_categories pc ON o.product_category_id = pc.id
WHERE o.tenant_id = 42;
```

## When to Use Reference Tables

```sql
-- Good candidates: small, frequently joined tables
-- Check table size before making it a reference table
SELECT
    relname,
    pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables
WHERE relname IN ('countries', 'product_categories', 'subscription_plans');
```

## Updating Reference Tables

Updates to reference tables are automatically propagated to all nodes:

```sql
-- This update happens on all nodes atomically
INSERT INTO countries (id, code, name)
VALUES (250, 'FR', 'France')
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name;

-- Verify replication
SELECT run_command_on_workers($$
    SELECT COUNT(*) FROM countries
$$);
```

## Best Practices

1. **Keep reference tables small**: Under 100MB is ideal
2. **Use for slowly changing data**: Frequent updates impact all nodes
3. **Index appropriately**: Indexes are replicated too

```sql
-- Create indexes on reference tables
CREATE INDEX idx_countries_code ON countries(code);
CREATE INDEX idx_categories_name ON product_categories(name);
```

Reference tables eliminate network round-trips for joins, significantly improving query performance in distributed setups.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
