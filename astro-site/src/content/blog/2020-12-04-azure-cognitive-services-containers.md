---
title: "Azure Cognitive Services Containers: AI On-Premises"
description: "\"Can I use Cognitive Services if my data can never leave the country?\" I get this question from public-sector and healthcare clients constantly. The answer…"
author: Michael John Peña
draft: false
date: 2020-12-04
tags:
  - Azure
  - Cognitive Services
  - Containers
  - AI
---

"Can I use Cognitive Services if my data can never leave the country?" I get this question from public-sector and healthcare clients constantly. The answer is yes—containers. Microsoft ships several Cognitive Services as Docker images you run on your own infrastructure, billed via a metering connection to Azure. Same APIs, same SDKs, your data stays put. It's also the cleanest answer for low-latency edge inferencing.

## Available Containers

| Service | Container |
|---------|-----------|
| Text Analytics | Sentiment, Key Phrases, Language Detection |
| Computer Vision | Read (OCR) |
| Face | Face Detection |
| Speech | Speech-to-Text, Text-to-Speech |
| Form Recognizer | Layout, Custom |
| LUIS | Language Understanding |

## Running Sentiment Analysis

```bash
docker run --rm -it -p 5000:5000 \
    mcr.microsoft.com/azure-cognitive-services/textanalytics/sentiment:latest \
    Eula=accept \
    Billing=https://myresource.cognitiveservices.azure.com/ \
    ApiKey=<your-key>
```

## Container Configuration

```yaml
# docker-compose.yml
version: '3'
services:
  sentiment:
    image: mcr.microsoft.com/azure-cognitive-services/textanalytics/sentiment:latest
    ports:
      - "5000:5000"
    environment:
      - Eula=accept
      - Billing=https://myresource.cognitiveservices.azure.com/
      - ApiKey=${COGNITIVE_SERVICES_KEY}
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 8G

  keyphrase:
    image: mcr.microsoft.com/azure-cognitive-services/textanalytics/keyphrase:latest
    ports:
      - "5001:5000"
    environment:
      - Eula=accept
      - Billing=https://myresource.cognitiveservices.azure.com/
      - ApiKey=${COGNITIVE_SERVICES_KEY}
```

## Calling the Container

```python
import requests

# Same API as cloud service
url = "http://localhost:5000/text/analytics/v3.1/sentiment"

documents = {
    "documents": [
        {"id": "1", "language": "en", "text": "I love this product!"},
        {"id": "2", "language": "en", "text": "Terrible experience."}
    ]
}

response = requests.post(url, json=documents)
results = response.json()

for doc in results["documents"]:
    print(f"Document {doc['id']}: {doc['sentiment']} (confidence: {doc['confidenceScores']})")
```

## Speech-to-Text Container

```bash
docker run --rm -it -p 5000:5000 \
    --memory 4g --cpus 4 \
    mcr.microsoft.com/azure-cognitive-services/speechservices/speech-to-text:latest \
    Eula=accept \
    Billing=https://myresource.cognitiveservices.azure.com/ \
    ApiKey=<your-key>
```

```python
# Transcribe audio
with open("audio.wav", "rb") as audio_file:
    response = requests.post(
        "http://localhost:5000/speech/recognition/conversation/cognitiveservices/v1",
        headers={
            "Content-Type": "audio/wav",
            "Accept": "application/json"
        },
        data=audio_file.read()
    )

print(response.json()["DisplayText"])
```

## Form Recognizer Container

```bash
docker run --rm -it -p 5000:5000 \
    mcr.microsoft.com/azure-cognitive-services/form-recognizer/layout:latest \
    Eula=accept \
    Billing=https://myresource.cognitiveservices.azure.com/ \
    ApiKey=<your-key>
```

## Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sentiment-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: sentiment
  template:
    metadata:
      labels:
        app: sentiment
    spec:
      containers:
      - name: sentiment
        image: mcr.microsoft.com/azure-cognitive-services/textanalytics/sentiment:latest
        ports:
        - containerPort: 5000
        env:
        - name: Eula
          value: "accept"
        - name: Billing
          valueFrom:
            secretKeyRef:
              name: cognitive-secrets
              key: billing-endpoint
        - name: ApiKey
          valueFrom:
            secretKeyRef:
              name: cognitive-secrets
              key: api-key
        resources:
          requests:
            memory: "4Gi"
            cpu: "2"
          limits:
            memory: "8Gi"
            cpu: "4"
```
