---
title: "AI Integration in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2023-09-24
description: "Exploring AI and machine learning capabilities within Microsoft Fabric for intelligent analytics."
tags:
  - Microsoft Fabric
  - AI
  - Machine Learning
  - Data Science
  - MLOps
---

## Introduction

Microsoft Fabric integrates AI capabilities throughout the analytics platform, from automated insights to custom ML model deployment. This post explores how to leverage AI features in Fabric for intelligent data analytics.

## AI Capabilities in Fabric

### AutoML in Fabric

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum

class MLTaskType(Enum):
    CLASSIFICATION = "classification"
    REGRESSION = "regression"
    FORECASTING = "forecasting"
    CLUSTERING = "clustering"
    ANOMALY_DETECTION = "anomaly_detection"

@dataclass
class AutoMLConfig:
    task_type: MLTaskType
    target_column: str
    feature_columns: List[str]
    time_budget_minutes: int = 60
    primary_metric: str = "accuracy"
    enable_ensemble: bool = True
    cross_validation_folds: int = 5

@dataclass
class AutoMLResult:
    best_model_name: str
    best_score: float
    all_models: List[Dict]
    feature_importance: Dict[str, float]
    model_path: str

class FabricAutoML:
    """AutoML capabilities in Fabric"""

    def __init__(self):
        self.supported_metrics = {
            MLTaskType.CLASSIFICATION: ["accuracy", "AUC_weighted", "f1_score_weighted"],
            MLTaskType.REGRESSION: ["r2_score", "mean_absolute_error", "root_mean_squared_error"],
            MLTaskType.FORECASTING: ["normalized_mean_absolute_error", "r2_score"]
        }

    def create_automl_experiment(
        self,
        config: AutoMLConfig,
        training_data_path: str
    ) -> str:
        """Create AutoML experiment configuration"""
        experiment_config = {
            "task": config.task_type.value,
            "target_column": config.target_column,
            "feature_columns": config.feature_columns,
            "primary_metric": config.primary_metric,
            "time_budget": config.time_budget_minutes * 60,
            "enable_ensemble": config.enable_ensemble,
            "cv_folds": config.cross_validation_folds,
            "training_data": training_data_path,
            "compute": {
                "type": "spark",
                "instance_type": "standard"
            }
        }

        return f"""
# AutoML Experiment Configuration
from synapse.ml.automl import AutoML, AutoMLConfig

# Load training data
df = spark.read.format("delta").load("{training_data_path}")

# Configure AutoML
automl_config = AutoMLConfig(
    task="{config.task_type.value}",
    primary_metric="{config.primary_metric}",
    training_data=df,
    label_column_name="{config.target_column}",
    n_cross_validations={config.cross_validation_folds},
    enable_ensemble={str(config.enable_ensemble).lower()},
    experiment_timeout_minutes={config.time_budget_minutes}
)

# Run AutoML
automl = AutoML()
best_run, fitted_model = automl.fit(automl_config)

# Get results
print(f"Best model: {{best_run.properties['model_name']}}")
print(f"Best score: {{best_run.properties['{config.primary_metric}']}}")
"""

    def generate_feature_engineering_code(
        self,
        df_name: str,
        column_types: Dict[str, str]
    ) -> str:
        """Generate feature engineering code"""
        return f'''
from pyspark.sql import functions as F
from pyspark.ml.feature import (
    StringIndexer, OneHotEncoder, VectorAssembler,
    StandardScaler, Imputer
)

# Feature engineering for {df_name}
df = spark.table("{df_name}")

# Handle missing values for numeric columns
numeric_cols = {[c for c, t in column_types.items() if t in ['int', 'float', 'double']]}
imputer = Imputer(inputCols=numeric_cols, outputCols=[f"{{c}}_imputed" for c in numeric_cols])
df = imputer.fit(df).transform(df)

# Encode categorical columns
categorical_cols = {[c for c, t in column_types.items() if t == 'string']}
indexers = [StringIndexer(inputCol=c, outputCol=f"{{c}}_indexed") for c in categorical_cols]
encoders = [OneHotEncoder(inputCol=f"{{c}}_indexed", outputCol=f"{{c}}_encoded") for c in categorical_cols]

# Create feature vector
feature_cols = [f"{{c}}_imputed" for c in numeric_cols] + [f"{{c}}_encoded" for c in categorical_cols]
assembler = VectorAssembler(inputCols=feature_cols, outputCol="features")

# Scale features
scaler = StandardScaler(inputCol="features", outputCol="scaled_features")

# Build pipeline
from pyspark.ml import Pipeline
pipeline = Pipeline(stages=indexers + encoders + [assembler, scaler])
prepared_df = pipeline.fit(df).transform(df)
'''

    def create_model_registry_entry(
        self,
        model_name: str,
        model_version: str,
        metrics: Dict[str, float],
        tags: Dict[str, str]
    ) -> Dict:
        """Create model registry entry"""
        return {
            "name": model_name,
            "version": model_version,
            "metrics": metrics,
            "tags": tags,
            "stage": "staging",
            "registered_at": "timestamp",
            "artifact_path": f"models/{model_name}/{model_version}"
        }

