---
title: "Quality-Based LLM Routing: Maximizing Output Quality"
author: Michael John Peña
draft: false
date: 2024-07-08
tags:
  - AI
  - LLM
  - Quality
  - Azure
  - Evaluation

---

I wrote "Quality-Based LLM Routing: Maximizing Output Quality" to share practical, production-minded guidance on this topic.

## Defining Quality Dimensions

Quality isn't one-dimensional. Consider:

- **Accuracy**: Factual correctness
- **Completeness**: Covering all aspects
- **Coherence**: Logical flow and consistency
- **Relevance**: Addressing the actual question
- **Safety**: Avoiding harmful outputs
- **Format Compliance**: Following requested structure

```python
from dataclasses import dataclass
from enum import Enum
from typing import Optional

class QualityDimension(Enum):
    ACCURACY = "accuracy"
    COMPLETENESS = "completeness"
    COHERENCE = "coherence"
    RELEVANCE = "relevance"
    SAFETY = "safety"
    FORMAT = "format"

@dataclass
class QualityRequirements:
    min_accuracy: float = 0.8
    min_completeness: float = 0.7
    min_coherence: float = 0.8
    min_relevance: float = 0.9
    require_safe: bool = True
    require_format: bool = False

    def get_overall_threshold(self) -> float:
        """Calculate weighted average threshold."""
        weights = {
            "accuracy": 0.3,
            "completeness": 0.2,
            "coherence": 0.2,
            "relevance": 0.3,
        }
        return sum(
            getattr(self, f"min_{dim}") * weight
            for dim, weight in weights.items()
        )

@dataclass
class ModelQualityProfile:
    name: str
    accuracy_score: float
    completeness_score: float
    coherence_score: float
    relevance_score: float
    safety_score: float
    format_score: float

    def meets_requirements(self, req: QualityRequirements) -> bool:
        if self.accuracy_score < req.min_accuracy:
            return False
        if self.completeness_score < req.min_completeness:
            return False
        if self.coherence_score < req.min_coherence:
            return False
        if self.relevance_score < req.min_relevance:
            return False
        if req.require_safe and self.safety_score < 0.95:
            return False
        if req.require_format and self.format_score < 0.9:
            return False
        return True

    def overall_score(self) -> float:
        return (
            self.accuracy_score * 0.25 +
            self.completeness_score * 0.2 +
            self.coherence_score * 0.2 +
            self.relevance_score * 0.25 +
            self.safety_score * 0.05 +
            self.format_score * 0.05
        )
```

## Quality-Based Router

