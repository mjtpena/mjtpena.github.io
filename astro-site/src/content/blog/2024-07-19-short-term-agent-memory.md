---
title: "Short-Term Agent Memory: Context Window Management"
description: "Sounds like a lot, but it fills up quickly with conversation history, system prompts, tool outputs, and retrieved documents."
author: Michael John Peña
draft: false
date: 2024-07-19
tags:
  - AI
  - Agents
  - Memory
  - Context
  - LLM
---

## The Context Window Challenge

LLMs have finite context windows:
- GPT-4o: 128K tokens
- Claude 3.5 Sonnet: 200K tokens
- GPT-4o-mini: 128K tokens

Sounds like a lot, but it fills up quickly with conversation history, system prompts, tool outputs, and retrieved documents.

## Basic Sliding Window

```python
from collections import deque
from typing import Optional

class SlidingWindowMemory:
    def __init__(self, max_messages: int = 50):
        self.messages = deque(maxlen=max_messages)

    def add_message(self, role: str, content: str):
        self.messages.append({
            "role": role,
            "content": content
        })

    def get_messages(self) -> list[dict]:
        return list(self.messages)

    def clear(self):
        self.messages.clear()

# Simple but loses important context when window fills
memory = SlidingWindowMemory(max_messages=20)
memory.add_message("user", "What is Azure Synapse?")
memory.add_message("assistant", "Azure Synapse is...")
```

## Token-Aware Memory

```python
class TokenAwareMemory:
    def __init__(self, max_tokens: int = 8000):
        self.messages = []
        self.max_tokens = max_tokens
        self.current_tokens = 0

    def estimate_tokens(self, text: str) -> int:
        """Rough token estimation (4 chars per token)."""
        return len(text) // 4 + 1

    def add_message(self, role: str, content: str, priority: int = 5):
        """Add message with priority (1-10, higher = more important)."""
        tokens = self.estimate_tokens(content)

        message = {
            "role": role,
            "content": content,
            "tokens": tokens,
            "priority": priority
        }

        # Make room if needed
        while self.current_tokens + tokens > self.max_tokens and self.messages:
            self._evict_one()

        self.messages.append(message)
        self.current_tokens += tokens

    def _evict_one(self):
        """Remove lowest priority, oldest message."""
        if not self.messages:
            return

        # Don't evict system messages
        evictable = [
            (i, m) for i, m in enumerate(self.messages)
            if m["role"] != "system"
        ]

        if not evictable:
            return

        # Find lowest priority
        min_priority = min(m["priority"] for _, m in evictable)
        candidates = [(i, m) for i, m in evictable if m["priority"] == min_priority]

        # Remove oldest among lowest priority
        idx_to_remove = candidates[0][0]
        removed = self.messages.pop(idx_to_remove)
        self.current_tokens -= removed["tokens"]

    def get_messages(self) -> list[dict]:
        """Get messages for LLM (without internal metadata)."""
        return [
            {"role": m["role"], "content": m["content"]}
            for m in self.messages
        ]

    def get_usage(self) -> dict:
        return {
            "current_tokens": self.current_tokens,
            "max_tokens": self.max_tokens,
            "utilization": self.current_tokens / self.max_tokens,
            "message_count": len(self.messages)
        }

# Usage
memory = TokenAwareMemory(max_tokens=4000)

# System prompt - high priority
memory.add_message("system", "You are a helpful data assistant.", priority=10)

# User messages - medium priority
memory.add_message("user", "What tables do we have?", priority=5)

# Tool outputs - lower priority (can be regenerated)
memory.add_message("assistant", "[Tool output: tables list...]", priority=3)
```

## Summarization-Based Memory

When context fills up, summarize instead of dropping:

```python
from langchain_openai import AzureChatOpenAI

class SummarizingMemory:
    def __init__(
        self,
        max_tokens: int = 8000,
        summary_threshold: float = 0.8,
        keep_recent: int = 5
    ):
        self.messages = []
        self.summaries = []
        self.max_tokens = max_tokens
        self.summary_threshold = summary_threshold
        self.keep_recent = keep_recent
        self.llm = AzureChatOpenAI(azure_deployment="gpt-4o-mini")

    def add_message(self, role: str, content: str):
        self.messages.append({"role": role, "content": content})

        # Check if summarization needed
        current_tokens = self._count_tokens()
        if current_tokens > self.max_tokens * self.summary_threshold:
            self._summarize()

    def _count_tokens(self) -> int:
        total = sum(len(m["content"]) // 4 for m in self.messages)
        total += sum(len(s) // 4 for s in self.summaries)
        return total

    def _summarize(self):
        """Summarize older messages."""
        if len(self.messages) <= self.keep_recent:
            return

        # Split into messages to summarize and recent to keep
        to_summarize = self.messages[:-self.keep_recent]
        recent = self.messages[-self.keep_recent:]

        # Generate summary
        messages_text = "\n".join(
            f"{m['role']}: {m['content']}"
            for m in to_summarize
        )

        prompt = f"""Summarize this conversation concisely, keeping key information:

{messages_text}

Summary:"""

        summary = self.llm.invoke(prompt).content

        # Replace messages with summary
        self.summaries.append(summary)
        self.messages = recent

    def get_context(self) -> list[dict]:
        """Get full context including summaries."""
        context = []

        # Add summaries first
        if self.summaries:
            combined_summary = " | ".join(self.summaries)
            context.append({
                "role": "system",
                "content": f"Previous conversation summary: {combined_summary}"
            })

        # Add recent messages
        context.extend(self.messages)

        return context

# Usage
memory = SummarizingMemory(max_tokens=4000, keep_recent=10)

# Long conversation...
for i in range(50):
    memory.add_message("user", f"Question {i}: Tell me about feature {i}")
    memory.add_message("assistant", f"Answer {i}: Feature {i} does...")

# Get context - older messages are summarized
context = memory.get_context()
```

