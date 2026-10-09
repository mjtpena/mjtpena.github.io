---
title: "Federated Learning: Privacy-Preserving Machine Learning"
description: "Federated learning in 2021 moved from research to practical deployment. Healthcare, finance, and mobile applications led adoption where data privacy is…"
author: Michael John Pena
draft: false
date: 2021-12-22
tags:
  - Federated Learning
  - Privacy
  - Machine Learning
  - Distributed Systems
  - Data Privacy
---

## The Federated Learning Paradigm

Instead of centralizing data:
1. Model is sent to data sources
2. Local training on each source
3. Only model updates are shared
4. Central server aggregates updates

```python
import numpy as np
from dataclasses import dataclass
from typing import List, Dict
import copy

@dataclass
class ModelUpdate:
    client_id: str
    weights: Dict[str, np.ndarray]
    num_samples: int
    metrics: Dict[str, float]

class FederatedServer:
    """Central federated learning server"""

    def __init__(self, model_architecture):
        self.global_model = model_architecture
        self.round_number = 0
        self.client_updates: List[ModelUpdate] = []

    def get_global_weights(self) -> Dict[str, np.ndarray]:
        """Get current global model weights"""
        return {
            name: param.copy()
            for name, param in self.global_model.items()
        }

    def receive_update(self, update: ModelUpdate):
        """Receive model update from a client"""
        self.client_updates.append(update)

    def aggregate_updates(self, strategy: str = "fedavg") -> Dict[str, np.ndarray]:
        """Aggregate client updates into new global model"""

        if not self.client_updates:
            return self.global_model

        if strategy == "fedavg":
            # Federated Averaging - weighted by number of samples
            return self._federated_averaging()
        elif strategy == "fedprox":
            # FedProx with proximal term
            return self._federated_proximal()
        else:
            raise ValueError(f"Unknown strategy: {strategy}")

    def _federated_averaging(self) -> Dict[str, np.ndarray]:
        """Standard Federated Averaging algorithm"""
        total_samples = sum(u.num_samples for u in self.client_updates)
        new_weights = {}

        for param_name in self.global_model.keys():
            weighted_sum = np.zeros_like(self.global_model[param_name])

            for update in self.client_updates:
                weight = update.num_samples / total_samples
                weighted_sum += weight * update.weights[param_name]

            new_weights[param_name] = weighted_sum

        # Update global model
        self.global_model = new_weights
        self.round_number += 1
        self.client_updates = []

        return new_weights

    def select_clients(
        self,
        available_clients: List[str],
        fraction: float = 0.1
    ) -> List[str]:
        """Select clients for this round"""
        num_clients = max(1, int(len(available_clients) * fraction))
        return np.random.choice(
            available_clients,
            size=num_clients,
            replace=False
        ).tolist()


class FederatedClient:
    """Federated learning client"""

    def __init__(self, client_id: str, local_data, local_labels):
        self.client_id = client_id
        self.local_data = local_data
        self.local_labels = local_labels
        self.model = None

    def receive_model(self, weights: Dict[str, np.ndarray]):
        """Receive global model from server"""
        self.model = copy.deepcopy(weights)

    def train_locally(
        self,
        epochs: int = 5,
        learning_rate: float = 0.01,
        batch_size: int = 32
    ) -> ModelUpdate:
        """Train model on local data"""

        # Simulate local training
        # In practice, this would be actual gradient descent

        updated_weights = {}
        for name, param in self.model.items():
            # Simulate gradient update
            gradient = np.random.randn(*param.shape) * 0.01
            updated_weights[name] = param - learning_rate * gradient

        # Calculate local metrics
        metrics = {
            "loss": np.random.uniform(0.1, 0.5),
            "accuracy": np.random.uniform(0.7, 0.95)
        }

        return ModelUpdate(
            client_id=self.client_id,
            weights=updated_weights,
            num_samples=len(self.local_data),
            metrics=metrics
        )
```

