---
title: "Prompt Engineering Mastery: Advanced Techniques for GPT-4"
description: "GPT-4 has been available since March 2023 and the gap between practitioners who've put in real work with it and those still writing prompts by intuition is…"
author: "Michael John Peña"
draft: false
date: 2023-11-02
tags: ["OpenAI", "GPT-4", "Prompt Engineering", "AI", "Best Practices"]
---

GPT-4 has been available since March 2023 and the gap between practitioners who've put in real work with it and those still writing prompts by intuition is now visible. The patterns that consistently produce better outputs: structured reasoning scaffolding (explicit step-by-step instructions that mirror how a subject matter expert would approach the problem, not just "think step by step"), persona specificity (not "you are a helpful assistant" but "you are a senior data engineer at an Australian enterprise who prioritises data governance and pragmatic delivery over architectural elegance"), and output format control (specifying the exact structure of the response — not as a post-hoc instruction but as part of the initial prompt framing). These aren't tricks; they're prompt design principles that emerge from understanding how the model's training shapes its response patterns.

## The Structured Thinking Framework

### Chain of Thought with Explicit Steps

```python
def create_reasoning_prompt(problem: str, domain: str) -> str:
    """Create a prompt that guides explicit reasoning."""
    return f"""You are an expert in {domain}. Solve the following problem using a structured approach.

Problem: {problem}

Please follow these steps:

1. **Understanding**: Restate the problem in your own words to confirm understanding.
2. **Decomposition**: Break down the problem into smaller, manageable parts.
3. **Analysis**: Analyze each part, identifying key factors and constraints.
4. **Synthesis**: Combine insights from each part into a cohesive solution.
5. **Validation**: Check your solution against the original requirements.
6. **Conclusion**: Provide a clear, actionable answer.

Work through each step explicitly before providing your final answer."""

# Example usage
prompt = create_reasoning_prompt(
    problem="Design a caching strategy for an API with 10,000 RPM that serves both real-time and historical data",
    domain="distributed systems"
)
```

### Multi-Persona Analysis

```python
def multi_perspective_prompt(topic: str, perspectives: list) -> str:
    """Generate analysis from multiple expert perspectives."""
    perspective_instructions = "\n".join([
        f"- **{p['role']}**: Consider {p['focus']}"
        for p in perspectives
    ])

    return f"""Analyze the following topic from multiple expert perspectives:

Topic: {topic}

Consider these viewpoints:
{perspective_instructions}

For each perspective:
1. Identify key concerns and priorities
2. Highlight potential benefits and risks
3. Suggest specific recommendations

Finally, synthesize these perspectives into a balanced recommendation that addresses the concerns of all stakeholders."""

# Example
perspectives = [
    {"role": "Security Engineer", "focus": "vulnerabilities, data protection, compliance"},
    {"role": "Product Manager", "focus": "user experience, time to market, feature value"},
    {"role": "DevOps Engineer", "focus": "deployment, monitoring, operational overhead"},
    {"role": "Cost Analyst", "focus": "budget, ROI, resource efficiency"}
]

prompt = multi_perspective_prompt(
    "Implementing a microservices architecture for our monolithic application",
    perspectives
)
```

## Context Optimization Techniques

### Structured Context Windows

With GPT-4's 8K and 32K context windows, organization matters.

