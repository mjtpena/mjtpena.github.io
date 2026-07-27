---
title: Document Translation at Scale with Azure Cognitive Services
author: Michael John Pena
draft: false
date: 2021-09-21
tags:
  - Azure
  - Cognitive Services
  - Translation
  - Localization
  - AI

---

I wrote "2021-09-21-azure-document-translation" to share practical, production-minded guidance on this topic.

## Document Translation Features

- **Format Preservation**: Maintains layout, tables, and images
- **Batch Processing**: Translate hundreds of documents at once
- **Multiple Formats**: PDF, Office documents, HTML, text files
- **Custom Models**: Use custom translation models for domain terminology
- **Glossary Support**: Ensure consistent translation of specific terms

## Setting Up Document Translation

```python
from azure.ai.translation.document import DocumentTranslationClient
from azure.core.credentials import AzureKeyCredential
from azure.storage.blob import BlobServiceClient, generate_container_sas, ContainerSasPermissions
from datetime import datetime, timedelta

class DocumentTranslator:
    def __init__(self, translation_key: str, translation_endpoint: str,
                 storage_connection: str):
        self.translation_client = DocumentTranslationClient(
            translation_endpoint,
            AzureKeyCredential(translation_key)
        )
        self.blob_service = BlobServiceClient.from_connection_string(storage_connection)

    def generate_sas_url(self, container_name: str, permissions: str = "rl") -> str:
        """Generate SAS URL for a container."""

        sas_token = generate_container_sas(
            account_name=self.blob_service.account_name,
            container_name=container_name,
            account_key=self.blob_service.credential.account_key,
            permission=ContainerSasPermissions(
                read="r" in permissions,
                write="w" in permissions,
                list="l" in permissions
            ),
            expiry=datetime.utcnow() + timedelta(hours=1)
        )

        return f"https://{self.blob_service.account_name}.blob.core.windows.net/{container_name}?{sas_token}"

    def translate_documents(self, source_container: str, target_container: str,
                          source_language: str, target_language: str) -> str:
        """Start document translation job."""

        source_url = self.generate_sas_url(source_container, "rl")
        target_url = self.generate_sas_url(target_container, "rwl")

        poller = self.translation_client.begin_translation(
            source_url,
            target_url,
            target_language,
            source_language=source_language
        )

        return poller

# Initialize translator
translator = DocumentTranslator(
    "your-translation-key",
    "https://your-translator.cognitiveservices.azure.com/",
    "your-storage-connection-string"
)

# Start translation
poller = translator.translate_documents(
    source_container="documents-english",
    target_container="documents-spanish",
    source_language="en",
    target_language="es"
)

# Wait for completion
result = poller.result()
print(f"Translation completed: {result.status}")
```

## Multi-Language Batch Translation

```python
from azure.ai.translation.document import DocumentTranslationInput, TranslationTarget

def translate_to_multiple_languages(client: DocumentTranslationClient,
                                    source_url: str,
                                    target_configs: list) -> dict:
    """Translate documents to multiple languages simultaneously."""

    inputs = [
        DocumentTranslationInput(
            source_url=source_url,
            targets=[
                TranslationTarget(
                    target_url=config["target_url"],
                    language=config["language"]
                )
                for config in target_configs
            ]
        )
    ]

    poller = client.begin_translation(inputs)

    # Monitor progress
    while not poller.done():
        status = poller.status()
        print(f"Status: {status}")

        # Get detailed progress
        for doc in poller.document_statuses():
            print(f"  Document: {doc.source_document_url}")
            print(f"    Status: {doc.status}")
            if doc.status == "Succeeded":
                print(f"    Translated to: {doc.translated_document_url}")

        import time
        time.sleep(10)

    return poller.result()

# Translate to multiple languages
target_languages = [
    {"language": "es", "target_url": "https://storage.blob.core.windows.net/spanish?sas=..."},
    {"language": "fr", "target_url": "https://storage.blob.core.windows.net/french?sas=..."},
    {"language": "de", "target_url": "https://storage.blob.core.windows.net/german?sas=..."},
    {"language": "ja", "target_url": "https://storage.blob.core.windows.net/japanese?sas=..."}
]

result = translate_to_multiple_languages(
    translator.translation_client,
    "https://storage.blob.core.windows.net/english?sas=...",
    target_languages
)
```

## Using Custom Glossaries

```python
from azure.ai.translation.document import TranslationGlossary

def translate_with_glossary(client: DocumentTranslationClient,
                           source_url: str,
                           target_url: str,
                           glossary_url: str,
                           source_lang: str,
                           target_lang: str):
    """Translate with custom glossary for consistent terminology."""

    inputs = [
        DocumentTranslationInput(
            source_url=source_url,
            targets=[
                TranslationTarget(
                    target_url=target_url,
                    language=target_lang,
                    glossaries=[
                        TranslationGlossary(
                            glossary_url=glossary_url,
                            file_format="TSV"  # or CSV, XLIFF
                        )
                    ]
                )
            ],
            source_language=source_lang
        )
    ]

    poller = client.begin_translation(inputs)
    return poller.result()

# Glossary file format (TSV):
# English	Spanish
# machine learning	aprendizaje automático
# cloud computing	computación en la nube
# artificial intelligence	inteligencia artificial
```