```python
class QualityBasedRouter:
    def __init__(self):
        # Based on internal benchmarks and observations
        self.model_profiles = {
            "gpt-4o": ModelQualityProfile(
                name="gpt-4o",
                accuracy_score=0.92,
                completeness_score=0.90,
                coherence_score=0.93,
                relevance_score=0.91,
                safety_score=0.94,
                format_score=0.88,
            ),
            "claude-3.5-sonnet": ModelQualityProfile(
                name="claude-3.5-sonnet",
                accuracy_score=0.91,
                completeness_score=0.92,
                coherence_score=0.94,
                relevance_score=0.93,
                safety_score=0.96,
                format_score=0.95,
            ),
            "gpt-4o-mini": ModelQualityProfile(
                name="gpt-4o-mini",
                accuracy_score=0.82,
                completeness_score=0.78,
                coherence_score=0.85,
                relevance_score=0.83,
                safety_score=0.92,
                format_score=0.80,
            ),
            "claude-3-haiku": ModelQualityProfile(
                name="claude-3-haiku",
                accuracy_score=0.80,
                completeness_score=0.75,
                coherence_score=0.83,
                relevance_score=0.81,
                safety_score=0.95,
                format_score=0.82,
            ),
        }

    def route(
        self,
        requirements: QualityRequirements,
        prefer_cheapest: bool = True
    ) -> Optional[str]:
        """Select model meeting quality requirements."""
        candidates = []

        for name, profile in self.model_profiles.items():
            if profile.meets_requirements(requirements):
                candidates.append((name, profile))

        if not candidates:
            return None

        if prefer_cheapest:
            # Cost ordering (approximate)
            cost_order = ["claude-3-haiku", "gpt-4o-mini", "claude-3.5-sonnet", "gpt-4o"]
            for model in cost_order:
                if any(c[0] == model for c in candidates):
                    return model

        # Return highest quality
        candidates.sort(key=lambda x: x[1].overall_score(), reverse=True)
        return candidates[0][0]

    def route_for_task(self, task_type: str) -> str:
        """Route based on predefined task requirements."""
        task_requirements = {
            "customer_response": QualityRequirements(
                min_accuracy=0.9,
                min_completeness=0.85,
                min_coherence=0.9,
                min_relevance=0.95,
                require_safe=True,
            ),
            "internal_summary": QualityRequirements(
                min_accuracy=0.75,
                min_completeness=0.7,
                min_coherence=0.8,
                min_relevance=0.8,
            ),
            "code_generation": QualityRequirements(
                min_accuracy=0.95,
                min_completeness=0.9,
                min_coherence=0.85,
                min_relevance=0.9,
                require_format=True,
            ),
            "data_classification": QualityRequirements(
                min_accuracy=0.85,
                min_completeness=0.6,
                min_coherence=0.7,
                min_relevance=0.8,
            ),
        }

        req = task_requirements.get(task_type, QualityRequirements())
        return self.route(req)

# Usage
router = QualityBasedRouter()

# High-quality customer response
model = router.route_for_task("customer_response")
print(f"Customer response: {model}")  # claude-3.5-sonnet or gpt-4o

# Internal summary (lower requirements)
model = router.route_for_task("internal_summary")
print(f"Internal summary: {model}")  # gpt-4o-mini or claude-3-haiku
```

## Quality Evaluation Framework

Measure actual output quality:

```python
import re
from dataclasses import dataclass
from typing import Callable

@dataclass
class QualityEvaluation:
    dimension: QualityDimension
    score: float
    explanation: str

class QualityEvaluator:
    def __init__(self, evaluator_model: str = "gpt-4o"):
        self.evaluator_model = evaluator_model
        self.evaluation_prompts = self._setup_prompts()

    def _setup_prompts(self) -> dict[QualityDimension, str]:
        return {
            QualityDimension.ACCURACY: """
            Evaluate the factual accuracy of this response.
            Consider: Are claims verifiable? Are there factual errors?
            Score 0-1 where 1 is perfectly accurate.

            Prompt: {prompt}
            Response: {response}

            Return JSON: {{"score": 0.X, "explanation": "..."}}
            """,

            QualityDimension.COMPLETENESS: """
            Evaluate how completely this response addresses the request.
            Consider: Are all aspects covered? Is anything missing?
            Score 0-1 where 1 is fully complete.

            Prompt: {prompt}
            Response: {response}

            Return JSON: {{"score": 0.X, "explanation": "..."}}
            """,

            QualityDimension.COHERENCE: """
            Evaluate the logical coherence and flow of this response.
            Consider: Is it well-organized? Does it make logical sense?
            Score 0-1 where 1 is perfectly coherent.

            Prompt: {prompt}
            Response: {response}

            Return JSON: {{"score": 0.X, "explanation": "..."}}
            """,

            QualityDimension.RELEVANCE: """
            Evaluate how relevant this response is to the original request.
            Consider: Does it answer what was asked? Is there off-topic content?
            Score 0-1 where 1 is perfectly relevant.

            Prompt: {prompt}
            Response: {response}

            Return JSON: {{"score": 0.X, "explanation": "..."}}
            """,
        }

    def evaluate(
        self,
        prompt: str,
        response: str,
        dimensions: list[QualityDimension] = None
    ) -> dict[QualityDimension, QualityEvaluation]:
        if dimensions is None:
            dimensions = list(QualityDimension)

        results = {}

        for dim in dimensions:
            if dim in self.evaluation_prompts:
                eval_prompt = self.evaluation_prompts[dim].format(
                    prompt=prompt,
                    response=response
                )

                # Call evaluator model
                eval_response = self._call_evaluator(eval_prompt)

                # Parse result
                try:
                    import json
                    parsed = json.loads(eval_response)
                    results[dim] = QualityEvaluation(
                        dimension=dim,
                        score=parsed["score"],
                        explanation=parsed["explanation"]
                    )
                except:
                    results[dim] = QualityEvaluation(
                        dimension=dim,
                        score=0.5,
                        explanation="Evaluation failed"
                    )

        return results

    def _call_evaluator(self, prompt: str) -> str:
        # In production: call the actual model API
        # This is a placeholder
        return '{"score": 0.85, "explanation": "Good quality response"}'

    def quick_evaluate(self, prompt: str, response: str) -> float:
        """Fast heuristic evaluation without LLM call."""
        score = 0.5  # Base score

        # Length check
        if len(response) < 50:
            score -= 0.1  # Too short
        elif len(response) > 100:
            score += 0.1  # Substantial response

        # Relevance heuristic: keyword overlap
        prompt_words = set(prompt.lower().split())
        response_words = set(response.lower().split())
        overlap = len(prompt_words & response_words) / max(len(prompt_words), 1)
        score += overlap * 0.2

        # Structure check
        if any(marker in response for marker in ["1.", "- ", "## ", "**"]):
            score += 0.1  # Has structure

        # Code block check (if prompt asks for code)
        if "code" in prompt.lower() and "```" in response:
            score += 0.1

        return min(1.0, max(0.0, score))

