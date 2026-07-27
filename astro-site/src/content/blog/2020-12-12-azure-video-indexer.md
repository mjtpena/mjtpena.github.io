---
title: "Azure Video Indexer: AI-Powered Video Analysis"
author: Michael John Peña
draft: false
date: 2020-12-12
tags:
  - Azure
  - AI
  - Video Indexer
  - Media

---

I wrote "Azure Video Indexer: AI-Powered Video Analysis" to share practical, production-minded guidance on this topic.

## Video Indexer Insights

| Insight | Description |
|---------|-------------|
| Transcript | Speech-to-text with speaker diarization |
| OCR | On-screen text extraction |
| Face detection | Identify and track faces |
| Emotions | Facial emotion analysis |
| Topics | Key topics and themes |
| Brands | Brand mentions (visual + audio) |
| Keywords | Extracted keywords |
| Scenes | Scene and shot detection |
| Labels | Object and action labels |

## Upload and Index Video

```python
import requests

account_id = "your-account-id"
location = "trial"  # or specific region
api_key = "your-api-key"

# Get access token
token_response = requests.get(
    f"https://api.videoindexer.ai/Auth/{location}/Accounts/{account_id}/AccessToken",
    params={"allowEdit": "true"},
    headers={"Ocp-Apim-Subscription-Key": api_key}
)
access_token = token_response.json()

# Upload video
upload_response = requests.post(
    f"https://api.videoindexer.ai/{location}/Accounts/{account_id}/Videos",
    params={
        "accessToken": access_token,
        "name": "My Video",
        "description": "Product demo",
        "privacy": "Private",
        "videoUrl": "https://storage.blob.core.windows.net/videos/demo.mp4"
    }
)
video_id = upload_response.json()["id"]
```

## Get Video Insights

```python
# Wait for indexing to complete
while True:
    status_response = requests.get(
        f"https://api.videoindexer.ai/{location}/Accounts/{account_id}/Videos/{video_id}/Index",
        params={"accessToken": access_token}
    )
    status = status_response.json()

    if status["state"] == "Processed":
        break
    elif status["state"] == "Failed":
        raise Exception("Indexing failed")

    time.sleep(30)

# Get insights
insights = status_response.json()

# Access transcript
for transcript in insights["videos"][0]["insights"]["transcript"]:
    print(f"[{transcript['instances'][0]['start']}] {transcript['text']}")

# Access detected faces
for face in insights["videos"][0]["insights"]["faces"]:
    print(f"Face: {face['name']} - Appearances: {len(face['instances'])}")

# Access topics
for topic in insights["videos"][0]["insights"]["topics"]:
    print(f"Topic: {topic['name']} - Confidence: {topic['confidence']}")
```

## Search Videos

```python
# Search across all videos
search_response = requests.get(
    f"https://api.videoindexer.ai/{location}/Accounts/{account_id}/Videos/Search",
    params={
        "accessToken": access_token,
        "query": "product launch",
        "searchInTranscript": "true",
        "searchInOcr": "true"
    }
)

results = search_response.json()
for result in results["results"]:
    print(f"Video: {result['name']}")
    for match in result["searchMatches"]:
        print(f"  - {match['type']}: {match['text']} at {match['startTime']}")
```

## Custom Models

### Custom Language Model

```python
# Create custom language model for domain-specific terms
language_model = requests.post(
    f"https://api.videoindexer.ai/{location}/Accounts/{account_id}/Customization/Language",
    params={"accessToken": access_token, "modelName": "Technical Terms"},
    json={
        "phrases": [
            "Azure Synapse",
            "Kubernetes",
            "microservices architecture"
        ]
    }
)
```

### Custom Person Model

```python
# Add known people for face recognition
person_model = requests.post(
    f"https://api.videoindexer.ai/{location}/Accounts/{account_id}/Customization/PersonModels",
    params={"accessToken": access_token, "name": "Company Executives"}
)

# Add person with images
requests.post(
    f"https://api.videoindexer.ai/{location}/Accounts/{account_id}/Customization/PersonModels/{model_id}/Persons",
    params={"accessToken": access_token, "name": "Jane Smith"},
    files={"file": open("jane.jpg", "rb")}
)
```

## Embed Player

```html
<iframe
    src="https://www.videoindexer.ai/embed/player/{account_id}/{video_id}?accessToken={token}&locale=en"
    width="800"
    height="450"
    frameborder="0"
    allowfullscreen>
</iframe>

<!-- Embed insights widget -->
<iframe
    src="https://www.videoindexer.ai/embed/insights/{account_id}/{video_id}?accessToken={token}&widgets=keywords,topics,faces"
    width="300"
    height="600"
    frameborder="0">
</iframe>
```

Video Indexer: unlock the content inside your videos.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
