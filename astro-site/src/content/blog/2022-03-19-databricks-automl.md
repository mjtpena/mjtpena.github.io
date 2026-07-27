---
title: "AutoML in Databricks: Automated Machine Learning Made Simple"
author: Michael John Peña
draft: false
date: 2022-03-19
tags:
  - Azure
  - Databricks
  - AutoML
  - Machine Learning
  - AI

---

I wrote "AutoML in Databricks: Automated Machine Learning Made Simple" to share practical, production-minded guidance on this topic.

## What AutoML Provides

Databricks AutoML automatically:
- Prepares and preprocesses data
- Engineers features
- Selects algorithms
- Tunes hyperparameters
- Evaluates and compares models
- Generates reproducible notebooks

## Running AutoML via UI

The simplest way to use AutoML:

1. Navigate to Machine Learning > Experiments > Create AutoML Experiment
2. Select your training dataset (table or DataFrame)
3. Choose the problem type (classification, regression, forecasting)
4. Select the target column
5. Configure advanced options (timeout, metrics, etc.)
6. Start the experiment

## Running AutoML via API

```python
from databricks import automl

# Classification
summary = automl.classify(
    dataset=spark.table("production.training.customer_churn"),
    target_col="churned",
    primary_metric="roc_auc",
    timeout_minutes=60,
    max_trials=20
)

# Access results
print(f"Best model: {summary.best_trial}")
print(f"Best metric: {summary.best_trial.metrics['test_roc_auc_score']}")

# Get the best model
best_model = summary.best_trial.load_model()
```

### Regression

```python
# Regression example
summary = automl.regress(
    dataset=spark.table("production.training.house_prices"),
    target_col="price",
    primary_metric="rmse",
    timeout_minutes=60,
    exclude_cols=["id", "address"]  # Columns to ignore
)

print(f"Best RMSE: {summary.best_trial.metrics['test_rmse']}")
```

### Time Series Forecasting

```python
# Forecasting example
summary = automl.forecast(
    dataset=spark.table("production.training.daily_sales"),
    target_col="revenue",
    time_col="date",
    frequency="D",
    horizon=30,  # Predict 30 days ahead
    primary_metric="smape",
    timeout_minutes=120
)

# Get forecast
forecast_model = summary.best_trial.load_model()
future_dates = create_future_dataframe(30)
predictions = forecast_model.predict(future_dates)
```

## Configuration Options

```python
summary = automl.classify(
    dataset=training_df,
    target_col="label",

    # Evaluation metric
    primary_metric="f1",  # Options: f1, log_loss, precision, recall, accuracy, roc_auc

    # Time limits
    timeout_minutes=120,
    max_trials=50,

    # Feature handling
    exclude_cols=["id", "timestamp"],  # Exclude from training
    exclude_frameworks=["lightgbm"],   # Exclude specific algorithms

    # Data split
    split_col="split",  # Custom train/val/test split column

    # Experiment tracking
    experiment_dir="/Users/username/automl-experiments",
    experiment_name="customer-churn-v2",

    # Compute
    exclude_cols=["large_text_column"]  # Exclude expensive features
)
```

## Understanding AutoML Output

```python
# Summary object contains all experiment information
summary = automl.classify(...)

# Best trial information
best = summary.best_trial
print(f"Run ID: {best.mlflow_run_id}")
print(f"Model type: {best.model_description}")
print(f"Metrics: {best.metrics}")
print(f"Parameters: {best.params}")

# All trials
for trial in summary.trials:
    print(f"{trial.model_description}: {trial.metrics['test_roc_auc_score']:.4f}")

# Generated notebooks
print(f"Data exploration notebook: {summary.experiment.data_exploration_notebook}")
print(f"Best model notebook: {best.notebook_path}")
```

## Using Generated Notebooks

AutoML generates editable notebooks:

```python
# The generated notebook contains:
# 1. Data loading and preprocessing
# 2. Feature engineering steps
# 3. Model training code
# 4. Hyperparameter settings
# 5. Evaluation metrics

# Open the notebook to customize:
# - Modify feature engineering
# - Add custom preprocessing
# - Adjust hyperparameters
# - Add cross-validation
# - Implement custom metrics

# The notebook is your starting point for production models
```

## Customizing AutoML

### Custom Feature Engineering

```python
# Prepare features before AutoML
from pyspark.sql.functions import col, datediff, current_date, when

prepared_df = (
    raw_df
    # Add custom features
    .withColumn("days_since_signup", datediff(current_date(), col("signup_date")))
    .withColumn("is_premium", when(col("subscription_type") == "premium", 1).otherwise(0))
    # Convert types
    .withColumn("age", col("age").cast("double"))
    # Drop unnecessary columns
    .drop("raw_timestamp", "user_id")
)

# Run AutoML on prepared data
summary = automl.classify(
    dataset=prepared_df,
    target_col="churned"
)
```

