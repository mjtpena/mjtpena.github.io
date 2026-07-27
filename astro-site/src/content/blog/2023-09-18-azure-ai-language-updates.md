---
title: "Azure AI Language Updates: New NLP Capabilities"
author: Michael John Peña
draft: false
date: 2023-09-18
description: "Explore the latest updates to Azure AI Language including improved entity recognition, sentiment analysis, and text analytics capabilities."
tags:
  - Azure
  - NLP
  - Language AI
  - Text Analytics
  - AI

---

I wrote "Azure AI Language Updates: New NLP Capabilities" to share practical, production-minded guidance on this topic.

## Introduction

Azure AI Language (formerly Text Analytics) has received significant updates that enhance natural language understanding capabilities. This post covers the latest features and demonstrates practical implementations.

## New Language API Features

### Unified Language Service Client

```python
import os
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential
from typing import List, Dict, Any

class LanguageAnalyzer:
    def __init__(self):
        self.client = TextAnalyticsClient(
            endpoint=os.getenv("AZURE_LANGUAGE_ENDPOINT"),
            credential=AzureKeyCredential(os.getenv("AZURE_LANGUAGE_KEY"))
        )

    def analyze_sentiment(self, documents: List[str]) -> List[Dict]:
        """Analyze sentiment with opinion mining"""
        response = self.client.analyze_sentiment(
            documents,
            show_opinion_mining=True,
            language="en"
        )

        results = []
        for doc in response:
            if not doc.is_error:
                doc_result = {
                    "sentiment": doc.sentiment,
                    "confidence_scores": {
                        "positive": doc.confidence_scores.positive,
                        "neutral": doc.confidence_scores.neutral,
                        "negative": doc.confidence_scores.negative
                    },
                    "sentences": []
                }

                for sentence in doc.sentences:
                    sent_data = {
                        "text": sentence.text,
                        "sentiment": sentence.sentiment,
                        "opinions": []
                    }

                    # Extract opinion mining results
                    for opinion in sentence.mined_opinions:
                        target = opinion.target
                        assessments = [
                            {
                                "text": a.text,
                                "sentiment": a.sentiment,
                                "confidence": {
                                    "positive": a.confidence_scores.positive,
                                    "negative": a.confidence_scores.negative
                                }
                            }
                            for a in opinion.assessments
                        ]
                        sent_data["opinions"].append({
                            "target": target.text,
                            "assessments": assessments
                        })

                    doc_result["sentences"].append(sent_data)
                results.append(doc_result)
            else:
                results.append({"error": doc.error.message})

        return results

    def extract_entities(self, documents: List[str]) -> List[Dict]:
        """Extract named entities with enhanced recognition"""
        response = self.client.recognize_entities(documents, language="en")

        results = []
        for doc in response:
            if not doc.is_error:
                entities = [
                    {
                        "text": entity.text,
                        "category": entity.category,
                        "subcategory": entity.subcategory,
                        "confidence": entity.confidence_score,
                        "offset": entity.offset,
                        "length": entity.length
                    }
                    for entity in doc.entities
                ]
                results.append({"entities": entities})
            else:
                results.append({"error": doc.error.message})

        return results

    def extract_key_phrases(self, documents: List[str]) -> List[Dict]:
        """Extract key phrases from documents"""
        response = self.client.extract_key_phrases(documents, language="en")

        results = []
        for doc in response:
            if not doc.is_error:
                results.append({"key_phrases": doc.key_phrases})
            else:
                results.append({"error": doc.error.message})

        return results

    def detect_language(self, documents: List[str]) -> List[Dict]:
        """Detect language of documents"""
        response = self.client.detect_language(documents)

        results = []
        for doc in response:
            if not doc.is_error:
                results.append({
                    "language": doc.primary_language.name,
                    "iso_code": doc.primary_language.iso6391_name,
                    "confidence": doc.primary_language.confidence_score
                })
            else:
                results.append({"error": doc.error.message})

        return results

# Usage
analyzer = LanguageAnalyzer()

texts = [
    "The hotel room was spacious but the service was disappointing.",
    "Azure AI Language provides excellent NLP capabilities."
]

# Sentiment with opinion mining
sentiment = analyzer.analyze_sentiment(texts)
for i, result in enumerate(sentiment):
    print(f"Document {i+1}: {result['sentiment']}")
    for sent in result.get('sentences', []):
        for opinion in sent.get('opinions', []):
            print(f"  - {opinion['target']}: {opinion['assessments']}")

# Entity extraction
entities = analyzer.extract_entities(texts)
for i, result in enumerate(entities):
    print(f"Document {i+1} entities:")
    for entity in result.get('entities', []):
        print(f"  - {entity['text']} ({entity['category']}): {entity['confidence']:.2%}")
```

### Linked Entity Recognition

