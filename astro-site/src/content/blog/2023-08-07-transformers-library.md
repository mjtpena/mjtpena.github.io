---
title: "Transformers Library: The Swiss Army Knife of NLP"
author: Michael John Peña
draft: false
date: 2023-08-07
tags:
  - Transformers
  - Hugging Face
  - NLP
  - Deep Learning

---

I wrote "Transformers Library: The Swiss Army Knife of NLP" to share practical, production-minded guidance on this topic.

## Core Concepts

```python
# Transformers library components
components = {
    "models": "Pre-trained model architectures",
    "tokenizers": "Text preprocessing",
    "pipelines": "High-level inference API",
    "trainers": "Training utilities",
    "configs": "Model configurations"
}

# Installation
# pip install transformers torch
# pip install transformers[torch]  # With PyTorch
# pip install transformers[tf]     # With TensorFlow
```

## Pipelines: Easy Inference

```python
from transformers import pipeline

# Text generation
generator = pipeline("text-generation", model="gpt2")
result = generator("The future of AI is", max_length=50, num_return_sequences=2)

# Sentiment analysis
classifier = pipeline("sentiment-analysis")
result = classifier("I love this product!")
# [{'label': 'POSITIVE', 'score': 0.9998}]

# Named entity recognition
ner = pipeline("ner", aggregation_strategy="simple")
result = ner("Microsoft is based in Redmond, Washington")

# Question answering
qa = pipeline("question-answering")
result = qa(question="What is the capital?", context="France is a country. Paris is its capital.")

# Summarization
summarizer = pipeline("summarization", model="facebook/bart-large-cnn")
result = summarizer(long_text, max_length=100, min_length=30)

# Translation
translator = pipeline("translation_en_to_fr")
result = translator("Hello, how are you?")

# Zero-shot classification
classifier = pipeline("zero-shot-classification")
result = classifier(
    "I need to book a flight to Paris",
    candidate_labels=["travel", "cooking", "technology"]
)
```

## Working with Models and Tokenizers

```python
from transformers import AutoTokenizer, AutoModelForCausalLM
import torch

# Load tokenizer and model
model_name = "gpt2"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForCausalLM.from_pretrained(model_name)

# Tokenization
text = "Hello, how are you?"
tokens = tokenizer(text, return_tensors="pt")
print(tokens)
# {'input_ids': tensor([[15496,    11,   703,   389,   345,    30]]),
#  'attention_mask': tensor([[1, 1, 1, 1, 1, 1]])}

# Decode back to text
decoded = tokenizer.decode(tokens["input_ids"][0])

# Batch tokenization
texts = ["First sentence", "Second sentence"]
batch_tokens = tokenizer(
    texts,
    padding=True,
    truncation=True,
    max_length=512,
    return_tensors="pt"
)

# Generation
outputs = model.generate(
    tokens["input_ids"],
    max_length=50,
    num_return_sequences=1,
    temperature=0.7,
    do_sample=True
)
generated_text = tokenizer.decode(outputs[0], skip_special_tokens=True)
```

## Generation Parameters

```python
# Comprehensive generation configuration
generation_config = {
    # Length control
    "max_length": 100,
    "max_new_tokens": 50,
    "min_length": 10,

    # Sampling strategies
    "do_sample": True,           # Enable sampling
    "temperature": 0.7,          # Randomness (lower = more deterministic)
    "top_k": 50,                 # Top-k sampling
    "top_p": 0.9,                # Nucleus sampling

    # Beam search
    "num_beams": 4,              # Beam search beams
    "early_stopping": True,

    # Repetition control
    "repetition_penalty": 1.2,
    "no_repeat_ngram_size": 3,

    # Output control
    "num_return_sequences": 3,
    "return_dict_in_generate": True,
    "output_scores": True
}

outputs = model.generate(**tokens, **generation_config)
```

## Different Model Types

```python
from transformers import (
    AutoModelForCausalLM,           # GPT-style generation
    AutoModelForSeq2SeqLM,          # T5-style encoder-decoder
    AutoModelForSequenceClassification,
    AutoModelForTokenClassification,
    AutoModelForQuestionAnswering,
    AutoModelForMaskedLM
)

# Causal LM (GPT, LLaMA, etc.)
model = AutoModelForCausalLM.from_pretrained("gpt2")

# Seq2Seq (T5, BART for generation)
model = AutoModelForSeq2SeqLM.from_pretrained("t5-base")

# Classification
model = AutoModelForSequenceClassification.from_pretrained(
    "bert-base-uncased",
    num_labels=3
)

# Token classification (NER)
model = AutoModelForTokenClassification.from_pretrained(
    "bert-base-uncased",
    num_labels=9
)
```

## Training with Trainer

```python
from transformers import Trainer, TrainingArguments
from datasets import load_dataset

# Load dataset
dataset = load_dataset("imdb")

# Tokenize
def tokenize_function(examples):
    return tokenizer(
        examples["text"],
        padding="max_length",
        truncation=True,
        max_length=512
    )

tokenized_datasets = dataset.map(tokenize_function, batched=True)

# Training arguments
training_args = TrainingArguments(
    output_dir="./results",
    num_train_epochs=3,
    per_device_train_batch_size=8,
    per_device_eval_batch_size=8,
    warmup_steps=500,
    weight_decay=0.01,
    logging_dir="./logs",
    logging_steps=100,
    evaluation_strategy="epoch",
    save_strategy="epoch",
    load_best_model_at_end=True
)

# Create trainer
trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=tokenized_datasets["train"],
    eval_dataset=tokenized_datasets["test"],
    tokenizer=tokenizer
)

# Train
trainer.train()

# Evaluate
results = trainer.evaluate()
```

## Saving and Loading

```python
# Save model and tokenizer
model.save_pretrained("./my_model")
tokenizer.save_pretrained("./my_model")

# Load later
model = AutoModelForCausalLM.from_pretrained("./my_model")
tokenizer = AutoTokenizer.from_pretrained("./my_model")

# Push to Hub
model.push_to_hub("username/my-model")
tokenizer.push_to_hub("username/my-model")
```

## Memory Optimization

```python
import torch

# Half precision
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype=torch.float16
)

# Device mapping
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    device_map="auto"  # Automatic placement
)

# Memory efficient loading
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    low_cpu_mem_usage=True
)

# Gradient checkpointing (for training)
model.gradient_checkpointing_enable()
```

Tomorrow we'll explore the Accelerate library for distributed training.

## Resources

- [Transformers Documentation](https://huggingface.co/docs/transformers)
- [Pipeline API](https://huggingface.co/docs/transformers/main_classes/pipelines)
- [Model Hub](https://huggingface.co/models)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
