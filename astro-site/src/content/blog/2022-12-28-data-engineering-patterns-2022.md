---
title: "Data Engineering Patterns That Defined 2022"
author: Michael John Peña
draft: false
date: 2022-12-28
tags:
  - Data Engineering
  - Azure
  - Architecture
  - Lakehouse
  - Data Mesh
---

## The Lakehouse Architecture

```python
# Lakehouse implementation with Delta Lake on Azure
from delta import DeltaTable
from pyspark.sql import SparkSession
from pyspark.sql.functions import *

class LakehouseManager:
    def __init__(self, spark: SparkSession, storage_account: str):
        self.spark = spark
        self.base_path = f"abfss://lakehouse@{storage_account}.dfs.core.windows.net"

    def create_bronze_table(self, source_path: str, table_name: str):
        """Ingest raw data into bronze layer."""

        df = self.spark.read.format("json").load(source_path)

        # Add metadata columns
        df_bronze = df.withColumn("_ingestion_time", current_timestamp()) \
                      .withColumn("_source_file", input_file_name()) \
                      .withColumn("_processing_date", current_date())

        # Write to bronze layer
        df_bronze.write \
            .format("delta") \
            .mode("append") \
            .partitionBy("_processing_date") \
            .save(f"{self.base_path}/bronze/{table_name}")

        return df_bronze

    def create_silver_table(self, bronze_table: str, silver_table: str,
                           transformations: list):
        """Transform and cleanse data for silver layer."""

        df = self.spark.read.format("delta") \
            .load(f"{self.base_path}/bronze/{bronze_table}")

        # Apply transformations
        for transform in transformations:
            df = transform(df)

        # Deduplicate
        df_silver = df.dropDuplicates(["id"])

        # Write to silver with merge
        silver_path = f"{self.base_path}/silver/{silver_table}"

        if DeltaTable.isDeltaTable(self.spark, silver_path):
            delta_table = DeltaTable.forPath(self.spark, silver_path)

            delta_table.alias("target").merge(
                df_silver.alias("source"),
                "target.id = source.id"
            ).whenMatchedUpdateAll() \
             .whenNotMatchedInsertAll() \
             .execute()
        else:
            df_silver.write \
                .format("delta") \
                .mode("overwrite") \
                .save(silver_path)

        return df_silver

    def create_gold_table(self, silver_tables: list, gold_table: str,
                         aggregation_logic):
        """Create business-level aggregations in gold layer."""

        dfs = [
            self.spark.read.format("delta")
            .load(f"{self.base_path}/silver/{table}")
            for table in silver_tables
        ]

        # Apply business logic
        df_gold = aggregation_logic(dfs)

        # Write to gold
        df_gold.write \
            .format("delta") \
            .mode("overwrite") \
            .save(f"{self.base_path}/gold/{gold_table}")

        return df_gold
```

## Data Mesh Implementation

```python
from dataclasses import dataclass
from typing import Dict, List, Optional
from abc import ABC, abstractmethod

@dataclass
class DataProduct:
    """Data product metadata and configuration."""
    name: str
    domain: str
    owner: str
    description: str
    schema_version: str
    sla: Dict[str, str]
    quality_rules: List[Dict]
    access_policies: List[Dict]

class DataProductInterface(ABC):
    """Standard interface for data products."""

    @abstractmethod
    def get_schema(self) -> Dict:
        """Return data product schema."""
        pass

    @abstractmethod
    def read(self, query: Optional[str] = None) -> "DataFrame":
        """Read data from the product."""
        pass

    @abstractmethod
    def get_quality_metrics(self) -> Dict:
        """Return data quality metrics."""
        pass

    @abstractmethod
    def get_lineage(self) -> Dict:
        """Return data lineage information."""
        pass

class SalesDataProduct(DataProductInterface):
    """Sales domain data product implementation."""

    def __init__(self, spark: SparkSession, config: DataProduct):
        self.spark = spark
        self.config = config
        self.base_path = f"abfss://sales@datalake.dfs.core.windows.net"

    def get_schema(self) -> Dict:
        return {
            "columns": [
                {"name": "order_id", "type": "string", "description": "Unique order identifier"},
                {"name": "customer_id", "type": "string", "description": "Customer identifier"},
                {"name": "order_date", "type": "date", "description": "Date of order"},
                {"name": "total_amount", "type": "decimal(18,2)", "description": "Order total"},
                {"name": "currency", "type": "string", "description": "ISO currency code"},
                {"name": "status", "type": "string", "description": "Order status"}
            ],
            "primary_key": "order_id",
            "partitioning": ["order_date"],
            "version": self.config.schema_version
        }

    def read(self, query: Optional[str] = None) -> "DataFrame":
        df = self.spark.read.format("delta") \
            .load(f"{self.base_path}/orders")

        if query:
            df.createOrReplaceTempView("orders")
            return self.spark.sql(query)

        return df

    def get_quality_metrics(self) -> Dict:
        df = self.read()

        total_records = df.count()
        null_order_ids = df.filter(col("order_id").isNull()).count()
        future_dates = df.filter(col("order_date") > current_date()).count()

        return {
            "total_records": total_records,
            "completeness": {
                "order_id": (total_records - null_order_ids) / total_records
            },
            "validity": {
                "order_date": (total_records - future_dates) / total_records
            },
            "freshness": {
                "latest_record": df.agg(max("order_date")).collect()[0][0]
            }
        }

    def get_lineage(self) -> Dict:
        return {
            "upstream": [
                {"system": "ERP", "table": "sales_orders"},
                {"system": "CRM", "table": "customers"}
            ],
            "downstream": [
                {"product": "revenue_analytics", "domain": "finance"},
                {"product": "customer_360", "domain": "marketing"}
            ],
            "transformations": [
                "currency_standardization",
                "customer_enrichment",
                "deduplication"
            ]
        }

# Data Product Registry
class DataProductRegistry:
    """Central registry for discovering data products."""

    def __init__(self, storage_connection: str):
        self.products: Dict[str, DataProduct] = {}
        self.storage = storage_connection

    def register(self, product: DataProduct):
        """Register a data product."""
        key = f"{product.domain}/{product.name}"
        self.products[key] = product

    def discover(self, domain: Optional[str] = None,
                 tags: Optional[List[str]] = None) -> List[DataProduct]:
        """Discover available data products."""

        results = list(self.products.values())

        if domain:
            results = [p for p in results if p.domain == domain]

        return results

    def get_product(self, domain: str, name: str) -> Optional[DataProduct]:
        """Get a specific data product."""
        return self.products.get(f"{domain}/{name}")
```

