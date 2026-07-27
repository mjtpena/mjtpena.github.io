---
title: Building Sentiment Analysis Solutions with Azure
author: Michael John Pena
draft: false
date: 2021-09-18
tags:
  - Azure
  - Sentiment Analysis
  - NLP
  - Customer Analytics
  - AI

---

I wrote "2021-09-18-azure-sentiment-analysis" to share practical, production-minded guidance on this topic.

## Understanding Sentiment Analysis

Azure's sentiment analysis provides:
- **Document-level sentiment**: Overall sentiment of the text
- **Sentence-level sentiment**: Sentiment per sentence
- **Opinion mining**: Sentiment for specific aspects/targets
- **Confidence scores**: Probability distribution across sentiments

## Basic Sentiment Analysis

```python
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential

def create_client(key: str, endpoint: str) -> TextAnalyticsClient:
    return TextAnalyticsClient(
        endpoint=endpoint,
        credential=AzureKeyCredential(key)
    )

def analyze_sentiment_basic(client: TextAnalyticsClient, texts: list) -> list:
    """Basic sentiment analysis."""

    results = client.analyze_sentiment(texts)

    analysis = []
    for doc in results:
        if not doc.is_error:
            analysis.append({
                "text": texts[doc.id] if isinstance(texts[0], str) else texts[int(doc.id)],
                "sentiment": doc.sentiment,
                "positive": doc.confidence_scores.positive,
                "neutral": doc.confidence_scores.neutral,
                "negative": doc.confidence_scores.negative
            })

    return analysis

client = create_client("your-key", "your-endpoint")

reviews = [
    "This product is absolutely amazing! Best purchase ever.",
    "The quality is okay but nothing special.",
    "Worst experience of my life. Complete waste of money.",
    "Good product but shipping was slow."
]

results = analyze_sentiment_basic(client, reviews)

for r in results:
    print(f"'{r['text'][:50]}...'")
    print(f"  Sentiment: {r['sentiment']}")
    print(f"  Scores: +{r['positive']:.2f} o{r['neutral']:.2f} -{r['negative']:.2f}")
    print()
```

## Opinion Mining (Aspect-Based Sentiment)

```python
def analyze_with_opinion_mining(client: TextAnalyticsClient, texts: list) -> list:
    """Sentiment analysis with opinion mining."""

    results = client.analyze_sentiment(texts, show_opinion_mining=True)

    analysis = []
    for doc in results:
        if doc.is_error:
            continue

        doc_analysis = {
            "overall_sentiment": doc.sentiment,
            "sentences": []
        }

        for sentence in doc.sentences:
            sentence_analysis = {
                "text": sentence.text,
                "sentiment": sentence.sentiment,
                "opinions": []
            }

            for opinion in sentence.mined_opinions:
                target = opinion.target
                assessments = []

                for assessment in opinion.assessments:
                    assessments.append({
                        "text": assessment.text,
                        "sentiment": assessment.sentiment,
                        "confidence": {
                            "positive": assessment.confidence_scores.positive,
                            "negative": assessment.confidence_scores.negative
                        }
                    })

                sentence_analysis["opinions"].append({
                    "target": target.text,
                    "target_sentiment": target.sentiment,
                    "assessments": assessments
                })

            doc_analysis["sentences"].append(sentence_analysis)

        analysis.append(doc_analysis)

    return analysis

# Analyze hotel review with opinion mining
hotel_review = """
The hotel room was spacious and clean with an amazing view of the city.
The bed was extremely comfortable and I slept like a baby.
However, the WiFi was painfully slow and the breakfast buffet was disappointing.
The staff was friendly and helpful throughout my stay.
"""

results = analyze_with_opinion_mining(client, [hotel_review])

for result in results:
    print(f"Overall: {result['overall_sentiment']}\n")
    for sentence in result['sentences']:
        if sentence['opinions']:
            print(f"Sentence: {sentence['text']}")
            for opinion in sentence['opinions']:
                print(f"  Target: {opinion['target']} ({opinion['target_sentiment']})")
                for assessment in opinion['assessments']:
                    print(f"    - {assessment['text']}: {assessment['sentiment']}")
            print()
```

## Building a Review Analytics Dashboard

