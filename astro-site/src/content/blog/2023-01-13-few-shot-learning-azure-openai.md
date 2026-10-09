---
title: "Few-Shot Learning with Azure OpenAI: Teaching by Example"
author: Michael John Peña
draft: false
date: 2023-01-13
tags:
  - Azure
  - OpenAI
  - Few-Shot Learning
  - Prompt Engineering
  - AI
---

## Understanding Few-Shot Learning

Few-shot learning provides examples that demonstrate the desired input-output pattern:

- **Zero-shot**: No examples, just instructions
- **One-shot**: One example
- **Few-shot**: Multiple examples (typically 2-5)

```python
import openai
from typing import List, Tuple

class FewShotPrompt:
    """Build few-shot prompts with examples."""

    def __init__(
        self,
        task_description: str,
        input_label: str = "Input",
        output_label: str = "Output"
    ):
        self.task_description = task_description
        self.input_label = input_label
        self.output_label = output_label
        self.examples: List[Tuple[str, str]] = []

    def add_example(self, input_text: str, output_text: str):
        """Add an example to the prompt."""
        self.examples.append((input_text, output_text))
        return self  # Enable chaining

    def build(self, query: str) -> str:
        """Build the complete few-shot prompt."""
        parts = [self.task_description, ""]

        for inp, out in self.examples:
            parts.append(f"{self.input_label}: {inp}")
            parts.append(f"{self.output_label}: {out}")
            parts.append("")

        parts.append(f"{self.input_label}: {query}")
        parts.append(f"{self.output_label}:")

        return "\n".join(parts)

# Example: Sentiment Classification
sentiment_prompt = FewShotPrompt(
    task_description="Classify the sentiment of the following text as positive, negative, or neutral.",
    input_label="Text",
    output_label="Sentiment"
)

sentiment_prompt.add_example(
    "I love using Azure! It's so easy and powerful.",
    "positive"
).add_example(
    "The service was down again. Very frustrating.",
    "negative"
).add_example(
    "The meeting is scheduled for 3pm tomorrow.",
    "neutral"
)

# Use the prompt
prompt = sentiment_prompt.build("Azure Functions saved us so much time on this project!")
print(prompt)
```

## Structured Few-Shot Examples

For complex tasks, structure your examples carefully:

```python
from dataclasses import dataclass
from typing import Dict, Any, Optional
import json

@dataclass
class FewShotExample:
    """A single few-shot example."""
    input_data: Dict[str, Any]
    output_data: Dict[str, Any]
    explanation: Optional[str] = None

class StructuredFewShot:
    """Build structured few-shot prompts."""

    def __init__(self, task: str, input_schema: Dict, output_schema: Dict):
        self.task = task
        self.input_schema = input_schema
        self.output_schema = output_schema
        self.examples: List[FewShotExample] = []

    def add_example(
        self,
        input_data: Dict[str, Any],
        output_data: Dict[str, Any],
        explanation: str = None
    ):
        """Add a structured example."""
        self.examples.append(FewShotExample(input_data, output_data, explanation))
        return self

    def build(self, query: Dict[str, Any]) -> str:
        """Build the prompt."""
        prompt_parts = [
            f"Task: {self.task}",
            "",
            f"Input schema: {json.dumps(self.input_schema)}",
            f"Output schema: {json.dumps(self.output_schema)}",
            "",
            "Examples:",
            ""
        ]

        for i, example in enumerate(self.examples, 1):
            prompt_parts.append(f"Example {i}:")
            prompt_parts.append(f"Input: {json.dumps(example.input_data)}")
            prompt_parts.append(f"Output: {json.dumps(example.output_data)}")
            if example.explanation:
                prompt_parts.append(f"Explanation: {example.explanation}")
            prompt_parts.append("")

        prompt_parts.append("Now process this input:")
        prompt_parts.append(f"Input: {json.dumps(query)}")
        prompt_parts.append("Output:")

        return "\n".join(prompt_parts)

# Example: Entity Extraction
entity_extractor = StructuredFewShot(
    task="Extract entities from Azure resource descriptions",
    input_schema={"description": "string"},
    output_schema={
        "resource_type": "string",
        "name": "string",
        "region": "string|null",
        "sku": "string|null"
    }
)

entity_extractor.add_example(
    input_data={"description": "Create a Standard_LRS storage account named 'mystorageacct' in East US"},
    output_data={
        "resource_type": "Storage Account",
        "name": "mystorageacct",
        "region": "East US",
        "sku": "Standard_LRS"
    },
    explanation="Extracted storage account details from creation command"
).add_example(
    input_data={"description": "Deploy a B1 App Service Plan called 'myplan' in West Europe"},
    output_data={
        "resource_type": "App Service Plan",
        "name": "myplan",
        "region": "West Europe",
        "sku": "B1"
    }
)

prompt = entity_extractor.build({
    "description": "Set up a Premium P1 Azure SQL Database named 'ordersdb' in Australia East"
})
```

## Dynamic Example Selection

Select the most relevant examples for each query:

