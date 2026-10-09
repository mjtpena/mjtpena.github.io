---
title: "ML Model Deployment Patterns in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2023-09-29
description: "Best practices and patterns for deploying machine learning models in Microsoft Fabric."
tags:
  - Microsoft Fabric
  - MLOps
  - Model Deployment
  - Machine Learning
  - Data Science
---

## Introduction

Deploying machine learning models effectively is crucial for delivering business value from data science investments. Microsoft Fabric provides multiple patterns for model deployment, from batch scoring to real-time predictions. This post covers deployment strategies and best practices.

## Deployment Patterns Overview

### Pattern Selection Guide

```python
from dataclasses import dataclass
from typing import List, Dict
from enum import Enum

class DeploymentPattern(Enum):
    BATCH_SCORING = "batch"
    REAL_TIME_API = "realtime"
    EMBEDDED_PREDICT = "embedded"
    STREAMING = "streaming"

class LatencyRequirement(Enum):
    SUB_SECOND = "< 1 second"
    SECONDS = "1-30 seconds"
    MINUTES = "1-60 minutes"
    HOURS = "hours"

@dataclass
class DeploymentRequirements:
    latency: LatencyRequirement
    throughput_per_hour: int
    data_freshness: str
    infrastructure_preference: str

class DeploymentPatternSelector:
    """Select appropriate deployment pattern based on requirements"""

    def __init__(self):
        self.patterns = {
            DeploymentPattern.BATCH_SCORING: {
                "best_for": ["Large scale scoring", "Scheduled predictions", "Historical analysis"],
                "latency": [LatencyRequirement.MINUTES, LatencyRequirement.HOURS],
                "throughput": "Millions+ records",
                "infrastructure": "Spark notebooks, Pipelines",
                "example_use_cases": ["Daily churn predictions", "Monthly scoring", "Bulk recommendations"]
            },
            DeploymentPattern.REAL_TIME_API: {
                "best_for": ["Interactive applications", "User-facing predictions", "Low latency needs"],
                "latency": [LatencyRequirement.SUB_SECOND, LatencyRequirement.SECONDS],
                "throughput": "Thousands requests/minute",
                "infrastructure": "Azure ML endpoints, Custom APIs",
                "example_use_cases": ["Price optimization", "Fraud detection", "Chatbot responses"]
            },
            DeploymentPattern.EMBEDDED_PREDICT: {
                "best_for": ["SQL-based analytics", "Power BI integration", "Ad-hoc predictions"],
                "latency": [LatencyRequirement.SECONDS, LatencyRequirement.MINUTES],
                "throughput": "Moderate",
                "infrastructure": "PREDICT function in Fabric",
                "example_use_cases": ["Dashboard predictions", "Query-time scoring", "What-if analysis"]
            },
            DeploymentPattern.STREAMING: {
                "best_for": ["Real-time data", "Event processing", "Continuous predictions"],
                "latency": [LatencyRequirement.SUB_SECOND, LatencyRequirement.SECONDS],
                "throughput": "Continuous stream",
                "infrastructure": "Event Streams, Spark Streaming",
                "example_use_cases": ["IoT anomaly detection", "Real-time recommendations", "Live monitoring"]
            }
        }

    def recommend_pattern(self, requirements: DeploymentRequirements) -> Dict:
        """Recommend deployment pattern based on requirements"""
        recommendations = []

        for pattern, details in self.patterns.items():
            score = 0

            # Check latency match
            if requirements.latency in details["latency"]:
                score += 40

            # Check throughput alignment
            if requirements.throughput_per_hour > 1000000 and pattern == DeploymentPattern.BATCH_SCORING:
                score += 30
            elif requirements.throughput_per_hour < 10000 and pattern in [DeploymentPattern.REAL_TIME_API, DeploymentPattern.EMBEDDED_PREDICT]:
                score += 30

            recommendations.append({
                "pattern": pattern.value,
                "score": score,
                "details": details
            })

        recommendations.sort(key=lambda x: x["score"], reverse=True)
        return recommendations[0]

# Usage
selector = DeploymentPatternSelector()

requirements = DeploymentRequirements(
    latency=LatencyRequirement.MINUTES,
    throughput_per_hour=500000,
    data_freshness="daily",
    infrastructure_preference="Fabric native"
)

recommendation = selector.recommend_pattern(requirements)
print(f"Recommended: {recommendation['pattern']}")
print(f"Best for: {recommendation['details']['best_for']}")
```