# Usage
evaluator = QualityEvaluator()

prompt = "Explain the difference between SQL and NoSQL databases"
response = "SQL databases use structured schemas and tables with relationships..."

# Quick evaluation
quick_score = evaluator.quick_evaluate(prompt, response)
print(f"Quick score: {quick_score}")

# Full evaluation
full_eval = evaluator.evaluate(prompt, response, [
    QualityDimension.ACCURACY,
    QualityDimension.COMPLETENESS
])
for dim, eval in full_eval.items():
    print(f"{dim.value}: {eval.score} - {eval.explanation}")
```

## Adaptive Quality Routing

Learn from evaluations to improve routing:

```python
from collections import defaultdict
from datetime import datetime, timedelta

class AdaptiveQualityRouter:
    def __init__(self):
        self.base_router = QualityBasedRouter()
        self.evaluator = QualityEvaluator()
        self.performance_history = defaultdict(list)
        self.learning_rate = 0.1

    def route_and_evaluate(
        self,
        prompt: str,
        requirements: QualityRequirements,
        task_type: str
    ) -> tuple[str, str]:
        """Route request and schedule evaluation."""
        # Get routing decision
        model = self._get_adjusted_model(requirements, task_type)

        # Would call model here...
        response = self._call_model(model, prompt)

        # Evaluate quality
        score = self.evaluator.quick_evaluate(prompt, response)

        # Record performance
        self._record_performance(model, task_type, score)

        # Adjust profiles if needed
        self._maybe_adjust_profiles()

        return model, response

    def _get_adjusted_model(
        self,
        requirements: QualityRequirements,
        task_type: str
    ) -> str:
        # Check recent performance
        base_model = self.base_router.route(requirements)

        if base_model in self.performance_history:
            recent = self._get_recent_scores(base_model, task_type)
            if recent and sum(recent) / len(recent) < requirements.get_overall_threshold():
                # Model underperforming, try upgrading
                return self._get_better_model(base_model)

        return base_model

    def _get_recent_scores(
        self,
        model: str,
        task_type: str,
        days: int = 7
    ) -> list[float]:
        cutoff = datetime.utcnow() - timedelta(days=days)
        return [
            entry["score"]
            for entry in self.performance_history[model]
            if entry["timestamp"] > cutoff and entry["task_type"] == task_type
        ]

    def _get_better_model(self, current: str) -> str:
        upgrade_path = {
            "claude-3-haiku": "gpt-4o-mini",
            "gpt-4o-mini": "claude-3.5-sonnet",
            "claude-3.5-sonnet": "gpt-4o",
            "gpt-4o": "gpt-4o",  # Already at top
        }
        return upgrade_path.get(current, current)

    def _record_performance(self, model: str, task_type: str, score: float):
        self.performance_history[model].append({
            "timestamp": datetime.utcnow(),
            "task_type": task_type,
            "score": score
        })

    def _maybe_adjust_profiles(self):
        """Periodically adjust quality profiles based on observed performance."""
        for model, history in self.performance_history.items():
            if len(history) >= 100:
                recent = history[-100:]
                avg_score = sum(e["score"] for e in recent) / len(recent)

                # Adjust profile scores toward observed performance
                profile = self.base_router.model_profiles.get(model)
                if profile:
                    profile.accuracy_score = (
                        profile.accuracy_score * (1 - self.learning_rate) +
                        avg_score * self.learning_rate
                    )

    def _call_model(self, model: str, prompt: str) -> str:
        # Placeholder for actual model call
        return "Model response here..."

