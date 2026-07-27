---
title: "Experiment Tracking in Fabric: Best Practices and Patterns"
author: Michael John Peña
draft: false
date: 2023-07-26
tags:
  - Microsoft Fabric
  - MLflow
  - Experiment Tracking
  - MLOps

---

I wrote "Experiment Tracking in Fabric: Best Practices and Patterns" to share practical, production-minded guidance on this topic.

## Experiment Tracking Framework

```python
# Comprehensive tracking structure
tracking_structure = {
    "experiment_level": {
        "name": "Descriptive project name",
        "tags": "Team, project, dataset version"
    },
    "run_level": {
        "parameters": "All hyperparameters",
        "metrics": "Training and evaluation metrics",
        "artifacts": "Models, plots, data samples",
        "tags": "Run-specific metadata"
    }
}
```

## Creating a Tracking Template

```python
import mlflow
import json
import hashlib
from datetime import datetime

class ExperimentTracker:
    def __init__(self, experiment_name, team="data_science"):
        self.experiment_name = experiment_name
        self.team = team
        mlflow.set_experiment(experiment_name)

        # Set experiment tags
        mlflow.set_experiment_tag("team", team)
        mlflow.set_experiment_tag("created_at", datetime.now().isoformat())

    def start_run(self, run_name, description=None):
        """Start a new tracked run."""
        self.run = mlflow.start_run(run_name=run_name)

        if description:
            mlflow.set_tag("description", description)

        mlflow.set_tag("run_started", datetime.now().isoformat())
        return self

    def log_data_info(self, train_df, test_df, feature_cols, target_col):
        """Log dataset information."""
        data_info = {
            "train_rows": len(train_df),
            "test_rows": len(test_df),
            "n_features": len(feature_cols),
            "target_column": target_col,
            "feature_columns": ",".join(feature_cols[:10])  # First 10
        }
        mlflow.log_params(data_info)

        # Log data hash for reproducibility
        data_hash = hashlib.md5(
            train_df.to_json().encode()
        ).hexdigest()[:8]
        mlflow.log_param("data_hash", data_hash)

    def log_model_params(self, model_type, params):
        """Log model parameters."""
        mlflow.log_param("model_type", model_type)
        mlflow.log_params(params)

    def log_training_metrics(self, metrics, prefix="train"):
        """Log training metrics."""
        prefixed_metrics = {f"{prefix}_{k}": v for k, v in metrics.items()}
        mlflow.log_metrics(prefixed_metrics)

    def log_evaluation_metrics(self, metrics, prefix="eval"):
        """Log evaluation metrics."""
        prefixed_metrics = {f"{prefix}_{k}": v for k, v in metrics.items()}
        mlflow.log_metrics(prefixed_metrics)

    def end_run(self, status="FINISHED"):
        """End the current run."""
        mlflow.set_tag("run_ended", datetime.now().isoformat())
        mlflow.set_tag("status", status)
        mlflow.end_run()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.end_run(status="FAILED")
        else:
            self.end_run(status="FINISHED")
```

## Using the Tracking Template

```python
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score

# Initialize tracker
tracker = ExperimentTracker("customer_churn_v2", team="analytics")

# Start tracked run
with tracker.start_run("rf_baseline", description="Random Forest baseline model"):
    # Log data info
    tracker.log_data_info(
        train_df=X_train,
        test_df=X_test,
        feature_cols=feature_columns,
        target_col="churn"
    )

    # Define and log parameters
    params = {
        "n_estimators": 100,
        "max_depth": 10,
        "min_samples_split": 5
    }
    tracker.log_model_params("RandomForestClassifier", params)

    # Train model
    model = RandomForestClassifier(**params, random_state=42)
    model.fit(X_train, y_train)

    # Evaluate
    y_pred = model.predict(X_test)
    metrics = {
        "accuracy": accuracy_score(y_test, y_pred),
        "f1": f1_score(y_test, y_pred),
        "precision": precision_score(y_test, y_pred),
        "recall": recall_score(y_test, y_pred)
    }
    tracker.log_evaluation_metrics(metrics)

    # Log model
    mlflow.sklearn.log_model(model, "model")
```

## Tracking Hyperparameter Searches

```python
from sklearn.model_selection import RandomizedSearchCV
from scipy.stats import randint, uniform

def track_hyperparameter_search(X_train, y_train, X_test, y_test, n_iter=20):
    """Track hyperparameter search with nested runs."""

    with mlflow.start_run(run_name="hyperparameter_search") as parent:
        # Define search space
        param_distributions = {
            "n_estimators": randint(50, 300),
            "max_depth": randint(3, 20),
            "min_samples_split": randint(2, 20),
            "min_samples_leaf": randint(1, 10)
        }

        mlflow.log_param("search_method", "RandomizedSearchCV")
        mlflow.log_param("n_iterations", n_iter)

        # Perform search
        base_model = RandomForestClassifier(random_state=42)
        search = RandomizedSearchCV(
            base_model,
            param_distributions,
            n_iter=n_iter,
            cv=5,
            scoring='f1',
            random_state=42
        )
        search.fit(X_train, y_train)

        # Log each configuration as nested run
        for i, (params, score) in enumerate(zip(
            search.cv_results_['params'],
            search.cv_results_['mean_test_score']
        )):
            with mlflow.start_run(run_name=f"config_{i}", nested=True):
                mlflow.log_params(params)
                mlflow.log_metric("cv_score", score)

        # Log best results
        mlflow.log_params({"best_" + k: v for k, v in search.best_params_.items()})
        mlflow.log_metric("best_cv_score", search.best_score_)

        # Evaluate on test set
        y_pred = search.best_estimator_.predict(X_test)
        test_f1 = f1_score(y_test, y_pred)
        mlflow.log_metric("test_f1", test_f1)

        # Log best model
        mlflow.sklearn.log_model(search.best_estimator_, "best_model")

        return search.best_estimator_

best_model = track_hyperparameter_search(X_train, y_train, X_test, y_test)
```