## Translation API for Text

```python
import requests
import uuid

class TextTranslator:
    def __init__(self, key: str, endpoint: str, region: str):
        self.key = key
        self.endpoint = endpoint
        self.region = region

    def translate(self, texts: list, target_language: str,
                  source_language: str = None) -> list:
        """Translate text using the Translator API."""

        path = '/translate?api-version=3.0'
        params = f'&to={target_language}'
        if source_language:
            params += f'&from={source_language}'

        url = self.endpoint + path + params

        headers = {
            'Ocp-Apim-Subscription-Key': self.key,
            'Ocp-Apim-Subscription-Region': self.region,
            'Content-type': 'application/json',
            'X-ClientTraceId': str(uuid.uuid4())
        }

        body = [{'text': text} for text in texts]

        response = requests.post(url, headers=headers, json=body)
        return response.json()

    def detect_language(self, texts: list) -> list:
        """Detect language of texts."""

        path = '/detect?api-version=3.0'
        url = self.endpoint + path

        headers = {
            'Ocp-Apim-Subscription-Key': self.key,
            'Ocp-Apim-Subscription-Region': self.region,
            'Content-type': 'application/json'
        }

        body = [{'text': text} for text in texts]

        response = requests.post(url, headers=headers, json=body)
        return response.json()

    def transliterate(self, texts: list, language: str,
                      from_script: str, to_script: str) -> list:
        """Convert text from one script to another."""

        path = f'/transliterate?api-version=3.0&language={language}&fromScript={from_script}&toScript={to_script}'
        url = self.endpoint + path

        headers = {
            'Ocp-Apim-Subscription-Key': self.key,
            'Ocp-Apim-Subscription-Region': self.region,
            'Content-type': 'application/json'
        }

        body = [{'text': text} for text in texts]

        response = requests.post(url, headers=headers, json=body)
        return response.json()

# Use text translator
text_translator = TextTranslator(
    "your-key",
    "https://api.cognitive.microsofttranslator.com",
    "westus"
)

# Translate text
texts = [
    "Hello, how are you?",
    "The weather is beautiful today."
]

results = text_translator.translate(texts, target_language="es")

for i, result in enumerate(results):
    print(f"Original: {texts[i]}")
    print(f"Translated: {result['translations'][0]['text']}")
    print()
```

## Building a Translation Service

```python
from flask import Flask, request, jsonify
from azure.ai.translation.document import DocumentTranslationClient
from azure.core.credentials import AzureKeyCredential
import os

app = Flask(__name__)

# Initialize clients
doc_translator = DocumentTranslationClient(
    os.environ["TRANSLATOR_ENDPOINT"],
    AzureKeyCredential(os.environ["TRANSLATOR_KEY"])
)

text_translator = TextTranslator(
    os.environ["TRANSLATOR_KEY"],
    "https://api.cognitive.microsofttranslator.com",
    os.environ["TRANSLATOR_REGION"]
)

@app.route('/translate/text', methods=['POST'])
def translate_text():
    """Translate text content."""

    data = request.json
    texts = data.get('texts', [])
    target_language = data.get('target_language', 'en')
    source_language = data.get('source_language')

    results = text_translator.translate(
        texts,
        target_language,
        source_language
    )

    translations = []
    for result in results:
        translations.append({
            "detected_language": result.get('detectedLanguage', {}).get('language'),
            "translation": result['translations'][0]['text']
        })

    return jsonify({"translations": translations})

@app.route('/translate/documents', methods=['POST'])
def translate_documents():
    """Start document translation job."""

    data = request.json
    source_url = data['source_url']
    target_url = data['target_url']
    target_language = data['target_language']
    source_language = data.get('source_language')

    poller = doc_translator.begin_translation(
        source_url,
        target_url,
        target_language,
        source_language=source_language
    )

    return jsonify({
        "job_id": poller.id,
        "status": poller.status()
    })

@app.route('/translate/status/<job_id>', methods=['GET'])
def get_translation_status(job_id):
    """Check translation job status."""

    statuses = list(doc_translator.list_document_statuses(job_id))

    return jsonify({
        "documents": [
            {
                "source": s.source_document_url,
                "status": s.status,
                "translated": s.translated_document_url if s.status == "Succeeded" else None
            }
            for s in statuses
        ]
    })

if __name__ == '__main__':
    app.run(port=5000)
```

## Supported File Formats

| Format | Extensions |
|--------|------------|
| PDF | .pdf |
| Word | .docx, .doc |
| PowerPoint | .pptx, .ppt |
| Excel | .xlsx, .xls |
| HTML | .html, .htm |
| Text | .txt |
| Rich Text | .rtf |
| Tab-separated | .tsv, .tab |
| Comma-separated | .csv |

## Best Practices

1. **Batch Wisely**: Group documents by language pair
2. **Use Glossaries**: Ensure terminology consistency
3. **Format Matters**: PDF translation quality varies by source
4. **Monitor Jobs**: Implement polling for long-running translations
5. **Handle Errors**: Some documents may fail; handle gracefully
6. **Cost Management**: Large documents incur higher costs

Document Translation enables global content delivery by making document localization efficient and scalable.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
