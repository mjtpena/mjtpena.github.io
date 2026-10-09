---
title: "Token Management in Azure OpenAI: Counting, Optimizing, and Budgeting"
author: Michael John Peña
draft: false
date: 2023-01-11
tags:
  - Azure
  - OpenAI
  - Tokens
  - Cost Optimization
  - AI
---

## What Are Tokens?

Tokens are the basic units of text that LLMs process. In English:
- 1 token ≈ 4 characters
- 1 token ≈ 0.75 words
- 100 tokens ≈ 75 words

```python
import tiktoken

def explore_tokenization(text: str, model: str = "gpt-3.5-turbo"):
    """Explore how text is tokenized."""
    encoding = tiktoken.encoding_for_model(model)
    tokens = encoding.encode(text)

    print(f"Text: {text}")
    print(f"Token count: {len(tokens)}")
    print(f"Tokens: {tokens}")
    print(f"Decoded tokens:")

    for token in tokens:
        decoded = encoding.decode([token])
        print(f"  {token}: '{decoded}'")

# Example
explore_tokenization("Azure OpenAI Service is powerful!")
# Output:
# Text: Azure OpenAI Service is powerful!
# Token count: 7
# Tokens: [35429, 5765, 15836, 3783, 374, 8147, 0]
# Decoded tokens:
#   35429: 'Azure'
#   5765: ' Open'
#   15836: 'AI'
#   3783: ' Service'
#   374: ' is'
#   8147: ' powerful'
#   0: '!'
```

## Token Counting Library

Build a comprehensive token counting utility:

```python
from dataclasses import dataclass
from typing import List, Dict, Optional, Union
import tiktoken

@dataclass
class TokenCount:
    """Token count result."""
    total: int
    prompt_tokens: int
    estimated_completion_tokens: int
    model: str

class TokenCounter:
    """Count tokens for Azure OpenAI requests."""

    # Model to encoding mapping
    MODEL_ENCODINGS = {
        "gpt-4": "cl100k_base",
        "gpt-4-32k": "cl100k_base",
        "gpt-3.5-turbo": "cl100k_base",
        "text-davinci-003": "p50k_base",
        "text-davinci-002": "p50k_base",
        "code-davinci-002": "p50k_base",
        "text-embedding-ada-002": "cl100k_base"
    }

    # Tokens per message overhead for chat models
    CHAT_OVERHEAD = {
        "gpt-3.5-turbo": 4,  # every message follows <im_start>{role/name}\n{content}<im_end>\n
        "gpt-4": 3
    }

    def __init__(self, model: str = "gpt-3.5-turbo"):
        self.model = model
        encoding_name = self.MODEL_ENCODINGS.get(model, "cl100k_base")
        self.encoding = tiktoken.get_encoding(encoding_name)

    def count_text(self, text: str) -> int:
        """Count tokens in a text string."""
        return len(self.encoding.encode(text))

    def count_messages(self, messages: List[Dict[str, str]]) -> int:
        """Count tokens in chat messages."""
        overhead = self.CHAT_OVERHEAD.get(self.model, 4)
        total = 0

        for message in messages:
            total += overhead

            for key, value in message.items():
                total += self.count_text(str(value))
                if key == "name":
                    total -= 1  # Role is omitted if name is present

        total += 2  # Every reply is primed with <im_start>assistant

        return total

    def estimate_completion(
        self,
        prompt: Union[str, List[Dict[str, str]]],
        max_tokens: int
    ) -> TokenCount:
        """Estimate total tokens for a request."""

        if isinstance(prompt, str):
            prompt_tokens = self.count_text(prompt)
        else:
            prompt_tokens = self.count_messages(prompt)

        return TokenCount(
            total=prompt_tokens + max_tokens,
            prompt_tokens=prompt_tokens,
            estimated_completion_tokens=max_tokens,
            model=self.model
        )

    def truncate_to_fit(
        self,
        text: str,
        max_tokens: int,
        truncation_indicator: str = "..."
    ) -> str:
        """Truncate text to fit within token limit."""
        tokens = self.encoding.encode(text)

        if len(tokens) <= max_tokens:
            return text

        # Account for truncation indicator
        indicator_tokens = self.count_text(truncation_indicator)
        target_tokens = max_tokens - indicator_tokens

        truncated_tokens = tokens[:target_tokens]
        return self.encoding.decode(truncated_tokens) + truncation_indicator

    def split_into_chunks(
        self,
        text: str,
        chunk_size: int,
        overlap: int = 0
    ) -> List[str]:
        """Split text into token-sized chunks."""
        tokens = self.encoding.encode(text)
        chunks = []

        start = 0
        while start < len(tokens):
            end = start + chunk_size
            chunk_tokens = tokens[start:end]
            chunks.append(self.encoding.decode(chunk_tokens))
            start = end - overlap

        return chunks

# Usage
counter = TokenCounter("gpt-3.5-turbo")

# Count simple text
print(f"Token count: {counter.count_text('Hello, world!')}")

# Count chat messages
messages = [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is Azure?"}
]
print(f"Message tokens: {counter.count_messages(messages)}")

# Estimate request
estimate = counter.estimate_completion(messages, max_tokens=500)
print(f"Estimated total: {estimate.total}")
```

