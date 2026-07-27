---
title: "Efficient Inference: Optimization Techniques for Production AI"
author: Michael John Peña
draft: false
date: 2025-02-11
tags:
  - AI
  - Optimization
  - Performance
  - MLOps
  - Azure

---

I wrote "Efficient Inference: Optimization Techniques for Production AI" to share practical, production-minded guidance on this topic.

## Optimization Techniques Overview

```
Technique              Latency Impact    Cost Impact    Quality Impact
─────────────────────────────────────────────────────────────────────────
Quantization           -40%              -50%           -1-3%
Batching               +50%*             -70%           None
Caching                -90%**            -90%**         None
Model Distillation     -60%              -80%           -5-10%
Speculative Decoding   -50%              -30%           None
KV Cache Optimization  -30%              -20%           None

* Per-request latency may increase, but throughput improves
** For cached requests only
```

## Quantization

```python
from onnxruntime.quantization import quantize_dynamic, quantize_static, QuantType
import onnx

class ModelQuantizer:
    def __init__(self, model_path: str):
        self.model_path = model_path

    def quantize_dynamic_int8(self, output_path: str):
        """Dynamic quantization - no calibration data needed."""
        quantize_dynamic(
            model_input=self.model_path,
            model_output=output_path,
            weight_type=QuantType.QInt8,
            optimize_model=True
        )
        self._print_size_comparison(output_path)

    def quantize_static_int8(self, output_path: str, calibration_data):
        """Static quantization - better quality with calibration."""
        from onnxruntime.quantization import CalibrationDataReader

        class DataReader(CalibrationDataReader):
            def __init__(self, data):
                self.data = data
                self.idx = 0

            def get_next(self):
                if self.idx >= len(self.data):
                    return None
                item = {"input": self.data[self.idx]}
                self.idx += 1
                return item

        quantize_static(
            model_input=self.model_path,
            model_output=output_path,
            calibration_data_reader=DataReader(calibration_data),
            quant_format=QuantType.QInt8
        )

    def quantize_float16(self, output_path: str):
        """FP16 quantization - good balance of speed and quality."""
        from onnxruntime.transformers import float16
        model = onnx.load(self.model_path)
        model_fp16 = float16.convert_float_to_float16(model)
        onnx.save(model_fp16, output_path)

    def _print_size_comparison(self, output_path: str):
        import os
        original = os.path.getsize(self.model_path) / 1024 / 1024
        quantized = os.path.getsize(output_path) / 1024 / 1024
        print(f"Original: {original:.2f}MB -> Quantized: {quantized:.2f}MB ({quantized/original*100:.1f}%)")
```

## Intelligent Batching

```python
import asyncio
from collections import defaultdict
import time

class DynamicBatcher:
    """Batch requests for efficient GPU utilization."""

    def __init__(
        self,
        model,
        max_batch_size: int = 32,
        max_wait_ms: int = 50
    ):
        self.model = model
        self.max_batch_size = max_batch_size
        self.max_wait_ms = max_wait_ms
        self.pending = []
        self.lock = asyncio.Lock()
        self._batch_task = None

    async def infer(self, input_data) -> dict:
        """Submit request and wait for result."""
        future = asyncio.Future()

        async with self.lock:
            self.pending.append((input_data, future))

            if len(self.pending) >= self.max_batch_size:
                # Batch is full, process immediately
                await self._process_batch()
            elif self._batch_task is None:
                # Start timer for partial batch
                self._batch_task = asyncio.create_task(self._wait_and_process())

        return await future

    async def _wait_and_process(self):
        """Wait for more requests or timeout."""
        await asyncio.sleep(self.max_wait_ms / 1000)
        async with self.lock:
            if self.pending:
                await self._process_batch()
            self._batch_task = None

    async def _process_batch(self):
        """Process current batch."""
        batch = self.pending[:self.max_batch_size]
        self.pending = self.pending[self.max_batch_size:]

        inputs = [item[0] for item in batch]
        futures = [item[1] for item in batch]

        try:
            # Batch inference
            results = await self.model.batch_infer(inputs)

            # Resolve futures
            for future, result in zip(futures, results):
                future.set_result(result)
        except Exception as e:
            for future in futures:
                future.set_exception(e)
```

## Response Caching

```python
import hashlib
import json
from azure.cosmos import CosmosClient
from datetime import datetime, timedelta

class SemanticCache:
    """Cache responses with semantic similarity."""

    def __init__(self, cosmos_client: CosmosClient, embedding_model):
        self.container = cosmos_client.get_database_client("cache").get_container_client("responses")
        self.embedding_model = embedding_model
        self.similarity_threshold = 0.95

    async def get(self, prompt: str, model: str) -> dict | None:
        """Get cached response if similar prompt exists."""

        # Exact match first (fast)
        exact_key = self._hash_key(prompt, model)
        try:
            item = self.container.read_item(exact_key, partition_key=model)
            if self._is_valid(item):
                return item["response"]
        except:
            pass

        # Semantic similarity search (slower but catches paraphrases)
        prompt_embedding = await self.embedding_model.embed(prompt)

        query = """
            SELECT TOP 5 c.id, c.prompt, c.response, c.embedding
            FROM c
            WHERE c.model = @model AND c.expires_at > @now
        """

        items = self.container.query_items(
            query=query,
            parameters=[
                {"name": "@model", "value": model},
                {"name": "@now", "value": datetime.utcnow().isoformat()}
            ]
        )

        for item in items:
            similarity = self._cosine_similarity(prompt_embedding, item["embedding"])
            if similarity >= self.similarity_threshold:
                return item["response"]

        return None

    async def set(
        self,
        prompt: str,
        model: str,
        response: dict,
        ttl_hours: int = 24
    ):
        """Cache a response."""

        prompt_embedding = await self.embedding_model.embed(prompt)

        item = {
            "id": self._hash_key(prompt, model),
            "model": model,
            "prompt": prompt,
            "response": response,
            "embedding": prompt_embedding,
            "created_at": datetime.utcnow().isoformat(),
            "expires_at": (datetime.utcnow() + timedelta(hours=ttl_hours)).isoformat()
        }

        self.container.upsert_item(item)

    def _hash_key(self, prompt: str, model: str) -> str:
        content = f"{model}:{prompt}"
        return hashlib.sha256(content.encode()).hexdigest()[:32]
```

