---
title: "Streaming Machine Learning: Training and Inference on Real-Time Data"
author: Michael John Peña
draft: false
date: 2024-11-25
tags:
  - Azure
  - Microsoft Fabric
  - Machine Learning
  - Streaming
  - MLOps

---

I wrote "Streaming Machine Learning: Training and Inference on Real-Time Data" to share practical, production-minded guidance on this topic.

## Streaming ML Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Streaming ML Pipeline                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Data Stream → Feature      → Model        → Predictions    │
│                Engineering    Serving                        │
│                    │             │                           │
│                    ↓             ↓                           │
│              [Feature      [Model          [Monitoring      │
│               Store]        Registry]       & Feedback]     │
│                    │             │              │            │
│                    └─────────────┴──────────────┘            │
│                              │                               │
│                    [Continuous Training]                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Online Feature Engineering with Spark Structured Streaming

```python
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.window import Window
from pyspark.sql.types import StructType, StructField, StringType, DoubleType, TimestampType

spark = SparkSession.builder \
    .appName("StreamingFeatures") \
    .getOrCreate()

# Read from EventHub/Kafka stream
activity_stream = spark.readStream \
    .format("eventhubs") \
    .options(**eventhub_config) \
    .load()

# Parse the event data
parsed_stream = activity_stream.select(
    F.from_json(F.col("body").cast("string"), event_schema).alias("data"),
    F.col("enqueuedTime").alias("event_time")
).select("data.*", "event_time")

# Define windowed aggregations for features
windowed_features = parsed_stream \
    .withWatermark("event_time", "10 minutes") \
    .groupBy(
        F.col("user_id"),
        F.window("event_time", "5 minutes")
    ) \
    .agg(
        F.count(F.when(F.col("event_type") == "click", 1)).alias("clicks_last_5min"),
        F.avg("session_duration").alias("avg_session_duration"),
        F.countDistinct("page_id").alias("unique_pages_viewed"),
        F.sum(F.when(F.col("event_type") == "purchase", F.col("amount")).otherwise(0)).alias("purchase_amount")
    )

# Add derived features
enriched_features = windowed_features \
    .withColumn("engagement_score",
        F.col("clicks_last_5min") * 0.3 +
        F.col("unique_pages_viewed") * 0.4 +
        F.when(F.col("purchase_amount") > 0, 30).otherwise(0)
    )

# Write to Delta Lake for offline feature store
feature_query = enriched_features.writeStream \
    .format("delta") \
    .outputMode("append") \
    .option("checkpointLocation", "/checkpoints/user_features") \
    .toTable("feature_store.user_realtime_features")

# Write to Redis for online feature serving
def write_to_redis(batch_df, batch_id):
    import redis
    r = redis.Redis(host='localhost', port=6379)

    for row in batch_df.collect():
        key = f"user_features:{row.user_id}"
        r.hset(key, mapping={
            "clicks_last_5min": row.clicks_last_5min,
            "avg_session_duration": row.avg_session_duration,
            "unique_pages_viewed": row.unique_pages_viewed,
            "engagement_score": row.engagement_score
        })
        r.expire(key, 3600)  # 1 hour TTL

redis_query = enriched_features.writeStream \
    .foreachBatch(write_to_redis) \
    .outputMode("update") \
    .option("checkpointLocation", "/checkpoints/redis_features") \
    .start()
```

## Online Model Serving with MLflow

```python
import mlflow
from mlflow.tracking import MlflowClient
from fastapi import FastAPI
from pydantic import BaseModel
import redis
import numpy as np

app = FastAPI()
client = MlflowClient()

# Load model from MLflow registry
model_name = "user_recommender"
model_version = "production"
model = mlflow.pyfunc.load_model(f"models:/{model_name}/{model_version}")

# Redis client for online features
redis_client = redis.Redis(host='localhost', port=6379)

class RecommendationRequest(BaseModel):
    user_id: str
    current_page: str
    device_type: str

class RecommendationResponse(BaseModel):
    recommendations: list
    model_version: str
    latency_ms: float

@app.post("/recommend", response_model=RecommendationResponse)
async def recommend(request: RecommendationRequest):
    import time
    start_time = time.time()

    # Fetch online features from Redis
    features = redis_client.hgetall(f"user_features:{request.user_id}")

    # Prepare feature vector
    feature_vector = {
        "clicks_last_5min": float(features.get(b"clicks_last_5min", 0)),
        "avg_session_duration": float(features.get(b"avg_session_duration", 0)),
        "unique_pages_viewed": float(features.get(b"unique_pages_viewed", 0)),
        "engagement_score": float(features.get(b"engagement_score", 0)),
        "current_page": request.current_page,
        "device_type": request.device_type
    }

    # Run inference
    predictions = model.predict([feature_vector])

    latency_ms = (time.time() - start_time) * 1000

    # Log prediction for monitoring
    mlflow.log_metrics({
        "inference_latency_ms": latency_ms,
        "user_engagement_score": feature_vector["engagement_score"]
    })

    return RecommendationResponse(
        recommendations=predictions[0].tolist(),
        model_version=model_version,
        latency_ms=latency_ms
    )

# Health check
@app.get("/health")
async def health():
    return {"status": "healthy", "model": model_name, "version": model_version}
```

