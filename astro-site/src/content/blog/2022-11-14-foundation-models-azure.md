---
title: "Foundation Models on Azure: Understanding Large Language Models"
author: Michael John Peña
draft: false
date: 2022-11-14
tags:
  - Azure
  - AI
  - Machine Learning
  - Foundation Models
  - GPT-3

---

I wrote "Foundation Models on Azure: Understanding Large Language Models" to share practical, production-minded guidance on this topic.

## What Are Foundation Models?

Foundation models are pre-trained on massive datasets and can be:
- Used directly for various tasks
- Fine-tuned for specific domains
- Used as feature extractors

Examples include:
- **Language**: GPT-3, Codex
- **Vision**: CLIP, DALL-E 2
- **Code**: Codex (powers GitHub Copilot)

## Foundation Models in Azure

Azure provides access to foundation models through multiple services:

### Azure OpenAI Service

```python
import openai

openai.api_type = "azure"
openai.api_base = "https://your-resource.openai.azure.com/"
openai.api_key = "your-api-key"
openai.api_version = "2022-06-01-preview"

# Use GPT-3 Davinci
response = openai.Completion.create(
    engine="text-davinci-002",
    prompt="Explain the concept of foundation models in AI:",
    max_tokens=300,
    temperature=0.7
)

print(response.choices[0].text)
```

### Azure Machine Learning Model Catalog

```python
from azure.ai.ml import MLClient
from azure.identity import DefaultAzureCredential

# Connect to Azure ML
ml_client = MLClient(
    DefaultAzureCredential(),
    subscription_id="your-subscription",
    resource_group="your-rg",
    workspace_name="your-workspace"
)

# Browse available models
models = ml_client.models.list(
    registry_name="azureml"
)

for model in models:
    print(f"{model.name}: {model.description}")
```

## Using Pre-trained Models

### Text Generation with GPT-3

```python
def generate_text(prompt: str, max_tokens: int = 200) -> str:
    """Generate text using GPT-3."""

    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=prompt,
        max_tokens=max_tokens,
        temperature=0.7,
        top_p=1,
        frequency_penalty=0,
        presence_penalty=0
    )

    return response.choices[0].text.strip()

# Example: Generate code documentation
code = """
def calculate_cosmos_ru(item_size_kb, reads_per_sec, writes_per_sec):
    read_rus = reads_per_sec * (item_size_kb / 4) * 1
    write_rus = writes_per_sec * (item_size_kb / 4) * 5
    return int(read_rus + write_rus)
"""

documentation = generate_text(f"Generate documentation for this function:\n\n{code}")
print(documentation)
```

### Text Embedding Models

```python
import numpy as np

def get_embedding(text: str, model: str = "text-embedding-ada-002") -> list:
    """Get text embedding from foundation model."""

    response = openai.Embedding.create(
        input=text,
        engine=model
    )

    return response['data'][0]['embedding']

def semantic_similarity(text1: str, text2: str) -> float:
    """Calculate semantic similarity between two texts."""

    embedding1 = np.array(get_embedding(text1))
    embedding2 = np.array(get_embedding(text2))

    # Cosine similarity
    similarity = np.dot(embedding1, embedding2) / (
        np.linalg.norm(embedding1) * np.linalg.norm(embedding2)
    )

    return similarity

# Example
similarity = semantic_similarity(
    "Azure Cosmos DB is a globally distributed database",
    "Microsoft's NoSQL database service with global replication"
)
print(f"Similarity: {similarity:.4f}")  # High similarity expected
```

## Fine-tuning Foundation Models

### Preparing Data

```python
import json

def prepare_fine_tuning_data(examples: list) -> str:
    """Prepare data for fine-tuning."""

    formatted_data = []
    for example in examples:
        formatted_data.append({
            "prompt": example["input"] + "\n\n###\n\n",
            "completion": " " + example["output"] + "###"
        })

    return "\n".join(json.dumps(item) for item in formatted_data)

# Example: Customer service fine-tuning
training_examples = [
    {
        "input": "Customer: My order hasn't arrived yet.\nContext: Order #12345, shipped 3 days ago",
        "output": "I understand your concern about order #12345. Let me check the tracking status. It shows your package is currently in transit and should arrive within 1-2 business days."
    },
    {
        "input": "Customer: How do I return this item?\nContext: Electronics purchase, within 30-day window",
        "output": "I'd be happy to help you with your return. Since your electronics purchase is within our 30-day return window, you can initiate a return through your account or I can start the process for you now."
    }
]

training_data = prepare_fine_tuning_data(training_examples)
```

### Fine-tuning with Azure OpenAI

```python
# Upload training file
training_file = openai.File.create(
    file=open("training_data.jsonl", "rb"),
    purpose="fine-tune"
)

# Create fine-tuning job
fine_tune = openai.FineTune.create(
    training_file=training_file["id"],
    model="davinci",
    n_epochs=4,
    batch_size=4,
    learning_rate_multiplier=0.1
)

# Monitor progress
print(f"Fine-tune job ID: {fine_tune['id']}")
```