```python
from dataclasses import dataclass
from typing import List, Optional
import tiktoken

@dataclass
class ContextSection:
    name: str
    content: str
    priority: int  # 1 = highest
    max_tokens: Optional[int] = None

class ContextManager:
    def __init__(self, model: str = "gpt-4", max_tokens: int = 8000):
        self.model = model
        self.max_tokens = max_tokens
        self.encoding = tiktoken.encoding_for_model(model)
        self.sections: List[ContextSection] = []

    def add_section(self, section: ContextSection):
        """Add a context section."""
        self.sections.append(section)

    def count_tokens(self, text: str) -> int:
        """Count tokens in text."""
        return len(self.encoding.encode(text))

    def build_context(self, reserve_for_response: int = 1000) -> str:
        """Build optimized context within token limits."""
        available_tokens = self.max_tokens - reserve_for_response

        # Sort by priority
        sorted_sections = sorted(self.sections, key=lambda x: x.priority)

        context_parts = []
        used_tokens = 0

        for section in sorted_sections:
            content = section.content

            # Truncate if necessary
            if section.max_tokens:
                tokens = self.encoding.encode(content)
                if len(tokens) > section.max_tokens:
                    tokens = tokens[:section.max_tokens]
                    content = self.encoding.decode(tokens) + "..."

            section_text = f"\n### {section.name.upper()} ###\n{content}\n"
            section_tokens = self.count_tokens(section_text)

            if used_tokens + section_tokens <= available_tokens:
                context_parts.append(section_text)
                used_tokens += section_tokens
            else:
                # Try to fit partial content
                remaining = available_tokens - used_tokens - 50  # Buffer
                if remaining > 100:  # Worth including
                    tokens = self.encoding.encode(content)[:remaining]
                    truncated = self.encoding.decode(tokens)
                    context_parts.append(f"\n### {section.name.upper()} (truncated) ###\n{truncated}...\n")
                break

        return "".join(context_parts)

# Usage
context_mgr = ContextManager(max_tokens=8000)

context_mgr.add_section(ContextSection(
    name="System Requirements",
    content=requirements_doc,
    priority=1,
    max_tokens=1000
))

context_mgr.add_section(ContextSection(
    name="Current Implementation",
    content=source_code,
    priority=2,
    max_tokens=3000
))

context_mgr.add_section(ContextSection(
    name="Test Cases",
    content=test_file,
    priority=3
))

optimized_context = context_mgr.build_context()
```

### Dynamic Few-Shot Selection

```python
from typing import List, Tuple
import numpy as np

class DynamicFewShotSelector:
    def __init__(self, embedding_client, examples: List[dict]):
        """
        Initialize with example pairs.
        examples = [{"input": "...", "output": "...", "embedding": [...]}]
        """
        self.client = embedding_client
        self.examples = examples

        # Pre-compute embeddings if not provided
        for ex in self.examples:
            if "embedding" not in ex:
                ex["embedding"] = self._get_embedding(ex["input"])

    def _get_embedding(self, text: str) -> list:
        """Get embedding for text."""
        response = self.client.embeddings.create(
            model="text-embedding-ada-002",
            input=text
        )
        return response.data[0].embedding

    def _cosine_similarity(self, a: list, b: list) -> float:
        """Calculate cosine similarity."""
        a, b = np.array(a), np.array(b)
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    def select_examples(self, query: str, n: int = 3) -> List[dict]:
        """Select the n most relevant examples for the query."""
        query_embedding = self._get_embedding(query)

        # Calculate similarities
        similarities = []
        for ex in self.examples:
            sim = self._cosine_similarity(query_embedding, ex["embedding"])
            similarities.append((sim, ex))

        # Sort by similarity and return top n
        similarities.sort(key=lambda x: x[0], reverse=True)
        return [ex for _, ex in similarities[:n]]

    def build_few_shot_prompt(
        self,
        query: str,
        n_examples: int = 3,
        instruction: str = ""
    ) -> str:
        """Build a prompt with dynamically selected examples."""
        examples = self.select_examples(query, n_examples)

        prompt_parts = []
        if instruction:
            prompt_parts.append(instruction)
            prompt_parts.append("")

        prompt_parts.append("Here are some examples:")
        prompt_parts.append("")

        for i, ex in enumerate(examples, 1):
            prompt_parts.append(f"Example {i}:")
            prompt_parts.append(f"Input: {ex['input']}")
            prompt_parts.append(f"Output: {ex['output']}")
            prompt_parts.append("")

        prompt_parts.append("Now, please process the following:")
        prompt_parts.append(f"Input: {query}")
        prompt_parts.append("Output:")

        return "\n".join(prompt_parts)

# Usage
selector = DynamicFewShotSelector(openai_client, training_examples)
prompt = selector.build_few_shot_prompt(
    query=user_input,
    n_examples=3,
    instruction="Convert natural language queries to SQL."
)
```

