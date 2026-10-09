---
title: "AI Explainability: Making the Black Box Transparent"
description: "Explainability techniques are not one-size-fits-all: explanations that help a clinician are different from what helps a product manager. My rule is to pick…"
author: "Michael John Peña"
draft: false
date: 2023-12-13
tags: ["AI", "Explainability", "XAI", "Interpretability", "Machine Learning"]
---

Explainability techniques are not one-size-fits-all: explanations that help a clinician are different from what helps a product manager. My rule is to pick the modality that solves the stakeholder's question — feature attribution for debugging, counterfactuals for recourse, and example-based explanations for sanity checks.

## Types of Explainability

## Types of Explainability

```python
from dataclasses import dataclass
from typing import List, Dict, Callable, Any
from enum import Enum

class ExplainabilityType(Enum):
    GLOBAL = "Global - Overall model behavior"
    LOCAL = "Local - Individual prediction"
    COUNTERFACTUAL = "Counterfactual - What-if scenarios"
    EXAMPLE_BASED = "Example-based - Similar cases"

class ModelFamily(Enum):
    LINEAR = "Linear Models"
    TREE = "Tree-based Models"
    NEURAL_NETWORK = "Neural Networks"
    ENSEMBLE = "Ensemble Methods"
    LLM = "Large Language Models"

@dataclass
class ExplainabilityMethod:
    name: str
    type: ExplainabilityType
    model_agnostic: bool
    best_for: List[ModelFamily]
    complexity: str
    description: str

explainability_methods = {
    "feature_importance": ExplainabilityMethod(
        name="Feature Importance",
        type=ExplainabilityType.GLOBAL,
        model_agnostic=True,
        best_for=[ModelFamily.TREE, ModelFamily.ENSEMBLE],
        complexity="Low",
        description="Ranks features by their contribution to predictions"
    ),
    "shap": ExplainabilityMethod(
        name="SHAP (SHapley Additive exPlanations)",
        type=ExplainabilityType.LOCAL,
        model_agnostic=True,
        best_for=[ModelFamily.TREE, ModelFamily.NEURAL_NETWORK, ModelFamily.ENSEMBLE],
        complexity="Medium",
        description="Game-theoretic approach to feature attribution"
    ),
    "lime": ExplainabilityMethod(
        name="LIME (Local Interpretable Model-agnostic Explanations)",
        type=ExplainabilityType.LOCAL,
        model_agnostic=True,
        best_for=[ModelFamily.NEURAL_NETWORK, ModelFamily.ENSEMBLE],
        complexity="Medium",
        description="Fits interpretable model locally around prediction"
    ),
    "counterfactual": ExplainabilityMethod(
        name="Counterfactual Explanations",
        type=ExplainabilityType.COUNTERFACTUAL,
        model_agnostic=True,
        best_for=[ModelFamily.TREE, ModelFamily.NEURAL_NETWORK],
        complexity="Medium",
        description="Shows minimal changes needed for different outcome"
    ),
    "attention": ExplainabilityMethod(
        name="Attention Visualization",
        type=ExplainabilityType.LOCAL,
        model_agnostic=False,
        best_for=[ModelFamily.NEURAL_NETWORK, ModelFamily.LLM],
        complexity="Low",
        description="Shows which inputs the model focuses on"
    ),
    "chain_of_thought": ExplainabilityMethod(
        name="Chain-of-Thought Prompting",
        type=ExplainabilityType.LOCAL,
        model_agnostic=False,
        best_for=[ModelFamily.LLM],
        complexity="Low",
        description="Prompts LLM to show reasoning steps"
    )
}
```

## Implementing SHAP Explanations

