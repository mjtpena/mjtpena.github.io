---
title: Natural Language Understanding with LUIS
author: Michael John Pena
draft: false
date: 2021-03-26
url: /blog/luis-language-understanding/
tags:
  - Azure
  - LUIS
  - NLP
  - Cognitive Services
  - AI
---

## LUIS Concepts

- **Intents**: Categories of user actions (e.g., BookFlight, GetWeather)
- **Entities**: Important data to extract (e.g., locations, dates, quantities)
- **Utterances**: Example phrases users might say
- **Patterns**: Templates for common phrase structures

## Creating a LUIS Application

```python
from azure.cognitiveservices.language.luis.authoring import LUISAuthoringClient
from azure.cognitiveservices.language.luis.runtime import LUISRuntimeClient
from msrest.authentication import CognitiveServicesCredentials
import json

class LuisManager:
    def __init__(self, authoring_key, authoring_endpoint, prediction_key, prediction_endpoint):
        self.authoring_client = LUISAuthoringClient(
            authoring_endpoint,
            CognitiveServicesCredentials(authoring_key)
        )
        self.runtime_client = LUISRuntimeClient(
            prediction_endpoint,
            CognitiveServicesCredentials(prediction_key)
        )
        self.app_id = None
        self.version_id = "0.1"

    def create_app(self, name, description, culture="en-us"):
        """Create a new LUIS application."""
        app_definition = {
            "name": name,
            "description": description,
            "culture": culture,
            "initial_version_id": self.version_id
        }

        self.app_id = self.authoring_client.apps.add(app_definition)
        print(f"Created LUIS app: {self.app_id}")
        return self.app_id

    def add_intent(self, intent_name):
        """Add an intent to the app."""
        intent_id = self.authoring_client.model.add_intent(
            self.app_id,
            self.version_id,
            intent_name
        )
        print(f"Added intent '{intent_name}': {intent_id}")
        return intent_id

    def add_entity(self, entity_name, entity_type="simple"):
        """Add an entity to the app."""
        if entity_type == "simple":
            entity_id = self.authoring_client.model.add_entity(
                self.app_id,
                self.version_id,
                name=entity_name
            )
        elif entity_type == "list":
            entity_id = self.authoring_client.model.add_closed_list(
                self.app_id,
                self.version_id,
                {"name": entity_name}
            )
        elif entity_type == "prebuilt":
            entity_id = self.authoring_client.model.add_prebuilt(
                self.app_id,
                self.version_id,
                [entity_name]
            )

        print(f"Added entity '{entity_name}': {entity_id}")
        return entity_id

    def add_utterances(self, intent_name, utterances):
        """Add labeled utterances for training."""
        labeled_utterances = []

        for utterance in utterances:
            labeled = {
                "text": utterance["text"],
                "intent_name": intent_name,
                "entity_labels": utterance.get("entities", [])
            }
            labeled_utterances.append(labeled)

        result = self.authoring_client.examples.batch(
            self.app_id,
            self.version_id,
            labeled_utterances
        )

        print(f"Added {len(labeled_utterances)} utterances")
        return result

    def train(self):
        """Train the LUIS model."""
        self.authoring_client.train.train_version(
            self.app_id,
            self.version_id
        )

        # Wait for training to complete
        import time
        while True:
            status = self.authoring_client.train.get_status(
                self.app_id,
                self.version_id
            )

            all_done = all(
                s.details.status in ["Success", "UpToDate"]
                for s in status
            )

            if all_done:
                print("Training completed!")
                break

            print("Training in progress...")
            time.sleep(5)

    def publish(self, is_staging=False):
        """Publish the app."""
        response = self.authoring_client.apps.publish(
            self.app_id,
            {
                "version_id": self.version_id,
                "is_staging": is_staging
            }
        )
        print(f"Published to {'staging' if is_staging else 'production'}")
        return response

    def predict(self, query):
        """Get prediction for a query."""
        prediction_request = {"query": query}

        response = self.runtime_client.prediction.get_slot_prediction(
            self.app_id,
            "Production",
            prediction_request
        )

        return {
            "query": response.query,
            "top_intent": response.prediction.top_intent,
            "intents": response.prediction.intents,
            "entities": response.prediction.entities
        }


# Build a travel booking LUIS app
luis = LuisManager(
    authoring_key="your-authoring-key",
    authoring_endpoint="https://westus.api.cognitive.microsoft.com",
    prediction_key="your-prediction-key",
    prediction_endpoint="https://westus.api.cognitive.microsoft.com"
)

# Create app
luis.create_app("TravelBooking", "Travel booking assistant")

# Add intents
luis.add_intent("BookFlight")
luis.add_intent("BookHotel")
luis.add_intent("GetWeather")
luis.add_intent("Cancel")
luis.add_intent("None")

# Add prebuilt entities
luis.add_entity("datetimeV2", "prebuilt")
luis.add_entity("number", "prebuilt")
luis.add_entity("geographyV2", "prebuilt")

# Add custom entities
luis.add_entity("TravelClass")

# Add utterances for BookFlight
book_flight_utterances = [
    {
        "text": "book a flight from seattle to new york",
        "entities": [
            {"entity_name": "geographyV2", "start_char_index": 19, "end_char_index": 26},
            {"entity_name": "geographyV2", "start_char_index": 31, "end_char_index": 39}
        ]
    },
    {
        "text": "I need to fly to london next monday",
        "entities": [
            {"entity_name": "geographyV2", "start_char_index": 17, "end_char_index": 23}
        ]
    },
    {
        "text": "book 2 business class tickets to paris for tomorrow",
        "entities": [
            {"entity_name": "TravelClass", "start_char_index": 9, "end_char_index": 23},
            {"entity_name": "geographyV2", "start_char_index": 35, "end_char_index": 40}
        ]
    },
    {"text": "find me a flight", "entities": []},
    {"text": "I want to book a plane ticket", "entities": []},
    {"text": "search for flights to tokyo", "entities": [
        {"entity_name": "geographyV2", "start_char_index": 22, "end_char_index": 27}
    ]}
]

luis.add_utterances("BookFlight", book_flight_utterances)

# Train and publish
luis.train()
luis.publish()
```