## KV Cache Optimization

```python
class KVCacheManager:
    """Manage key-value cache for transformer inference."""

    def __init__(self, max_cache_size_gb: float = 8.0):
        self.max_size = max_cache_size_gb * 1024 * 1024 * 1024  # bytes
        self.cache = {}
        self.access_times = {}

    def get_or_create(self, session_id: str, sequence_length: int):
        """Get cached KV state or create new."""

        if session_id in self.cache:
            self.access_times[session_id] = time.time()
            return self.cache[session_id]

        # Evict if necessary
        self._evict_if_needed()

        # Create new cache
        kv_cache = self._allocate_cache(sequence_length)
        self.cache[session_id] = kv_cache
        self.access_times[session_id] = time.time()

        return kv_cache

    def _evict_if_needed(self):
        """Evict oldest entries if cache is full."""
        current_size = sum(self._cache_size(c) for c in self.cache.values())

        while current_size > self.max_size and self.cache:
            # LRU eviction
            oldest = min(self.access_times, key=self.access_times.get)
            current_size -= self._cache_size(self.cache[oldest])
            del self.cache[oldest]
            del self.access_times[oldest]

    def update(self, session_id: str, new_kv: dict):
        """Update cache with new key-value pairs."""
        if session_id in self.cache:
            # Append new KV pairs
            self.cache[session_id] = self._merge_kv(
                self.cache[session_id],
                new_kv
            )
```

## Speculative Decoding

```python
class SpeculativeDecoder:
    """Use small model to draft, large model to verify."""

    def __init__(self, draft_model, target_model, speculation_length: int = 5):
        self.draft_model = draft_model
        self.target_model = target_model
        self.speculation_length = speculation_length

    async def generate(self, prompt: str, max_tokens: int) -> str:
        """Generate with speculative decoding."""

        tokens = self._tokenize(prompt)
        generated = []

        while len(generated) < max_tokens:
            # Draft: Generate speculation_length tokens with small model
            draft_tokens = await self._draft(tokens + generated)

            # Verify: Check draft tokens with large model
            verified, next_token = await self._verify(tokens + generated, draft_tokens)

            # Accept verified tokens
            generated.extend(verified)

            # Add correction token if draft was wrong
            if next_token is not None:
                generated.append(next_token)

            # Check for end of sequence
            if self._is_eos(generated[-1]):
                break

        return self._detokenize(generated)

    async def _draft(self, context: list) -> list:
        """Generate draft tokens with small model."""
        return await self.draft_model.generate(
            context,
            max_new_tokens=self.speculation_length,
            do_sample=False  # Greedy for speculation
        )

    async def _verify(self, context: list, draft: list) -> tuple:
        """Verify draft tokens with large model."""
        # Get target model's distribution for all positions
        logits = await self.target_model.forward(context + draft)

        verified = []
        for i, draft_token in enumerate(draft):
            target_token = logits[i].argmax()
            if target_token == draft_token:
                verified.append(draft_token)
            else:
                # Draft was wrong, return correction
                return verified, target_token

        return verified, None
```

## Optimization Pipeline

```python
class InferenceOptimizer:
    """Complete optimization pipeline."""

    def __init__(self, model_path: str):
        self.model_path = model_path

    def optimize(self, target_latency_ms: int, target_quality: float) -> dict:
        """Apply optimizations to meet targets."""

        optimizations_applied = []
        current_latency = self._benchmark_latency()
        current_quality = self._benchmark_quality()

        # Apply optimizations progressively
        if current_latency > target_latency_ms:
            # Try quantization first
            if current_quality - 0.02 > target_quality:
                self._apply_quantization("int8")
                optimizations_applied.append("int8_quantization")
            else:
                self._apply_quantization("fp16")
                optimizations_applied.append("fp16_quantization")

        current_latency = self._benchmark_latency()

        if current_latency > target_latency_ms:
            # Try batching
            self._configure_batching(batch_size=16)
            optimizations_applied.append("batching")

        return {
            "optimizations": optimizations_applied,
            "final_latency_ms": self._benchmark_latency(),
            "final_quality": self._benchmark_quality()
        }
```

## Best Practices

1. **Measure first**: Benchmark before optimizing
2. **Start with caching**: Highest impact, lowest risk
3. **Batch when possible**: Better GPU utilization
4. **Quantize appropriately**: FP16 for quality, INT8 for speed
5. **Monitor quality**: Track accuracy with each optimization
6. **Use the right hardware**: Match model to accelerator

Efficient inference is crucial for production AI. Apply these techniques systematically and measure the impact at each step.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
