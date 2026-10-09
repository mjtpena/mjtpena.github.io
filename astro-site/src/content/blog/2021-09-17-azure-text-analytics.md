---
title: Text Analytics with Azure Cognitive Services
description: "Text Analytics enables rich understanding of unstructured text, powering applications from customer feedback analysis to content recommendation systems."
author: Michael John Pena
draft: false
date: 2021-09-17
tags:
  - Azure
  - Cognitive Services
  - NLP
  - Text Analytics
  - AI
---

## Available Features

- **Sentiment Analysis**: Determine positive, negative, or neutral sentiment
- **Key Phrase Extraction**: Identify main talking points
- **Named Entity Recognition (NER)**: Extract people, places, organizations
- **Entity Linking**: Connect entities to Wikipedia
- **Language Detection**: Identify the language of text
- **Healthcare NLP**: Extract medical entities and relations

## Setting Up the Client

```python
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential

def get_text_analytics_client(key: str, endpoint: str) -> TextAnalyticsClient:
    """Create a Text Analytics client."""
    credential = AzureKeyCredential(key)
    return TextAnalyticsClient(endpoint=endpoint, credential=credential)

client = get_text_analytics_client(
    "your-key",
    "https://your-resource.cognitiveservices.azure.com/"
)
```

## Sentiment Analysis

```python
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential

def analyze_sentiment(client: TextAnalyticsClient, documents: list) -> list:
    """Analyze sentiment of documents."""

    results = client.analyze_sentiment(
        documents,
        show_opinion_mining=True
    )

    analyzed = []
    for doc in results:
        if not doc.is_error:
            analyzed.append({
                "id": doc.id,
                "sentiment": doc.sentiment,
                "confidence_scores": {
                    "positive": doc.confidence_scores.positive,
                    "neutral": doc.confidence_scores.neutral,
                    "negative": doc.confidence_scores.negative
                },
                "sentences": [
                    {
                        "text": sentence.text,
                        "sentiment": sentence.sentiment,
                        "opinions": [
                            {
                                "target": opinion.target.text,
                                "sentiment": opinion.target.sentiment,
                                "assessments": [
                                    {"text": a.text, "sentiment": a.sentiment}
                                    for a in opinion.assessments
                                ]
                            }
                            for opinion in sentence.mined_opinions
                        ]
                    }
                    for sentence in doc.sentences
                ]
            })
        else:
            analyzed.append({"id": doc.id, "error": doc.error.message})

    return analyzed

# Analyze product reviews
reviews = [
    {"id": "1", "text": "The hotel room was amazing with a great view! However, the WiFi was slow."},
    {"id": "2", "text": "Terrible experience. The food was cold and the staff was rude."},
    {"id": "3", "text": "Decent product for the price. Nothing special but it works."}
]

results = analyze_sentiment(client, [r["text"] for r in reviews])

for i, result in enumerate(results):
    print(f"\nReview {i+1}: {result['sentiment']}")
    print(f"Confidence: pos={result['confidence_scores']['positive']:.2f}, "
          f"neg={result['confidence_scores']['negative']:.2f}")

    for sentence in result.get('sentences', []):
        for opinion in sentence.get('opinions', []):
            print(f"  Target: {opinion['target']} ({opinion['sentiment']})")
            for assessment in opinion['assessments']:
                print(f"    - {assessment['text']}: {assessment['sentiment']}")
```

## Key Phrase Extraction

```python
def extract_key_phrases(client: TextAnalyticsClient, documents: list) -> list:
    """Extract key phrases from documents."""

    results = client.extract_key_phrases(documents)

    extracted = []
    for doc in results:
        if not doc.is_error:
            extracted.append({
                "id": doc.id,
                "key_phrases": doc.key_phrases
            })
        else:
            extracted.append({"id": doc.id, "error": doc.error.message})

    return extracted

# Extract key phrases from articles
articles = [
    """
    Microsoft Azure provides a comprehensive set of cloud services
    including computing, analytics, storage, and networking. Users can
    pick and choose from these services to develop and scale new applications,
    or run existing applications in the public cloud.
    """,
    """
    Machine learning is a subset of artificial intelligence that enables
    systems to learn and improve from experience without being explicitly
    programmed. Deep learning is a subset of machine learning that uses
    neural networks with many layers.
    """
]

results = extract_key_phrases(client, articles)

for i, result in enumerate(results):
    print(f"\nArticle {i+1} key phrases:")
    for phrase in result['key_phrases']:
        print(f"  - {phrase}")
```

## Named Entity Recognition

```python
def recognize_entities(client: TextAnalyticsClient, documents: list) -> list:
    """Recognize named entities in documents."""

    results = client.recognize_entities(documents)

    recognized = []
    for doc in results:
        if not doc.is_error:
            recognized.append({
                "id": doc.id,
                "entities": [
                    {
                        "text": entity.text,
                        "category": entity.category,
                        "subcategory": entity.subcategory,
                        "confidence": entity.confidence_score
                    }
                    for entity in doc.entities
                ]
            })
        else:
            recognized.append({"id": doc.id, "error": doc.error.message})

    return recognized

# Recognize entities in news article
news_article = """
Microsoft CEO Satya Nadella announced today that the company will invest
$20 billion in cybersecurity over the next five years. The announcement
was made at the headquarters in Redmond, Washington. This follows the
recent acquisition of Nuance Communications for $19.7 billion in April 2021.
"""

results = recognize_entities(client, [news_article])

for result in results:
    print("Entities found:")
    for entity in result['entities']:
        print(f"  {entity['text']}")
        print(f"    Category: {entity['category']}")
        if entity['subcategory']:
            print(f"    Subcategory: {entity['subcategory']}")
        print(f"    Confidence: {entity['confidence']:.2f}")
        print()
```

