---
title: Building Conversational AI with Azure Language Understanding (LUIS)
description: "LUIS enables natural language understanding that powers conversational interfaces, making applications more intuitive and user-friendly."
author: Michael John Pena
draft: false
date: 2021-09-16
tags:
  - Azure
  - Cognitive Services
  - LUIS
  - NLU
  - Conversational AI
---

## Key Concepts

- **Intent**: The purpose or goal expressed in user input
- **Entity**: Key information to extract from the utterance
- **Utterance**: Example sentences that represent user inputs
- **Prebuilt Domains**: Ready-to-use models for common scenarios

## Creating a LUIS Application

```python
from azure.cognitiveservices.language.luis.authoring import LUISAuthoringClient
from azure.cognitiveservices.language.luis.runtime import LUISRuntimeClient
from msrest.authentication import CognitiveServicesCredentials

class LUISAppBuilder:
    def __init__(self, authoring_key: str, authoring_endpoint: str):
        self.client = LUISAuthoringClient(
            authoring_endpoint,
            CognitiveServicesCredentials(authoring_key)
        )

    def create_app(self, name: str, description: str, culture: str = "en-us") -> str:
        """Create a new LUIS application."""

        app_definition = {
            "name": name,
            "description": description,
            "culture": culture,
            "initial_version_id": "0.1"
        }

        app_id = self.client.apps.add(app_definition)
        print(f"Created app: {app_id}")
        return app_id

    def add_intent(self, app_id: str, version_id: str, intent_name: str) -> str:
        """Add an intent to the app."""

        intent_id = self.client.model.add_intent(
            app_id,
            version_id,
            intent_name
        )
        return intent_id

    def add_entity(self, app_id: str, version_id: str, entity_name: str) -> str:
        """Add a simple entity to the app."""

        entity_id = self.client.model.add_entity(
            app_id,
            version_id,
            name=entity_name
        )
        return entity_id

    def add_utterances(self, app_id: str, version_id: str, utterances: list):
        """Add labeled utterances for training."""

        self.client.examples.batch(
            app_id,
            version_id,
            utterances
        )

# Build a home automation LUIS app
builder = LUISAppBuilder(
    "your-authoring-key",
    "https://westus.api.cognitive.microsoft.com/"
)

app_id = builder.create_app(
    "HomeAutomation",
    "Control smart home devices"
)

version_id = "0.1"

# Add intents
builder.add_intent(app_id, version_id, "TurnOn")
builder.add_intent(app_id, version_id, "TurnOff")
builder.add_intent(app_id, version_id, "SetTemperature")

# Add entities
builder.add_entity(app_id, version_id, "Device")
builder.add_entity(app_id, version_id, "Room")
builder.add_entity(app_id, version_id, "Temperature")
```

## Adding Training Utterances

```python
def create_training_data():
    """Create labeled training utterances."""

    utterances = [
        # TurnOn intent
        {
            "text": "turn on the lights in the living room",
            "intent_name": "TurnOn",
            "entity_labels": [
                {"entity_name": "Device", "start_char_index": 12, "end_char_index": 18},
                {"entity_name": "Room", "start_char_index": 26, "end_char_index": 37}
            ]
        },
        {
            "text": "switch on the bedroom fan",
            "intent_name": "TurnOn",
            "entity_labels": [
                {"entity_name": "Room", "start_char_index": 14, "end_char_index": 21},
                {"entity_name": "Device", "start_char_index": 22, "end_char_index": 25}
            ]
        },
        {
            "text": "turn on kitchen lights",
            "intent_name": "TurnOn",
            "entity_labels": [
                {"entity_name": "Room", "start_char_index": 8, "end_char_index": 15},
                {"entity_name": "Device", "start_char_index": 16, "end_char_index": 22}
            ]
        },

        # TurnOff intent
        {
            "text": "turn off the living room lights",
            "intent_name": "TurnOff",
            "entity_labels": [
                {"entity_name": "Room", "start_char_index": 13, "end_char_index": 24},
                {"entity_name": "Device", "start_char_index": 25, "end_char_index": 31}
            ]
        },
        {
            "text": "switch off the bedroom fan",
            "intent_name": "TurnOff",
            "entity_labels": [
                {"entity_name": "Room", "start_char_index": 15, "end_char_index": 22},
                {"entity_name": "Device", "start_char_index": 23, "end_char_index": 26}
            ]
        },

        # SetTemperature intent
        {
            "text": "set the temperature to 72 degrees",
            "intent_name": "SetTemperature",
            "entity_labels": [
                {"entity_name": "Temperature", "start_char_index": 23, "end_char_index": 33}
            ]
        },
        {
            "text": "make it warmer in the bedroom",
            "intent_name": "SetTemperature",
            "entity_labels": [
                {"entity_name": "Room", "start_char_index": 22, "end_char_index": 29}
            ]
        }
    ]

    return utterances

# Add utterances
utterances = create_training_data()
builder.add_utterances(app_id, version_id, utterances)
```

## Training and Publishing