# Usage
adaptive_router = AdaptiveQualityRouter()

requirements = QualityRequirements(
    min_accuracy=0.85,
    min_completeness=0.8
)

model, response = adaptive_router.route_and_evaluate(
    prompt="Explain Azure Data Factory triggers",
    requirements=requirements,
    task_type="documentation"
)
```

## Quality SLAs

Define and enforce quality service level agreements:

```python
@dataclass
class QualitySLA:
    name: str
    min_quality_score: float
    max_retries: int
    escalation_model: str
    alert_threshold: float

class SLAEnforcer:
    def __init__(self):
        self.slas = {
            "customer_facing": QualitySLA(
                name="customer_facing",
                min_quality_score=0.9,
                max_retries=2,
                escalation_model="gpt-4o",
                alert_threshold=0.85
            ),
            "internal": QualitySLA(
                name="internal",
                min_quality_score=0.7,
                max_retries=1,
                escalation_model="claude-3.5-sonnet",
                alert_threshold=0.6
            ),
        }
        self.violations = []

    def enforce(
        self,
        sla_name: str,
        initial_model: str,
        prompt: str,
        evaluator: QualityEvaluator
    ) -> tuple[str, str, bool]:
        """
        Returns (final_response, model_used, sla_met)
        """
        sla = self.slas.get(sla_name)
        if not sla:
            raise ValueError(f"Unknown SLA: {sla_name}")

        current_model = initial_model

        for attempt in range(sla.max_retries + 1):
            response = self._call_model(current_model, prompt)
            score = evaluator.quick_evaluate(prompt, response)

            if score >= sla.min_quality_score:
                return response, current_model, True

            if score < sla.alert_threshold:
                self._alert(sla_name, score, attempt)

            if attempt < sla.max_retries:
                # Escalate to better model
                current_model = sla.escalation_model

        # SLA not met even after retries
        self.violations.append({
            "sla": sla_name,
            "final_score": score,
            "timestamp": datetime.utcnow()
        })

        return response, current_model, False

    def _call_model(self, model: str, prompt: str) -> str:
        # Placeholder
        return "Response..."

    def _alert(self, sla_name: str, score: float, attempt: int):
        print(f"ALERT: SLA '{sla_name}' at risk. Score: {score}, Attempt: {attempt}")

    def get_violation_report(self) -> dict:
        return {
            "total_violations": len(self.violations),
            "by_sla": defaultdict(int, {
                v["sla"]: sum(1 for x in self.violations if x["sla"] == v["sla"])
                for v in self.violations
            })
        }
```

## Best Practices

1. **Define quality clearly**: Know what "good" means for each task type
2. **Measure consistently**: Use the same evaluation criteria across models
3. **Track over time**: Quality can drift; monitor continuously
4. **Balance cost and quality**: Don't overspend on quality that isn't needed
5. **Have escalation paths**: Know what to do when quality falls short

## Conclusion

Quality-based routing ensures you deliver appropriate quality for each use case. Not everything needs the best model, but critical tasks shouldn't get cheap treatment.

Build evaluation into your workflow. Measure, adjust, and continuously improve your routing decisions based on actual outcomes.

