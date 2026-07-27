---
title: "Model Risk Management for Large Language Models"
author: "Michael John Peña"
draft: false
date: 2023-12-06
tags: ["AI", "LLM", "Risk Management", "Model Governance", "MLOps"]

---

I wrote "Model Risk Management for Large Language Models" to share practical, production-minded guidance on this topic.

LLMs are different beasts: unpredictable, context‑sensitive, and often opaque. Model risk management for LLMs needs to emphasise provenance, prompt engineering controls, robustness testing and continuous monitoring — not just a one-time validation step.

## LLM-Specific Risk Categories

## LLM-Specific Risk Categories

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from enum import Enum
from datetime import datetime

class LLMRiskType(Enum):
    HALLUCINATION = "Hallucination"
    JAILBREAK = "Jailbreak/Misuse"
    BIAS = "Bias & Fairness"
    PRIVACY = "Privacy Leakage"
    TOXICITY = "Toxic Content"
    INCONSISTENCY = "Output Inconsistency"
    OUTDATED = "Knowledge Cutoff"
    OVERRELIANCE = "User Overreliance"

@dataclass
class LLMRiskProfile:
    model_name: str
    deployment_context: str
    risk_scores: Dict[LLMRiskType, int]
    mitigations_implemented: List[str]
    last_assessed: datetime

    def get_overall_risk(self) -> str:
        avg_score = sum(self.risk_scores.values()) / len(self.risk_scores)
        if avg_score >= 4:
            return "Critical"
        elif avg_score >= 3:
            return "High"
        elif avg_score >= 2:
            return "Medium"
        return "Low"

# Example risk profile
customer_service_llm = LLMRiskProfile(
    model_name="GPT-4 Turbo",
    deployment_context="Customer Service Chatbot",
    risk_scores={
        LLMRiskType.HALLUCINATION: 3,
        LLMRiskType.JAILBREAK: 2,
        LLMRiskType.BIAS: 2,
        LLMRiskType.PRIVACY: 4,
        LLMRiskType.TOXICITY: 2,
        LLMRiskType.INCONSISTENCY: 3,
        LLMRiskType.OUTDATED: 2,
        LLMRiskType.OVERRELIANCE: 3
    },
    mitigations_implemented=[
        "RAG grounding",
        "Content filtering",
        "Human escalation path"
    ],
    last_assessed=datetime.now()
)
```

## Hallucination Risk Management

```python
class HallucinationManager:
    """Manage hallucination risk in LLM systems."""

    def __init__(self):
        self.detection_results: List[Dict] = []

    def detect_hallucination(
        self,
        response: str,
        context: str,
        method: str = "nli"
    ) -> Dict:
        """Detect potential hallucinations."""
        result = {
            "response": response[:100] + "...",
            "detection_method": method,
            "timestamp": datetime.now()
        }

        if method == "nli":
            # Natural Language Inference approach
            score = self._nli_check(response, context)
            result["nli_score"] = score
            result["hallucination_risk"] = "High" if score < 0.5 else "Low"

        elif method == "entity_verification":
            # Check named entities against knowledge base
            entities = self._extract_entities(response)
            verified = self._verify_entities(entities)
            result["entities_found"] = len(entities)
            result["entities_verified"] = verified
            result["hallucination_risk"] = "High" if verified < 0.7 else "Low"

        self.detection_results.append(result)
        return result

    def _nli_check(self, response: str, context: str) -> float:
        """Check if response is entailed by context."""
        # Placeholder for NLI model inference
        return 0.75

    def _extract_entities(self, text: str) -> List[str]:
        """Extract named entities from text."""
        # Placeholder for NER
        return ["entity1", "entity2"]

    def _verify_entities(self, entities: List[str]) -> float:
        """Verify entities against knowledge base."""
        # Placeholder for verification
        return 0.8

    def implement_rag_grounding(self, config: Dict) -> Dict:
        """Configure RAG to reduce hallucinations."""
        rag_config = {
            "retrieval_settings": {
                "top_k": config.get("top_k", 5),
                "similarity_threshold": config.get("threshold", 0.7),
                "reranking_enabled": True
            },
            "grounding_instructions": """
                Answer ONLY based on the provided context.
                If the context doesn't contain the answer, say:
                "I don't have information about that in my knowledge base."
                Always cite your sources.
            """,
            "citation_format": "[Source: {document_name}]",
            "confidence_scoring": True
        }
        return rag_config

    def get_hallucination_metrics(self) -> Dict:
        """Calculate hallucination metrics over time."""
        if not self.detection_results:
            return {}

        high_risk_count = sum(
            1 for r in self.detection_results
            if r.get("hallucination_risk") == "High"
        )

        return {
            "total_checked": len(self.detection_results),
            "high_risk_count": high_risk_count,
            "hallucination_rate": high_risk_count / len(self.detection_results)
        }
