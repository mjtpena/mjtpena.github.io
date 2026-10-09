---
title: "Prompt Compression: Reducing Token Usage"
author: Michael John Peña
draft: false
date: 2023-08-25
tags:
  - Prompt Engineering
  - Compression
  - Cost Optimization
  - LLM
---

## Why Compress Prompts?

```python
compression_benefits = {
    "cost_reduction": "Fewer tokens = lower API costs",
    "faster_responses": "Less processing time",
    "fit_context": "Fit more content in context window",
    "rate_limits": "Stay within TPM limits"
}
```

## Basic Compression Techniques

```python
import re

def compress_prompt(text):
    """Basic prompt compression."""
    # Remove extra whitespace
    text = " ".join(text.split())

    # Remove redundant phrases
    redundant = [
        "please note that",
        "it is important to",
        "as you can see",
        "in order to",
        "the fact that"
    ]
    for phrase in redundant:
        text = text.replace(phrase, "")

    # Shorten common phrases
    replacements = {
        "for example": "e.g.",
        "that is to say": "i.e.",
        "in other words": "i.e.",
        "and so on": "etc.",
        "as soon as possible": "ASAP"
    }
    for long, short in replacements.items():
        text = text.replace(long, short)

    return text

# Example
original = """
Please note that it is important to analyze the data carefully.
For example, you should look at the trends and patterns.
In order to get accurate results, consider all factors.
"""
compressed = compress_prompt(original)
print(f"Original: {len(original)} chars")
print(f"Compressed: {len(compressed)} chars")
```

## Semantic Compression

```python
from transformers import pipeline

class SemanticCompressor:
    def __init__(self):
        self.summarizer = pipeline("summarization", model="facebook/bart-large-cnn")

    def compress(self, text, max_length=100):
        """Semantically compress text while preserving meaning."""
        if len(text.split()) <= max_length:
            return text

        summary = self.summarizer(
            text,
            max_length=max_length,
            min_length=max_length // 2,
            do_sample=False
        )[0]["summary_text"]

        return summary

    def compress_context(self, documents, query, max_tokens=2000):
        """Compress context documents, prioritizing relevant content."""
        from sentence_transformers import SentenceTransformer, util

        model = SentenceTransformer("all-MiniLM-L6-v2")
        query_embedding = model.encode(query)
        doc_embeddings = model.encode(documents)

        # Score documents by relevance
        scores = util.cos_sim(query_embedding, doc_embeddings)[0]
        scored_docs = sorted(zip(documents, scores), key=lambda x: x[1], reverse=True)

        # Select top documents within token budget
        selected = []
        total_tokens = 0
        for doc, score in scored_docs:
            doc_tokens = len(doc.split()) * 1.3  # Rough estimate
            if total_tokens + doc_tokens <= max_tokens:
                selected.append(doc)
                total_tokens += doc_tokens

        return selected
```

## LLMLingua-Style Compression

```python
class PromptCompressor:
    """Compress prompts using token importance scoring."""

    def __init__(self, model, tokenizer):
        self.model = model
        self.tokenizer = tokenizer

    def compute_importance(self, text):
        """Score each token's importance."""
        tokens = self.tokenizer(text, return_tensors="pt")
        with torch.no_grad():
            outputs = self.model(**tokens, output_attentions=True)

        # Use attention as importance proxy
        attention = outputs.attentions[-1].mean(dim=1).squeeze()
        importance = attention.mean(dim=0)

        return importance

    def compress(self, text, ratio=0.5):
        """Remove least important tokens."""
        tokens = self.tokenizer.encode(text)
        importance = self.compute_importance(text)

        # Keep top tokens by importance
        n_keep = int(len(tokens) * ratio)
        top_indices = importance.argsort(descending=True)[:n_keep]
        top_indices = sorted(top_indices.tolist())

        kept_tokens = [tokens[i] for i in top_indices]
        compressed = self.tokenizer.decode(kept_tokens)

        return compressed
```

## Context Window Management

```python
class ContextManager:
    def __init__(self, max_tokens=4000):
        self.max_tokens = max_tokens
        self.reserved_for_output = 1000
        self.available = max_tokens - self.reserved_for_output

    def fit_context(self, system_prompt, user_message, context_docs):
        """Fit context within available tokens."""
        from tiktoken import encoding_for_model
        enc = encoding_for_model("gpt-4")

        system_tokens = len(enc.encode(system_prompt))
        user_tokens = len(enc.encode(user_message))
        base_tokens = system_tokens + user_tokens + 50  # Buffer

        available_for_context = self.available - base_tokens

        # Truncate or summarize context docs
        fitted_docs = []
        used_tokens = 0

        for doc in context_docs:
            doc_tokens = len(enc.encode(doc))
            if used_tokens + doc_tokens <= available_for_context:
                fitted_docs.append(doc)
                used_tokens += doc_tokens
            else:
                # Truncate last doc to fit
                remaining = available_for_context - used_tokens
                if remaining > 100:
                    truncated = enc.decode(enc.encode(doc)[:remaining])
                    fitted_docs.append(truncated + "...")
                break

        return fitted_docs
```

## Compression Strategies by Task

```python
compression_strategies = {
    "qa": {
        "strategy": "Keep question, compress context",
        "compression": "Semantic relevance filtering"
    },
    "summarization": {
        "strategy": "Preserve key information",
        "compression": "Extractive pre-summarization"
    },
    "classification": {
        "strategy": "Focus on discriminative features",
        "compression": "Remove redundant descriptions"
    },
    "code_generation": {
        "strategy": "Keep requirements, simplify examples",
        "compression": "Remove verbose explanations"
    }
}
```

## Measuring Compression Quality

```python
def evaluate_compression(original, compressed, model):
    """Evaluate if compression maintains output quality."""

    # Get outputs for both
    original_response = model.generate(original)
    compressed_response = model.generate(compressed)

    # Compare
    metrics = {
        "compression_ratio": len(original) / len(compressed),
        "response_similarity": compute_similarity(original_response, compressed_response),
        "tokens_saved": count_tokens(original) - count_tokens(compressed)
    }

    return metrics
```

Tomorrow we'll explore semantic compression techniques in more depth.

## Resources

- [LLMLingua](https://github.com/microsoft/LLMLingua)
- [Prompt Compression Paper](https://arxiv.org/abs/2310.05736)
- [Token Optimization Guide](https://platform.openai.com/docs/guides/prompt-engineering)
