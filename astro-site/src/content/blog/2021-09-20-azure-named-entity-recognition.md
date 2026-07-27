---
title: Named Entity Recognition with Azure Cognitive Services
author: Michael John Pena
draft: false
date: 2021-09-20
tags:
  - Azure
  - Cognitive Services
  - NER
  - NLP
  - Information Extraction

---

I wrote "2021-09-20-azure-named-entity-recognition" to share practical, production-minded guidance on this topic.

## Entity Categories

Azure NER recognizes these entity types:
- **Person**: Names of people
- **Organization**: Companies, institutions
- **Location**: Places, addresses, geopolitical entities
- **DateTime**: Dates, times, durations
- **Quantity**: Numbers, percentages, measurements
- **Email, URL, Phone**: Contact information
- **Product**: Named products
- **Event**: Named events

## Basic Entity Recognition

```python
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential

def create_client(key: str, endpoint: str) -> TextAnalyticsClient:
    return TextAnalyticsClient(
        endpoint=endpoint,
        credential=AzureKeyCredential(key)
    )

def recognize_entities(client: TextAnalyticsClient, documents: list) -> list:
    """Recognize named entities in documents."""

    results = client.recognize_entities(documents)

    recognized = []
    for doc in results:
        if not doc.is_error:
            entities = []
            for entity in doc.entities:
                entities.append({
                    "text": entity.text,
                    "category": entity.category,
                    "subcategory": entity.subcategory,
                    "confidence": entity.confidence_score,
                    "offset": entity.offset,
                    "length": entity.length
                })
            recognized.append({"entities": entities})
        else:
            recognized.append({"error": doc.error.message})

    return recognized

client = create_client("your-key", "your-endpoint")

# Extract entities from news article
news_article = """
Microsoft CEO Satya Nadella announced on Tuesday that the company
will invest $20 billion in cybersecurity over the next five years.
The announcement was made at the company's headquarters in Redmond,
Washington. This follows Microsoft's acquisition of Nuance Communications
for $19.7 billion earlier this year.
"""

result = recognize_entities(client, [news_article])

print("Entities found:")
for entity in result[0]["entities"]:
    print(f"  {entity['text']}")
    print(f"    Type: {entity['category']}", end="")
    if entity['subcategory']:
        print(f" / {entity['subcategory']}", end="")
    print(f" (confidence: {entity['confidence']:.2f})")
```

## Entity Linking to Wikipedia

```python
def link_entities(client: TextAnalyticsClient, documents: list) -> list:
    """Link entities to Wikipedia entries."""

    results = client.recognize_linked_entities(documents)

    linked = []
    for doc in results:
        if not doc.is_error:
            entities = []
            for entity in doc.entities:
                entities.append({
                    "name": entity.name,
                    "wikipedia_url": entity.url,
                    "data_source": entity.data_source,
                    "wikipedia_id": entity.data_source_entity_id,
                    "matches": [
                        {
                            "text": match.text,
                            "confidence": match.confidence_score,
                            "offset": match.offset
                        }
                        for match in entity.matches
                    ]
                })
            linked.append({"entities": entities})
        else:
            linked.append({"error": doc.error.message})

    return linked

# Link entities to knowledge base
text = """
Albert Einstein developed the theory of relativity while working
in Bern, Switzerland. He later joined Princeton University in
New Jersey, where he continued his research in physics.
"""

result = link_entities(client, [text])

print("Linked Entities:")
for entity in result[0]["entities"]:
    print(f"\n{entity['name']}")
    print(f"  Wikipedia: {entity['wikipedia_url']}")
    for match in entity['matches']:
        print(f"  Mention: '{match['text']}' (confidence: {match['confidence']:.2f})")
```

## Building an Information Extractor

```python
from collections import defaultdict

class InformationExtractor:
    def __init__(self, client: TextAnalyticsClient):
        self.client = client

    def extract_structured_info(self, text: str) -> dict:
        """Extract structured information from text."""

        # Get entities
        ner_results = self.client.recognize_entities([text])
        linked_results = self.client.recognize_linked_entities([text])

        info = {
            "people": [],
            "organizations": [],
            "locations": [],
            "dates": [],
            "quantities": [],
            "products": [],
            "events": [],
            "wikipedia_links": {}
        }

        # Process NER results
        if not ner_results[0].is_error:
            for entity in ner_results[0].entities:
                if entity.category == "Person":
                    info["people"].append(entity.text)
                elif entity.category == "Organization":
                    info["organizations"].append(entity.text)
                elif entity.category == "Location":
                    info["locations"].append(entity.text)
                elif entity.category == "DateTime":
                    info["dates"].append(entity.text)
                elif entity.category == "Quantity":
                    info["quantities"].append({
                        "value": entity.text,
                        "type": entity.subcategory
                    })
                elif entity.category == "Product":
                    info["products"].append(entity.text)
                elif entity.category == "Event":
                    info["events"].append(entity.text)

        # Add Wikipedia links
        if not linked_results[0].is_error:
            for entity in linked_results[0].entities:
                info["wikipedia_links"][entity.name] = entity.url

        # Deduplicate
        for key in ["people", "organizations", "locations", "dates", "products", "events"]:
            if isinstance(info[key], list) and info[key] and isinstance(info[key][0], str):
                info[key] = list(set(info[key]))

        return info

    def extract_relationships(self, text: str) -> list:
        """Extract basic relationships between entities."""

        ner_results = self.client.recognize_entities([text])

        if ner_results[0].is_error:
            return []

        entities = ner_results[0].entities

        # Find co-occurring entities (simplified relationship extraction)
        relationships = []
        sentences = text.split('.')

        for sentence in sentences:
            sentence_entities = [
                e for e in entities
                if e.text in sentence
            ]

            # Find person-organization pairs
            persons = [e for e in sentence_entities if e.category == "Person"]
            orgs = [e for e in sentence_entities if e.category == "Organization"]

            for person in persons:
                for org in orgs:
                    relationships.append({
                        "person": person.text,
                        "organization": org.text,
                        "context": sentence.strip()
                    })

        return relationships

# Extract information from news
extractor = InformationExtractor(client)

news = """
Elon Musk, CEO of Tesla and SpaceX, announced on March 15th that Tesla
will accept Bitcoin as payment for vehicles. The announcement caused
Bitcoin to surge 5% to over $55,000. Tesla had previously invested
$1.5 billion in Bitcoin in February. The company is headquartered in
Austin, Texas, after relocating from Palo Alto, California.
"""

info = extractor.extract_structured_info(news)
print("Extracted Information:")
print(f"  People: {info['people']}")
print(f"  Organizations: {info['organizations']}")
print(f"  Locations: {info['locations']}")
print(f"  Dates: {info['dates']}")
print(f"  Quantities: {info['quantities']}")

relationships = extractor.extract_relationships(news)
print("\nRelationships:")
for rel in relationships:
    print(f"  {rel['person']} <-> {rel['organization']}")
```

