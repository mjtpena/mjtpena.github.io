---
title: "Spark ML Patterns for Production Systems"
description: "Spark ML provides battle-tested patterns for production machine learning. From feature engineering to model persistence, these patterns ensure reliable ML…"
author: Michael John Pena
draft: false
date: 2023-04-21
tags:
  - Spark
  - Machine Learning
  - MLOps
  - Data Engineering
  - Python
---

## Feature Engineering Patterns

```python
from pyspark.sql import SparkSession
from pyspark.ml import Pipeline
from pyspark.ml.feature import *
from pyspark.sql.functions import *

class FeatureEngineeringPipeline:
    """Production-ready feature engineering."""

    def __init__(self, spark: SparkSession):
        self.spark = spark

    def create_numeric_pipeline(
        self,
        numeric_cols: list,
        strategy: str = "mean"
    ) -> list:
        """Create numeric feature processing stages."""
        stages = []

        # Impute missing values
        imputer = Imputer(
            inputCols=numeric_cols,
            outputCols=[f"{c}_imputed" for c in numeric_cols],
            strategy=strategy
        )
        stages.append(imputer)

        # Scale features
        assembler = VectorAssembler(
            inputCols=[f"{c}_imputed" for c in numeric_cols],
            outputCol="numeric_assembled"
        )
        stages.append(assembler)

        scaler = StandardScaler(
            inputCol="numeric_assembled",
            outputCol="numeric_scaled",
            withMean=True,
            withStd=True
        )
        stages.append(scaler)

        return stages

    def create_categorical_pipeline(
        self,
        categorical_cols: list,
        max_categories: int = 100
    ) -> list:
        """Create categorical feature processing stages."""
        stages = []

        for col in categorical_cols:
            # String indexing
            indexer = StringIndexer(
                inputCol=col,
                outputCol=f"{col}_indexed",
                handleInvalid="keep",
                stringOrderType="frequencyDesc"
            )
            stages.append(indexer)

            # One-hot encoding (for low cardinality)
            encoder = OneHotEncoder(
                inputCols=[f"{col}_indexed"],
                outputCols=[f"{col}_encoded"],
                dropLast=True,
                handleInvalid="keep"
            )
            stages.append(encoder)

        return stages

    def create_text_pipeline(
        self,
        text_col: str,
        output_col: str = "text_features"
    ) -> list:
        """Create text feature processing stages."""
        stages = []

        # Tokenization
        tokenizer = Tokenizer(
            inputCol=text_col,
            outputCol=f"{text_col}_tokens"
        )
        stages.append(tokenizer)

        # Remove stop words
        remover = StopWordsRemover(
            inputCol=f"{text_col}_tokens",
            outputCol=f"{text_col}_filtered"
        )
        stages.append(remover)

        # TF-IDF
        hashing_tf = HashingTF(
            inputCol=f"{text_col}_filtered",
            outputCol=f"{text_col}_tf",
            numFeatures=10000
        )
        stages.append(hashing_tf)

        idf = IDF(
            inputCol=f"{text_col}_tf",
            outputCol=output_col,
            minDocFreq=5
        )
        stages.append(idf)

        return stages

    def create_datetime_features(self, df, datetime_col: str):
        """Extract datetime features."""
        return df.select(
            "*",
            year(datetime_col).alias(f"{datetime_col}_year"),
            month(datetime_col).alias(f"{datetime_col}_month"),
            dayofmonth(datetime_col).alias(f"{datetime_col}_day"),
            dayofweek(datetime_col).alias(f"{datetime_col}_dow"),
            hour(datetime_col).alias(f"{datetime_col}_hour"),
            weekofyear(datetime_col).alias(f"{datetime_col}_week"),
            quarter(datetime_col).alias(f"{datetime_col}_quarter")
        )
```

## Model Training Patterns