## Implementing Secure Aggregation

```python
import hashlib
import secrets
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.backends import default_backend

class SecureAggregator:
    """Secure aggregation protocol for federated learning"""

    def __init__(self, num_clients: int, threshold: int):
        self.num_clients = num_clients
        self.threshold = threshold  # Minimum clients needed
        self.client_keys = {}

    def generate_pairwise_masks(
        self,
        client_id: str,
        other_clients: List[str],
        round_number: int
    ) -> Dict[str, np.ndarray]:
        """Generate pairwise random masks for secure aggregation"""

        masks = {}
        for other_id in other_clients:
            if other_id == client_id:
                continue

            # Derive shared seed from client pair
            seed = self._derive_shared_seed(client_id, other_id, round_number)

            # Generate mask
            rng = np.random.RandomState(seed)
            mask_shape = (1000,)  # Shape of model updates
            mask = rng.randn(*mask_shape)

            # One client adds, other subtracts (determined by ID ordering)
            if client_id < other_id:
                masks[other_id] = mask
            else:
                masks[other_id] = -mask

        return masks

    def _derive_shared_seed(
        self,
        client1: str,
        client2: str,
        round_number: int
    ) -> int:
        """Derive deterministic shared seed between two clients"""
        # Sort client IDs for consistency
        sorted_ids = sorted([client1, client2])
        seed_input = f"{sorted_ids[0]}:{sorted_ids[1]}:{round_number}"
        hash_value = hashlib.sha256(seed_input.encode()).digest()
        return int.from_bytes(hash_value[:4], 'big')

    def mask_update(
        self,
        update: np.ndarray,
        masks: Dict[str, np.ndarray]
    ) -> np.ndarray:
        """Apply masks to model update"""
        masked = update.copy()
        for mask in masks.values():
            masked += mask
        return masked

    def aggregate_masked_updates(
        self,
        masked_updates: Dict[str, np.ndarray]
    ) -> np.ndarray:
        """Aggregate masked updates - masks cancel out"""
        # When all pairs are present, masks sum to zero
        return sum(masked_updates.values()) / len(masked_updates)


class DifferentialPrivacyMechanism:
    """Add differential privacy to federated learning"""

    def __init__(self, epsilon: float, delta: float, sensitivity: float):
        self.epsilon = epsilon
        self.delta = delta
        self.sensitivity = sensitivity

    def add_noise(self, gradients: np.ndarray) -> np.ndarray:
        """Add calibrated Gaussian noise for differential privacy"""
        # Calculate noise scale
        sigma = self.sensitivity * np.sqrt(2 * np.log(1.25 / self.delta)) / self.epsilon

        # Add Gaussian noise
        noise = np.random.normal(0, sigma, gradients.shape)
        return gradients + noise

    def clip_gradients(
        self,
        gradients: np.ndarray,
        max_norm: float
    ) -> np.ndarray:
        """Clip gradients to bound sensitivity"""
        norm = np.linalg.norm(gradients)
        if norm > max_norm:
            gradients = gradients * (max_norm / norm)
        return gradients
```

## Federated Learning with Azure

