---
title: "Local AI Models: Running Intelligence On-Device"
description: "Not every AI workload needs to call the cloud. Today I'm exploring when and how to run AI models locally on your device."
author: Michael John Peña
draft: false
date: 2024-05-11
tags:
  - AI
  - Local AI
  - Edge Computing
  - Privacy
  - ONNX
---

Not every AI workload needs to call the cloud. Today I'm exploring when and how to run AI models locally on your device.

## Why Local AI?

**Benefits:**
- Zero latency to cloud
- Works offline
- Data never leaves device
- No per-request costs
- Regulatory compliance (data sovereignty)

**Trade-offs:**
- Limited model size
- Hardware requirements
- Update complexity
- Less capable than cloud models

## When to Use Local vs Cloud

| Use Case | Local | Cloud |
|----------|-------|-------|
| Real-time inference | Yes | Depends |
| Sensitive data | Yes | Requires compliance |
| Complex reasoning | Limited | Yes |
| Offline required | Yes | No |
| Cost-sensitive (high volume) | Yes | Expensive |
| Latest model capabilities | No | Yes |

## Local Model Options

### Small Language Models

```python
# Phi-3-mini (3.8B parameters)
# Runs on 8GB RAM, ~4GB VRAM

from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

model_name = "microsoft/Phi-3-mini-4k-instruct"

tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype=torch.float16,
    device_map="auto"
)

def generate(prompt: str, max_tokens: int = 200) -> str:
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    outputs = model.generate(
        **inputs,
        max_new_tokens=max_tokens,
        do_sample=True,
        temperature=0.7,
        top_p=0.9
    )

    return tokenizer.decode(outputs[0], skip_special_tokens=True)

response = generate("Explain microservices in simple terms:")
print(response)
```

### ONNX for Cross-Platform

```python
import onnxruntime as ort
import numpy as np

class LocalLLM:
    def __init__(self, model_path: str):
        self.session = ort.InferenceSession(
            model_path,
            providers=['CUDAExecutionProvider', 'CPUExecutionProvider']
        )

    def generate_token(self, input_ids: np.ndarray, past_key_values=None):
        inputs = {'input_ids': input_ids}
        if past_key_values is not None:
            inputs['past_key_values'] = past_key_values

        outputs = self.session.run(None, inputs)
        logits = outputs[0]
        new_past = outputs[1] if len(outputs) > 1 else None

        # Greedy selection
        next_token = np.argmax(logits[:, -1, :], axis=-1)
        return next_token, new_past
```

### llama.cpp for Efficient Inference

```python
from llama_cpp import Llama

# Load quantized model (GGUF format)
llm = Llama(
    model_path="./phi-3-mini-4k-instruct-q4_k_m.gguf",
    n_ctx=4096,        # Context window
    n_threads=8,       # CPU threads
    n_gpu_layers=35,   # Layers on GPU (if available)
    verbose=False
)

def chat(user_message: str) -> str:
    response = llm.create_chat_completion(
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": user_message}
        ],
        max_tokens=500,
        temperature=0.7
    )
    return response['choices'][0]['message']['content']

answer = chat("What are the benefits of local AI models?")
print(answer)
```

## Local Vision Models

```python
from transformers import AutoImageProcessor, AutoModelForImageClassification
from PIL import Image
import torch

# Load a small vision model
model_name = "microsoft/resnet-50"
processor = AutoImageProcessor.from_pretrained(model_name)
model = AutoModelForImageClassification.from_pretrained(model_name)

def classify_image(image_path: str) -> dict:
    image = Image.open(image_path)
    inputs = processor(images=image, return_tensors="pt")

    with torch.no_grad():
        outputs = model(**inputs)

    logits = outputs.logits
    predicted_idx = logits.argmax(-1).item()

    # Get top 5 predictions
    probs = torch.softmax(logits, dim=-1)
    top5_probs, top5_indices = torch.topk(probs, 5)

    return {
        "top_prediction": model.config.id2label[predicted_idx],
        "confidence": probs[0][predicted_idx].item(),
        "top_5": [
            {"label": model.config.id2label[idx.item()], "prob": prob.item()}
            for idx, prob in zip(top5_indices[0], top5_probs[0])
        ]
    }
```

## Local Embeddings

