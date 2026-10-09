---
title: Multilingual Applications with Azure Translator
description: "Azure Translator is one of the Cognitive Services that I've shipped most quietly—it tends to be a two-day integration rather than a headline feature, but…"
author: Michael John Pena
draft: false
date: 2021-03-27
url: /blog/azure-translator/
tags:
  - Azure
  - Translator
  - Cognitive Services
  - NLP
  - Localization
---

Azure Translator is one of the Cognitive Services that I've shipped most quietly—it tends to be a two-day integration rather than a headline feature, but the impact on global adoption is real. A Melbourne-based platform I worked on last year added real-time message translation for a user base across eight Asian markets using the Translator Text API; the latency was under 200ms for short strings and the translation quality for most language pairs was good enough for operational communication. The Document Translation endpoint handles PDFs and Word documents asynchronously. Custom Translator lets you fine-tune on domain-specific terminology when the default models produce awkward phrasing for legal or technical content.

## Setting Up Translator Service

```bash
# Create Translator resource
az cognitiveservices account create \
    --name mytranslator \
    --resource-group myResourceGroup \
    --kind TextTranslation \
    --sku S1 \
    --location global

# Get keys
az cognitiveservices account keys list \
    --name mytranslator \
    --resource-group myResourceGroup
```

## Basic Translation

```python
import requests
import uuid
import json

class AzureTranslator:
    def __init__(self, subscription_key, region="global"):
        self.subscription_key = subscription_key
        self.region = region
        self.endpoint = "https://api.cognitive.microsofttranslator.com"

    def translate(self, text, to_languages, from_language=None):
        """Translate text to one or more languages."""
        path = "/translate"
        url = self.endpoint + path

        params = {
            "api-version": "3.0",
            "to": to_languages if isinstance(to_languages, list) else [to_languages]
        }

        if from_language:
            params["from"] = from_language

        headers = {
            "Ocp-Apim-Subscription-Key": self.subscription_key,
            "Ocp-Apim-Subscription-Region": self.region,
            "Content-type": "application/json",
            "X-ClientTraceId": str(uuid.uuid4())
        }

        body = [{"text": text}] if isinstance(text, str) else [{"text": t} for t in text]

        response = requests.post(url, params=params, headers=headers, json=body)
        return response.json()

    def detect_language(self, text):
        """Detect the language of text."""
        path = "/detect"
        url = self.endpoint + path

        params = {"api-version": "3.0"}

        headers = {
            "Ocp-Apim-Subscription-Key": self.subscription_key,
            "Ocp-Apim-Subscription-Region": self.region,
            "Content-type": "application/json",
            "X-ClientTraceId": str(uuid.uuid4())
        }

        body = [{"text": text}] if isinstance(text, str) else [{"text": t} for t in text]

        response = requests.post(url, params=params, headers=headers, json=body)
        return response.json()

    def get_languages(self):
        """Get list of supported languages."""
        path = "/languages"
        url = self.endpoint + path

        params = {"api-version": "3.0", "scope": "translation,transliteration,dictionary"}

        response = requests.get(url, params=params)
        return response.json()

    def transliterate(self, text, language, from_script, to_script):
        """Convert text from one script to another."""
        path = "/transliterate"
        url = self.endpoint + path

        params = {
            "api-version": "3.0",
            "language": language,
            "fromScript": from_script,
            "toScript": to_script
        }

        headers = {
            "Ocp-Apim-Subscription-Key": self.subscription_key,
            "Ocp-Apim-Subscription-Region": self.region,
            "Content-type": "application/json",
            "X-ClientTraceId": str(uuid.uuid4())
        }

        body = [{"text": text}]

        response = requests.post(url, params=params, headers=headers, json=body)
        return response.json()


# Usage examples
translator = AzureTranslator("your-subscription-key", "eastus")

# Simple translation
result = translator.translate("Hello, how are you?", ["es", "fr", "de"])
for translation in result[0]["translations"]:
    print(f"{translation['to']}: {translation['text']}")
# es: Hola, como estas?
# fr: Bonjour, comment allez-vous?
# de: Hallo, wie geht es dir?

# Detect language
detection = translator.detect_language("Bonjour le monde")
print(f"Detected: {detection[0]['language']} (confidence: {detection[0]['score']})")
# Detected: fr (confidence: 1.0)

# Transliterate (Japanese to Latin script)
result = translator.transliterate("こんにちは", "ja", "Jpan", "Latn")
print(f"Transliterated: {result[0]['text']}")
# Transliterated: Kon'nichiwa
```

## Batch Translation

