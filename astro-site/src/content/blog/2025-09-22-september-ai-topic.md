---
title: "Prompt Engineering: System Prompts That Actually Work"
description: "Invest time in crafting and testing your system prompts. They are the foundation of consistent, high-quality AI interactions."
author: Michael John Peña
draft: false
date: 2025-09-22
tags:
  - Prompt Engineering
  - System Prompts
  - LLM
  - Best Practices
  - AI
---

## Anatomy of an Effective System Prompt

```python
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class SystemPromptComponents:
    role_definition: str
    capabilities: List[str]
    constraints: List[str]
    output_format: str
    examples: Optional[List[dict]] = None
    safety_guidelines: Optional[str] = None

def build_system_prompt(components: SystemPromptComponents) -> str:
    """Construct a comprehensive system prompt from components."""

    sections = []

    # Role definition (who the AI is)
    sections.append(f"# Role\n{components.role_definition}")

    # Capabilities (what it can do)
    caps = "\n".join(f"- {c}" for c in components.capabilities)
    sections.append(f"# Capabilities\n{caps}")

    # Constraints (what it should not do)
    constraints = "\n".join(f"- {c}" for c in components.constraints)
    sections.append(f"# Constraints\n{constraints}")

    # Output format
    sections.append(f"# Output Format\n{components.output_format}")

    # Examples if provided
    if components.examples:
        examples_text = []
        for ex in components.examples:
            examples_text.append(f"User: {ex['user']}\nAssistant: {ex['assistant']}")
        sections.append(f"# Examples\n" + "\n\n".join(examples_text))

    # Safety guidelines
    if components.safety_guidelines:
        sections.append(f"# Safety Guidelines\n{components.safety_guidelines}")

    return "\n\n".join(sections)

# Example: Customer support agent
support_agent = SystemPromptComponents(
    role_definition="""You are a helpful customer support agent for TechCorp,
a software company. You help customers with technical issues, billing questions,
and product information. You are friendly, professional, and solution-oriented.""",

    capabilities=[
        "Answer questions about TechCorp products and services",
        "Help troubleshoot common technical issues",
        "Explain billing and subscription options",
        "Guide users through product features",
        "Escalate complex issues to human agents when needed"
    ],

    constraints=[
        "Never share internal company information or policies not meant for customers",
        "Do not make promises about features or timelines not officially announced",
        "Do not provide legal, medical, or financial advice",
        "Do not engage with abusive or harassing messages - politely redirect",
        "Always verify customer identity before discussing account details"
    ],

    output_format="""Respond in a conversational but professional tone.
Keep responses concise (under 200 words) unless detailed explanation is needed.
Use bullet points for step-by-step instructions.
Always end with a follow-up question or offer of additional help.""",

    examples=[
        {
            "user": "My software keeps crashing",
            "assistant": "I'm sorry to hear you're experiencing crashes. Let me help you troubleshoot this.\n\nCould you please tell me:\n- Which specific product are you using?\n- When did the crashes start?\n- Does it happen during a specific action?\n\nThis will help me identify the issue quickly."
        }
    ],

    safety_guidelines="""If a user expresses frustration, acknowledge their feelings
before problem-solving. If a user mentions self-harm or emergency situations,
provide appropriate crisis resources and suggest contacting emergency services."""
)

system_prompt = build_system_prompt(support_agent)
```

## Testing System Prompts

```python
def test_system_prompt(prompt: str, test_cases: List[dict], client) -> List[dict]:
    """Test system prompt against various scenarios."""
    results = []

    for case in test_cases:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": case["input"]}
            ]
        )

        results.append({
            "input": case["input"],
            "expected_behavior": case["expected"],
            "actual_response": response.choices[0].message.content,
            "passed": case["validator"](response.choices[0].message.content)
        })

    return results
```

Invest time in crafting and testing your system prompts. They are the foundation of consistent, high-quality AI interactions.
