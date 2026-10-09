---
title: "The PREDICT Function in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2023-09-28
description: "Using the PREDICT function to apply machine learning models directly in Microsoft Fabric for seamless predictions."
tags:
  - Microsoft Fabric
  - Machine Learning
  - PREDICT
  - MLOps
  - Data Science
---

## Introduction

The PREDICT function in Microsoft Fabric enables direct application of machine learning models to data in Spark SQL queries and T-SQL. This capability bridges the gap between model training and deployment, allowing predictions to be generated at query time.

## Understanding the PREDICT Function

### Core Concepts

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum

class ModelFormat(Enum):
    MLFLOW = "mlflow"
    ONNX = "onnx"
    SPARK_ML = "spark_ml"

@dataclass
class PredictConfig:
    model_name: str
    model_version: str
    input_columns: List[str]
    output_column: str
    model_format: ModelFormat = ModelFormat.MLFLOW

class PredictFunctionGuide:
    """Guide for using PREDICT function in Fabric"""

    def __init__(self):
        self.supported_contexts = [
            "Spark SQL",
            "Spark DataFrame API",
            "T-SQL in Warehouse",
            "Lakehouse SQL endpoint"
        ]

    def explain_predict_function(self) -> Dict:
        """Explain PREDICT function capabilities"""
        return {
            "what_it_does": "Applies a trained ML model to data at query time",
            "benefits": [
                "No need to export data for scoring",
                "Real-time predictions in queries",
                "Easy integration with existing queries",
                "Leverages MLflow model registry"
            ],
            "supported_models": [
                "MLflow models (Python, Spark ML)",
                "ONNX models",
                "Models from AutoML"
            ],
            "use_cases": [
                "Batch scoring in data pipelines",
                "Real-time feature enrichment",
                "Dashboard predictions",
                "What-if analysis"
            ]
        }
```

### Using PREDICT in Spark SQL

```python
class SparkPredictOperations:
    """PREDICT operations in Spark"""

    def generate_basic_predict_code(
        self,
        model_uri: str,
        input_table: str,
        feature_columns: List[str],
        output_table: str
    ) -> str:
        """Generate basic PREDICT usage code"""
        features_str = ", ".join(feature_columns)

        return f'''
# Using PREDICT in Spark SQL
from pyspark.sql import SparkSession

spark = SparkSession.builder.getOrCreate()

# Method 1: Using SQL
spark.sql("""
    SELECT
        *,
        PREDICT('{model_uri}', {features_str}) as prediction
    FROM {input_table}
""").write.format("delta").saveAsTable("{output_table}")

# Method 2: Using DataFrame API with MLflow
import mlflow
from pyspark.sql import functions as F

# Load model
model = mlflow.pyfunc.spark_udf(spark, model_uri="{model_uri}")

# Read input data
df = spark.table("{input_table}")

# Apply predictions
predictions = df.withColumn(
    "prediction",
    model(*[F.col(c) for c in {feature_columns}])
)

# Save results
predictions.write.format("delta").mode("overwrite").saveAsTable("{output_table}")

print(f"Predictions saved to {output_table}")
predictions.show(5)
'''

    def generate_batch_scoring_pipeline(
        self,
        model_name: str,
        source_table: str,
        target_table: str,
        feature_columns: List[str],
        id_column: str
    ) -> str:
        """Generate batch scoring pipeline code"""
        return f'''
# Batch Scoring Pipeline with PREDICT
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from datetime import datetime
import mlflow

spark = SparkSession.builder.getOrCreate()

# Configuration
model_name = "{model_name}"
model_stage = "Production"

# Get production model URI
client = mlflow.tracking.MlflowClient()
model_version_info = client.get_latest_versions(model_name, stages=[model_stage])[0]
model_uri = f"models:/{model_name}/{model_stage}"

print(f"Using model: {{model_uri}}")
print(f"Version: {{model_version_info.version}}")

# Load model as UDF
predict_udf = mlflow.pyfunc.spark_udf(spark, model_uri)

# Read source data
source_df = spark.table("{source_table}")
print(f"Source rows: {{source_df.count()}}")

# Apply predictions
features = {feature_columns}
predictions_df = (source_df
    .withColumn("prediction", predict_udf(*[F.col(c) for c in features]))
    .withColumn("model_version", F.lit(model_version_info.version))
    .withColumn("scored_at", F.current_timestamp())
)

# Save predictions
(predictions_df
    .select("{id_column}", "prediction", "model_version", "scored_at", *features)
    .write
    .format("delta")
    .mode("overwrite")
    .option("mergeSchema", "true")
    .saveAsTable("{target_table}")
)

print(f"Scored {{predictions_df.count()}} rows")
print(f"Results saved to {target_table}")

# Show sample predictions
predictions_df.select("{id_column}", *features[:3], "prediction").show(10)
'''

    def generate_incremental_scoring(
        self,
        model_uri: str,
        source_table: str,
        predictions_table: str,
        timestamp_column: str
    ) -> str:
        """Generate incremental scoring code"""
        return f'''
# Incremental Scoring with PREDICT
from pyspark.sql import functions as F
from delta.tables import DeltaTable
import mlflow

spark = SparkSession.builder.getOrCreate()

# Load model
predict_udf = mlflow.pyfunc.spark_udf(spark, model_uri="{model_uri}")

# Get last scored timestamp
try:
    last_scored = spark.sql("""
        SELECT MAX(scored_at) as last_scored
        FROM {predictions_table}
    """).collect()[0]["last_scored"]
except:
    last_scored = None

print(f"Last scored: {{last_scored}}")

# Read new data since last scoring
if last_scored:
    new_data = spark.table("{source_table}").filter(
        F.col("{timestamp_column}") > last_scored
    )
else:
    new_data = spark.table("{source_table}")

new_count = new_data.count()
print(f"New records to score: {{new_count}}")

if new_count > 0:
    # Score new data
    new_predictions = (new_data
        .withColumn("prediction", predict_udf(*new_data.columns))
        .withColumn("scored_at", F.current_timestamp())
    )

    # Append to predictions table
    new_predictions.write.format("delta").mode("append").saveAsTable("{predictions_table}")

    print(f"Scored and saved {{new_count}} new predictions")
else:
    print("No new data to score")
'''

