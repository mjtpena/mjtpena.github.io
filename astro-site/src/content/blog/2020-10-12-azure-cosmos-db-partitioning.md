---
title: "Azure Cosmos DB Partitioning Strategies"
author: Michael John Peña
draft: false
date: 2020-10-12
tags:
  - Azure
  - Cosmos DB
  - NoSQL
  - Database

---


Of every Cosmos DB design conversation I've had, partition key choice is the one that has the biggest cost-and-performance consequence and the smallest amount of "I can fix it later" — once the container is populated, you're stuck with it short of a full migration. Pick a high-cardinality key that distributes writes evenly *and* keeps the access patterns you actually use single-partition. Time-based keys, status-flag keys, and "we'll figure out access patterns later" are the three traps I keep watching teams fall into.

## Partition Key Fundamentals

- Each logical partition: max 20GB storage
- Partition key is immutable after creation
- All queries should include partition key when possible
- Cross-partition queries are expensive

## Good Partition Key Characteristics

1. **High cardinality** - Many distinct values
2. **Even distribution** - No hot partitions
3. **Query aligned** - Most queries filter by it

## Common Patterns

### E-Commerce Orders

```javascript
// Good: customerId (queries are per customer)
{
    "id": "order-123",
    "customerId": "cust-456",  // Partition key
    "orderDate": "2020-10-12",
    "items": [...]
}

// Bad: orderDate (hot partition on current date)
```

### IoT Telemetry

```javascript
// Good: deviceId (queries are per device)
{
    "id": "reading-789",
    "deviceId": "sensor-001",  // Partition key
    "timestamp": "2020-10-12T10:30:00Z",
    "temperature": 72.5
}
```

### Multi-Tenant SaaS

```javascript
// Good: tenantId (isolation and queries per tenant)
{
    "id": "doc-123",
    "tenantId": "tenant-abc",  // Partition key
    "type": "invoice",
    "data": {...}
}
```

## Synthetic Partition Keys

Combine fields for better distribution.

```javascript
// Combine userId + year for time-series data
{
    "id": "activity-123",
    "partitionKey": "user-456_2020",  // Synthetic key
    "userId": "user-456",
    "timestamp": "2020-10-12T10:30:00Z",
    "action": "login"
}
```

## Hierarchical Partition Keys (Preview)

```javascript
// Define multiple levels
containerProperties.PartitionKeyPaths = new List<string> {
    "/tenantId",
    "/userId",
    "/sessionId"
};
```

## Querying with Partition Keys

```sql
-- Efficient: single partition
SELECT * FROM c
WHERE c.customerId = 'cust-456'

-- Less efficient: cross-partition (uses fan-out)
SELECT * FROM c
WHERE c.orderDate > '2020-01-01'

-- Add partition key for efficiency
SELECT * FROM c
WHERE c.customerId = 'cust-456'
  AND c.orderDate > '2020-01-01'
```

## Monitoring Partition Usage

```bash
# Check partition key statistics
az cosmosdb sql container show \
    --account-name myaccount \
    --database-name mydb \
    --name mycontainer \
    --query "resource.partitionKey"
```

## Anti-Patterns to Avoid

| Anti-Pattern | Problem |
|--------------|---------|
| Low cardinality key (e.g., status) | Few partitions, can't scale |
| Timestamp as partition key | Hot partition on current time |
| Random GUID partition key | Cross-partition queries always |
| Same partition key as id | No logical grouping |

Choose your partition key carefully—it's the foundation of Cosmos DB performance.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n

