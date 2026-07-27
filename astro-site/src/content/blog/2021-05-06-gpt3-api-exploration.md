---
title: "Exploring the OpenAI GPT-3 API: Practical Patterns and Techniques"
author: Michael John Peña
draft: false
date: 2021-05-06
tags:
  - AI
  - GPT-3
  - OpenAI
  - NLP
  - Machine Learning

---

I wrote "Exploring the OpenAI GPT-3 API: Practical Patterns and Techniques" to share practical, production-minded guidance on this topic.

## Getting Access to GPT-3

To use GPT-3, you need to:
1. Sign up at [OpenAI](https://openai.com/)
2. Join the API waitlist
3. Get approved (approval times vary)
4. Receive API key

This is direct OpenAI access - enterprise Azure integration may come in the future.

## Understanding the Models

GPT-3 comes in four sizes, each with different capabilities and costs:

| Model | Parameters | Best For | Cost (per 1K tokens) |
|-------|-----------|----------|---------------------|
| Davinci | 175B | Complex tasks, analysis | $0.06 |
| Curie | 6.7B | Translation, classification | $0.006 |
| Babbage | 1.3B | Straightforward tasks | $0.0012 |
| Ada | 350M | Simple classification | $0.0008 |

Choose based on task complexity, not by default:

```python
import openai
import os

openai.api_key = os.getenv("OPENAI_API_KEY")

def select_model_for_task(task_type):
    """Select appropriate model based on task requirements."""
    model_mapping = {
        "complex_reasoning": "text-davinci-002",
        "classification": "text-curie-001",
        "parsing": "text-babbage-001",
        "simple_lookup": "text-ada-001"
    }
    return model_mapping.get(task_type, "text-curie-001")
```

## Few-Shot Learning

GPT-3 excels at learning from examples in the prompt:

```python
def classify_sentiment_few_shot(text):
    prompt = """Classify the sentiment of the following reviews.

Review: "This product exceeded my expectations! Great quality."
Sentiment: Positive

Review: "Terrible experience. Would not recommend to anyone."
Sentiment: Negative

Review: "It's okay, nothing special but does the job."
Sentiment: Neutral

Review: "{}"
Sentiment:""".format(text)

    response = openai.Completion.create(
        engine="text-curie-001",  # Curie is sufficient for classification
        prompt=prompt,
        max_tokens=10,
        temperature=0,
        stop=["\n"]
    )

    return response.choices[0].text.strip()

# Usage
result = classify_sentiment_few_shot("Amazing service, will definitely return!")
print(result)  # Output: Positive
```

## Chain of Thought Prompting

For complex reasoning, guide the model through steps:

```python
def solve_math_problem(problem):
    prompt = f"""Solve the following problem step by step.

Problem: If a store sells 150 items on Monday, 200 items on Tuesday, and the average for the week (5 days) is 180 items per day, how many items were sold in the remaining 3 days combined?

Solution:
Step 1: Calculate total items for the week = 180 * 5 = 900 items
Step 2: Calculate items sold Monday and Tuesday = 150 + 200 = 350 items
Step 3: Calculate remaining items = 900 - 350 = 550 items
Answer: 550 items were sold in the remaining 3 days combined.

Problem: {problem}

Solution:"""

    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=prompt,
        max_tokens=300,
        temperature=0.2
    )

    return response.choices[0].text.strip()
```

## Structured Output Generation

Get consistent structured outputs using clear formatting:

```python
def extract_meeting_details(transcript):
    prompt = f"""Extract meeting details from the transcript and format as JSON.

Transcript:
"Hi team, let's schedule our quarterly review for next Friday at 2 PM. We'll need the conference room for about 2 hours. Please bring your project updates."

Output:
{{
    "meeting_type": "quarterly review",
    "date": "next Friday",
    "time": "2 PM",
    "duration": "2 hours",
    "location": "conference room",
    "requirements": ["project updates"]
}}

Transcript:
"{transcript}"

Output:"""

    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=prompt,
        max_tokens=200,
        temperature=0,
        stop=["\n\n"]
    )

    import json
    return json.loads(response.choices[0].text.strip())
```

## Temperature and Sampling

Temperature controls randomness. Here's when to use what:

```python
def generate_content(prompt, creativity_level):
    """
    creativity_level: 'factual', 'balanced', 'creative'
    """
    temperature_map = {
        "factual": 0,      # Deterministic, same input = same output
        "balanced": 0.5,   # Some variety while staying coherent
        "creative": 0.9    # Maximum creativity, more randomness
    }

    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=prompt,
        max_tokens=200,
        temperature=temperature_map[creativity_level],
        top_p=1
    )

    return response.choices[0].text

# Factual: code generation, data extraction
# Balanced: general content, summaries
# Creative: brainstorming, storytelling
```

## Handling Long Content

GPT-3 has a context limit (4096 tokens for davinci). For long content, chunk and process:

```python
def summarize_long_document(document, max_chunk_tokens=2000):
    # Split into chunks
    chunks = split_into_chunks(document, max_chunk_tokens)

    # Summarize each chunk
    chunk_summaries = []
    for chunk in chunks:
        summary = openai.Completion.create(
            engine="text-davinci-002",
            prompt=f"Summarize the following text in 2-3 sentences:\n\n{chunk}\n\nSummary:",
            max_tokens=150,
            temperature=0.3
        ).choices[0].text.strip()
        chunk_summaries.append(summary)

    # Combine summaries
    combined = "\n".join(chunk_summaries)

    # Final summary
    final_summary = openai.Completion.create(
        engine="text-davinci-002",
        prompt=f"Create a comprehensive summary from these section summaries:\n\n{combined}\n\nFinal Summary:",
        max_tokens=300,
        temperature=0.3
    ).choices[0].text.strip()

    return final_summary

def split_into_chunks(text, max_tokens):
    # Rough approximation: 1 token ~= 4 characters
    max_chars = max_tokens * 4
    words = text.split()
    chunks = []
    current_chunk = []
    current_length = 0

    for word in words:
        if current_length + len(word) > max_chars:
            chunks.append(" ".join(current_chunk))
            current_chunk = [word]
            current_length = len(word)
        else:
            current_chunk.append(word)
            current_length += len(word) + 1

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks
```

## Conversation Memory

Build conversational experiences by maintaining context:

```python
class ConversationManager:
    def __init__(self, system_context="You are a helpful assistant."):
        self.history = []
        self.system_context = system_context
        self.max_history = 10  # Keep last N exchanges

    def chat(self, user_message):
        # Build prompt with history
        prompt = f"{self.system_context}\n\n"

        for exchange in self.history[-self.max_history:]:
            prompt += f"User: {exchange['user']}\n"
            prompt += f"Assistant: {exchange['assistant']}\n\n"

        prompt += f"User: {user_message}\nAssistant:"

        response = openai.Completion.create(
            engine="text-davinci-002",
            prompt=prompt,
            max_tokens=200,
            temperature=0.7,
            stop=["User:", "\n\n"]
        )

        assistant_message = response.choices[0].text.strip()

        # Add to history
        self.history.append({
            "user": user_message,
            "assistant": assistant_message
        })

        return assistant_message

# Usage
chat = ConversationManager("You are a Python programming expert.")
print(chat.chat("What's the best way to read a CSV file?"))
print(chat.chat("How would I filter rows based on a condition?"))
```

## Error Handling and Retries

Production systems need robust error handling:

```python
import time
from openai import error as openai_error

def call_gpt3_with_retry(prompt, max_retries=3, **kwargs):
    for attempt in range(max_retries):
        try:
            response = openai.Completion.create(
                prompt=prompt,
                **kwargs
            )
            return response.choices[0].text.strip()

        except openai_error.RateLimitError:
            wait_time = (2 ** attempt) + 1  # Exponential backoff
            print(f"Rate limited. Waiting {wait_time} seconds...")
            time.sleep(wait_time)

        except openai_error.APIError as e:
            print(f"API error: {e}")
            if attempt < max_retries - 1:
                time.sleep(1)
            else:
                raise

        except openai_error.InvalidRequestError as e:
            print(f"Invalid request: {e}")
            raise  # Don't retry invalid requests

    raise Exception("Max retries exceeded")
```

## Cost Optimization Strategies

Keep costs under control:

```python
class CostTracker:
    # Prices per 1K tokens (as of early 2021)
    PRICES = {
        "text-davinci-002": 0.06,
        "text-curie-001": 0.006,
        "text-babbage-001": 0.0012,
        "text-ada-001": 0.0008
    }

    def __init__(self):
        self.usage = {}

    def track(self, model, prompt_tokens, completion_tokens):
        total_tokens = prompt_tokens + completion_tokens
        cost = (total_tokens / 1000) * self.PRICES.get(model, 0.06)

        if model not in self.usage:
            self.usage[model] = {"tokens": 0, "cost": 0}

        self.usage[model]["tokens"] += total_tokens
        self.usage[model]["cost"] += cost

        return cost

    def report(self):
        total_cost = sum(m["cost"] for m in self.usage.values())
        print(f"Total cost: ${total_cost:.4f}")
        for model, data in self.usage.items():
            print(f"  {model}: {data['tokens']} tokens, ${data['cost']:.4f}")

# Use caching for repeated queries
from functools import lru_cache

@lru_cache(maxsize=1000)
def cached_completion(prompt_hash, model, temperature):
    # Implementation...
    pass
```

## Practical Use Cases

### Content Generation

```python
def generate_product_description(product_name, features):
    prompt = f"""Write a compelling product description for {product_name}.

Features:
{features}

Description:"""

    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=prompt,
        max_tokens=150,
        temperature=0.8
    )

    return response.choices[0].text.strip()
```

### Code Explanation

```python
def explain_code(code_snippet):
    prompt = f"""Explain what this code does in plain English:

```python
{code_snippet}
```

Explanation:"""

    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=prompt,
        max_tokens=200,
        temperature=0.3
    )

    return response.choices[0].text.strip()
```

## Best Practices Summary

1. **Start with Curie** - Only use Davinci when needed
2. **Use few-shot examples** - They dramatically improve quality
3. **Set temperature based on task** - 0 for facts, higher for creativity
4. **Implement retries** - API can be flaky
5. **Track costs** - They add up quickly
6. **Cache responses** - Identical prompts give similar results

GPT-3 is a powerful tool, but using it effectively requires understanding these patterns and techniques.

## Looking Ahead

As of May 2021, GPT-3 access is through OpenAI's API only. Microsoft has announced a partnership with OpenAI, so we may see Azure integration in the future, which would bring enterprise features like:
- VNet integration
- Compliance certifications
- Private endpoints
- Azure AD authentication

For now, developers interested in large language models should experiment with the OpenAI API while keeping an eye on Azure announcements.

## Resources

- [OpenAI API Documentation](https://platform.openai.com/docs/)
- [OpenAI Cookbook](https://github.com/openai/openai-cookbook)
- [Best Practices for Prompt Engineering](https://help.openai.com/en/articles/6654000-best-practices-for-prompt-engineering)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