```python
from azure.ai.ml import MLClient
from azure.identity import DefaultAzureCredential

class AzureFederatedLearning:
    """Federated learning using Azure ML"""

    def __init__(self, workspace_name: str, resource_group: str, subscription_id: str):
        self.ml_client = MLClient(
            DefaultAzureCredential(),
            subscription_id,
            resource_group,
            workspace_name
        )

    def create_federated_job(
        self,
        num_clients: int,
        rounds: int,
        client_data_stores: List[str]
    ):
        """Create federated learning job"""

        from azure.ai.ml import command
        from azure.ai.ml.entities import Environment

        # Define the training component
        training_component = command(
            name="federated_training_round",
            display_name="Federated Training Round",
            inputs={
                "global_model": {"type": "uri_folder"},
                "local_data": {"type": "uri_folder"},
                "round_number": {"type": "integer"},
                "learning_rate": {"type": "number", "default": 0.01}
            },
            outputs={
                "model_update": {"type": "uri_folder"}
            },
            code="./src/federated",
            command="""
                python train_local.py \
                    --global-model ${{inputs.global_model}} \
                    --local-data ${{inputs.local_data}} \
                    --round ${{inputs.round_number}} \
                    --lr ${{inputs.learning_rate}} \
                    --output ${{outputs.model_update}}
            """,
            environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu:1"
        )

        # Define aggregation component
        aggregation_component = command(
            name="aggregate_updates",
            display_name="Aggregate Model Updates",
            inputs={
                "client_updates": {"type": "uri_folder"},
                "aggregation_strategy": {"type": "string", "default": "fedavg"}
            },
            outputs={
                "aggregated_model": {"type": "uri_folder"}
            },
            code="./src/federated",
            command="""
                python aggregate.py \
                    --updates ${{inputs.client_updates}} \
                    --strategy ${{inputs.aggregation_strategy}} \
                    --output ${{outputs.aggregated_model}}
            """,
            environment="AzureML-sklearn-1.0-ubuntu20.04-py38-cpu:1"
        )

        return {
            "training": training_component,
            "aggregation": aggregation_component
        }
```

## Cross-Silo vs Cross-Device

```python
# Cross-silo: Few clients with large data (hospitals, banks)
class CrossSiloFederation:
    """Federation across organizational silos"""

    def __init__(self, organizations: List[str]):
        self.organizations = organizations
        self.sync_frequency = "per_round"  # Synchronous updates
        self.min_participants = len(organizations)  # All must participate

    def coordinate_round(self):
        """Coordinate a training round across silos"""
        # Wait for all organizations
        # Exchange encrypted model updates
        # Aggregate using secure multi-party computation
        pass


# Cross-device: Many clients with small data (phones, IoT)
class CrossDeviceFederation:
    """Federation across edge devices"""

    def __init__(self, min_devices: int = 100):
        self.min_devices = min_devices
        self.sync_frequency = "async"  # Asynchronous updates
        self.dropout_tolerance = 0.3  # 30% can drop out

    def coordinate_round(self, available_devices: List[str]):
        """Coordinate training across available devices"""
        # Sample subset of devices
        # Handle device dropouts gracefully
        # Use compressed communication
        pass
```

## Federated Learning Best Practices

```yaml
best_practices:
  data_handling:
    - Never transfer raw data
    - Validate data locally before training
    - Handle non-IID data distributions
    - Account for varying data quantities

  privacy:
    - Use secure aggregation
    - Apply differential privacy
    - Minimize model updates information
    - Audit privacy guarantees

  communication:
    - Compress model updates
    - Use gradient compression
    - Batch communication rounds
    - Handle network failures

  model:
    - Start with simple models
    - Use transfer learning when possible
    - Regularize to handle heterogeneity
    - Monitor for model divergence

  security:
    - Verify client authenticity
    - Detect poisoning attacks
    - Validate update contributions
    - Implement Byzantine fault tolerance
```

## Key Federated Learning Considerations

1. **Data Heterogeneity**: Non-IID data across clients is challenging
2. **Communication Costs**: Model updates can be large
3. **Client Reliability**: Devices may drop out mid-training
4. **Privacy Guarantees**: Quantify actual privacy protection
5. **Model Quality**: May not match centralized training

Federated learning in 2021 moved from research to practical deployment. Healthcare, finance, and mobile applications led adoption where data privacy is paramount.

## Resources

- [TensorFlow Federated](https://www.tensorflow.org/federated)
- [PySyft](https://github.com/OpenMined/PySyft)
- [Flower Framework](https://flower.dev/)
- [Federated Learning Paper](https://arxiv.org/abs/1602.05629)