```python
from typing import List, Callable
import numpy as np

class DynamicFewShot:
    """Dynamically select examples based on similarity."""

    def __init__(
        self,
        task_description: str,
        similarity_fn: Callable[[str, str], float] = None
    ):
        self.task_description = task_description
        self.examples: List[Tuple[str, str, List[str]]] = []  # (input, output, tags)
        self.similarity_fn = similarity_fn or self._simple_similarity

    def add_example(
        self,
        input_text: str,
        output_text: str,
        tags: List[str] = None
    ):
        """Add an example with optional tags for matching."""
        self.examples.append((input_text, output_text, tags or []))
        return self

    def _simple_similarity(self, query: str, example_input: str) -> float:
        """Simple word overlap similarity."""
        query_words = set(query.lower().split())
        example_words = set(example_input.lower().split())
        intersection = query_words & example_words
        union = query_words | example_words
        return len(intersection) / len(union) if union else 0

    def select_examples(
        self,
        query: str,
        n: int = 3,
        required_tags: List[str] = None
    ) -> List[Tuple[str, str]]:
        """Select the most relevant examples."""
        candidates = self.examples

        # Filter by tags if specified
        if required_tags:
            candidates = [
                ex for ex in candidates
                if any(tag in ex[2] for tag in required_tags)
            ]

        # Score by similarity
        scored = [
            (self.similarity_fn(query, ex[0]), ex)
            for ex in candidates
        ]

        # Sort by score and take top n
        scored.sort(key=lambda x: x[0], reverse=True)
        return [(ex[0], ex[1]) for score, ex in scored[:n]]

    def build(
        self,
        query: str,
        n_examples: int = 3,
        required_tags: List[str] = None
    ) -> str:
        """Build prompt with dynamically selected examples."""
        selected = self.select_examples(query, n_examples, required_tags)

        parts = [self.task_description, ""]

        for inp, out in selected:
            parts.append(f"Input: {inp}")
            parts.append(f"Output: {out}")
            parts.append("")

        parts.append(f"Input: {query}")
        parts.append("Output:")

        return "\n".join(parts)

# Example: Code Translation
translator = DynamicFewShot(
    task_description="Translate the code snippet to the target language."
)

# Add Python to C# examples
translator.add_example(
    "Python: for item in items: print(item)",
    "C#: foreach (var item in items) { Console.WriteLine(item); }",
    tags=["python", "csharp", "loop"]
).add_example(
    "Python: def greet(name): return f'Hello, {name}'",
    "C#: public string Greet(string name) => $\"Hello, {name}\";",
    tags=["python", "csharp", "function"]
).add_example(
    "Python: result = [x*2 for x in numbers]",
    "C#: var result = numbers.Select(x => x * 2).ToList();",
    tags=["python", "csharp", "linq", "list"]
)

# Add JavaScript to Python examples
translator.add_example(
    "JavaScript: const double = (x) => x * 2",
    "Python: double = lambda x: x * 2",
    tags=["javascript", "python", "lambda"]
)

# Build prompt with relevant examples
prompt = translator.build(
    "Python: filtered = [x for x in items if x > 10]",
    n_examples=2,
    required_tags=["python", "csharp"]
)
```

## Few-Shot with Embeddings

Use embeddings for semantic example selection:

```python
import openai
from typing import List, Tuple
import numpy as np

class EmbeddingFewShot:
    """Few-shot learning with embedding-based example selection."""

    def __init__(self, deployment: str = "text-embedding-ada-002"):
        self.deployment = deployment
        self.examples: List[Tuple[str, str, List[float]]] = []

    def _get_embedding(self, text: str) -> List[float]:
        """Get embedding for text."""
        response = openai.Embedding.create(
            engine=self.deployment,
            input=text
        )
        return response['data'][0]['embedding']

    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        """Calculate cosine similarity."""
        a = np.array(a)
        b = np.array(b)
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    def add_example(self, input_text: str, output_text: str):
        """Add example with precomputed embedding."""
        embedding = self._get_embedding(input_text)
        self.examples.append((input_text, output_text, embedding))
        return self

    def get_similar_examples(
        self,
        query: str,
        n: int = 3
    ) -> List[Tuple[str, str, float]]:
        """Get most similar examples by embedding."""
        query_embedding = self._get_embedding(query)

        similarities = [
            (inp, out, self._cosine_similarity(query_embedding, emb))
            for inp, out, emb in self.examples
        ]

        similarities.sort(key=lambda x: x[2], reverse=True)
        return similarities[:n]

    def build(self, query: str, n_examples: int = 3) -> str:
        """Build prompt with semantically similar examples."""
        similar = self.get_similar_examples(query, n_examples)

        parts = ["Based on these examples, complete the task:", ""]

        for inp, out, score in similar:
            parts.append(f"Input: {inp}")
            parts.append(f"Output: {out}")
            parts.append("")

        parts.append(f"Input: {query}")
        parts.append("Output:")

        return "\n".join(parts)

# Note: This requires actual Azure OpenAI embeddings
# Example usage pattern:
# embedder = EmbeddingFewShot(deployment="ada-embedding")
# embedder.add_example("How do I create a VM?", "Use az vm create...")
# embedder.add_example("How do I deploy an app?", "Use az webapp up...")
# prompt = embedder.build("How do I provision a database?")
```

