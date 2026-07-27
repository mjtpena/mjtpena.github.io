---
title: "SynapseML: Distributed AI at Scale"
author: Michael John Pena
draft: false
date: 2023-04-20
tags:
  - Azure
  - SynapseML
  - Spark
  - Machine Learning
  - Distributed Computing

---

I wrote "SynapseML: Distributed AI at Scale" to share practical, production-minded guidance on this topic.

## SynapseML Fundamentals

```python
# SynapseML setup in Synapse or Databricks
from synapse.ml.core.spark import FluentAPI
from synapse.ml.featurize import *
from synapse.ml.train import *
from synapse.ml.lightgbm import *
from pyspark.sql import SparkSession

# Configure Spark for SynapseML
spark = SparkSession.builder \
    .appName("SynapseML-Demo") \
    .config("spark.jars.packages", "com.microsoft.azure:synapseml_2.12:0.11.0") \
    .getOrCreate()

class SynapseMLPipeline:
    """Distributed ML pipeline with SynapseML."""

    def __init__(self, spark: SparkSession):
        self.spark = spark

    def create_feature_pipeline(self, df, numeric_cols: list, categorical_cols: list):
        """Create feature engineering pipeline."""
        from synapse.ml.featurize import Featurize
        from pyspark.ml import Pipeline
        from pyspark.ml.feature import VectorAssembler, StringIndexer

        stages = []

        # Index categorical columns
        for col in categorical_cols:
            indexer = StringIndexer(
                inputCol=col,
                outputCol=f"{col}_indexed",
                handleInvalid="keep"
            )
            stages.append(indexer)

        # Assemble features
        feature_cols = numeric_cols + [f"{c}_indexed" for c in categorical_cols]
        assembler = VectorAssembler(
            inputCols=feature_cols,
            outputCol="features",
            handleInvalid="skip"
        )
        stages.append(assembler)

        pipeline = Pipeline(stages=stages)
        return pipeline.fit(df)

    def train_lightgbm_classifier(
        self,
        df,
        label_col: str,
        feature_col: str = "features"
    ):
        """Train LightGBM classifier at scale."""
        from synapse.ml.lightgbm import LightGBMClassifier

        lgbm = LightGBMClassifier(
            featuresCol=feature_col,
            labelCol=label_col,
            predictionCol="prediction",
            probabilityCol="probability",
            rawPredictionCol="rawPrediction",
            numLeaves=31,
            numIterations=100,
            learningRate=0.1,
            featureFraction=0.8,
            baggingFraction=0.8,
            baggingFreq=5,
            verbosity=-1
        )

        return lgbm.fit(df)

    def train_lightgbm_regressor(
        self,
        df,
        label_col: str,
        feature_col: str = "features"
    ):
        """Train LightGBM regressor at scale."""
        from synapse.ml.lightgbm import LightGBMRegressor

        lgbm = LightGBMRegressor(
            featuresCol=feature_col,
            labelCol=label_col,
            predictionCol="prediction",
            numLeaves=31,
            numIterations=100,
            learningRate=0.1,
            featureFraction=0.8
        )

        return lgbm.fit(df)
```

## Distributed Deep Learning

```python
class DistributedDeepLearning:
    """Deep learning at scale with SynapseML."""

    def __init__(self, spark):
        self.spark = spark

    def train_image_classifier(
        self,
        df,
        image_col: str,
        label_col: str,
        model_name: str = "ResNet50"
    ):
        """Train image classifier using transfer learning."""
        from synapse.ml.onnx import ImageFeaturizer
        from synapse.ml.lightgbm import LightGBMClassifier
        from pyspark.ml import Pipeline

        # Extract features using pre-trained model
        featurizer = (ImageFeaturizer()
            .setInputCol(image_col)
            .setOutputCol("image_features")
            .setModelName(model_name)
            .setCutOutputLayers(1))

        # Classifier on top
        classifier = LightGBMClassifier(
            featuresCol="image_features",
            labelCol=label_col,
            numIterations=50
        )

        pipeline = Pipeline(stages=[featurizer, classifier])
        return pipeline.fit(df)

    def train_text_classifier(
        self,
        df,
        text_col: str,
        label_col: str
    ):
        """Train text classifier with embeddings."""
        from synapse.ml.featurize.text import TextFeaturizer
        from synapse.ml.lightgbm import LightGBMClassifier
        from pyspark.ml import Pipeline

        # Text featurization
        text_featurizer = (TextFeaturizer()
            .setInputCol(text_col)
            .setOutputCol("text_features")
            .setUseTokenizer(True)
            .setUseStopWordsRemover(True)
            .setUseIDF(True)
            .setMinDocFreq(5))

        # Classifier
        classifier = LightGBMClassifier(
            featuresCol="text_features",
            labelCol=label_col,
            numIterations=100
        )

        pipeline = Pipeline(stages=[text_featurizer, classifier])
        return pipeline.fit(df)

    def ensemble_models(self, models: list, df):
        """Create ensemble from multiple models."""
        from pyspark.sql.functions import array, col
        from pyspark.ml.functions import vector_to_array

        predictions = df

        # Get predictions from each model
        for i, model in enumerate(models):
            pred_col = f"pred_{i}"
            predictions = model.transform(predictions)
            predictions = predictions.withColumnRenamed("prediction", pred_col)

        # Majority vote for classification
        pred_cols = [f"pred_{i}" for i in range(len(models))]

        from pyspark.sql.functions import greatest, least, avg
        predictions = predictions.withColumn(
            "ensemble_prediction",
            self._majority_vote(pred_cols)
        )

        return predictions
```

