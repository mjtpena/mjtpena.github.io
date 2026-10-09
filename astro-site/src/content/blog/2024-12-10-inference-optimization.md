---
title: "Inference Optimization: Making AI Fast and Cost-Effective"
description: "Inference optimization is a continuous process. Start with caching and routing for quick wins, then progressively implement more sophisticated techniques."
author: Michael John Peña
draft: false
date: 2024-12-10
tags:
  - AI
  - Inference
  - Optimization
  - Performance
  - Cost
---

## The Inference Optimization Stack

```
┌─────────────────────────────────────────────────────────┐
│                 Optimization Layers                      │
├─────────────────────────────────────────────────────────┤
│  Application Layer                                       │
│  - Caching                                              │
│  - Request batching                                      │
│  - Model routing                                         │
├─────────────────────────────────────────────────────────┤
│  Prompt Layer                                           │
│  - Prompt compression                                    │
│  - Context optimization                                  │
│  - Output length control                                │
├─────────────────────────────────────────────────────────┤
│  Model Layer                                            │
│  - Model selection                                       │
│  - Quantization                                          │
│  - Distillation                                         │
├─────────────────────────────────────────────────────────┤
│  Infrastructure Layer                                    │
│  - Hardware optimization                                 │
│  - Batching at inference server                         │
│  - KV cache optimization                                │
└─────────────────────────────────────────────────────────┘
```

## Application Layer Optimizations

### Semantic Caching

```python
import numpy as np
from typing import Optional
import hashlib

class InferenceOptimizer:
    """Comprehensive inference optimization."""

    def __init__(self):
        self.exact_cache = {}  # hash -> response
        self.semantic_cache = SemanticIndex()
        self.stats = {"cache_hits": 0, "total_requests": 0}

    async def get_response(
        self,
        prompt: str,
        max_tokens: int = 500,
        cache_similarity_threshold: float = 0.95
    ) -> dict:
        self.stats["total_requests"] += 1

        # Check exact cache
        prompt_hash = hashlib.md5(prompt.encode()).hexdigest()
        if prompt_hash in self.exact_cache:
            self.stats["cache_hits"] += 1
            return {"response": self.exact_cache[prompt_hash], "cache": "exact"}

        # Check semantic cache
        semantic_match = await self.semantic_cache.find_similar(
            prompt, threshold=cache_similarity_threshold
        )
        if semantic_match:
            self.stats["cache_hits"] += 1
            return {"response": semantic_match.response, "cache": "semantic"}

        # Generate new response
        response = await self.generate(prompt, max_tokens)

        # Cache the result
        self.exact_cache[prompt_hash] = response
        await self.semantic_cache.add(prompt, response)

        return {"response": response, "cache": "none"}

    def get_cache_stats(self) -> dict:
        total = self.stats["total_requests"]
        hits = self.stats["cache_hits"]
        return {
            "hit_rate": hits / total if total > 0 else 0,
            "requests_saved": hits,
            "estimated_savings": hits * 0.005  # $0.005 per request average
        }
```

### Intelligent Model Routing

```python
class ModelRouter:
    """Route to optimal model based on request characteristics."""

    MODELS = {
        "fast": {"name": "gpt-4o-mini", "cost_per_1k": 0.00015, "quality": 0.85},
        "balanced": {"name": "gpt-4o", "cost_per_1k": 0.005, "quality": 0.95},
        "powerful": {"name": "o1-mini", "cost_per_1k": 0.012, "quality": 0.98}
    }

    async def route(self, request: dict) -> str:
        complexity = await self.estimate_complexity(request)
        quality_requirement = request.get("min_quality", 0.85)
        max_cost = request.get("max_cost_per_request", 0.01)

        # Filter models that meet requirements
        candidates = []
        for tier, config in self.MODELS.items():
            if config["quality"] >= quality_requirement:
                estimated_cost = self.estimate_cost(request, config)
                if estimated_cost <= max_cost:
                    candidates.append((tier, config, estimated_cost))

        if not candidates:
            raise NoSuitableModelException("No model meets requirements")

        # Select cheapest model that meets quality needs
        candidates.sort(key=lambda x: x[2])
        return candidates[0][0]

    async def estimate_complexity(self, request: dict) -> float:
        """Estimate request complexity 0-1."""
        prompt = request.get("prompt", "")

        # Simple heuristics
        factors = [
            len(prompt) / 10000,  # Length factor
            prompt.count("?") / 5,  # Question complexity
            any(w in prompt.lower() for w in ["analyze", "compare", "explain why"]) * 0.3
        ]

        return min(sum(factors), 1.0)
```

## Prompt Layer Optimizations

### Prompt Compression

```python
class PromptCompressor:
    """Compress prompts to reduce token usage."""

    async def compress(self, prompt: str, target_reduction: float = 0.3) -> str:
        """Compress prompt while preserving meaning."""

        original_tokens = self.count_tokens(prompt)
        target_tokens = int(original_tokens * (1 - target_reduction))

        # Strategy 1: Remove redundant whitespace
        compressed = " ".join(prompt.split())

        # Strategy 2: Use abbreviations for common phrases
        abbreviations = {
            "for example": "e.g.",
            "that is": "i.e.",
            "and so on": "etc.",
            "in other words": "i.e.",
            "as soon as possible": "ASAP"
        }
        for phrase, abbrev in abbreviations.items():
            compressed = compressed.replace(phrase, abbrev)

        # Strategy 3: Summarize long context
        if self.count_tokens(compressed) > target_tokens:
            compressed = await self.summarize_context(compressed, target_tokens)

        return compressed

    async def optimize_context(self, context: str, query: str) -> str:
        """Keep only relevant context for the query."""

        # Split context into chunks
        chunks = self.split_into_chunks(context, chunk_size=200)

        # Score relevance of each chunk
        query_embedding = await self.embed(query)
        scored_chunks = []

        for chunk in chunks:
            chunk_embedding = await self.embed(chunk)
            score = self.cosine_similarity(query_embedding, chunk_embedding)
            scored_chunks.append((chunk, score))

        # Keep top chunks up to token limit
        scored_chunks.sort(key=lambda x: x[1], reverse=True)
        optimized = []
        token_count = 0

        for chunk, score in scored_chunks:
            chunk_tokens = self.count_tokens(chunk)
            if token_count + chunk_tokens > self.max_context_tokens:
                break
            optimized.append(chunk)
            token_count += chunk_tokens

        return "\n".join(optimized)
```

