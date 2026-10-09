---
title: "Azure Data Factory Data Flows: Visual ETL"
description: "I have a love-hate relationship with visual ETL tools. Drag-and-drop is wonderful right up until you need to diff two pipelines in source control. ADF Data…"
author: Michael John Peña
draft: false
date: 2020-11-20
tags:
  - Azure
  - Data Factory
  - ETL
  - Data Engineering
---

I have a love-hate relationship with visual ETL tools. Drag-and-drop is wonderful right up until you need to diff two pipelines in source control. ADF Data Flows are the modern Microsoft answer: visual on the surface, Spark underneath, and (importantly) the JSON definition is reviewable in Git. They're a real option for data engineers who want power without writing PySpark by hand.

## Data Flow Components

```
Source → Transformations → Sink
           │
           ├── Filter
           ├── Derived Column
           ├── Aggregate
           ├── Join
           ├── Lookup
           ├── Conditional Split
           ├── Union
           ├── Pivot/Unpivot
           └── Window
```

## Source Configuration

```json
{
    "name": "SalesSource",
    "type": "AzureBlobStorageSource",
    "dataset": {
        "referenceName": "SalesCSV",
        "type": "DatasetReference"
    },
    "schemaMapping": {
        "type": "auto"
    }
}
```

## Common Transformations

### Derived Column

```
// Add calculated columns
unitPrice * quantity as totalAmount
upper(customerName) as customerNameUpper
year(orderDate) as orderYear
iif(totalAmount > 1000, 'Premium', 'Standard') as customerTier
```

### Filter

```
// Filter rows
status == 'Active' && orderDate >= toDate('2020-01-01')
```

### Aggregate

```
// Group and summarize
Group By: customerId, year(orderDate)
Aggregates:
  - totalRevenue = sum(amount)
  - orderCount = count()
  - avgOrderValue = avg(amount)
  - firstOrder = min(orderDate)
  - lastOrder = max(orderDate)
```

### Join

```
Left Stream: Orders
Right Stream: Customers
Join Type: Left Outer
Condition: Orders.customerId == Customers.id
```

### Lookup

```
// Enrich with dimension data
Lookup Stream: Products
Lookup Condition: salesData.productId == Products.id
Columns to Include: productName, category, brand
```

### Conditional Split

```
// Route rows to different outputs
Conditions:
  - Premium: totalAmount > 10000
  - Standard: totalAmount > 1000
  - Basic: true (default)
```

### Window Functions

```
// Running totals, rankings
Window: Over customerId, Order by orderDate
Columns:
  - runningTotal = sum(amount)
  - rowNumber = rowNumber()
  - rank = rank()
```

## Expression Language

```
// String functions
concat(firstName, ' ', lastName)
substring(postalCode, 0, 5)
trim(description)
replace(text, '\n', ' ')

// Date functions
year(orderDate)
monthsBetween(startDate, endDate)
addDays(shipDate, 5)
dayOfWeek(orderDate)

// Conditional
iif(condition, trueValue, falseValue)
case(status, 'A', 'Active', 'I', 'Inactive', 'Unknown')
coalesce(preferredName, firstName)

// Type conversion
toInteger(stringColumn)
toDate(dateString, 'yyyy-MM-dd')
toString(numericColumn, '#,##0.00')
```

## Data Quality

### Assert Transformation

```
// Validate data quality
Assertions:
  - amount > 0 as 'Amount must be positive'
  - isNotNull(customerId) as 'Customer ID required'
  - regexMatch(email, '^[^@]+@[^@]+$') as 'Valid email format'
```

### Select (Schema Drift)

```
// Handle evolving schemas
Auto-map: true
Rule-based mapping:
  - $$: $$  (include all columns)
  - exclude: tempColumn, _metadata_*
```

## Debug Mode

```bash
# Start debug cluster
# Preview data at each transformation
# 5-minute warm-up, then interactive
```

## Pipeline Integration

```json
{
    "name": "RunDataFlow",
    "type": "ExecuteDataFlow",
    "typeProperties": {
        "dataFlow": {
            "referenceName": "SalesETL",
            "type": "DataFlowReference"
        },
        "compute": {
            "coreCount": 8,
            "computeType": "General"
        },
        "traceLevel": "Fine"
    }
}
```

Data Flows: Spark power without Spark complexity.