## Using Patterns

```python
def add_patterns(luis_manager):
    """Add patterns to improve recognition."""
    patterns = [
        # BookFlight patterns
        {
            "pattern": "book a flight from {Origin:geographyV2} to {Destination:geographyV2}",
            "intent": "BookFlight"
        },
        {
            "pattern": "fly [me] to {Destination:geographyV2} [on] {Date:datetimeV2}",
            "intent": "BookFlight"
        },
        {
            "pattern": "I want [to book] {Number} [tickets] to {Destination:geographyV2}",
            "intent": "BookFlight"
        },
        # BookHotel patterns
        {
            "pattern": "book a hotel in {Location:geographyV2} for {Duration:datetimeV2}",
            "intent": "BookHotel"
        },
        {
            "pattern": "find [me] a room in {Location:geographyV2}",
            "intent": "BookHotel"
        }
    ]

    for pattern in patterns:
        luis_manager.authoring_client.pattern.add_pattern(
            luis_manager.app_id,
            luis_manager.version_id,
            pattern
        )

    print(f"Added {len(patterns)} patterns")
```

## Phrase Lists for Better Recognition

```python
def add_phrase_lists(luis_manager):
    """Add phrase lists to improve entity recognition."""
    # Travel class phrase list
    travel_classes = {
        "name": "TravelClassPhrases",
        "phrases": "economy,business,first class,premium economy,coach",
        "is_exchangeable": True
    }

    luis_manager.authoring_client.features.add_phrase_list(
        luis_manager.app_id,
        luis_manager.version_id,
        travel_classes
    )

    # Hotel types phrase list
    hotel_types = {
        "name": "HotelTypePhrases",
        "phrases": "hotel,motel,resort,bed and breakfast,hostel,airbnb",
        "is_exchangeable": True
    }

    luis_manager.authoring_client.features.add_phrase_list(
        luis_manager.app_id,
        luis_manager.version_id,
        hotel_types
    )
```

## Bot Framework Integration