## PII Detection

```python
def detect_pii(client: TextAnalyticsClient, documents: list) -> list:
    """Detect personally identifiable information."""

    results = client.recognize_pii_entities(documents)

    detected = []
    for doc in results:
        if not doc.is_error:
            pii_entities = []
            for entity in doc.entities:
                pii_entities.append({
                    "text": entity.text,
                    "category": entity.category,
                    "subcategory": entity.subcategory,
                    "confidence": entity.confidence_score
                })
            detected.append({
                "pii_entities": pii_entities,
                "redacted_text": doc.redacted_text
            })
        else:
            detected.append({"error": doc.error.message})

    return detected

# Detect PII in customer data
customer_message = """
Hi, my name is John Smith and I'd like to update my account.
My email is john.smith@email.com and my phone number is 555-123-4567.
My credit card ending in 4242 was charged incorrectly.
Please send correspondence to 123 Main Street, Seattle, WA 98101.
"""

result = detect_pii(client, [customer_message])

print("PII Detected:")
for pii in result[0]["pii_entities"]:
    print(f"  {pii['text']} -> {pii['category']}")

print("\nRedacted Text:")
print(result[0]["redacted_text"])
```

## Building a Document Processor

```python
class DocumentProcessor:
    def __init__(self, client: TextAnalyticsClient):
        self.client = client

    def process_document(self, text: str) -> dict:
        """Full NLP processing of a document."""

        # Batch multiple analyses
        entities = self.client.recognize_entities([text])
        linked = self.client.recognize_linked_entities([text])
        key_phrases = self.client.extract_key_phrases([text])
        sentiment = self.client.analyze_sentiment([text])

        result = {
            "entities": {},
            "linked_entities": [],
            "key_phrases": [],
            "sentiment": None
        }

        # Process entities by category
        if not entities[0].is_error:
            for entity in entities[0].entities:
                category = entity.category
                if category not in result["entities"]:
                    result["entities"][category] = []
                result["entities"][category].append(entity.text)

        # Process linked entities
        if not linked[0].is_error:
            result["linked_entities"] = [
                {"name": e.name, "url": e.url}
                for e in linked[0].entities
            ]

        # Process key phrases
        if not key_phrases[0].is_error:
            result["key_phrases"] = key_phrases[0].key_phrases

        # Process sentiment
        if not sentiment[0].is_error:
            result["sentiment"] = sentiment[0].sentiment

        return result

    def generate_summary(self, text: str) -> str:
        """Generate a structured summary."""

        processed = self.process_document(text)

        summary = []
        summary.append(f"Sentiment: {processed['sentiment']}")

        if processed['entities'].get('Person'):
            summary.append(f"People mentioned: {', '.join(set(processed['entities']['Person']))}")

        if processed['entities'].get('Organization'):
            summary.append(f"Organizations: {', '.join(set(processed['entities']['Organization']))}")

        if processed['entities'].get('Location'):
            summary.append(f"Locations: {', '.join(set(processed['entities']['Location']))}")

        if processed['key_phrases']:
            summary.append(f"Key topics: {', '.join(processed['key_phrases'][:5])}")

        return "\n".join(summary)

# Process a document
processor = DocumentProcessor(client)

article = """
Amazon announced today that Andy Jassy will become CEO, replacing
Jeff Bezos who founded the company in 1994 in Seattle. Under Bezos'
leadership, Amazon grew from an online bookstore to a trillion-dollar
technology giant. Jassy previously led Amazon Web Services (AWS),
which has become the company's most profitable division.
"""

summary = processor.generate_summary(article)
print(summary)
```

## Best Practices

1. **Confidence Thresholds**: Filter low-confidence entities
2. **Context Matters**: Same text can be different entity types
3. **Batch Processing**: Process multiple documents together
4. **Entity Linking**: Use for disambiguation
5. **PII Handling**: Always detect and protect sensitive data
6. **Domain Customization**: Consider custom entity types for specific domains

Named Entity Recognition is essential for extracting structured information from unstructured text, enabling applications from search enhancement to automated data entry.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
