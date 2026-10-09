---
title: "Chain-of-Thought Prompting: Making LLMs Reason Step by Step"
description: "Chain-of-thought prompting encourages models to break down problems into intermediate reasoning steps before giving a final answer."
author: Michael John Peña
draft: false
date: 2023-01-14
tags:
  - Azure
  - OpenAI
  - Prompt Engineering
  - AI
  - Reasoning
---

## What is Chain-of-Thought?

Chain-of-thought prompting encourages models to break down problems into intermediate reasoning steps before giving a final answer.

```python
# Without CoT - often wrong on complex problems
simple_prompt = """Q: A data center has 5 racks. Each rack has 8 servers.
Each server has 64GB RAM. How much total RAM is in the data center?
A:"""

# With CoT - much more accurate
cot_prompt = """Q: A data center has 5 racks. Each rack has 8 servers.
Each server has 64GB RAM. How much total RAM is in the data center?
A: Let's think step by step.
1. First, I need to find the total number of servers: 5 racks × 8 servers = 40 servers
2. Then, I calculate total RAM: 40 servers × 64GB = 2,560GB
Therefore, the data center has 2,560GB (or 2.56TB) of RAM."""
```

## Implementing CoT Prompting

```python
from typing import List, Optional
import openai

class ChainOfThoughtPrompt:
    """Build chain-of-thought prompts."""

    REASONING_TRIGGERS = [
        "Let's think step by step.",
        "Let's work through this carefully.",
        "Let's break this down:",
        "Let me solve this step by step.",
        "Here's my reasoning:"
    ]

    def __init__(
        self,
        task_description: str,
        reasoning_trigger: str = None
    ):
        self.task_description = task_description
        self.reasoning_trigger = reasoning_trigger or self.REASONING_TRIGGERS[0]
        self.examples: List[dict] = []

    def add_example(
        self,
        question: str,
        steps: List[str],
        answer: str
    ):
        """Add a CoT example with explicit steps."""
        self.examples.append({
            "question": question,
            "steps": steps,
            "answer": answer
        })
        return self

    def _format_example(self, example: dict) -> str:
        """Format a single example."""
        parts = [f"Q: {example['question']}", f"A: {self.reasoning_trigger}"]

        for i, step in enumerate(example['steps'], 1):
            parts.append(f"{i}. {step}")

        parts.append(f"Therefore, {example['answer']}")
        return "\n".join(parts)

    def build(self, question: str) -> str:
        """Build the complete CoT prompt."""
        parts = [self.task_description, ""]

        for example in self.examples:
            parts.append(self._format_example(example))
            parts.append("")

        parts.append(f"Q: {question}")
        parts.append(f"A: {self.reasoning_trigger}")

        return "\n".join(parts)

# Example: Cost calculation
cost_calculator = ChainOfThoughtPrompt(
    task_description="Calculate Azure costs based on the given information."
)

cost_calculator.add_example(
    question="An Azure SQL Database Standard S1 tier costs $30/month. How much would 3 databases cost for a year?",
    steps=[
        "Cost per database per month: $30",
        "Number of databases: 3",
        "Monthly cost: 3 × $30 = $90",
        "Yearly cost: $90 × 12 months = $1,080"
    ],
    answer="3 Standard S1 databases would cost $1,080 per year."
)

prompt = cost_calculator.build(
    "A Premium P1 Azure SQL costs $465/month. We need 2 databases for 6 months, "
    "but one database can be deleted after 3 months. What's the total cost?"
)
```

## Zero-Shot CoT

The simplest form: just add "Let's think step by step":

```python
def zero_shot_cot(question: str) -> str:
    """Create zero-shot CoT prompt."""
    return f"""{question}

Let's think step by step."""

# Works surprisingly well for many reasoning tasks
prompt = zero_shot_cot(
    "A Cosmos DB container has a provisioned throughput of 10,000 RU/s. "
    "Each read operation costs 1 RU, and each write costs 5 RU. "
    "If the workload is 60% reads and 40% writes, and each operation is "
    "equally distributed throughout the day, how many operations can be "
    "performed per hour?"
)
```

## Multi-Step Reasoning Chains

For complex problems, build explicit reasoning chains:

```python
from dataclasses import dataclass
from typing import Callable, Any

@dataclass
class ReasoningStep:
    """A single step in a reasoning chain."""
    name: str
    description: str
    operation: Callable[[dict], Any]

class ReasoningChain:
    """Execute multi-step reasoning."""

    def __init__(self, deployment: str):
        self.deployment = deployment
        self.steps: List[ReasoningStep] = []
        self.context: dict = {}

    def add_step(
        self,
        name: str,
        description: str,
        prompt_template: str
    ):
        """Add a reasoning step."""
        def operation(ctx: dict) -> str:
            prompt = prompt_template.format(**ctx)
            response = openai.Completion.create(
                engine=self.deployment,
                prompt=prompt,
                max_tokens=500,
                temperature=0.2
            )
            return response.choices[0].text.strip()

        self.steps.append(ReasoningStep(name, description, operation))
        return self

    def run(self, initial_context: dict) -> dict:
        """Execute the reasoning chain."""
        self.context = initial_context.copy()
        results = []

        for step in self.steps:
            result = step.operation(self.context)
            self.context[step.name] = result
            results.append({
                "step": step.name,
                "description": step.description,
                "result": result
            })

        return {
            "final_context": self.context,
            "reasoning_steps": results
        }

# Example: Architecture decision chain
chain = ReasoningChain(deployment="gpt35")

chain.add_step(
    name="requirements_analysis",
    description="Analyze the requirements",
    prompt_template="""Analyze these requirements and list the key technical needs:

Requirements: {requirements}

Key technical needs:"""
)

chain.add_step(
    name="service_candidates",
    description="Identify candidate Azure services",
    prompt_template="""Based on these technical needs, list Azure services that could help:

Technical needs: {requirements_analysis}

Candidate Azure services:"""
)

chain.add_step(
    name="recommendation",
    description="Make a recommendation",
    prompt_template="""Based on the analysis, make a recommendation:

Requirements: {requirements}
Technical needs: {requirements_analysis}
Candidate services: {service_candidates}

Recommendation:"""
)

# Run the chain
result = chain.run({
    "requirements": "Build a web app that handles 10,000 concurrent users, "
                   "needs to process payments, and must be HIPAA compliant."
})
```

## CoT with Self-Consistency

Generate multiple reasoning paths and take the majority answer:

```python
from collections import Counter
from typing import List, Tuple
import re

class SelfConsistentCoT:
    """CoT with self-consistency voting."""

    def __init__(self, deployment: str, num_samples: int = 5):
        self.deployment = deployment
        self.num_samples = num_samples

    def generate_reasoning_paths(
        self,
        prompt: str,
        temperature: float = 0.7
    ) -> List[Tuple[str, str]]:
        """Generate multiple reasoning paths."""
        paths = []

        for _ in range(self.num_samples):
            response = openai.Completion.create(
                engine=self.deployment,
                prompt=prompt + "\nLet's think step by step:\n",
                max_tokens=500,
                temperature=temperature
            )

            full_response = response.choices[0].text
            answer = self._extract_answer(full_response)
            paths.append((full_response, answer))

        return paths

    def _extract_answer(self, reasoning: str) -> str:
        """Extract final answer from reasoning."""
        # Look for common answer patterns
        patterns = [
            r"(?:Therefore|Thus|So|Hence|The answer is)[,:]?\s*(.+?)(?:\.|$)",
            r"(?:=|equals?)\s*(\d+(?:\.\d+)?(?:\s*\w+)?)",
            r"(?:total|result|answer)[:\s]+(\d+(?:\.\d+)?(?:\s*\w+)?)"
        ]

        reasoning_lower = reasoning.lower()

        for pattern in patterns:
            match = re.search(pattern, reasoning_lower, re.IGNORECASE)
            if match:
                return match.group(1).strip()

        # Fallback: return last line
        lines = [l.strip() for l in reasoning.split('\n') if l.strip()]
        return lines[-1] if lines else ""

    def solve(self, question: str) -> dict:
        """Solve using self-consistency."""
        prompt = f"Q: {question}"
        paths = self.generate_reasoning_paths(prompt)

        # Extract and count answers
        answers = [answer for _, answer in paths]
        answer_counts = Counter(answers)
        most_common_answer, count = answer_counts.most_common(1)[0]

        # Find the best reasoning for the winning answer
        best_reasoning = None
        for reasoning, answer in paths:
            if answer == most_common_answer:
                best_reasoning = reasoning
                break

        return {
            "answer": most_common_answer,
            "confidence": count / self.num_samples,
            "reasoning": best_reasoning,
            "all_answers": dict(answer_counts),
            "num_samples": self.num_samples
        }

# Usage
# solver = SelfConsistentCoT(deployment="gpt35", num_samples=5)
# result = solver.solve(
#     "If Azure Functions costs $0.20 per million executions and $0.000016 per GB-s, "
#     "and we run 500,000 executions using 128MB for an average of 200ms each, "
#     "what's the monthly cost?"
# )
```

## Domain-Specific CoT

Create specialized CoT for different domains:

```python
class DomainCoT:
    """Domain-specific chain-of-thought prompting."""

    DOMAINS = {
        "azure_architecture": {
            "steps": [
                "Identify the workload requirements",
                "Consider availability and scalability needs",
                "Select appropriate Azure services",
                "Design the network topology",
                "Plan for security and compliance",
                "Estimate costs"
            ],
            "template": """You are an Azure Solutions Architect. Analyze this architecture problem step by step.

Problem: {problem}

Analysis:
Step 1 - Workload Requirements:"""
        },

        "data_pipeline": {
            "steps": [
                "Identify data sources and formats",
                "Determine data volume and velocity",
                "Design ingestion strategy",
                "Plan transformation logic",
                "Select storage solution",
                "Define serving layer"
            ],
            "template": """You are a Data Engineer. Design this data pipeline step by step.

Requirements: {problem}

Design:
Step 1 - Data Sources:"""
        },

        "cost_optimization": {
            "steps": [
                "List current resources and costs",
                "Identify underutilized resources",
                "Analyze usage patterns",
                "Suggest rightsizing opportunities",
                "Consider reserved capacity",
                "Calculate potential savings"
            ],
            "template": """You are an Azure Cost Optimization Specialist. Analyze this cost problem step by step.

Current State: {problem}

Analysis:
Step 1 - Current Resources:"""
        },

        "debugging": {
            "steps": [
                "Understand the expected behavior",
                "Identify the actual behavior",
                "Isolate the difference",
                "Form a hypothesis",
                "Test the hypothesis",
                "Identify the root cause"
            ],
            "template": """You are a Senior Azure DevOps Engineer. Debug this issue step by step.

Issue: {problem}

Debugging:
Step 1 - Expected Behavior:"""
        }
    }

    @classmethod
    def create_prompt(cls, domain: str, problem: str) -> str:
        """Create a domain-specific CoT prompt."""
        if domain not in cls.DOMAINS:
            raise ValueError(f"Unknown domain: {domain}. Available: {list(cls.DOMAINS.keys())}")

        config = cls.DOMAINS[domain]
        return config["template"].format(problem=problem)

    @classmethod
    def get_steps(cls, domain: str) -> List[str]:
        """Get the reasoning steps for a domain."""
        return cls.DOMAINS.get(domain, {}).get("steps", [])

# Usage
prompt = DomainCoT.create_prompt(
    domain="azure_architecture",
    problem="Design a solution for a real-time analytics platform that "
            "processes 1 million events per second from IoT devices"
)
```

## Evaluating CoT Responses

```python
class CoTEvaluator:
    """Evaluate chain-of-thought responses."""

    def __init__(self):
        self.criteria = {
            "logical_flow": "Steps follow logically from each other",
            "completeness": "All necessary steps are included",
            "correctness": "Calculations and facts are accurate",
            "relevance": "All steps contribute to the answer",
            "clarity": "Steps are clearly explained"
        }

    def evaluate(self, reasoning: str, expected_answer: str = None) -> dict:
        """Evaluate a CoT response."""
        scores = {}

        # Check for numbered steps
        step_pattern = r'(?:^|\n)\s*(?:\d+[\.\):]|[-•])\s*'
        steps = re.split(step_pattern, reasoning)
        steps = [s.strip() for s in steps if s.strip()]

        scores["has_steps"] = len(steps) > 1
        scores["num_steps"] = len(steps)

        # Check for conclusion
        conclusion_words = ["therefore", "thus", "so", "hence", "answer"]
        scores["has_conclusion"] = any(
            word in reasoning.lower() for word in conclusion_words
        )

        # Check for math if expected answer is numeric
        if expected_answer and expected_answer.replace(".", "").isdigit():
            scores["contains_expected"] = expected_answer in reasoning

        # Check for logical connectors
        connectors = ["because", "since", "first", "then", "next", "finally"]
        scores["logical_flow"] = sum(
            1 for c in connectors if c in reasoning.lower()
        ) / len(connectors)

        return scores

    def compare_with_without_cot(
        self,
        question: str,
        deployment: str
    ) -> dict:
        """Compare results with and without CoT."""

        # Without CoT
        response_no_cot = openai.Completion.create(
            engine=deployment,
            prompt=f"{question}\nAnswer:",
            max_tokens=200
        )

        # With CoT
        response_cot = openai.Completion.create(
            engine=deployment,
            prompt=f"{question}\nLet's think step by step:",
            max_tokens=500
        )

        return {
            "without_cot": response_no_cot.choices[0].text,
            "with_cot": response_cot.choices[0].text,
            "cot_evaluation": self.evaluate(response_cot.choices[0].text)
        }
```

## Best Practices

1. **Use CoT for complex reasoning**: Math, logic, multi-step problems
2. **Be explicit about steps**: Number them or use clear transitions
3. **Match complexity**: More complex problems may need more detailed steps
4. **Consider self-consistency**: Multiple paths increase reliability
5. **Domain-specific prompts**: Tailor reasoning steps to the domain
6. **Evaluate reasoning quality**: Not just final answers

## Resources

- [Chain-of-Thought Paper](https://arxiv.org/abs/2201.11903)
- [Self-Consistency Paper](https://arxiv.org/abs/2203.11171)
- [Azure OpenAI Best Practices](https://learn.microsoft.com/azure/cognitive-services/openai/concepts/advanced-prompt-engineering)
