---
title: Extracting Key Phrases from Text with Azure Cognitive Services
description: "Key phrase extraction is a foundational NLP capability that enables efficient processing of large text collections and powers intelligent content management…"
author: Michael John Pena
draft: false
date: 2021-09-19
tags:
  - Azure
  - Cognitive Services
  - NLP
  - Text Mining
  - AI
---

## Use Cases for Key Phrase Extraction

- **Content Summarization**: Quick overview of documents
- **Topic Modeling**: Identify themes across document sets
- **SEO Optimization**: Extract relevant keywords
- **Customer Feedback**: Find common topics in reviews
- **Research Analysis**: Categorize academic papers

## Basic Key Phrase Extraction

```python
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential

def create_client(key: str, endpoint: str) -> TextAnalyticsClient:
    return TextAnalyticsClient(
        endpoint=endpoint,
        credential=AzureKeyCredential(key)
    )

def extract_key_phrases(client: TextAnalyticsClient, documents: list) -> list:
    """Extract key phrases from documents."""

    results = client.extract_key_phrases(documents)

    extracted = []
    for doc in results:
        if not doc.is_error:
            extracted.append({
                "key_phrases": doc.key_phrases,
                "count": len(doc.key_phrases)
            })
        else:
            extracted.append({"error": doc.error.message})

    return extracted

client = create_client("your-key", "your-endpoint")

# Extract from a product description
product_description = """
The new MacBook Pro features Apple's revolutionary M1 chip,
delivering breakthrough performance and battery life. With up to
20 hours of battery life, the fastest SSD, and a stunning Retina display,
this laptop is perfect for professionals who demand the best.
Active cooling system ensures optimal performance during intensive tasks.
"""

result = extract_key_phrases(client, [product_description])
print("Key phrases:", result[0]["key_phrases"])
```

## Building a Document Summarizer

```python
from collections import Counter

class DocumentSummarizer:
    def __init__(self, client: TextAnalyticsClient):
        self.client = client

    def summarize_document(self, text: str, max_phrases: int = 10) -> dict:
        """Extract key information from a document."""

        # Split into chunks if too long (5120 char limit)
        chunks = self._split_text(text, max_length=5000)

        all_phrases = []
        for chunk in chunks:
            results = self.client.extract_key_phrases([chunk])
            if not results[0].is_error:
                all_phrases.extend(results[0].key_phrases)

        # Deduplicate and rank
        phrase_counts = Counter(all_phrases)
        top_phrases = phrase_counts.most_common(max_phrases)

        return {
            "top_phrases": [p[0] for p in top_phrases],
            "phrase_frequency": dict(top_phrases),
            "total_unique_phrases": len(phrase_counts)
        }

    def _split_text(self, text: str, max_length: int = 5000) -> list:
        """Split text into chunks at sentence boundaries."""

        if len(text) <= max_length:
            return [text]

        sentences = text.replace('\n', ' ').split('. ')
        chunks = []
        current_chunk = ""

        for sentence in sentences:
            if len(current_chunk) + len(sentence) + 2 <= max_length:
                current_chunk += sentence + ". "
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = sentence + ". "

        if current_chunk:
            chunks.append(current_chunk.strip())

        return chunks

    def compare_documents(self, documents: list) -> dict:
        """Find common and unique themes across documents."""

        all_doc_phrases = []

        for doc in documents:
            result = self.summarize_document(doc)
            all_doc_phrases.append(set(result["top_phrases"]))

        # Find common phrases
        if all_doc_phrases:
            common = set.intersection(*all_doc_phrases)
        else:
            common = set()

        # Find unique phrases per document
        unique_per_doc = []
        for i, phrases in enumerate(all_doc_phrases):
            others = set.union(*[p for j, p in enumerate(all_doc_phrases) if j != i]) if len(all_doc_phrases) > 1 else set()
            unique_per_doc.append(phrases - others)

        return {
            "common_themes": list(common),
            "unique_per_document": [list(u) for u in unique_per_doc]
        }

# Example: Summarize multiple articles
summarizer = DocumentSummarizer(client)

articles = [
    """
    Artificial intelligence is transforming healthcare through
    improved diagnostics and personalized treatment plans. Machine
    learning algorithms can analyze medical images with accuracy
    rivaling human experts. Drug discovery is being accelerated
    through AI-powered molecular simulation.
    """,
    """
    The healthcare industry is adopting cloud computing for
    better data management and collaboration. Electronic health
    records stored in the cloud improve patient care coordination.
    Telemedicine platforms enable remote consultations and monitoring.
    """
]

comparison = summarizer.compare_documents(articles)
print("Common themes:", comparison["common_themes"])
for i, unique in enumerate(comparison["unique_per_document"]):
    print(f"Article {i+1} unique themes:", unique)
```

## Automatic Tagging System