### Handling Imbalanced Data

```python
# Option 1: Stratified sampling before AutoML
from pyspark.sql.functions import col

positive_class = df.filter(col("label") == 1)
negative_class = df.filter(col("label") == 0)

# Undersample majority class
ratio = positive_class.count() / negative_class.count()
balanced_df = positive_class.union(
    negative_class.sample(ratio)
)

# Option 2: Use class weights in the generated notebook
# AutoML generates code that you can modify:
# model = XGBClassifier(scale_pos_weight=class_weight_ratio)
```

## Comparing AutoML with Manual Training

```python
# Run AutoML
automl_summary = automl.classify(
    dataset=training_df,
    target_col="label",
    timeout_minutes=60
)

# Manual training for comparison
import mlflow
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import cross_val_score

with mlflow.start_run(run_name="manual_gbt"):
    model = GradientBoostingClassifier(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.1
    )

    scores = cross_val_score(model, X_train, y_train, cv=5, scoring='roc_auc')
    model.fit(X_train, y_train)

    mlflow.log_param("n_estimators", 200)
    mlflow.log_metric("cv_auc", scores.mean())
    mlflow.sklearn.log_model(model, "model")

# Compare results
print(f"AutoML best AUC: {automl_summary.best_trial.metrics['test_roc_auc_score']:.4f}")
print(f"Manual GBT AUC: {scores.mean():.4f}")
```

## Production Deployment

```python
# Register the best AutoML model
import mlflow

model_uri = f"runs:/{automl_summary.best_trial.mlflow_run_id}/model"
model_details = mlflow.register_model(
    model_uri,
    "customer-churn-automl"
)

# Promote to production
from mlflow.tracking import MlflowClient
client = MlflowClient()

client.transition_model_version_stage(
    name="customer-churn-automl",
    version=model_details.version,
    stage="Production"
)

# Deploy to serving endpoint
# The model is ready for Model Serving
```

## AutoML for Different Use Cases

### Customer Segmentation

```python
# Regression for customer lifetime value
summary = automl.regress(
    dataset=spark.table("analytics.customer_features"),
    target_col="lifetime_value",
    primary_metric="r2",
    timeout_minutes=90
)
```

### Demand Forecasting

```python
# Multi-series forecasting
summary = automl.forecast(
    dataset=spark.table("sales.daily_by_product"),
    target_col="units_sold",
    time_col="date",
    identity_col="product_id",  # Separate forecast per product
    frequency="D",
    horizon=14,
    timeout_minutes=180
)
```

### Anomaly Detection

```python
# Binary classification for anomalies
# Label your anomalies first
labeled_data = (
    raw_data
    .withColumn("is_anomaly",
        when((col("value") > upper_bound) | (col("value") < lower_bound), 1)
        .otherwise(0)
    )
)

summary = automl.classify(
    dataset=labeled_data,
    target_col="is_anomaly",
    primary_metric="recall"  # Prioritize finding anomalies
)
```

## Best Practices

### Data Preparation

```python
# Ensure data quality before AutoML
def prepare_for_automl(df, target_col):
    # Remove nulls in target
    df = df.filter(col(target_col).isNotNull())

    # Handle missing values
    numeric_cols = [f.name for f in df.schema.fields if f.dataType in ['DoubleType', 'IntegerType']]
    for c in numeric_cols:
        df = df.fillna({c: df.select(c).agg({c: 'mean'}).collect()[0][0]})

    # Limit cardinality of categorical features
    for c in categorical_cols:
        top_categories = df.groupBy(c).count().orderBy('count', ascending=False).limit(50)
        df = df.join(top_categories.select(c), c, 'left')
        df = df.withColumn(c, when(col(c).isNull(), 'Other').otherwise(col(c)))

    return df
```

### Iterative Improvement

```python
# Use AutoML as a baseline, then iterate
# 1. Run initial AutoML
baseline = automl.classify(dataset=df, target_col="label", timeout_minutes=30)

# 2. Analyze results
print(f"Baseline AUC: {baseline.best_trial.metrics['test_roc_auc_score']}")

# 3. Review the generated notebook for insights
# 4. Add domain-specific features
# 5. Run AutoML again with improved data
# 6. Compare and iterate
```

## Conclusion

Databricks AutoML provides an excellent starting point for ML projects:
- Rapid prototyping and baseline models
- Automatic feature engineering insights
- Best practice implementations
- Reproducible, editable notebooks

Use AutoML to quickly establish baselines, then iterate using the generated notebooks as templates for production models.

## Resources

- [Databricks AutoML Documentation](https://docs.databricks.com/machine-learning/automl/index.html)
- [AutoML Python API](https://docs.databricks.com/machine-learning/automl/python-api.html)
- [AutoML Best Practices](https://docs.databricks.com/machine-learning/automl/best-practices.html)