## Entity Linking

```python
def link_entities(client: TextAnalyticsClient, documents: list) -> list:
    """Link entities to Wikipedia articles."""

    results = client.recognize_linked_entities(documents)

    linked = []
    for doc in results:
        if not doc.is_error:
            linked.append({
                "id": doc.id,
                "entities": [
                    {
                        "name": entity.name,
                        "url": entity.url,
                        "data_source": entity.data_source,
                        "matches": [
                            {
                                "text": match.text,
                                "confidence": match.confidence_score
                            }
                            for match in entity.matches
                        ]
                    }
                    for entity in doc.entities
                ]
            })

    return linked

# Link entities
text = "Albert Einstein developed the theory of relativity while working at the patent office in Bern, Switzerland."

results = link_entities(client, [text])

for result in results:
    for entity in result['entities']:
        print(f"{entity['name']}")
        print(f"  Wikipedia: {entity['url']}")
        print()
```

## Language Detection

```python
def detect_language(client: TextAnalyticsClient, documents: list) -> list:
    """Detect the language of documents."""

    results = client.detect_language(documents)

    detected = []
    for doc in results:
        if not doc.is_error:
            detected.append({
                "id": doc.id,
                "language": doc.primary_language.name,
                "iso_code": doc.primary_language.iso6391_name,
                "confidence": doc.primary_language.confidence_score
            })

    return detected

# Detect languages
texts = [
    "Hello, how are you doing today?",
    "Bonjour, comment allez-vous?",
    "Hallo, wie geht es Ihnen?",
    "Hola, como estas?",
    "Ciao, come stai?"
]

results = detect_language(client, texts)

for i, result in enumerate(results):
    print(f"'{texts[i][:30]}...'")
    print(f"  Language: {result['language']} ({result['iso_code']})")
    print(f"  Confidence: {result['confidence']:.2f}")
    print()
```

## Batch Processing

```python
from azure.ai.textanalytics import (
    TextDocumentInput,
    RecognizeEntitiesAction,
    ExtractKeyPhrasesAction,
    AnalyzeSentimentAction
)

def analyze_batch(client: TextAnalyticsClient, documents: list) -> dict:
    """Perform multiple analyses in a single request."""

    poller = client.begin_analyze_actions(
        documents,
        actions=[
            RecognizeEntitiesAction(),
            ExtractKeyPhrasesAction(),
            AnalyzeSentimentAction()
        ]
    )

    results = {
        "entities": [],
        "key_phrases": [],
        "sentiment": []
    }

    for page in poller.result():
        for result in page:
            if result.kind == "EntityRecognition":
                for doc in result.document_results:
                    results["entities"].append({
                        "id": doc.id,
                        "entities": [e.text for e in doc.entities]
                    })
            elif result.kind == "KeyPhraseExtraction":
                for doc in result.document_results:
                    results["key_phrases"].append({
                        "id": doc.id,
                        "phrases": doc.key_phrases
                    })
            elif result.kind == "SentimentAnalysis":
                for doc in result.document_results:
                    results["sentiment"].append({
                        "id": doc.id,
                        "sentiment": doc.sentiment
                    })

    return results

# Batch analysis
documents = [
    "Microsoft announced new Azure AI features in Seattle.",
    "The quarterly earnings exceeded analyst expectations.",
    "Customer satisfaction scores improved significantly this quarter."
]

results = analyze_batch(client, documents)
print(results)
```

## Building a Content Analyzer Service

```python
from flask import Flask, request, jsonify

app = Flask(__name__)
client = get_text_analytics_client("your-key", "your-endpoint")

@app.route('/analyze', methods=['POST'])
def analyze():
    """Comprehensive text analysis endpoint."""

    data = request.json
    text = data.get('text', '')
    analyses = data.get('analyses', ['sentiment', 'entities', 'key_phrases'])

    results = {}

    if 'sentiment' in analyses:
        sentiment = client.analyze_sentiment([text])
        results['sentiment'] = sentiment[0].sentiment if not sentiment[0].is_error else None

    if 'entities' in analyses:
        entities = client.recognize_entities([text])
        results['entities'] = [
            {"text": e.text, "category": e.category}
            for e in entities[0].entities
        ] if not entities[0].is_error else []

    if 'key_phrases' in analyses:
        phrases = client.extract_key_phrases([text])
        results['key_phrases'] = phrases[0].key_phrases if not phrases[0].is_error else []

    if 'language' in analyses:
        lang = client.detect_language([text])
        results['language'] = lang[0].primary_language.name if not lang[0].is_error else None

    return jsonify(results)

if __name__ == '__main__':
    app.run(port=5000)
```

## Best Practices

1. **Batch Requests**: Process multiple documents together for efficiency
2. **Error Handling**: Always check for errors in responses
3. **Language Hints**: Provide language hints when known
4. **Document Limits**: Stay within 5,120 characters per document
5. **Rate Limiting**: Implement retry logic for throttling
6. **Caching**: Cache results for frequently analyzed content

Text Analytics enables rich understanding of unstructured text, powering applications from customer feedback analysis to content recommendation systems.