## Continuous Training Pipeline with MLflow and PySpark

```python
import mlflow
from mlflow.models.signature import infer_signature
from pyspark.sql import SparkSession
from pyspark.ml.feature import VectorAssembler, StandardScaler
from pyspark.ml.classification import GBTClassifier
from pyspark.ml import Pipeline
from pyspark.ml.evaluation import BinaryClassificationEvaluator
from datetime import datetime, timedelta
import schedule
import time

spark = SparkSession.builder.appName("ContinuousTraining").getOrCreate()

def train_model():
    """Train model on recent data window."""
    mlflow.set_experiment("recommender_continuous_training")

    with mlflow.start_run(run_name=f"training_{datetime.now().strftime('%Y%m%d_%H%M')}"):
        # Load training data from last 24 hours
        training_data = spark.sql("""
            SELECT * FROM feature_store.training_data
            WHERE event_time >= current_timestamp() - INTERVAL 24 HOURS
        """)

        # Log data stats
        mlflow.log_param("training_samples", training_data.count())
        mlflow.log_param("training_window", "24h")

        # Feature engineering
        feature_cols = ["clicks_last_5min", "avg_session_duration",
                       "unique_pages_viewed", "engagement_score"]

        assembler = VectorAssembler(inputCols=feature_cols, outputCol="features_raw")
        scaler = StandardScaler(inputCol="features_raw", outputCol="features")

        # Model
        gbt = GBTClassifier(
            labelCol="label",
            featuresCol="features",
            maxIter=100,
            maxDepth=5
        )

        pipeline = Pipeline(stages=[assembler, scaler, gbt])

        # Split data
        train_df, val_df = training_data.randomSplit([0.9, 0.1], seed=42)

        # Train
        model = pipeline.fit(train_df)

        # Evaluate
        predictions = model.transform(val_df)
        evaluator = BinaryClassificationEvaluator(labelCol="label")

        auc = evaluator.evaluate(predictions)
        mlflow.log_metric("validation_auc", auc)

        # Log model
        signature = infer_signature(train_df.select(feature_cols), predictions.select("prediction"))
        mlflow.spark.log_model(model, "model", signature=signature)

        # Check if should promote
        current_production = get_production_metrics()
        if should_promote(auc, current_production):
            promote_model(mlflow.active_run().info.run_id)

        return auc

def get_production_metrics():
    """Get metrics of current production model."""
    client = mlflow.tracking.MlflowClient()
    try:
        production_version = client.get_latest_versions("recommender", stages=["Production"])[0]
        run = client.get_run(production_version.run_id)
        return {"auc": run.data.metrics.get("validation_auc", 0)}
    except:
        return {"auc": 0}

def should_promote(new_auc: float, current_metrics: dict) -> bool:
    """Decide if new model should be promoted."""
    current_auc = current_metrics.get("auc", 0)
    # Promote if AUC improves by at least 1%
    return new_auc > current_auc * 1.01

def promote_model(run_id: str):
    """Promote model to production."""
    client = mlflow.tracking.MlflowClient()

    # Register model
    model_uri = f"runs:/{run_id}/model"
    mv = mlflow.register_model(model_uri, "recommender")

    # Transition to production
    client.transition_model_version_stage(
        name="recommender",
        version=mv.version,
        stage="Production"
    )

    print(f"Promoted model version {mv.version} to Production")

# Schedule training every 6 hours
schedule.every(6).hours.do(train_model)

if __name__ == "__main__":
    while True:
        schedule.run_pending()
        time.sleep(60)
```

## Model Monitoring and Drift Detection