```python
class EntityLinker:
    """Link entities to knowledge bases"""

    def __init__(self, analyzer: LanguageAnalyzer):
        self.client = analyzer.client

    def link_entities(self, documents: List[str]) -> List[Dict]:
        """Link entities to Wikipedia/knowledge base"""
        response = self.client.recognize_linked_entities(documents, language="en")

        results = []
        for doc in response:
            if not doc.is_error:
                linked_entities = []
                for entity in doc.entities:
                    linked_entities.append({
                        "name": entity.name,
                        "data_source": entity.data_source,
                        "url": entity.url,
                        "data_source_entity_id": entity.data_source_entity_id,
                        "matches": [
                            {
                                "text": match.text,
                                "confidence": match.confidence_score,
                                "offset": match.offset
                            }
                            for match in entity.matches
                        ]
                    })
                results.append({"linked_entities": linked_entities})
            else:
                results.append({"error": doc.error.message})

        return results

    def enrich_with_knowledge(self, text: str) -> Dict:
        """Enrich text with knowledge base information"""
        linked = self.link_entities([text])[0]

        enriched = {
            "original_text": text,
            "entities": []
        }

        for entity in linked.get("linked_entities", []):
            enriched["entities"].append({
                "name": entity["name"],
                "wikipedia_url": entity["url"],
                "mentions": [m["text"] for m in entity["matches"]]
            })

        return enriched

# Usage
linker = EntityLinker(analyzer)
result = linker.enrich_with_knowledge(
    "Microsoft CEO Satya Nadella announced new Azure AI features in Seattle."
)

for entity in result["entities"]:
    print(f"{entity['name']}: {entity['wikipedia_url']}")
```

### PII Detection and Redaction

```python
class PIIDetector:
    """Detect and redact personally identifiable information"""

    def __init__(self, analyzer: LanguageAnalyzer):
        self.client = analyzer.client

    def detect_pii(
        self,
        documents: List[str],
        categories: List[str] = None
    ) -> List[Dict]:
        """Detect PII entities in documents"""
        kwargs = {"language": "en"}
        if categories:
            kwargs["categories_filter"] = categories

        response = self.client.recognize_pii_entities(documents, **kwargs)

        results = []
        for doc in response:
            if not doc.is_error:
                pii_entities = [
                    {
                        "text": entity.text,
                        "category": entity.category,
                        "subcategory": entity.subcategory,
                        "confidence": entity.confidence_score,
                        "offset": entity.offset,
                        "length": entity.length
                    }
                    for entity in doc.entities
                ]
                results.append({
                    "pii_entities": pii_entities,
                    "redacted_text": doc.redacted_text
                })
            else:
                results.append({"error": doc.error.message})

        return results

    def redact_document(
        self,
        text: str,
        categories: List[str] = None,
        replacement: str = "[REDACTED]"
    ) -> str:
        """Redact PII from document with custom replacement"""
        result = self.detect_pii([text], categories)[0]

        if "error" in result:
            return text

        # Sort entities by offset in reverse order for safe replacement
        entities = sorted(
            result["pii_entities"],
            key=lambda x: x["offset"],
            reverse=True
        )

        redacted = text
        for entity in entities:
            start = entity["offset"]
            end = start + entity["length"]
            category_tag = f"[{entity['category']}]" if replacement == "[REDACTED]" else replacement
            redacted = redacted[:start] + category_tag + redacted[end:]

        return redacted

    def get_pii_summary(self, documents: List[str]) -> Dict:
        """Get summary of PII found across documents"""
        results = self.detect_pii(documents)

        summary = {
            "total_documents": len(documents),
            "documents_with_pii": 0,
            "pii_by_category": {},
            "high_risk_documents": []
        }

        high_risk_categories = ["SSN", "CreditCardNumber", "BankAccountNumber"]

        for i, result in enumerate(results):
            if "error" not in result and result["pii_entities"]:
                summary["documents_with_pii"] += 1

                has_high_risk = False
                for entity in result["pii_entities"]:
                    category = entity["category"]
                    summary["pii_by_category"][category] = summary["pii_by_category"].get(category, 0) + 1

                    if category in high_risk_categories:
                        has_high_risk = True

                if has_high_risk:
                    summary["high_risk_documents"].append(i)

        return summary

# Usage
pii_detector = PIIDetector(analyzer)

text = "Contact John Smith at john.smith@email.com or call 555-123-4567. SSN: 123-45-6789"

# Detect PII
result = pii_detector.detect_pii([text])[0]
print(f"Redacted: {result['redacted_text']}")

# Custom redaction
redacted = pii_detector.redact_document(text)
print(f"Custom redacted: {redacted}")

# Get summary
texts = [
    "Email me at user@example.com",
    "My SSN is 123-45-6789 and credit card is 4111-1111-1111-1111",
    "Call 555-0100 for support"
]
summary = pii_detector.get_pii_summary(texts)
print(f"PII Summary: {summary}")
```

### Healthcare Entity Extraction