## Few-Shot for Different Task Types

### Classification

```python
def classification_few_shot(
    categories: List[str],
    examples: List[Tuple[str, str]],
    query: str
) -> str:
    """Build classification few-shot prompt."""
    categories_str = ", ".join(categories)

    prompt = f"""Classify the text into one of these categories: {categories_str}

"""
    for text, category in examples:
        prompt += f"Text: {text}\nCategory: {category}\n\n"

    prompt += f"Text: {query}\nCategory:"
    return prompt

# Example
prompt = classification_few_shot(
    categories=["bug", "feature", "question", "documentation"],
    examples=[
        ("The app crashes when I click submit", "bug"),
        ("Can you add dark mode?", "feature"),
        ("How do I configure SSL?", "question"),
        ("The README is outdated", "documentation")
    ],
    query="Would be great to have export to PDF"
)
```

### Generation

```python
def generation_few_shot(
    style_description: str,
    examples: List[Tuple[str, str]],
    query: str
) -> str:
    """Build generation few-shot prompt."""
    prompt = f"""{style_description}

"""
    for inp, out in examples:
        prompt += f"Topic: {inp}\nGenerated:\n{out}\n\n"

    prompt += f"Topic: {query}\nGenerated:\n"
    return prompt

# Example: Blog title generation
prompt = generation_few_shot(
    style_description="Generate engaging blog titles for Azure technical articles.",
    examples=[
        ("Azure Functions performance", "10 Secrets to Blazing Fast Azure Functions"),
        ("Cosmos DB scaling", "Scale to Millions: A Practical Guide to Cosmos DB Partitioning"),
        ("AKS security", "Lock It Down: Essential Security Practices for AKS")
    ],
    query="Azure OpenAI cost optimization"
)
```

### Transformation

```python
def transformation_few_shot(
    transformation_type: str,
    examples: List[Tuple[str, str]],
    query: str
) -> str:
    """Build transformation few-shot prompt."""
    prompt = f"""Perform the following transformation: {transformation_type}

"""
    for before, after in examples:
        prompt += f"Before: {before}\nAfter: {after}\n\n"

    prompt += f"Before: {query}\nAfter:"
    return prompt

# Example: SQL to natural language
prompt = transformation_few_shot(
    transformation_type="Convert SQL queries to natural language descriptions",
    examples=[
        (
            "SELECT * FROM users WHERE created_at > '2023-01-01'",
            "Get all users who were created after January 1st, 2023"
        ),
        (
            "SELECT COUNT(*) FROM orders GROUP BY customer_id",
            "Count the number of orders for each customer"
        )
    ],
    query="SELECT u.name, SUM(o.amount) FROM users u JOIN orders o ON u.id = o.user_id GROUP BY u.id HAVING SUM(o.amount) > 1000"
)
```

## Best Practices for Few-Shot Learning

```python
class FewShotBestPractices:
    """Guidelines for effective few-shot learning."""

    GUIDELINES = {
        "example_quality": [
            "Use clear, unambiguous examples",
            "Cover edge cases and variations",
            "Ensure examples are factually correct",
            "Use realistic, representative data"
        ],
        "example_quantity": [
            "Start with 2-3 examples",
            "Add more only if needed for complex tasks",
            "Consider token budget - more examples = fewer output tokens",
            "Test with different quantities to find optimal number"
        ],
        "example_diversity": [
            "Include different types of inputs",
            "Show various output formats if applicable",
            "Cover positive and negative cases",
            "Represent the full range of expected inputs"
        ],
        "example_ordering": [
            "Put most relevant examples last (closest to query)",
            "Order from simple to complex",
            "Maintain consistent formatting across examples",
            "Consider random ordering to reduce position bias"
        ]
    }

    @classmethod
    def check_examples(
        cls,
        examples: List[Tuple[str, str]]
    ) -> List[str]:
        """Check examples for common issues."""
        issues = []

        if len(examples) < 2:
            issues.append("Consider adding more examples (at least 2)")

        if len(examples) > 5:
            issues.append("Many examples may exceed token limits - consider reducing")

        # Check for consistency
        output_lengths = [len(out) for _, out in examples]
        if max(output_lengths) > 3 * min(output_lengths):
            issues.append("Output lengths vary significantly - consider normalizing")

        # Check for duplicates
        inputs = [inp.lower().strip() for inp, _ in examples]
        if len(inputs) != len(set(inputs)):
            issues.append("Duplicate or very similar inputs detected")

        return issues
```

## Resources

- [Few-Shot Learning Paper](https://arxiv.org/abs/2005.14165)
- [Azure OpenAI Examples](https://learn.microsoft.com/azure/cognitive-services/openai/concepts/prompt-engineering)
- [Prompt Engineering Guide](https://www.promptingguide.ai/techniques/fewshot)
