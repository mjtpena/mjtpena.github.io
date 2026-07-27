---
title: "Phi-3 Local Deployment: Running Microsoft's SLM On-Device"
author: Michael John Peña
draft: false
date: 2025-04-05
tags:
  - Phi-3
  - SLM
  - On-Device
  - Microsoft
  - Deployment

---

I wrote "Phi-3 Local Deployment: Running Microsoft's SLM On-Device" to share practical, production-minded guidance on this topic.

## Phi-3 Deployment Options

```python
# phi3_local.py - Running Phi-3 locally

import onnxruntime_genai as og
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch

class Phi3Local:
    """Run Phi-3 locally with different backends."""

    @staticmethod
    def load_onnx(model_path: str):
        """Load Phi-3 ONNX model for optimal performance."""
        model = og.Model(model_path)
        tokenizer = og.Tokenizer(model)

        return model, tokenizer

    @staticmethod
    def generate_onnx(model, tokenizer, prompt: str, max_tokens: int = 500) -> str:
        """Generate text using ONNX runtime."""
        params = og.GeneratorParams(model)
        params.set_search_options(max_length=max_tokens, temperature=0.7)

        input_tokens = tokenizer.encode(prompt)
        params.input_ids = input_tokens

        generator = og.Generator(model, params)

        output_tokens = []
        while not generator.is_done():
            generator.compute_logits()
            generator.generate_next_token()
            output_tokens.append(generator.get_next_tokens()[0])

        return tokenizer.decode(output_tokens)

    @staticmethod
    def load_transformers(model_name: str = "microsoft/Phi-3-mini-4k-instruct"):
        """Load Phi-3 using transformers library."""
        model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=torch.float16,
            device_map="auto",
            trust_remote_code=True
        )
        tokenizer = AutoTokenizer.from_pretrained(model_name)

        return model, tokenizer

    @staticmethod
    def generate_transformers(model, tokenizer, prompt: str, max_tokens: int = 500) -> str:
        """Generate text using transformers."""
        messages = [{"role": "user", "content": prompt}]
        input_ids = tokenizer.apply_chat_template(
            messages,
            return_tensors="pt"
        ).to(model.device)

        outputs = model.generate(
            input_ids,
            max_new_tokens=max_tokens,
            temperature=0.7,
            do_sample=True
        )

        return tokenizer.decode(outputs[0], skip_special_tokens=True)


class Phi3UseCases:
    """Common Phi-3 use cases for local deployment."""

    def __init__(self, model, tokenizer):
        self.model = model
        self.tokenizer = tokenizer

    def summarize(self, text: str) -> str:
        prompt = f"Summarize the following text in 2-3 sentences:\n\n{text}"
        return self.generate(prompt)

    def extract_entities(self, text: str) -> str:
        prompt = f"Extract all named entities (people, places, organizations) from:\n\n{text}"
        return self.generate(prompt)

    def classify_sentiment(self, text: str) -> str:
        prompt = f"Classify the sentiment as positive, negative, or neutral:\n\n{text}"
        return self.generate(prompt)

    def answer_question(self, context: str, question: str) -> str:
        prompt = f"Context: {context}\n\nQuestion: {question}\n\nAnswer:"
        return self.generate(prompt)
```

Phi-3 enables powerful AI capabilities entirely on-device with no cloud dependency.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