```python
class HealthcareAnalyzer:
    """Analyze healthcare/medical text"""

    def __init__(self):
        self.client = TextAnalyticsClient(
            endpoint=os.getenv("AZURE_LANGUAGE_ENDPOINT"),
            credential=AzureKeyCredential(os.getenv("AZURE_LANGUAGE_KEY"))
        )

    def analyze_healthcare_text(self, documents: List[str]) -> List[Dict]:
        """Extract healthcare entities and relationships"""
        poller = self.client.begin_analyze_healthcare_entities(documents)
        result = poller.result()

        results = []
        for doc in result:
            if not doc.is_error:
                entities = []
                for entity in doc.entities:
                    entity_data = {
                        "text": entity.text,
                        "category": entity.category,
                        "subcategory": entity.subcategory,
                        "confidence": entity.confidence_score,
                        "normalized_text": entity.normalized_text,
                        "data_sources": [
                            {"name": ds.name, "entity_id": ds.entity_id}
                            for ds in (entity.data_sources or [])
                        ]
                    }
                    entities.append(entity_data)

                # Extract entity relations
                relations = []
                for relation in doc.entity_relations:
                    relations.append({
                        "relation_type": relation.relation_type,
                        "roles": [
                            {"name": role.name, "entity": role.entity.text}
                            for role in relation.roles
                        ]
                    })

                results.append({
                    "entities": entities,
                    "relations": relations
                })
            else:
                results.append({"error": doc.error.message})

        return results

    def extract_medical_codes(self, text: str) -> Dict:
        """Extract medical codes (ICD, SNOMED, etc.)"""
        result = self.analyze_healthcare_text([text])[0]

        codes = {
            "conditions": [],
            "medications": [],
            "procedures": [],
            "measurements": []
        }

        category_mapping = {
            "Diagnosis": "conditions",
            "SymptomOrSign": "conditions",
            "MedicationName": "medications",
            "TreatmentName": "procedures",
            "MeasurementValue": "measurements"
        }

        for entity in result.get("entities", []):
            category = entity["category"]
            target_list = category_mapping.get(category)

            if target_list:
                codes[target_list].append({
                    "text": entity["text"],
                    "normalized": entity.get("normalized_text"),
                    "codes": entity.get("data_sources", [])
                })

        return codes

# Usage
healthcare = HealthcareAnalyzer()

medical_text = """
Patient presents with type 2 diabetes mellitus and hypertension.
Current medications include metformin 500mg twice daily and lisinopril 10mg daily.
Blood pressure reading: 140/90 mmHg. HbA1c level: 7.2%.
"""

result = healthcare.analyze_healthcare_text([medical_text])[0]

print("Healthcare Entities:")
for entity in result["entities"]:
    print(f"  {entity['text']} ({entity['category']})")
    if entity["data_sources"]:
        for ds in entity["data_sources"]:
            print(f"    - {ds['name']}: {ds['entity_id']}")
```

## Batch Processing for Large Documents

```python
from concurrent.futures import ThreadPoolExecutor
from typing import Generator

class BatchProcessor:
    """Process large document collections efficiently"""

    def __init__(self, analyzer: LanguageAnalyzer, batch_size: int = 25):
        self.analyzer = analyzer
        self.batch_size = batch_size  # API limit is typically 25

    def process_in_batches(
        self,
        documents: List[str],
        operation: str
    ) -> Generator[Dict, None, None]:
        """Process documents in batches"""
        operations = {
            "sentiment": self.analyzer.analyze_sentiment,
            "entities": self.analyzer.extract_entities,
            "key_phrases": self.analyzer.extract_key_phrases,
            "language": self.analyzer.detect_language
        }

        if operation not in operations:
            raise ValueError(f"Unknown operation: {operation}")

        func = operations[operation]

        for i in range(0, len(documents), self.batch_size):
            batch = documents[i:i + self.batch_size]
            results = func(batch)

            for j, result in enumerate(results):
                yield {
                    "index": i + j,
                    "result": result
                }

    def parallel_analysis(
        self,
        documents: List[str],
        operations: List[str],
        max_workers: int = 4
    ) -> Dict[str, List]:
        """Run multiple operations in parallel"""
        results = {op: [] for op in operations}

        def process_operation(operation: str):
            op_results = list(self.process_in_batches(documents, operation))
            return operation, op_results

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(process_operation, op) for op in operations]

            for future in futures:
                operation, op_results = future.result()
                results[operation] = op_results

        return results

# Usage
processor = BatchProcessor(analyzer)

# Process large document set
large_docs = ["Document text..."] * 100

for result in processor.process_in_batches(large_docs, "sentiment"):
    print(f"Doc {result['index']}: {result['result'].get('sentiment', 'N/A')}")

# Parallel multi-operation analysis
all_results = processor.parallel_analysis(
    large_docs[:10],
    ["sentiment", "entities", "key_phrases"]
)
```

## Conclusion

Azure AI Language provides comprehensive NLP capabilities for text analysis, from sentiment and entity extraction to PII detection and healthcare text understanding. The unified API makes it easy to integrate multiple language understanding features into applications, while batch processing enables efficient handling of large document collections.

