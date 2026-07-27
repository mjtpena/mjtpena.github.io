---
title: "Running Azure Cognitive Services in Containers"
author: Michael John Pena
draft: false
date: 2023-03-07
tags:
  - Azure
  - AI
  - Cognitive Services
  - Containers
  - Docker

---

I wrote "Running Azure Cognitive Services in Containers" to share practical, production-minded guidance on this topic.

## Why Containerized Cognitive Services?

- **Latency**: Process locally instead of round-trips to Azure
- **Offline capability**: Work without internet connectivity
- **Data residency**: Keep data on-premises
- **Cost optimization**: Reduce API call costs for high-volume scenarios
- **Air-gapped environments**: Deploy in secure networks

## Available Container Images

```bash
# Text Analytics
mcr.microsoft.com/azure-cognitive-services/textanalytics/sentiment
mcr.microsoft.com/azure-cognitive-services/textanalytics/language
mcr.microsoft.com/azure-cognitive-services/textanalytics/keyphrase

# Computer Vision
mcr.microsoft.com/azure-cognitive-services/vision/read

# Speech
mcr.microsoft.com/azure-cognitive-services/speechservices/speech-to-text
mcr.microsoft.com/azure-cognitive-services/speechservices/text-to-speech

# Form Recognizer
mcr.microsoft.com/azure-cognitive-services/form-recognizer/layout
mcr.microsoft.com/azure-cognitive-services/form-recognizer/invoice
```

## Setting Up Sentiment Analysis Container

### 1. Create Azure Resource for Billing

Even containerized services require an Azure resource for billing:

```bash
# Create resource group
az group create --name rg-cognitive-services --location australiaeast

# Create Text Analytics resource
az cognitiveservices account create \
    --name my-text-analytics \
    --resource-group rg-cognitive-services \
    --kind TextAnalytics \
    --sku S \
    --location australiaeast

# Get keys and endpoint
az cognitiveservices account keys list \
    --name my-text-analytics \
    --resource-group rg-cognitive-services

az cognitiveservices account show \
    --name my-text-analytics \
    --resource-group rg-cognitive-services \
    --query "properties.endpoint"
```

### 2. Run the Container

```bash
docker run -d \
    --name sentiment \
    -p 5000:5000 \
    -e Eula=accept \
    -e Billing=https://australiaeast.api.cognitive.microsoft.com/ \
    -e ApiKey=your-api-key \
    mcr.microsoft.com/azure-cognitive-services/textanalytics/sentiment:latest
```

### 3. Call the Local API

```python
import requests
import json

def analyze_sentiment_local(texts: list[str]) -> dict:
    """Analyze sentiment using local container."""
    url = "http://localhost:5000/text/analytics/v3.0/sentiment"

    documents = [
        {"id": str(i), "text": text, "language": "en"}
        for i, text in enumerate(texts)
    ]

    response = requests.post(
        url,
        headers={"Content-Type": "application/json"},
        json={"documents": documents}
    )

    return response.json()

# Usage
texts = [
    "Azure is fantastic for enterprise workloads!",
    "The deployment failed again, this is frustrating.",
    "The weather is nice today."
]

results = analyze_sentiment_local(texts)
for doc in results["documents"]:
    print(f"Text {doc['id']}: {doc['sentiment']} (confidence: {doc['confidenceScores']})")
```

## Docker Compose for Multiple Services

```yaml
version: '3.8'

services:
  sentiment:
    image: mcr.microsoft.com/azure-cognitive-services/textanalytics/sentiment:latest
    ports:
      - "5000:5000"
    environment:
      - Eula=accept
      - Billing=${COGNITIVE_SERVICES_ENDPOINT}
      - ApiKey=${COGNITIVE_SERVICES_KEY}
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G

  keyphrase:
    image: mcr.microsoft.com/azure-cognitive-services/textanalytics/keyphrase:latest
    ports:
      - "5001:5000"
    environment:
      - Eula=accept
      - Billing=${COGNITIVE_SERVICES_ENDPOINT}
      - ApiKey=${COGNITIVE_SERVICES_KEY}
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G

  language-detection:
    image: mcr.microsoft.com/azure-cognitive-services/textanalytics/language:latest
    ports:
      - "5002:5000"
    environment:
      - Eula=accept
      - Billing=${COGNITIVE_SERVICES_ENDPOINT}
      - ApiKey=${COGNITIVE_SERVICES_KEY}
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 2G

  ocr:
    image: mcr.microsoft.com/azure-cognitive-services/vision/read:3.2
    ports:
      - "5003:5000"
    environment:
      - Eula=accept
      - Billing=${COGNITIVE_SERVICES_ENDPOINT}
      - ApiKey=${COGNITIVE_SERVICES_KEY}
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 8G
```

## Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sentiment-analysis
  namespace: cognitive-services
spec:
  replicas: 3
  selector:
    matchLabels:
      app: sentiment-analysis
  template:
    metadata:
      labels:
        app: sentiment-analysis
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
              name: cognitive-services-secret
              key: endpoint
        - name: ApiKey
          valueFrom:
            secretKeyRef:
              name: cognitive-services-secret
              key: key
        resources:
          requests:
            memory: "2Gi"
            cpu: "1"
          limits:
            memory: "4Gi"
            cpu: "2"
        readinessProbe:
          httpGet:
            path: /status
            port: 5000
          initialDelaySeconds: 30
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /status
            port: 5000
          initialDelaySeconds: 60
          periodSeconds: 30\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
