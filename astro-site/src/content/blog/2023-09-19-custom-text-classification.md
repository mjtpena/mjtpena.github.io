---
title: "Custom Text Classification with Azure AI Language"
author: Michael John Peña
draft: false
date: 2023-09-19
description: "Build custom text classification models using Azure AI Language for domain-specific categorization needs."
tags:
  - Azure
  - NLP
  - Text Classification
  - Machine Learning
  - AI
---

## Introduction

While Azure AI Language provides pre-built text classification capabilities, many use cases require custom classification models tailored to specific domains and categories. This post covers how to build, train, and deploy custom text classifiers using Azure AI Language.

## Custom Classification Concepts

### Single-Label vs Multi-Label Classification

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum

class ClassificationType(Enum):
    SINGLE_LABEL = "single"
    MULTI_LABEL = "multi"

@dataclass
class ClassificationLabel:
    name: str
    description: str
    examples: List[str]

@dataclass
class ClassificationProject:
    name: str
    description: str
    classification_type: ClassificationType
    labels: List[ClassificationLabel]
    language: str = "en"

@dataclass
class TrainingDocument:
    text: str
    labels: List[str]
    document_id: Optional[str] = None

class ClassificationProjectBuilder:
    """Builder for creating classification projects"""

    def __init__(self, name: str, classification_type: ClassificationType):
        self.name = name
        self.classification_type = classification_type
        self.labels: List[ClassificationLabel] = []
        self.training_data: List[TrainingDocument] = []

    def add_label(self, name: str, description: str, examples: List[str] = None) -> 'ClassificationProjectBuilder':
        """Add a classification label"""
        self.labels.append(ClassificationLabel(
            name=name,
            description=description,
            examples=examples or []
        ))
        return self

    def add_training_document(self, text: str, labels: List[str]) -> 'ClassificationProjectBuilder':
        """Add a training document"""
        if self.classification_type == ClassificationType.SINGLE_LABEL and len(labels) > 1:
            raise ValueError("Single-label classification allows only one label per document")

        self.training_data.append(TrainingDocument(
            text=text,
            labels=labels,
            document_id=f"doc_{len(self.training_data)}"
        ))
        return self

    def validate(self) -> Dict:
        """Validate project configuration"""
        issues = []

        # Check minimum labels
        if len(self.labels) < 2:
            issues.append("At least 2 labels are required")

        # Check training data per label
        label_counts = {label.name: 0 for label in self.labels}
        for doc in self.training_data:
            for label in doc.labels:
                if label in label_counts:
                    label_counts[label] += 1

        min_docs_per_label = 10
        for label, count in label_counts.items():
            if count < min_docs_per_label:
                issues.append(f"Label '{label}' has {count} documents, minimum is {min_docs_per_label}")

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "label_distribution": label_counts,
            "total_documents": len(self.training_data)
        }

    def build(self) -> ClassificationProject:
        """Build the classification project"""
        validation = self.validate()
        if not validation["valid"]:
            raise ValueError(f"Project validation failed: {validation['issues']}")

        return ClassificationProject(
            name=self.name,
            description=f"Custom {self.classification_type.value}-label classification",
            classification_type=self.classification_type,
            labels=self.labels
        )

# Usage
builder = ClassificationProjectBuilder("SupportTicketClassifier", ClassificationType.SINGLE_LABEL)

# Define labels
builder.add_label("billing", "Billing and payment issues", ["refund", "charge", "invoice"])
builder.add_label("technical", "Technical support requests", ["error", "bug", "not working"])
builder.add_label("account", "Account management", ["password", "login", "settings"])
builder.add_label("feedback", "General feedback", ["suggestion", "complaint", "praise"])

# Add training documents
builder.add_training_document("I need a refund for my last payment", ["billing"])
builder.add_training_document("The application crashes when I click submit", ["technical"])
builder.add_training_document("How do I reset my password?", ["account"])
builder.add_training_document("Great product! Love using it", ["feedback"])
# ... add more documents

validation = builder.validate()
print(f"Valid: {validation['valid']}")
print(f"Label distribution: {validation['label_distribution']}")
```

### Training Data Preparation

```python
import json
import csv
from pathlib import Path

