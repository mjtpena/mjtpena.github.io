---
title: "Online Inference Patterns: Low-Latency ML Predictions at Scale"
author: Michael John Peña
draft: false
date: 2024-11-26
tags:
  - Azure
  - Machine Learning
  - Online Inference
  - MLOps
  - Performance

---

I wrote "Online Inference Patterns: Low-Latency ML Predictions at Scale" to share practical, production-minded guidance on this topic.

## Online Inference Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Online Inference System                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Request → Load Balancer → Inference Servers → Response     │
│               │                   │                          │
│               ↓                   ↓                          │
│          [Caching]         [Feature Store]                  │
│                                   │                          │
│                            [Model Cache]                     │
│                                                              │
│  Metrics → Prometheus → Grafana → Alerts                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Pattern 1: Simple Inference Endpoint

```python
from azure.ai.ml import MLClient
from azure.ai.ml.entities import (
    ManagedOnlineEndpoint,
    ManagedOnlineDeployment
)
from azure.identity import DefaultAzureCredential

# Create ML client
credential = DefaultAzureCredential()
ml_client = MLClient(
    credential=credential,
    subscription_id=subscription_id,
    resource_group_name=resource_group,
    workspace_name=workspace
)

# Create endpoint
endpoint = ManagedOnlineEndpoint(
    name="product-recommender",
    description="Real-time product recommendations",
    auth_mode="key"
)

ml_client.online_endpoints.begin_create_or_update(endpoint).result()

# Create deployment
deployment = ManagedOnlineDeployment(
    name="recommender-v1",
    endpoint_name="product-recommender",
    model=ml_client.models.get("recommender-model", version="1"),
    instance_type="Standard_DS3_v2",
    instance_count=3,
    request_settings={
        "request_timeout_ms": 90000,
        "max_concurrent_requests_per_instance": 100
    },
    liveness_probe={
        "initial_delay": 30,
        "period": 10
    },
    readiness_probe={
        "initial_delay": 10,
        "period": 10
    }
)

ml_client.online_deployments.begin_create_or_update(deployment).result()
```

## Pattern 2: Multi-Model Serving

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import asyncio
from typing import Dict, Any

app = FastAPI()

class ModelRegistry:
    """Manage multiple models for inference."""

    def __init__(self):
        self.models: Dict[str, Any] = {}
        self.model_versions: Dict[str, str] = {}

    async def load_model(self, name: str, version: str, path: str):
        """Load a model into memory."""
        import mlflow

        model_uri = f"{path}/{name}/{version}"
        model = mlflow.pyfunc.load_model(model_uri)

        self.models[f"{name}:{version}"] = model
        self.model_versions[name] = version

    async def get_model(self, name: str, version: str = None):
        """Get a loaded model."""
        if version is None:
            version = self.model_versions.get(name)

        key = f"{name}:{version}"
        if key not in self.models:
            raise HTTPException(404, f"Model {key} not found")

        return self.models[key]

    async def predict(self, model_name: str, features: dict, version: str = None):
        """Run prediction with the specified model."""
        model = await self.get_model(model_name, version)

        # Convert features to model input format
        import pandas as pd
        input_df = pd.DataFrame([features])

        # Run prediction
        prediction = model.predict(input_df)

        return prediction[0] if len(prediction) == 1 else prediction.tolist()

registry = ModelRegistry()

class PredictionRequest(BaseModel):
    model_name: str
    features: dict
    version: str = None

class PredictionResponse(BaseModel):
    prediction: Any
    model_version: str
    latency_ms: float

