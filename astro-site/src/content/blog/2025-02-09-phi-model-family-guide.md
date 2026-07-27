---
title: "Phi Model Family: Microsoft's Small Language Models Guide"
author: Michael John Peña
draft: false
date: 2025-02-09
tags:
  - AI
  - Phi
  - SLM
  - Microsoft
  - Azure

---

I wrote "Phi Model Family: Microsoft's Small Language Models Guide" to share practical, production-minded guidance on this topic.

## The Phi Model Lineup

```
Phi-1 (2023)
├── 1.3B parameters
├── Code-focused
└── Research model

Phi-2 (2023)
├── 2.7B parameters
├── General purpose
└── Outperforms larger models on many benchmarks

Phi-3 (2024)
├── Phi-3-mini: 3.8B parameters
├── Phi-3-small: 7B parameters
├── Phi-3-medium: 14B parameters
└── Multi-modal versions available

Phi-4 (2025) - Expected
├── Enhanced reasoning
├── Longer context
└── Better efficiency
```

## Why Phi Models?

```python
# Phi models excel at:

use_cases = {
    "on_device": {
        "description": "Run locally without cloud",
        "latency": "< 100ms",
        "privacy": "Data never leaves device"
    },
    "cost_effective": {
        "description": "Lower inference costs",
        "savings": "10-100x cheaper than GPT-4",
        "throughput": "Higher tokens/second"
    },
    "embedded": {
        "description": "IoT and edge devices",
        "memory": "< 4GB RAM",
        "power": "CPU inference possible"
    },
    "fine_tuning": {
        "description": "Customize for specific tasks",
        "data_needed": "Much less than large models",
        "compute": "Single GPU sufficient"
    }
}
```

## Using Phi-3 on Azure

```python
from azure.ai.inference import ChatCompletionsClient
from azure.core.credentials import AzureKeyCredential

# Deploy Phi-3 from Azure AI Model Catalog
client = ChatCompletionsClient(
    endpoint="https://my-phi3-endpoint.eastus.inference.ml.azure.com",
    credential=AzureKeyCredential(api_key)
)

# Chat completion
response = client.complete(
    messages=[
        {"role": "system", "content": "You are a helpful coding assistant."},
        {"role": "user", "content": "Write a Python function to parse JSON safely"}
    ],
    model="phi-3-mini-128k-instruct",
    max_tokens=500,
    temperature=0.7
)

print(response.choices[0].message.content)
```

## Local Deployment with Ollama

```bash
# Install Ollama and pull Phi-3
ollama pull phi3:mini

# Run inference
ollama run phi3:mini "Explain data partitioning in simple terms"
```

```python
# Python client for Ollama
import requests

def query_phi3(prompt: str) -> str:
    response = requests.post(
        "http://localhost:11434/api/generate",
        json={
            "model": "phi3:mini",
            "prompt": prompt,
            "stream": False
        }
    )
    return response.json()["response"]

# Use in applications
result = query_phi3("Write SQL to find duplicate records")
```

## ONNX Runtime Deployment

```python
import onnxruntime_genai as og

class Phi3Inference:
    def __init__(self, model_path: str):
        self.model = og.Model(model_path)
        self.tokenizer = og.Tokenizer(self.model)
        self.params = og.GeneratorParams(self.model)

    def generate(
        self,
        prompt: str,
        max_tokens: int = 256,
        temperature: float = 0.7
    ) -> str:
        # Set generation parameters
        self.params.set_search_options(
            max_length=max_tokens,
            temperature=temperature,
            top_p=0.9
        )

        # Tokenize input
        input_tokens = self.tokenizer.encode(prompt)
        self.params.input_ids = input_tokens

        # Generate
        generator = og.Generator(self.model, self.params)

        output_tokens = []
        while not generator.is_done():
            generator.compute_logits()
            generator.generate_next_token()
            output_tokens.append(generator.get_next_tokens()[0])

        # Decode
        output_text = self.tokenizer.decode(output_tokens)
        return output_text

# Usage
phi3 = Phi3Inference("phi-3-mini-onnx")
response = phi3.generate("Summarize the key benefits of data mesh:")
```

