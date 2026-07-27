---
title: "Databricks ML: End-to-End Machine Learning on the Lakehouse"
author: Michael John Peña
draft: false
date: 2022-03-15
tags:
  - Azure
  - Databricks
  - Machine Learning
  - MLOps
  - AI

---

I wrote "Databricks ML: End-to-End Machine Learning on the Lakehouse" to share practical, production-minded guidance on this topic.

## Databricks ML Components

The ML platform includes:
- **Feature Store**: Centralized feature management
- **AutoML**: Automated model training and selection
- **MLflow**: Experiment tracking and model registry
- **Model Serving**: Real-time inference endpoints
- **ML Runtime**: Optimized environment with pre-installed libraries

## Setting Up the ML Environment

```python
# ML Runtime includes popular libraries pre-installed:
# - TensorFlow, PyTorch, Keras
# - scikit-learn, XGBoost, LightGBM
# - MLflow, Hyperopt, SHAP
# - pandas, numpy, scipy

# Import commonly used libraries
import mlflow
import mlflow.sklearn
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score, roc_auc_score
import pandas as pd
import numpy as np

# Set up MLflow experiment
mlflow.set_experiment("/Users/username/customer-churn")
```

## Data Preparation with Spark

```python
# Load and prepare training data
from pyspark.sql.functions import col, when, datediff, current_date

# Read from Delta Lake
df = spark.read.table("production.customers.user_activity")

# Feature engineering at scale
features_df = df.groupBy("user_id").agg(
    F.count("*").alias("total_actions"),
    F.sum(when(col("action_type") == "purchase", 1).otherwise(0)).alias("purchase_count"),
    F.avg("session_duration_minutes").alias("avg_session_duration"),
    F.max("activity_date").alias("last_activity_date")
).withColumn(
    "days_since_last_activity",
    datediff(current_date(), col("last_activity_date"))
)

# Add label (churned if no activity in 30 days)
labeled_df = features_df.withColumn(
    "churned",
    when(col("days_since_last_activity") > 30, 1).otherwise(0)
)

# Convert to pandas for sklearn (or use Spark ML for larger datasets)
pdf = labeled_df.toPandas()
```

## Training with MLflow Tracking

```python
# Define features and target
feature_columns = ["total_actions", "purchase_count", "avg_session_duration", "days_since_last_activity"]
X = pdf[feature_columns]
y = pdf["churned"]

# Split data
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Train with MLflow tracking
with mlflow.start_run(run_name="random_forest_baseline") as run:
    # Log parameters
    params = {
        "n_estimators": 100,
        "max_depth": 10,
        "min_samples_split": 5,
        "random_state": 42
    }
    mlflow.log_params(params)

    # Train model
    model = RandomForestClassifier(**params)
    model.fit(X_train, y_train)

    # Predict and evaluate
    y_pred = model.predict(X_test)
    y_pred_proba = model.predict_proba(X_test)[:, 1]

    # Log metrics
    metrics = {
        "accuracy": accuracy_score(y_test, y_pred),
        "f1_score": f1_score(y_test, y_pred),
        "roc_auc": roc_auc_score(y_test, y_pred_proba)
    }
    mlflow.log_metrics(metrics)

    # Log feature importance
    importance_df = pd.DataFrame({
        "feature": feature_columns,
        "importance": model.feature_importances_
    }).sort_values("importance", ascending=False)
    mlflow.log_table(importance_df, "feature_importance.json")

    # Log model
    mlflow.sklearn.log_model(
        model,
        "model",
        registered_model_name="customer-churn-classifier"
    )

    print(f"Run ID: {run.info.run_id}")
    print(f"Metrics: {metrics}")
```

## Hyperparameter Tuning with Hyperopt

```python
from hyperopt import fmin, tpe, hp, SparkTrials, STATUS_OK
from hyperopt.pyll import scope

# Define search space
search_space = {
    "n_estimators": scope.int(hp.quniform("n_estimators", 50, 300, 50)),
    "max_depth": scope.int(hp.quniform("max_depth", 3, 15, 1)),
    "min_samples_split": scope.int(hp.quniform("min_samples_split", 2, 20, 1)),
    "min_samples_leaf": scope.int(hp.quniform("min_samples_leaf", 1, 10, 1))
}

def objective(params):
    with mlflow.start_run(nested=True):
        # Log parameters
        mlflow.log_params(params)

        # Train model
        model = RandomForestClassifier(**params, random_state=42, n_jobs=-1)
        model.fit(X_train, y_train)

        # Evaluate
        y_pred_proba = model.predict_proba(X_test)[:, 1]
        roc_auc = roc_auc_score(y_test, y_pred_proba)

        mlflow.log_metric("roc_auc", roc_auc)

        # Hyperopt minimizes, so negate the metric
        return {"loss": -roc_auc, "status": STATUS_OK}

# Run distributed hyperparameter search
with mlflow.start_run(run_name="hyperparameter_tuning"):
    spark_trials = SparkTrials(parallelism=4)

    best_params = fmin(
        fn=objective,
        space=search_space,
        algo=tpe.suggest,
        max_evals=20,
        trials=spark_trials
    )

    print(f"Best parameters: {best_params}")
```

## Using Spark ML for Scale

