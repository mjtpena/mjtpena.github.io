---
title: "Differential Privacy in Machine Learning: Protecting Individual Data"
author: Michael John Pena
draft: false
date: 2021-12-23
tags:
  - Differential Privacy
  - Privacy
  - Machine Learning
  - Security
  - Data Protection

---

I wrote "Differential Privacy in Machine Learning: Protecting Individual Data" to share practical, production-minded guidance on this topic.

## Understanding Differential Privacy

Differential privacy ensures that the output of a computation doesn't reveal whether any individual's data was included. The key insight: add calibrated noise to make individual records statistically indistinguishable.

```python
import numpy as np
from typing import Callable, Any
from dataclasses import dataclass

@dataclass
class PrivacyBudget:
    epsilon: float  # Privacy loss parameter
    delta: float    # Probability of privacy breach

    def __post_init__(self):
        assert self.epsilon > 0, "Epsilon must be positive"
        assert 0 <= self.delta < 1, "Delta must be in [0, 1)"

    def is_exhausted(self) -> bool:
        return self.epsilon <= 0

    def consume(self, epsilon_cost: float):
        self.epsilon -= epsilon_cost


class DifferentialPrivacy:
    """Core differential privacy mechanisms"""

    @staticmethod
    def laplace_mechanism(
        value: float,
        sensitivity: float,
        epsilon: float
    ) -> float:
        """Add Laplace noise for epsilon-differential privacy"""
        scale = sensitivity / epsilon
        noise = np.random.laplace(0, scale)
        return value + noise

    @staticmethod
    def gaussian_mechanism(
        value: float,
        sensitivity: float,
        epsilon: float,
        delta: float
    ) -> float:
        """Add Gaussian noise for (epsilon, delta)-differential privacy"""
        sigma = sensitivity * np.sqrt(2 * np.log(1.25 / delta)) / epsilon
        noise = np.random.normal(0, sigma)
        return value + noise

    @staticmethod
    def exponential_mechanism(
        items: list,
        quality_function: Callable[[Any], float],
        sensitivity: float,
        epsilon: float
    ) -> Any:
        """Select item with probability proportional to quality"""
        scores = [quality_function(item) for item in items]

        # Calculate selection probabilities
        probabilities = np.exp(
            epsilon * np.array(scores) / (2 * sensitivity)
        )
        probabilities /= probabilities.sum()

        # Sample according to probabilities
        return np.random.choice(items, p=probabilities)


class PrivateQueryEngine:
    """Execute differentially private queries"""

    def __init__(self, data: np.ndarray, budget: PrivacyBudget):
        self.data = data
        self.budget = budget

    def count(self, condition: Callable[[Any], bool], epsilon: float) -> int:
        """Private count query"""
        if epsilon > self.budget.epsilon:
            raise ValueError("Insufficient privacy budget")

        true_count = sum(1 for row in self.data if condition(row))
        sensitivity = 1  # Adding/removing one person changes count by 1

        private_count = DifferentialPrivacy.laplace_mechanism(
            true_count, sensitivity, epsilon
        )

        self.budget.consume(epsilon)
        return max(0, round(private_count))

    def mean(
        self,
        column: int,
        lower_bound: float,
        upper_bound: float,
        epsilon: float
    ) -> float:
        """Private mean query with bounded sensitivity"""
        if epsilon > self.budget.epsilon:
            raise ValueError("Insufficient privacy budget")

        # Clip values to bounds
        clipped = np.clip(self.data[:, column], lower_bound, upper_bound)
        true_mean = np.mean(clipped)

        # Sensitivity of mean with bounded values
        sensitivity = (upper_bound - lower_bound) / len(self.data)

        private_mean = DifferentialPrivacy.laplace_mechanism(
            true_mean, sensitivity, epsilon
        )

        self.budget.consume(epsilon)
        return np.clip(private_mean, lower_bound, upper_bound)

    def histogram(
        self,
        column: int,
        bins: list,
        epsilon: float
    ) -> dict:
        """Private histogram query"""
        if epsilon > self.budget.epsilon:
            raise ValueError("Insufficient privacy budget")

        # Calculate true histogram
        hist, _ = np.histogram(self.data[:, column], bins=bins)

        # Add noise to each bin (sensitivity = 1 per bin)
        epsilon_per_bin = epsilon / len(hist)  # Split budget across bins
        private_hist = [
            max(0, round(DifferentialPrivacy.laplace_mechanism(
                count, 1, epsilon_per_bin
            )))
            for count in hist
        ]

        self.budget.consume(epsilon)
        return dict(zip(bins[:-1], private_hist))
```

## Differentially Private Machine Learning

