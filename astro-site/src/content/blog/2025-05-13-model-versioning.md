---
title: "Model Versioning: Managing AI Model Lifecycle"
author: Michael John Peña
draft: false
date: 2025-05-13
tags:
  - AI
  - Versioning
  - MLOps
  - Model Management
  - Best Practices

---

I wrote "Model Versioning: Managing AI Model Lifecycle" to share practical, production-minded guidance on this topic.

## Model Versioning System

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import Model
from dataclasses import dataclass
from typing import Dict, List, Optional
import mlflow

@dataclass
class ModelVersion:
    name: str
    version: str
    path: str
    metrics: Dict
    parameters: Dict
    tags: Dict

class ModelVersionManager:
    def __init__(self, ml_client: MLClient):
        self.ml_client = ml_client
        mlflow.set_tracking_uri(ml_client.tracking_uri)

    def register_model(self, model: ModelVersion) -> str:
        """Register a new model version."""
        with mlflow.start_run() as run:
            # Log parameters
            mlflow.log_params(model.parameters)

            # Log metrics
            mlflow.log_metrics(model.metrics)

            # Log model
            mlflow.log_artifact(model.path)

            # Register in Azure ML
            registered = self.ml_client.models.create_or_update(
                Model(
                    name=model.name,
                    path=model.path,
                    tags=model.tags,
                    properties={
                        "metrics": model.metrics,
                        "mlflow_run_id": run.info.run_id
                    }
                )
            )

            return registered.version

    def get_model(self, name: str, version: str = "latest") -> ModelVersion:
        """Get model by name and version."""
        if version == "latest":
            model = self.ml_client.models.get(name, label="latest")
        else:
            model = self.ml_client.models.get(name, version=version)

        return ModelVersion(
            name=model.name,
            version=model.version,
            path=model.path,
            metrics=model.properties.get("metrics", {}),
            parameters=model.tags,
            tags=model.tags
        )

    def compare_versions(self, name: str, v1: str, v2: str) -> Dict:
        """Compare two model versions."""
        model1 = self.get_model(name, v1)
        model2 = self.get_model(name, v2)

        return {
            "version1": v1,
            "version2": v2,
            "metric_comparison": {
                metric: {
                    "v1": model1.metrics.get(metric),
                    "v2": model2.metrics.get(metric),
                    "diff": model2.metrics.get(metric, 0) - model1.metrics.get(metric, 0)
                }
                for metric in set(model1.metrics.keys()) | set(model2.metrics.keys())
            },
            "parameter_changes": self.diff_params(model1.parameters, model2.parameters)
        }

    def promote_model(self, name: str, version: str, stage: str):
        """Promote model to a stage (staging, production)."""
        model = self.ml_client.models.get(name, version=version)

        # Add stage tag
        model.tags["stage"] = stage
        model.tags["promoted_at"] = datetime.now().isoformat()

        self.ml_client.models.create_or_update(model)

        # Update stage label
        self.ml_client.models.archive(name, label=stage)
        self.ml_client.models.create_or_update(
            Model(name=name, version=version, label=stage)
        )

    def rollback(self, name: str, stage: str) -> str:
        """Rollback to previous version in stage."""
        history = self.get_stage_history(name, stage)

        if len(history) < 2:
            raise ValueError("No previous version to rollback to")

        previous_version = history[-2]
        self.promote_model(name, previous_version, stage)

        return previous_version
```

Robust model versioning enables confident deployments and quick rollbacks.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
