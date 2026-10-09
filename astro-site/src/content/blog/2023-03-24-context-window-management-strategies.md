---
title: "Context Window Management: 8K vs 32K Strategies"
description: "The 32K model costs 2x more per token. Use it strategically. Effective context management balances quality, cost, and capability. Master these patterns to…"
author: Michael John Pena
draft: false
date: 2023-03-24
tags:
  - OpenAI
  - AI
  - GPT-4
  - Context Window
  - Architecture
---

## Understanding Context Windows

| Model | Tokens | Approximate | Cost/1K Input |
|-------|--------|-------------|---------------|
| GPT-4 8K | 8,192 | ~6,000 words | $0.03 |
| GPT-4 32K | 32,768 | ~25,000 words | $0.06 |

The 32K model costs 2x more per token. Use it strategically.

## When to Use Each Model

```python
from enum import Enum
from dataclasses import dataclass

class ContextStrategy(Enum):
    CHUNKED_8K = "chunked_8k"      # Split and process in parts
    DIRECT_8K = "direct_8k"        # Fits in 8K
    SELECTIVE_8K = "selective_8k"  # Select relevant parts
    FULL_32K = "full_32k"          # Use 32K context

@dataclass
class ContextDecision:
    strategy: ContextStrategy
    estimated_cost: float
    reason: str

class ContextWindowSelector:
    """Select optimal context strategy."""

    def __init__(self):
        self.counter = TokenCounter()

    def select_strategy(
        self,
        content_tokens: int,
        task_type: str,
        quality_requirement: str = "normal"
    ) -> ContextDecision:
        """Select optimal strategy based on content and task."""

        # Tasks that benefit from full context
        full_context_tasks = [
            "legal_analysis", "code_review", "document_comparison",
            "comprehensive_summary", "continuity_critical"
        ]

        # Tasks that work well with chunking
        chunkable_tasks = [
            "extraction", "search", "classification",
            "simple_summary", "qa"
        ]

        # Decision logic
        if content_tokens <= 6000:  # Fits in 8K with room for response
            return ContextDecision(
                strategy=ContextStrategy.DIRECT_8K,
                estimated_cost=content_tokens * 0.03 / 1000,
                reason="Content fits in 8K context"
            )

        elif content_tokens <= 28000:  # Fits in 32K
            if task_type in full_context_tasks or quality_requirement == "high":
                return ContextDecision(
                    strategy=ContextStrategy.FULL_32K,
                    estimated_cost=content_tokens * 0.06 / 1000,
                    reason=f"Task '{task_type}' benefits from full context"
                )
            else:
                return ContextDecision(
                    strategy=ContextStrategy.SELECTIVE_8K,
                    estimated_cost=6000 * 0.03 / 1000,  # Estimated selected content
                    reason="Can select relevant portions"
                )

        else:  # Exceeds 32K
            if task_type in chunkable_tasks:
                return ContextDecision(
                    strategy=ContextStrategy.CHUNKED_8K,
                    estimated_cost=(content_tokens // 6000 + 1) * 6000 * 0.03 / 1000,
                    reason="Content too large, using map-reduce pattern"
                )
            else:
                return ContextDecision(
                    strategy=ContextStrategy.CHUNKED_8K,
                    estimated_cost=(content_tokens // 6000 + 1) * 6000 * 0.03 / 1000,
                    reason="Content exceeds 32K, chunking required"
                )
```

## Smart Context Filling

Maximize value from available context:

```python
class ContextOptimizer:
    """Optimize content for context window."""

    def __init__(self, client):
        self.client = client
        self.counter = TokenCounter()

    async def optimize_for_window(
        self,
        content: str,
        target_tokens: int,
        priority_sections: list[str] = None
    ) -> str:
        """Optimize content to fit context window."""

        current_tokens = self.counter.count(content)

        if current_tokens <= target_tokens:
            return content

        # Try compression first
        compressed = await self._compress_content(content, target_tokens)
        if self.counter.count(compressed) <= target_tokens:
            return compressed

        # Extract priority sections
        if priority_sections:
            extracted = await self._extract_sections(content, priority_sections)
            if self.counter.count(extracted) <= target_tokens:
                return extracted

        # Final fallback: truncate
        return self._truncate_smart(content, target_tokens)

    async def _compress_content(
        self,
        content: str,
        target_tokens: int
    ) -> str:
        """Compress content while preserving meaning."""
        current = self.counter.count(content)
        ratio = target_tokens / current

        prompt = f"""Compress this content to approximately {int(ratio * 100)}% of its length.
Preserve all key information, remove redundancy and verbose language.

Content:
{content[:10000]}  # Limit for compression request

Return compressed version only."""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",  # Use cheaper model for compression
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def _extract_sections(
        self,
        content: str,
        priority_sections: list[str]
    ) -> str:
        """Extract priority sections from content."""
        sections_str = ", ".join(priority_sections)

        prompt = f"""Extract these sections from the content: {sections_str}

Content:
{content[:15000]}

Return only the extracted sections, maintaining original text."""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    def _truncate_smart(
        self,
        content: str,
        target_tokens: int
    ) -> str:
        """Smart truncation preserving structure."""
        tokens = self.counter.encoding.encode(content)

        if len(tokens) <= target_tokens:
            return content

        # Keep beginning and end
        keep_start = int(target_tokens * 0.7)
        keep_end = target_tokens - keep_start - 50  # Buffer for marker

        truncated_tokens = (
            tokens[:keep_start] +
            self.counter.encoding.encode("\n\n[...content truncated...]\n\n") +
            tokens[-keep_end:]
        )

        return self.counter.encoding.decode(truncated_tokens)
```

