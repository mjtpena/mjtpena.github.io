---
title: "Efficient Inference: Optimizing LLM Response Times"
author: Michael John Peña
draft: false
date: 2023-08-16
tags:
  - Inference
  - Performance
  - LLM
  - Optimization
---

## Inference Optimization Techniques

```python
optimization_techniques = {
    "model_level": ["Quantization", "Pruning", "Distillation"],
    "runtime_level": ["KV caching", "Flash Attention", "Speculative decoding"],
    "system_level": ["Batching", "Tensor parallelism", "Async processing"],
    "serving_level": ["Request batching", "Caching", "Load balancing"]
}
```

## KV Cache Optimization

```python
from transformers import AutoModelForCausalLM, AutoTokenizer

model = AutoModelForCausalLM.from_pretrained("gpt2")
tokenizer = AutoTokenizer.from_pretrained("gpt2")

# Generation with KV cache (default)
def generate_with_cache(prompt, max_tokens=100):
    inputs = tokenizer(prompt, return_tensors="pt")

    # use_cache=True enables KV caching
    outputs = model.generate(
        **inputs,
        max_new_tokens=max_tokens,
        use_cache=True,
        pad_token_id=tokenizer.eos_token_id
    )
    return tokenizer.decode(outputs[0])

# For streaming, maintain cache across calls
def streaming_generate(prompt, max_tokens=100):
    inputs = tokenizer(prompt, return_tensors="pt")
    past_key_values = None

    for _ in range(max_tokens):
        outputs = model(
            **inputs if past_key_values is None else {"input_ids": next_token},
            past_key_values=past_key_values,
            use_cache=True
        )
        past_key_values = outputs.past_key_values
        next_token = outputs.logits[:, -1:].argmax(dim=-1)
        yield tokenizer.decode(next_token[0])
```

## Speculative Decoding

```python
class SpeculativeDecoder:
    """Use small model to draft, large model to verify."""

    def __init__(self, draft_model, target_model, tokenizer, k=4):
        self.draft = draft_model
        self.target = target_model
        self.tokenizer = tokenizer
        self.k = k  # Number of speculative tokens

    def generate(self, prompt, max_tokens=100):
        input_ids = self.tokenizer(prompt, return_tensors="pt").input_ids
        generated = input_ids.clone()

        while generated.shape[1] < input_ids.shape[1] + max_tokens:
            # Draft k tokens with small model
            draft_ids = generated.clone()
            for _ in range(self.k):
                draft_output = self.draft(draft_ids)
                next_token = draft_output.logits[:, -1:].argmax(dim=-1)
                draft_ids = torch.cat([draft_ids, next_token], dim=-1)

            # Verify with target model
            target_output = self.target(draft_ids)
            target_logits = target_output.logits

            # Accept matching tokens
            accepted = 0
            for i in range(self.k):
                draft_token = draft_ids[0, generated.shape[1] + i]
                target_token = target_logits[0, generated.shape[1] + i - 1].argmax()
                if draft_token == target_token:
                    accepted += 1
                else:
                    break

            # Update generated sequence
            generated = draft_ids[:, :generated.shape[1] + accepted + 1]

        return self.tokenizer.decode(generated[0])
```

## Continuous Batching

```python
import asyncio
from collections import deque

class ContinuousBatcher:
    """Dynamic batching for varying-length requests."""

    def __init__(self, model, tokenizer, max_batch_size=8, max_wait_ms=50):
        self.model = model
        self.tokenizer = tokenizer
        self.max_batch_size = max_batch_size
        self.max_wait_ms = max_wait_ms
        self.queue = deque()
        self.running = False

    async def add_request(self, prompt, max_tokens):
        future = asyncio.Future()
        self.queue.append({
            "prompt": prompt,
            "max_tokens": max_tokens,
            "future": future
        })
        return await future

    async def batch_loop(self):
        self.running = True
        while self.running:
            batch = []

            # Collect batch
            wait_start = asyncio.get_event_loop().time()
            while len(batch) < self.max_batch_size:
                try:
                    item = self.queue.popleft()
                    batch.append(item)
                except IndexError:
                    if batch and (asyncio.get_event_loop().time() - wait_start) * 1000 > self.max_wait_ms:
                        break
                    await asyncio.sleep(0.001)

            if batch:
                # Process batch
                prompts = [item["prompt"] for item in batch]
                inputs = self.tokenizer(prompts, padding=True, return_tensors="pt")

                outputs = self.model.generate(**inputs, max_new_tokens=100)

                # Return results
                for i, item in enumerate(batch):
                    result = self.tokenizer.decode(outputs[i], skip_special_tokens=True)
                    item["future"].set_result(result)
```

## vLLM for High-Throughput Serving

```python
# pip install vllm
from vllm import LLM, SamplingParams

# Initialize vLLM engine
llm = LLM(
    model="meta-llama/Llama-2-7b-hf",
    tensor_parallel_size=1,  # Number of GPUs
    dtype="float16",
    max_model_len=4096
)

# Sampling parameters
sampling_params = SamplingParams(
    temperature=0.7,
    top_p=0.9,
    max_tokens=256
)

# Generate (automatically batched)
prompts = ["Hello, my name is", "The future of AI is"]
outputs = llm.generate(prompts, sampling_params)

for output in outputs:
    print(f"Prompt: {output.prompt}")
    print(f"Generated: {output.outputs[0].text}")
```

## TensorRT-LLM Optimization

```python
# TensorRT-LLM for NVIDIA GPUs
# Provides significant speedups

# Build optimized engine
"""
python build.py \
    --model_dir ./llama-7b \
    --dtype float16 \
    --use_gpt_attention_plugin float16 \
    --use_gemm_plugin float16 \
    --output_dir ./llama-7b-trt
"""

# Use in Python
from tensorrt_llm.runtime import ModelRunner

runner = ModelRunner.from_dir("./llama-7b-trt")
outputs = runner.generate(
    input_ids,
    max_new_tokens=100,
    end_id=tokenizer.eos_token_id
)
```

## Performance Benchmarking

```python
import time
import numpy as np

def benchmark_inference(model, tokenizer, prompts, num_runs=10):
    """Benchmark inference performance."""
    latencies = []

    # Warmup
    for _ in range(3):
        _ = model.generate(tokenizer(prompts[0], return_tensors="pt").input_ids, max_new_tokens=50)

    # Benchmark
    for _ in range(num_runs):
        for prompt in prompts:
            inputs = tokenizer(prompt, return_tensors="pt")
            start = time.perf_counter()
            _ = model.generate(**inputs, max_new_tokens=50)
            latencies.append(time.perf_counter() - start)

    return {
        "mean_latency_ms": np.mean(latencies) * 1000,
        "p50_ms": np.percentile(latencies, 50) * 1000,
        "p95_ms": np.percentile(latencies, 95) * 1000,
        "p99_ms": np.percentile(latencies, 99) * 1000,
        "throughput_rps": 1 / np.mean(latencies)
    }
```

Tomorrow we'll explore batching strategies in detail.

## Resources

- [vLLM](https://github.com/vllm-project/vllm)
- [TensorRT-LLM](https://github.com/NVIDIA/TensorRT-LLM)
- [Speculative Decoding Paper](https://arxiv.org/abs/2302.01318)