# Usage
automl = FabricAutoML()

config = AutoMLConfig(
    task_type=MLTaskType.CLASSIFICATION,
    target_column="churn",
    feature_columns=["age", "tenure", "monthly_charges", "contract_type"],
    time_budget_minutes=30,
    primary_metric="AUC_weighted"
)

experiment_code = automl.create_automl_experiment(config, "Tables/customer_data")
print(experiment_code)
```

### Synapse ML Integration

```python
class SynapseMLOperations:
    """Synapse ML operations in Fabric"""

    def __init__(self):
        pass

    def generate_cognitive_services_code(
        self,
        service_type: str,
        input_column: str,
        output_column: str
    ) -> str:
        """Generate code for Cognitive Services integration"""
        services = {
            "sentiment": '''
from synapse.ml.cognitive import TextSentiment

sentiment = TextSentiment()
    .setSubscriptionKey(cognitive_key)
    .setLocation("eastus")
    .setTextCol("{input_col}")
    .setOutputCol("{output_col}")
    .setErrorCol("error")

result = sentiment.transform(df)
''',
            "translation": '''
from synapse.ml.cognitive import Translate

translate = Translate()
    .setSubscriptionKey(cognitive_key)
    .setLocation("eastus")
    .setTextCol("{input_col}")
    .setToLanguage(["es", "fr", "de"])
    .setOutputCol("{output_col}")

result = translate.transform(df)
''',
            "ocr": '''
from synapse.ml.cognitive import OCR

ocr = OCR()
    .setSubscriptionKey(cognitive_key)
    .setLocation("eastus")
    .setImageUrlCol("{input_col}")
    .setOutputCol("{output_col}")

result = ocr.transform(df)
''',
            "ner": '''
from synapse.ml.cognitive import NER

ner = NER()
    .setSubscriptionKey(cognitive_key)
    .setLocation("eastus")
    .setTextCol("{input_col}")
    .setOutputCol("{output_col}")

result = ner.transform(df)
'''
        }

        template = services.get(service_type, services["sentiment"])
        return template.format(input_col=input_column, output_col=output_column)

    def generate_lightgbm_code(
        self,
        task_type: str,
        features_col: str,
        label_col: str
    ) -> str:
        """Generate LightGBM model code"""
        if task_type == "classification":
            return f'''
from synapse.ml.lightgbm import LightGBMClassifier

lgbm = LightGBMClassifier(
    featuresCol="{features_col}",
    labelCol="{label_col}",
    numLeaves=31,
    numIterations=100,
    learningRate=0.1,
    featureFraction=0.8
)

model = lgbm.fit(train_df)
predictions = model.transform(test_df)

# Evaluate
from pyspark.ml.evaluation import MulticlassClassificationEvaluator
evaluator = MulticlassClassificationEvaluator(labelCol="{label_col}", metricName="accuracy")
accuracy = evaluator.evaluate(predictions)
print(f"Accuracy: {{accuracy}}")
'''
        else:  # regression
            return f'''
from synapse.ml.lightgbm import LightGBMRegressor

lgbm = LightGBMRegressor(
    featuresCol="{features_col}",
    labelCol="{label_col}",
    numLeaves=31,
    numIterations=100,
    learningRate=0.1
)

model = lgbm.fit(train_df)
predictions = model.transform(test_df)

# Evaluate
from pyspark.ml.evaluation import RegressionEvaluator
evaluator = RegressionEvaluator(labelCol="{label_col}", metricName="rmse")
rmse = evaluator.evaluate(predictions)
print(f"RMSE: {{rmse}}")
'''

    def generate_deep_learning_code(
        self,
        model_type: str,
        input_shape: tuple
    ) -> str:
        """Generate deep learning code using Horovod"""
        return f'''
from synapse.ml.dl import DeepVisionClassifier
from pyspark.ml import Pipeline

# Using pre-trained model with transfer learning
deep_vision = DeepVisionClassifier(
    backbone="resnet50",
    head="linear",
    numClasses=10,
    batchSize=32,
    epochs=10,
    learningRate=0.001
)

# Create pipeline
pipeline = Pipeline(stages=[deep_vision])
model = pipeline.fit(train_df)

# Predict
predictions = model.transform(test_df)
'''