# Usage
predict_ops = SparkPredictOperations()

basic_code = predict_ops.generate_basic_predict_code(
    model_uri="models:/churn_model/Production",
    input_table="customer_features",
    feature_columns=["tenure", "monthly_charges", "total_charges"],
    output_table="churn_predictions"
)
print(basic_code)
```

### Using PREDICT in T-SQL (Warehouse)

```python
class TSQLPredictOperations:
    """PREDICT operations in Fabric Warehouse T-SQL"""

    def generate_tsql_predict(
        self,
        model_name: str,
        source_table: str,
        feature_columns: List[str]
    ) -> str:
        """Generate T-SQL PREDICT statement"""
        columns_str = ", ".join(feature_columns)

        return f'''
-- Using PREDICT in Fabric Warehouse T-SQL
-- First, ensure model is registered in the workspace

-- Basic PREDICT syntax
SELECT
    id,
    {columns_str},
    PREDICT('{model_name}', {columns_str}) AS prediction
FROM {source_table};

-- With model version
SELECT
    id,
    {columns_str},
    PREDICT('{model_name}', {columns_str}, 'version=1') AS prediction
FROM {source_table};

-- Create prediction table
SELECT
    id,
    {columns_str},
    PREDICT('{model_name}', {columns_str}) AS prediction,
    GETDATE() AS scored_at
INTO predictions_{source_table}
FROM {source_table};

-- Update existing predictions
UPDATE p
SET
    prediction = PREDICT('{model_name}', {columns_str}),
    scored_at = GETDATE()
FROM predictions_{source_table} p
JOIN {source_table} s ON p.id = s.id
WHERE s.updated_at > p.scored_at;
'''

    def generate_realtime_scoring_view(
        self,
        model_name: str,
        source_table: str,
        feature_columns: List[str]
    ) -> str:
        """Generate view with real-time predictions"""
        columns_str = ", ".join(feature_columns)

        return f'''
-- Create View with Real-time Predictions
CREATE OR ALTER VIEW vw_{source_table}_with_predictions
AS
SELECT
    s.*,
    PREDICT('{model_name}', {columns_str}) AS predicted_value,
    CASE
        WHEN PREDICT('{model_name}', {columns_str}) > 0.5 THEN 'High Risk'
        WHEN PREDICT('{model_name}', {columns_str}) > 0.3 THEN 'Medium Risk'
        ELSE 'Low Risk'
    END AS risk_category
FROM {source_table} s;

-- Query the view
SELECT *
FROM vw_{source_table}_with_predictions
WHERE risk_category = 'High Risk'
ORDER BY predicted_value DESC;
'''

# Usage
tsql_ops = TSQLPredictOperations()