### Batch Deployment Pattern

```python
class BatchDeploymentPattern:
    """Batch model deployment in Fabric"""

    def generate_batch_pipeline(
        self,
        model_name: str,
        source_table: str,
        predictions_table: str,
        feature_columns: List[str],
        schedule: str = "daily"
    ) -> str:
        """Generate batch scoring pipeline code"""
        return f'''
# Batch Model Deployment Pipeline
import mlflow
from pyspark.sql import SparkSession, functions as F
from datetime import datetime

spark = SparkSession.builder.getOrCreate()

class BatchScoringPipeline:
    def __init__(self, model_name: str, stage: str = "Production"):
        self.model_name = model_name
        self.model_uri = f"models:/{{model_name}}/{{stage}}"
        self.predict_udf = mlflow.pyfunc.spark_udf(spark, self.model_uri)

    def score(self, source_table: str, feature_columns: list) -> "DataFrame":
        """Score data from source table"""
        # Read source data
        df = spark.table(source_table)
        print(f"Scoring {{df.count()}} records...")

        # Apply model
        predictions = df.withColumn(
            "prediction",
            self.predict_udf(*[F.col(c) for c in feature_columns])
        )

        # Add metadata
        predictions = predictions.withColumn("model_name", F.lit(self.model_name))
        predictions = predictions.withColumn("model_uri", F.lit(self.model_uri))
        predictions = predictions.withColumn("scored_at", F.current_timestamp())

        return predictions

    def save_predictions(self, predictions, target_table: str, mode: str = "overwrite"):
        """Save predictions to Delta table"""
        (predictions
            .write
            .format("delta")
            .mode(mode)
            .option("mergeSchema", "true")
            .saveAsTable(target_table)
        )
        print(f"Saved predictions to {{target_table}}")

    def run(self, source_table: str, target_table: str, feature_columns: list):
        """Run complete pipeline"""
        start_time = datetime.now()

        predictions = self.score(source_table, feature_columns)
        self.save_predictions(predictions, target_table)

        duration = (datetime.now() - start_time).total_seconds()
        print(f"Pipeline completed in {{duration:.2f}} seconds")

        return predictions

# Execute pipeline
pipeline = BatchScoringPipeline("{model_name}")
predictions = pipeline.run(
    source_table="{source_table}",
    target_table="{predictions_table}",
    feature_columns={feature_columns}
)
'''

    def generate_scheduled_pipeline(self, schedule_config: Dict) -> str:
        """Generate scheduled pipeline configuration"""
        return f'''
# Scheduled Batch Scoring Configuration
# This would be set up in Fabric Data Factory Pipeline

pipeline_config = {{
    "name": "BatchScoringPipeline",
    "schedule": {{
        "frequency": "{schedule_config.get('frequency', 'daily')}",
        "time": "{schedule_config.get('time', '06:00')}",
        "timezone": "{schedule_config.get('timezone', 'UTC')}"
    }},
    "activities": [
        {{
            "name": "ScoreNewData",
            "type": "Notebook",
            "notebook_path": "Notebooks/batch_scoring",
            "parameters": {{
                "source_table": "@pipeline().parameters.source_table",
                "target_table": "@pipeline().parameters.target_table"
            }}
        }},
        {{
            "name": "ValidatePredictions",
            "type": "Notebook",
            "notebook_path": "Notebooks/validate_predictions",
            "dependsOn": ["ScoreNewData"]
        }},
        {{
            "name": "NotifyCompletion",
            "type": "Web",
            "url": "https://hooks.example.com/notify",
            "body": {{"status": "completed", "records": "@activity('ScoreNewData').output.count"}},
            "dependsOn": ["ValidatePredictions"]
        }}
    ]
}}
'''
```

### Real-Time Deployment Pattern

