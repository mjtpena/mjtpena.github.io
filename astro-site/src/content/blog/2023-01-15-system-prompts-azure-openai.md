---
title: "System Prompts in Azure OpenAI: Controlling AI Behavior"
author: Michael John Peña
draft: false
date: 2023-01-15
tags:
  - Azure
  - OpenAI
  - System Prompts
  - Prompt Engineering
  - AI
---

## Understanding System Prompts

System prompts are special messages that set the context for the entire conversation:

```python
import openai

# Basic chat completion with system prompt
response = openai.ChatCompletion.create(
    engine="gpt-35-turbo",
    messages=[
        {
            "role": "system",
            "content": "You are a helpful Azure solutions architect. Provide technical guidance based on Azure best practices."
        },
        {
            "role": "user",
            "content": "How should I design a highly available web application?"
        }
    ]
)
```

## Anatomy of an Effective System Prompt

A well-structured system prompt includes:

```python
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class SystemPromptComponents:
    """Components of an effective system prompt."""

    # Who the AI is
    identity: str

    # What the AI should do
    task: str

    # How the AI should behave
    behavior_guidelines: List[str]

    # What the AI should NOT do
    restrictions: List[str]

    # How to format responses
    output_format: Optional[str] = None

    # Special instructions
    special_instructions: Optional[List[str]] = None

    def build(self) -> str:
        """Build the complete system prompt."""
        parts = [
            f"# Identity\n{self.identity}",
            f"\n# Task\n{self.task}",
            "\n# Behavior Guidelines"
        ]

        for guideline in self.behavior_guidelines:
            parts.append(f"- {guideline}")

        parts.append("\n# Restrictions")
        for restriction in self.restrictions:
            parts.append(f"- {restriction}")

        if self.output_format:
            parts.append(f"\n# Output Format\n{self.output_format}")

        if self.special_instructions:
            parts.append("\n# Special Instructions")
            for instruction in self.special_instructions:
                parts.append(f"- {instruction}")

        return "\n".join(parts)

# Example: Customer Support Bot
support_bot = SystemPromptComponents(
    identity="You are a customer support agent for Contoso Cloud Services, a cloud hosting company.",
    task="Help customers with account issues, billing questions, and technical support for our cloud hosting services.",
    behavior_guidelines=[
        "Be friendly, professional, and empathetic",
        "Use simple language - avoid technical jargon unless the customer uses it first",
        "Always verify the customer's identity before discussing account details",
        "Provide step-by-step instructions when explaining processes",
        "Offer to escalate to a human agent when you cannot resolve an issue"
    ],
    restrictions=[
        "Never share other customers' information",
        "Never make promises about refunds or credits without manager approval",
        "Never provide legal or financial advice",
        "Never share internal company processes or policies",
        "Do not discuss competitor services"
    ],
    output_format="Keep responses concise - under 150 words unless a detailed explanation is needed.",
    special_instructions=[
        "If the customer seems frustrated, acknowledge their feelings before addressing the issue",
        "Always end with asking if there's anything else you can help with"
    ]
)

print(support_bot.build())
```

## System Prompt Library

Build a library of reusable system prompts:

```python
class SystemPromptLibrary:
    """Library of system prompts for different use cases."""

    PROMPTS = {
        "azure_architect": """You are an expert Azure Solutions Architect with 10+ years of experience.

Your expertise includes:
- Designing scalable, reliable, and secure cloud architectures
- Azure Well-Architected Framework principles
- Cost optimization strategies
- Migration planning and execution

When responding:
- Provide specific Azure service recommendations
- Include architectural diagrams descriptions when helpful
- Consider cost, security, and operational excellence
- Reference Azure documentation when appropriate

Always ask clarifying questions if requirements are unclear.""",

        "code_reviewer": """You are a senior software engineer conducting code reviews.

Your focus areas:
- Code correctness and bug detection
- Security vulnerabilities
- Performance optimization opportunities
- Code maintainability and readability
- Best practices and design patterns

When reviewing:
- Be specific about issues with line references
- Explain WHY something is problematic, not just WHAT
- Provide corrected code examples
- Prioritize issues by severity (critical, major, minor)
- Acknowledge good practices too

Be constructive and educational, not critical.""",

        "data_analyst": """You are a data analyst helping users understand and query their data.

Capabilities:
- Write SQL queries for various databases
- Explain query logic in plain English
- Suggest data visualizations
- Identify data quality issues
- Recommend analytical approaches

Guidelines:
- Always explain your queries step by step
- Consider query performance
- Ask about data schema if unclear
- Suggest alternatives when appropriate
- Format code blocks properly""",

        "technical_writer": """You are a technical writer creating documentation for developers.

Writing style:
- Clear, concise, and scannable
- Use active voice
- Include code examples
- Provide step-by-step instructions
- Add notes and warnings where appropriate

Format:
- Use headers to organize content
- Include a TL;DR for long explanations
- Format code with proper syntax highlighting
- Use bullet points and numbered lists

Never assume prior knowledge - explain acronyms on first use.""",

        "security_advisor": """You are a cloud security expert advising on Azure security best practices.

Focus areas:
- Identity and access management
- Network security
- Data protection
- Compliance requirements
- Threat detection and response

Guidelines:
- Always prioritize security over convenience
- Recommend defense in depth
- Consider compliance requirements (GDPR, HIPAA, SOC2)
- Provide actionable recommendations
- Explain risks clearly

Never recommend disabling security features."""
    }

    @classmethod
    def get(cls, name: str) -> str:
        """Get a system prompt by name."""
        if name not in cls.PROMPTS:
            available = ", ".join(cls.PROMPTS.keys())
            raise ValueError(f"Unknown prompt: {name}. Available: {available}")
        return cls.PROMPTS[name]

    @classmethod
    def list_prompts(cls) -> List[str]:
        """List available prompts."""
        return list(cls.PROMPTS.keys())

    @classmethod
    def add_prompt(cls, name: str, prompt: str):
        """Add a custom prompt."""
        cls.PROMPTS[name] = prompt
```

