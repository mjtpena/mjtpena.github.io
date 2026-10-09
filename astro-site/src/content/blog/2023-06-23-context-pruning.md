---
title: "Context Pruning: Managing Token Limits in LLM Applications"
description: "Effective context pruning ensures your LLM applications work reliably. Tomorrow, I will cover token budgeting strategies."
author: Michael John Peña
draft: false
date: 2023-06-23
tags:
  - Azure OpenAI
  - Token Management
  - Context Window
  - Optimization
  - LLM
---

## Understanding Context Limits

```python
# GPT-4 context limits
model_limits = {
    "gpt-4": 8192,
    "gpt-4-32k": 32768,
    "gpt-4-turbo": 128000,
    "gpt-3.5-turbo": 4096,
    "gpt-3.5-turbo-16k": 16384
}

# Rough token estimation
def estimate_tokens(text: str) -> int:
    """Rough estimate: ~4 characters per token for English"""
    return len(text) // 4

# Precise token counting
import tiktoken

def count_tokens(text: str, model: str = "gpt-4") -> int:
    encoding = tiktoken.encoding_for_model(model)
    return len(encoding.encode(text))

def count_messages_tokens(messages: list, model: str = "gpt-4") -> int:
    """Count tokens in a message list"""
    encoding = tiktoken.encoding_for_model(model)
    total = 0
    for msg in messages:
        total += 4  # Message overhead
        total += len(encoding.encode(msg.get("content", "")))
        total += len(encoding.encode(msg.get("role", "")))
    total += 2  # Completion overhead
    return total
```

## Pruning Strategies

### Strategy 1: Sliding Window

```python
class SlidingWindowPruner:
    """Keep only the N most recent messages"""

    def __init__(self, max_messages: int = 20, always_keep_system: bool = True):
        self.max_messages = max_messages
        self.always_keep_system = always_keep_system

    def prune(self, messages: list) -> list:
        if len(messages) <= self.max_messages:
            return messages

        if self.always_keep_system:
            # Keep system message(s) + recent messages
            system_messages = [m for m in messages if m["role"] == "system"]
            other_messages = [m for m in messages if m["role"] != "system"]
            keep_count = self.max_messages - len(system_messages)
            return system_messages + other_messages[-keep_count:]
        else:
            return messages[-self.max_messages:]
```

### Strategy 2: Token Budget

```python
class TokenBudgetPruner:
    """Prune to fit within token budget"""

    def __init__(self, max_tokens: int, model: str = "gpt-4"):
        self.max_tokens = max_tokens
        self.model = model
        self.encoding = tiktoken.encoding_for_model(model)

    def prune(self, messages: list, reserve_for_completion: int = 1000) -> list:
        budget = self.max_tokens - reserve_for_completion
        current_tokens = 0
        result = []

        # Always include system message first
        for msg in messages:
            if msg["role"] == "system":
                tokens = self._count_message_tokens(msg)
                if current_tokens + tokens <= budget:
                    result.append(msg)
                    current_tokens += tokens
                break

        # Add recent messages from the end
        non_system = [m for m in messages if m["role"] != "system"]
        for msg in reversed(non_system):
            tokens = self._count_message_tokens(msg)
            if current_tokens + tokens <= budget:
                result.insert(-1 if result else 0, msg)  # Insert before last
                current_tokens += tokens
            else:
                break

        # Ensure chronological order
        return sorted(result, key=lambda m: messages.index(m))

    def _count_message_tokens(self, message: dict) -> int:
        return 4 + len(self.encoding.encode(message.get("content", "")))
```

### Strategy 3: Summarization

```python
class SummarizationPruner:
    """Summarize older messages to compress context"""

    def __init__(self, client, keep_recent: int = 10):
        self.client = client
        self.keep_recent = keep_recent

    def prune(self, messages: list) -> list:
        if len(messages) <= self.keep_recent + 1:  # +1 for system
            return messages

        # Separate messages
        system_msg = next((m for m in messages if m["role"] == "system"), None)
        non_system = [m for m in messages if m["role"] != "system"]

        # Messages to summarize vs keep
        to_summarize = non_system[:-self.keep_recent]
        to_keep = non_system[-self.keep_recent:]

        if to_summarize:
            summary = self._summarize(to_summarize)
            result = []
            if system_msg:
                result.append(system_msg)
            result.append({
                "role": "system",
                "content": f"Previous conversation summary: {summary}"
            })
            result.extend(to_keep)
            return result

        return messages

    def _summarize(self, messages: list) -> str:
        conversation = "\n".join([
            f"{m['role']}: {m['content']}"
            for m in messages
        ])

        response = self.client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{
                "role": "user",
                "content": f"""Summarize this conversation concisely, preserving key information:

{conversation}

Focus on:
- Main topics discussed
- Decisions made
- Important facts mentioned
- User preferences or requirements"""
            }],
            max_tokens=300
        )

        return response.choices[0].message.content
```

