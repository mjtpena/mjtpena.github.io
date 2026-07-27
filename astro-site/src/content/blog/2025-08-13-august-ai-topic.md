---
title: "LLMOps: Operationalizing Large Language Models in Production"
author: Michael John Peña
draft: false
date: 2025-08-13
tags:
  - LLMOps
  - MLOps
  - Production AI
  - DevOps
  - AI Engineering

---

I wrote "LLMOps: Operationalizing Large Language Models in Production" to share practical, production-minded guidance on this topic.

## Key LLMOps Challenges

LLMs present distinct operational challenges: non-deterministic outputs, prompt sensitivity, context window management, and the difficulty of defining "correct" behavior. Traditional ML metrics like accuracy often don't apply.

## Implementing Prompt Versioning

```python
from dataclasses import dataclass
from datetime import datetime
import hashlib
import json

@dataclass
class PromptVersion:
    name: str
    template: str
    version: str
    created_at: datetime
    metadata: dict

class PromptRegistry:
    def __init__(self, storage_client):
        self.storage = storage_client

    def register(self, name: str, template: str, metadata: dict = None) -> PromptVersion:
        """Register a new prompt version."""
        version_hash = hashlib.sha256(template.encode()).hexdigest()[:8]

        prompt_version = PromptVersion(
            name=name,
            template=template,
            version=version_hash,
            created_at=datetime.utcnow(),
            metadata=metadata or {}
        )

        self.storage.save(f"prompts/{name}/{version_hash}", prompt_version)
        return prompt_version

    def get_latest(self, name: str) -> PromptVersion:
        """Get the latest version of a prompt."""
        versions = self.storage.list(f"prompts/{name}/")
        return max(versions, key=lambda v: v.created_at)

    def get_version(self, name: str, version: str) -> PromptVersion:
        """Get a specific prompt version."""
        return self.storage.get(f"prompts/{name}/{version}")
```

## Evaluation Framework

```python
class LLMEvaluator:
    def __init__(self, judge_client):
        self.judge = judge_client

    async def evaluate_response(self, prompt: str, response: str, criteria: list[str]) -> dict:
        """Evaluate LLM response against criteria."""

        evaluation_prompt = f"""
        Evaluate this AI response against the criteria.

        Original prompt: {prompt}
        Response: {response}

        Criteria: {', '.join(criteria)}

        Score each criterion 1-5 and explain.
        """

        evaluation = await self.judge.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": evaluation_prompt}]
        )

        return self._parse_evaluation(evaluation.choices[0].message.content)
```

LLMOps is about building confidence that your AI system behaves correctly through systematic testing, monitoring, and iteration. Start with basic telemetry and expand based on observed failure modes.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
