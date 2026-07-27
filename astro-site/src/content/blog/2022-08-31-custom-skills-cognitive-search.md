---
title: "Building Custom Skills for Azure Cognitive Search"
author: "Michael John Peña"
draft: false
date: 2022-08-31
tags: ["Azure", "Cognitive Search", "Custom Skills", "Azure Functions", "AI"]

---

I wrote "Building Custom Skills for Azure Cognitive Search" to share practical, production-minded guidance on this topic.

## Custom Skill Architecture

Custom skills communicate via HTTP:
1. Search receives document during indexing
2. Calls your skill's REST endpoint with input data
3. Your skill processes and returns enriched output
4. Search continues with enriched document

## Creating a Custom Skill with Azure Functions

```python
# Azure Function: function_app.py
import azure.functions as func
import json
import logging

app = func.FunctionApp()

@app.function_name(name="CustomEntityExtractor")
@app.route(route="extract-entities", methods=["POST"])
def extract_entities(req: func.HttpRequest) -> func.HttpResponse:
    """Custom skill for entity extraction"""
    logging.info('Custom entity extractor called')

    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse("Invalid JSON", status_code=400)

    # Process each record
    values = body.get("values", [])
    results = []

    for record in values:
        record_id = record.get("recordId")
        data = record.get("data", {})
        text = data.get("text", "")

        try:
            # Your custom extraction logic
            entities = extract_custom_entities(text)

            results.append({
                "recordId": record_id,
                "data": {
                    "customEntities": entities
                },
                "errors": [],
                "warnings": []
            })

        except Exception as e:
            results.append({
                "recordId": record_id,
                "data": {},
                "errors": [{"message": str(e)}],
                "warnings": []
            })

    return func.HttpResponse(
        json.dumps({"values": results}),
        mimetype="application/json"
    )

def extract_custom_entities(text):
    """Custom entity extraction logic"""
    entities = []

    # Example: Extract product codes (e.g., PRD-12345)
    import re
    product_pattern = r'PRD-\d{5}'
    for match in re.finditer(product_pattern, text):
        entities.append({
            "type": "ProductCode",
            "value": match.group(),
            "offset": match.start(),
            "length": len(match.group())
        })

    # Example: Extract custom terms
    custom_terms = ["machine learning", "artificial intelligence", "data science"]
    text_lower = text.lower()
    for term in custom_terms:
        if term in text_lower:
            idx = text_lower.find(term)
            entities.append({
                "type": "TechnologyTerm",
                "value": term,
                "offset": idx,
                "length": len(term)
            })

    return entities
```

## Integrating ML Model

```python
import azure.functions as func
import json
import joblib
import numpy as np

# Load model at startup
model = None

def load_model():
    global model
    if model is None:
        model = joblib.load("model.pkl")
    return model

@app.function_name(name="SentimentClassifier")
@app.route(route="classify-sentiment", methods=["POST"])
def classify_sentiment(req: func.HttpRequest) -> func.HttpResponse:
    """Custom skill using ML model for sentiment classification"""

    body = req.get_json()
    values = body.get("values", [])
    results = []

    clf = load_model()

    for record in values:
        record_id = record.get("recordId")
        text = record.get("data", {}).get("text", "")

        try:
            # Preprocess and predict
            features = preprocess_text(text)
            prediction = clf.predict([features])[0]
            confidence = clf.predict_proba([features]).max()

            results.append({
                "recordId": record_id,
                "data": {
                    "sentiment": prediction,
                    "confidence": float(confidence)
                },
                "errors": [],
                "warnings": []
            })

        except Exception as e:
            results.append({
                "recordId": record_id,
                "data": {},
                "errors": [{"message": str(e)}],
                "warnings": []
            })

    return func.HttpResponse(
        json.dumps({"values": results}),
        mimetype="application/json"
    )

def preprocess_text(text):
    """Preprocess text for model"""
    # Your preprocessing logic
    return text.lower()
```

## Custom Skill Using External API

```python
import azure.functions as func
import json
import requests

@app.function_name(name="TranslationSkill")
@app.route(route="translate", methods=["POST"])
def translate_text(req: func.HttpRequest) -> func.HttpResponse:
    """Custom skill that calls external translation API"""

    body = req.get_json()
    values = body.get("values", [])
    results = []

    api_key = os.environ.get("TRANSLATION_API_KEY")

    for record in values:
        record_id = record.get("recordId")
        data = record.get("data", {})
        text = data.get("text", "")
        source_lang = data.get("sourceLanguage", "auto")
        target_lang = data.get("targetLanguage", "en")

        try:
            # Call external translation API
            translated = call_translation_api(text, source_lang, target_lang, api_key)

            results.append({
                "recordId": record_id,
                "data": {
                    "translatedText": translated["text"],
                    "detectedLanguage": translated["detectedLanguage"]
                },
                "errors": [],
                "warnings": []
            })

        except Exception as e:
            results.append({
                "recordId": record_id,
                "data": {},
                "errors": [{"message": str(e)}],
                "warnings": []
            })

    return func.HttpResponse(
        json.dumps({"values": results}),
        mimetype="application/json"
    )

def call_translation_api(text, source, target, api_key):
    """Call external translation service"""
    response = requests.post(
        "https://api.translation-service.com/translate",
        json={"text": text, "source": source, "target": target},
        headers={"Authorization": f"Bearer {api_key}"}
    )
    return response.json()
```