```python
from pyspark.ml.classification import *
from pyspark.ml.regression import *
from pyspark.ml.tuning import *
from pyspark.ml.evaluation import *

class ModelTrainingPipeline:
    """Production model training patterns."""

    def __init__(self, spark: SparkSession):
        self.spark = spark

    def train_with_cross_validation(
        self,
        df,
        estimator,
        param_grid,
        evaluator,
        num_folds: int = 5,
        parallelism: int = 4
    ):
        """Train model with cross-validation."""

        cv = CrossValidator(
            estimator=estimator,
            estimatorParamMaps=param_grid,
            evaluator=evaluator,
            numFolds=num_folds,
            parallelism=parallelism,
            collectSubModels=False
        )

        cv_model = cv.fit(df)

        return {
            "best_model": cv_model.bestModel,
            "avg_metrics": cv_model.avgMetrics,
            "std_metrics": cv_model.stdMetrics if hasattr(cv_model, "stdMetrics") else None
        }

    def train_with_train_validation_split(
        self,
        df,
        estimator,
        param_grid,
        evaluator,
        train_ratio: float = 0.8
    ):
        """Train with train-validation split (faster than CV)."""

        tvs = TrainValidationSplit(
            estimator=estimator,
            estimatorParamMaps=param_grid,
            evaluator=evaluator,
            trainRatio=train_ratio,
            parallelism=4
        )

        tvs_model = tvs.fit(df)

        return {
            "best_model": tvs_model.bestModel,
            "validation_metrics": tvs_model.validationMetrics
        }

    def create_gradient_boosted_trees(
        self,
        label_col: str,
        feature_col: str = "features"
    ):
        """Create GBT classifier with param grid."""

        gbt = GBTClassifier(
            featuresCol=feature_col,
            labelCol=label_col,
            predictionCol="prediction"
        )

        param_grid = ParamGridBuilder() \
            .addGrid(gbt.maxDepth, [3, 5, 7]) \
            .addGrid(gbt.maxIter, [10, 20, 50]) \
            .addGrid(gbt.stepSize, [0.05, 0.1, 0.2]) \
            .build()

        return gbt, param_grid

    def create_random_forest(
        self,
        label_col: str,
        feature_col: str = "features"
    ):
        """Create Random Forest with param grid."""

        rf = RandomForestClassifier(
            featuresCol=feature_col,
            labelCol=label_col,
            predictionCol="prediction"
        )

        param_grid = ParamGridBuilder() \
            .addGrid(rf.numTrees, [50, 100, 200]) \
            .addGrid(rf.maxDepth, [5, 10, 15]) \
            .addGrid(rf.featureSubsetStrategy, ["sqrt", "log2", "onethird"]) \
            .build()

        return rf, param_grid

    def create_logistic_regression(
        self,
        label_col: str,
        feature_col: str = "features"
    ):
        """Create Logistic Regression with param grid."""

        lr = LogisticRegression(
            featuresCol=feature_col,
            labelCol=label_col,
            predictionCol="prediction",
            probabilityCol="probability"
        )

        param_grid = ParamGridBuilder() \
            .addGrid(lr.regParam, [0.01, 0.1, 1.0]) \
            .addGrid(lr.elasticNetParam, [0.0, 0.5, 1.0]) \
            .addGrid(lr.maxIter, [50, 100, 200]) \
            .build()

        return lr, param_grid
```

## Model Evaluation Patterns

```python
class ModelEvaluation:
    """Comprehensive model evaluation."""

    def __init__(self, spark: SparkSession):
        self.spark = spark

    def evaluate_binary_classification(
        self,
        predictions,
        label_col: str,
        probability_col: str = "probability"
    ) -> dict:
        """Evaluate binary classification model."""

        from pyspark.ml.evaluation import BinaryClassificationEvaluator, MulticlassClassificationEvaluator

        binary_evaluator = BinaryClassificationEvaluator(
            labelCol=label_col,
            rawPredictionCol="rawPrediction"
        )

        multi_evaluator = MulticlassClassificationEvaluator(
            labelCol=label_col,
            predictionCol="prediction"
        )

        metrics = {
            "auc_roc": binary_evaluator.evaluate(
                predictions, {binary_evaluator.metricName: "areaUnderROC"}
            ),
            "auc_pr": binary_evaluator.evaluate(
                predictions, {binary_evaluator.metricName: "areaUnderPR"}
            ),
            "accuracy": multi_evaluator.evaluate(
                predictions, {multi_evaluator.metricName: "accuracy"}
            ),
            "f1": multi_evaluator.evaluate(
                predictions, {multi_evaluator.metricName: "f1"}
            ),
            "precision": multi_evaluator.evaluate(
                predictions, {multi_evaluator.metricName: "weightedPrecision"}
            ),
            "recall": multi_evaluator.evaluate(
                predictions, {multi_evaluator.metricName: "weightedRecall"}
            )
        }

        return metrics

    def compute_confusion_matrix(
        self,
        predictions,
        label_col: str,
        prediction_col: str = "prediction"
    ):
        """Compute confusion matrix."""

        confusion = predictions.groupBy(label_col, prediction_col).count()

        # Pivot to matrix format
        matrix = confusion.groupBy(label_col).pivot(prediction_col).sum("count")

        return matrix

    def evaluate_regression(
        self,
        predictions,
        label_col: str,
        prediction_col: str = "prediction"
    ) -> dict:
        """Evaluate regression model."""

        from pyspark.ml.evaluation import RegressionEvaluator

        evaluator = RegressionEvaluator(
            labelCol=label_col,
            predictionCol=prediction_col
        )

        return {
            "rmse": evaluator.evaluate(predictions, {evaluator.metricName: "rmse"}),
            "mse": evaluator.evaluate(predictions, {evaluator.metricName: "mse"}),
            "mae": evaluator.evaluate(predictions, {evaluator.metricName: "mae"}),
            "r2": evaluator.evaluate(predictions, {evaluator.metricName: "r2"})
        }

    def compute_lift_chart(
        self,
        predictions,
        label_col: str,
        probability_col: str = "probability",
        num_buckets: int = 10
    ):
        """Compute lift chart data."""

        from pyspark.sql.functions import col, ntile
        from pyspark.ml.functions import vector_to_array

        # Extract positive class probability
        with_prob = predictions.withColumn(
            "positive_prob",
            vector_to_array(col(probability_col))[1]
        )

        # Create deciles
        with_decile = with_prob.withColumn(
            "decile",
            ntile(num_buckets).over(Window.orderBy(col("positive_prob").desc()))
        )

        # Compute lift per decile
        lift_data = with_decile.groupBy("decile").agg(
            count("*").alias("count"),
            sum(col(label_col)).alias("positives"),
            avg("positive_prob").alias("avg_score")
        ).orderBy("decile")

        # Calculate cumulative lift
        total_positives = predictions.filter(col(label_col) == 1).count()
        total_count = predictions.count()
        base_rate = total_positives / total_count

        return lift_data.withColumn(
            "lift",
            (col("positives") / col("count")) / lit(base_rate)
        )
```

