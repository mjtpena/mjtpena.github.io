---
title: "Synapse Data Science in Microsoft Fabric: ML Made Simple"
description: "Fabric's Data Science experience integrates seamlessly with the rest of the platform, allowing you to go from raw data in Lakehouse to deployed models in a…"
author: Michael John Peña
draft: false
date: 2023-05-07
tags:
  - Microsoft Fabric
  - Data Science
  - Machine Learning
  - MLflow
  - PySpark
---

## Data Science Workload Overview

Fabric's Data Science experience includes:
- **Notebooks**: Interactive ML development with Python/PySpark
- **Experiments**: MLflow-based experiment tracking
- **Models**: Model registry and versioning
- **ML Models**: Deployed models for scoring

```
┌─────────────────────────────────────────────────────┐
│             Synapse Data Science                     │
├─────────────────────────────────────────────────────┤
│  ┌───────────┐  ┌───────────┐  ┌───────────┐       │
│  │ Notebooks │  │Experiments│  │  Models   │       │
│  │  (Dev)    │  │ (Track)   │  │ (Deploy)  │       │
│  └───────────┘  └───────────┘  └───────────┘       │
│         │              │              │             │
│         └──────────────┼──────────────┘             │
│                        ▼                            │
│  ┌─────────────────────────────────────────┐       │
│  │               MLflow                     │       │
│  │     (Tracking, Registry, Serving)        │       │
│  └─────────────────────────────────────────┘       │
│                        │                            │
│                        ▼                            │
│  ┌─────────────────────────────────────────┐       │
│  │              Lakehouse                   │       │
│  │         (Features & Datasets)            │       │
│  └─────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────┘
```

## End-to-End ML Workflow

### Step 1: Data Preparation

```python
# Cell 1: Load and prepare data
from pyspark.sql.functions import col, when, year, month, datediff, current_date

# Read from Lakehouse
customers_df = spark.read.format("delta").table("customers")
orders_df = spark.read.format("delta").table("orders")

# Feature engineering
features_df = orders_df \
    .groupBy("customer_id") \
    .agg(
        F.count("order_id").alias("order_count"),
        F.sum("amount").alias("total_spend"),
        F.avg("amount").alias("avg_order_value"),
        F.max("order_date").alias("last_order_date"),
        F.min("order_date").alias("first_order_date")
    )

# Join with customer attributes
ml_data = customers_df \
    .join(features_df, "customer_id", "left") \
    .withColumn("days_since_last_order",
        datediff(current_date(), col("last_order_date"))) \
    .withColumn("customer_tenure_days",
        datediff(current_date(), col("first_order_date"))) \
    .withColumn("churn",
        when(col("days_since_last_order") > 90, 1).otherwise(0))

# Fill nulls for customers with no orders
ml_data = ml_data.fillna({
    "order_count": 0,
    "total_spend": 0,
    "avg_order_value": 0,
    "days_since_last_order": 999,
    "customer_tenure_days": 0
})

display(ml_data.limit(10))
```

### Step 2: Convert to Pandas for ML

```python
# Cell 2: Prepare for modeling
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

# Convert to pandas (for medium-sized datasets)
pdf = ml_data.select(
    "customer_id",
    "order_count",
    "total_spend",
    "avg_order_value",
    "days_since_last_order",
    "customer_tenure_days",
    "churn"
).toPandas()

# Define features and target
feature_columns = [
    "order_count", "total_spend", "avg_order_value",
    "days_since_last_order", "customer_tenure_days"
]
X = pdf[feature_columns]
y = pdf["churn"]

# Train-test split
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

# Scale features
scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)
X_test_scaled = scaler.transform(X_test)

print(f"Training samples: {len(X_train)}")
print(f"Test samples: {len(X_test)}")
print(f"Churn rate: {y.mean():.2%}")
```

### Step 3: Train Model with MLflow Tracking

```python
# Cell 3: Train and track with MLflow
import mlflow
import mlflow.sklearn
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, roc_auc_score, classification_report
)

# Set experiment
mlflow.set_experiment("customer_churn_prediction")

def train_and_log_model(model, model_name, X_train, X_test, y_train, y_test):
    with mlflow.start_run(run_name=model_name):
        # Train model
        model.fit(X_train, y_train)

        # Predictions
        y_pred = model.predict(X_test)
        y_prob = model.predict_proba(X_test)[:, 1]

        # Calculate metrics
        metrics = {
            "accuracy": accuracy_score(y_test, y_pred),
            "precision": precision_score(y_test, y_pred),
            "recall": recall_score(y_test, y_pred),
            "f1": f1_score(y_test, y_pred),
            "auc_roc": roc_auc_score(y_test, y_prob)
        }

        # Log parameters
        mlflow.log_params(model.get_params())

        # Log metrics
        mlflow.log_metrics(metrics)

        # Log model
        mlflow.sklearn.log_model(model, model_name)

        print(f"\n{model_name} Results:")
        print(f"  Accuracy: {metrics['accuracy']:.4f}")
        print(f"  Precision: {metrics['precision']:.4f}")
        print(f"  Recall: {metrics['recall']:.4f}")
        print(f"  F1 Score: {metrics['f1']:.4f}")
        print(f"  AUC-ROC: {metrics['auc_roc']:.4f}")

        return metrics

# Train multiple models
models = {
    "LogisticRegression": LogisticRegression(max_iter=1000, random_state=42),
    "RandomForest": RandomForestClassifier(n_estimators=100, random_state=42),
    "GradientBoosting": GradientBoostingClassifier(n_estimators=100, random_state=42)
}

results = {}
for name, model in models.items():
    results[name] = train_and_log_model(
        model, name, X_train_scaled, X_test_scaled, y_train, y_test
    )
```