## Registering Custom Skill in Skillset

```python
from azure.search.documents.indexes.models import (
    SearchIndexerSkillset,
    WebApiSkill,
    InputFieldMappingEntry,
    OutputFieldMappingEntry
)

# Define custom skill
custom_entity_skill = WebApiSkill(
    name="custom-entity-extractor",
    description="Extract custom entities using Azure Function",
    context="/document",
    uri="https://myfunctionapp.azurewebsites.net/api/extract-entities",
    http_method="POST",
    timeout="PT30S",
    batch_size=10,
    degree_of_parallelism=5,
    http_headers={
        "x-functions-key": "your-function-key"
    },
    inputs=[
        InputFieldMappingEntry(name="text", source="/document/content")
    ],
    outputs=[
        OutputFieldMappingEntry(name="customEntities", target_name="customEntities")
    ]
)

# Custom ML skill
sentiment_skill = WebApiSkill(
    name="custom-sentiment",
    description="Classify sentiment using custom ML model",
    context="/document",
    uri="https://myfunctionapp.azurewebsites.net/api/classify-sentiment",
    http_method="POST",
    timeout="PT60S",
    batch_size=25,
    inputs=[
        InputFieldMappingEntry(name="text", source="/document/content")
    ],
    outputs=[
        OutputFieldMappingEntry(name="sentiment", target_name="customSentiment"),
        OutputFieldMappingEntry(name="confidence", target_name="sentimentConfidence")
    ]
)

# Create skillset with custom skills
skillset = SearchIndexerSkillset(
    name="custom-enrichment-skillset",
    skills=[
        custom_entity_skill,
        sentiment_skill,
        # Can combine with built-in skills
        KeyPhraseExtractionSkill(
            name="extract-keyphrases",
            context="/document",
            inputs=[InputFieldMappingEntry(name="text", source="/document/content")],
            outputs=[OutputFieldMappingEntry(name="keyPhrases", target_name="keyPhrases")]
        )
    ]
)

indexer_client.create_or_update_skillset(skillset)
```

## Testing Custom Skills

```python
def test_custom_skill(function_url, test_records):
    """Test custom skill endpoint"""
    import requests

    payload = {"values": test_records}

    response = requests.post(
        function_url,
        json=payload,
        headers={"Content-Type": "application/json"}
    )

    if response.status_code == 200:
        results = response.json()
        for result in results.get("values", []):
            print(f"Record {result['recordId']}:")
            if result.get("errors"):
                print(f"  Errors: {result['errors']}")
            else:
                print(f"  Data: {result['data']}")
    else:
        print(f"Error: {response.status_code} - {response.text}")

# Test records
test_records = [
    {
        "recordId": "1",
        "data": {
            "text": "Our product PRD-12345 uses machine learning for predictions."
        }
    },
    {
        "recordId": "2",
        "data": {
            "text": "Contact support at support@company.com for PRD-67890."
        }
    }
]

test_custom_skill(
    "https://myfunctionapp.azurewebsites.net/api/extract-entities",
    test_records
)
```

## Error Handling Best Practices

```python
@app.function_name(name="RobustCustomSkill")
@app.route(route="robust-skill", methods=["POST"])
def robust_skill(req: func.HttpRequest) -> func.HttpResponse:
    """Custom skill with comprehensive error handling"""

    # Validate request
    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"values": [], "error": "Invalid JSON"}),
            status_code=400,
            mimetype="application/json"
        )

    values = body.get("values", [])
    if not values:
        return func.HttpResponse(
            json.dumps({"values": []}),
            mimetype="application/json"
        )

    results = []

    for record in values:
        record_id = record.get("recordId", "unknown")
        warnings = []
        errors = []

        try:
            data = record.get("data", {})
            text = data.get("text", "")

            # Validate input
            if not text:
                warnings.append({
                    "message": "Empty text input, skipping processing"
                })
                results.append({
                    "recordId": record_id,
                    "data": {"result": None},
                    "errors": errors,
                    "warnings": warnings
                })
                continue

            # Process with timeout protection
            result = process_with_timeout(text, timeout_seconds=25)

            results.append({
                "recordId": record_id,
                "data": {"result": result},
                "errors": errors,
                "warnings": warnings
            })

        except TimeoutError:
            errors.append({
                "message": "Processing timeout exceeded"
            })
            results.append({
                "recordId": record_id,
                "data": {},
                "errors": errors,
                "warnings": warnings
            })

        except Exception as e:
            logging.error(f"Error processing record {record_id}: {str(e)}")
            errors.append({
                "message": f"Processing error: {str(e)}"
            })
            results.append({
                "recordId": record_id,
                "data": {},
                "errors": errors,
                "warnings": warnings
            })

    return func.HttpResponse(
        json.dumps({"values": results}),
        mimetype="application/json"
    )
```

Custom skills unlock unlimited possibilities for AI enrichment tailored to your specific business needs.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
