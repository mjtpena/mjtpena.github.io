---
title: "Implementing Feature Stores with Microsoft Fabric OneLake"
description: "Without a feature store, teams often duplicate feature engineering work across projects. Features computed for training may differ from inference, causing…"
author: Michael John Peña
draft: false
date: 2025-11-08
tags:
  - Microsoft Fabric
  - Feature Store
  - MLOps
  - Data Engineering
  - OneLake
---

## Why Feature Stores Matter

Without a feature store, teams often duplicate feature engineering work across projects. Features computed for training may differ from inference, causing training-serving skew. A centralized feature store solves both problems.

## Building on OneLake

Leverage Fabric's lakehouse architecture for a scalable feature store:

```python
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, avg, count, datediff, current_date
from delta.tables import DeltaTable
from datetime import datetime, timedelta

class FabricFeatureStore:
    def __init__(self, spark: SparkSession, catalog: str = "feature_store"):
        self.spark = spark
        self.catalog = catalog

    def register_feature_group(
        self,
        name: str,
        primary_key: list[str],
        event_time_column: str,
        description: str
    ):
        """Register a new feature group in the catalog."""
        self.spark.sql(f"""
            CREATE TABLE IF NOT EXISTS {self.catalog}.feature_registry (
                feature_group STRING,
                primary_key ARRAY<STRING>,
                event_time_column STRING,
                description STRING,
                created_at TIMESTAMP,
                version INT
            ) USING DELTA
        """)

        self.spark.sql(f"""
            INSERT INTO {self.catalog}.feature_registry
            VALUES ('{name}', array{tuple(primary_key)}, '{event_time_column}',
                    '{description}', current_timestamp(), 1)
        """)

    def compute_and_store_features(
        self,
        feature_group: str,
        source_table: str,
        feature_definitions: dict
    ):
        """Compute features from source data and store in feature store."""
        source_df = self.spark.table(source_table)

        # Apply feature transformations
        features_df = source_df.select(
            *[col(pk) for pk in feature_definitions["primary_key"]],
            col(feature_definitions["event_time"]),
            *[
                expr.alias(name)
                for name, expr in feature_definitions["features"].items()
            ]
        )

        # Write to feature store with Delta Lake
        features_df.write \
            .format("delta") \
            .mode("overwrite") \
            .option("overwriteSchema", "true") \
            .saveAsTable(f"{self.catalog}.{feature_group}")

        return features_df

    def get_training_data(
        self,
        feature_groups: list[str],
        entity_df,
        point_in_time_column: str
    ):
        """Join features for training with point-in-time correctness."""
        result_df = entity_df

        for fg in feature_groups:
            features_df = self.spark.table(f"{self.catalog}.{fg}")
            registry = self.spark.table(f"{self.catalog}.feature_registry") \
                .filter(col("feature_group") == fg).first()

            # Point-in-time join to prevent data leakage
            result_df = result_df.join(
                features_df,
                on=registry.primary_key,
                how="left"
            ).filter(
                col(registry.event_time_column) <= col(point_in_time_column)
            )

        return result_df

    def get_online_features(self, feature_group: str, entity_keys: dict):
        """Retrieve latest features for online inference."""
        features_df = self.spark.table(f"{self.catalog}.{feature_group}")

        filter_condition = " AND ".join([
            f"{k} = '{v}'" for k, v in entity_keys.items()
        ])

        return features_df.filter(filter_condition) \
            .orderBy(col("event_time").desc()) \
            .limit(1) \
            .collect()[0].asDict()

# Example: Customer features
feature_store = FabricFeatureStore(spark)
feature_store.register_feature_group(
    name="customer_features",
    primary_key=["customer_id"],
    event_time_column="computed_at",
    description="Customer behavior features for churn prediction"
)
```

## Feature Freshness

Configure Fabric Data Factory pipelines to refresh features on schedules matching business requirements. Critical features may need hourly updates while others refresh daily.

A well-designed feature store accelerates ML development by enabling feature reuse across teams and ensuring consistency between training and production environments.