## Output Control Patterns

### Structured JSON Output

```python
import json
from typing import Type
from pydantic import BaseModel

def create_json_extraction_prompt(
    content: str,
    schema: Type[BaseModel],
    examples: list = None
) -> str:
    """Create a prompt for structured JSON extraction."""

    schema_json = json.dumps(schema.model_json_schema(), indent=2)

    prompt = f"""Extract information from the following content and return it as valid JSON matching this schema:

```json
{schema_json}
```

Important:
- Return ONLY valid JSON, no additional text
- Use null for missing optional fields
- Ensure all required fields are present
- Follow the exact field names and types
"""

    if examples:
        prompt += "\n\nExamples:\n"
        for ex in examples:
            prompt += f"\nInput: {ex['input']}\nOutput: {json.dumps(ex['output'])}\n"

    prompt += f"\n\nContent to extract from:\n{content}\n\nJSON Output:"

    return prompt

## Example schema
from pydantic import BaseModel, Field
from typing import List, Optional

class ContactInfo(BaseModel):
    name: str = Field(description="Full name of the person")
    email: Optional[str] = Field(description="Email address if available")
    phone: Optional[str] = Field(description="Phone number if available")
    company: Optional[str] = Field(description="Company name if mentioned")
    role: Optional[str] = Field(description="Job title or role")

prompt = create_json_extraction_prompt(
    content=email_text,
    schema=ContactInfo
)
```

### Confidence Scoring

```python
def prompt_with_confidence(query: str, task_description: str) -> str:
    """Create a prompt that includes confidence scoring."""
    return f"""{task_description}

Query: {query}

Please provide your response in the following format:

1. **Answer**: Your direct answer to the query
2. **Confidence**: Rate your confidence (0-100%) with justification
3. **Caveats**: Any important limitations or assumptions
4. **Alternatives**: If confidence is below 80%, suggest alternative interpretations

Be honest about uncertainty. It's better to express low confidence than to provide a confident but incorrect answer."""

# Usage
prompt = prompt_with_confidence(
    query="What was the revenue impact of our Q3 marketing campaign?",
    task_description="You are a business analyst assistant. Analyze the provided data and answer questions."
)
```

## Error Recovery Patterns

### Self-Correction Prompt

```python
def self_correction_prompt(
    original_query: str,
    initial_response: str,
    error_description: str
) -> str:
    """Create a prompt for self-correction."""
    return f"""I previously attempted to answer a query but made an error. Please help me correct it.

Original Query: {original_query}

My Initial Response:
{initial_response}

Error/Issue Identified: {error_description}

Please:
1. Identify what went wrong in my initial response
2. Explain the correct approach
3. Provide a corrected response

Focus on learning from the error and ensuring the correction is accurate."""

# Usage example
correction_prompt = self_correction_prompt(
    original_query="Calculate the compound interest for $10,000 at 5% for 3 years",
    initial_response="$10,000 * 0.05 * 3 = $1,500 interest",
    error_description="Used simple interest formula instead of compound interest"
)
```

## Conclusion

Advanced prompt engineering is about creating structured, clear communication with GPT-4. These techniques help produce more reliable, consistent outputs. The key principles are:

1. **Structure your requests** clearly and explicitly
2. **Provide relevant context** efficiently within token limits
3. **Use examples** that match the query type
4. **Control outputs** with schemas and formats
5. **Build in error recovery** mechanisms

Experiment with these patterns and adapt them to your specific use cases.
