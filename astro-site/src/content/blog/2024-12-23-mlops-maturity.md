---
title: "MLOps Maturity: Productionizing Machine Learning"
author: Michael John Peña
draft: false
date: 2024-12-23
tags:
  - MLOps
  - Machine Learning
  - Production
  - Operations
  - Best Practices

---

I wrote "MLOps Maturity: Productionizing Machine Learning" to share practical, production-minded guidance on this topic.

## MLOps Maturity Levels

```
Level 0: No MLOps
├── Notebooks only
├── Manual model deployment
├── No version control
└── No monitoring

Level 1: DevOps for ML
├── Version control for code
├── Basic CI/CD
├── Manual testing
└── Basic monitoring

Level 2: ML Pipeline Automation
├── Automated training pipelines
├── Feature stores
├── Experiment tracking
└── Model registry

Level 3: Full MLOps
├── Automated retraining
├── A/B testing
├── Model monitoring
└── Automated rollback

Level 4: Autonomous ML
├── Self-healing models
├── AutoML integration
├── Automated feature engineering
└── Continuous optimization
```

## Core MLOps Components

### Component 1: Experiment Tracking

```python
import mlflow
from mlflow.tracking import MlflowClient

class ExperimentTracker:
    """Track ML experiments systematically."""

    def __init__(self, experiment_name: str):
        mlflow.set_experiment(experiment_name)
        self.client = MlflowClient()

    def run_experiment(
        self,
        model_fn,
        params: dict,
        train_data,
        test_data,
        tags: dict = None
    ):
        """Run and track an experiment."""

        with mlflow.start_run(tags=tags) as run:
            # Log parameters
            mlflow.log_params(params)

            # Train model
            model = model_fn(**params)
            model.fit(train_data.X, train_data.y)

            # Evaluate
            predictions = model.predict(test_data.X)
            metrics = self.calculate_metrics(test_data.y, predictions)

            # Log metrics
            mlflow.log_metrics(metrics)

            # Log model
            mlflow.sklearn.log_model(
                model,
                "model",
                registered_model_name=f"{mlflow.get_experiment().name}_model"
            )

            # Log artifacts
            self.log_artifacts(model, test_data, predictions)

            return {
                "run_id": run.info.run_id,
                "metrics": metrics,
                "model_uri": f"runs:/{run.info.run_id}/model"
            }

    def calculate_metrics(self, y_true, y_pred) -> dict:
        from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

        return {
            "accuracy": accuracy_score(y_true, y_pred),
            "precision": precision_score(y_true, y_pred, average='weighted'),
            "recall": recall_score(y_true, y_pred, average='weighted'),
            "f1": f1_score(y_true, y_pred, average='weighted')
        }

    def compare_runs(self, metric: str = "f1", top_n: int = 5) -> list:
        """Compare experiment runs."""
        experiment = mlflow.get_experiment_by_name(mlflow.get_experiment().name)
        runs = self.client.search_runs(
            experiment_ids=[experiment.experiment_id],
            order_by=[f"metrics.{metric} DESC"],
            max_results=top_n
        )

        return [
            {
                "run_id": run.info.run_id,
                "params": run.data.params,
                "metrics": run.data.metrics
            }
            for run in runs
        ]
```

### Component 2: Feature Store

```python
from feast import FeatureStore, Entity, Feature, FeatureView, FileSource
from datetime import timedelta

class MLFeatureStore:
    """Centralized feature store for ML."""

    def __init__(self, repo_path: str):
        self.store = FeatureStore(repo_path=repo_path)

    def define_features(self):
        """Define feature views."""

        # Customer entity
        customer = Entity(
            name="customer",
            join_keys=["customer_id"]
        )

        # Customer features
        customer_features = FeatureView(
            name="customer_features",
            entities=[customer],
            ttl=timedelta(days=1),
            features=[
                Feature(name="total_purchases", dtype=Float64),
                Feature(name="avg_order_value", dtype=Float64),
                Feature(name="days_since_last_purchase", dtype=Int64),
                Feature(name="purchase_frequency", dtype=Float64),
                Feature(name="customer_segment", dtype=String)
            ],
            source=FileSource(
                path="data/customer_features.parquet",
                timestamp_field="event_timestamp"
            )
        )

        return [customer, customer_features]

    def get_training_data(
        self,
        entity_df,
        feature_refs: list,
        label_column: str = None
    ):
        """Get training dataset from feature store."""

        training_df = self.store.get_historical_features(
            entity_df=entity_df,
            features=feature_refs
        ).to_df()

        if label_column:
            # Join with labels
            training_df = training_df.merge(
                entity_df[[self.store.get_entity("customer").join_keys[0], label_column]],
                on=self.store.get_entity("customer").join_keys[0]
            )

        return training_df

    def get_online_features(self, entity_dict: dict, feature_refs: list) -> dict:
        """Get features for online inference."""
        response = self.store.get_online_features(
            features=feature_refs,
            entity_rows=[entity_dict]
        )
        return response.to_dict()
```

