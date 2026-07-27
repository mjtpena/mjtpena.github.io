---
title: "Phi-3 Family: Microsoft's Small Language Models"
author: Michael John Peña
draft: false
date: 2024-05-12
tags:
  - AI
  - Phi-3
  - SLM
  - Microsoft
  - Azure

---

I wrote "Phi-3 Family: Microsoft's Small Language Models" to share practical, production-minded guidance on this topic.

## The Phi-3 Family

| Model | Parameters | Context | Use Case |
|-------|------------|---------|----------|
| Phi-3-mini | 3.8B | 4K/128K | Mobile, edge devices |
| Phi-3-small | 7B | 8K/128K | Balanced performance |
| Phi-3-medium | 14B | 4K/128K | Complex reasoning |
| Phi-3-vision | 4.2B | 128K | Multimodal tasks |

## Why Phi-3 Matters

**Quality per Parameter**

Phi-3-mini (3.8B) outperforms many 7B models on benchmarks:

| Benchmark | Phi-3-mini | Llama-3-8B | Mixtral 8x7B |
|-----------|------------|------------|--------------|
| MMLU | 68.8 | 66.6 | 70.6 |
| GSM8K | 82.5 | 79.6 | 74.4 |
| HumanEval | 58.5 | 62.2 | 40.2 |

**Efficient Training**

Phi-3 uses high-quality training data (textbooks, filtered web content) rather than raw internet scale.

## Getting Started with Phi-3

### Using Transformers

```python
from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline
import torch

model_id = "microsoft/Phi-3-mini-4k-instruct"

tokenizer = AutoTokenizer.from_pretrained(model_id)
model = AutoModelForCausalLM.from_pretrained(
    model_id,
    torch_dtype=torch.float16,
    device_map="auto",
    trust_remote_code=True
)

pipe = pipeline(
    "text-generation",
    model=model,
    tokenizer=tokenizer,
    max_new_tokens=500
)

messages = [
    {"role": "system", "content": "You are a helpful AI assistant."},
    {"role": "user", "content": "Explain the CAP theorem in distributed systems."}
]

output = pipe(messages)
print(output[0]['generated_text'][-1]['content'])
```

### Using Azure AI

```python
from azure.ai.inference import ChatCompletionsClient
from azure.core.credentials import AzureKeyCredential

client = ChatCompletionsClient(
    endpoint="https://your-endpoint.inference.ai.azure.com",
    credential=AzureKeyCredential("your-key")
)

response = client.complete(
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Write a Python function to calculate factorial."}
    ],
    model="Phi-3-mini-4k-instruct",
    temperature=0.7,
    max_tokens=500
)

print(response.choices[0].message.content)
```

### Using ONNX Runtime

```python
import onnxruntime_genai as og

# Load quantized model
model = og.Model("./phi-3-mini-4k-instruct-onnx")
tokenizer = og.Tokenizer(model)

# Create generator
params = og.GeneratorParams(model)
params.set_search_options(max_length=500, temperature=0.7)

prompt = "<|user|>\nExplain REST APIs<|end|>\n<|assistant|>\n"
tokens = tokenizer.encode(prompt)
params.input_ids = tokens

generator = og.Generator(model, params)

output_tokens = []
while not generator.is_done():
    generator.compute_logits()
    generator.generate_next_token()
    output_tokens.append(generator.get_next_tokens()[0])

response = tokenizer.decode(output_tokens)
print(response)
```

## Phi-3 Vision

Multimodal capabilities in a small package:

```python
from transformers import AutoModelForCausalLM, AutoProcessor
from PIL import Image
import torch

model_id = "microsoft/Phi-3-vision-128k-instruct"

processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
model = AutoModelForCausalLM.from_pretrained(
    model_id,
    torch_dtype=torch.float16,
    device_map="auto",
    trust_remote_code=True
)

def analyze_image(image_path: str, question: str) -> str:
    image = Image.open(image_path)

    messages = [
        {"role": "user", "content": f"<|image_1|>\n{question}"}
    ]

    prompt = processor.tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True
    )

    inputs = processor(prompt, [image], return_tensors="pt").to(model.device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=500,
            do_sample=True,
            temperature=0.7
        )

    response = processor.batch_decode(
        outputs[:, inputs['input_ids'].shape[1]:],
        skip_special_tokens=True
    )[0]

    return response

# Usage
result = analyze_image("architecture_diagram.png", "Describe this system architecture.")
print(result)
```