## Modern ELT Patterns

```sql
-- dbt model for incremental processing
-- models/silver/orders_enriched.sql

{{
    config(
        materialized='incremental',
        unique_key='order_id',
        incremental_strategy='merge',
        partition_by={
            "field": "order_date",
            "data_type": "date",
            "granularity": "day"
        }
    )
}}

WITH source_orders AS (
    SELECT *
    FROM {{ source('bronze', 'raw_orders') }}
    {% if is_incremental() %}
    WHERE _ingestion_time > (SELECT MAX(_ingestion_time) FROM {{ this }})
    {% endif %}
),

customers AS (
    SELECT *
    FROM {{ ref('dim_customers') }}
),

products AS (
    SELECT *
    FROM {{ ref('dim_products') }}
),

enriched_orders AS (
    SELECT
        o.order_id,
        o.customer_id,
        c.customer_name,
        c.customer_segment,
        c.customer_region,
        o.order_date,
        o.product_id,
        p.product_name,
        p.product_category,
        o.quantity,
        o.unit_price,
        o.quantity * o.unit_price AS line_total,
        o.discount_percent,
        (o.quantity * o.unit_price) * (1 - o.discount_percent / 100) AS net_amount,
        o.currency,
        o.status,
        o._ingestion_time,
        CURRENT_TIMESTAMP() AS _processed_time
    FROM source_orders o
    LEFT JOIN customers c ON o.customer_id = c.customer_id
    LEFT JOIN products p ON o.product_id = p.product_id
)

SELECT * FROM enriched_orders
WHERE order_id IS NOT NULL
```

## Streaming Architecture

```python
# Azure Event Hubs + Spark Structured Streaming
from pyspark.sql import SparkSession
from pyspark.sql.functions import *
from pyspark.sql.types import *

class StreamingPipeline:
    def __init__(self, spark: SparkSession, config: dict):
        self.spark = spark
        self.config = config

    def create_event_hub_stream(self, connection_string: str,
                                 consumer_group: str) -> "DataFrame":
        """Create streaming DataFrame from Event Hub."""

        return self.spark.readStream \
            .format("eventhubs") \
            .options(**{
                "eventhubs.connectionString": connection_string,
                "eventhubs.consumerGroup": consumer_group,
                "eventhubs.startingPosition": json.dumps({
                    "offset": "-1",
                    "seqNo": -1,
                    "enqueuedTime": None,
                    "isInclusive": True
                })
            }) \
            .load()

    def process_iot_stream(self, input_stream: "DataFrame") -> "DataFrame":
        """Process IoT telemetry stream."""

        schema = StructType([
            StructField("device_id", StringType()),
            StructField("timestamp", TimestampType()),
            StructField("temperature", DoubleType()),
            StructField("humidity", DoubleType()),
            StructField("pressure", DoubleType())
        ])

        return input_stream \
            .select(
                from_json(col("body").cast("string"), schema).alias("data"),
                col("enqueuedTime").alias("event_time")
            ) \
            .select("data.*", "event_time") \
            .withWatermark("timestamp", "10 minutes") \
            .groupBy(
                window("timestamp", "5 minutes"),
                "device_id"
            ) \
            .agg(
                avg("temperature").alias("avg_temperature"),
                avg("humidity").alias("avg_humidity"),
                avg("pressure").alias("avg_pressure"),
                count("*").alias("reading_count")
            )

    def write_to_delta(self, stream: "DataFrame", table_path: str,
                       checkpoint_path: str):
        """Write streaming data to Delta Lake."""

        return stream.writeStream \
            .format("delta") \
            .outputMode("append") \
            .option("checkpointLocation", checkpoint_path) \
            .trigger(processingTime="1 minute") \
            .start(table_path)

    def write_to_synapse(self, stream: "DataFrame", table_name: str,
                         checkpoint_path: str):
        """Write streaming data to Synapse Analytics."""

        return stream.writeStream \
            .format("com.databricks.spark.sqldw") \
            .option("url", self.config["synapse_jdbc_url"]) \
            .option("tempDir", self.config["staging_path"]) \
            .option("forwardSparkAzureStorageCredentials", "true") \
            .option("dbTable", table_name) \
            .option("checkpointLocation", checkpoint_path) \
            .trigger(processingTime="5 minutes") \
            .start()
```

