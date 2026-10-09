---
title: "Code Generation with AI: Building Developer Tools"
description: "AI code generation accelerates development while maintaining code quality."
author: Michael John Peña
draft: false
date: 2025-04-21
tags:
  - AI
  - Code Generation
  - Developer Tools
  - Copilot
  - Automation
---

## Code Generation Patterns

```python
from azure.ai.openai import AzureOpenAI
from typing import Optional

class CodeGenerator:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client

    async def generate_function(
        self,
        description: str,
        language: str,
        context: Optional[str] = None
    ) -> str:
        """Generate a function from natural language description."""
        system_prompt = f"""You are an expert {language} developer.
Generate clean, well-documented code that follows best practices.
Include:
- Type hints/annotations where applicable
- Docstrings/comments
- Error handling
- Edge case handling"""

        user_prompt = f"Generate a {language} function that: {description}"
        if context:
            user_prompt += f"\n\nExisting code context:\n```{language}\n{context}\n```"

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.2  # Lower temperature for more consistent code
        )

        return self.extract_code(response.choices[0].message.content)

    async def explain_code(self, code: str, detail_level: str = "medium") -> str:
        """Generate explanation for code."""
        prompts = {
            "brief": "Explain what this code does in 2-3 sentences.",
            "medium": "Explain this code including its purpose, key components, and how it works.",
            "detailed": "Provide a detailed line-by-line explanation of this code."
        }

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "user", "content": f"{prompts[detail_level]}\n\n```\n{code}\n```"}
            ]
        )

        return response.choices[0].message.content

    async def refactor_code(self, code: str, goal: str) -> dict:
        """Refactor code with explanation."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Refactor the code according to the goal.
                Return JSON with:
                - refactored_code: the improved code
                - changes: list of changes made
                - reasoning: why each change improves the code"""
            }, {
                "role": "user",
                "content": f"Goal: {goal}\n\nCode:\n```\n{code}\n```"
            }],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)

    async def generate_tests(self, code: str, framework: str = "pytest") -> str:
        """Generate unit tests for code."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": f"""Generate comprehensive {framework} tests including:
                - Happy path tests
                - Edge cases
                - Error cases
                - Boundary conditions"""
            }, {
                "role": "user",
                "content": f"Generate tests for:\n```\n{code}\n```"
            }]
        )

        return self.extract_code(response.choices[0].message.content)

    async def convert_language(self, code: str, source_lang: str, target_lang: str) -> str:
        """Convert code between programming languages."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": f"Convert {source_lang} code to idiomatic {target_lang}. Preserve functionality and adapt to language conventions."
            }, {
                "role": "user",
                "content": f"```{source_lang}\n{code}\n```"
            }]
        )

        return self.extract_code(response.choices[0].message.content)

    def extract_code(self, response: str) -> str:
        """Extract code from markdown response."""
        import re
        pattern = r"```(?:\w+)?\n(.*?)```"
        matches = re.findall(pattern, response, re.DOTALL)
        return matches[0] if matches else response
```

AI code generation accelerates development while maintaining code quality.