```python
class RealTimeDeploymentPattern:
    """Real-time model deployment patterns"""

    def generate_azure_ml_deployment(
        self,
        model_name: str,
        environment_name: str
    ) -> str:
        """Generate Azure ML endpoint deployment code"""
        return f'''
# Real-Time Deployment to Azure ML Managed Endpoint
from azure.ai.ml import MLClient
from azure.ai.ml.entities import (
    ManagedOnlineEndpoint,
    ManagedOnlineDeployment,
    Model,
    Environment,
    CodeConfiguration
)
from azure.identity import DefaultAzureCredential

# Initialize ML client
credential = DefaultAzureCredential()
ml_client = MLClient(
    credential=credential,
    subscription_id="<subscription-id>",
    resource_group_name="<resource-group>",
    workspace_name="<workspace>"
)

# Create endpoint
endpoint_name = "{model_name.lower().replace('_', '-')}-endpoint"
endpoint = ManagedOnlineEndpoint(
    name=endpoint_name,
    description="Endpoint for {model_name}",
    auth_mode="key"
)
ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Create deployment
deployment = ManagedOnlineDeployment(
    name="blue",
    endpoint_name=endpoint_name,
    model=ml_client.models.get("{model_name}", version="1"),
    environment="{environment_name}",
    instance_type="Standard_DS3_v2",
    instance_count=1,
    scoring_script="score.py"
)
ml_client.online_deployments.begin_create_or_update(deployment).result()

# Set traffic
endpoint.traffic = {{"blue": 100}}
ml_client.online_endpoints.begin_create_or_update(endpoint).result()

print(f"Endpoint deployed: {{endpoint.scoring_uri}}")
'''

    def generate_scoring_script(self) -> str:
        """Generate scoring script for deployment"""
        return '''
# score.py - Scoring script for Azure ML deployment
import json
import mlflow
import pandas as pd
import os

def init():
    """Initialize model on startup"""
    global model
    model_path = os.path.join(os.getenv("AZUREML_MODEL_DIR"), "model")
    model = mlflow.pyfunc.load_model(model_path)

def run(raw_data):
    """Score incoming data"""
    try:
        # Parse input
        data = json.loads(raw_data)

        if isinstance(data, dict):
            df = pd.DataFrame([data])
        else:
            df = pd.DataFrame(data)

        # Make predictions
        predictions = model.predict(df)

        # Return results
        return json.dumps({
            "predictions": predictions.tolist(),
            "status": "success"
        })

    except Exception as e:
        return json.dumps({
            "error": str(e),
            "status": "error"
        })
'''

    def generate_client_code(self, endpoint_url: str) -> str:
        """Generate client code for calling endpoint"""
        return f'''
# Client Code for Real-Time Predictions
import requests
import json

class ModelClient:
    def __init__(self, endpoint_url: str, api_key: str):
        self.endpoint_url = endpoint_url
        self.headers = {{
            "Authorization": f"Bearer {{api_key}}",
            "Content-Type": "application/json"
        }}

    def predict(self, data: dict) -> dict:
        """Make single prediction"""
        response = requests.post(
            self.endpoint_url,
            headers=self.headers,
            json=data
        )
        response.raise_for_status()
        return response.json()

    def predict_batch(self, data_list: list) -> list:
        """Make batch predictions"""
        response = requests.post(
            self.endpoint_url,
            headers=self.headers,
            json=data_list
        )
        response.raise_for_status()
        return response.json()

# Usage
client = ModelClient(
    endpoint_url="{endpoint_url}",
    api_key="your-api-key"
)

# Single prediction
result = client.predict({{
    "feature1": 10.5,
    "feature2": "category_a",
    "feature3": 100
}})
print(f"Prediction: {{result['predictions'][0]}}")

# Batch predictions
batch_data = [
    {{"feature1": 10.5, "feature2": "category_a", "feature3": 100}},
    {{"feature1": 20.3, "feature2": "category_b", "feature3": 200}}
]
results = client.predict_batch(batch_data)
print(f"Batch predictions: {{results['predictions']}}")
'''
```

### Streaming Deployment Pattern

