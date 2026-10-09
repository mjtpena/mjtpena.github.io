---
title: "Semantic Models in Microsoft Fabric: Building the Analytics Layer"
description: "Semantic models provide the business logic layer that enables self-service analytics. Tomorrow, I will cover Fabric Notebooks."
author: Michael John Peña
draft: false
date: 2023-06-05
tags:
  - Microsoft Fabric
  - Semantic Models
  - Power BI
  - DAX
  - Analytics
---

## What is a Semantic Model?

A semantic model provides:
- Business-friendly names and descriptions
- Relationships between tables
- Calculated measures and columns
- Security definitions
- Formatting and categorization

```
┌─────────────────────────────────────────────────────┐
│                 Semantic Model                       │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────────┐│
│  │              Tables & Columns                    ││
│  │  - Business-friendly names                       ││
│  │  - Data types and formatting                     ││
│  │  - Descriptions and categories                   ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │              Relationships                       ││
│  │  - Star schema design                            ││
│  │  - Cardinality and direction                     ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │                Measures                          ││
│  │  - Business calculations (DAX)                   ││
│  │  - KPIs and metrics                             ││
│  └─────────────────────────────────────────────────┘│
│                        │                            │
│  ┌─────────────────────┴───────────────────────────┐│
│  │                Security                          ││
│  │  - Row-level security (RLS)                     ││
│  │  - Object-level security (OLS)                  ││
│  └─────────────────────────────────────────────────┘│
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Creating Semantic Models

### From Lakehouse SQL Endpoint

```python
# In Fabric Portal:
# 1. Open Lakehouse
# 2. Click "SQL analytics endpoint"
# 3. Select tables for semantic model
# 4. Click "New semantic model"
# 5. Name and configure the model
```

### Using TMDL (Tabular Model Definition Language)

```yaml
# model.tmdl
model:
  name: Sales Analytics
  culture: en-US
  defaultPowerBIDataSourceVersion: powerBI_V3

tables:
  - name: Sales
    lineageTag: sales-001
    columns:
      - name: SalesKey
        dataType: int64
        isKey: true
        lineageTag: sales-key
      - name: CustomerKey
        dataType: int64
        lineageTag: cust-key
      - name: ProductKey
        dataType: int64
        lineageTag: prod-key
      - name: OrderDate
        dataType: dateTime
        lineageTag: order-date
      - name: Quantity
        dataType: int64
        lineageTag: qty
      - name: Amount
        dataType: decimal
        formatString: "$#,##0.00"
        lineageTag: amount
    measures:
      - name: Total Sales
        expression: SUM(Sales[Amount])
        formatString: "$#,##0.00"
        lineageTag: total-sales
      - name: Total Quantity
        expression: SUM(Sales[Quantity])
        formatString: "#,##0"
        lineageTag: total-qty
    partitions:
      - name: Partition1
        mode: directLake
        source:
          type: entity
          entityName: gold_fact_sales

  - name: Customer
    lineageTag: cust-001
    columns:
      - name: CustomerKey
        dataType: int64
        isKey: true
      - name: CustomerName
        dataType: string
      - name: Segment
        dataType: string
      - name: Country
        dataType: string

relationships:
  - name: Sales_Customer
    fromTable: Sales
    fromColumn: CustomerKey
    toTable: Customer
    toColumn: CustomerKey
    isActive: true
    crossFilteringBehavior: oneDirection
```

## Designing Relationships

### Star Schema

```dax
// Star schema with fact and dimensions
// Fact table: Sales
// Dimensions: Customer, Product, Date, Store

// Relationship directions flow from dimensions to facts
// This enables efficient filtering

// Example relationships:
// Customer[CustomerKey] -> Sales[CustomerKey] (Many-to-One)
// Product[ProductKey] -> Sales[ProductKey] (Many-to-One)
// Date[DateKey] -> Sales[DateKey] (Many-to-One)
// Store[StoreKey] -> Sales[StoreKey] (Many-to-One)
```

### Handling Multiple Relationships

```dax
// When you need multiple relationships between tables
// Only one can be active

// Example: Sales has OrderDate and ShipDate
// Active relationship: Date[DateKey] -> Sales[OrderDateKey]
// Inactive relationship: Date[DateKey] -> Sales[ShipDateKey]

// Use USERELATIONSHIP for inactive relationship
Sales by Ship Date =
CALCULATE(
    [Total Sales],
    USERELATIONSHIP(Sales[ShipDateKey], 'Date'[DateKey])
)
```

## Building Measures

### Basic Measures

```dax
// Aggregations
Total Sales = SUM(Sales[Amount])
Total Quantity = SUM(Sales[Quantity])
Order Count = DISTINCTCOUNT(Sales[OrderID])
Customer Count = DISTINCTCOUNT(Sales[CustomerKey])

// Averages
Average Order Value = DIVIDE([Total Sales], [Order Count])
Average Sale per Customer = DIVIDE([Total Sales], [Customer Count])

// Ratios
Profit Margin = DIVIDE([Total Profit], [Total Sales])
Return Rate = DIVIDE([Returned Quantity], [Total Quantity])
```

### Time Intelligence

```dax
// Year-to-date
YTD Sales = TOTALYTD([Total Sales], 'Date'[Date])