```python
class LUISTrainer:
    def __init__(self, authoring_key: str, authoring_endpoint: str):
        self.client = LUISAuthoringClient(
            authoring_endpoint,
            CognitiveServicesCredentials(authoring_key)
        )

    def train(self, app_id: str, version_id: str):
        """Train the LUIS model."""

        self.client.train.train_version(app_id, version_id)

        # Wait for training to complete
        import time
        while True:
            status = self.client.train.get_status(app_id, version_id)
            all_done = all(s.details.status in ['Success', 'UpToDate'] for s in status)

            if all_done:
                print("Training complete!")
                break

            print("Training in progress...")
            time.sleep(2)

    def publish(self, app_id: str, version_id: str, is_staging: bool = False):
        """Publish the app to an endpoint."""

        self.client.apps.publish(
            app_id,
            version_id=version_id,
            is_staging=is_staging
        )
        print(f"Published version {version_id}")

# Train and publish
trainer = LUISTrainer("your-authoring-key", "https://westus.api.cognitive.microsoft.com/")
trainer.train(app_id, version_id)
trainer.publish(app_id, version_id)
```

## Querying the LUIS Endpoint

```python
from azure.cognitiveservices.language.luis.runtime import LUISRuntimeClient
from msrest.authentication import CognitiveServicesCredentials

class LUISPredictor:
    def __init__(self, prediction_key: str, prediction_endpoint: str, app_id: str):
        self.client = LUISRuntimeClient(
            prediction_endpoint,
            CognitiveServicesCredentials(prediction_key)
        )
        self.app_id = app_id

    def predict(self, query: str, slot: str = "production") -> dict:
        """Get prediction for a query."""

        prediction_request = {
            "query": query
        }

        response = self.client.prediction.get_slot_prediction(
            self.app_id,
            slot,
            prediction_request,
            show_all_intents=True,
            verbose=True
        )

        return {
            "query": response.query,
            "top_intent": response.prediction.top_intent,
            "intents": {
                intent: score.score
                for intent, score in response.prediction.intents.items()
            },
            "entities": response.prediction.entities
        }

# Query the app
predictor = LUISPredictor(
    "your-prediction-key",
    "https://westus.api.cognitive.microsoft.com/",
    app_id
)

# Test predictions
queries = [
    "turn on the kitchen lights",
    "switch off bedroom fan",
    "set temperature to 68 degrees",
    "what's the weather like"  # None intent
]

for query in queries:
    result = predictor.predict(query)
    print(f"\nQuery: {result['query']}")
    print(f"Top Intent: {result['top_intent']}")
    print(f"Entities: {result['entities']}")
```

## Building a Chatbot with LUIS

```python
class HomeAutomationBot:
    def __init__(self, predictor: LUISPredictor):
        self.predictor = predictor
        self.device_states = {}

    def process_command(self, user_input: str) -> str:
        """Process user command and return response."""

        prediction = self.predictor.predict(user_input)
        intent = prediction['top_intent']
        entities = prediction['entities']

        if intent == "TurnOn":
            return self._handle_turn_on(entities)
        elif intent == "TurnOff":
            return self._handle_turn_off(entities)
        elif intent == "SetTemperature":
            return self._handle_set_temperature(entities)
        else:
            return "I'm sorry, I didn't understand that command."

    def _handle_turn_on(self, entities: dict) -> str:
        device = entities.get('Device', ['device'])[0]
        room = entities.get('Room', [''])[0]

        key = f"{room}_{device}".strip('_')
        self.device_states[key] = "on"

        if room:
            return f"Turning on the {device} in the {room}."
        return f"Turning on the {device}."

    def _handle_turn_off(self, entities: dict) -> str:
        device = entities.get('Device', ['device'])[0]
        room = entities.get('Room', [''])[0]

        key = f"{room}_{device}".strip('_')
        self.device_states[key] = "off"

        if room:
            return f"Turning off the {device} in the {room}."
        return f"Turning off the {device}."

    def _handle_set_temperature(self, entities: dict) -> str:
        temp = entities.get('Temperature', [None])[0]
        room = entities.get('Room', ['home'])[0]

        if temp:
            return f"Setting {room} temperature to {temp}."
        return f"What temperature would you like for the {room}?"

# Use the bot
bot = HomeAutomationBot(predictor)

commands = [
    "turn on the living room lights",
    "switch off the bedroom fan",
    "set the temperature to 72",
    "dim the kitchen lights"
]

for command in commands:
    response = bot.process_command(command)
    print(f"User: {command}")
    print(f"Bot: {response}\n")
```

## Prebuilt Domains and Entities

```python
def add_prebuilt_entities(client, app_id: str, version_id: str):
    """Add prebuilt entities for common data types."""

    prebuilt_entities = [
        "number",
        "datetimeV2",
        "temperature",
        "percentage",
        "ordinal"
    ]

    for entity in prebuilt_entities:
        client.model.add_prebuilt(
            app_id,
            version_id,
            [entity]
        )

def add_prebuilt_domain(client, app_id: str, version_id: str, domain: str):
    """Add a prebuilt domain like Calendar, Email, etc."""

    client.model.add_prebuilt_domain(
        app_id,
        version_id,
        domain
    )
```

## Best Practices

1. **Diverse Utterances**: Add 10-15 varied examples per intent
2. **Entity Labeling**: Be consistent in entity boundaries
3. **None Intent**: Always include a None intent for out-of-scope queries
4. **Phrase Lists**: Use phrase lists for domain vocabulary
5. **Active Learning**: Review endpoint logs and add corrections
6. **Testing**: Test with real user queries before deployment

LUIS enables natural language understanding that powers conversational interfaces, making applications more intuitive and user-friendly.