```python
from pyspark.ml.feature import VectorAssembler, StandardScaler
from pyspark.ml.classification import RandomForestClassifier as SparkRF
from pyspark.ml import Pipeline
from pyspark.ml.evaluation import BinaryClassificationEvaluator

# Prepare features
assembler = VectorAssembler(
    inputCols=feature_columns,
    outputCol="features_raw"
)

scaler = StandardScaler(
    inputCol="features_raw",
    outputCol="features"
)

# Create Spark ML model
rf = SparkRF(
    labelCol="churned",
    featuresCol="features",
    numTrees=100,
    maxDepth=10
)

# Build pipeline
pipeline = Pipeline(stages=[assembler, scaler, rf])

# Split data
train_df, test_df = labeled_df.randomSplit([0.8, 0.2], seed=42)

# Train
with mlflow.start_run(run_name="spark_ml_model"):
    model = pipeline.fit(train_df)

    # Evaluate
    predictions = model.transform(test_df)
    evaluator = BinaryClassificationEvaluator(
        labelCol="churned",
        metricName="areaUnderROC"
    )
    roc_auc = evaluator.evaluate(predictions)

    mlflow.log_metric("roc_auc", roc_auc)
    mlflow.spark.log_model(model, "spark_model")

    print(f"Spark ML ROC AUC: {roc_auc}")
```

## Deep Learning with PyTorch

```python
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

# Define neural network
class ChurnPredictor(nn.Module):
    def __init__(self, input_dim):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Linear(input_dim, 64),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(32, 1),
            nn.Sigmoid()
        )

    def forward(self, x):
        return self.layers(x)

# Prepare data
X_train_tensor = torch.FloatTensor(X_train.values)
y_train_tensor = torch.FloatTensor(y_train.values)
X_test_tensor = torch.FloatTensor(X_test.values)
y_test_tensor = torch.FloatTensor(y_test.values)

train_dataset = TensorDataset(X_train_tensor, y_train_tensor)
train_loader = DataLoader(train_dataset, batch_size=32, shuffle=True)

# Train with MLflow
with mlflow.start_run(run_name="pytorch_model"):
    model = ChurnPredictor(len(feature_columns))
    criterion = nn.BCELoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)

    epochs = 50
    for epoch in range(epochs):
        model.train()
        total_loss = 0
        for X_batch, y_batch in train_loader:
            optimizer.zero_grad()
            outputs = model(X_batch).squeeze()
            loss = criterion(outputs, y_batch)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()

        # Log epoch metrics
        mlflow.log_metric("train_loss", total_loss / len(train_loader), step=epoch)

    # Evaluate
    model.eval()
    with torch.no_grad():
        y_pred_proba = model(X_test_tensor).squeeze().numpy()
        y_pred = (y_pred_proba > 0.5).astype(int)

    roc_auc = roc_auc_score(y_test, y_pred_proba)
    mlflow.log_metric("roc_auc", roc_auc)

    # Log model
    mlflow.pytorch.log_model(model, "pytorch_model")
```

## Model Registry

```python
from mlflow.tracking import MlflowClient

client = MlflowClient()

# Register a model
model_uri = f"runs:/{run.info.run_id}/model"
model_details = mlflow.register_model(model_uri, "customer-churn-classifier")

# Transition to staging
client.transition_model_version_stage(
    name="customer-churn-classifier",
    version=model_details.version,
    stage="Staging"
)

# Add model description
client.update_model_version(
    name="customer-churn-classifier",
    version=model_details.version,
    description="Random Forest model for customer churn prediction. Trained on 6 months of user activity data."
)

# Promote to production after validation
client.transition_model_version_stage(
    name="customer-churn-classifier",
    version=model_details.version,
    stage="Production"
)
```

## Model Comparison

```python
# Compare multiple runs
experiment = mlflow.get_experiment_by_name("/Users/username/customer-churn")
runs = mlflow.search_runs(
    experiment_ids=[experiment.experiment_id],
    order_by=["metrics.roc_auc DESC"]
)

# Display comparison
comparison_df = runs[["run_id", "params.n_estimators", "params.max_depth",
                      "metrics.roc_auc", "metrics.f1_score", "metrics.accuracy"]]
display(comparison_df)

# Get the best model
best_run = runs.iloc[0]
best_model = mlflow.sklearn.load_model(f"runs:/{best_run['run_id']}/model")
```

## Batch Inference

```python
# Load production model
production_model = mlflow.sklearn.load_model("models:/customer-churn-classifier/Production")

# Score new data
new_customers_df = spark.read.table("production.customers.new_users")
new_features = prepare_features(new_customers_df)  # Same feature engineering

# Apply model as UDF for distributed scoring
predict_udf = mlflow.pyfunc.spark_udf(spark, "models:/customer-churn-classifier/Production")

scored_df = new_features.withColumn(
    "churn_probability",
    predict_udf(*feature_columns)
)

# Save predictions
scored_df.write.mode("overwrite").saveAsTable("analytics.predictions.churn_scores")
```

## Conclusion

Databricks ML provides all the tools needed for production machine learning:
- Seamless integration with lakehouse data
- Distributed training with Spark ML
- Experiment tracking with MLflow
- Hyperparameter tuning at scale
- Model registry for versioning and deployment

The unified platform eliminates the friction of moving between data engineering and data science, enabling faster iteration and more reliable models.

## Resources

- [Databricks ML Documentation](https://docs.databricks.com/machine-learning/index.html)
- [MLflow Documentation](https://mlflow.org/docs/latest/index.html)
- [Spark ML Guide](https://spark.apache.org/docs/latest/ml-guide.html)