## Cost Calculation

Calculate and track costs:

```python
from datetime import datetime
from typing import Dict, List
from decimal import Decimal
import json

@dataclass
class PricingTier:
    """Pricing information for a model."""
    prompt_price_per_1k: Decimal
    completion_price_per_1k: Decimal
    model: str

class CostCalculator:
    """Calculate costs for Azure OpenAI usage."""

    # Pricing as of January 2023 (check current pricing)
    PRICING = {
        "gpt-3.5-turbo": PricingTier(
            prompt_price_per_1k=Decimal("0.0015"),
            completion_price_per_1k=Decimal("0.002"),
            model="gpt-3.5-turbo"
        ),
        "text-davinci-003": PricingTier(
            prompt_price_per_1k=Decimal("0.02"),
            completion_price_per_1k=Decimal("0.02"),
            model="text-davinci-003"
        ),
        "text-embedding-ada-002": PricingTier(
            prompt_price_per_1k=Decimal("0.0001"),
            completion_price_per_1k=Decimal("0"),
            model="text-embedding-ada-002"
        )
    }

    def __init__(self, model: str = "gpt-3.5-turbo"):
        self.model = model
        self.pricing = self.PRICING.get(model, self.PRICING["gpt-3.5-turbo"])

    def calculate_cost(
        self,
        prompt_tokens: int,
        completion_tokens: int
    ) -> Dict[str, Decimal]:
        """Calculate cost for a request."""
        prompt_cost = (Decimal(prompt_tokens) / 1000) * self.pricing.prompt_price_per_1k
        completion_cost = (Decimal(completion_tokens) / 1000) * self.pricing.completion_price_per_1k

        return {
            "prompt_cost": prompt_cost,
            "completion_cost": completion_cost,
            "total_cost": prompt_cost + completion_cost
        }

    def estimate_monthly_cost(
        self,
        requests_per_day: int,
        avg_prompt_tokens: int,
        avg_completion_tokens: int
    ) -> Dict[str, Decimal]:
        """Estimate monthly costs."""
        daily_cost = self.calculate_cost(
            prompt_tokens=requests_per_day * avg_prompt_tokens,
            completion_tokens=requests_per_day * avg_completion_tokens
        )

        monthly_cost = {
            "daily_cost": daily_cost["total_cost"],
            "weekly_cost": daily_cost["total_cost"] * 7,
            "monthly_cost": daily_cost["total_cost"] * 30,
            "requests_per_month": requests_per_day * 30,
            "tokens_per_month": (avg_prompt_tokens + avg_completion_tokens) * requests_per_day * 30
        }

        return monthly_cost

class UsageTracker:
    """Track usage over time for budgeting."""

    def __init__(self, budget_limit: Decimal = Decimal("1000")):
        self.budget_limit = budget_limit
        self.usage_log: List[Dict] = []
        self.calculators: Dict[str, CostCalculator] = {}

    def _get_calculator(self, model: str) -> CostCalculator:
        if model not in self.calculators:
            self.calculators[model] = CostCalculator(model)
        return self.calculators[model]

    def record_usage(
        self,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        metadata: Optional[Dict] = None
    ):
        """Record a usage event."""
        calculator = self._get_calculator(model)
        cost = calculator.calculate_cost(prompt_tokens, completion_tokens)

        entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "model": model,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "cost": float(cost["total_cost"]),
            "metadata": metadata or {}
        }

        self.usage_log.append(entry)

    def get_total_cost(self, days: Optional[int] = None) -> Decimal:
        """Get total cost, optionally filtered by days."""
        total = Decimal("0")

        cutoff = None
        if days:
            cutoff = datetime.utcnow() - timedelta(days=days)

        for entry in self.usage_log:
            entry_time = datetime.fromisoformat(entry["timestamp"])
            if cutoff and entry_time < cutoff:
                continue
            total += Decimal(str(entry["cost"]))

        return total

    def get_budget_status(self) -> Dict:
        """Get current budget status."""
        total_cost = self.get_total_cost()
        remaining = self.budget_limit - total_cost
        percentage_used = (total_cost / self.budget_limit * 100) if self.budget_limit > 0 else 0

        return {
            "total_cost": float(total_cost),
            "budget_limit": float(self.budget_limit),
            "remaining": float(remaining),
            "percentage_used": float(percentage_used),
            "is_over_budget": remaining < 0
        }

    def export_usage(self, filepath: str):
        """Export usage log to JSON."""
        with open(filepath, "w") as f:
            json.dump(self.usage_log, f, indent=2)

# Usage
tracker = UsageTracker(budget_limit=Decimal("500"))

# Record some usage
tracker.record_usage(
    model="gpt-3.5-turbo",
    prompt_tokens=150,
    completion_tokens=300,
    metadata={"user": "user123", "feature": "chat"}
)

# Check budget
status = tracker.get_budget_status()
print(f"Budget used: {status['percentage_used']:.1f}%")
```

