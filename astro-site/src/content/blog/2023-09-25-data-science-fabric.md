---
title: "Data Science Workflows in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2023-09-25
description: "Building end-to-end data science workflows using Microsoft Fabric's integrated capabilities."
tags:
  - Microsoft Fabric
  - Data Science
  - Machine Learning
  - Python
  - Spark

---

I wrote "Data Science Workflows in Microsoft Fabric" to share practical, production-minded guidance on this topic.

## Introduction

Microsoft Fabric provides a unified environment for data science workflows, from data exploration to model deployment. This post covers practical patterns for building data science solutions in Fabric.

## Data Science Environment Setup

### Notebook Configuration

```python
# Fabric Data Science Notebook Setup
from dataclasses import dataclass
from typing import List, Dict, Optional

@dataclass
class NotebookEnvironment:
    name: str
    spark_pool: str
    libraries: List[str]
    spark_config: Dict[str, str]

def configure_spark_session():
    """Configure Spark session for data science workloads"""
    from pyspark.sql import SparkSession

    spark = (SparkSession.builder
        .appName("DataScience")
        .config("spark.sql.adaptive.enabled", "true")
        .config("spark.sql.adaptive.coalescePartitions.enabled", "true")
        .config("spark.serializer", "org.apache.spark.serializer.KryoSerializer")
        .config("spark.kryoserializer.buffer.max", "1024m")
        .getOrCreate()
    )

    return spark

def install_libraries():
    """Install additional libraries for data science"""
    # In Fabric notebooks, use %pip magic
    libraries = [
        "scikit-learn>=1.0",
        "xgboost>=1.7",
        "lightgbm>=3.3",
        "optuna>=3.0",
        "shap>=0.41",
        "mlflow>=2.0"
    ]

    install_commands = [f"%pip install {lib}" for lib in libraries]
    return install_commands

# Common imports for data science
"""
# Standard imports
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

# ML imports
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

# Spark ML
from pyspark.ml import Pipeline
from pyspark.ml.feature import VectorAssembler, StringIndexer, StandardScaler as SparkScaler
from pyspark.ml.classification import RandomForestClassifier, LogisticRegression
from pyspark.ml.regression import LinearRegression, GBTRegressor
from pyspark.ml.evaluation import BinaryClassificationEvaluator, RegressionEvaluator
"""
```

### Exploratory Data Analysis

```python
class FabricEDA:
    """Exploratory Data Analysis utilities for Fabric"""

    def __init__(self, spark):
        self.spark = spark

    def profile_dataset(self, table_name: str) -> Dict:
        """Generate comprehensive data profile"""
        df = self.spark.table(table_name)

        profile = {
            "table_name": table_name,
            "row_count": df.count(),
            "column_count": len(df.columns),
            "columns": {}
        }

        for col in df.columns:
            col_type = str(df.schema[col].dataType)
            col_profile = {
                "data_type": col_type,
                "null_count": df.filter(df[col].isNull()).count(),
                "distinct_count": df.select(col).distinct().count()
            }

            if "Integer" in col_type or "Double" in col_type or "Float" in col_type:
                stats = df.select(col).summary().collect()
                col_profile["statistics"] = {
                    row["summary"]: row[col] for row in stats
                }

            profile["columns"][col] = col_profile

        return profile

    def generate_correlation_matrix(self, table_name: str, numeric_columns: List[str]):
        """Generate correlation matrix for numeric columns"""
        df = self.spark.table(table_name).select(numeric_columns)

        # Convert to Pandas for correlation calculation
        pdf = df.toPandas()
        correlation = pdf.corr()

        return correlation

    def create_visualization_code(self, analysis_type: str, columns: List[str]) -> str:
        """Generate visualization code"""
        visualizations = {
            "distribution": f'''
import matplotlib.pyplot as plt
import seaborn as sns

fig, axes = plt.subplots(1, len({columns}), figsize=(5*len({columns}), 4))
for i, col in enumerate({columns}):
    sns.histplot(data=pdf, x=col, ax=axes[i] if len({columns}) > 1 else axes)
    axes[i].set_title(f'Distribution of {{col}}')
plt.tight_layout()
plt.show()
''',
            "boxplot": f'''
import matplotlib.pyplot as plt
import seaborn as sns

fig, ax = plt.subplots(figsize=(10, 6))
pdf[{columns}].boxplot(ax=ax)
ax.set_title('Box Plot Comparison')
plt.xticks(rotation=45)
plt.show()
''',
            "correlation_heatmap": f'''
import matplotlib.pyplot as plt
import seaborn as sns

correlation = pdf[{columns}].corr()
fig, ax = plt.subplots(figsize=(10, 8))
sns.heatmap(correlation, annot=True, cmap='coolwarm', ax=ax)
ax.set_title('Correlation Heatmap')
plt.show()
''',
            "pairplot": f'''
import seaborn as sns

sns.pairplot(pdf[{columns}])
plt.suptitle('Pair Plot', y=1.02)
plt.show()
'''
        }

        return visualizations.get(analysis_type, visualizations["distribution"])

    def detect_outliers(self, table_name: str, column: str, method: str = "iqr") -> Dict:
        """Detect outliers in a column"""
        from pyspark.sql import functions as F

        df = self.spark.table(table_name)

        if method == "iqr":
            quantiles = df.approxQuantile(column, [0.25, 0.75], 0.05)
            q1, q3 = quantiles[0], quantiles[1]
            iqr = q3 - q1
            lower = q1 - 1.5 * iqr
            upper = q3 + 1.5 * iqr

            outliers_df = df.filter((F.col(column) < lower) | (F.col(column) > upper))

            return {
                "method": "IQR",
                "lower_bound": lower,
                "upper_bound": upper,
                "outlier_count": outliers_df.count(),
                "outlier_percentage": outliers_df.count() / df.count() * 100
            }

        elif method == "zscore":
            stats = df.select(
                F.mean(column).alias("mean"),
                F.stddev(column).alias("std")
            ).collect()[0]

            mean_val, std_val = stats["mean"], stats["std"]
            threshold = 3

            outliers_df = df.filter(
                F.abs((F.col(column) - mean_val) / std_val) > threshold
            )

            return {
                "method": "Z-Score",
                "threshold": threshold,
                "outlier_count": outliers_df.count(),
                "outlier_percentage": outliers_df.count() / df.count() * 100
            }

# Usage in Fabric notebook
"""
eda = FabricEDA(spark)

# Profile dataset
profile = eda.profile_dataset("sales_data")
print(f"Rows: {profile['row_count']}, Columns: {profile['column_count']}")

# Check for outliers
outliers = eda.detect_outliers("sales_data", "amount", method="iqr")
print(f"Found {outliers['outlier_count']} outliers ({outliers['outlier_percentage']:.1f}%)")
"""
```