```python
def batch_translate(translator, texts, to_languages, from_language=None):
    """Translate multiple texts efficiently."""
    # API supports up to 100 texts per request, max 10,000 characters total
    BATCH_SIZE = 100
    MAX_CHARS = 10000

    all_results = []
    current_batch = []
    current_chars = 0

    for text in texts:
        text_len = len(text)

        if len(current_batch) >= BATCH_SIZE or current_chars + text_len > MAX_CHARS:
            # Process current batch
            results = translator.translate(
                [t["text"] for t in current_batch],
                to_languages,
                from_language
            )
            all_results.extend(results)
            current_batch = []
            current_chars = 0

        current_batch.append({"text": text})
        current_chars += text_len

    # Process remaining batch
    if current_batch:
        results = translator.translate(
            [t["text"] for t in current_batch],
            to_languages,
            from_language
        )
        all_results.extend(results)

    return all_results


# Translate a list of product descriptions
products = [
    "High-quality wireless headphones with noise cancellation",
    "Ergonomic office chair with lumbar support",
    "Stainless steel water bottle, 32oz capacity",
    "Portable Bluetooth speaker with 20-hour battery life"
]

translations = batch_translate(translator, products, ["es", "de", "ja"])

for i, product in enumerate(products):
    print(f"\nOriginal: {product}")
    for trans in translations[i]["translations"]:
        print(f"  {trans['to']}: {trans['text']}")
```

## Document Translation

```python
import time

class DocumentTranslator:
    def __init__(self, subscription_key, endpoint, storage_connection_string):
        self.subscription_key = subscription_key
        self.endpoint = endpoint  # Document translation endpoint
        self.storage_connection = storage_connection_string

    def translate_documents(self, source_url, target_url, target_language, source_language=None):
        """Translate documents in blob storage."""
        url = f"{self.endpoint}/translator/document/batches?api-version=2024-05-01"

        headers = {
            "Ocp-Apim-Subscription-Key": self.subscription_key,
            "Content-Type": "application/json"
        }

        body = {
            "inputs": [
                {
                    "source": {
                        "sourceUrl": source_url,
                        "language": source_language
                    },
                    "targets": [
                        {
                            "targetUrl": target_url,
                            "language": target_language
                        }
                    ]
                }
            ]
        }

        response = requests.post(url, headers=headers, json=body)

        if response.status_code == 202:
            operation_location = response.headers.get("Operation-Location")
            return self._wait_for_completion(operation_location)
        else:
            raise Exception(f"Translation failed: {response.text}")

    def _wait_for_completion(self, operation_url):
        """Poll for translation completion."""
        headers = {"Ocp-Apim-Subscription-Key": self.subscription_key}

        while True:
            response = requests.get(operation_url, headers=headers)
            result = response.json()

            status = result.get("status")
            print(f"Status: {status}")

            if status == "Succeeded":
                return result
            elif status in ["Failed", "Cancelled"]:
                raise Exception(f"Translation {status}: {result}")

            time.sleep(10)


# Usage
doc_translator = DocumentTranslator(
    subscription_key="your-key",
    endpoint="https://your-resource.cognitiveservices.azure.com",
    storage_connection_string="your-connection-string"
)

# Translate all documents in a container
result = doc_translator.translate_documents(
    source_url="https://storage.blob.core.windows.net/documents/source?sv=...",
    target_url="https://storage.blob.core.windows.net/documents/spanish?sv=...",
    target_language="es",
    source_language="en"
)

print(f"Translated {result['summary']['total']} documents")
```

## Custom Translator

```python
class CustomTranslator:
    """Manage custom translation models."""

    def __init__(self, subscription_key, region):
        self.subscription_key = subscription_key
        self.region = region
        self.base_url = f"https://{region}.api.cognitive.microsoft.com/translator/text/batch/v1.0"

    def create_project(self, name, source_language, target_language, domain="general"):
        """Create a custom translation project."""
        url = f"{self.base_url}/projects"

        headers = {
            "Ocp-Apim-Subscription-Key": self.subscription_key,
            "Content-Type": "application/json"
        }

        body = {
            "name": name,
            "languagePair": {
                "sourceLanguage": source_language,
                "targetLanguage": target_language
            },
            "category": domain,  # general, business, technology, etc.
            "description": f"Custom translator for {source_language} to {target_language}"
        }

        response = requests.post(url, headers=headers, json=body)
        return response.json()

    def upload_training_data(self, project_id, source_file, target_file, document_type="training"):
        """Upload parallel corpus for training."""
        url = f"{self.base_url}/projects/{project_id}/documents"

        headers = {"Ocp-Apim-Subscription-Key": self.subscription_key}

        files = {
            "sourceFile": open(source_file, "rb"),
            "targetFile": open(target_file, "rb"),
            "documentType": (None, document_type)  # training, tuning, testing
        }

        response = requests.post(url, headers=headers, files=files)
        return response.json()

    def train_model(self, project_id, model_name):
        """Train a custom model."""
        url = f"{self.base_url}/projects/{project_id}/models"

        headers = {
            "Ocp-Apim-Subscription-Key": self.subscription_key,
            "Content-Type": "application/json"
        }

        body = {"name": model_name}

        response = requests.post(url, headers=headers, json=body)
        return response.json()

    def translate_with_custom_model(self, text, category_id, to_language, from_language):
        """Translate using custom model."""
        url = "https://api.cognitive.microsofttranslator.com/translate"

        params = {
            "api-version": "3.0",
            "from": from_language,
            "to": to_language,
            "category": category_id  # Custom model category ID
        }

        headers = {
            "Ocp-Apim-Subscription-Key": self.subscription_key,
            "Ocp-Apim-Subscription-Region": self.region,
            "Content-type": "application/json"
        }

        body = [{"text": text}]

        response = requests.post(url, params=params, headers=headers, json=body)
        return response.json()
```