## Importance-Weighted Memory

Not all messages are equal - weight them:

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Callable

@dataclass
class WeightedMessage:
    role: str
    content: str
    timestamp: datetime
    importance: float  # 0-1
    tags: list[str]

class ImportanceWeightedMemory:
    def __init__(self, max_tokens: int = 8000):
        self.messages: list[WeightedMessage] = []
        self.max_tokens = max_tokens
        self.importance_calculator: Callable[[str, str], float] = self._default_importance

    def _default_importance(self, role: str, content: str) -> float:
        """Calculate importance score."""
        score = 0.5  # Base score

        # System messages are important
        if role == "system":
            score = 0.9

        # Questions are important
        if "?" in content:
            score += 0.1

        # Code blocks are important
        if "```" in content:
            score += 0.2

        # Error mentions are important
        if "error" in content.lower() or "fail" in content.lower():
            score += 0.15

        # Very short messages less important
        if len(content) < 20:
            score -= 0.1

        return min(1.0, max(0.0, score))

    def add_message(
        self,
        role: str,
        content: str,
        importance: float = None,
        tags: list[str] = None
    ):
        if importance is None:
            importance = self.importance_calculator(role, content)

        msg = WeightedMessage(
            role=role,
            content=content,
            timestamp=datetime.utcnow(),
            importance=importance,
            tags=tags or []
        )

        self.messages.append(msg)
        self._enforce_limit()

    def _enforce_limit(self):
        """Remove low-importance messages when over limit."""
        while self._count_tokens() > self.max_tokens:
            self._remove_least_important()

    def _count_tokens(self) -> int:
        return sum(len(m.content) // 4 for m in self.messages)

    def _remove_least_important(self):
        """Remove the least important, oldest message."""
        if len(self.messages) <= 2:
            return

        # Calculate removal score (lower = remove first)
        def removal_score(msg: WeightedMessage) -> float:
            age_seconds = (datetime.utcnow() - msg.timestamp).total_seconds()
            age_penalty = age_seconds / 3600  # Hours old
            return msg.importance - (age_penalty * 0.1)

        # Find minimum, excluding first (system) message
        candidates = self.messages[1:]
        min_msg = min(candidates, key=removal_score)
        self.messages.remove(min_msg)

    def get_messages(self) -> list[dict]:
        return [
            {"role": m.role, "content": m.content}
            for m in self.messages
        ]

    def get_by_tag(self, tag: str) -> list[dict]:
        """Get messages with specific tag."""
        return [
            {"role": m.role, "content": m.content}
            for m in self.messages
            if tag in m.tags
        ]
```

## Buffer Types for Different Use Cases

```python
class MemoryBufferFactory:
    @staticmethod
    def create_for_use_case(use_case: str, **kwargs):
        """Create appropriate memory buffer for use case."""

        if use_case == "simple_chat":
            return SlidingWindowMemory(max_messages=30)

        elif use_case == "long_conversation":
            return SummarizingMemory(
                max_tokens=kwargs.get("max_tokens", 8000),
                keep_recent=kwargs.get("keep_recent", 10)
            )

        elif use_case == "technical_support":
            # Keep error messages and code
            memory = ImportanceWeightedMemory(max_tokens=12000)
            memory.importance_calculator = lambda r, c: (
                0.9 if "error" in c.lower() or "```" in c else 0.5
            )
            return memory

        elif use_case == "data_analysis":
            # Keep query results and insights
            memory = ImportanceWeightedMemory(max_tokens=16000)
            memory.importance_calculator = lambda r, c: (
                0.8 if "result" in c.lower() or "insight" in c.lower() else 0.5
            )
            return memory

        else:
            return TokenAwareMemory(max_tokens=8000)

# Usage
memory = MemoryBufferFactory.create_for_use_case(
    "technical_support",
    max_tokens=10000
)
```

## Monitoring Context Usage

```python
class MemoryMonitor:
    def __init__(self, memory):
        self.memory = memory
        self.usage_history = []

    def record_usage(self):
        """Record current memory usage."""
        usage = {
            "timestamp": datetime.utcnow().isoformat(),
            "tokens": self.memory._count_tokens() if hasattr(self.memory, '_count_tokens') else 0,
            "messages": len(self.memory.messages),
        }
        self.usage_history.append(usage)

    def get_stats(self) -> dict:
        """Get usage statistics."""
        if not self.usage_history:
            return {}

        tokens = [u["tokens"] for u in self.usage_history]
        return {
            "avg_tokens": sum(tokens) / len(tokens),
            "max_tokens": max(tokens),
            "samples": len(self.usage_history)
        }

    def alert_if_high(self, threshold: float = 0.9):
        """Alert if usage is high."""
        if hasattr(self.memory, 'get_usage'):
            usage = self.memory.get_usage()
            if usage.get("utilization", 0) > threshold:
                print(f"WARNING: Memory utilization at {usage['utilization']:.1%}")
                return True
        return False
```

## Best Practices

1. **Start with token-aware**: Simple but effective
2. **Add summarization for long conversations**: Don't lose context
3. **Weight by importance**: Not all messages are equal
4. **Monitor usage**: Know when you're hitting limits
5. **Test with real conversations**: Synthetic tests miss edge cases

## Conclusion

Short-term memory management directly impacts agent quality. Too little context and the agent forgets; too much and you hit token limits or slow response times.

Choose the right strategy for your use case, and always monitor actual usage in production.
