---
title: Building Personalized Experiences with Azure Cognitive Services Personalizer
description: "Most recommendation systems I've seen in enterprise settings are either \"sort by recency\" in a trench coat, or a Spark job that runs weekly and calls itself…"
author: Michael John Peña
draft: false
date: 2021-02-03
url: /blog/azure-cognitive-services-personalizer/
tags:
  - Azure
  - Cognitive Services
  - AI
  - Machine Learning
  - Personalization
---

Most recommendation systems I've seen in enterprise settings are either "sort by recency" in a trench coat, or a Spark job that runs weekly and calls itself ML. Personalizer sits in between: reinforcement learning that adapts to user behaviour in real time without a data science team watching over it. You send it context (user features, available actions), it returns a ranked action, you send back the reward signal. The cold start problem is real but manageable, and the feedback loop is the cleanest implementation of contextual bandits I've used in production.

## How Personalizer Works

Personalizer uses a technique called contextual bandits, a type of reinforcement learning. The service:

1. **Ranks** a set of actions based on context and features
2. **Rewards** the chosen action based on user behavior
3. **Learns** from the reward to improve future rankings

This continuous learning loop means your application gets smarter over time without manual model retraining.

## Setting Up Personalizer

First, create a Personalizer resource in Azure:

```bash
# Create a resource group
az group create \
    --name rg-personalizer-demo \
    --location westus2

# Create a Personalizer resource
az cognitiveservices account create \
    --name my-personalizer \
    --resource-group rg-personalizer-demo \
    --kind Personalizer \
    --sku F0 \
    --location westus2 \
    --yes

# Get the endpoint and keys
az cognitiveservices account show \
    --name my-personalizer \
    --resource-group rg-personalizer-demo \
    --query "properties.endpoint"

az cognitiveservices account keys list \
    --name my-personalizer \
    --resource-group rg-personalizer-demo
```

## Building a Content Recommendation System

Let's build a news article recommendation system using Python:

```python
import requests
import json
import os
from datetime import datetime
import random

# Configuration
PERSONALIZER_ENDPOINT = os.environ.get("PERSONALIZER_ENDPOINT")
PERSONALIZER_KEY = os.environ.get("PERSONALIZER_KEY")

RANK_URL = f"{PERSONALIZER_ENDPOINT}/personalizer/v1.0/rank"
REWARD_URL = f"{PERSONALIZER_ENDPOINT}/personalizer/v1.0/events/{{event_id}}/reward"

headers = {
    "Ocp-Apim-Subscription-Key": PERSONALIZER_KEY,
    "Content-Type": "application/json"
}

# Define available articles (actions)
def get_articles():
    return [
        {
            "id": "article-tech-ai",
            "features": [
                {"category": "technology"},
                {"topic": "artificial-intelligence"},
                {"readingTime": 5},
                {"hasVideo": True}
            ]
        },
        {
            "id": "article-tech-cloud",
            "features": [
                {"category": "technology"},
                {"topic": "cloud-computing"},
                {"readingTime": 8},
                {"hasVideo": False}
            ]
        },
        {
            "id": "article-sports-football",
            "features": [
                {"category": "sports"},
                {"topic": "football"},
                {"readingTime": 3},
                {"hasVideo": True}
            ]
        },
        {
            "id": "article-finance-stocks",
            "features": [
                {"category": "finance"},
                {"topic": "stocks"},
                {"readingTime": 6},
                {"hasVideo": False}
            ]
        },
        {
            "id": "article-health-fitness",
            "features": [
                {"category": "health"},
                {"topic": "fitness"},
                {"readingTime": 4},
                {"hasVideo": True}
            ]
        }
    ]

# Get user context
def get_user_context(user_id, device_type, time_of_day, day_of_week):
    return [
        {"userId": user_id},
        {"deviceType": device_type},
        {"timeOfDay": time_of_day},
        {"dayOfWeek": day_of_week},
        {"prefersDarkMode": random.choice([True, False])},
        {"sessionDuration": random.randint(1, 30)}
    ]

class PersonalizerClient:
    def __init__(self):
        self.headers = headers

    def rank(self, context_features, actions, event_id=None):
        """Request a ranking of actions based on context."""
        request_body = {
            "contextFeatures": context_features,
            "actions": actions,
            "excludedActions": [],
            "eventId": event_id or str(datetime.now().timestamp()),
            "deferActivation": False
        }

        response = requests.post(
            RANK_URL,
            headers=self.headers,
            json=request_body
        )

        if response.status_code == 201:
            return response.json()
        else:
            raise Exception(f"Rank failed: {response.text}")

    def reward(self, event_id, reward_value):
        """Send a reward for a previous ranking decision."""
        url = REWARD_URL.format(event_id=event_id)
        request_body = {"value": reward_value}

        response = requests.post(
            url,
            headers=self.headers,
            json=request_body
        )

        if response.status_code != 204:
            raise Exception(f"Reward failed: {response.text}")

# Simulate user interaction
def simulate_user_interaction(client, user_profile):
    """Simulate a user session with article recommendations."""

    # Get context for this user
    context = get_user_context(
        user_id=user_profile["id"],
        device_type=user_profile["device"],
        time_of_day=user_profile["time_of_day"],
        day_of_week=user_profile["day_of_week"]
    )

    # Get available articles
    articles = get_articles()

    # Request ranking
    rank_response = client.rank(context, articles)

    event_id = rank_response["eventId"]
    recommended_article = rank_response["rewardActionId"]
    ranking = rank_response["ranking"]

    print(f"\nUser: {user_profile['id']}")
    print(f"Device: {user_profile['device']}")
    print(f"Time: {user_profile['time_of_day']}")
    print(f"Recommended Article: {recommended_article}")
    print(f"Ranking probabilities:")
    for item in ranking:
        print(f"  {item['id']}: {item['probability']:.4f}")

    # Simulate user behavior and calculate reward
    reward = calculate_reward(user_profile, recommended_article)

    # Send reward back to Personalizer
    client.reward(event_id, reward)
    print(f"Reward sent: {reward}")

    return recommended_article, reward

def calculate_reward(user_profile, article_id):
    """
    Calculate reward based on simulated user preferences.
    In production, this would be based on actual user behavior
    like clicks, time spent, shares, etc.
    """
    # Simulated user preferences
    preferences = {
        "tech-enthusiast": {
            "article-tech-ai": 1.0,
            "article-tech-cloud": 0.8,
            "article-sports-football": 0.1,
            "article-finance-stocks": 0.3,
            "article-health-fitness": 0.2
        },
        "sports-fan": {
            "article-tech-ai": 0.2,
            "article-tech-cloud": 0.1,
            "article-sports-football": 1.0,
            "article-finance-stocks": 0.3,
            "article-health-fitness": 0.5
        },
        "finance-pro": {
            "article-tech-ai": 0.4,
            "article-tech-cloud": 0.5,
            "article-sports-football": 0.1,
            "article-finance-stocks": 1.0,
            "article-health-fitness": 0.2
        }
    }

    user_type = user_profile.get("type", "tech-enthusiast")
    base_reward = preferences.get(user_type, {}).get(article_id, 0.5)

    # Add some noise to simulate real-world variance
    noise = random.uniform(-0.1, 0.1)
    reward = max(0, min(1, base_reward + noise))

    return round(reward, 2)

# Main simulation
def main():
    client = PersonalizerClient()

    # Define different user profiles
    user_profiles = [
        {"id": "user-001", "type": "tech-enthusiast", "device": "mobile",
         "time_of_day": "morning", "day_of_week": "Monday"},
        {"id": "user-002", "type": "sports-fan", "device": "desktop",
         "time_of_day": "evening", "day_of_week": "Saturday"},
        {"id": "user-003", "type": "finance-pro", "device": "tablet",
         "time_of_day": "afternoon", "day_of_week": "Wednesday"},
    ]

    # Run simulation for multiple iterations
    print("Starting Personalizer simulation...")
    print("=" * 50)

    total_reward = 0
    iterations = 100

    for i in range(iterations):
        user = random.choice(user_profiles)
        _, reward = simulate_user_interaction(client, user)
        total_reward += reward

    avg_reward = total_reward / iterations
    print(f"\n{'=' * 50}")
    print(f"Simulation complete!")
    print(f"Total iterations: {iterations}")
    print(f"Average reward: {avg_reward:.4f}")

if __name__ == "__main__":
    main()
```

