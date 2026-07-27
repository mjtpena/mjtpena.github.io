---
title: "Custom Named Entity Recognition with Azure AI Language"
author: Michael John Peña
draft: false
date: 2023-09-20
description: "Build custom NER models to extract domain-specific entities from text using Azure AI Language."
tags:
  - Azure
  - NLP
  - NER
  - Entity Extraction
  - AI
---

Custom Named Entity Recognition is the Azure AI Language feature I find myself recommending to clients who have domain-specific terminology that the general-purpose NER doesn't handle well. The prebuilt NER model recognises standard entity types — person names, locations, organisations, dates, quantities — but misses the domain-specific entities that matter for a legal firm (contract clause types), a pharmaceutical company (drug names, clinical trial identifiers), or a financial institution (product codes, instrument identifiers). Custom NER lets you define your own entity types, label training examples in Language Studio, and train a model that recognises those types in new documents. The practical consideration: labelling quality matters more than quantity — consistently labelled examples of each entity type produce better models than a large but inconsistently labelled dataset. And custom NER composes with the rest of the Language service: you can run custom NER and sentiment analysis and PII detection in a single Text Analytics call.

## Introduction

While Azure AI Language provides pre-built named entity recognition for common entity types, many domains require extraction of specialized entities unique to their business. Custom NER in Azure AI Language enables training models to recognize domain-specific entities like product names, medical terms, legal clauses, or any custom category.

## Custom NER Architecture

### Entity Schema Design

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from enum import Enum

class EntityType(Enum):
    SIMPLE = "simple"
    COMPOSITE = "composite"
    HIERARCHICAL = "hierarchical"

@dataclass
class EntityDefinition:
    name: str
    description: str
    entity_type: EntityType = EntityType.SIMPLE
    examples: List[str] = field(default_factory=list)
    subentities: List['EntityDefinition'] = field(default_factory=list)

@dataclass
class EntityAnnotation:
    text: str
    entity_type: str
    start_offset: int
    end_offset: int

@dataclass
class AnnotatedDocument:
    text: str
    annotations: List[EntityAnnotation]
    document_id: Optional[str] = None

class NERSchemaBuilder:
    """Build custom NER schema"""

    def __init__(self, project_name: str):
        self.project_name = project_name
        self.entities: List[EntityDefinition] = []

    def add_entity(
        self,
        name: str,
        description: str,
        examples: List[str] = None
    ) -> 'NERSchemaBuilder':
        """Add simple entity type"""
        self.entities.append(EntityDefinition(
            name=name,
            description=description,
            entity_type=EntityType.SIMPLE,
            examples=examples or []
        ))
        return self

    def add_composite_entity(
        self,
        name: str,
        description: str,
        components: List[str]
    ) -> 'NERSchemaBuilder':
        """Add composite entity (made of other entities)"""
        subentities = [
            EntityDefinition(name=comp, description=f"Component of {name}")
            for comp in components
        ]
        self.entities.append(EntityDefinition(
            name=name,
            description=description,
            entity_type=EntityType.COMPOSITE,
            subentities=subentities
        ))
        return self

    def validate_schema(self) -> Dict:
        """Validate NER schema"""
        issues = []

        if len(self.entities) == 0:
            issues.append("At least one entity type is required")

        # Check for naming conflicts
        names = [e.name for e in self.entities]
        duplicates = [n for n in names if names.count(n) > 1]
        if duplicates:
            issues.append(f"Duplicate entity names: {set(duplicates)}")

        # Check examples
        for entity in self.entities:
            if len(entity.examples) < 3:
                issues.append(f"Entity '{entity.name}' needs more examples (minimum 3)")

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "entity_count": len(self.entities)
        }

    def export_schema(self) -> Dict:
        """Export schema for documentation"""
        return {
            "project_name": self.project_name,
            "entities": [
                {
                    "name": e.name,
                    "description": e.description,
                    "type": e.entity_type.value,
                    "examples": e.examples
                }
                for e in self.entities
            ]
        }