tsql_code = tsql_ops.generate_tsql_predict(
    model_name="CustomerChurnModel",
    source_table="dbo.Customers",
    feature_columns=["tenure", "monthly_charges", "contract_type"]
)
print(tsql_code)
```

### Model Registration for PREDICT

```python
class ModelRegistrationForPredict:
    """Register models for use with PREDICT"""

    def generate_registration_code(
        self,
        model_name: str,
        model_path: str,
        signature: Dict
    ) -> str:
        """Generate model registration code"""
        return f'''
# Register Model for PREDICT Function
import mlflow
from mlflow.models.signature import ModelSignature
from mlflow.types.schema import Schema, ColSpec

# Define model signature
input_schema = Schema([
    ColSpec("double", "tenure"),
    ColSpec("double", "monthly_charges"),
    ColSpec("double", "total_charges"),
    ColSpec("string", "contract_type")
])

output_schema = Schema([
    ColSpec("double", "prediction")
])

signature = ModelSignature(inputs=input_schema, outputs=output_schema)

# Log model with signature
with mlflow.start_run() as run:
    mlflow.sklearn.log_model(
        model,
        artifact_path="model",
        signature=signature,
        registered_model_name="{model_name}"
    )

# Transition to production
client = mlflow.tracking.MlflowClient()
client.transition_model_version_stage(
    name="{model_name}",
    version=1,
    stage="Production"
)

print(f"Model {model_name} registered and promoted to Production")
'''

    def generate_onnx_registration(
        self,
        model_name: str,
        sklearn_model_var: str
    ) -> str:
        """Generate ONNX model registration for better performance"""
        return f'''
# Convert and Register as ONNX for Better Performance
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
import onnx
import mlflow

# Define input shape
initial_type = [('float_input', FloatTensorType([None, num_features]))]

# Convert to ONNX
onnx_model = convert_sklearn({sklearn_model_var}, initial_types=initial_type)

# Save ONNX model
onnx_path = "model.onnx"
onnx.save_model(onnx_model, onnx_path)

# Register with MLflow
with mlflow.start_run():
    mlflow.onnx.log_model(
        onnx_model,
        artifact_path="onnx_model",
        registered_model_name="{model_name}_onnx"
    )

print(f"ONNX model registered as {model_name}_onnx")
'''

# Usage
registration = ModelRegistrationForPredict()

reg_code = registration.generate_registration_code(
    model_name="ChurnPredictor",
    model_path="./trained_model",
    signature={"inputs": ["tenure", "charges"], "outputs": ["prediction"]}
)
print(reg_code)
```

### Performance Optimization

```python
class PredictPerformanceOptimization:
    """Optimize PREDICT function performance"""

    def optimization_tips(self) -> str:
        """Generate optimization tips code"""
        return '''
# PREDICT Function Performance Optimization

# 1. Batch predictions instead of row-by-row
# Bad: Looping through rows
# Good: Apply to entire DataFrame at once
predictions = df.withColumn("prediction", predict_udf(*feature_cols))

# 2. Use ONNX models for faster inference
# ONNX provides better CPU performance
model_uri = "models:/my_model_onnx/Production"

# 3. Partition data for parallel processing
predictions = (df
    .repartition(100)  # Adjust based on cluster size
    .withColumn("prediction", predict_udf(*feature_cols))
)

# 4. Cache input data if used multiple times
df.cache()
predictions = df.withColumn("prediction", predict_udf(*feature_cols))
df.unpersist()

# 5. Use broadcast for small lookup tables
from pyspark.sql.functions import broadcast
df_with_lookup = df.join(broadcast(small_lookup_df), "key")

# 6. Pre-compute feature engineering
# Do heavy transformations before PREDICT
features_df = compute_features(df)
features_df.cache()
predictions = features_df.withColumn("prediction", predict_udf(*feature_cols))

# 7. Monitor prediction latency
import time
start = time.time()
predictions.count()  # Force computation
print(f"Scoring time: {time.time() - start:.2f} seconds")

# 8. Use Delta Lake optimizations
predictions.write.format("delta") \\
    .option("optimizeWrite", "true") \\
    .option("autoCompact", "true") \\
    .saveAsTable("predictions")
'''

    def generate_monitoring_code(self) -> str:
        """Generate prediction monitoring code"""
        return '''
# Prediction Monitoring
from pyspark.sql import functions as F

# Monitor prediction distribution
prediction_stats = predictions.agg(
    F.count("prediction").alias("total_predictions"),
    F.mean("prediction").alias("mean_prediction"),
    F.stddev("prediction").alias("std_prediction"),
    F.min("prediction").alias("min_prediction"),
    F.max("prediction").alias("max_prediction")
).collect()[0]

print("Prediction Statistics:")
print(f"  Count: {prediction_stats['total_predictions']}")
print(f"  Mean: {prediction_stats['mean_prediction']:.4f}")
print(f"  Std: {prediction_stats['std_prediction']:.4f}")
print(f"  Range: [{prediction_stats['min_prediction']:.4f}, {prediction_stats['max_prediction']:.4f}]")

# Check for data drift
historical_mean = 0.35  # From training data
current_mean = prediction_stats['mean_prediction']
drift = abs(current_mean - historical_mean) / historical_mean

if drift > 0.1:
    print(f"WARNING: Prediction drift detected: {drift:.1%}")

# Log metrics
import mlflow
mlflow.log_metric("prediction_mean", current_mean)
mlflow.log_metric("prediction_drift", drift)
'''

# Usage
perf = PredictPerformanceOptimization()
print(perf.optimization_tips())
```

## Conclusion

The PREDICT function in Microsoft Fabric provides a seamless way to apply machine learning models directly within your analytics workflows. By integrating predictions into Spark SQL and T-SQL queries, you can deliver ML-powered insights without complex deployment infrastructure, making it easier to operationalize your machine learning models at scale.