### Feature Engineering Pipeline

```python
class FeatureEngineeringPipeline:
    """Feature engineering pipeline for Fabric"""

    def __init__(self, spark):
        self.spark = spark
        self.transformations = []

    def add_date_features(self, date_column: str) -> 'FeatureEngineeringPipeline':
        """Extract features from date column"""
        self.transformations.append({
            "type": "date_features",
            "column": date_column,
            "features": ["year", "month", "day", "dayofweek", "quarter"]
        })
        return self

    def add_aggregations(
        self,
        group_columns: List[str],
        agg_column: str,
        agg_functions: List[str]
    ) -> 'FeatureEngineeringPipeline':
        """Add aggregation features"""
        self.transformations.append({
            "type": "aggregation",
            "group_by": group_columns,
            "column": agg_column,
            "functions": agg_functions
        })
        return self

    def add_lag_features(
        self,
        column: str,
        partition_by: List[str],
        order_by: str,
        lags: List[int]
    ) -> 'FeatureEngineeringPipeline':
        """Add lag features for time series"""
        self.transformations.append({
            "type": "lag",
            "column": column,
            "partition_by": partition_by,
            "order_by": order_by,
            "lags": lags
        })
        return self

    def add_window_features(
        self,
        column: str,
        partition_by: List[str],
        order_by: str,
        window_sizes: List[int],
        functions: List[str]
    ) -> 'FeatureEngineeringPipeline':
        """Add rolling window features"""
        self.transformations.append({
            "type": "window",
            "column": column,
            "partition_by": partition_by,
            "order_by": order_by,
            "window_sizes": window_sizes,
            "functions": functions
        })
        return self

    def generate_code(self, input_table: str, output_table: str) -> str:
        """Generate PySpark code for feature engineering"""
        code_lines = [
            "from pyspark.sql import functions as F",
            "from pyspark.sql.window import Window",
            "",
            f'df = spark.table("{input_table}")',
            ""
        ]

        for transform in self.transformations:
            if transform["type"] == "date_features":
                col = transform["column"]
                for feature in transform["features"]:
                    code_lines.append(
                        f'df = df.withColumn("{col}_{feature}", F.{feature}(F.col("{col}")))'
                    )

            elif transform["type"] == "aggregation":
                group_cols = transform["group_by"]
                agg_col = transform["column"]
                for func in transform["functions"]:
                    alias = f"{agg_col}_{func}"
                    code_lines.append(f'''
# Aggregation: {func} of {agg_col} by {group_cols}
agg_df = df.groupBy({group_cols}).agg(F.{func}("{agg_col}").alias("{alias}"))
df = df.join(agg_df, {group_cols}, "left")
''')

            elif transform["type"] == "lag":
                col = transform["column"]
                window = f'Window.partitionBy({transform["partition_by"]}).orderBy("{transform["order_by"]}")'
                for lag in transform["lags"]:
                    code_lines.append(
                        f'df = df.withColumn("{col}_lag_{lag}", F.lag("{col}", {lag}).over({window}))'
                    )

            elif transform["type"] == "window":
                col = transform["column"]
                for size in transform["window_sizes"]:
                    window = f'Window.partitionBy({transform["partition_by"]}).orderBy("{transform["order_by"]}").rowsBetween(-{size}, 0)'
                    for func in transform["functions"]:
                        code_lines.append(
                            f'df = df.withColumn("{col}_{func}_{size}", F.{func}("{col}").over({window}))'
                        )

        code_lines.extend([
            "",
            f'# Save feature engineered data',
            f'df.write.format("delta").mode("overwrite").saveAsTable("{output_table}")'
        ])

        return "\n".join(code_lines)

# Usage
pipeline = FeatureEngineeringPipeline(spark)

code = (pipeline
    .add_date_features("order_date")
    .add_lag_features("sales_amount", ["customer_id"], "order_date", [1, 7, 30])
    .add_window_features("sales_amount", ["customer_id"], "order_date", [7, 30], ["avg", "sum"])
    .add_aggregations(["customer_id"], "sales_amount", ["sum", "avg", "count"])
    .generate_code("raw_orders", "order_features")
)

print(code)
```