### Component 3: Model Registry

```python
from mlflow.tracking import MlflowClient
from mlflow.entities.model_registry import ModelVersion

class ModelRegistry:
    """Manage model lifecycle."""

    def __init__(self):
        self.client = MlflowClient()

    def register_model(self, run_id: str, model_name: str) -> ModelVersion:
        """Register a model from an experiment run."""
        model_uri = f"runs:/{run_id}/model"

        result = mlflow.register_model(
            model_uri=model_uri,
            name=model_name
        )

        return result

    def promote_model(
        self,
        model_name: str,
        version: int,
        stage: str,
        archive_existing: bool = True
    ):
        """Promote model to a stage (Staging, Production)."""

        if archive_existing:
            # Archive current models in target stage
            current_models = self.client.get_latest_versions(
                model_name, stages=[stage]
            )
            for model in current_models:
                self.client.transition_model_version_stage(
                    name=model_name,
                    version=model.version,
                    stage="Archived"
                )

        # Promote new model
        self.client.transition_model_version_stage(
            name=model_name,
            version=version,
            stage=stage
        )

    def get_production_model(self, model_name: str):
        """Get current production model."""
        models = self.client.get_latest_versions(
            model_name, stages=["Production"]
        )
        if models:
            return mlflow.pyfunc.load_model(
                f"models:/{model_name}/Production"
            )
        return None

    def compare_models(
        self,
        model_name: str,
        version_a: int,
        version_b: int,
        test_data
    ) -> dict:
        """Compare two model versions."""
        model_a = mlflow.pyfunc.load_model(
            f"models:/{model_name}/{version_a}"
        )
        model_b = mlflow.pyfunc.load_model(
            f"models:/{model_name}/{version_b}"
        )

        predictions_a = model_a.predict(test_data.X)
        predictions_b = model_b.predict(test_data.X)

        metrics_a = self.calculate_metrics(test_data.y, predictions_a)
        metrics_b = self.calculate_metrics(test_data.y, predictions_b)

        return {
            "version_a": {"version": version_a, "metrics": metrics_a},
            "version_b": {"version": version_b, "metrics": metrics_b},
            "winner": version_a if metrics_a["f1"] > metrics_b["f1"] else version_b
        }
```

### Component 4: Model Monitoring

```python
from dataclasses import dataclass
from typing import Optional
import numpy as np

@dataclass
class DriftMetrics:
    feature_name: str
    drift_score: float
    is_drifted: bool
    baseline_stats: dict
    current_stats: dict

class ModelMonitor:
    """Monitor model performance and drift."""

    def __init__(self, model_name: str, baseline_data):
        self.model_name = model_name
        self.baseline_stats = self.calculate_stats(baseline_data)

    def detect_data_drift(
        self,
        current_data,
        threshold: float = 0.1
    ) -> list[DriftMetrics]:
        """Detect drift in input features."""
        drift_results = []

        for column in current_data.columns:
            baseline = self.baseline_stats[column]
            current = self.calculate_column_stats(current_data[column])

            # Calculate PSI (Population Stability Index)
            psi = self.calculate_psi(baseline["distribution"], current["distribution"])

            drift_results.append(DriftMetrics(
                feature_name=column,
                drift_score=psi,
                is_drifted=psi > threshold,
                baseline_stats=baseline,
                current_stats=current
            ))

        return drift_results

    def detect_prediction_drift(
        self,
        predictions,
        threshold: float = 0.1
    ) -> dict:
        """Detect drift in model predictions."""
        baseline_pred_dist = self.baseline_stats["predictions"]["distribution"]
        current_pred_dist = self.get_distribution(predictions)

        psi = self.calculate_psi(baseline_pred_dist, current_pred_dist)

        return {
            "drift_score": psi,
            "is_drifted": psi > threshold,
            "baseline_mean": self.baseline_stats["predictions"]["mean"],
            "current_mean": np.mean(predictions)
        }

    def monitor_performance(
        self,
        predictions,
        actuals,
        alert_threshold: float = 0.05
    ) -> dict:
        """Monitor model performance vs baseline."""
        current_metrics = self.calculate_metrics(actuals, predictions)
        baseline_metrics = self.baseline_stats["metrics"]

        degradation = {}
        alerts = []

        for metric, value in current_metrics.items():
            baseline_value = baseline_metrics[metric]
            change = (baseline_value - value) / baseline_value

            degradation[metric] = {
                "baseline": baseline_value,
                "current": value,
                "change_percent": change * 100
            }

            if change > alert_threshold:
                alerts.append({
                    "metric": metric,
                    "severity": "high" if change > 0.1 else "medium",
                    "message": f"{metric} degraded by {change*100:.1f}%"
                })

        return {
            "degradation": degradation,
            "alerts": alerts,
            "needs_retraining": len([a for a in alerts if a["severity"] == "high"]) > 0
        }

    def calculate_psi(self, baseline_dist: list, current_dist: list) -> float:
        """Calculate Population Stability Index."""
        psi = 0
        for b, c in zip(baseline_dist, current_dist):
            if b > 0 and c > 0:
                psi += (c - b) * np.log(c / b)
        return psi
```