## Hyperparameter Tuning at Scale

```python
class DistributedHyperparameterTuning:
    """Distributed hyperparameter optimization."""

    def __init__(self, spark):
        self.spark = spark

    def tune_lightgbm(
        self,
        df,
        label_col: str,
        feature_col: str,
        param_grid: dict,
        num_folds: int = 5
    ):
        """Tune LightGBM with cross-validation."""
        from synapse.ml.lightgbm import LightGBMClassifier
        from pyspark.ml.tuning import CrossValidator, ParamGridBuilder
        from pyspark.ml.evaluation import BinaryClassificationEvaluator

        lgbm = LightGBMClassifier(
            featuresCol=feature_col,
            labelCol=label_col
        )

        # Build parameter grid
        grid_builder = ParamGridBuilder()

        if "numLeaves" in param_grid:
            grid_builder.addGrid(lgbm.numLeaves, param_grid["numLeaves"])
        if "numIterations" in param_grid:
            grid_builder.addGrid(lgbm.numIterations, param_grid["numIterations"])
        if "learningRate" in param_grid:
            grid_builder.addGrid(lgbm.learningRate, param_grid["learningRate"])

        param_grid = grid_builder.build()

        # Evaluator
        evaluator = BinaryClassificationEvaluator(
            labelCol=label_col,
            metricName="areaUnderROC"
        )

        # Cross-validator
        cv = CrossValidator(
            estimator=lgbm,
            estimatorParamMaps=param_grid,
            evaluator=evaluator,
            numFolds=num_folds,
            parallelism=4  # Parallel model training
        )

        cv_model = cv.fit(df)

        return {
            "best_model": cv_model.bestModel,
            "best_params": cv_model.bestModel.extractParamMap(),
            "cv_metrics": cv_model.avgMetrics
        }

    def random_search(
        self,
        df,
        label_col: str,
        feature_col: str,
        param_distributions: dict,
        n_iter: int = 20
    ):
        """Random search hyperparameter tuning."""
        import random
        from synapse.ml.lightgbm import LightGBMClassifier
        from pyspark.ml.evaluation import BinaryClassificationEvaluator

        evaluator = BinaryClassificationEvaluator(
            labelCol=label_col,
            metricName="areaUnderROC"
        )

        results = []
        train_df, val_df = df.randomSplit([0.8, 0.2], seed=42)

        for i in range(n_iter):
            # Sample parameters
            params = {
                k: random.choice(v) for k, v in param_distributions.items()
            }

            lgbm = LightGBMClassifier(
                featuresCol=feature_col,
                labelCol=label_col,
                **params
            )

            model = lgbm.fit(train_df)
            predictions = model.transform(val_df)
            score = evaluator.evaluate(predictions)

            results.append({
                "params": params,
                "score": score,
                "model": model
            })

            print(f"Iteration {i+1}/{n_iter}: AUC = {score:.4f}")

        # Return best
        best = max(results, key=lambda x: x["score"])
        return best
```

## Model Interpretation