## Token Optimization Strategies

Optimize prompts to reduce token usage:

```python
class PromptOptimizer:
    """Optimize prompts to reduce token usage."""

    def __init__(self, model: str = "gpt-3.5-turbo"):
        self.counter = TokenCounter(model)

    def compress_whitespace(self, text: str) -> str:
        """Remove excessive whitespace."""
        import re
        # Replace multiple spaces/newlines with single space
        compressed = re.sub(r'\s+', ' ', text)
        return compressed.strip()

    def abbreviate_common_terms(self, text: str) -> str:
        """Replace common terms with abbreviations."""
        replacements = {
            "for example": "e.g.",
            "that is": "i.e.",
            "and so on": "etc.",
            "with respect to": "re:",
            "as soon as possible": "ASAP",
            "information": "info",
            "configuration": "config",
            "application": "app"
        }

        result = text
        for full, abbrev in replacements.items():
            result = result.replace(full, abbrev)

        return result

    def remove_redundant_instructions(self, prompt: str) -> str:
        """Remove redundant/verbose instructions."""
        redundant_phrases = [
            "Please ",
            "Could you please ",
            "I would like you to ",
            "Can you ",
            "I want you to ",
            "It would be great if you could "
        ]

        result = prompt
        for phrase in redundant_phrases:
            result = result.replace(phrase, "")

        return result.strip()

    def optimize(self, prompt: str) -> Dict:
        """Apply all optimizations and return results."""
        original_tokens = self.counter.count_text(prompt)

        optimized = prompt
        optimized = self.compress_whitespace(optimized)
        optimized = self.abbreviate_common_terms(optimized)
        optimized = self.remove_redundant_instructions(optimized)

        optimized_tokens = self.counter.count_text(optimized)

        return {
            "original": prompt,
            "optimized": optimized,
            "original_tokens": original_tokens,
            "optimized_tokens": optimized_tokens,
            "tokens_saved": original_tokens - optimized_tokens,
            "reduction_percentage": (
                (original_tokens - optimized_tokens) / original_tokens * 100
                if original_tokens > 0 else 0
            )
        }

    def suggest_improvements(self, prompt: str) -> List[str]:
        """Suggest ways to reduce tokens."""
        suggestions = []

        # Check for verbose phrases
        if "Please " in prompt or "Could you " in prompt:
            suggestions.append("Remove polite phrases - the model doesn't need them")

        # Check for excessive newlines
        if "\n\n\n" in prompt:
            suggestions.append("Remove excessive blank lines")

        # Check for repeated instructions
        words = prompt.lower().split()
        word_counts = {}
        for word in words:
            word_counts[word] = word_counts.get(word, 0) + 1

        repeated = [w for w, c in word_counts.items() if c > 3 and len(w) > 4]
        if repeated:
            suggestions.append(f"Consider condensing repeated terms: {repeated[:5]}")

        # Check prompt length
        tokens = self.counter.count_text(prompt)
        if tokens > 500:
            suggestions.append(f"Prompt is {tokens} tokens - consider breaking into smaller requests")

        return suggestions

# Usage
optimizer = PromptOptimizer()

verbose_prompt = """
Please could you help me understand the concept of cloud computing?
I would like you to explain what cloud computing is, for example,
the different types of cloud services and so on. It would be great
if you could provide information about Azure specifically.
"""

result = optimizer.optimize(verbose_prompt)
print(f"Original: {result['original_tokens']} tokens")
print(f"Optimized: {result['optimized_tokens']} tokens")
print(f"Saved: {result['tokens_saved']} tokens ({result['reduction_percentage']:.1f}%)")

suggestions = optimizer.suggest_improvements(verbose_prompt)
print("\nSuggestions:")
for s in suggestions:
    print(f"  - {s}")
```

