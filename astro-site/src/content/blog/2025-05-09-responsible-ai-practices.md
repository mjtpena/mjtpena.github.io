---
title: "Responsible AI Practices: Implementing Ethical AI"
description: "Responsible AI practices build trust and ensure ethical AI deployment."
author: Michael John Peña
draft: false
date: 2025-05-09
tags:
  - AI
  - Responsible AI
  - Ethics
  - Fairness
  - Best Practices
---

## Responsible AI Implementation

```python
from azure.ai.contentsafety import ContentSafetyClient
from azure.ai.openai import AzureOpenAI
import numpy as np

class ResponsibleAIPipeline:
    def __init__(self, openai_client: AzureOpenAI, safety_client: ContentSafetyClient):
        self.openai = openai_client
        self.safety = safety_client

    async def check_fairness(self, predictions: list, demographics: list) -> dict:
        """Check predictions for demographic fairness."""
        results = {}

        # Group predictions by demographic
        groups = {}
        for pred, demo in zip(predictions, demographics):
            if demo not in groups:
                groups[demo] = []
            groups[demo].append(pred)

        # Calculate metrics per group
        for group, preds in groups.items():
            results[group] = {
                "count": len(preds),
                "positive_rate": np.mean([p > 0.5 for p in preds]),
                "average_score": np.mean(preds)
            }

        # Check for disparities
        positive_rates = [r["positive_rate"] for r in results.values()]
        disparity = max(positive_rates) / (min(positive_rates) + 0.001)

        return {
            "group_metrics": results,
            "disparity_ratio": disparity,
            "fair": disparity < 1.25  # 80% rule threshold
        }

    async def generate_explanation(self, input_data: dict, prediction: float) -> str:
        """Generate human-readable explanation for prediction."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": "Explain AI predictions in simple, non-technical terms."
            }, {
                "role": "user",
                "content": f"Input: {input_data}\nPrediction: {prediction}\nExplain why."
            }]
        )
        return response.choices[0].message.content

    async def check_content_safety(self, content: str) -> dict:
        """Check content for safety issues."""
        result = await self.safety.analyze_text(text=content)

        return {
            "safe": all(cat.severity < 2 for cat in result.categories),
            "categories": {
                cat.category: cat.severity
                for cat in result.categories
            }
        }

    async def apply_guardrails(self, prompt: str, response: str) -> dict:
        """Apply comprehensive guardrails to AI interaction."""
        checks = {
            "input_safety": await self.check_content_safety(prompt),
            "output_safety": await self.check_content_safety(response),
            "pii_detected": self.detect_pii(response),
            "bias_indicators": await self.check_bias(response)
        }

        all_passed = (
            checks["input_safety"]["safe"] and
            checks["output_safety"]["safe"] and
            not checks["pii_detected"] and
            not checks["bias_indicators"]["detected"]
        )

        return {"passed": all_passed, "checks": checks}

    def detect_pii(self, text: str) -> bool:
        """Detect personally identifiable information."""
        import re
        patterns = {
            "ssn": r"\b\d{3}-\d{2}-\d{4}\b",
            "email": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
            "phone": r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b"
        }
        return any(re.search(p, text) for p in patterns.values())
```

Responsible AI practices build trust and ensure ethical AI deployment.