### Strategy 4: Importance-Based

```python
class ImportanceBasedPruner:
    """Keep messages based on importance scores"""

    def __init__(self, client, max_tokens: int):
        self.client = client
        self.max_tokens = max_tokens

    def prune(self, messages: list, reserve: int = 1000) -> list:
        # Always keep system and last few messages
        system_msgs = [m for m in messages if m["role"] == "system"]
        other_msgs = [m for m in messages if m["role"] != "system"]

        if len(other_msgs) <= 4:
            return messages

        # Score messages by importance
        scored = self._score_messages(other_msgs)

        # Sort by importance (keep original order for ties)
        scored_with_index = [(i, m, s) for i, (m, s) in enumerate(scored)]

        # Select messages within token budget
        budget = self.max_tokens - reserve - sum(
            count_tokens(m["content"]) for m in system_msgs
        )

        # Always keep last 2 messages
        must_keep = other_msgs[-2:]
        budget -= sum(count_tokens(m["content"]) for m in must_keep)

        # Select from remaining by importance
        candidates = scored_with_index[:-2]
        candidates.sort(key=lambda x: x[2], reverse=True)

        selected_indices = set()
        current_tokens = 0

        for idx, msg, score in candidates:
            tokens = count_tokens(msg["content"])
            if current_tokens + tokens <= budget:
                selected_indices.add(idx)
                current_tokens += tokens

        # Reconstruct in original order
        result = system_msgs.copy()
        for i, msg in enumerate(other_msgs[:-2]):
            if i in selected_indices:
                result.append(msg)
        result.extend(must_keep)

        return result

    def _score_messages(self, messages: list) -> list:
        """Score messages by importance"""
        scored = []

        for i, msg in enumerate(messages):
            score = 1.0

            # Recency bonus
            recency_bonus = (i + 1) / len(messages) * 0.3
            score += recency_bonus

            # Content-based scoring
            content = msg["content"].lower()

            # Questions are important
            if "?" in content:
                score += 0.2

            # Action items
            if any(word in content for word in ["please", "need", "want", "must", "should"]):
                score += 0.2

            # Numbers/specifics
            if any(char.isdigit() for char in content):
                score += 0.1

            # Length consideration (very short or very long may be less important)
            length = len(content)
            if 50 < length < 500:
                score += 0.1

            scored.append((msg, score))

        return scored
```

## Hybrid Approach

```python
class HybridContextManager:
    """Combine multiple pruning strategies"""

    def __init__(self, client, model: str, max_context_tokens: int):
        self.client = client
        self.model = model
        self.max_tokens = max_context_tokens

        self.summarizer = SummarizationPruner(client, keep_recent=10)
        self.token_pruner = TokenBudgetPruner(max_context_tokens, model)

    def prepare_context(self, messages: list, reserve_for_completion: int = 1000) -> list:
        """Prepare optimal context within limits"""

        # Step 1: Check if already within limits
        current_tokens = count_messages_tokens(messages, self.model)
        if current_tokens <= self.max_tokens - reserve_for_completion:
            return messages

        # Step 2: Try summarization first (preserves more info)
        summarized = self.summarizer.prune(messages)
        summarized_tokens = count_messages_tokens(summarized, self.model)

        if summarized_tokens <= self.max_tokens - reserve_for_completion:
            return summarized

        # Step 3: Token-based pruning as fallback
        return self.token_pruner.prune(summarized, reserve_for_completion)
```

## Usage Example

```python
# Configure context manager
context_manager = HybridContextManager(
    client=openai_client,
    model="gpt-4",
    max_context_tokens=8192
)

# In chat function
def chat(messages: list, user_input: str) -> str:
    # Add user message
    messages.append({"role": "user", "content": user_input})

    # Prepare context
    context = context_manager.prepare_context(
        messages,
        reserve_for_completion=1500  # Reserve tokens for response
    )

    # Call API
    response = client.chat.completions.create(
        model="gpt-4",
        messages=context,
        max_tokens=1500
    )

    return response.choices[0].message.content
```

Effective context pruning ensures your LLM applications work reliably. Tomorrow, I will cover token budgeting strategies.

## Resources

- [Tiktoken Library](https://github.com/openai/tiktoken)
- [Managing Token Limits](https://platform.openai.com/docs/guides/chat/managing-tokens)