# Example: Legal document NER
legal_schema = NERSchemaBuilder("LegalDocumentNER")
legal_schema.add_entity(
    "Party",
    "Legal party in a contract",
    ["Acme Corporation", "John Smith", "XYZ Holdings LLC"]
)
legal_schema.add_entity(
    "ContractDate",
    "Date mentioned in contract",
    ["January 1, 2023", "effective date", "termination date"]
)
legal_schema.add_entity(
    "MonetaryAmount",
    "Money amounts in contract",
    ["$10,000", "one million dollars", "USD 5,000.00"]
)
legal_schema.add_entity(
    "LegalClause",
    "Standard legal clause types",
    ["indemnification", "confidentiality", "force majeure"]
)

validation = legal_schema.validate_schema()
print(f"Schema valid: {validation['valid']}")
```

### Training Data Annotation

```python
import json
import re

class NERAnnotationTool:
    """Tool for creating and managing NER annotations"""

    def __init__(self, schema: NERSchemaBuilder):
        self.schema = schema
        self.documents: List[AnnotatedDocument] = []
        self.entity_names = [e.name for e in schema.entities]

    def create_annotation(
        self,
        text: str,
        entity_type: str,
        entity_text: str
    ) -> EntityAnnotation:
        """Create annotation by finding entity in text"""
        if entity_type not in self.entity_names:
            raise ValueError(f"Unknown entity type: {entity_type}")

        # Find the entity text in the document
        match = re.search(re.escape(entity_text), text)
        if not match:
            raise ValueError(f"Entity text '{entity_text}' not found in document")

        return EntityAnnotation(
            text=entity_text,
            entity_type=entity_type,
            start_offset=match.start(),
            end_offset=match.end()
        )

    def annotate_document(
        self,
        text: str,
        entities: List[Dict]
    ) -> AnnotatedDocument:
        """Annotate a document with multiple entities"""
        annotations = []

        for entity in entities:
            annotation = self.create_annotation(
                text,
                entity["type"],
                entity["text"]
            )
            annotations.append(annotation)

        doc = AnnotatedDocument(
            text=text,
            annotations=annotations,
            document_id=f"doc_{len(self.documents)}"
        )
        self.documents.append(doc)
        return doc

    def auto_annotate(
        self,
        text: str,
        patterns: Dict[str, List[str]]
    ) -> AnnotatedDocument:
        """Automatically annotate using patterns"""
        annotations = []

        for entity_type, pattern_list in patterns.items():
            for pattern in pattern_list:
                for match in re.finditer(pattern, text, re.IGNORECASE):
                    annotations.append(EntityAnnotation(
                        text=match.group(),
                        entity_type=entity_type,
                        start_offset=match.start(),
                        end_offset=match.end()
                    ))

        # Remove overlapping annotations (keep longest)
        annotations = self._remove_overlaps(annotations)

        doc = AnnotatedDocument(
            text=text,
            annotations=annotations,
            document_id=f"auto_{len(self.documents)}"
        )
        self.documents.append(doc)
        return doc

    def _remove_overlaps(self, annotations: List[EntityAnnotation]) -> List[EntityAnnotation]:
        """Remove overlapping annotations, keeping longest"""
        if not annotations:
            return []

        # Sort by start position
        sorted_anns = sorted(annotations, key=lambda x: (x.start_offset, -x.end_offset))

        result = [sorted_anns[0]]
        for ann in sorted_anns[1:]:
            if ann.start_offset >= result[-1].end_offset:
                result.append(ann)
            elif ann.end_offset - ann.start_offset > result[-1].end_offset - result[-1].start_offset:
                result[-1] = ann

        return result

    def export_azure_format(self, output_dir: str) -> Dict:
        """Export annotations in Azure Language Studio format"""
        from pathlib import Path

        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        docs_path = output_path / "documents"
        docs_path.mkdir(exist_ok=True)

        export_data = {
            "projectFileVersion": "2022-05-01",
            "stringIndexType": "Utf16CodeUnit",
            "metadata": {
                "projectKind": "CustomEntityRecognition",
                "projectName": self.schema.project_name,
                "language": "en-us"
            },
            "assets": {
                "projectKind": "CustomEntityRecognition",
                "entities": [
                    {"category": e.name}
                    for e in self.schema.entities
                ],
                "documents": []
            }
        }

        for i, doc in enumerate(self.documents):
            # Write document text
            doc_filename = f"doc_{i}.txt"
            with open(docs_path / doc_filename, 'w', encoding='utf-8') as f:
                f.write(doc.text)

            # Add document with annotations
            doc_entry = {
                "location": doc_filename,
                "language": "en-us",
                "entities": [
                    {
                        "category": ann.entity_type,
                        "offset": ann.start_offset,
                        "length": ann.end_offset - ann.start_offset
                    }
                    for ann in doc.annotations
                ]
            }
            export_data["assets"]["documents"].append(doc_entry)

        # Write export file
        with open(output_path / "labels.json", 'w', encoding='utf-8') as f:
            json.dump(export_data, f, indent=2)

        return {
            "output_dir": str(output_path),
            "document_count": len(self.documents),
            "total_annotations": sum(len(d.annotations) for d in self.documents)
        }