```javascript
// luisRecognizer.js
const { LuisRecognizer } = require('botbuilder-ai');

class TravelRecognizer {
    constructor(config) {
        const luisConfig = {
            applicationId: config.applicationId,
            endpointKey: config.endpointKey,
            endpoint: config.endpoint
        };

        const recognizerOptions = {
            apiVersion: 'v3',
            includeAllIntents: true,
            includeInstanceData: true
        };

        this.recognizer = new LuisRecognizer(luisConfig, recognizerOptions);
    }

    async recognize(context) {
        const result = await this.recognizer.recognize(context);

        return {
            topIntent: LuisRecognizer.topIntent(result),
            intents: result.intents,
            entities: this.extractEntities(result)
        };
    }

    extractEntities(result) {
        const entities = {};

        // Extract geography entities
        if (result.entities.$instance.geographyV2) {
            const geos = result.entities.$instance.geographyV2;
            if (geos.length >= 2) {
                entities.origin = geos[0].text;
                entities.destination = geos[1].text;
            } else if (geos.length === 1) {
                entities.destination = geos[0].text;
            }
        }

        // Extract datetime
        if (result.entities.datetimeV2) {
            const datetime = result.entities.datetimeV2[0];
            entities.travelDate = datetime.values[0].value || datetime.values[0].start;
        }

        // Extract number (passengers)
        if (result.entities.number) {
            entities.passengers = result.entities.number[0];
        }

        // Extract travel class
        if (result.entities.TravelClass) {
            entities.travelClass = result.entities.TravelClass[0];
        }

        return entities;
    }
}

// Usage in bot
class TravelBot extends ActivityHandler {
    constructor(luisRecognizer, bookingDialog) {
        super();
        this.luisRecognizer = luisRecognizer;
        this.bookingDialog = bookingDialog;

        this.onMessage(async (context, next) => {
            const result = await this.luisRecognizer.recognize(context);

            switch (result.topIntent) {
                case 'BookFlight':
                    await this.handleBookFlight(context, result.entities);
                    break;
                case 'BookHotel':
                    await this.handleBookHotel(context, result.entities);
                    break;
                case 'GetWeather':
                    await this.handleGetWeather(context, result.entities);
                    break;
                case 'Cancel':
                    await context.sendActivity('Booking cancelled.');
                    break;
                default:
                    await context.sendActivity(
                        "I can help you book flights and hotels. Try 'book a flight to Paris'."
                    );
            }

            await next();
        });
    }

    async handleBookFlight(context, entities) {
        if (entities.destination) {
            await context.sendActivity(
                `I'll help you book a flight to ${entities.destination}.`
            );
            // Start booking dialog with pre-filled entities
        } else {
            await context.sendActivity('Where would you like to fly to?');
        }
    }
}
```

## Active Learning

```python
def review_suggestions(luis_manager):
    """Get and review active learning suggestions."""
    # Get unlabeled utterances
    suggestions = luis_manager.authoring_client.model.review_labeled_examples(
        luis_manager.app_id,
        luis_manager.version_id
    )

    for suggestion in suggestions:
        print(f"Utterance: {suggestion.text}")
        print(f"Predicted intent: {suggestion.intent_predictions[0].name}")
        print(f"Score: {suggestion.intent_predictions[0].score}")
        print("---")

    return suggestions


def add_suggestion_as_example(luis_manager, suggestion, correct_intent):
    """Add a suggestion as a training example."""
    labeled_example = {
        "text": suggestion.text,
        "intent_name": correct_intent,
        "entity_labels": []
    }

    luis_manager.authoring_client.examples.add(
        luis_manager.app_id,
        luis_manager.version_id,
        labeled_example
    )

    print(f"Added '{suggestion.text}' to intent '{correct_intent}'")
```

## Batch Testing

```python
def batch_test(luis_manager, test_file_path):
    """Run batch testing on LUIS app."""
    import json

    with open(test_file_path, 'r') as f:
        test_utterances = json.load(f)

    results = {
        "correct": 0,
        "incorrect": 0,
        "errors": []
    }

    for test in test_utterances:
        prediction = luis_manager.predict(test["text"])

        if prediction["top_intent"] == test["expected_intent"]:
            results["correct"] += 1
        else:
            results["incorrect"] += 1
            results["errors"].append({
                "text": test["text"],
                "expected": test["expected_intent"],
                "predicted": prediction["top_intent"],
                "score": prediction["intents"][prediction["top_intent"]]["score"]
            })

    total = results["correct"] + results["incorrect"]
    accuracy = results["correct"] / total * 100

    print(f"Accuracy: {accuracy:.2f}%")
    print(f"Correct: {results['correct']}/{total}")
    print(f"Incorrect: {results['incorrect']}/{total}")

    return results


# Test file format
test_data = [
    {"text": "book a flight to paris", "expected_intent": "BookFlight"},
    {"text": "I need a hotel in london", "expected_intent": "BookHotel"},
    {"text": "what's the weather like", "expected_intent": "GetWeather"},
    {"text": "cancel my booking", "expected_intent": "Cancel"}
]
```

## Conclusion

LUIS enables sophisticated natural language understanding:

- **Intent classification** for understanding user goals
- **Entity extraction** for capturing important information
- **Patterns** for handling variations in phrasing
- **Active learning** for continuous improvement
- **Seamless Bot Framework integration**

It's the foundation for building conversational AI that truly understands users.
