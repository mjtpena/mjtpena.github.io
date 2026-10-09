---
title: "HTAP Patterns in Microsoft Fabric: Unifying Transactions and Analytics"
description: "HTAP in Microsoft Fabric enables unified transactional and analytical workloads without complex ETL pipelines. Design your schemas with both workloads in mind."
author: "Michael John Peña"
draft: false
date: 2024-10-25
tags: ["HTAP", "Microsoft Fabric", "Transactions", "Analytics", "Architecture"]
---

## Understanding HTAP in Fabric

```python
"""
Traditional Architecture:
+--------+     ETL      +--------+
|  OLTP  | -----------> |  OLAP  |
+--------+   (hours)    +--------+

Fabric HTAP Architecture:
+------------------+
| Fabric Database  |  <- Transactional workloads
+------------------+
         |
    Auto-Mirror
    (seconds)
         |
         v
+------------------+
|    OneLake       |  <- Analytical workloads
| (Delta Format)   |
+------------------+
         |
         v
+------------------+
| Lakehouse/       |
| Warehouse        |
+------------------+
"""
```

## Designing for HTAP

```python
from dataclasses import dataclass
from enum import Enum
from typing import List, Dict

class WorkloadType(Enum):
    TRANSACTIONAL = "transactional"
    ANALYTICAL = "analytical"
    HYBRID = "hybrid"

@dataclass
class TableDesign:
    """Design a table for HTAP workloads"""
    name: str
    primary_workload: WorkloadType
    oltp_requirements: List[str]
    olap_requirements: List[str]
    design_recommendations: List[str]

def design_htap_table(
    table_name: str,
    transactional_patterns: List[str],
    analytical_patterns: List[str]
) -> TableDesign:
    """Generate HTAP-optimized table design"""

    recommendations = []

    # Analyze transactional patterns
    if "high_insert_rate" in transactional_patterns:
        recommendations.append("Use IDENTITY columns for auto-increment")
        recommendations.append("Avoid wide indexes on OLTP tables")

    if "frequent_updates" in transactional_patterns:
        recommendations.append("Add updated_at timestamp for change tracking")
        recommendations.append("Enable deletion vectors when mirroring")

    if "point_lookups" in transactional_patterns:
        recommendations.append("Create clustered index on lookup key")

    # Analyze analytical patterns
    if "time_series_analysis" in analytical_patterns:
        recommendations.append("Include timestamp columns for time-based partitioning")
        recommendations.append("Consider date hierarchy columns")

    if "aggregations" in analytical_patterns:
        recommendations.append("Pre-aggregate common metrics in views")
        recommendations.append("Design fact/dimension relationships")

    if "joins_with_dimensions" in analytical_patterns:
        recommendations.append("Use consistent key types across tables")
        recommendations.append("Consider denormalization for analytics")

    return TableDesign(
        name=table_name,
        primary_workload=WorkloadType.HYBRID,
        oltp_requirements=transactional_patterns,
        olap_requirements=analytical_patterns,
        design_recommendations=recommendations
    )

# Example usage
orders_design = design_htap_table(
    "orders",
    transactional_patterns=[
        "high_insert_rate",
        "frequent_updates",
        "point_lookups"
    ],
    analytical_patterns=[
        "time_series_analysis",
        "aggregations",
        "joins_with_dimensions"
    ]
)
```

## HTAP Table Implementation

```sql
-- OLTP-optimized table with HTAP considerations
CREATE TABLE sales.orders (
    -- Primary key for OLTP
    order_id BIGINT IDENTITY(1,1) PRIMARY KEY,

    -- Business keys
    customer_id INT NOT NULL,
    order_number VARCHAR(20) NOT NULL UNIQUE,

    -- Transactional data
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    subtotal DECIMAL(12, 2) NOT NULL,
    tax_amount DECIMAL(12, 2) NOT NULL,
    total_amount DECIMAL(12, 2) NOT NULL,

    -- Timestamps for mirroring and analytics
    order_date DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),

    -- Analytical helper columns
    order_year AS YEAR(order_date) PERSISTED,
    order_month AS MONTH(order_date) PERSISTED,
    order_day AS DAY(order_date) PERSISTED,

    -- OLTP indexes
    INDEX IX_orders_customer (customer_id),
    INDEX IX_orders_date (order_date),
    INDEX IX_orders_status (status) WHERE status != 'completed'
);

-- Trigger for change tracking
CREATE TRIGGER trg_orders_updated
ON sales.orders
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE o SET updated_at = SYSUTCDATETIME()
    FROM sales.orders o
    INNER JOIN inserted i ON o.order_id = i.order_id;
END;
```

## Query Routing Strategy