```python
from collections import defaultdict
import pandas as pd

class ReviewAnalytics:
    def __init__(self, client: TextAnalyticsClient):
        self.client = client

    def analyze_reviews(self, reviews: list) -> dict:
        """Comprehensive review analysis."""

        results = self.client.analyze_sentiment(
            reviews,
            show_opinion_mining=True
        )

        analytics = {
            "total_reviews": len(reviews),
            "sentiment_distribution": defaultdict(int),
            "aspect_sentiment": defaultdict(lambda: {"positive": 0, "negative": 0, "neutral": 0}),
            "common_issues": [],
            "common_praise": []
        }

        for doc in results:
            if doc.is_error:
                continue

            # Count overall sentiment
            analytics["sentiment_distribution"][doc.sentiment] += 1

            # Extract aspect sentiments
            for sentence in doc.sentences:
                for opinion in sentence.mined_opinions:
                    target = opinion.target.text.lower()
                    sentiment = opinion.target.sentiment

                    analytics["aspect_sentiment"][target][sentiment] += 1

                    # Track specific feedback
                    for assessment in opinion.assessments:
                        feedback = {
                            "target": target,
                            "assessment": assessment.text,
                            "sentiment": assessment.sentiment
                        }
                        if assessment.sentiment == "negative":
                            analytics["common_issues"].append(feedback)
                        elif assessment.sentiment == "positive":
                            analytics["common_praise"].append(feedback)

        return analytics

    def generate_report(self, reviews: list) -> str:
        """Generate a text report of review analytics."""

        analytics = self.analyze_reviews(reviews)

        report = []
        report.append(f"=== Review Analysis Report ===\n")
        report.append(f"Total Reviews Analyzed: {analytics['total_reviews']}\n")

        report.append("\nSentiment Distribution:")
        for sentiment, count in analytics['sentiment_distribution'].items():
            pct = count / analytics['total_reviews'] * 100
            report.append(f"  {sentiment}: {count} ({pct:.1f}%)")

        report.append("\n\nAspect Sentiment Summary:")
        for aspect, sentiments in analytics['aspect_sentiment'].items():
            total = sum(sentiments.values())
            if total >= 2:  # Only show aspects mentioned multiple times
                pos_pct = sentiments['positive'] / total * 100
                neg_pct = sentiments['negative'] / total * 100
                report.append(f"  {aspect}: +{pos_pct:.0f}% / -{neg_pct:.0f}%")

        return "\n".join(report)

# Analyze a batch of reviews
reviews = [
    "The room was clean and spacious. Great location near downtown.",
    "Bed was uncomfortable and the AC didn't work properly. Terrible experience.",
    "Friendly staff and excellent breakfast. Will definitely come back!",
    "Overpriced for what you get. The pool was closed and WiFi was slow.",
    "Perfect stay! The view was breathtaking and room service was quick.",
    "Parking was expensive and the elevator was always broken.",
    "Loved the spa and the restaurant. Room could use some updating.",
    "Worst hotel ever. Dirty bathroom and rude staff at reception."
]

analyzer = ReviewAnalytics(client)
report = analyzer.generate_report(reviews)
print(report)
```

## Real-Time Sentiment Streaming

```python
from azure.ai.textanalytics import TextAnalyticsClient
import asyncio
from collections import deque

class SentimentMonitor:
    def __init__(self, client: TextAnalyticsClient, window_size: int = 100):
        self.client = client
        self.window_size = window_size
        self.sentiment_window = deque(maxlen=window_size)
        self.alerts = []

    def process_text(self, text: str) -> dict:
        """Process a single text and update metrics."""

        result = self.client.analyze_sentiment([text])

        if result[0].is_error:
            return {"error": result[0].error.message}

        sentiment_data = {
            "text": text[:100],
            "sentiment": result[0].sentiment,
            "negative_score": result[0].confidence_scores.negative
        }

        self.sentiment_window.append(sentiment_data)

        # Check for alerts
        if sentiment_data["negative_score"] > 0.9:
            self.alerts.append({
                "type": "high_negativity",
                "text": text,
                "score": sentiment_data["negative_score"]
            })

        return sentiment_data

    def get_current_metrics(self) -> dict:
        """Get current sentiment metrics."""

        if not self.sentiment_window:
            return {"status": "no data"}

        sentiments = [s["sentiment"] for s in self.sentiment_window]

        return {
            "window_size": len(self.sentiment_window),
            "positive_rate": sentiments.count("positive") / len(sentiments),
            "negative_rate": sentiments.count("negative") / len(sentiments),
            "neutral_rate": sentiments.count("neutral") / len(sentiments),
            "recent_alerts": len(self.alerts)
        }

# Simulate streaming analysis
monitor = SentimentMonitor(client)

incoming_texts = [
    "Great product, highly recommend!",
    "This is acceptable.",
    "Absolutely terrible, want my money back!",
    "Nice features, good value.",
    "Broken on arrival, very disappointed."
]

for text in incoming_texts:
    result = monitor.process_text(text)
    metrics = monitor.get_current_metrics()
    print(f"Processed: {result['sentiment']}")
    print(f"Current negative rate: {metrics['negative_rate']:.1%}")
    print()
```

## Multi-Language Sentiment Analysis

```python
def analyze_multilingual_sentiment(client: TextAnalyticsClient, documents: list) -> list:
    """Analyze sentiment across multiple languages."""

    # Documents with language hints
    docs_with_hints = [
        {"id": str(i), "text": doc["text"], "language": doc.get("language", "")}
        for i, doc in enumerate(documents)
    ]

    results = client.analyze_sentiment(docs_with_hints)

    analysis = []
    for i, doc in enumerate(results):
        if not doc.is_error:
            analysis.append({
                "text": documents[i]["text"],
                "detected_language": documents[i].get("language", "auto"),
                "sentiment": doc.sentiment,
                "confidence": max(
                    doc.confidence_scores.positive,
                    doc.confidence_scores.neutral,
                    doc.confidence_scores.negative
                )
            })

    return analysis

# Multilingual reviews
multilingual_reviews = [
    {"text": "This product is fantastic!", "language": "en"},
    {"text": "Ce produit est fantastique!", "language": "fr"},
    {"text": "Este producto es fantastico!", "language": "es"},
    {"text": "Dieses Produkt ist schrecklich.", "language": "de"},
]

results = analyze_multilingual_sentiment(client, multilingual_reviews)

for r in results:
    print(f"{r['detected_language']}: {r['sentiment']} ({r['confidence']:.2f})")
```

## Best Practices

1. **Batch Processing**: Analyze multiple documents together
2. **Opinion Mining**: Enable for product/service reviews
3. **Context Matters**: Consider domain-specific language
4. **Threshold Setting**: Define actionable sentiment thresholds
5. **Trend Analysis**: Track sentiment over time
6. **Action Integration**: Connect insights to business processes

Sentiment analysis transforms unstructured feedback into actionable insights, enabling data-driven decisions about products, services, and customer experience.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
