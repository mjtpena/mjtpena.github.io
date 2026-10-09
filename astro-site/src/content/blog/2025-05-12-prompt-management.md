---
title: "Prompt Management: Version Control for AI Instructions"
description: "Effective prompt management enables reliable AI applications with traceable changes."
author: Michael John Peña
draft: false
date: 2025-05-12
tags:
  - AI
  - Prompts
  - Management
  - Version Control
  - Best Practices
---

## Prompt Management System

```python
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from datetime import datetime
import hashlib

@dataclass
class PromptTemplate:
    name: str
    template: str
    version: str
    variables: List[str]
    metadata: Dict = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)

class PromptRegistry:
    def __init__(self, storage_backend):
        self.storage = storage_backend
        self.cache = {}

    def register(self, prompt: PromptTemplate) -> str:
        """Register a new prompt version."""
        # Generate version hash
        content_hash = hashlib.sha256(prompt.template.encode()).hexdigest()[:8]
        prompt.version = f"v{datetime.now().strftime('%Y%m%d')}-{content_hash}"

        # Store prompt
        self.storage.save(prompt.name, prompt.version, prompt)

        # Update latest pointer
        self.storage.set_latest(prompt.name, prompt.version)

        return prompt.version

    def get(self, name: str, version: str = "latest") -> PromptTemplate:
        """Get prompt by name and version."""
        cache_key = f"{name}:{version}"

        if cache_key in self.cache:
            return self.cache[cache_key]

        if version == "latest":
            version = self.storage.get_latest(name)

        prompt = self.storage.load(name, version)
        self.cache[cache_key] = prompt

        return prompt

    def render(self, name: str, variables: Dict, version: str = "latest") -> str:
        """Render prompt with variables."""
        prompt = self.get(name, version)

        # Validate all required variables are provided
        missing = set(prompt.variables) - set(variables.keys())
        if missing:
            raise ValueError(f"Missing variables: {missing}")

        # Render template
        rendered = prompt.template
        for var, value in variables.items():
            rendered = rendered.replace(f"{{{{{var}}}}}", str(value))

        return rendered

    def list_versions(self, name: str) -> List[str]:
        """List all versions of a prompt."""
        return self.storage.list_versions(name)

    def compare(self, name: str, version1: str, version2: str) -> Dict:
        """Compare two prompt versions."""
        p1 = self.get(name, version1)
        p2 = self.get(name, version2)

        return {
            "version1": version1,
            "version2": version2,
            "template_changed": p1.template != p2.template,
            "variables_changed": p1.variables != p2.variables,
            "diff": self.generate_diff(p1.template, p2.template)
        }


class PromptTesting:
    """Test prompts before deployment."""

    def __init__(self, registry: PromptRegistry, llm_client):
        self.registry = registry
        self.llm = llm_client

    async def test_prompt(self, name: str, version: str, test_cases: List[Dict]) -> Dict:
        """Test prompt against test cases."""
        prompt = self.registry.get(name, version)
        results = []

        for case in test_cases:
            rendered = self.registry.render(name, case["variables"], version)
            response = await self.llm.generate(rendered)

            result = {
                "input": case["variables"],
                "output": response,
                "expected": case.get("expected"),
                "passed": self.evaluate(response, case.get("expected"))
            }
            results.append(result)

        return {
            "prompt": name,
            "version": version,
            "total": len(results),
            "passed": sum(1 for r in results if r["passed"]),
            "results": results
        }
```

Effective prompt management enables reliable AI applications with traceable changes.