```

## Output Validation Framework

```python
class OutputValidator:
    """Validate LLM outputs for various risk factors."""

    def __init__(self):
        self.validators: List[callable] = []

    def add_validator(self, name: str, validator_func: callable, priority: int = 5):
        """Add a validation function."""
        self.validators.append({
            "name": name,
            "function": validator_func,
            "priority": priority
        })
        self.validators.sort(key=lambda x: x["priority"])

    def validate(self, output: str, context: Dict = None) -> Dict:
        """Run all validators on output."""
        results = {
            "output": output[:200],
            "passed": True,
            "validations": []
        }

        for validator in self.validators:
            try:
                is_valid, details = validator["function"](output, context)
                results["validations"].append({
                    "name": validator["name"],
                    "passed": is_valid,
                    "details": details
                })
                if not is_valid:
                    results["passed"] = False
            except Exception as e:
                results["validations"].append({
                    "name": validator["name"],
                    "passed": False,
                    "error": str(e)
                })
                results["passed"] = False

        return results

# Create validators
validator = OutputValidator()

# PII detection validator
def pii_validator(output: str, context: Dict) -> tuple:
    """Check for PII in output."""
    pii_patterns = [
        r'\b\d{3}-\d{2}-\d{4}\b',  # SSN
        r'\b\d{16}\b',  # Credit card
        r'\b[\w.-]+@[\w.-]+\.\w+\b'  # Email
    ]
    import re
    found = []
    for pattern in pii_patterns:
        if re.search(pattern, output):
            found.append(pattern)
    return len(found) == 0, {"patterns_found": found}

validator.add_validator("PII Detection", pii_validator, priority=1)

# Length validator
def length_validator(output: str, context: Dict) -> tuple:
    """Ensure output is within acceptable length."""
    max_length = context.get("max_length", 2000) if context else 2000
    return len(output) <= max_length, {"length": len(output), "max": max_length}

validator.add_validator("Length Check", length_validator, priority=5)

# Toxicity validator
def toxicity_validator(output: str, context: Dict) -> tuple:
    """Check for toxic content."""
    # Placeholder - would use actual toxicity model
    toxic_words = ["harmful", "dangerous"]  # Simplified
    found = [w for w in toxic_words if w.lower() in output.lower()]
    return len(found) == 0, {"toxic_content": found}

validator.add_validator("Toxicity Check", toxicity_validator, priority=2)
```

## Model Monitoring and Observability

```python
class LLMObservability:
    """Comprehensive LLM monitoring and observability."""

    def __init__(self, model_id: str):
        self.model_id = model_id
        self.logs: List[Dict] = []
        self.metrics: Dict[str, List] = {
            "latency": [],
            "token_usage": [],
            "error_rate": [],
            "validation_pass_rate": []
        }

    def log_interaction(
        self,
        request_id: str,
        prompt: str,
        response: str,
        latency_ms: float,
        tokens_used: int,
        validation_result: Dict
    ):
        """Log a single interaction."""
        log_entry = {
            "request_id": request_id,
            "timestamp": datetime.now(),
            "prompt_preview": prompt[:100],
            "response_preview": response[:100],
            "latency_ms": latency_ms,
            "tokens_used": tokens_used,
            "validation_passed": validation_result.get("passed", False)
        }

        self.logs.append(log_entry)
        self.metrics["latency"].append(latency_ms)
        self.metrics["token_usage"].append(tokens_used)
        self.metrics["validation_pass_rate"].append(
            1 if validation_result.get("passed") else 0
        )

    def get_health_dashboard(self) -> Dict:
        """Generate health dashboard data."""
        def avg(lst):
            return sum(lst) / len(lst) if lst else 0

        recent_logs = self.logs[-100:]  # Last 100 interactions

        return {
            "model_id": self.model_id,
            "total_interactions": len(self.logs),
            "metrics": {
                "avg_latency_ms": avg(self.metrics["latency"][-100:]),
                "p95_latency_ms": sorted(self.metrics["latency"][-100:])[95] if len(self.metrics["latency"]) >= 100 else None,
                "avg_tokens": avg(self.metrics["token_usage"][-100:]),
                "validation_pass_rate": avg(self.metrics["validation_pass_rate"][-100:])
            },
            "alerts": self._check_alerts()
        }

    def _check_alerts(self) -> List[str]:
        """Check for alert conditions."""
        alerts = []

        # High latency alert
        recent_latency = self.metrics["latency"][-10:]
        if recent_latency and sum(recent_latency) / len(recent_latency) > 5000:
            alerts.append("High average latency detected")

        # Low validation pass rate
        recent_validation = self.metrics["validation_pass_rate"][-50:]
        if recent_validation and sum(recent_validation) / len(recent_validation) < 0.9:
            alerts.append("Validation pass rate below threshold")

        return alerts
```

Tomorrow, we'll explore operational risk in AI systems!\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