# Usage
synapse_ml = SynapseMLOperations()

# Generate sentiment analysis code
sentiment_code = synapse_ml.generate_cognitive_services_code(
    "sentiment",
    "review_text",
    "sentiment_result"
)
print(sentiment_code)

# Generate LightGBM code
lgbm_code = synapse_ml.generate_lightgbm_code(
    "classification",
    "features",
    "label"
)
print(lgbm_code)
```

### ML Model Deployment

```python
class FabricMLOps:
    """MLOps capabilities in Fabric"""

    def __init__(self, workspace_name: str):
        self.workspace = workspace_name

    def generate_model_scoring_endpoint(
        self,
        model_name: str,
        model_version: str
    ) -> str:
        """Generate code for model scoring endpoint"""
        return f'''
# Model Scoring Endpoint
import mlflow
from mlflow.tracking import MlflowClient

# Load model from registry
client = MlflowClient()
model_uri = f"models:/{model_name}/{model_version}"
model = mlflow.pyfunc.load_model(model_uri)

# Scoring function
def score(input_data):
    """
    Score input data using the loaded model

    Args:
        input_data: pandas DataFrame or dict

    Returns:
        predictions
    """
    import pandas as pd

    if isinstance(input_data, dict):
        input_data = pd.DataFrame([input_data])

    predictions = model.predict(input_data)
    return predictions.tolist()

# Example usage
sample_input = {{
    "feature1": 1.0,
    "feature2": "category_a",
    "feature3": 100
}}

result = score(sample_input)
print(f"Prediction: {{result}}")
'''

    def generate_batch_inference_pipeline(
        self,
        model_name: str,
        input_table: str,
        output_table: str
    ) -> str:
        """Generate batch inference pipeline"""
        return f'''
# Batch Inference Pipeline
from pyspark.sql import SparkSession
import mlflow

# Initialize
spark = SparkSession.builder.getOrCreate()

# Load model
model_uri = "models:/{model_name}/Production"
model = mlflow.pyfunc.spark_udf(spark, model_uri)

# Load input data
input_df = spark.table("{input_table}")

# Apply model
predictions_df = input_df.withColumn(
    "prediction",
    model(*[input_df[c] for c in input_df.columns])
)

# Save predictions
predictions_df.write.format("delta").mode("overwrite").saveAsTable("{output_table}")

print(f"Batch inference complete. Results saved to {output_table}")
'''

    def generate_model_monitoring_code(self) -> str:
        """Generate model monitoring code"""
        return '''
# Model Monitoring
from pyspark.sql import functions as F
from datetime import datetime, timedelta

def monitor_model_performance(
    predictions_table: str,
    actuals_table: str,
    model_name: str,
    date_column: str
):
    """
    Monitor model performance over time
    """
    # Load data
    predictions = spark.table(predictions_table)
    actuals = spark.table(actuals_table)

    # Join predictions with actuals
    joined = predictions.join(actuals, "id")

    # Calculate daily metrics
    daily_metrics = (joined
        .withColumn("date", F.to_date(date_column))
        .groupBy("date")
        .agg(
            F.avg(F.when(F.col("prediction") == F.col("actual"), 1).otherwise(0)).alias("accuracy"),
            F.count("*").alias("prediction_count")
        )
        .orderBy("date")
    )

    # Check for drift
    recent_accuracy = daily_metrics.filter(
        F.col("date") >= F.date_sub(F.current_date(), 7)
    ).agg(F.avg("accuracy")).collect()[0][0]

    baseline_accuracy = 0.85  # Set based on training performance

    if recent_accuracy < baseline_accuracy * 0.95:
        print(f"WARNING: Model performance degraded. Recent accuracy: {recent_accuracy:.2%}")
        # Trigger alert or retraining

    return daily_metrics

# Run monitoring
metrics = monitor_model_performance(
    "predictions_log",
    "ground_truth",
    "churn_model",
    "prediction_date"
)
metrics.show()
'''

# Usage
mlops = FabricMLOps("analytics_workspace")

# Generate scoring endpoint
scoring_code = mlops.generate_model_scoring_endpoint("churn_predictor", "1")
print(scoring_code)

# Generate batch inference
batch_code = mlops.generate_batch_inference_pipeline(
    "churn_predictor",
    "customer_features",
    "churn_predictions"
)
print(batch_code)
```

## Conclusion

Microsoft Fabric provides comprehensive AI and ML capabilities integrated directly into the analytics platform. From AutoML for rapid model development to Synapse ML for advanced deep learning and cognitive services integration, Fabric enables organizations to build intelligent analytics solutions without managing separate ML infrastructure.