## Building Search Applications with Embeddings

Combine embeddings with vector search for powerful applications:

```python
from azure.search.documents import SearchClient
from azure.core.credentials import AzureKeyCredential

class SemanticSearchApplication:
    def __init__(self, search_endpoint: str, search_key: str, index_name: str):
        self.search_client = SearchClient(
            endpoint=search_endpoint,
            index_name=index_name,
            credential=AzureKeyCredential(search_key)
        )

    def embed_query(self, query: str) -> list:
        """Get embedding for search query."""
        return get_embedding(query)

    def search(self, query: str, top_k: int = 5) -> list:
        """Search using semantic similarity."""

        # Get query embedding
        query_embedding = self.embed_query(query)

        # Search using Azure Cognitive Search
        results = self.search_client.search(
            search_text=query,
            top=top_k,
            select=["title", "content", "url"]
        )

        return [
            {
                "title": r["title"],
                "content": r["content"],
                "url": r["url"],
                "score": r["@search.score"]
            }
            for r in results
        ]

# Usage
search_app = SemanticSearchApplication(
    search_endpoint="https://your-search.search.windows.net",
    search_key="your-key",
    index_name="documents"
)

results = search_app.search("How do I configure Azure Cosmos DB for global distribution?")
for result in results:
    print(f"{result['title']}: {result['score']:.4f}")
```

## Vision Models

### Image Analysis with Azure Computer Vision

```python
from azure.cognitiveservices.vision.computervision import ComputerVisionClient
from msrest.authentication import CognitiveServicesCredentials

def analyze_image(image_url: str) -> dict:
    """Analyze image using Computer Vision."""

    cv_client = ComputerVisionClient(
        endpoint="https://your-cv.cognitiveservices.azure.com",
        credentials=CognitiveServicesCredentials("your-key")
    )

    # Get image description
    description = cv_client.describe_image(image_url)

    # Get tags
    tags = cv_client.tag_image(image_url)

    return {
        "description": description.captions[0].text if description.captions else None,
        "confidence": description.captions[0].confidence if description.captions else 0,
        "tags": [tag.name for tag in tags.tags]
    }

# Combine with GPT-3 for question answering about images
def answer_image_question(image_url: str, question: str) -> str:
    """Answer questions about an image."""

    analysis = analyze_image(image_url)

    prompt = f"""Based on this image analysis:
Description: {analysis['description']}
Tags: {', '.join(analysis['tags'])}

Answer this question: {question}

Answer:"""

    response = openai.Completion.create(
        engine="text-davinci-002",
        prompt=prompt,
        max_tokens=200,
        temperature=0.3
    )

    return response.choices[0].text.strip()
```

## Cost Considerations

Foundation models can be expensive. Strategies to manage costs:

```python
class CostOptimizedModelClient:
    def __init__(self):
        self.cache = {}
        self.token_usage = 0

    def call_with_cache(self, prompt: str, **kwargs) -> str:
        """Cache responses to avoid duplicate API calls."""

        cache_key = hash(prompt + str(kwargs))

        if cache_key in self.cache:
            return self.cache[cache_key]

        response = openai.Completion.create(
            prompt=prompt,
            **kwargs
        )

        self.token_usage += response['usage']['total_tokens']
        result = response.choices[0].text

        self.cache[cache_key] = result
        return result

    def choose_model(self, task_complexity: str) -> str:
        """Choose appropriate model based on task."""

        model_map = {
            "simple": "text-ada-001",         # Cheapest
            "medium": "text-curie-001",       # Mid-tier
            "complex": "text-davinci-002"     # Most capable
        }

        return model_map.get(task_complexity, "text-curie-001")

    def get_cost_estimate(self) -> float:
        """Estimate cost based on token usage."""

        # Approximate pricing (varies by model)
        cost_per_1k_tokens = 0.02
        return (self.token_usage / 1000) * cost_per_1k_tokens
```

## Conclusion

Foundation models are transforming AI development. Azure provides access to state-of-the-art models through Azure OpenAI Service, Azure Cognitive Services, and Azure ML, making it easier to build intelligent applications. Whether you use them directly, fine-tune for specific tasks, or build search systems with embeddings, these models enable capabilities that were impossible just a few years ago.

## Resources

- [Azure OpenAI Service](https://azure.microsoft.com/en-us/products/cognitive-services/openai-service/)
- [Azure Machine Learning](https://learn.microsoft.com/en-us/azure/machine-learning/)
- [Azure Cognitive Services](https://azure.microsoft.com/en-us/products/cognitive-services/)
- [OpenAI API Documentation](https://platform.openai.com/docs/)