class TrainingDataManager:
    """Manage training data for custom classification"""

    def __init__(self, project_name: str):
        self.project_name = project_name
        self.documents: List[TrainingDocument] = []

    def load_from_csv(self, file_path: str, text_column: str, label_column: str):
        """Load training data from CSV file"""
        with open(file_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader):
                text = row[text_column]
                labels = [l.strip() for l in row[label_column].split(',')]
                self.documents.append(TrainingDocument(
                    text=text,
                    labels=labels,
                    document_id=f"csv_{i}"
                ))

    def load_from_json(self, file_path: str):
        """Load training data from JSON file"""
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        for i, item in enumerate(data):
            self.documents.append(TrainingDocument(
                text=item['text'],
                labels=item['labels'] if isinstance(item['labels'], list) else [item['labels']],
                document_id=f"json_{i}"
            ))

    def export_for_azure(self, output_dir: str) -> Dict:
        """Export data in Azure Language Studio format"""
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        # Create documents folder
        docs_path = output_path / "documents"
        docs_path.mkdir(exist_ok=True)

        # Create labels file
        all_labels = set()
        for doc in self.documents:
            all_labels.update(doc.labels)

        labels_data = {
            "projectFileVersion": "2022-05-01",
            "stringIndexType": "Utf16CodeUnit",
            "metadata": {
                "projectKind": "CustomSingleLabelClassification",
                "projectName": self.project_name,
                "language": "en-us"
            },
            "assets": {
                "projectKind": "CustomSingleLabelClassification",
                "classes": [{"category": label} for label in sorted(all_labels)],
                "documents": []
            }
        }

        # Add documents
        for i, doc in enumerate(self.documents):
            # Write document text file
            doc_filename = f"doc_{i}.txt"
            with open(docs_path / doc_filename, 'w', encoding='utf-8') as f:
                f.write(doc.text)

            # Add to labels data
            labels_data["assets"]["documents"].append({
                "location": doc_filename,
                "language": "en-us",
                "class": {"category": doc.labels[0]}  # Single label
            })

        # Write labels file
        with open(output_path / "labels.json", 'w', encoding='utf-8') as f:
            json.dump(labels_data, f, indent=2)

        return {
            "output_dir": str(output_path),
            "document_count": len(self.documents),
            "label_count": len(all_labels)
        }

    def split_train_test(self, test_ratio: float = 0.2) -> tuple:
        """Split data into training and test sets"""
        import random
        random.shuffle(self.documents)

        split_idx = int(len(self.documents) * (1 - test_ratio))
        train_docs = self.documents[:split_idx]
        test_docs = self.documents[split_idx:]

        return train_docs, test_docs

    def augment_data(self, augmentation_factor: int = 2) -> List[TrainingDocument]:
        """Simple data augmentation through paraphrasing"""
        # In practice, use an LLM or specialized augmentation library
        augmented = []
        for doc in self.documents:
            augmented.append(doc)
            # Add variations (simplified example)
            for i in range(augmentation_factor - 1):
                augmented.append(TrainingDocument(
                    text=doc.text.lower() if i % 2 == 0 else doc.text.upper(),
                    labels=doc.labels,
                    document_id=f"{doc.document_id}_aug_{i}"
                ))
        return augmented

# Usage
data_manager = TrainingDataManager("SupportClassifier")
data_manager.load_from_csv("training_data.csv", "text", "category")

# Export for Azure
export_result = data_manager.export_for_azure("./azure_export")
print(f"Exported {export_result['document_count']} documents")

# Split data
train, test = data_manager.split_train_test(0.2)
print(f"Train: {len(train)}, Test: {len(test)}")
```

### Using the Classification Model

```python
import os
from azure.ai.textanalytics import TextAnalyticsClient
from azure.core.credentials import AzureKeyCredential

class CustomClassifier:
    """Use custom classification model for predictions"""

    def __init__(self, project_name: str, deployment_name: str):
        self.client = TextAnalyticsClient(
            endpoint=os.getenv("AZURE_LANGUAGE_ENDPOINT"),
            credential=AzureKeyCredential(os.getenv("AZURE_LANGUAGE_KEY"))
        )
        self.project_name = project_name
        self.deployment_name = deployment_name

    def classify_single_label(self, documents: List[str]) -> List[Dict]:
        """Classify documents with single-label model"""
        poller = self.client.begin_single_label_classify(
            documents,
            project_name=self.project_name,
            deployment_name=self.deployment_name
        )
        result = poller.result()

        classifications = []
        for doc_result in result:
            if not doc_result.is_error:
                classification = doc_result.classifications[0]
                classifications.append({
                    "category": classification.category,
                    "confidence": classification.confidence_score
                })
            else:
                classifications.append({
                    "error": doc_result.error.message
                })

        return classifications

    def classify_multi_label(self, documents: List[str]) -> List[Dict]:
        """Classify documents with multi-label model"""
        poller = self.client.begin_multi_label_classify(
            documents,
            project_name=self.project_name,
            deployment_name=self.deployment_name
        )
        result = poller.result()

        classifications = []
        for doc_result in result:
            if not doc_result.is_error:
                labels = [
                    {
                        "category": c.category,
                        "confidence": c.confidence_score
                    }
                    for c in doc_result.classifications
                ]
                classifications.append({"labels": labels})
            else:
                classifications.append({"error": doc_result.error.message})

        return classifications

    def classify_with_threshold(
        self,
        documents: List[str],
        confidence_threshold: float = 0.7
    ) -> List[Dict]:
        """Classify with confidence threshold"""
        results = self.classify_single_label(documents)

        filtered = []
        for result in results:
            if "error" in result:
                filtered.append(result)
            elif result["confidence"] >= confidence_threshold:
                filtered.append(result)
            else:
                filtered.append({
                    "category": "uncertain",
                    "original_prediction": result["category"],
                    "confidence": result["confidence"]
                })

        return filtered