```python
class ContentTagger:
    def __init__(self, client: TextAnalyticsClient):
        self.client = client
        self.tag_categories = {
            "technology": ["software", "technology", "digital", "computing", "data", "ai", "machine learning"],
            "business": ["business", "company", "market", "revenue", "growth", "strategy"],
            "finance": ["financial", "investment", "stock", "trading", "banking", "money"],
            "health": ["health", "medical", "healthcare", "treatment", "patient", "disease"]
        }

    def generate_tags(self, text: str) -> dict:
        """Generate tags for content."""

        results = self.client.extract_key_phrases([text])

        if results[0].is_error:
            return {"error": results[0].error.message}

        phrases = [p.lower() for p in results[0].key_phrases]

        # Match to categories
        matched_categories = []
        for category, keywords in self.tag_categories.items():
            for phrase in phrases:
                if any(kw in phrase for kw in keywords):
                    matched_categories.append(category)
                    break

        return {
            "extracted_phrases": results[0].key_phrases[:10],
            "suggested_categories": list(set(matched_categories)),
            "auto_tags": results[0].key_phrases[:5]
        }

    def bulk_tag(self, documents: list) -> list:
        """Tag multiple documents."""

        results = self.client.extract_key_phrases(documents)

        tagged = []
        for i, doc in enumerate(results):
            if not doc.is_error:
                phrases = [p.lower() for p in doc.key_phrases]

                # Simple category matching
                categories = []
                for category, keywords in self.tag_categories.items():
                    if any(any(kw in p for kw in keywords) for p in phrases):
                        categories.append(category)

                tagged.append({
                    "document_index": i,
                    "tags": doc.key_phrases[:5],
                    "categories": categories
                })
            else:
                tagged.append({"document_index": i, "error": doc.error.message})

        return tagged

# Tag blog posts
tagger = ContentTagger(client)

blog_posts = [
    "Machine learning models are being deployed in production environments using MLOps practices.",
    "The company reported strong quarterly earnings, exceeding analyst expectations.",
    "New research shows promising results for cancer treatment using immunotherapy."
]

for i, post in enumerate(blog_posts):
    tags = tagger.generate_tags(post)
    print(f"Post {i+1}:")
    print(f"  Tags: {tags['auto_tags']}")
    print(f"  Categories: {tags['suggested_categories']}")
    print()
```

## Topic Clustering

```python
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import KMeans
import numpy as np

class TopicClusterer:
    def __init__(self, client: TextAnalyticsClient, n_clusters: int = 5):
        self.client = client
        self.n_clusters = n_clusters

    def extract_all_phrases(self, documents: list) -> list:
        """Extract phrases from all documents."""

        results = self.client.extract_key_phrases(documents)

        phrases_per_doc = []
        for doc in results:
            if not doc.is_error:
                phrases_per_doc.append(" ".join(doc.key_phrases))
            else:
                phrases_per_doc.append("")

        return phrases_per_doc

    def cluster_documents(self, documents: list) -> dict:
        """Cluster documents by their key phrases."""

        # Extract phrases
        phrase_strings = self.extract_all_phrases(documents)

        # Vectorize
        vectorizer = TfidfVectorizer(max_features=100)
        tfidf_matrix = vectorizer.fit_transform(phrase_strings)

        # Cluster
        kmeans = KMeans(n_clusters=min(self.n_clusters, len(documents)))
        clusters = kmeans.fit_predict(tfidf_matrix)

        # Get top terms per cluster
        order_centroids = kmeans.cluster_centers_.argsort()[:, ::-1]
        terms = vectorizer.get_feature_names_out()

        cluster_topics = {}
        for i in range(kmeans.n_clusters):
            top_terms = [terms[ind] for ind in order_centroids[i, :5]]
            cluster_topics[i] = top_terms

        # Group documents
        document_clusters = {}
        for i, cluster in enumerate(clusters):
            if cluster not in document_clusters:
                document_clusters[cluster] = []
            document_clusters[cluster].append(i)

        return {
            "cluster_topics": cluster_topics,
            "document_clusters": document_clusters,
            "cluster_labels": clusters.tolist()
        }

# Cluster news articles
clusterer = TopicClusterer(client, n_clusters=3)

news_articles = [
    "Apple announces new iPhone with improved camera and battery life.",
    "Microsoft releases Windows 11 with new design and features.",
    "Tesla reports record vehicle deliveries in Q3.",
    "Google updates search algorithm to prioritize helpful content.",
    "Amazon expands AWS services with new AI capabilities.",
    "Ford announces plans for electric vehicle factory."
]

clusters = clusterer.cluster_documents(news_articles)

print("Cluster Topics:")
for cluster_id, topics in clusters["cluster_topics"].items():
    print(f"  Cluster {cluster_id}: {topics}")
    doc_indices = clusters["document_clusters"].get(cluster_id, [])
    for idx in doc_indices:
        print(f"    - {news_articles[idx][:50]}...")
```

## Best Practices

1. **Text Length**: Keep documents under 5,120 characters
2. **Clean Input**: Remove boilerplate text and formatting
3. **Batch Processing**: Send multiple documents together
4. **Post-Processing**: Filter common/stop words if needed
5. **Domain Adaptation**: Consider custom terminology
6. **Combine Techniques**: Use with sentiment and NER for richer insights

Key phrase extraction is a foundational NLP capability that enables efficient processing of large text collections and powers intelligent content management systems.