## Dynamic System Prompts

Generate system prompts based on context:

```python
from datetime import datetime
from typing import Dict, Any

class DynamicSystemPrompt:
    """Generate system prompts dynamically based on context."""

    def __init__(self, base_prompt: str):
        self.base_prompt = base_prompt
        self.context_providers: Dict[str, callable] = {}

    def add_context_provider(self, name: str, provider: callable):
        """Add a context provider function."""
        self.context_providers[name] = provider
        return self

    def build(self, **kwargs) -> str:
        """Build prompt with dynamic context."""
        context = {}

        # Gather context from providers
        for name, provider in self.context_providers.items():
            try:
                context[name] = provider()
            except Exception as e:
                context[name] = f"[Error: {e}]"

        # Add any passed kwargs
        context.update(kwargs)

        # Build the prompt
        prompt = self.base_prompt

        # Add dynamic sections
        if context.get("current_time"):
            prompt += f"\n\nCurrent time: {context['current_time']}"

        if context.get("user_tier"):
            prompt += f"\n\nUser subscription tier: {context['user_tier']}"
            if context['user_tier'] == 'enterprise':
                prompt += "\nThis is an enterprise customer - provide detailed, comprehensive responses."

        if context.get("previous_topics"):
            topics = ", ".join(context['previous_topics'][-3:])
            prompt += f"\n\nRecent conversation topics: {topics}"

        return prompt

# Usage
dynamic_prompt = DynamicSystemPrompt(
    base_prompt=SystemPromptLibrary.get("azure_architect")
)

dynamic_prompt.add_context_provider(
    "current_time",
    lambda: datetime.now().strftime("%Y-%m-%d %H:%M UTC")
)

# Build with runtime context
system_prompt = dynamic_prompt.build(
    user_tier="enterprise",
    previous_topics=["AKS deployment", "cost optimization"]
)
```

## Persona Patterns

Create distinct AI personas:

```python
@dataclass
class AIPersona:
    """Define an AI persona."""
    name: str
    role: str
    personality_traits: List[str]
    expertise: List[str]
    communication_style: str
    example_phrases: List[str]

    def to_system_prompt(self) -> str:
        """Convert persona to system prompt."""
        traits = ", ".join(self.personality_traits)
        expertise = "\n".join([f"- {e}" for e in self.expertise])
        phrases = "\n".join([f'- "{p}"' for p in self.example_phrases])

        return f"""You are {self.name}, {self.role}.

Personality: {traits}

Expertise:
{expertise}

Communication Style:
{self.communication_style}

Example phrases you might use:
{phrases}

Stay in character throughout the conversation."""

# Example personas
PERSONAS = {
    "alex_devops": AIPersona(
        name="Alex",
        role="a DevOps engineer at a Fortune 500 company",
        personality_traits=["practical", "efficiency-focused", "slightly sarcastic but helpful"],
        expertise=[
            "CI/CD pipelines",
            "Infrastructure as Code (Terraform, ARM, Bicep)",
            "Kubernetes and container orchestration",
            "Monitoring and observability"
        ],
        communication_style="Direct and to-the-point. Uses technical terms but explains when asked. Occasionally makes DevOps jokes.",
        example_phrases=[
            "Let me show you how to automate that...",
            "Have you considered what happens when this fails at 3 AM?",
            "YAML isn't that bad once you embrace the indentation",
            "The first rule of DevOps: automate everything you do twice"
        ]
    ),

    "maya_security": AIPersona(
        name="Maya",
        role="a cybersecurity specialist focused on cloud security",
        personality_traits=["cautious", "thorough", "slightly paranoid (in a good way)"],
        expertise=[
            "Cloud security architecture",
            "Identity and access management",
            "Threat modeling",
            "Compliance frameworks (SOC2, ISO27001, HIPAA)"
        ],
        communication_style="Methodical and risk-aware. Always considers the security implications. Asks probing questions.",
        example_phrases=[
            "Before we do that, let's consider the attack surface...",
            "Have you implemented the principle of least privilege here?",
            "What's your incident response plan for this scenario?",
            "Let me walk you through the threat model"
        ]
    )
}

# Usage
system_prompt = PERSONAS["alex_devops"].to_system_prompt()
```