### Component 5: Automated Retraining

```python
class AutomatedRetraining:
    """Automate model retraining based on triggers."""

    def __init__(
        self,
        model_name: str,
        feature_store: MLFeatureStore,
        registry: ModelRegistry,
        monitor: ModelMonitor
    ):
        self.model_name = model_name
        self.feature_store = feature_store
        self.registry = registry
        self.monitor = monitor

    async def check_and_retrain(self):
        """Check if retraining is needed and execute."""

        # Get recent data
        recent_data = self.get_recent_data()

        # Check for drift
        drift_results = self.monitor.detect_data_drift(recent_data)
        significant_drift = [d for d in drift_results if d.is_drifted]

        # Check performance
        if labels_available := self.get_recent_labels():
            current_model = self.registry.get_production_model(self.model_name)
            predictions = current_model.predict(recent_data)
            performance = self.monitor.monitor_performance(predictions, labels_available)
        else:
            performance = {"needs_retraining": False}

        # Decide if retraining needed
        should_retrain = (
            len(significant_drift) > 2 or
            performance.get("needs_retraining", False)
        )

        if should_retrain:
            new_model = await self.retrain()
            await self.validate_and_deploy(new_model)

        return {
            "drift_detected": len(significant_drift),
            "performance_degraded": performance.get("needs_retraining", False),
            "retrained": should_retrain
        }

    async def retrain(self):
        """Execute retraining pipeline."""
        # Get training data from feature store
        training_data = self.feature_store.get_training_data(
            entity_df=self.get_training_entities(),
            feature_refs=self.get_feature_refs(),
            label_column="label"
        )

        # Train new model
        tracker = ExperimentTracker(f"{self.model_name}_retrain")
        result = tracker.run_experiment(
            model_fn=self.get_model_fn(),
            params=self.get_best_params(),
            train_data=training_data,
            test_data=self.get_test_data(),
            tags={"trigger": "automated_retraining"}
        )

        return result

    async def validate_and_deploy(self, new_model_result: dict):
        """Validate new model and deploy if better."""
        # Register new model
        new_version = self.registry.register_model(
            run_id=new_model_result["run_id"],
            model_name=self.model_name
        )

        # Compare with current production
        current_version = self.registry.get_production_model(self.model_name)
        comparison = self.registry.compare_models(
            self.model_name,
            new_version.version,
            current_version.version,
            self.get_test_data()
        )

        # Deploy if better
        if comparison["winner"] == new_version.version:
            self.registry.promote_model(
                self.model_name,
                new_version.version,
                "Production"
            )
            return {"deployed": True, "version": new_version.version}

        return {"deployed": False, "reason": "New model not better"}
```

MLOps is essential for sustainable ML in production. Start with experiment tracking and gradually add components as your ML practice matures.

## Resources

- [MLflow Documentation](https://mlflow.org/docs/latest/index.html)
- [Feast Feature Store](https://feast.dev/)
- [Google MLOps Guide](https://cloud.google.com/architecture/mlops-continuous-delivery-and-automation-pipelines-in-machine-learning)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
