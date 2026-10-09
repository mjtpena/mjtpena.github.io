---
title: "Azure Cognitive Services: AI APIs for Every Developer"
description: "\"We want AI in my app\" is a sentence I hear at least twice a month. Eight times out of ten the answer isn't \"train a custom model\" — it's \"use Cognitive…"
author: Michael John Peña
draft: false
date: 2020-10-07
tags:
  - Azure
  - Cognitive Services
  - AI
  - APIs
---

"We want AI in my app" is a sentence I hear at least twice a month. Eight times out of ten the answer isn't "train a custom model" — it's "use Cognitive Services for the bit you need and ship next week." Vision, speech, language, and decision APIs that are good enough for most production use cases, billed per call, no model training required. Where the prebuilt model doesn't fit the domain, the conversation gets longer; until then, this is the lowest-friction way to add useful AI to a product.

## Service Categories

### Vision
- **Computer Vision**: Image analysis, OCR
- **Face**: Detection, recognition, emotions
- **Custom Vision**: Train your own image classifier

### Speech
- **Speech to Text**: Transcription
- **Text to Speech**: Voice synthesis
- **Speech Translation**: Real-time translation

### Language
- **Text Analytics**: Sentiment, key phrases, entities
- **Translator**: 70+ languages
- **LUIS**: Language understanding

### Decision
- **Anomaly Detector**: Time series anomalies
- **Content Moderator**: Image/text moderation
- **Personalizer**: Personalized recommendations

## Quick Start: Text Analytics

```python
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential

client = TextAnalyticsClient(
    endpoint="https://my-cog.cognitiveservices.azure.com/",
    credential=AzureKeyCredential("your-key")
)

documents = ["I love this product! It's amazing.", "Terrible service, very disappointed."]

# Sentiment analysis
results = client.analyze_sentiment(documents)
for doc in results:
    print(f"Sentiment: {doc.sentiment}, Scores: {doc.confidence_scores}")

# Key phrases
key_phrases = client.extract_key_phrases(documents)
for doc in key_phrases:
    print(f"Key phrases: {doc.key_phrases}")
```

## Computer Vision

```python
from azure.cognitiveservices.vision.computervision import ComputerVisionClient

client = ComputerVisionClient(endpoint, CognitiveServicesCredentials(key))

# Analyze image
analysis = client.analyze_image(image_url, visual_features=['Categories', 'Description', 'Tags'])

print(f"Description: {analysis.description.captions[0].text}")
print(f"Tags: {[tag.name for tag in analysis.tags]}")
```

## Pricing Model

Most services offer:
- **Free tier**: Limited calls/month
- **Standard tier**: Pay per transaction

Example: Text Analytics sentiment = $0.50 per 1,000 text records

Cognitive Services democratize AI for application developers.