## Quantization for Edge

```python
from transformers import AutoModelForCausalLM, BitsAndBytesConfig
import torch

# 4-bit quantization
quantization_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_compute_dtype=torch.float16,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_use_double_quant=True
)

model = AutoModelForCausalLM.from_pretrained(
    "microsoft/Phi-3-mini-4k-instruct",
    quantization_config=quantization_config,
    device_map="auto",
    trust_remote_code=True
)

# Model now uses ~2GB RAM instead of ~8GB
print(f"Model size: {model.get_memory_footprint() / 1e9:.2f} GB")
```

## Fine-tuning Phi-3

```python
from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments
from peft import LoraConfig, get_peft_model
from trl import SFTTrainer
import torch

# Load base model
model = AutoModelForCausalLM.from_pretrained(
    "microsoft/Phi-3-mini-4k-instruct",
    torch_dtype=torch.float16,
    device_map="auto",
    trust_remote_code=True
)

tokenizer = AutoTokenizer.from_pretrained(
    "microsoft/Phi-3-mini-4k-instruct",
    trust_remote_code=True
)

# Configure LoRA
lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM"
)

model = get_peft_model(model, lora_config)
model.print_trainable_parameters()

# Training configuration
training_args = TrainingArguments(
    output_dir="./phi3-finetuned",
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    warmup_steps=100,
    logging_steps=10,
    save_steps=500,
    fp16=True
)

# Trainer
trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=train_dataset,
    tokenizer=tokenizer,
    max_seq_length=2048
)

trainer.train()
```

## Use Cases for Phi-3

### Code Assistant

```python
def code_completion(partial_code: str) -> str:
    prompt = f"""Complete this Python code:

```python
{partial_code}
```

Completed code:"""

    response = pipe([{"role": "user", "content": prompt}])
    return response[0]['generated_text'][-1]['content']

# Usage
code = """def binary_search(arr, target):
    left, right = 0, len(arr) - 1
    while left <= right:"""

completed = code_completion(code)
print(completed)
```

### Document Q&A

```python
def answer_question(context: str, question: str) -> str:
    prompt = f"""Context:
{context}

Question: {question}

Answer based only on the provided context:"""

    response = pipe([
        {"role": "system", "content": "Answer questions based only on the provided context."},
        {"role": "user", "content": prompt}
    ])
    return response[0]['generated_text'][-1]['content']
```

### Structured Output

```python
import json

def extract_entities(text: str) -> dict:
    prompt = f"""Extract entities from this text as JSON:
{{
    "people": [],
    "organizations": [],
    "locations": [],
    "dates": []
}}

Text: {text}

JSON:"""

    response = pipe([{"role": "user", "content": prompt}])
    output = response[0]['generated_text'][-1]['content']

    # Parse JSON from response
    try:
        return json.loads(output)
    except:
        return {"error": "Failed to parse", "raw": output}
```

## Phi-3 vs GPT-4o: When to Use Which

| Scenario | Phi-3 | GPT-4o |
|----------|-------|--------|
| Offline required | Yes | No |
| Cost-sensitive | Yes | Depends |
| Complex reasoning | Limited | Yes |
| Multimodal | Phi-3-vision | Yes |
| Fine-tuning needed | Yes (easy) | No |
| Data privacy | Yes | Requires Azure |

## Deployment Options

1. **Local device** - Direct inference
2. **Azure AI** - Serverless API
3. **Azure ML** - Managed endpoint
4. **Edge devices** - IoT Hub integration
5. **Mobile** - ONNX Runtime Mobile

## What's Next

Tomorrow I'll cover Small Language Models more broadly and their role in enterprise AI.

## Resources

- [Phi-3 Model Card](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct)
- [Azure AI Model Catalog](https://ai.azure.com/explore/models)
- [Phi-3 Cookbook](https://github.com/microsoft/Phi-3CookBook)
- [ONNX Runtime GenAI](https://github.com/microsoft/onnxruntime-genai)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