```python
class ModelInterpretation:
    """Interpret SynapseML models at scale."""

    def __init__(self, spark):
        self.spark = spark

    def get_feature_importance(self, model, feature_names: list) -> dict:
        """Get feature importance from LightGBM model."""

        # LightGBM models have native feature importance
        if hasattr(model, "getFeatureImportances"):
            importances = model.getFeatureImportances("split")

            return dict(sorted(
                zip(feature_names, importances),
                key=lambda x: x[1],
                reverse=True
            ))

        return {}

    def compute_shap_values(self, model, df, feature_col: str):
        """Compute SHAP values for model explanations."""
        from synapse.ml.explainers import VectorSHAP

        shap_explainer = (VectorSHAP()
            .setInputCol(feature_col)
            .setOutputCol("shap_values")
            .setBackgroundData(df.limit(100))
            .setModel(model)
            .setNumSamples(1000))

        return shap_explainer.transform(df)

    def local_interpretation(self, model, df, row_index: int, feature_names: list):
        """Get local interpretation for a single prediction."""

        # Get the specific row
        row = df.collect()[row_index]

        # Get prediction
        single_df = self.spark.createDataFrame([row])
        prediction = model.transform(single_df).collect()[0]

        # Compute SHAP for this instance
        shap_df = self.compute_shap_values(model, single_df, "features")
        shap_values = shap_df.select("shap_values").collect()[0][0]

        return {
            "prediction": prediction["prediction"],
            "probability": prediction["probability"].toArray().tolist(),
            "feature_contributions": dict(zip(feature_names, shap_values))
        }

    def partial_dependence(
        self,
        model,
        df,
        feature_col: str,
        feature_name: str,
        num_points: int = 50
    ):
        """Compute partial dependence for a feature."""
        from pyspark.sql.functions import lit, col

        # Get feature range
        feature_stats = df.select(feature_name).describe().collect()
        min_val = float(feature_stats[3][1])  # min
        max_val = float(feature_stats[4][1])  # max

        # Generate grid points
        step = (max_val - min_val) / num_points
        grid_points = [min_val + i * step for i in range(num_points)]

        pdp_values = []

        for point in grid_points:
            # Replace feature value
            modified_df = df.withColumn(feature_name, lit(point))

            # Re-assemble features and predict
            predictions = model.transform(modified_df)
            avg_pred = predictions.select("prediction").agg({"prediction": "avg"}).collect()[0][0]

            pdp_values.append({"feature_value": point, "avg_prediction": avg_pred})

        return pdp_values
```

## End-to-End ML Pipeline

```python
class EndToEndMLPipeline:
    """Complete ML pipeline with SynapseML."""

    def __init__(self, spark):
        self.spark = spark
        self.pipeline_helper = SynapseMLPipeline(spark)
        self.tuner = DistributedHyperparameterTuning(spark)

    def run_classification_pipeline(
        self,
        df,
        label_col: str,
        numeric_cols: list,
        categorical_cols: list,
        tune_hyperparams: bool = True
    ):
        """Run complete classification pipeline."""

        # Split data
        train_df, test_df = df.randomSplit([0.8, 0.2], seed=42)

        # Feature engineering
        feature_pipeline = self.pipeline_helper.create_feature_pipeline(
            train_df, numeric_cols, categorical_cols
        )
        train_features = feature_pipeline.transform(train_df)
        test_features = feature_pipeline.transform(test_df)

        # Hyperparameter tuning or default training
        if tune_hyperparams:
            result = self.tuner.tune_lightgbm(
                train_features,
                label_col,
                "features",
                param_grid={
                    "numLeaves": [15, 31, 63],
                    "numIterations": [50, 100, 200],
                    "learningRate": [0.05, 0.1, 0.2]
                }
            )
            model = result["best_model"]
        else:
            model = self.pipeline_helper.train_lightgbm_classifier(
                train_features, label_col
            )

        # Evaluate
        predictions = model.transform(test_features)
        metrics = self._evaluate_classification(predictions, label_col)

        return {
            "feature_pipeline": feature_pipeline,
            "model": model,
            "metrics": metrics,
            "predictions": predictions
        }

    def _evaluate_classification(self, predictions, label_col: str) -> dict:
        """Evaluate classification model."""
        from pyspark.ml.evaluation import BinaryClassificationEvaluator, MulticlassClassificationEvaluator

        binary_eval = BinaryClassificationEvaluator(labelCol=label_col)
        multi_eval = MulticlassClassificationEvaluator(labelCol=label_col)

        return {
            "auc": binary_eval.evaluate(predictions, {binary_eval.metricName: "areaUnderROC"}),
            "accuracy": multi_eval.evaluate(predictions, {multi_eval.metricName: "accuracy"}),
            "f1": multi_eval.evaluate(predictions, {multi_eval.metricName: "f1"})
        }

# Usage
pipeline = EndToEndMLPipeline(spark)

# Load data
df = spark.table("silver.customer_features")

# Run pipeline
result = pipeline.run_classification_pipeline(
    df,
    label_col="churn",
    numeric_cols=["age", "tenure", "monthly_charges", "total_charges"],
    categorical_cols=["contract_type", "payment_method", "internet_service"],
    tune_hyperparams=True
)

print(f"Model AUC: {result['metrics']['auc']:.4f}")
```

SynapseML democratizes distributed machine learning. Train on massive datasets, tune hyperparameters in parallel, and deploy models at scale - all with familiar APIs.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