```python
import numpy as np
from typing import List, Dict, Tuple

class SHAPExplainer:
    """Simplified SHAP implementation for educational purposes."""

    def __init__(self, model: Callable, background_data: np.ndarray, feature_names: List[str]):
        self.model = model
        self.background_data = background_data
        self.feature_names = feature_names
        self.expected_value = np.mean(self.model(background_data))

    def explain_instance(
        self,
        instance: np.ndarray,
        num_samples: int = 100
    ) -> Dict:
        """Calculate SHAP values for a single instance."""
        num_features = len(instance)
        shap_values = np.zeros(num_features)

        # Approximate Shapley values using sampling
        for _ in range(num_samples):
            # Random feature order
            order = np.random.permutation(num_features)

            # Calculate marginal contributions
            for i, feature_idx in enumerate(order):
                # Features before this one in the order
                features_before = order[:i]

                # Create two instances: with and without this feature
                instance_without = self._create_coalition(instance, features_before)
                instance_with = self._create_coalition(instance, np.append(features_before, feature_idx))

                # Marginal contribution
                contribution = self.model(instance_with.reshape(1, -1))[0] - \
                             self.model(instance_without.reshape(1, -1))[0]
                shap_values[feature_idx] += contribution

        shap_values /= num_samples

        return {
            "instance": instance.tolist(),
            "prediction": float(self.model(instance.reshape(1, -1))[0]),
            "expected_value": float(self.expected_value),
            "shap_values": {
                name: float(val)
                for name, val in zip(self.feature_names, shap_values)
            },
            "feature_contributions": self._format_contributions(shap_values)
        }

    def _create_coalition(self, instance: np.ndarray, feature_indices: np.ndarray) -> np.ndarray:
        """Create instance with only specified features from original, rest from background."""
        # Use random background sample
        bg_idx = np.random.randint(len(self.background_data))
        coalition = self.background_data[bg_idx].copy()

        # Replace specified features with instance values
        for idx in feature_indices:
            coalition[idx] = instance[idx]

        return coalition

    def _format_contributions(self, shap_values: np.ndarray) -> List[Dict]:
        """Format SHAP values as readable contributions."""
        contributions = []
        for name, value in zip(self.feature_names, shap_values):
            contributions.append({
                "feature": name,
                "contribution": float(value),
                "direction": "increases" if value > 0 else "decreases",
                "magnitude": abs(float(value))
            })

        # Sort by magnitude
        contributions.sort(key=lambda x: x["magnitude"], reverse=True)
        return contributions

    def generate_explanation_text(self, explanation: Dict) -> str:
        """Generate human-readable explanation."""
        text = f"""
## Prediction Explanation

**Predicted Value:** {explanation['prediction']:.3f}
**Baseline (Average):** {explanation['expected_value']:.3f}
**Difference from Baseline:** {explanation['prediction'] - explanation['expected_value']:.3f}

### Key Factors

"""
        for i, contrib in enumerate(explanation['feature_contributions'][:5], 1):
            direction_text = "pushes the prediction higher" if contrib['direction'] == "increases" else "pushes the prediction lower"
            text += f"{i}. **{contrib['feature']}**: {direction_text} by {contrib['magnitude']:.3f}\n"

        return text
```

## LLM Explainability