## Fine-Tuning Phi-3

```python
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
    Trainer
)
from peft import LoraConfig, get_peft_model
import torch

def fine_tune_phi3(
    train_data,
    model_name: str = "microsoft/Phi-3-mini-4k-instruct",
    output_dir: str = "./phi3-finetuned"
):
    # Load model and tokenizer
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        torch_dtype=torch.float16,
        device_map="auto",
        trust_remote_code=True
    )
    tokenizer = AutoTokenizer.from_pretrained(model_name)

    # Configure LoRA for efficient fine-tuning
    lora_config = LoraConfig(
        r=16,
        lora_alpha=32,
        target_modules=["q_proj", "v_proj", "k_proj", "o_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM"
    )

    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()  # ~0.1% of parameters

    # Training arguments
    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=3,
        per_device_train_batch_size=4,
        gradient_accumulation_steps=4,
        warmup_steps=100,
        learning_rate=2e-4,
        fp16=True,
        logging_steps=10,
        save_steps=100,
        evaluation_strategy="steps",
        eval_steps=100
    )

    # Train
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_data,
        tokenizer=tokenizer
    )

    trainer.train()
    trainer.save_model()

    return output_dir
```

## Phi-3 vs Other Models

```python
# Benchmark comparison (approximate)

benchmarks = {
    "Phi-3-mini (3.8B)": {
        "MMLU": 68.8,
        "GSM8K": 75.0,
        "HumanEval": 58.5,
        "Memory_GB": 3.8,
        "Tokens_per_sec_cpu": 15
    },
    "Llama-3-8B": {
        "MMLU": 66.6,
        "GSM8K": 77.4,
        "HumanEval": 62.2,
        "Memory_GB": 8.0,
        "Tokens_per_sec_cpu": 8
    },
    "GPT-3.5-turbo": {
        "MMLU": 70.0,
        "GSM8K": 57.1,
        "HumanEval": 48.1,
        "Memory_GB": "N/A (cloud)",
        "Tokens_per_sec_cpu": "N/A"
    }
}

# Phi-3 achieves comparable quality with:
# - 2x smaller than Llama-3-8B
# - 2x faster inference
# - Runs on consumer hardware
```

## Best Use Cases for Phi

```python
# When to use Phi models

ideal_scenarios = [
    {
        "scenario": "Code completion in IDE",
        "why": "Low latency needed, runs locally",
        "model": "phi-3-mini"
    },
    {
        "scenario": "Mobile app AI features",
        "why": "On-device, no API costs",
        "model": "phi-3-mini-quantized"
    },
    {
        "scenario": "High-volume classification",
        "why": "Cost at scale, fine-tunable",
        "model": "phi-3-small"
    },
    {
        "scenario": "Edge IoT processing",
        "why": "Offline capable, low power",
        "model": "phi-3-mini"
    },
    {
        "scenario": "Internal chatbot",
        "why": "Privacy, no data leaves org",
        "model": "phi-3-medium"
    }
]

# When to use larger models instead
use_larger_model = [
    "Complex multi-step reasoning",
    "Very long documents (>32K tokens)",
    "Creative writing tasks",
    "Latest knowledge needed",
    "Multi-modal with high quality"
]
```

## Phi in Production

```python
from fastapi import FastAPI
import uvicorn

app = FastAPI()

# Load model at startup
phi3 = None

@app.on_event("startup")
async def load_model():
    global phi3
    phi3 = Phi3Inference("phi-3-mini-onnx")

@app.post("/generate")
async def generate(prompt: str, max_tokens: int = 256):
    response = phi3.generate(prompt, max_tokens)
    return {"response": response}

@app.get("/health")
async def health():
    return {"status": "healthy", "model": "phi-3-mini"}

# Run: uvicorn app:app --host 0.0.0.0 --port 8000
```

Phi models represent the future of practical AI - powerful enough for real tasks, small enough to deploy anywhere. Start with Phi-3-mini for most use cases and scale up only if needed.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
