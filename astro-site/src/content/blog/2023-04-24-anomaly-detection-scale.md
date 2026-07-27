---
title: "Anomaly Detection at Scale with AI"
author: Michael John Pena
draft: false
date: 2023-04-24
tags:
  - AI
  - Anomaly Detection
  - Machine Learning
  - Data Engineering
  - Azure

---

I wrote "Anomaly Detection at Scale with AI" to share practical, production-minded guidance on this topic.

## Scalable Anomaly Detection Framework

```python
from pyspark.sql import SparkSession
from pyspark.sql.functions import *
from pyspark.ml.feature import VectorAssembler
from pyspark.ml.clustering import KMeans
import numpy as np

class ScalableAnomalyDetector:
    """Distributed anomaly detection with Spark."""

    def __init__(self, spark: SparkSession):
        self.spark = spark

    def detect_statistical_anomalies(
        self,
        df,
        numeric_cols: list,
        method: str = "zscore",
        threshold: float = 3.0
    ):
        """Detect anomalies using statistical methods."""

        result = df

        for col_name in numeric_cols:
            if method == "zscore":
                # Calculate mean and std
                stats = df.select(
                    mean(col_name).alias("mean"),
                    stddev(col_name).alias("std")
                ).collect()[0]

                col_mean = stats["mean"]
                col_std = stats["std"]

                # Add z-score column
                result = result.withColumn(
                    f"{col_name}_zscore",
                    abs((col(col_name) - lit(col_mean)) / lit(col_std))
                )

                # Flag anomalies
                result = result.withColumn(
                    f"{col_name}_anomaly",
                    when(col(f"{col_name}_zscore") > threshold, True).otherwise(False)
                )

            elif method == "iqr":
                # Calculate quartiles
                quantiles = df.approxQuantile(col_name, [0.25, 0.75], 0.05)
                q1, q3 = quantiles[0], quantiles[1]
                iqr = q3 - q1

                lower_bound = q1 - 1.5 * iqr
                upper_bound = q3 + 1.5 * iqr

                result = result.withColumn(
                    f"{col_name}_anomaly",
                    when(
                        (col(col_name) < lower_bound) | (col(col_name) > upper_bound),
                        True
                    ).otherwise(False)
                )

        # Create overall anomaly flag
        anomaly_cols = [f"{c}_anomaly" for c in numeric_cols]
        result = result.withColumn(
            "is_anomaly",
            greatest(*[col(c).cast("int") for c in anomaly_cols]) > 0
        )

        return result

    def detect_isolation_forest_anomalies(
        self,
        df,
        feature_cols: list,
        contamination: float = 0.1
    ):
        """Detect anomalies using Isolation Forest."""
        from synapse.ml.isolationforest import IsolationForest

        # Assemble features
        assembler = VectorAssembler(
            inputCols=feature_cols,
            outputCol="features",
            handleInvalid="skip"
        )
        df_assembled = assembler.transform(df)

        # Train Isolation Forest
        iso_forest = IsolationForest(
            featuresCol="features",
            predictionCol="anomaly_score",
            contamination=contamination,
            numEstimators=100,
            maxSamples=256
        )

        model = iso_forest.fit(df_assembled)
        result = model.transform(df_assembled)

        # Convert scores to binary predictions
        threshold = result.approxQuantile(
            "anomaly_score",
            [1 - contamination],
            0.01
        )[0]

        result = result.withColumn(
            "is_anomaly",
            col("anomaly_score") > threshold
        )

        return result

    def detect_cluster_based_anomalies(
        self,
        df,
        feature_cols: list,
        k: int = 10,
        distance_threshold: float = 2.0
    ):
        """Detect anomalies based on cluster distance."""

        # Assemble features
        assembler = VectorAssembler(
            inputCols=feature_cols,
            outputCol="features",
            handleInvalid="skip"
        )
        df_assembled = assembler.transform(df)

        # Train KMeans
        kmeans = KMeans(
            featuresCol="features",
            predictionCol="cluster",
            k=k,
            seed=42
        )
        model = kmeans.fit(df_assembled)

        # Get predictions with cluster assignments
        result = model.transform(df_assembled)

        # Calculate distance to cluster center
        centers = model.clusterCenters()

        def calculate_distance(features, cluster):
            center = centers[cluster]
            return float(np.linalg.norm(np.array(features) - np.array(center)))

        distance_udf = udf(calculate_distance)

        result = result.withColumn(
            "cluster_distance",
            distance_udf(col("features"), col("cluster"))
        )

        # Flag points far from cluster centers
        stats = result.select(
            mean("cluster_distance").alias("mean"),
            stddev("cluster_distance").alias("std")
        ).collect()[0]

        threshold = stats["mean"] + distance_threshold * stats["std"]

        result = result.withColumn(
            "is_anomaly",
            col("cluster_distance") > threshold
        )

        return result
```