```python
from sentence_transformers import SentenceTransformer
import numpy as np

# Load a small, efficient embedding model
model = SentenceTransformer('all-MiniLM-L6-v2')  # 80MB, 384 dimensions

def get_embeddings(texts: list[str]) -> np.ndarray:
    return model.encode(texts, show_progress_bar=False)

def semantic_search(query: str, documents: list[str], top_k: int = 5) -> list:
    # Encode query and documents
    query_embedding = get_embeddings([query])[0]
    doc_embeddings = get_embeddings(documents)

    # Compute cosine similarity
    similarities = np.dot(doc_embeddings, query_embedding) / (
        np.linalg.norm(doc_embeddings, axis=1) * np.linalg.norm(query_embedding)
    )

    # Get top-k results
    top_indices = np.argsort(similarities)[-top_k:][::-1]

    return [
        {"document": documents[i], "score": similarities[i]}
        for i in top_indices
    ]

# Usage
documents = [
    "Azure provides cloud computing services",
    "Python is a programming language",
    "Machine learning models can run locally",
    "Docker containers package applications"
]

results = semantic_search("cloud services", documents)
for r in results:
    print(f"{r['score']:.3f}: {r['document']}")
```

## Hybrid Architecture

Combine local and cloud models:

```python
class HybridAI:
    def __init__(self, local_model, cloud_client):
        self.local = local_model
        self.cloud = cloud_client
        self.local_capabilities = self._assess_local()

    def _assess_local(self) -> set:
        return {
            "simple_qa",
            "classification",
            "embedding",
            "summarization_short"
        }

    async def process(self, task: str, input_data: str) -> str:
        # Route based on task complexity
        if task in self.local_capabilities:
            return self._run_local(task, input_data)

        # Check if we can run locally with degraded quality
        if self._can_degrade(task):
            if not self._has_internet():
                return self._run_local(task, input_data)

        # Use cloud
        return await self._run_cloud(task, input_data)

    def _run_local(self, task: str, input_data: str) -> str:
        if task == "classification":
            return self.local.classify(input_data)
        elif task == "embedding":
            return self.local.embed(input_data)
        elif task == "simple_qa":
            return self.local.generate(input_data)
        # ... other tasks

    async def _run_cloud(self, task: str, input_data: str) -> str:
        response = await self.cloud.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": input_data}]
        )
        return response.choices[0].message.content
```

## Performance Optimization

```python
import torch
from contextlib import contextmanager
import time

@contextmanager
def inference_mode():
    """Context manager for optimized inference."""
    torch.set_grad_enabled(False)
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    try:
        yield
    finally:
        torch.set_grad_enabled(True)

class OptimizedLocalModel:
    def __init__(self, model_path: str):
        self.model = self._load_optimized(model_path)

    def _load_optimized(self, path: str):
        model = torch.load(path)
        model.eval()

        # Optimize for inference
        if torch.cuda.is_available():
            model = model.cuda()
            model = model.half()  # FP16 for speed

        # Try to compile (PyTorch 2.0+)
        try:
            model = torch.compile(model, mode="reduce-overhead")
        except:
            pass

        return model

    def predict(self, inputs):
        with inference_mode():
            return self.model(inputs)
```

## Memory Management

```python
class MemoryEfficientInference:
    def __init__(self, model_path: str, max_memory_gb: float = 4.0):
        self.model_path = model_path
        self.max_memory = max_memory_gb * 1024**3  # Convert to bytes
        self.model = None

    def load_model(self):
        if self.model is None:
            self.model = self._load_with_limits()
        return self.model

    def unload_model(self):
        if self.model is not None:
            del self.model
            self.model = None
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            import gc
            gc.collect()

    def _load_with_limits(self):
        # Load with memory limits
        return AutoModelForCausalLM.from_pretrained(
            self.model_path,
            torch_dtype=torch.float16,
            low_cpu_mem_usage=True,
            device_map="auto",
            max_memory={0: f"{int(self.max_memory)}B"}
        )
```

## What's Next

Tomorrow I'll dive into Microsoft's Phi-3 family of small language models.

## Resources

- [Hugging Face Model Hub](https://huggingface.co/models)
- [ONNX Runtime](https://onnxruntime.ai/)
- [llama.cpp](https://github.com/ggerganov/llama.cpp)
- [Sentence Transformers](https://www.sbert.net/)