# Usage
annotator = NERAnnotationTool(legal_schema)

# Manual annotation
doc = annotator.annotate_document(
    "This Agreement is entered into between Acme Corporation and John Smith, effective January 1, 2023, for the amount of $10,000.",
    [
        {"type": "Party", "text": "Acme Corporation"},
        {"type": "Party", "text": "John Smith"},
        {"type": "ContractDate", "text": "January 1, 2023"},
        {"type": "MonetaryAmount", "text": "$10,000"}
    ]
)

# Auto-annotation with patterns
patterns = {
    "MonetaryAmount": [r'\$[\d,]+(?:\.\d{2})?', r'\d+\s+(?:dollars?|USD)'],
    "ContractDate": [r'\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b']
}
auto_doc = annotator.auto_annotate(
    "The payment of $5,000.00 is due by March 15, 2024.",
    patterns
)

# Export
result = annotator.export_azure_format("./ner_export")
print(f"Exported {result['total_annotations']} annotations")
```

### Using Custom NER Model

```python
import os
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential

class CustomNERExtractor:
    """Extract entities using custom NER model"""

    def __init__(self, project_name: str, deployment_name: str):
        self.client = TextAnalyticsClient(
            endpoint=os.getenv("AZURE_LANGUAGE_ENDPOINT"),
            credential=AzureKeyCredential(os.getenv("AZURE_LANGUAGE_KEY"))
        )
        self.project_name = project_name
        self.deployment_name = deployment_name

    def extract_entities(self, documents: List[str]) -> List[Dict]:
        """Extract custom entities from documents"""
        poller = self.client.begin_recognize_custom_entities(
            documents,
            project_name=self.project_name,
            deployment_name=self.deployment_name
        )
        result = poller.result()

        extractions = []
        for doc_result in result:
            if not doc_result.is_error:
                entities = [
                    {
                        "text": entity.text,
                        "category": entity.category,
                        "confidence": entity.confidence_score,
                        "offset": entity.offset,
                        "length": entity.length
                    }
                    for entity in doc_result.entities
                ]
                extractions.append({"entities": entities})
            else:
                extractions.append({"error": doc_result.error.message})

        return extractions

    def extract_and_group(self, documents: List[str]) -> List[Dict]:
        """Extract entities and group by category"""
        extractions = self.extract_entities(documents)

        grouped = []
        for extraction in extractions:
            if "error" in extraction:
                grouped.append(extraction)
                continue

            by_category = {}
            for entity in extraction["entities"]:
                category = entity["category"]
                if category not in by_category:
                    by_category[category] = []
                by_category[category].append({
                    "text": entity["text"],
                    "confidence": entity["confidence"]
                })

            grouped.append({"entities_by_category": by_category})

        return grouped

    def extract_with_context(
        self,
        documents: List[str],
        context_window: int = 50
    ) -> List[Dict]:
        """Extract entities with surrounding context"""
        extractions = self.extract_entities(documents)

        with_context = []
        for doc, extraction in zip(documents, extractions):
            if "error" in extraction:
                with_context.append(extraction)
                continue

            entities_with_context = []
            for entity in extraction["entities"]:
                start = max(0, entity["offset"] - context_window)
                end = min(len(doc), entity["offset"] + entity["length"] + context_window)

                entities_with_context.append({
                    **entity,
                    "context": doc[start:end],
                    "context_start": start,
                    "context_end": end
                })

            with_context.append({"entities": entities_with_context})

        return with_context