## Time Series Anomaly Detection

```python
class TimeSeriesAnomalyDetector:
    """Detect anomalies in time series data at scale."""

    def __init__(self, spark: SparkSession):
        self.spark = spark

    def detect_seasonal_anomalies(
        self,
        df,
        date_col: str,
        value_col: str,
        period: int = 7,
        threshold: float = 2.5
    ):
        """Detect anomalies considering seasonality."""
        from pyspark.sql.window import Window

        # Add day of week/period indicator
        df_with_period = df.withColumn(
            "period_idx",
            dayofweek(col(date_col)) if period == 7
            else (dayofyear(col(date_col)) % period)
        )

        # Calculate seasonal statistics
        seasonal_stats = df_with_period.groupBy("period_idx").agg(
            mean(value_col).alias("seasonal_mean"),
            stddev(value_col).alias("seasonal_std")
        )

        # Join and calculate deviation
        result = df_with_period.join(seasonal_stats, "period_idx")

        result = result.withColumn(
            "seasonal_zscore",
            abs((col(value_col) - col("seasonal_mean")) / col("seasonal_std"))
        )

        result = result.withColumn(
            "is_anomaly",
            col("seasonal_zscore") > threshold
        )

        return result

    def detect_trend_anomalies(
        self,
        df,
        date_col: str,
        value_col: str,
        window_size: int = 30
    ):
        """Detect anomalies in trend using rolling statistics."""
        from pyspark.sql.window import Window

        # Define window
        days = lambda i: i * 86400
        window_spec = Window.partitionBy().orderBy(col(date_col).cast("timestamp").cast("long")).rangeBetween(-days(window_size), 0)

        # Calculate rolling statistics
        result = df.withColumn(
            "rolling_mean",
            mean(value_col).over(window_spec)
        ).withColumn(
            "rolling_std",
            stddev(value_col).over(window_spec)
        )

        # Calculate deviation from rolling mean
        result = result.withColumn(
            "trend_zscore",
            abs((col(value_col) - col("rolling_mean")) / col("rolling_std"))
        )

        result = result.withColumn(
            "is_anomaly",
            col("trend_zscore") > 3.0
        )

        return result

    def detect_change_points(
        self,
        df,
        date_col: str,
        value_col: str,
        min_segment_size: int = 10
    ):
        """Detect change points in time series."""
        from pyspark.sql.window import Window

        # Calculate consecutive differences
        window_spec = Window.orderBy(date_col)

        result = df.withColumn(
            "prev_value",
            lag(value_col, 1).over(window_spec)
        ).withColumn(
            "value_diff",
            col(value_col) - col("prev_value")
        )

        # Calculate cumulative sum of differences
        result = result.withColumn(
            "cusum",
            sum("value_diff").over(window_spec)
        )

        # Detect significant changes in cusum
        stats = result.select(
            stddev("value_diff").alias("diff_std")
        ).collect()[0]

        threshold = 5 * stats["diff_std"]

        result = result.withColumn(
            "is_change_point",
            abs(col("value_diff")) > threshold
        )

        return result
```

## AI-Enhanced Anomaly Explanation