## Context Window Management

Manage conversation context to stay within limits:

```python
class ContextManager:
    """Manage conversation context within token limits."""

    def __init__(
        self,
        model: str = "gpt-3.5-turbo",
        max_context_tokens: int = 3000,
        reserve_for_response: int = 1000
    ):
        self.counter = TokenCounter(model)
        self.max_context_tokens = max_context_tokens
        self.reserve_for_response = reserve_for_response
        self.messages: List[Dict[str, str]] = []
        self.system_message: Optional[Dict[str, str]] = None

    def set_system_message(self, content: str):
        """Set the system message."""
        self.system_message = {"role": "system", "content": content}

    def add_message(self, role: str, content: str):
        """Add a message, trimming old messages if needed."""
        new_message = {"role": role, "content": content}
        self.messages.append(new_message)
        self._trim_to_fit()

    def _trim_to_fit(self):
        """Remove oldest messages to fit within token limit."""
        available = self.max_context_tokens - self.reserve_for_response

        while True:
            all_messages = self.get_messages()
            token_count = self.counter.count_messages(all_messages)

            if token_count <= available:
                break

            if len(self.messages) <= 2:
                # Keep at least the last exchange
                break

            # Remove oldest non-system message
            self.messages.pop(0)

    def get_messages(self) -> List[Dict[str, str]]:
        """Get all messages including system message."""
        messages = []
        if self.system_message:
            messages.append(self.system_message)
        messages.extend(self.messages)
        return messages

    def get_token_count(self) -> int:
        """Get current token count."""
        return self.counter.count_messages(self.get_messages())

    def get_available_tokens(self) -> int:
        """Get available tokens for next message."""
        used = self.get_token_count()
        available = self.max_context_tokens - self.reserve_for_response - used
        return max(0, available)

    def clear(self):
        """Clear conversation history."""
        self.messages = []

# Usage
context = ContextManager(max_context_tokens=4000, reserve_for_response=1000)
context.set_system_message("You are a helpful Azure expert.")

# Simulate conversation
context.add_message("user", "What is Azure?")
context.add_message("assistant", "Azure is Microsoft's cloud computing platform...")
context.add_message("user", "Tell me more about Azure Functions")
context.add_message("assistant", "Azure Functions is a serverless compute service...")

print(f"Current tokens: {context.get_token_count()}")
print(f"Available for next message: {context.get_available_tokens()}")
```

## Best Practices

1. **Count before sending**: Always estimate tokens before making requests
2. **Set appropriate max_tokens**: Don't use more than you need
3. **Optimize prompts**: Remove verbose language and redundancy
4. **Manage context**: Trim old messages to stay within limits
5. **Track costs**: Monitor usage and set budgets
6. **Use cheaper models**: When task complexity allows

## Resources

- [OpenAI Tokenizer](https://platform.openai.com/tokenizer)
- [tiktoken Library](https://github.com/openai/tiktoken)
- [Azure OpenAI Pricing](https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/)