# Usage
extractor = CustomNERExtractor(
    project_name="LegalDocumentNER",
    deployment_name="production"
)

legal_texts = [
    "This Services Agreement between TechCorp Inc. and StartupXYZ, dated April 1, 2023, establishes payment terms of $50,000 quarterly.",
    "The confidentiality clause requires both parties to maintain strict non-disclosure for 5 years."
]

# Basic extraction
results = extractor.extract_entities(legal_texts)
for i, result in enumerate(results):
    print(f"\nDocument {i+1}:")
    for entity in result.get("entities", []):
        print(f"  {entity['category']}: '{entity['text']}' ({entity['confidence']:.2%})")

# Grouped extraction
grouped = extractor.extract_and_group(legal_texts)
for i, result in enumerate(grouped):
    print(f"\nDocument {i+1} by category:")
    for category, entities in result.get("entities_by_category", {}).items():
        print(f"  {category}: {[e['text'] for e in entities]}")
```

### Entity Validation and Post-Processing

```python
from typing import Callable

class EntityPostProcessor:
    """Post-process extracted entities"""

    def __init__(self):
        self.validators: Dict[str, Callable] = {}
        self.normalizers: Dict[str, Callable] = {}

    def register_validator(self, entity_type: str, validator: Callable[[str], bool]):
        """Register validation function for entity type"""
        self.validators[entity_type] = validator

    def register_normalizer(self, entity_type: str, normalizer: Callable[[str], str]):
        """Register normalization function for entity type"""
        self.normalizers[entity_type] = normalizer

    def process(self, extractions: List[Dict]) -> List[Dict]:
        """Process and validate extracted entities"""
        processed = []

        for extraction in extractions:
            if "error" in extraction:
                processed.append(extraction)
                continue

            valid_entities = []
            for entity in extraction.get("entities", []):
                entity_type = entity["category"]

                # Validate
                if entity_type in self.validators:
                    is_valid = self.validators[entity_type](entity["text"])
                    if not is_valid:
                        continue

                # Normalize
                if entity_type in self.normalizers:
                    entity["normalized_text"] = self.normalizers[entity_type](entity["text"])

                valid_entities.append(entity)

            processed.append({"entities": valid_entities})

        return processed

# Example validators and normalizers
def validate_monetary_amount(text: str) -> bool:
    """Validate monetary amount format"""
    import re
    pattern = r'^\$?[\d,]+(?:\.\d{2})?$|^\d+\s+(?:dollars?|USD)$'
    return bool(re.match(pattern, text, re.IGNORECASE))

def normalize_monetary_amount(text: str) -> str:
    """Normalize monetary amount to standard format"""
    import re
    # Extract numeric value
    numbers = re.findall(r'[\d,]+(?:\.\d{2})?', text)
    if numbers:
        value = float(numbers[0].replace(',', ''))
        return f"${value:,.2f}"
    return text

def normalize_date(text: str) -> str:
    """Normalize date to ISO format"""
    from datetime import datetime
    try:
        # Try common formats
        for fmt in ["%B %d, %Y", "%m/%d/%Y", "%d-%m-%Y"]:
            try:
                dt = datetime.strptime(text, fmt)
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue
    except Exception:
        pass
    return text

# Usage
processor = EntityPostProcessor()
processor.register_validator("MonetaryAmount", validate_monetary_amount)
processor.register_normalizer("MonetaryAmount", normalize_monetary_amount)
processor.register_normalizer("ContractDate", normalize_date)

processed_results = processor.process(results)
```

## Conclusion

Custom NER in Azure AI Language enables extraction of domain-specific entities tailored to your business needs. By carefully designing entity schemas, creating quality training annotations, and implementing proper validation and post-processing, you can build accurate entity extraction systems for specialized domains like legal, healthcare, finance, or any custom use case.