### Model Training Workflow

```python
class ModelTrainingWorkflow:
    """End-to-end model training workflow"""

    def __init__(self, spark, experiment_name: str):
        self.spark = spark
        self.experiment_name = experiment_name

    def generate_training_code(
        self,
        feature_table: str,
        target_column: str,
        feature_columns: List[str],
        model_type: str = "classification"
    ) -> str:
        """Generate complete training code"""
        return f'''
# Model Training Workflow
import mlflow
from pyspark.ml import Pipeline
from pyspark.ml.feature import VectorAssembler, StringIndexer
from pyspark.ml.classification import RandomForestClassifier, LogisticRegression, GBTClassifier
from pyspark.ml.evaluation import BinaryClassificationEvaluator, MulticlassClassificationEvaluator
from pyspark.ml.tuning import ParamGridBuilder, CrossValidator

# Set experiment
mlflow.set_experiment("{self.experiment_name}")

# Load data
df = spark.table("{feature_table}")

# Prepare features
feature_cols = {feature_columns}
assembler = VectorAssembler(inputCols=feature_cols, outputCol="features")

# Index target for classification
indexer = StringIndexer(inputCol="{target_column}", outputCol="label")

# Split data
train_df, test_df = df.randomSplit([0.8, 0.2], seed=42)

# Define models to compare
models = {{
    "RandomForest": RandomForestClassifier(featuresCol="features", labelCol="label"),
    "LogisticRegression": LogisticRegression(featuresCol="features", labelCol="label"),
    "GBT": GBTClassifier(featuresCol="features", labelCol="label")
}}

# Evaluator
evaluator = BinaryClassificationEvaluator(labelCol="label", metricName="areaUnderROC")

# Train and evaluate each model
best_model = None
best_score = 0

for model_name, model in models.items():
    with mlflow.start_run(run_name=model_name):
        # Create pipeline
        pipeline = Pipeline(stages=[indexer, assembler, model])

        # Train
        fitted_model = pipeline.fit(train_df)

        # Evaluate
        predictions = fitted_model.transform(test_df)
        auc = evaluator.evaluate(predictions)

        # Log metrics
        mlflow.log_metric("auc", auc)
        mlflow.log_param("model_type", model_name)
        mlflow.spark.log_model(fitted_model, "model")

        print(f"{{model_name}} AUC: {{auc:.4f}}")

        if auc > best_score:
            best_score = auc
            best_model = fitted_model

print(f"\\nBest model AUC: {{best_score:.4f}}")

# Save best model
mlflow.spark.save_model(best_model, "best_model")
'''

    def generate_hyperparameter_tuning_code(
        self,
        model_class: str,
        param_grid: Dict
    ) -> str:
        """Generate hyperparameter tuning code"""
        param_grid_code = "\n".join([
            f"    .addGrid(model.{param}, {values})"
            for param, values in param_grid.items()
        ])

        return f'''
# Hyperparameter Tuning
from pyspark.ml.tuning import ParamGridBuilder, CrossValidator

model = {model_class}(featuresCol="features", labelCol="label")

# Define parameter grid
param_grid = (ParamGridBuilder()
{param_grid_code}
    .build()
)

# Cross validator
cv = CrossValidator(
    estimator=pipeline,
    estimatorParamMaps=param_grid,
    evaluator=evaluator,
    numFolds=5,
    parallelism=4
)

# Fit
cv_model = cv.fit(train_df)

# Best parameters
best_params = cv_model.bestModel.stages[-1].extractParamMap()
print("Best parameters:", best_params)

# Best score
print(f"Best CV score: {{max(cv_model.avgMetrics):.4f}}")
'''

# Usage
workflow = ModelTrainingWorkflow(spark, "customer_churn_prediction")

training_code = workflow.generate_training_code(
    feature_table="customer_features",
    target_column="churned",
    feature_columns=["tenure", "monthly_charges", "total_charges", "num_services"],
    model_type="classification"
)

print(training_code)
```

## Conclusion

Microsoft Fabric provides a comprehensive environment for data science workflows. By leveraging its integrated notebooks, Spark capabilities, and MLflow integration, data scientists can build end-to-end solutions from exploration to deployment within a unified platform.