# Usage
classifier = CustomClassifier(
    project_name="SupportTicketClassifier",
    deployment_name="production"
)

# Classify new documents
new_tickets = [
    "My credit card was charged twice",
    "The app keeps freezing on startup",
    "How do I update my email address?"
]

results = classifier.classify_single_label(new_tickets)
for ticket, result in zip(new_tickets, results):
    print(f"'{ticket[:40]}...' -> {result.get('category', 'error')} ({result.get('confidence', 0):.2%})")

# With threshold
results_filtered = classifier.classify_with_threshold(new_tickets, 0.8)
```

### Model Evaluation

```python
from typing import Dict, List, Tuple
import numpy as np
from collections import Counter

class ClassifierEvaluator:
    """Evaluate classification model performance"""

    def __init__(self, classifier: CustomClassifier):
        self.classifier = classifier

    def evaluate(
        self,
        test_documents: List[str],
        true_labels: List[str]
    ) -> Dict:
        """Evaluate model on test set"""
        predictions = self.classifier.classify_single_label(test_documents)
        predicted_labels = [p.get("category", "error") for p in predictions]

        # Calculate metrics
        metrics = self._calculate_metrics(true_labels, predicted_labels)

        # Per-class metrics
        class_metrics = self._per_class_metrics(true_labels, predicted_labels)

        return {
            "overall": metrics,
            "per_class": class_metrics,
            "confusion_matrix": self._confusion_matrix(true_labels, predicted_labels)
        }

    def _calculate_metrics(self, true: List[str], pred: List[str]) -> Dict:
        """Calculate overall metrics"""
        correct = sum(1 for t, p in zip(true, pred) if t == p)
        total = len(true)

        return {
            "accuracy": correct / total if total > 0 else 0,
            "total_samples": total,
            "correct_predictions": correct
        }

    def _per_class_metrics(self, true: List[str], pred: List[str]) -> Dict:
        """Calculate per-class precision, recall, F1"""
        classes = set(true) | set(pred)
        metrics = {}

        for cls in classes:
            tp = sum(1 for t, p in zip(true, pred) if t == cls and p == cls)
            fp = sum(1 for t, p in zip(true, pred) if t != cls and p == cls)
            fn = sum(1 for t, p in zip(true, pred) if t == cls and p != cls)

            precision = tp / (tp + fp) if (tp + fp) > 0 else 0
            recall = tp / (tp + fn) if (tp + fn) > 0 else 0
            f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

            metrics[cls] = {
                "precision": precision,
                "recall": recall,
                "f1": f1,
                "support": sum(1 for t in true if t == cls)
            }

        return metrics

    def _confusion_matrix(self, true: List[str], pred: List[str]) -> Dict:
        """Build confusion matrix"""
        classes = sorted(set(true) | set(pred))
        matrix = {c: {c2: 0 for c2 in classes} for c in classes}

        for t, p in zip(true, pred):
            matrix[t][p] += 1

        return matrix

    def print_report(self, evaluation: Dict):
        """Print evaluation report"""
        print("=" * 50)
        print("Classification Report")
        print("=" * 50)

        print(f"\nOverall Accuracy: {evaluation['overall']['accuracy']:.2%}")
        print(f"Total Samples: {evaluation['overall']['total_samples']}")

        print("\nPer-Class Metrics:")
        print("-" * 50)
        print(f"{'Class':<20} {'Precision':<12} {'Recall':<12} {'F1':<12} {'Support':<10}")
        print("-" * 50)

        for cls, metrics in evaluation['per_class'].items():
            print(f"{cls:<20} {metrics['precision']:<12.2%} {metrics['recall']:<12.2%} {metrics['f1']:<12.2%} {metrics['support']:<10}")

# Usage
evaluator = ClassifierEvaluator(classifier)

test_docs = ["test document 1", "test document 2"]
true_labels = ["billing", "technical"]

evaluation = evaluator.evaluate(test_docs, true_labels)
evaluator.print_report(evaluation)
```

## Conclusion

Custom text classification in Azure AI Language enables organizations to build domain-specific classifiers tailored to their unique categorization needs. By carefully preparing training data, validating project configuration, and evaluating model performance, you can create accurate and reliable classification systems for various business applications.