```python
class LLMExplainer:
    """Explainability techniques for Large Language Models."""

    def __init__(self, llm_client: Any):
        self.client = llm_client

    def chain_of_thought_prompt(
        self,
        query: str,
        context: str = None
    ) -> Dict:
        """Generate response with chain-of-thought reasoning."""
        prompt = f"""
Please answer the following question by thinking through it step by step.

{f'Context: {context}' if context else ''}

Question: {query}

Let's approach this systematically:

Step 1: First, let me understand what's being asked...
Step 2: Let me consider the relevant information...
Step 3: Now I'll work through the reasoning...
Step 4: Based on this analysis, my answer is...

Provide your reasoning, then your final answer.
"""

        response = self._call_llm(prompt)

        return {
            "query": query,
            "response": response,
            "explanation_type": "Chain of Thought",
            "reasoning_visible": True
        }

    def self_explanation_prompt(
        self,
        query: str,
        response: str
    ) -> str:
        """Ask the LLM to explain its own response."""
        prompt = f"""
You previously gave this response to a question:

Question: {query}
Response: {response}

Now, please explain:
1. What key information led to this response?
2. What assumptions did you make?
3. What are the limitations of this response?
4. How confident are you in this response (1-10)?
"""

        return self._call_llm(prompt)

    def extract_key_factors(
        self,
        query: str,
        response: str,
        context: str
    ) -> List[Dict]:
        """Extract key factors that influenced the response."""
        prompt = f"""
Analyze what factors most influenced this response:

Context provided: {context}
Question: {query}
Response given: {response}

List the top 5 factors from the context that most influenced the response.
Format as JSON: [{{"factor": "description", "importance": "high/medium/low"}}]
"""

        factors_response = self._call_llm(prompt)

        # Parse JSON (simplified)
        try:
            import json
            return json.loads(factors_response)
        except:
            return [{"factor": "Unable to parse factors", "importance": "unknown"}]

    def _call_llm(self, prompt: str) -> str:
        """Call the LLM (placeholder for actual implementation)."""
        # In production, call actual LLM API
        return "LLM response placeholder"

    def generate_citation_explanation(
        self,
        response: str,
        sources: List[Dict]
    ) -> str:
        """Generate explanation with source citations."""
        explanation = f"""
## Response

{response}

## Sources Used

This response was generated using information from the following sources:

"""
        for i, source in enumerate(sources, 1):
            explanation += f"""
### Source {i}: {source.get('title', 'Unknown')}
- **Relevance Score:** {source.get('relevance', 'N/A')}
- **Key Content:** {source.get('excerpt', 'N/A')[:200]}...
"""

        explanation += """
## Confidence Assessment

Based on the available sources, this response has [HIGH/MEDIUM/LOW] confidence.
"""
        return explanation
```

## Explanation Quality Metrics

```python
class ExplanationEvaluator:
    """Evaluate the quality of explanations."""

    def evaluate_fidelity(
        self,
        model: Callable,
        instance: np.ndarray,
        explanation: Dict
    ) -> float:
        """Measure how well explanation matches model behavior."""
        # Remove top features and check prediction change
        top_features = explanation.get("feature_contributions", [])[:3]
        top_indices = [f.get("feature_index") for f in top_features if "feature_index" in f]

        if not top_indices:
            return 0.0

        original_pred = model(instance.reshape(1, -1))[0]

        # Zero out top features
        modified = instance.copy()
        modified[top_indices] = 0

        modified_pred = model(modified.reshape(1, -1))[0]

        # Higher change = higher fidelity
        return abs(original_pred - modified_pred) / abs(original_pred) if original_pred != 0 else 0

    def evaluate_stability(
        self,
        explainer: Any,
        instance: np.ndarray,
        num_runs: int = 5
    ) -> float:
        """Measure consistency of explanations."""
        explanations = []
        for _ in range(num_runs):
            exp = explainer.explain_instance(instance)
            explanations.append(exp)

        # Compare top features across runs
        top_features_sets = [
            set([c["feature"] for c in exp["feature_contributions"][:3]])
            for exp in explanations
        ]

        # Calculate Jaccard similarity
        total_similarity = 0
        comparisons = 0
        for i in range(len(top_features_sets)):
            for j in range(i + 1, len(top_features_sets)):
                intersection = len(top_features_sets[i] & top_features_sets[j])
                union = len(top_features_sets[i] | top_features_sets[j])
                total_similarity += intersection / union if union > 0 else 0
                comparisons += 1

        return total_similarity / comparisons if comparisons > 0 else 0

    def evaluate_comprehensibility(
        self,
        explanation_text: str
    ) -> Dict:
        """Evaluate human comprehensibility of explanation."""
        # Simple heuristics (in production, use user studies)
        word_count = len(explanation_text.split())
        sentence_count = explanation_text.count('.') + explanation_text.count('!')
        avg_sentence_length = word_count / sentence_count if sentence_count > 0 else word_count

        return {
            "word_count": word_count,
            "sentence_count": sentence_count,
            "avg_sentence_length": avg_sentence_length,
            "readability_score": 100 - avg_sentence_length * 2,  # Simplified
            "has_examples": "example" in explanation_text.lower(),
            "has_comparisons": "compared to" in explanation_text.lower() or "versus" in explanation_text.lower()
        }
```

Tomorrow, we'll explore Microsoft Fabric adoption strategies!
