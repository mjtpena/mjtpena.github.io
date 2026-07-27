---
title: "Azure Stream Analytics Updates: No-Code Editor and More"
author: Michael John Peña
draft: false
date: 2022-06-27
tags:
  - azure
  - stream-analytics
  - real-time
  - data

---

I wrote "Azure Stream Analytics Updates: No-Code Editor and More" to share practical, production-minded guidance on this topic.

## No-Code Editor

The new visual editor allows building streaming pipelines without SQL:

1. Drag-and-drop input/output connections
2. Visual transformations and aggregations
3. Preview data in real-time
4. Auto-generated SQL queries

## Reference Data Join

```sql
SELECT
    i.deviceId,
    i.temperature,
    r.location,
    r.threshold
INTO output
FROM input i
JOIN referenceData r
ON i.deviceId = r.deviceId
WHERE i.temperature > r.threshold
```

## Temporal Joins

```sql
-- Join streams within time window
SELECT
    orders.orderId,
    orders.customerId,
    shipments.trackingNumber,
    DATEDIFF(minute, orders.orderTime, shipments.shipTime) AS fulfillmentMinutes
FROM orders
JOIN shipments
ON orders.orderId = shipments.orderId
AND DATEDIFF(hour, orders, shipments) BETWEEN 0 AND 24
```

## Pattern Matching

```sql
SELECT
    deviceId,
    LAG(temperature, 1) OVER (PARTITION BY deviceId LIMIT DURATION(minute, 5)) AS prevTemp,
    temperature AS currentTemp
FROM input
WHERE temperature - LAG(temperature, 1) OVER (PARTITION BY deviceId LIMIT DURATION(minute, 5)) > 10
```

## Summary

Stream Analytics updates make real-time processing more accessible while adding powerful features for complex streaming scenarios.