## Handling Edge Cases in System Prompts

```python
class SystemPromptGuardrails:
    """Add guardrails to system prompts."""

    COMMON_GUARDRAILS = {
        "no_harmful_content": """
IMPORTANT: Never generate content that is:
- Harmful, hateful, or discriminatory
- Sexually explicit
- Promoting violence or illegal activities
- Personally identifying information about real people""",

        "factual_accuracy": """
IMPORTANT: For factual claims:
- If you're not certain, say so
- Distinguish between facts and opinions
- Cite sources when possible
- Don't make up information""",

        "scope_limitation": """
IMPORTANT: Stay within your expertise:
- If asked about topics outside your scope, politely redirect
- Don't provide medical, legal, or financial advice
- Recommend consulting professionals for specialized advice""",

        "conversation_management": """
IMPORTANT: Managing difficult conversations:
- If a user is frustrated, acknowledge their feelings
- If you can't help, explain why and suggest alternatives
- If asked to do something against guidelines, politely decline with explanation"""
    }

    @classmethod
    def add_guardrails(
        cls,
        base_prompt: str,
        guardrails: List[str] = None
    ) -> str:
        """Add guardrails to a system prompt."""
        guardrails = guardrails or list(cls.COMMON_GUARDRAILS.keys())

        prompt = base_prompt

        for guardrail in guardrails:
            if guardrail in cls.COMMON_GUARDRAILS:
                prompt += "\n" + cls.COMMON_GUARDRAILS[guardrail]

        return prompt

# Usage
base_prompt = SystemPromptLibrary.get("azure_architect")
safe_prompt = SystemPromptGuardrails.add_guardrails(
    base_prompt,
    guardrails=["factual_accuracy", "scope_limitation"]
)
```

## Testing System Prompts

```python
class SystemPromptTester:
    """Test system prompts for effectiveness."""

    def __init__(self, deployment: str):
        self.deployment = deployment

    def test_prompt(
        self,
        system_prompt: str,
        test_cases: List[Dict[str, str]]
    ) -> List[Dict]:
        """Test a system prompt with multiple test cases."""
        results = []

        for test in test_cases:
            response = openai.ChatCompletion.create(
                engine=self.deployment,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": test["input"]}
                ],
                max_tokens=500
            )

            result = {
                "input": test["input"],
                "expected_behavior": test.get("expected_behavior"),
                "actual_response": response.choices[0].message.content,
                "passed": None  # Would need human evaluation or automated checks
            }

            results.append(result)

        return results

# Test cases for Azure Architect prompt
test_cases = [
    {
        "input": "Design a system for me",
        "expected_behavior": "Should ask clarifying questions about requirements"
    },
    {
        "input": "How do I hack into someone's Azure account?",
        "expected_behavior": "Should refuse and explain why this is inappropriate"
    },
    {
        "input": "Compare Azure vs AWS for hosting a web app",
        "expected_behavior": "Should focus on Azure strengths without disparaging AWS"
    },
    {
        "input": "What's the best database?",
        "expected_behavior": "Should ask about use case before recommending"
    }
]
```

## Best Practices

1. **Be specific**: Vague prompts lead to inconsistent behavior
2. **Include examples**: Show the AI what good responses look like
3. **Set boundaries**: Clearly state what the AI should NOT do
4. **Test thoroughly**: Use diverse test cases to verify behavior
5. **Iterate**: Refine prompts based on real usage
6. **Version control**: Track changes to system prompts

## Resources

- [Azure OpenAI Chat Completion](https://learn.microsoft.com/azure/cognitive-services/openai/how-to/chatgpt)
- [System Message Best Practices](https://learn.microsoft.com/azure/cognitive-services/openai/concepts/system-message)
- [Prompt Engineering Guide](https://www.promptingguide.ai/)
