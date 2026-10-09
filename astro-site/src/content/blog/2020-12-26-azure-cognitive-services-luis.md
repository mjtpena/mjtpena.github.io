---
title: "Azure LUIS: Language Understanding for Bots"
description: "LUIS: teaching machines to understand human language."
author: Michael John Peña
draft: false
date: 2020-12-26
tags:
  - Azure
  - LUIS
  - AI
  - NLP
---

## LUIS Concepts

- **Intent**: What the user wants to do
- **Entity**: Key information in the utterance
- **Utterance**: User's input text

```
"Book a flight from Seattle to London on Friday"
  │           │      │           │      │
  │           │      │           │      └── Entity: datetime
  │           │      │           └── Entity: destination
  │           │      └── Entity: origin
  │           └── Entity: travel type
  └── Intent: BookTravel
```

## Create LUIS App

```bash
az cognitiveservices account create \
    --name my-luis \
    --resource-group myRG \
    --kind LUIS.Authoring \
    --sku F0 \
    --location westus
```

## Define Intents and Entities

```json
{
    "name": "TravelBot",
    "culture": "en-us",
    "intents": [
        { "name": "BookFlight" },
        { "name": "CheckFlightStatus" },
        { "name": "CancelBooking" },
        { "name": "None" }
    ],
    "entities": [
        { "name": "City" },
        { "name": "datetime" }
    ],
    "prebuiltEntities": [
        { "name": "number" },
        { "name": "datetimeV2" },
        { "name": "geographyV2" }
    ],
    "utterances": [
        {
            "text": "book a flight from seattle to london",
            "intent": "BookFlight",
            "entities": [
                { "entity": "City", "startPos": 19, "endPos": 25 },
                { "entity": "City", "startPos": 30, "endPos": 35 }
            ]
        },
        {
            "text": "I need to fly to Paris tomorrow",
            "intent": "BookFlight",
            "entities": [
                { "entity": "City", "startPos": 17, "endPos": 21 }
            ]
        }
    ]
}
```

## Machine-Learned Entities

```json
{
    "name": "TravelDetails",
    "children": [
        {
            "name": "Origin",
            "features": [{ "featureName": "geographyV2" }]
        },
        {
            "name": "Destination",
            "features": [{ "featureName": "geographyV2" }]
        },
        {
            "name": "DepartureDate",
            "features": [{ "featureName": "datetimeV2" }]
        }
    ]
}
```

## Train and Publish

```python
from azure.cognitiveservices.language.luis.authoring import LUISAuthoringClient
from msrest.authentication import CognitiveServicesCredentials

authoring_client = LUISAuthoringClient(
    "https://westus.api.cognitive.microsoft.com",
    CognitiveServicesCredentials(authoring_key)
)

# Train
authoring_client.train.train_version(app_id, version_id)

# Wait for training
while True:
    status = authoring_client.train.get_status(app_id, version_id)
    if all(s.details.status in ["Success", "UpToDate"] for s in status):
        break
    time.sleep(5)

# Publish
authoring_client.apps.publish(app_id, {
    "versionId": version_id,
    "isStaging": False
})
```

## Query LUIS

```python
from azure.cognitiveservices.language.luis.runtime import LUISRuntimeClient

runtime_client = LUISRuntimeClient(
    "https://westus.api.cognitive.microsoft.com",
    CognitiveServicesCredentials(prediction_key)
)

# Predict
response = runtime_client.prediction.get_slot_prediction(
    app_id,
    "Production",
    {"query": "I want to book a flight to Paris tomorrow"}
)

print(f"Top Intent: {response.prediction.top_intent}")
print(f"Confidence: {response.prediction.intents[response.prediction.top_intent].score}")

for entity_name, entity_values in response.prediction.entities.items():
    print(f"Entity: {entity_name} = {entity_values}")
```

## Bot Integration

```csharp
// Bot Framework SDK
public class BookingDialog : ComponentDialog
{
    private readonly LuisRecognizer _recognizer;

    protected override async Task<DialogTurnResult> OnBeginDialogAsync(
        DialogContext innerDc, object options, CancellationToken cancellationToken)
    {
        var result = await _recognizer.RecognizeAsync(innerDc.Context, cancellationToken);

        switch (result.GetTopScoringIntent().intent)
        {
            case "BookFlight":
                var origin = result.Entities["City"]?[0]?.ToString();
                var destination = result.Entities["City"]?[1]?.ToString();
                // Continue booking flow
                break;

            case "CheckFlightStatus":
                // Show flight status
                break;

            default:
                await innerDc.Context.SendActivityAsync("I'm not sure what you mean.");
                break;
        }
    }
}
```

## Active Learning

LUIS suggests utterances to review:

```python
# Get review suggestions
suggestions = authoring_client.model.get_unlabeled_utterances(app_id, version_id)

for utterance in suggestions:
    print(f"Review: {utterance.text}")
    print(f"Suggested intent: {utterance.predicted_intent}")
```

LUIS: teaching machines to understand human language.