```python
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from opacus import PrivacyEngine

class DifferentiallyPrivateTrainer:
    """Train neural networks with differential privacy"""

    def __init__(
        self,
        model: nn.Module,
        target_epsilon: float,
        target_delta: float,
        max_grad_norm: float = 1.0
    ):
        self.model = model
        self.target_epsilon = target_epsilon
        self.target_delta = target_delta
        self.max_grad_norm = max_grad_norm
        self.privacy_engine = None

    def prepare_for_private_training(
        self,
        optimizer: torch.optim.Optimizer,
        data_loader: DataLoader,
        epochs: int
    ):
        """Attach privacy engine to model and optimizer"""

        self.privacy_engine = PrivacyEngine()

        self.model, optimizer, data_loader = self.privacy_engine.make_private_with_epsilon(
            module=self.model,
            optimizer=optimizer,
            data_loader=data_loader,
            epochs=epochs,
            target_epsilon=self.target_epsilon,
            target_delta=self.target_delta,
            max_grad_norm=self.max_grad_norm
        )

        return self.model, optimizer, data_loader

    def train_epoch(
        self,
        data_loader: DataLoader,
        optimizer: torch.optim.Optimizer,
        criterion: nn.Module
    ):
        """Train one epoch with DP-SGD"""
        self.model.train()
        total_loss = 0

        for batch_idx, (data, target) in enumerate(data_loader):
            optimizer.zero_grad()
            output = self.model(data)
            loss = criterion(output, target)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()

        # Get current privacy spent
        epsilon = self.privacy_engine.get_epsilon(self.target_delta)
        print(f"Current epsilon: {epsilon:.2f}")

        return total_loss / len(data_loader)

    def get_privacy_spent(self) -> tuple:
        """Get total privacy budget spent"""
        epsilon = self.privacy_engine.get_epsilon(self.target_delta)
        return epsilon, self.target_delta


# Example usage
def train_private_model():
    # Define model
    model = nn.Sequential(
        nn.Linear(784, 256),
        nn.ReLU(),
        nn.Linear(256, 10)
    )

    # Create trainer with privacy budget
    trainer = DifferentiallyPrivateTrainer(
        model=model,
        target_epsilon=3.0,  # Total privacy budget
        target_delta=1e-5,   # Probability of breach
        max_grad_norm=1.0    # Gradient clipping
    )

    # Prepare for private training
    optimizer = torch.optim.SGD(model.parameters(), lr=0.1)
    train_loader = DataLoader(train_dataset, batch_size=64)

    model, optimizer, train_loader = trainer.prepare_for_private_training(
        optimizer, train_loader, epochs=10
    )

    # Train
    for epoch in range(10):
        loss = trainer.train_epoch(train_loader, optimizer, nn.CrossEntropyLoss())
        epsilon, delta = trainer.get_privacy_spent()
        print(f"Epoch {epoch}: Loss={loss:.4f}, Epsilon={epsilon:.2f}")
```

## Privacy Budget Management