### Output Length Control

```python
class OutputOptimizer:
    """Control output length for cost efficiency."""

    def calculate_optimal_max_tokens(self, request_type: str) -> int:
        """Determine optimal max_tokens for request type."""

        defaults = {
            "classification": 50,
            "extraction": 200,
            "summarization": 300,
            "question_answer": 500,
            "generation": 1000,
            "code": 1500
        }

        return defaults.get(request_type, 500)

    async def request_with_length_control(self, prompt: str, request_type: str):
        max_tokens = self.calculate_optimal_max_tokens(request_type)

        # First attempt with optimal length
        response = await self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens
        )

        # Check if response was truncated
        if response.choices[0].finish_reason == "length":
            # Response was cut off - retry with more tokens
            response = await self.client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=max_tokens * 2
            )

        return response
```

## Model Layer Optimizations

### Quantization

```python
# Using quantized models for inference
"""
Quantization levels and tradeoffs:

FP32 (32-bit): Baseline quality and size
FP16 (16-bit): ~2x smaller, minimal quality loss
INT8 (8-bit): ~4x smaller, small quality loss
INT4 (4-bit): ~8x smaller, noticeable quality loss

Example with vLLM:
"""

# vLLM with quantization
from vllm import LLM

# Load quantized model
llm = LLM(
    model="meta-llama/Llama-3.1-70B-Instruct",
    quantization="awq",  # AWQ 4-bit quantization
    tensor_parallel_size=2,  # Use 2 GPUs
    gpu_memory_utilization=0.9
)

# INT8 quantization achieves:
# - 50% memory reduction
# - 30-50% faster inference
# - <1% quality degradation on most tasks
```

### Model Distillation

```python
class DistillationPipeline:
    """Create smaller, faster models from larger ones."""

    async def distill(
        self,
        teacher_model: str,
        student_architecture: str,
        training_data: list
    ):
        """Distill knowledge from teacher to student."""

        # Generate teacher outputs
        teacher_outputs = []
        for example in training_data:
            response = await self.call_teacher(teacher_model, example["prompt"])
            teacher_outputs.append({
                "prompt": example["prompt"],
                "teacher_response": response
            })

        # Train student on teacher outputs
        student_model = self.initialize_student(student_architecture)

        for epoch in range(self.epochs):
            for batch in self.batch(teacher_outputs):
                loss = student_model.train_step(
                    inputs=batch["prompts"],
                    targets=batch["teacher_responses"],
                    temperature=self.temperature  # Softens probability distribution
                )

        return student_model

# Typical results:
# - 10x smaller model
# - 5x faster inference
# - 90-95% of teacher quality on target tasks
```

## Infrastructure Optimizations

### Continuous Batching

```python
# vLLM continuous batching example
from vllm import LLM, SamplingParams

llm = LLM(
    model="gpt-4",
    max_num_batched_tokens=32768,  # Max tokens per batch
    max_num_seqs=256,  # Max concurrent sequences
)

# Continuous batching automatically:
# 1. Accepts new requests while processing
# 2. Efficiently manages GPU memory
# 3. Maximizes throughput

# Throughput improvement: 2-5x compared to naive batching
```

### KV Cache Optimization

```python
kv_cache_strategies = {
    "paged_attention": {
        "description": "Allocate KV cache in pages, not contiguous memory",
        "benefit": "Eliminates memory fragmentation",
        "throughput_improvement": "2-3x"
    },
    "prefix_caching": {
        "description": "Cache KV for common prefixes (system prompts)",
        "benefit": "Skip recomputation for shared context",
        "latency_improvement": "20-40%"
    },
    "sliding_window": {
        "description": "Limit KV cache to recent tokens",
        "benefit": "Bounded memory for long conversations",
        "memory_reduction": "50-80%"
    }
}
```

## Cost Optimization Summary

```python
optimization_impact = {
    "semantic_caching": {
        "cost_reduction": "30-50%",
        "latency_improvement": "90%+ for cached",
        "implementation_effort": "Medium"
    },
    "model_routing": {
        "cost_reduction": "20-40%",
        "latency_improvement": "Variable",
        "implementation_effort": "Low"
    },
    "prompt_compression": {
        "cost_reduction": "10-30%",
        "latency_improvement": "10-20%",
        "implementation_effort": "Medium"
    },
    "quantization": {
        "cost_reduction": "50-75%",
        "latency_improvement": "30-50%",
        "implementation_effort": "High"
    },
    "continuous_batching": {
        "cost_reduction": "60-80%",
        "latency_improvement": "Variable",
        "implementation_effort": "High"
    }
}

# Combined, these can reduce costs by 70-90%
```

Inference optimization is a continuous process. Start with caching and routing for quick wins, then progressively implement more sophisticated techniques.

## Resources

- [vLLM Documentation](https://docs.vllm.ai/)
- [Azure OpenAI Performance](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/performance)
- [LLM Inference Optimization](https://lilianweng.github.io/posts/2023-01-10-inference-optimization/)