### Step 4: Hyperparameter Tuning

```python
# Cell 4: Hyperparameter tuning with MLflow
from sklearn.model_selection import GridSearchCV
import numpy as np

# Define parameter grid
param_grid = {
    "n_estimators": [50, 100, 200],
    "max_depth": [3, 5, 10, None],
    "min_samples_split": [2, 5, 10],
    "min_samples_leaf": [1, 2, 4]
}

# Run grid search with MLflow tracking
with mlflow.start_run(run_name="RandomForest_GridSearch"):
    rf = RandomForestClassifier(random_state=42)

    grid_search = GridSearchCV(
        rf, param_grid, cv=5, scoring="roc_auc", n_jobs=-1, verbose=1
    )
    grid_search.fit(X_train_scaled, y_train)

    # Log best parameters
    mlflow.log_params(grid_search.best_params_)

    # Evaluate best model
    best_model = grid_search.best_estimator_
    y_pred = best_model.predict(X_test_scaled)
    y_prob = best_model.predict_proba(X_test_scaled)[:, 1]

    metrics = {
        "best_cv_score": grid_search.best_score_,
        "test_accuracy": accuracy_score(y_test, y_pred),
        "test_auc_roc": roc_auc_score(y_test, y_prob)
    }
    mlflow.log_metrics(metrics)

    # Log best model
    mlflow.sklearn.log_model(best_model, "best_random_forest")

    print(f"Best parameters: {grid_search.best_params_}")
    print(f"Best CV AUC-ROC: {grid_search.best_score_:.4f}")
    print(f"Test AUC-ROC: {metrics['test_auc_roc']:.4f}")
```

### Step 5: Register Model

```python
# Cell 5: Register the best model
from mlflow.tracking import MlflowClient

client = MlflowClient()

# Get the best run
experiment = mlflow.get_experiment_by_name("customer_churn_prediction")
runs = mlflow.search_runs(
    experiment_ids=[experiment.experiment_id],
    order_by=["metrics.test_auc_roc DESC"],
    max_results=1
)

best_run_id = runs.iloc[0]["run_id"]
print(f"Best run ID: {best_run_id}")

# Register model
model_uri = f"runs:/{best_run_id}/best_random_forest"
model_name = "customer_churn_model"

registered_model = mlflow.register_model(model_uri, model_name)
print(f"Registered model version: {registered_model.version}")

# Transition to production
client.transition_model_version_stage(
    name=model_name,
    version=registered_model.version,
    stage="Production"
)
print(f"Model transitioned to Production stage")
```

### Step 6: Batch Scoring

```python
# Cell 6: Score new data
import mlflow.pyfunc

# Load production model
model = mlflow.pyfunc.load_model(f"models:/{model_name}/Production")

# Prepare new data for scoring
new_customers_df = spark.read.format("delta").table("new_customers_features")
new_pdf = new_customers_df.select(feature_columns).toPandas()

# Scale and predict
new_scaled = scaler.transform(new_pdf)
predictions = model.predict(new_scaled)
probabilities = model.predict_proba(new_scaled)[:, 1]

# Add predictions back to DataFrame
new_pdf["churn_prediction"] = predictions
new_pdf["churn_probability"] = probabilities

# Convert back to Spark and save
predictions_df = spark.createDataFrame(new_pdf)
predictions_df.write \
    .format("delta") \
    .mode("overwrite") \
    .saveAsTable("customer_churn_predictions")

print(f"Scored {len(new_pdf)} customers")
print(f"Predicted churners: {predictions.sum()} ({predictions.mean():.2%})")
```

## Distributed ML with Spark MLlib

For large-scale data, use Spark MLlib:

```python
# Cell 7: Spark MLlib for large datasets
from pyspark.ml.feature import VectorAssembler, StandardScaler
from pyspark.ml.classification import RandomForestClassifier as SparkRF
from pyspark.ml.evaluation import BinaryClassificationEvaluator
from pyspark.ml import Pipeline

# Prepare features
assembler = VectorAssembler(inputCols=feature_columns, outputCol="features_raw")
scaler = StandardScaler(inputCol="features_raw", outputCol="features")
rf = SparkRF(featuresCol="features", labelCol="churn", numTrees=100)

# Create pipeline
pipeline = Pipeline(stages=[assembler, scaler, rf])

# Split data
train_df, test_df = ml_data.randomSplit([0.8, 0.2], seed=42)

# Train
model = pipeline.fit(train_df)

# Evaluate
predictions = model.transform(test_df)
evaluator = BinaryClassificationEvaluator(
    labelCol="churn", rawPredictionCol="rawPrediction", metricName="areaUnderROC"
)
auc = evaluator.evaluate(predictions)
print(f"AUC-ROC: {auc:.4f}")
```

Fabric's Data Science experience integrates seamlessly with the rest of the platform, allowing you to go from raw data in Lakehouse to deployed models in a unified workflow. Tomorrow, I will cover Synapse Data Warehouse for SQL-based analytics.

## Resources

- [Data Science in Fabric](https://learn.microsoft.com/en-us/fabric/data-science/)
- [MLflow in Fabric](https://learn.microsoft.com/en-us/fabric/data-science/mlflow-autologging)
- [Model Scoring](https://learn.microsoft.com/en-us/fabric/data-science/model-scoring)