```python
import mlflow
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from scipy import stats
import numpy as np
from datetime import datetime, timedelta

spark = SparkSession.builder.appName("ModelMonitoring").getOrCreate()

class ModelMonitor:
    def __init__(self, model_name: str, reference_data_path: str):
        self.model_name = model_name
        self.reference_data = spark.read.parquet(reference_data_path)
        self.reference_stats = self._compute_stats(self.reference_data)

    def _compute_stats(self, df):
        """Compute statistics for drift detection."""
        stats = {}
        numeric_cols = ["clicks_last_5min", "avg_session_duration",
                       "unique_pages_viewed", "engagement_score"]

        for col in numeric_cols:
            col_data = [row[col] for row in df.select(col).collect()]
            stats[col] = {
                "mean": np.mean(col_data),
                "std": np.std(col_data),
                "percentiles": np.percentile(col_data, [25, 50, 75])
            }
        return stats

    def detect_drift(self, current_data):
        """Detect feature drift using KS test."""
        current_stats = self._compute_stats(current_data)
        drift_results = {}

        for col in self.reference_stats:
            ref_data = [row[col] for row in self.reference_data.select(col).collect()]
            curr_data = [row[col] for row in current_data.select(col).collect()]

            # Kolmogorov-Smirnov test
            ks_stat, p_value = stats.ks_2samp(ref_data, curr_data)

            drift_results[col] = {
                "ks_statistic": ks_stat,
                "p_value": p_value,
                "drift_detected": p_value < 0.05
            }

        return drift_results

    def calculate_psi(self, expected, actual, bins=10):
        """Calculate Population Stability Index."""
        expected_percents = np.histogram(expected, bins=bins)[0] / len(expected)
        actual_percents = np.histogram(actual, bins=bins)[0] / len(actual)

        # Avoid division by zero
        expected_percents = np.clip(expected_percents, 0.0001, None)
        actual_percents = np.clip(actual_percents, 0.0001, None)

        psi = np.sum((actual_percents - expected_percents) *
                     np.log(actual_percents / expected_percents))
        return psi

    def monitor_predictions(self, predictions_table: str, feedback_table: str):
        """Monitor prediction quality with feedback."""
        # Get predictions from last hour
        predictions = spark.sql(f"""
            SELECT p.*, f.actual_outcome
            FROM {predictions_table} p
            LEFT JOIN {feedback_table} f ON p.request_id = f.request_id
            WHERE p.prediction_time >= current_timestamp() - INTERVAL 1 HOUR
            AND f.actual_outcome IS NOT NULL
        """)

        # Calculate metrics
        accuracy = predictions.filter(
            F.col("prediction") == F.col("actual_outcome")
        ).count() / predictions.count()

        # Log to MLflow
        with mlflow.start_run(run_name=f"monitoring_{datetime.now().isoformat()}"):
            mlflow.log_metric("hourly_accuracy", accuracy)

            # Check for drift
            current_features = spark.sql(f"""
                SELECT clicks_last_5min, avg_session_duration,
                       unique_pages_viewed, engagement_score
                FROM {predictions_table}
                WHERE prediction_time >= current_timestamp() - INTERVAL 1 HOUR
            """)

            drift_results = self.detect_drift(current_features)

            for col, result in drift_results.items():
                mlflow.log_metric(f"drift_ks_{col}", result["ks_statistic"])
                if result["drift_detected"]:
                    self._send_alert(f"Drift detected in {col}", "warning")

        return {"accuracy": accuracy, "drift": drift_results}

    def _send_alert(self, message: str, severity: str):
        """Send alert to monitoring system."""
        import requests
        # Send to Teams webhook, PagerDuty, etc.
        print(f"[{severity.upper()}] {message}")

# Usage
monitor = ModelMonitor(
    model_name="recommender",
    reference_data_path="/reference_data/recommender_baseline"
)

# Run monitoring check
results = monitor.monitor_predictions(
    predictions_table="predictions.recommender_predictions",
    feedback_table="feedback.user_actions"
)
print(f"Accuracy: {results['accuracy']:.4f}")
```

## A/B Testing in Streaming