## Real-Time Translation API Integration

```python
from flask import Flask, request, jsonify

app = Flask(__name__)
translator = AzureTranslator("your-subscription-key", "eastus")

@app.route("/api/translate", methods=["POST"])
def translate_endpoint():
    """API endpoint for translation."""
    data = request.json
    text = data.get("text")
    to_languages = data.get("to", ["en"])
    from_language = data.get("from")

    if not text:
        return jsonify({"error": "Text is required"}), 400

    result = translator.translate(text, to_languages, from_language)

    return jsonify({
        "original": text,
        "translations": [
            {"language": t["to"], "text": t["text"]}
            for t in result[0]["translations"]
        ]
    })


@app.route("/api/detect", methods=["POST"])
def detect_endpoint():
    """API endpoint for language detection."""
    data = request.json
    text = data.get("text")

    if not text:
        return jsonify({"error": "Text is required"}), 400

    result = translator.detect_language(text)

    return jsonify({
        "text": text,
        "language": result[0]["language"],
        "confidence": result[0]["score"],
        "alternatives": result[0].get("alternatives", [])
    })


@app.route("/api/languages", methods=["GET"])
def languages_endpoint():
    """Get supported languages."""
    result = translator.get_languages()
    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True)
```

## Integration with Chat Applications

```javascript
// Node.js chat translation middleware
const axios = require('axios');

class ChatTranslator {
    constructor(subscriptionKey, region) {
        this.subscriptionKey = subscriptionKey;
        this.region = region;
        this.endpoint = 'https://api.cognitive.microsofttranslator.com';
    }

    async translateMessage(message, userLanguage) {
        // Detect source language
        const detection = await this.detectLanguage(message);
        const sourceLanguage = detection[0].language;

        // If already in user's language, return as-is
        if (sourceLanguage === userLanguage) {
            return { original: message, translated: message, sourceLanguage };
        }

        // Translate to user's language
        const translation = await this.translate(message, userLanguage, sourceLanguage);

        return {
            original: message,
            translated: translation[0].translations[0].text,
            sourceLanguage,
            targetLanguage: userLanguage
        };
    }

    async translate(text, to, from) {
        const response = await axios.post(
            `${this.endpoint}/translate`,
            [{ text }],
            {
                params: { 'api-version': '3.0', to, from },
                headers: {
                    'Ocp-Apim-Subscription-Key': this.subscriptionKey,
                    'Ocp-Apim-Subscription-Region': this.region,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data;
    }

    async detectLanguage(text) {
        const response = await axios.post(
            `${this.endpoint}/detect`,
            [{ text }],
            {
                params: { 'api-version': '3.0' },
                headers: {
                    'Ocp-Apim-Subscription-Key': this.subscriptionKey,
                    'Ocp-Apim-Subscription-Region': this.region,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data;
    }
}

// Usage in chat application
const translator = new ChatTranslator('your-key', 'eastus');

// Middleware for incoming messages
async function translateIncomingMessage(message, recipientLanguage) {
    const result = await translator.translateMessage(message.text, recipientLanguage);

    return {
        ...message,
        text: result.translated,
        originalText: result.original,
        sourceLanguage: result.sourceLanguage
    };
}
```

## Conclusion

Azure Translator enables global reach for your applications:

- **100+ languages** supported for text translation
- **Document translation** for batch processing
- **Custom models** for domain-specific terminology
- **Real-time translation** for chat and live applications
- **Transliteration** for script conversion

It's essential for building multilingual applications and reaching global audiences.