```python
class HTAPQueryRouter:
    """Route queries to appropriate system based on workload"""

    def __init__(self, oltp_conn, olap_conn):
        self.oltp = oltp_conn
        self.olap = olap_conn

    def execute(self, query: str, params: tuple = None):
        """Execute query on appropriate system"""
        workload = self._classify_query(query)

        if workload == WorkloadType.TRANSACTIONAL:
            return self._execute_oltp(query, params)
        elif workload == WorkloadType.ANALYTICAL:
            return self._execute_olap(query, params)
        else:
            # Hybrid - decide based on freshness requirements
            return self._execute_hybrid(query, params)

    def _classify_query(self, query: str) -> WorkloadType:
        """Classify query as OLTP, OLAP, or hybrid"""
        query_lower = query.lower()

        # OLTP indicators
        oltp_patterns = [
            "insert into",
            "update ",
            "delete from",
            "where.*=.*\?",  # Point lookup
            "top 1",
            "limit 1"
        ]

        # OLAP indicators
        olap_patterns = [
            "group by",
            "sum(",
            "count(",
            "avg(",
            "window",
            "over(",
            "partition by"
        ]

        oltp_score = sum(1 for p in oltp_patterns if p in query_lower)
        olap_score = sum(1 for p in olap_patterns if p in query_lower)

        if oltp_score > olap_score:
            return WorkloadType.TRANSACTIONAL
        elif olap_score > oltp_score:
            return WorkloadType.ANALYTICAL
        else:
            return WorkloadType.HYBRID

    def _execute_oltp(self, query: str, params: tuple):
        """Execute on OLTP system (Fabric Database)"""
        return self.oltp.execute(query, params)

    def _execute_olap(self, query: str, params: tuple):
        """Execute on OLAP system (Lakehouse/Warehouse)"""
        return self.olap.execute(query, params)

    def _execute_hybrid(self, query: str, params: tuple):
        """Execute hybrid query - prefer OLAP for reads"""
        if query.strip().lower().startswith("select"):
            return self._execute_olap(query, params)
        return self._execute_oltp(query, params)
```

## Real-Time Analytics Pattern

```python
from pyspark.sql import SparkSession
from delta.tables import DeltaTable

class RealTimeAnalytics:
    """Real-time analytics on mirrored HTAP data"""

    def __init__(self, spark: SparkSession):
        self.spark = spark

    def streaming_aggregation(self, source_table: str, output_table: str):
        """Create streaming aggregation from mirrored data"""

        # Read stream from mirrored Delta table
        stream = self.spark.readStream.format("delta").load(
            f"abfss://workspace@onelake.dfs.fabric.microsoft.com/"
            f"Database.Database/Tables/{source_table}"
        )

        # Aggregate in real-time
        aggregated = stream.groupBy(
            self.spark.window("order_date", "1 hour"),
            "customer_id"
        ).agg(
            {"total_amount": "sum", "order_id": "count"}
        ).withColumnRenamed(
            "sum(total_amount)", "hourly_revenue"
        ).withColumnRenamed(
            "count(order_id)", "order_count"
        )

        # Write to analytics table
        query = aggregated.writeStream.format("delta").outputMode(
            "complete"
        ).option(
            "checkpointLocation", "/checkpoints/hourly_revenue"
        ).toTable(output_table)

        return query

    def materialized_view(self, query: str, output_table: str,
                         refresh_interval: str = "5 minutes"):
        """Create materialized view with periodic refresh"""

        def refresh():
            result = self.spark.sql(query)
            result.write.format("delta").mode("overwrite").saveAsTable(
                output_table
            )

        # Schedule refresh
        from apscheduler.schedulers.background import BackgroundScheduler
        scheduler = BackgroundScheduler()
        scheduler.add_job(refresh, 'interval', minutes=5)
        scheduler.start()

        # Initial refresh
        refresh()

# Usage
analytics = RealTimeAnalytics(spark)

# Start streaming aggregation
query = analytics.streaming_aggregation(
    "dbo/orders",
    "analytics.hourly_revenue"
)

# Create materialized view
analytics.materialized_view(
    """
    SELECT
        d.region,
        DATE_TRUNC('day', o.order_date) as day,
        SUM(o.total_amount) as daily_revenue,
        COUNT(*) as order_count
    FROM delta.`/Tables/dbo/orders` o
    JOIN delta.`/Tables/dbo/customers` c ON o.customer_id = c.customer_id
    JOIN delta.`/Tables/dbo/regions` d ON c.region_id = d.region_id
    GROUP BY d.region, DATE_TRUNC('day', o.order_date)
    """,
    "analytics.daily_regional_sales"
)
```

## HTAP Best Practices

```python
HTAP_BEST_PRACTICES = {
    "schema_design": [
        "Use consistent data types for join keys",
        "Include timestamp columns for change tracking",
        "Add computed columns for common analytics dimensions",
        "Design for both point queries and scans"
    ],
    "indexing": [
        "Balance OLTP performance with mirroring overhead",
        "Use filtered indexes for OLTP hot data",
        "Rely on Delta file statistics for OLAP queries"
    ],
    "data_freshness": [
        "Understand mirroring latency (typically seconds)",
        "Design for eventual consistency in analytics",
        "Use OLTP for real-time transactional reads"
    ],
    "query_routing": [
        "Route writes to transactional database",
        "Route heavy analytics to mirrored data",
        "Consider freshness requirements for routing decisions"
    ]
}
```

HTAP in Microsoft Fabric enables unified transactional and analytical workloads without complex ETL pipelines. Design your schemas with both workloads in mind.