## Data Quality Framework

```python
from great_expectations.core import ExpectationSuite
from great_expectations.dataset import SparkDFDataset
import great_expectations as ge

class DataQualityFramework:
    def __init__(self, spark: SparkSession):
        self.spark = spark
        self.context = ge.get_context()

    def create_expectation_suite(self, suite_name: str,
                                  expectations: list) -> ExpectationSuite:
        """Create a suite of data quality expectations."""

        suite = self.context.create_expectation_suite(
            expectation_suite_name=suite_name,
            overwrite_existing=True
        )

        for exp in expectations:
            suite.add_expectation(exp)

        return suite

    def validate_dataframe(self, df, suite_name: str) -> dict:
        """Validate a DataFrame against expectations."""

        ge_df = SparkDFDataset(df)

        results = self.context.run_validation_operator(
            "action_list_operator",
            assets_to_validate=[{
                "batch": ge_df,
                "expectation_suite_name": suite_name
            }]
        )

        return self._format_results(results)

    def get_standard_expectations(self, table_type: str) -> list:
        """Get standard expectations for common table types."""

        common = [
            {"expectation_type": "expect_table_row_count_to_be_between",
             "kwargs": {"min_value": 1}},
            {"expectation_type": "expect_column_values_to_not_be_null",
             "kwargs": {"column": "id"}}
        ]

        if table_type == "fact":
            return common + [
                {"expectation_type": "expect_column_values_to_be_unique",
                 "kwargs": {"column": "id"}},
                {"expectation_type": "expect_column_values_to_not_be_null",
                 "kwargs": {"column": "date_key"}},
                {"expectation_type": "expect_column_values_to_be_between",
                 "kwargs": {"column": "amount", "min_value": 0}}
            ]

        elif table_type == "dimension":
            return common + [
                {"expectation_type": "expect_column_values_to_be_unique",
                 "kwargs": {"column": "id"}},
                {"expectation_type": "expect_column_values_to_not_be_null",
                 "kwargs": {"column": "name"}}
            ]

        return common
```

## Key Patterns Summary

```yaml
data_engineering_patterns_2022:
  lakehouse:
    description: "Combines data lake flexibility with warehouse reliability"
    key_technologies:
      - Delta Lake
      - Apache Iceberg
      - Apache Hudi
    benefits:
      - ACID transactions on data lake
      - Schema enforcement and evolution
      - Time travel and versioning
      - Unified batch and streaming

  data_mesh:
    description: "Decentralized data ownership with federated governance"
    principles:
      - Domain-oriented ownership
      - Data as a product
      - Self-serve data platform
      - Federated computational governance
    challenges:
      - Cultural change
      - Platform complexity
      - Governance balance

  modern_elt:
    description: "Transform in warehouse, not before"
    tools:
      - dbt
      - Dataform
      - SQLMesh
    benefits:
      - Version controlled transformations
      - Testing and documentation
      - Modular, reusable logic

  streaming_first:
    description: "Treat batch as a special case of streaming"
    technologies:
      - Apache Kafka / Event Hubs
      - Spark Structured Streaming
      - Apache Flink
    patterns:
      - Event sourcing
      - CQRS
      - Change Data Capture
```

## Conclusion

2022 established these patterns as the foundation of modern data engineering. The lakehouse became the default architecture for new data platforms. Data mesh principles influenced how we organize data teams. Streaming became a first-class citizen alongside batch processing. As we move into 2023, expect these patterns to mature and new patterns to emerge around AI/ML integration.

## Resources

- [Delta Lake Documentation](https://docs.delta.io/)
- [Data Mesh Principles](https://martinfowler.com/articles/data-mesh-principles.html)
- [dbt Documentation](https://docs.getdbt.com/)
- [Azure Synapse Analytics](https://docs.microsoft.com/azure/synapse-analytics/)
