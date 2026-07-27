---
title: "Data Colocation in Citus for Optimal Join Performance"
author: "Michael John Peña"
draft: false
date: 2022-07-06
tags: ["Azure", "Citus", "PostgreSQL", "Colocation", "Performance"]

---

I wrote "Data Colocation in Citus for Optimal Join Performance" to share practical, production-minded guidance on this topic.

## Understanding Colocation

When two distributed tables share the same distribution column and colocation group, their corresponding shards are placed on the same worker node.

```sql
-- Tables with the same distribution column are colocated by default
CREATE TABLE tenants (
    id int PRIMARY KEY,
    name text,
    created_at timestamptz
);

CREATE TABLE users (
    id bigserial,
    tenant_id int,
    email text,
    PRIMARY KEY (tenant_id, id)
);

CREATE TABLE projects (
    id bigserial,
    tenant_id int,
    name text,
    PRIMARY KEY (tenant_id, id)
);

-- Distribute all by tenant_id - they'll be colocated
SELECT create_distributed_table('tenants', 'id');
SELECT create_distributed_table('users', 'tenant_id', colocate_with => 'tenants');
SELECT create_distributed_table('projects', 'tenant_id', colocate_with => 'tenants');
```

## Verifying Colocation

```sql
-- Check colocation groups
SELECT
    logicalrelid::text as table_name,
    colocationid
FROM pg_dist_partition
WHERE logicalrelid IN ('tenants'::regclass, 'users'::regclass, 'projects'::regclass);

-- View detailed colocation info
SELECT * FROM pg_dist_colocation;
```

## Colocated Joins in Action

```sql
-- This join executes entirely on local shards
SELECT
    t.name as tenant_name,
    COUNT(DISTINCT u.id) as user_count,
    COUNT(DISTINCT p.id) as project_count
FROM tenants t
LEFT JOIN users u ON t.id = u.tenant_id
LEFT JOIN projects p ON t.id = p.tenant_id
WHERE t.id = 42
GROUP BY t.name;

-- EXPLAIN shows local join execution
EXPLAIN (VERBOSE)
SELECT t.*, u.email
FROM tenants t
JOIN users u ON t.id = u.tenant_id
WHERE t.id = 42;
```

## Creating Colocation Groups

```sql
-- Create a new colocation group for a different use case
SELECT create_distributed_table(
    'analytics_events',
    'session_id',
    colocate_with => 'none'  -- New colocation group
);

-- Add related tables to the same group
SELECT create_distributed_table(
    'analytics_pageviews',
    'session_id',
    colocate_with => 'analytics_events'
);
```

## Shard Colocation for Transactions

Colocated shards enable distributed transactions:

```sql
-- This transaction works because all tables are colocated
BEGIN;

INSERT INTO users (tenant_id, email)
VALUES (42, 'new@example.com')
RETURNING id INTO user_id;

INSERT INTO projects (tenant_id, name)
VALUES (42, 'New Project');

COMMIT;
```

## Best Practices for Colocation

```sql
-- 1. Always specify colocation explicitly
SELECT create_distributed_table('orders', 'tenant_id', colocate_with => 'tenants');

-- 2. Use the same data type for distribution columns
-- Good: both are int
-- Bad: one is int, another is bigint

-- 3. Verify colocation after table creation
SELECT
    a.logicalrelid::text as table_a,
    b.logicalrelid::text as table_b,
    a.colocationid = b.colocationid as colocated
FROM pg_dist_partition a, pg_dist_partition b
WHERE a.logicalrelid = 'orders'::regclass
  AND b.logicalrelid = 'order_items'::regclass;
```

Proper colocation design is essential for building high-performance multi-tenant applications on Citus.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