```python
class AnomalyExplainer:
    """Explain detected anomalies using AI."""

    def __init__(self, llm_client, spark: SparkSession):
        self.client = llm_client
        self.spark = spark

    async def explain_anomalies(
        self,
        anomaly_df,
        context_cols: list,
        max_anomalies: int = 10
    ) -> list:
        """Generate explanations for detected anomalies."""

        # Get anomalies
        anomalies = anomaly_df.filter(col("is_anomaly") == True).limit(max_anomalies)
        anomaly_records = anomalies.toPandas().to_dict(orient='records')

        # Get normal context
        normal_sample = anomaly_df.filter(col("is_anomaly") == False).limit(20)
        normal_records = normal_sample.toPandas().to_dict(orient='records')

        explanations = []

        for anomaly in anomaly_records:
            prompt = f"""Explain why this record is anomalous.

Anomalous Record:
{json.dumps(anomaly, indent=2, default=str)}

Normal Records (sample):
{json.dumps(normal_records[:5], indent=2, default=str)}

Explain:
1. What makes this record unusual
2. Which features contribute most to the anomaly
3. Possible real-world causes
4. Recommended action (investigate/ignore/alert)

Keep explanation concise and actionable."""

            response = await self.client.chat_completion(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3
            )

            explanations.append({
                "anomaly": anomaly,
                "explanation": response.content
            })

        return explanations

    async def classify_anomaly_type(
        self,
        anomaly_data: dict,
        historical_patterns: list
    ) -> dict:
        """Classify anomaly into known patterns."""

        prompt = f"""Classify this anomaly into a category.

Anomaly:
{json.dumps(anomaly_data, indent=2, default=str)}

Known Anomaly Patterns:
{json.dumps(historical_patterns, indent=2)}

Determine:
1. Best matching pattern (or "new_pattern")
2. Confidence (0.0-1.0)
3. Distinguishing features
4. Similar past occurrences

Return as JSON."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2
        )

        return json.loads(response.content)

    async def generate_alert(
        self,
        anomaly_summary: dict,
        severity: str,
        stakeholders: list
    ) -> str:
        """Generate human-readable alert for anomaly."""

        prompt = f"""Generate an alert message for detected anomalies.

Anomaly Summary:
{json.dumps(anomaly_summary, indent=2, default=str)}

Severity: {severity}
Stakeholders: {', '.join(stakeholders)}

Create an alert that includes:
1. Clear subject line
2. What was detected
3. Potential impact
4. Recommended immediate actions
5. Links/references (placeholder)

Format as email-ready text."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Multi-Dimensional Anomaly Detection

```python
class MultiDimensionalAnomalyDetector:
    """Detect complex multi-dimensional anomalies."""

    def __init__(self, spark: SparkSession, llm_client):
        self.spark = spark
        self.client = llm_client

    def detect_contextual_anomalies(
        self,
        df,
        value_cols: list,
        context_cols: list
    ):
        """Detect anomalies considering context."""
        from pyspark.sql.window import Window

        result = df

        for value_col in value_cols:
            # Group by context and calculate statistics
            context_stats = df.groupBy(context_cols).agg(
                mean(value_col).alias(f"{value_col}_ctx_mean"),
                stddev(value_col).alias(f"{value_col}_ctx_std"),
                count("*").alias(f"{value_col}_ctx_count")
            )

            # Join and calculate contextual z-score
            result = result.join(context_stats, context_cols, "left")

            result = result.withColumn(
                f"{value_col}_ctx_zscore",
                when(
                    col(f"{value_col}_ctx_std") > 0,
                    abs((col(value_col) - col(f"{value_col}_ctx_mean")) / col(f"{value_col}_ctx_std"))
                ).otherwise(0)
            )

        # Aggregate anomaly scores
        zscore_cols = [f"{c}_ctx_zscore" for c in value_cols]
        result = result.withColumn(
            "combined_anomaly_score",
            sum([col(c) for c in zscore_cols]) / len(zscore_cols)
        )

        result = result.withColumn(
            "is_anomaly",
            col("combined_anomaly_score") > 2.5
        )

        return result

    async def detect_collective_anomalies(
        self,
        df,
        group_col: str,
        feature_cols: list
    ) -> list:
        """Detect groups that are collectively anomalous."""

        # Aggregate by group
        group_aggs = []
        for col_name in feature_cols:
            group_aggs.extend([
                mean(col_name).alias(f"{col_name}_mean"),
                stddev(col_name).alias(f"{col_name}_std"),
                min(col_name).alias(f"{col_name}_min"),
                max(col_name).alias(f"{col_name}_max")
            ])

        group_stats = df.groupBy(group_col).agg(*group_aggs)

        # Use LLM to identify anomalous groups
        stats_sample = group_stats.limit(50).toPandas().to_dict(orient='records')

        prompt = f"""Identify anomalous groups from these statistics.

Group Statistics:
{json.dumps(stats_sample, indent=2, default=str)}

Identify groups that are anomalous based on:
1. Unusual distributions
2. Extreme statistics
3. Inconsistent patterns

For each anomalous group provide:
- group_id: identifier
- anomaly_type: what makes it anomalous
- severity: high/medium/low
- details: specific observations

Return as JSON array."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)

# Usage
detector = ScalableAnomalyDetector(spark)

# Load data
df = spark.table("bronze.transactions")

# Detect statistical anomalies
anomalies = detector.detect_statistical_anomalies(
    df,
    numeric_cols=["amount", "quantity", "discount"],
    method="zscore",
    threshold=3.0
)

# Get anomaly count
anomaly_count = anomalies.filter(col("is_anomaly") == True).count()
print(f"Found {anomaly_count} anomalies")

# Explain anomalies with AI
explainer = AnomalyExplainer(llm_client, spark)
explanations = await explainer.explain_anomalies(anomalies, context_cols=["customer_id", "product_id"])
```

Anomaly detection at scale combines statistical rigor with AI understanding. Systems that both detect and explain anomalies enable faster, more confident decision-making.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