## Conversation History Management

```python
class ConversationManager:
    """Manage conversation context window."""

    def __init__(self, model: str = "gpt-4"):
        self.counter = TokenCounter(model)
        self.history = []
        self.system_prompt = ""

        if "32k" in model:
            self.max_context = 32000
            self.reserved_for_response = 4000
        else:
            self.max_context = 8000
            self.reserved_for_response = 2000

    def set_system_prompt(self, prompt: str):
        """Set system prompt."""
        self.system_prompt = prompt

    def add_message(self, role: str, content: str):
        """Add message to history."""
        self.history.append({"role": role, "content": content})
        self._manage_window()

    def _manage_window(self):
        """Manage context window size."""
        available = self.max_context - self.reserved_for_response

        # Calculate current usage
        system_tokens = self.counter.count(self.system_prompt) if self.system_prompt else 0
        available -= system_tokens

        # Calculate history tokens
        while True:
            history_tokens = self.counter.count_messages(self.history)
            if history_tokens <= available:
                break

            # Remove oldest non-system messages
            if len(self.history) > 2:  # Keep at least last exchange
                self.history.pop(0)
            else:
                # Summarize oldest message
                self._summarize_oldest()
                break

    def _summarize_oldest(self):
        """Summarize oldest messages to save space."""
        if len(self.history) < 4:
            return

        # Take oldest messages
        to_summarize = self.history[:4]
        remaining = self.history[4:]

        # Create summary
        summary_content = "Previous conversation summary: " + " | ".join([
            f"{m['role']}: {m['content'][:100]}..."
            for m in to_summarize
        ])

        self.history = [
            {"role": "system", "content": summary_content}
        ] + remaining

    def get_messages(self) -> list[dict]:
        """Get messages for API call."""
        messages = []
        if self.system_prompt:
            messages.append({"role": "system", "content": self.system_prompt})
        messages.extend(self.history)
        return messages

    def get_context_usage(self) -> dict:
        """Get context window usage stats."""
        system_tokens = self.counter.count(self.system_prompt) if self.system_prompt else 0
        history_tokens = self.counter.count_messages(self.history)
        total_used = system_tokens + history_tokens

        return {
            "system_tokens": system_tokens,
            "history_tokens": history_tokens,
            "total_used": total_used,
            "available": self.max_context - self.reserved_for_response,
            "utilization": round(total_used / (self.max_context - self.reserved_for_response) * 100, 1)
        }
```

## Document Processing Strategies

```python
class DocumentContextManager:
    """Manage document context for various tasks."""

    def __init__(self, client):
        self.client = client
        self.counter = TokenCounter()

    async def process_with_rolling_context(
        self,
        document: str,
        task: str,
        window_size: int = 6000,
        overlap: int = 500
    ) -> list[dict]:
        """Process document with rolling context window."""

        tokens = self.counter.encoding.encode(document)
        results = []
        position = 0

        while position < len(tokens):
            # Get window
            end = min(position + window_size, len(tokens))
            window_tokens = tokens[position:end]
            window_text = self.counter.encoding.decode(window_tokens)

            # Process window
            result = await self._process_window(
                window_text, task,
                position == 0,  # is_first
                end >= len(tokens)  # is_last
            )

            results.append({
                "position": position,
                "tokens": len(window_tokens),
                "result": result
            })

            position = end - overlap

        return results

    async def process_hierarchical(
        self,
        document: str,
        task: str
    ) -> dict:
        """Hierarchical processing: summarize then analyze."""

        # Step 1: Create section summaries
        sections = self._split_into_sections(document)
        summaries = []

        for section in sections:
            summary = await self._summarize_section(section)
            summaries.append(summary)

        # Step 2: Analyze with summaries as context
        full_summary = "\n\n".join(summaries)

        prompt = f"""Based on these section summaries, {task}

Section Summaries:
{full_summary}

Provide comprehensive analysis."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return {
            "analysis": response.content,
            "section_summaries": summaries,
            "method": "hierarchical"
        }

    def _split_into_sections(self, document: str) -> list[str]:
        """Split document into logical sections."""
        # Split by headers or double newlines
        import re
        sections = re.split(r'\n#{1,3}\s|\n\n\n+', document)
        return [s.strip() for s in sections if s.strip()]

    async def _summarize_section(self, section: str) -> str:
        """Summarize a section."""
        prompt = f"""Summarize this section in 2-3 sentences, preserving key facts:

{section[:4000]}"""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Best Practices Summary

1. **Default to 8K**: Only use 32K when necessary
2. **Compress before expanding**: Try compression before upgrading models
3. **Prioritize content**: Most relevant information first
4. **Use summaries**: Hierarchical summarization for large docs
5. **Monitor usage**: Track context utilization
6. **Reserve space**: Leave room for responses

Effective context management balances quality, cost, and capability. Master these patterns to get the most from GPT-4's context windows.