// Quarter-to-date
QTD Sales = TOTALQTD([Total Sales], 'Date'[Date])

// Month-to-date
MTD Sales = TOTALMTD([Total Sales], 'Date'[Date])

// Previous period comparisons
Sales PY = CALCULATE([Total Sales], SAMEPERIODLASTYEAR('Date'[Date]))
Sales PM = CALCULATE([Total Sales], PREVIOUSMONTH('Date'[Date]))
Sales PQ = CALCULATE([Total Sales], PREVIOUSQUARTER('Date'[Date]))

// Growth calculations
YoY Growth = DIVIDE([Total Sales] - [Sales PY], [Sales PY])
YoY Growth % = FORMAT([YoY Growth], "0.0%")

MoM Growth = DIVIDE([Total Sales] - [Sales PM], [Sales PM])

// Rolling calculations
Rolling 3M Sales =
CALCULATE(
    [Total Sales],
    DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -3, MONTH)
)

Rolling 12M Sales =
CALCULATE(
    [Total Sales],
    DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -12, MONTH)
)

// Moving average
Moving Avg 3M =
AVERAGEX(
    DATESINPERIOD('Date'[Date], MAX('Date'[Date]), -3, MONTH),
    CALCULATE([Total Sales])
)
```

### Advanced Patterns

```dax
// Pareto analysis (80/20)
Cumulative Sales % =
VAR CurrentProduct = MAX(Product[ProductName])
VAR AllProducts =
    CALCULATETABLE(
        SUMMARIZE(Sales, Product[ProductName], "ProductSales", [Total Sales]),
        REMOVEFILTERS(Product[ProductName])
    )
VAR SortedProducts =
    ADDCOLUMNS(
        AllProducts,
        "RunningTotal",
        SUMX(
            FILTER(AllProducts, [ProductSales] >= EARLIER([ProductSales])),
            [ProductSales]
        )
    )
VAR TotalSales = SUMX(AllProducts, [ProductSales])
VAR CurrentRunning = MAXX(FILTER(SortedProducts, [ProductName] = CurrentProduct), [RunningTotal])
RETURN
DIVIDE(CurrentRunning, TotalSales)

// Customer lifetime value
Customer LTV =
CALCULATE(
    [Total Sales],
    ALLEXCEPT(Sales, Sales[CustomerKey])
)

// Cohort analysis
Cohort Sales =
VAR CustomerFirstPurchase =
    CALCULATE(MIN(Sales[OrderDate]), ALLEXCEPT(Sales, Sales[CustomerKey]))
RETURN
CALCULATE(
    [Total Sales],
    FILTER(
        ALL('Date'),
        'Date'[Date] >= CustomerFirstPurchase
    )
)
```

## Row-Level Security

```dax
// Define RLS roles in semantic model

// Role: Regional Manager
// Table: Sales
// DAX Filter:
Sales[Region] = LOOKUPVALUE(
    UserRegion[Region],
    UserRegion[UserEmail],
    USERPRINCIPALNAME()
)

// Role: Store Manager
// Table: Sales
// DAX Filter:
Sales[StoreKey] IN
    CALCULATETABLE(
        VALUES(UserStore[StoreKey]),
        UserStore[UserEmail] = USERPRINCIPALNAME()
    )

// Role: Country Manager
// Table: Customer
// DAX Filter:
Customer[Country] = LOOKUPVALUE(
    UserCountry[Country],
    UserCountry[UserEmail],
    USERPRINCIPALNAME()
)
```

## Calculated Tables

```dax
// Date dimension
Date =
VAR MinDate = MIN(Sales[OrderDate])
VAR MaxDate = MAX(Sales[OrderDate])
RETURN
ADDCOLUMNS(
    CALENDAR(MinDate, MaxDate),
    "Year", YEAR([Date]),
    "Quarter", "Q" & QUARTER([Date]),
    "Month", FORMAT([Date], "MMMM"),
    "MonthNum", MONTH([Date]),
    "Day", DAY([Date]),
    "DayOfWeek", FORMAT([Date], "dddd"),
    "IsWeekend", IF(WEEKDAY([Date], 2) > 5, TRUE, FALSE),
    "YearMonth", FORMAT([Date], "YYYY-MM"),
    "FiscalYear", IF(MONTH([Date]) >= 7, YEAR([Date]) + 1, YEAR([Date]))
)

// Segmentation table
CustomerSegment =
ADDCOLUMNS(
    SUMMARIZE(Sales, Sales[CustomerKey]),
    "TotalSpend", CALCULATE([Total Sales]),
    "OrderCount", CALCULATE([Order Count]),
    "Segment",
        VAR Spend = CALCULATE([Total Sales])
        RETURN
        SWITCH(
            TRUE(),
            Spend >= 10000, "Platinum",
            Spend >= 5000, "Gold",
            Spend >= 1000, "Silver",
            "Bronze"
        )
)
```

Semantic models provide the business logic layer that enables self-service analytics. Tomorrow, I will cover Fabric Notebooks.

## Resources

- [Semantic Models](https://learn.microsoft.com/en-us/power-bi/connect-data/service-datasets-understand)
- [DAX Reference](https://learn.microsoft.com/en-us/dax/)
- [Model Best Practices](https://learn.microsoft.com/en-us/power-bi/guidance/star-schema)
