---
title: "Reference Data Joins in Stream Analytics"
author: Michael John Peña
draft: false
date: 2022-06-28
tags:
  - Azure
  - stream-analytics
  - Data
  - joins
---

## Reference Data Sources

```json
{
  "type": "Microsoft.StreamAnalytics/streamingjobs/inputs",
  "properties": {
    "type": "Reference",
    "datasource": {
      "type": "Microsoft.Storage/Blob",
      "properties": {
        "storageAccounts": [{
          "accountName": "mystorageaccount",
          "accountKey": "..."
        }],
        "container": "reference-data",
        "pathPattern": "products/{date}/{time}/products.json",
        "dateFormat": "yyyy-MM-dd",
        "timeFormat": "HH-mm"
      }
    }
  }
}
```

## Join Query

```sql
SELECT
    stream.transactionId,
    stream.productId,
    stream.quantity,
    stream.timestamp,
    ref.productName,
    ref.category,
    ref.unitPrice,
    stream.quantity * ref.unitPrice AS totalAmount
INTO
    enrichedOutput
FROM
    transactionStream stream
JOIN
    productReference ref
ON
    stream.productId = ref.productId
```

## SQL Database Reference

```sql
-- Configure SQL reference
SELECT
    s.sensorId,
    s.reading,
    d.location,
    d.threshold,
    CASE WHEN s.reading > d.threshold THEN 'ALERT' ELSE 'NORMAL' END AS status
FROM sensorStream s
JOIN deviceConfig d
ON s.sensorId = d.sensorId
```

## Refresh Patterns

- **Static**: Loaded once at job start
- **Periodic**: Refreshes at intervals
- **Dynamic**: SQL queries for latest data

## Summary

Reference data joins combine streaming data with dimension data for enriched, contextual analytics.