```python
class StreamingDeploymentPattern:
    """Streaming model deployment in Fabric"""

    def generate_spark_streaming_scorer(
        self,
        model_uri: str,
        input_topic: str,
        output_topic: str
    ) -> str:
        """Generate Spark Structured Streaming scoring code"""
        return f'''
# Streaming Model Deployment with Spark Structured Streaming
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StructField, StringType, DoubleType
import mlflow

spark = SparkSession.builder.getOrCreate()

# Load model as UDF
predict_udf = mlflow.pyfunc.spark_udf(spark, model_uri="{model_uri}")

# Define input schema
input_schema = StructType([
    StructField("id", StringType(), True),
    StructField("feature1", DoubleType(), True),
    StructField("feature2", DoubleType(), True),
    StructField("feature3", DoubleType(), True),
    StructField("timestamp", StringType(), True)
])

# Read from Event Hub/Kafka
stream_df = (spark
    .readStream
    .format("eventhubs")  # or "kafka"
    .option("eventhubs.connectionString", "<connection-string>")
    .option("eventhubs.consumerGroup", "$Default")
    .load()
    .select(F.from_json(F.col("body").cast("string"), input_schema).alias("data"))
    .select("data.*")
)

# Apply model predictions
predictions_df = stream_df.withColumn(
    "prediction",
    predict_udf(
        F.col("feature1"),
        F.col("feature2"),
        F.col("feature3")
    )
).withColumn("scored_at", F.current_timestamp())

# Write to output
query = (predictions_df
    .writeStream
    .format("delta")
    .outputMode("append")
    .option("checkpointLocation", "/checkpoints/streaming_predictions")
    .table("streaming_predictions")
)

# Monitor stream
query.awaitTermination()
'''

    def generate_eventstream_integration(self) -> str:
        """Generate Fabric Eventstream integration code"""
        return '''
# Fabric Eventstream Integration for Real-Time Scoring
# This pattern uses Fabric's Eventstream for streaming data

# 1. Create Eventstream in Fabric UI
# 2. Add source (Event Hub, Kafka, custom app)
# 3. Add transformation node for feature engineering
# 4. Add destination to KQL Database or Lakehouse

# For custom processing, use KQL to apply model:
kql_query = """
events
| extend prediction = predict_linear_regression(
    pack_array(feature1, feature2, feature3),
    model_coefficients
)
| project timestamp, id, feature1, feature2, feature3, prediction
"""

# Or process in Spark with streaming
from pyspark.sql.streaming import StreamingQueryListener

class PredictionMonitor(StreamingQueryListener):
    def onQueryStarted(self, event):
        print(f"Query started: {event.id}")

    def onQueryProgress(self, event):
        print(f"Processed {event.progress.numInputRows} rows")

    def onQueryTerminated(self, event):
        print(f"Query terminated: {event.id}")

spark.streams.addListener(PredictionMonitor())
'''
```

### Model Versioning and A/B Testing

```python
class ModelVersioningAndTesting:
    """Model versioning and A/B testing patterns"""

    def generate_ab_testing_code(
        self,
        model_a_uri: str,
        model_b_uri: str,
        traffic_split: float = 0.5
    ) -> str:
        """Generate A/B testing code for models"""
        return f'''
# A/B Testing for Model Deployment
import mlflow
from pyspark.sql import functions as F
import random

class ABTestingScorer:
    def __init__(self, model_a_uri: str, model_b_uri: str, split: float = 0.5):
        self.model_a = mlflow.pyfunc.spark_udf(spark, model_a_uri)
        self.model_b = mlflow.pyfunc.spark_udf(spark, model_b_uri)
        self.split = split

    def score_with_ab_test(self, df, feature_columns):
        """Score data with A/B test assignment"""
        # Assign to A or B group
        df = df.withColumn(
            "ab_group",
            F.when(F.rand() < self.split, "A").otherwise("B")
        )

        # Score with appropriate model
        feature_cols = [F.col(c) for c in feature_columns]

        df = df.withColumn(
            "prediction",
            F.when(
                F.col("ab_group") == "A",
                self.model_a(*feature_cols)
            ).otherwise(
                self.model_b(*feature_cols)
            )
        )

        df = df.withColumn("scored_at", F.current_timestamp())

        return df

# Usage
ab_scorer = ABTestingScorer(
    model_a_uri="{model_a_uri}",
    model_b_uri="{model_b_uri}",
    split={traffic_split}
)

predictions = ab_scorer.score_with_ab_test(
    df,
    feature_columns=["feature1", "feature2", "feature3"]
)

# Analyze A/B test results
ab_results = (predictions
    .groupBy("ab_group")
    .agg(
        F.count("*").alias("count"),
        F.avg("prediction").alias("avg_prediction"),
        F.stddev("prediction").alias("std_prediction")
    )
)
ab_results.show()
'''

# Usage
versioning = ModelVersioningAndTesting()

ab_code = versioning.generate_ab_testing_code(
    model_a_uri="models:/churn_model/1",
    model_b_uri="models:/churn_model/2",
    traffic_split=0.5
)
print(ab_code)
```

## Conclusion

Microsoft Fabric offers flexible model deployment patterns to meet various business requirements. By understanding the trade-offs between batch, real-time, embedded, and streaming deployment patterns, you can choose the right approach for your use case. Combining these patterns with proper versioning and A/B testing enables robust MLOps practices that deliver reliable ML-powered insights.
