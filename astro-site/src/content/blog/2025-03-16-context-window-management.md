---
title: "Context Window Management: Maximizing LLM Effectiveness"
author: Michael John Peña
draft: false
date: 2025-03-16
tags:
  - AI
  - LLM
  - Context Window
  - Optimization
  - Best Practices

---

I wrote "Context Window Management: Maximizing LLM Effectiveness" to share practical, production-minded guidance on this topic.

## Context Management Strategies

```python
from azure.ai.openai import AzureOpenAI
import tiktoken

class ContextManager:
    def __init__(self, openai_client: AzureOpenAI, max_tokens: int = 128000):
        self.openai = openai_client
        self.max_tokens = max_tokens
        self.encoder = tiktoken.encoding_for_model("gpt-4o")

    def count_tokens(self, text: str) -> int:
        """Count tokens in text."""
        return len(self.encoder.encode(text))

    def budget_context(self, system: str, history: list, retrieved: list, reserve: int = 4000) -> dict:
        """Budget tokens across context components."""
        system_tokens = self.count_tokens(system)
        available = self.max_tokens - system_tokens - reserve

        # Prioritize recent history
        history_budget = min(available * 0.3, 16000)
        retrieved_budget = available - history_budget

        return {
            "system": system,
            "history": self.trim_history(history, history_budget),
            "retrieved": self.trim_retrieved(retrieved, retrieved_budget)
        }

    def trim_history(self, history: list, max_tokens: int) -> list:
        """Keep recent history within budget."""
        result = []
        total = 0

        for msg in reversed(history):
            msg_tokens = self.count_tokens(str(msg))
            if total + msg_tokens > max_tokens:
                break
            result.insert(0, msg)
            total += msg_tokens

        return result

    def trim_retrieved(self, documents: list, max_tokens: int) -> list:
        """Keep top documents within budget."""
        result = []
        total = 0

        for doc in documents:
            doc_tokens = self.count_tokens(doc)
            if total + doc_tokens > max_tokens:
                # Try to fit partial document
                remaining = max_tokens - total
                if remaining > 500:
                    result.append(self.truncate_doc(doc, remaining))
                break
            result.append(doc)
            total += doc_tokens

        return result

    async def compress_context(self, context: str, target_tokens: int) -> str:
        """Use LLM to compress context while preserving key information."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": f"Compress this text to ~{target_tokens} tokens. Preserve key facts."
            }, {
                "role": "user",
                "content": context
            }]
        )
        return response.choices[0].message.content

    def sliding_window(self, text: str, window_size: int, overlap: int) -> list:
        """Process long text in overlapping windows."""
        tokens = self.encoder.encode(text)
        windows = []

        for i in range(0, len(tokens), window_size - overlap):
            window_tokens = tokens[i:i + window_size]
            windows.append(self.encoder.decode(window_tokens))

        return windows
```

Strategic context management enables handling of complex, long-context scenarios.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