```python
import hashlib
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
import mlflow

spark = SparkSession.builder.appName("ABTesting").getOrCreate()

class StreamingABTest:
    def __init__(self, experiment_name: str, variants: list):
        self.experiment_name = experiment_name
        self.variants = {v["name"]: v for v in variants}
        self.total_traffic = sum(v["traffic_percentage"] for v in variants)

    def assign_variant(self, user_id: str) -> str:
        """Deterministically assign user to variant."""
        hash_value = int(hashlib.md5(
            f"{self.experiment_name}:{user_id}".encode()
        ).hexdigest(), 16)

        bucket = hash_value % 100
        cumulative = 0

        for variant in self.variants.values():
            cumulative += variant["traffic_percentage"]
            if bucket < cumulative:
                return variant["name"]

        return list(self.variants.keys())[0]

    def log_exposure(self, user_id: str, variant: str, request_id: str):
        """Log exposure event to Delta Lake."""
        exposure_df = spark.createDataFrame([{
            "experiment": self.experiment_name,
            "user_id": user_id,
            "variant": variant,
            "request_id": request_id,
            "timestamp": F.current_timestamp()
        }])

        exposure_df.write.format("delta").mode("append").saveAsTable("experiments.exposures")

    def log_outcome(self, request_id: str, converted: bool, revenue: float = 0):
        """Log outcome event."""
        outcome_df = spark.createDataFrame([{
            "request_id": request_id,
            "converted": converted,
            "revenue": revenue,
            "timestamp": F.current_timestamp()
        }])

        outcome_df.write.format("delta").mode("append").saveAsTable("experiments.outcomes")

    def get_results(self):
        """Calculate experiment results."""
        results = spark.sql(f"""
            WITH exposures AS (
                SELECT * FROM experiments.exposures
                WHERE experiment = '{self.experiment_name}'
            ),
            outcomes AS (
                SELECT * FROM experiments.outcomes
            ),
            joined AS (
                SELECT
                    e.variant,
                    e.user_id,
                    COALESCE(o.converted, false) as converted,
                    COALESCE(o.revenue, 0) as revenue
                FROM exposures e
                LEFT JOIN outcomes o ON e.request_id = o.request_id
            )
            SELECT
                variant,
                COUNT(DISTINCT user_id) as users,
                SUM(CASE WHEN converted THEN 1 ELSE 0 END) as conversions,
                AVG(CASE WHEN converted THEN 1.0 ELSE 0.0 END) as conversion_rate,
                AVG(revenue) as avg_revenue
            FROM joined
            GROUP BY variant
        """)

        return results.toPandas()

    def calculate_significance(self, control_rate: float, treatment_rate: float,
                               control_n: int, treatment_n: int) -> dict:
        """Calculate statistical significance."""
        from scipy import stats
        import numpy as np

        # Pooled proportion
        pooled = (control_rate * control_n + treatment_rate * treatment_n) / (control_n + treatment_n)
        se = np.sqrt(pooled * (1 - pooled) * (1/control_n + 1/treatment_n))

        z_score = (treatment_rate - control_rate) / se
        p_value = 2 * (1 - stats.norm.cdf(abs(z_score)))

        return {
            "z_score": z_score,
            "p_value": p_value,
            "significant": p_value < 0.05,
            "lift": (treatment_rate - control_rate) / control_rate if control_rate > 0 else 0
        }

# Usage
ab_test = StreamingABTest(
    experiment_name="recommender_v2_test",
    variants=[
        {"name": "control", "model_version": "v1.5", "traffic_percentage": 50},
        {"name": "treatment", "model_version": "v2.0", "traffic_percentage": 50}
    ]
)

# In recommendation endpoint
def get_recommendations(user_id: str, request_id: str):
    variant = ab_test.assign_variant(user_id)
    model_version = ab_test.variants[variant]["model_version"]

    # Log exposure
    ab_test.log_exposure(user_id, variant, request_id)

    # Get predictions from appropriate model
    model = mlflow.pyfunc.load_model(f"models:/recommender/{model_version}")
    predictions = model.predict(...)

    return predictions, variant

# Get results
results = ab_test.get_results()
print(results)
```

Streaming ML enables intelligent real-time systems that continuously learn and adapt. Start with robust feature engineering and monitoring before enabling continuous training.

## Resources

- [MLflow Documentation](https://mlflow.org/docs/latest/index.html)
- [Spark Structured Streaming](https://spark.apache.org/docs/latest/structured-streaming-programming-guide.html)
- [Azure ML Model Monitoring](https://learn.microsoft.com/en-us/azure/machine-learning/how-to-monitor-model-performance)
- [Feature Store Patterns](https://www.featurestore.org/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