## Cross-Validation Tracking

```python
from sklearn.model_selection import cross_validate
import numpy as np

def track_cross_validation(model, X, y, cv=5):
    """Track cross-validation results."""

    with mlflow.start_run(run_name="cross_validation"):
        # Log model parameters
        mlflow.log_params(model.get_params())

        # Perform cross-validation
        cv_results = cross_validate(
            model, X, y,
            cv=cv,
            scoring=['accuracy', 'f1', 'precision', 'recall'],
            return_train_score=True
        )

        # Log mean and std for each metric
        for metric in ['accuracy', 'f1', 'precision', 'recall']:
            test_key = f'test_{metric}'
            train_key = f'train_{metric}'

            mlflow.log_metrics({
                f"cv_{metric}_mean": np.mean(cv_results[test_key]),
                f"cv_{metric}_std": np.std(cv_results[test_key]),
                f"cv_{metric}_train_mean": np.mean(cv_results[train_key])
            })

        # Log fold-by-fold results
        for fold, score in enumerate(cv_results['test_f1']):
            mlflow.log_metric("fold_f1", score, step=fold)

        # Create CV summary plot
        fig, ax = plt.subplots(figsize=(10, 6))
        metrics = ['accuracy', 'f1', 'precision', 'recall']
        means = [np.mean(cv_results[f'test_{m}']) for m in metrics]
        stds = [np.std(cv_results[f'test_{m}']) for m in metrics]

        ax.bar(metrics, means, yerr=stds, capsize=5)
        ax.set_ylabel('Score')
        ax.set_title('Cross-Validation Results')
        ax.set_ylim([0, 1])

        mlflow.log_figure(fig, "cv_results.png")
        plt.close()

        return cv_results

cv_results = track_cross_validation(model, X_train, y_train)
```

## Tracking Training Progress

```python
def track_training_progress(model, X_train, y_train, X_val, y_val, epochs=100):
    """Track training progress over epochs (for iterative models)."""

    with mlflow.start_run(run_name="training_progress"):
        train_scores = []
        val_scores = []

        for epoch in range(epochs):
            # Partial fit (for models that support it) or retrain
            model.fit(X_train, y_train)

            # Calculate scores
            train_score = accuracy_score(y_train, model.predict(X_train))
            val_score = accuracy_score(y_val, model.predict(X_val))

            train_scores.append(train_score)
            val_scores.append(val_score)

            # Log step metrics
            mlflow.log_metric("train_accuracy", train_score, step=epoch)
            mlflow.log_metric("val_accuracy", val_score, step=epoch)

            # Early stopping check
            if epoch > 10:
                if val_scores[-1] < val_scores[-10]:
                    mlflow.log_param("early_stop_epoch", epoch)
                    break

        # Log training curves
        fig, ax = plt.subplots()
        ax.plot(train_scores, label='Train')
        ax.plot(val_scores, label='Validation')
        ax.set_xlabel('Epoch')
        ax.set_ylabel('Accuracy')
        ax.legend()
        ax.set_title('Training Progress')

        mlflow.log_figure(fig, "training_curves.png")
        plt.close()

        return model
```

## Comparing Experiments

```python
def compare_experiments(experiment_name, metric="eval_f1"):
    """Generate comparison report for experiment runs."""

    experiment = mlflow.get_experiment_by_name(experiment_name)

    # Get all runs
    runs = mlflow.search_runs(
        experiment_ids=[experiment.experiment_id],
        filter_string="status = 'FINISHED'",
        order_by=[f"metrics.{metric} DESC"]
    )

    # Create comparison report
    comparison_cols = [
        'run_id', 'tags.mlflow.runName',
        'params.model_type', 'params.n_estimators',
        f'metrics.{metric}', 'metrics.eval_accuracy'
    ]

    available_cols = [c for c in comparison_cols if c in runs.columns]
    report = runs[available_cols].head(10)

    print("=" * 60)
    print(f"Experiment: {experiment_name}")
    print(f"Top 10 runs by {metric}")
    print("=" * 60)
    print(report.to_string())

    return report

comparison = compare_experiments("customer_churn_v2")
```

Tomorrow we'll explore Azure OpenAI Code Interpreter.

## Resources

- [MLflow Tracking](https://mlflow.org/docs/latest/tracking.html)
- [Experiment Best Practices](https://learn.microsoft.com/en-us/fabric/data-science/experiment-tracking)
- [MLOps Patterns](https://ml-ops.org/content/mlops-principles)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