## Configuring Learning Settings

Personalizer allows you to configure how it learns. Access these settings in the Azure Portal or via API:

```python
import requests

CONFIGURATION_URL = f"{PERSONALIZER_ENDPOINT}/personalizer/v1.0/configurations/service"

def get_configuration():
    response = requests.get(
        CONFIGURATION_URL,
        headers=headers
    )
    return response.json()

def update_configuration():
    """Update Personalizer learning settings."""
    config = {
        "rewardWaitTime": "PT10M",  # Wait 10 minutes for rewards
        "defaultReward": 0.0,
        "rewardAggregation": "earliest",
        "explorationPercentage": 0.2,  # 20% exploration
        "modelExportFrequency": "PT5M",
        "logRetentionDays": 90
    }

    response = requests.put(
        CONFIGURATION_URL,
        headers=headers,
        json=config
    )
    return response.status_code == 200
```

## Integrating with a Web Application

Here's how to integrate Personalizer with a Flask web application:

```python
from flask import Flask, request, jsonify, session
import uuid

app = Flask(__name__)
app.secret_key = 'your-secret-key'

client = PersonalizerClient()

@app.route('/api/recommendations', methods=['GET'])
def get_recommendations():
    """Get personalized article recommendations."""

    # Get or create session ID
    if 'session_id' not in session:
        session['session_id'] = str(uuid.uuid4())

    # Build context from request
    context = [
        {"userId": session['session_id']},
        {"deviceType": request.headers.get('User-Agent', 'unknown')},
        {"timeOfDay": get_time_of_day()},
        {"dayOfWeek": datetime.now().strftime('%A')},
        {"referrer": request.referrer or "direct"}
    ]

    # Get ranking
    articles = get_articles()
    rank_response = client.rank(context, articles)

    # Store event ID for reward
    session['last_event_id'] = rank_response['eventId']
    session['last_action'] = rank_response['rewardActionId']

    return jsonify({
        "recommended": rank_response['rewardActionId'],
        "eventId": rank_response['eventId'],
        "ranking": rank_response['ranking']
    })

@app.route('/api/reward', methods=['POST'])
def send_reward():
    """Send reward for user interaction."""

    data = request.json
    event_id = data.get('eventId') or session.get('last_event_id')

    if not event_id:
        return jsonify({"error": "No event ID found"}), 400

    # Calculate reward based on user action
    action = data.get('action', 'view')
    reward = calculate_action_reward(action)

    client.reward(event_id, reward)

    return jsonify({"success": True, "reward": reward})

def calculate_action_reward(action):
    """Convert user actions to reward values."""
    rewards = {
        "view": 0.2,
        "read": 0.5,
        "complete": 0.8,
        "share": 1.0,
        "dismiss": 0.0
    }
    return rewards.get(action, 0.0)

def get_time_of_day():
    hour = datetime.now().hour
    if 5 <= hour < 12:
        return "morning"
    elif 12 <= hour < 17:
        return "afternoon"
    elif 17 <= hour < 21:
        return "evening"
    else:
        return "night"

if __name__ == '__main__':
    app.run(debug=True)
```

## Best Practices

1. **Rich Context Features**: Include as many relevant context features as possible - user demographics, device info, time, location, previous behavior.

2. **Meaningful Rewards**: Design your reward signal carefully. A reward of 1.0 should represent the best possible outcome.

3. **Exploration vs Exploitation**: Adjust the exploration percentage based on your needs. Higher exploration means more learning but potentially worse initial recommendations.

4. **Reward Timing**: Send rewards as soon as you can measure user engagement, but within the reward wait time.

5. **Monitor Performance**: Use the Personalizer evaluation feature to measure offline performance and compare against baseline.

## Conclusion

Azure Cognitive Services Personalizer makes it easy to add personalization to your applications without building complex ML pipelines. The reinforcement learning approach means your recommendations improve automatically over time as users interact with your content.

Start with a simple use case like content recommendations or product suggestions, and expand from there as you see results.