```python
from dataclasses import dataclass, field
from datetime import datetime
from typing import List
import json

@dataclass
class PrivacyQuery:
    query_id: str
    timestamp: datetime
    query_type: str
    epsilon_cost: float
    description: str

@dataclass
class PrivacyAccountant:
    """Track and manage privacy budget across queries"""

    total_epsilon: float
    total_delta: float
    queries: List[PrivacyQuery] = field(default_factory=list)

    @property
    def epsilon_spent(self) -> float:
        return sum(q.epsilon_cost for q in self.queries)

    @property
    def epsilon_remaining(self) -> float:
        return self.total_epsilon - self.epsilon_spent

    def can_afford(self, epsilon_cost: float) -> bool:
        return self.epsilon_remaining >= epsilon_cost

    def record_query(
        self,
        query_type: str,
        epsilon_cost: float,
        description: str
    ) -> str:
        """Record a privacy-consuming query"""
        if not self.can_afford(epsilon_cost):
            raise ValueError(
                f"Insufficient budget. Remaining: {self.epsilon_remaining:.4f}, "
                f"Requested: {epsilon_cost:.4f}"
            )

        query_id = f"q_{len(self.queries)}_{int(datetime.now().timestamp())}"
        query = PrivacyQuery(
            query_id=query_id,
            timestamp=datetime.now(),
            query_type=query_type,
            epsilon_cost=epsilon_cost,
            description=description
        )
        self.queries.append(query)
        return query_id

    def get_report(self) -> dict:
        """Generate privacy budget report"""
        return {
            "total_epsilon": self.total_epsilon,
            "total_delta": self.total_delta,
            "epsilon_spent": self.epsilon_spent,
            "epsilon_remaining": self.epsilon_remaining,
            "utilization_pct": (self.epsilon_spent / self.total_epsilon) * 100,
            "num_queries": len(self.queries),
            "queries": [
                {
                    "id": q.query_id,
                    "type": q.query_type,
                    "cost": q.epsilon_cost,
                    "description": q.description,
                    "timestamp": q.timestamp.isoformat()
                }
                for q in self.queries
            ]
        }

    def to_json(self) -> str:
        return json.dumps(self.get_report(), indent=2)


class PrivacyBudgetAllocator:
    """Allocate privacy budget across use cases"""

    def __init__(self, yearly_budget: float, delta: float = 1e-6):
        self.yearly_budget = yearly_budget
        self.delta = delta
        self.allocations = {}

    def allocate(self, use_case: str, percentage: float) -> PrivacyAccountant:
        """Allocate percentage of budget to use case"""
        epsilon = self.yearly_budget * (percentage / 100)
        accountant = PrivacyAccountant(
            total_epsilon=epsilon,
            total_delta=self.delta
        )
        self.allocations[use_case] = accountant
        return accountant

    def get_overall_status(self) -> dict:
        """Get status across all allocations"""
        return {
            "yearly_budget": self.yearly_budget,
            "allocations": {
                use_case: acc.get_report()
                for use_case, acc in self.allocations.items()
            }
        }


# Usage
allocator = PrivacyBudgetAllocator(yearly_budget=10.0)

# Allocate budget
analytics_budget = allocator.allocate("analytics", 40)
ml_training_budget = allocator.allocate("ml_training", 50)
adhoc_budget = allocator.allocate("adhoc_queries", 10)

# Use budget
analytics_budget.record_query(
    "count", 0.1, "Count users by region"
)
analytics_budget.record_query(
    "mean", 0.5, "Average transaction amount"
)

print(analytics_budget.get_report())
```

## Local Differential Privacy

```python
class LocalDifferentialPrivacy:
    """Client-side differential privacy (no trusted curator)"""

    @staticmethod
    def randomized_response(
        true_value: bool,
        epsilon: float
    ) -> bool:
        """Randomized response for binary data"""
        # Probability of telling truth
        p_truth = np.exp(epsilon) / (1 + np.exp(epsilon))

        if np.random.random() < p_truth:
            return true_value
        else:
            return not true_value

    @staticmethod
    def estimate_true_proportion(
        noisy_responses: List[bool],
        epsilon: float
    ) -> float:
        """Estimate true proportion from randomized responses"""
        p = np.exp(epsilon) / (1 + np.exp(epsilon))
        observed_proportion = sum(noisy_responses) / len(noisy_responses)

        # Correct for randomization
        true_proportion = (observed_proportion - (1 - p)) / (2 * p - 1)
        return np.clip(true_proportion, 0, 1)

    @staticmethod
    def rappor_encode(
        value: str,
        num_bits: int,
        epsilon_permanent: float,
        epsilon_instantaneous: float
    ) -> list:
        """RAPPOR encoding for string values"""
        # Hash value to bit array
        bloom_filter = [0] * num_bits
        for i in range(3):  # Use 3 hash functions
            h = hash(f"{value}_{i}") % num_bits
            bloom_filter[h] = 1

        # Permanent randomization
        p_perm = 0.5 * (1 + np.exp(-epsilon_permanent / 2))
        permanent_response = [
            bit if np.random.random() < p_perm else 1 - bit
            for bit in bloom_filter
        ]

        # Instantaneous randomization
        p_inst = 0.5 * (1 + np.exp(-epsilon_instantaneous / 2))
        instantaneous_response = [
            bit if np.random.random() < p_inst else 1 - bit
            for bit in permanent_response
        ]

        return instantaneous_response
```

## Key Differential Privacy Principles

1. **Privacy Budget**: Total privacy loss is cumulative
2. **Composition**: Multiple queries compound privacy loss
3. **Sensitivity**: How much one person can change the output
4. **Noise Calibration**: More noise = more privacy, less utility
5. **Post-Processing**: DP results stay private after transformation

Differential privacy in 2021 became accessible through libraries like Opacus and Google's DP library. The challenge is balancing privacy with utility for real applications.

## Resources

- [Opacus (PyTorch DP)](https://opacus.ai/)
- [Google DP Library](https://github.com/google/differential-privacy)
- [The Algorithmic Foundations of DP](https://www.cis.upenn.edu/~aaroth/Papers/privacybook.pdf)
- [Apple's Local DP](https://www.apple.com/privacy/docs/Differential_Privacy_Overview.pdf)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