@app.post("/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    import time
    start = time.time()

    prediction = await registry.predict(
        model_name=request.model_name,
        features=request.features,
        version=request.version
    )

    latency = (time.time() - start) * 1000

    return PredictionResponse(
        prediction=prediction,
        model_version=request.version or registry.model_versions[request.model_name],
        latency_ms=latency
    )
```

## Pattern 3: Feature Store Integration

```python
from feast import FeatureStore
from typing import List, Dict
import numpy as np

class FeatureEnrichedInference:
    """Inference with real-time feature enrichment."""

    def __init__(self, model, feature_store_path: str):
        self.model = model
        self.fs = FeatureStore(repo_path=feature_store_path)

    async def predict(
        self,
        entity_ids: List[str],
        entity_type: str,
        feature_views: List[str],
        request_features: Dict = None
    ):
        """Get features and make predictions."""

        # Prepare entity dataframe
        import pandas as pd
        entity_df = pd.DataFrame({
            f"{entity_type}_id": entity_ids
        })

        # Get features from feature store
        feature_vector = self.fs.get_online_features(
            features=[
                f"{view}:*" for view in feature_views
            ],
            entity_rows=[{f"{entity_type}_id": eid} for eid in entity_ids]
        ).to_dict()

        # Combine with request-time features
        if request_features:
            for key, value in request_features.items():
                feature_vector[key] = [value] * len(entity_ids)

        # Convert to model input
        feature_df = pd.DataFrame(feature_vector)

        # Predict
        predictions = self.model.predict(feature_df)

        return {
            "predictions": predictions.tolist(),
            "entity_ids": entity_ids
        }

# Usage
inference_engine = FeatureEnrichedInference(
    model=loaded_model,
    feature_store_path="feature_repo/"
)

result = await inference_engine.predict(
    entity_ids=["user_123", "user_456"],
    entity_type="user",
    feature_views=["user_features", "user_activity_features"],
    request_features={"current_hour": 14, "is_weekend": False}
)
```

## Pattern 4: Caching for Low Latency

```python
import redis
import hashlib
import json
from typing import Optional
import asyncio

class CachedInferenceServer:
    """Inference server with prediction caching."""

    def __init__(self, model, redis_url: str, cache_ttl: int = 300):
        self.model = model
        self.redis = redis.from_url(redis_url)
        self.cache_ttl = cache_ttl
        self.cache_hits = 0
        self.cache_misses = 0

    def _cache_key(self, model_name: str, features: dict) -> str:
        """Generate cache key from features."""
        feature_str = json.dumps(features, sort_keys=True)
        hash_val = hashlib.md5(feature_str.encode()).hexdigest()
        return f"pred:{model_name}:{hash_val}"

    async def predict(
        self,
        features: dict,
        model_name: str,
        use_cache: bool = True
    ) -> dict:
        """Make prediction with optional caching."""

        cache_key = self._cache_key(model_name, features)

        # Check cache
        if use_cache:
            cached = self.redis.get(cache_key)
            if cached:
                self.cache_hits += 1
                return {
                    "prediction": json.loads(cached),
                    "cached": True,
                    "latency_ms": 0.1
                }

        self.cache_misses += 1

        # Run inference
        import time
        start = time.time()

        prediction = self.model.predict(features)

        latency = (time.time() - start) * 1000

        # Cache result
        if use_cache:
            self.redis.setex(
                cache_key,
                self.cache_ttl,
                json.dumps(prediction)
            )

        return {
            "prediction": prediction,
            "cached": False,
            "latency_ms": latency
        }

    def get_cache_stats(self) -> dict:
        """Get cache performance statistics."""
        total = self.cache_hits + self.cache_misses
        hit_rate = self.cache_hits / total if total > 0 else 0

        return {
            "cache_hits": self.cache_hits,
            "cache_misses": self.cache_misses,
            "hit_rate": hit_rate
        }
```

## Pattern 5: Batch and Real-Time Hybrid

```python
from typing import List
import asyncio

class HybridInferenceServer:
    """Combine batch and real-time inference."""

    def __init__(self, model, batch_size: int = 32, max_wait_ms: int = 50):
        self.model = model
        self.batch_size = batch_size
        self.max_wait_ms = max_wait_ms
        self.pending_requests = []
        self.batch_task = None

    async def predict(self, features: dict) -> dict:
        """Queue prediction request for batching."""

        # Create future for this request
        loop = asyncio.get_event_loop()
        future = loop.create_future()

        self.pending_requests.append({
            "features": features,
            "future": future
        })

        # Start batch processing if needed
        if self.batch_task is None or self.batch_task.done():
            self.batch_task = asyncio.create_task(self._process_batch())

        # Trigger immediate processing if batch is full
        if len(self.pending_requests) >= self.batch_size:
            self.batch_task.cancel()
            self.batch_task = asyncio.create_task(self._process_batch())

        # Wait for result
        result = await future
        return result

    async def _process_batch(self):
        """Process accumulated requests as a batch."""

        # Wait for more requests or timeout
        await asyncio.sleep(self.max_wait_ms / 1000)

        if not self.pending_requests:
            return

        # Get all pending requests
        batch = self.pending_requests[:]
        self.pending_requests.clear()

        # Prepare batch input
        import pandas as pd
        batch_features = pd.DataFrame([r["features"] for r in batch])

        # Run batch prediction
        predictions = self.model.predict(batch_features)

        # Distribute results
        for i, request in enumerate(batch):
            request["future"].set_result({
                "prediction": predictions[i].tolist() if hasattr(predictions[i], 'tolist') else predictions[i],
                "batch_size": len(batch)
            })
```

## Pattern 6: Model Ensembling

```python
import numpy as np
from typing import List, Dict

class EnsembleInferenceServer:
    """Serve ensemble of models."""

    def __init__(self, models: Dict[str, any], weights: Dict[str, float] = None):
        self.models = models
        self.weights = weights or {name: 1.0 / len(models) for name in models}

    async def predict(
        self,
        features: dict,
        ensemble_method: str = "weighted_average"
    ) -> dict:
        """Run ensemble prediction."""

        # Get predictions from all models
        predictions = {}
        for name, model in self.models.items():
            predictions[name] = model.predict([features])[0]

        # Combine predictions
        if ensemble_method == "weighted_average":
            combined = sum(
                pred * self.weights[name]
                for name, pred in predictions.items()
            )
        elif ensemble_method == "voting":
            # For classification
            votes = [np.argmax(pred) for pred in predictions.values()]
            combined = max(set(votes), key=votes.count)
        elif ensemble_method == "stacking":
            # Use meta-model
            stacked_features = np.concatenate(list(predictions.values()))
            combined = self.meta_model.predict([stacked_features])[0]

        return {
            "prediction": combined,
            "model_predictions": predictions,
            "ensemble_method": ensemble_method
        }
```

Online inference requires careful attention to latency, reliability, and scalability. Choose patterns based on your specific requirements and constraints.

## Resources

- [Azure ML Online Endpoints](https://learn.microsoft.com/en-us/azure/machine-learning/concept-endpoints-online)
- [Feast Feature Store](https://docs.feast.dev/)
- [Model Serving Best Practices](https://learn.microsoft.com/en-us/azure/machine-learning/how-to-deploy-online-endpoints)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