## Pipeline Persistence

```python
class PipelinePersistence:
    """Save and load ML pipelines."""

    def __init__(self, spark: SparkSession, base_path: str):
        self.spark = spark
        self.base_path = base_path

    def save_pipeline(
        self,
        pipeline_model,
        name: str,
        version: str,
        metadata: dict = None
    ):
        """Save pipeline with versioning."""
        import json
        from datetime import datetime

        path = f"{self.base_path}/{name}/v{version}"

        # Save model
        pipeline_model.write().overwrite().save(f"{path}/model")

        # Save metadata
        meta = {
            "name": name,
            "version": version,
            "saved_at": datetime.utcnow().isoformat(),
            "spark_version": self.spark.version,
            **(metadata or {})
        }

        self.spark.sparkContext.parallelize([json.dumps(meta)]).saveAsTextFile(
            f"{path}/metadata"
        )

        print(f"Pipeline saved to {path}")

    def load_pipeline(self, name: str, version: str = "latest"):
        """Load pipeline by name and version."""
        from pyspark.ml import PipelineModel

        if version == "latest":
            version = self._get_latest_version(name)

        path = f"{self.base_path}/{name}/v{version}"
        return PipelineModel.load(f"{path}/model")

    def _get_latest_version(self, name: str) -> str:
        """Get latest version of a pipeline."""
        import os

        path = f"{self.base_path}/{name}"
        versions = [d.name.replace("v", "") for d in os.listdir(path) if d.startswith("v")]
        return max(versions, key=lambda x: [int(p) for p in x.split(".")])

    def register_model(
        self,
        pipeline_model,
        name: str,
        metrics: dict,
        stage: str = "staging"
    ):
        """Register model for promotion workflow."""
        import mlflow
        from mlflow.spark import log_model

        with mlflow.start_run():
            # Log metrics
            for key, value in metrics.items():
                mlflow.log_metric(key, value)

            # Log model
            log_model(
                pipeline_model,
                artifact_path="model",
                registered_model_name=name
            )

            # Set stage
            client = mlflow.tracking.MlflowClient()
            latest_version = client.get_latest_versions(name)[0].version
            client.transition_model_version_stage(
                name=name,
                version=latest_version,
                stage=stage
            )
```

## Batch Inference Pattern

```python
class BatchInference:
    """Production batch inference patterns."""

    def __init__(self, spark: SparkSession):
        self.spark = spark

    def run_batch_inference(
        self,
        model,
        input_table: str,
        output_table: str,
        feature_pipeline = None,
        partition_cols: list = None
    ):
        """Run batch inference on a table."""

        # Read input
        df = self.spark.table(input_table)

        # Apply feature pipeline if provided
        if feature_pipeline:
            df = feature_pipeline.transform(df)

        # Run inference
        predictions = model.transform(df)

        # Select relevant columns
        output_cols = [c for c in predictions.columns
                      if c not in ["features", "rawPrediction", "probability"]]
        predictions = predictions.select(output_cols)

        # Write output
        if partition_cols:
            predictions.write \
                .mode("overwrite") \
                .partitionBy(partition_cols) \
                .saveAsTable(output_table)
        else:
            predictions.write \
                .mode("overwrite") \
                .saveAsTable(output_table)

        return predictions.count()

    def incremental_inference(
        self,
        model,
        source_table: str,
        target_table: str,
        watermark_col: str,
        last_watermark
    ):
        """Run inference on new data only."""

        # Read only new data
        df = self.spark.table(source_table) \
            .filter(col(watermark_col) > last_watermark)

        if df.count() == 0:
            print("No new data to process")
            return 0

        # Run inference
        predictions = model.transform(df)

        # Append to target
        predictions.write \
            .mode("append") \
            .saveAsTable(target_table)

        return predictions.count()

# Usage
inference = BatchInference(spark)

# Load model
model = PipelineModel.load("/models/customer_churn/v1.0/model")

# Run batch inference
count = inference.run_batch_inference(
    model,
    input_table="silver.customer_features",
    output_table="gold.churn_predictions",
    partition_cols=["prediction_date"]
)
print(f"Processed {count} records")
```

Spark ML provides battle-tested patterns for production machine learning. From feature engineering to model persistence, these patterns ensure reliable ML systems at scale.
