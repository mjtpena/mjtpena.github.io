---
title: "Real-Time AI in Microsoft Fabric: Patterns and Practices"
author: Michael John Peña
draft: false
date: 2024-11-24
tags:
  - Azure
  - Microsoft Fabric
  - Real-Time AI
  - Streaming ML
  - AI

---

I wrote "Real-Time AI in Microsoft Fabric: Patterns and Practices" to share practical, production-minded guidance on this topic.

## Real-Time AI Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Real-Time AI Pipeline                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Event Source → Eventstream → AI Processing → Action         │
│                      │              │                        │
│                      ↓              ↓                        │
│               [Feature Store] [Model Registry]               │
│                      │              │                        │
│                      ↓              ↓                        │
│               [Real-time      [Online          [Reflex       │
│                Features]       Inference]       Triggers]    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Pattern 1: Real-Time Anomaly Detection

```python
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import StructType, StructField, StringType, DoubleType, TimestampType
from pyspark.ml.feature import VectorAssembler
from pyspark.ml.clustering import KMeans
import mlflow

spark = SparkSession.builder.appName("AnomalyDetection").getOrCreate()

# Read from EventHub stream
eventhub_config = {
    "eventhubs.connectionString": "your-connection-string",
    "eventhubs.consumerGroup": "$Default"
}

transaction_stream = spark.readStream \
    .format("eventhubs") \
    .options(**eventhub_config) \
    .load()

# Parse transaction data
schema = StructType([
    StructField("transaction_id", StringType()),
    StructField("customer_id", StringType()),
    StructField("amount", DoubleType()),
    StructField("merchant_category", StringType()),
    StructField("timestamp", TimestampType())
])

parsed_stream = transaction_stream.select(
    F.from_json(F.col("body").cast("string"), schema).alias("data")
).select("data.*")

# Calculate streaming features
windowed_features = parsed_stream \
    .withWatermark("timestamp", "10 minutes") \
    .groupBy(
        F.col("customer_id"),
        F.window("timestamp", "1 hour")
    ) \
    .agg(
        F.count("*").alias("tx_frequency_1h"),
        F.avg("amount").alias("avg_amount_1h"),
        F.stddev("amount").alias("std_amount_1h"),
        F.max("amount").alias("max_amount_1h")
    )

# Load anomaly detection model from MLflow
model_uri = "models:/transaction_anomaly_detector/production"
loaded_model = mlflow.spark.load_model(model_uri)

# Apply model to stream
def score_anomalies(batch_df, batch_id):
    """Score batch for anomalies."""
    # Prepare features
    assembler = VectorAssembler(
        inputCols=["tx_frequency_1h", "avg_amount_1h", "std_amount_1h", "max_amount_1h"],
        outputCol="features"
    )
    features_df = assembler.transform(batch_df)

    # Score with model
    predictions = loaded_model.transform(features_df)

    # Filter anomalies and send alerts
    anomalies = predictions.filter(F.col("prediction") == 1)

    if anomalies.count() > 0:
        # Write to Delta Lake for investigation
        anomalies.write.format("delta").mode("append").saveAsTable("alerts.transaction_anomalies")

        # Send to alert system
        send_alerts(anomalies.collect())

def send_alerts(anomalies):
    """Send anomaly alerts."""
    import requests

    webhook_url = "https://your-webhook-url"
    for row in anomalies:
        requests.post(webhook_url, json={
            "customer_id": row.customer_id,
            "anomaly_score": float(row.anomaly_score),
            "timestamp": str(row.window.start)
        })

# Start streaming query
query = windowed_features.writeStream \
    .foreachBatch(score_anomalies) \
    .outputMode("update") \
    .option("checkpointLocation", "/checkpoints/anomaly_detection") \
    .start()
```

## Pattern 2: Real-Time Recommendations

```python
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
import redis
import mlflow
from fastapi import FastAPI
from pydantic import BaseModel

spark = SparkSession.builder.appName("Recommendations").getOrCreate()

# Online feature store using Redis
redis_client = redis.Redis(host='your-redis-host', port=6379)

# Stream user activity to update features
activity_stream = spark.readStream \
    .format("eventhubs") \
    .options(**eventhub_config) \
    .load()

def update_user_features(batch_df, batch_id):
    """Update user features in Redis for online serving."""
    # Aggregate user behavior
    user_features = batch_df.groupBy("user_id").agg(
        F.collect_list("product_id").alias("recent_views"),
        F.collect_set("category").alias("recent_categories"),
        F.sum("session_duration").alias("total_session_time"),
        F.sum("cart_value").alias("current_cart_value")
    )

    # Write to Redis
    for row in user_features.collect():
        key = f"user_features:{row.user_id}"
        redis_client.hset(key, mapping={
            "recent_views": ",".join(row.recent_views[-10:]),  # Last 10 views
            "recent_categories": ",".join(row.recent_categories),
            "session_time": row.total_session_time,
            "cart_value": row.current_cart_value or 0
        })
        redis_client.expire(key, 3600)  # 1 hour TTL

# Start feature update stream
feature_query = activity_stream.writeStream \
    .foreachBatch(update_user_features) \
    .outputMode("update") \
    .option("checkpointLocation", "/checkpoints/user_features") \
    .start()

# FastAPI recommendation endpoint
app = FastAPI()

# Load recommendation model
recommender_model = mlflow.pyfunc.load_model("models:/product_recommender/production")

class RecommendationRequest(BaseModel):
    user_id: str
    current_page: str
    device_type: str

@app.post("/recommend")
async def get_recommendations(request: RecommendationRequest):
    # Get real-time features from Redis
    features = redis_client.hgetall(f"user_features:{request.user_id}")

    # Prepare input
    model_input = {
        "recent_views": features.get(b"recent_views", b"").decode().split(","),
        "recent_categories": features.get(b"recent_categories", b"").decode().split(","),
        "session_time": float(features.get(b"session_time", 0)),
        "cart_value": float(features.get(b"cart_value", 0)),
        "current_page": request.current_page,
        "device_type": request.device_type
    }

    # Get recommendations
    predictions = recommender_model.predict([model_input])

    return {
        "recommendations": predictions[0].tolist(),
        "user_id": request.user_id
    }
```

## Pattern 3: Real-Time NLP Processing

```python
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.sql.types import StringType, ArrayType, StructType, StructField
from openai import AzureOpenAI
import json

spark = SparkSession.builder.appName("NLPProcessing").getOrCreate()

# Azure OpenAI client
ai_client = AzureOpenAI(
    api_version="2024-02-15-preview",
    azure_endpoint="https://your-resource.openai.azure.com/"
)

# Read feedback stream
feedback_stream = spark.readStream \
    .format("eventhubs") \
    .options(**eventhub_config) \
    .load()

def analyze_feedback_batch(batch_df, batch_id):
    """Analyze customer feedback with AI."""

    def analyze_single(text):
        """Analyze a single feedback entry."""
        try:
            response = ai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{
                    "role": "system",
                    "content": """Analyze this customer feedback and return JSON with:
                    - sentiment: positive/negative/neutral
                    - urgency: 1-5
                    - intent: feature_request/bug_report/complaint/praise/question
                    - entities: list of products/features mentioned"""
                }, {
                    "role": "user",
                    "content": text
                }],
                response_format={"type": "json_object"}
            )
            return response.choices[0].message.content
        except Exception as e:
            return json.dumps({"error": str(e)})

    # Register UDF
    analyze_udf = F.udf(analyze_single, StringType())

    # Analyze feedback
    analyzed = batch_df.withColumn(
        "analysis",
        analyze_udf(F.col("feedback_text"))
    ).withColumn(
        "analysis_json",
        F.from_json(F.col("analysis"), analysis_schema)
    )

    # Route based on analysis
    # Urgent/negative -> immediate action
    urgent = analyzed.filter(
        (F.col("analysis_json.urgency") >= 4) |
        (F.col("analysis_json.sentiment") == "negative")
    )

    if urgent.count() > 0:
        # Send to urgent queue
        urgent.select("feedback_id", "feedback_text", "analysis_json.*") \
            .write.format("delta").mode("append") \
            .saveAsTable("feedback.urgent_queue")

    # Feature requests -> product team
    feature_requests = analyzed.filter(
        F.col("analysis_json.intent") == "feature_request"
    )

    if feature_requests.count() > 0:
        feature_requests.write.format("delta").mode("append") \
            .saveAsTable("feedback.feature_requests")

    # All feedback -> archive
    analyzed.write.format("delta").mode("append") \
        .saveAsTable("feedback.all_analyzed")

# Start analysis stream
analysis_query = feedback_stream.writeStream \
    .foreachBatch(analyze_feedback_batch) \
    .outputMode("append") \
    .option("checkpointLocation", "/checkpoints/feedback_analysis") \
    .start()
```

## Pattern 4: Real-Time Fraud Detection

```python
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from pyspark.ml.feature import VectorAssembler
import mlflow
import requests

spark = SparkSession.builder.appName("FraudDetection").getOrCreate()

# Load ensemble of models
fraud_models = {
    "gradient_boosting": mlflow.pyfunc.load_model("models:/fraud_gbm/production"),
    "neural_network": mlflow.pyfunc.load_model("models:/fraud_nn/production")
}

# Rule-based checks
FRAUD_RULES = [
    {
        "name": "velocity_check",
        "condition": "tx_count_1h > 10",
        "score_impact": 0.3
    },
    {
        "name": "new_device",
        "condition": "device_age_hours < 24",
        "score_impact": 0.2
    },
    {
        "name": "high_risk_merchant",
        "condition": "merchant_risk_score > 0.8",
        "score_impact": 0.15
    }
]

def score_fraud(batch_df, batch_id):
    """Score transactions for fraud."""

    # Calculate features
    features = ["amount", "tx_count_1h", "device_age_hours",
                "merchant_risk_score", "distance_from_home"]

    assembler = VectorAssembler(inputCols=features, outputCol="ml_features")
    feature_df = assembler.transform(batch_df)

    # Get ML model scores
    gbm_predictions = fraud_models["gradient_boosting"].predict(
        feature_df.select("ml_features").toPandas()
    )
    nn_predictions = fraud_models["neural_network"].predict(
        feature_df.select("ml_features").toPandas()
    )

    # Add predictions to dataframe
    feature_df = feature_df.withColumn(
        "gbm_score", F.lit(gbm_predictions.tolist())
    ).withColumn(
        "nn_score", F.lit(nn_predictions.tolist())
    )

    # Apply rules
    for rule in FRAUD_RULES:
        feature_df = feature_df.withColumn(
            f"rule_{rule['name']}",
            F.when(F.expr(rule["condition"]), rule["score_impact"]).otherwise(0)
        )

    # Calculate ensemble score
    rule_cols = [f"rule_{r['name']}" for r in FRAUD_RULES]
    feature_df = feature_df.withColumn(
        "rule_score",
        sum([F.col(c) for c in rule_cols])
    ).withColumn(
        "final_score",
        F.col("gbm_score") * 0.4 + F.col("nn_score") * 0.3 + F.col("rule_score") * 0.3
    ).withColumn(
        "is_fraud",
        F.col("final_score") > 0.75
    )

    # Take action on fraud
    fraud_transactions = feature_df.filter(F.col("is_fraud"))

    for row in fraud_transactions.collect():
        if row.final_score > 0.9:
            # Block immediately
            requests.post(
                "https://payments.contoso.com/api/block",
                json={"transaction_id": row.transaction_id}
            )
        else:
            # Send to review queue
            requests.post(
                "https://review-queue.contoso.com/api/queue",
                json={"transaction_id": row.transaction_id, "score": row.final_score}
            )

    # Write all scores for audit
    feature_df.select(
        "transaction_id", "final_score", "is_fraud",
        "gbm_score", "nn_score", "rule_score"
    ).write.format("delta").mode("append").saveAsTable("fraud.scores")

# Start fraud detection stream
fraud_query = transaction_stream.writeStream \
    .foreachBatch(score_fraud) \
    .outputMode("append") \
    .option("checkpointLocation", "/checkpoints/fraud_detection") \
    .start()
```

## Pattern 5: Real-Time Personalization

```python
from pyspark.sql import SparkSession
from pyspark.sql import functions as F
from fastapi import FastAPI
from contextlib import asynccontextmanager
import redis
import random
import hashlib
from datetime import datetime

spark = SparkSession.builder.appName("Personalization").getOrCreate()

# Contextual bandit for personalization
class ContextualBandit:
    """Simple contextual bandit for real-time personalization."""

    def __init__(self, actions: list, exploration_rate: float = 0.1):
        self.actions = actions
        self.exploration_rate = exploration_rate
        self.redis_client = redis.Redis(host='localhost', port=6379)

    def get_action(self, context: dict, user_id: str) -> tuple:
        """Select action based on context."""
        # Epsilon-greedy exploration
        if random.random() < self.exploration_rate:
            # Explore: random action
            action = random.choice(self.actions)
        else:
            # Exploit: best action for context
            action = self._get_best_action(context)

        # Generate decision ID for tracking
        decision_id = hashlib.md5(
            f"{user_id}:{datetime.utcnow().isoformat()}".encode()
        ).hexdigest()

        # Log decision
        self.redis_client.hset(f"decision:{decision_id}", mapping={
            "user_id": user_id,
            "action": action,
            "context": str(context),
            "timestamp": datetime.utcnow().isoformat()
        })
        self.redis_client.expire(f"decision:{decision_id}", 3600)

        return action, decision_id

    def _get_best_action(self, context: dict) -> str:
        """Get best action based on learned model."""
        # Simplified: use context features to select
        # In production, use trained model
        segment = context.get("user_segment", "default")

        # Get historical performance by segment
        best_action = None
        best_reward = 0

        for action in self.actions:
            key = f"bandit:{segment}:{action}"
            data = self.redis_client.hgetall(key)
            if data:
                trials = int(data.get(b"trials", 1))
                rewards = float(data.get(b"rewards", 0))
                avg_reward = rewards / trials
                if avg_reward > best_reward:
                    best_reward = avg_reward
                    best_action = action

        return best_action or random.choice(self.actions)

    def record_reward(self, decision_id: str, reward: float):
        """Record reward for a decision."""
        decision = self.redis_client.hgetall(f"decision:{decision_id}")
        if decision:
            action = decision[b"action"].decode()
            context = eval(decision[b"context"].decode())
            segment = context.get("user_segment", "default")

            key = f"bandit:{segment}:{action}"
            self.redis_client.hincrby(key, "trials", 1)
            self.redis_client.hincrbyfloat(key, "rewards", reward)

# Initialize bandit
bandit = ContextualBandit(
    actions=["hero_banner_a", "hero_banner_b", "hero_banner_c",
             "promo_offer_1", "promo_offer_2"],
    exploration_rate=0.1
)

# FastAPI app
app = FastAPI()

@app.post("/personalize")
async def personalize(user_id: str, user_segment: str, device_type: str,
                      cart_value: float, recent_categories: list):
    context = {
        "user_segment": user_segment,
        "device_type": device_type,
        "time_of_day": datetime.now().hour,
        "cart_value": cart_value,
        "recent_categories": recent_categories
    }

    action, decision_id = bandit.get_action(context, user_id)

    return {
        "action": action,
        "decision_id": decision_id
    }

@app.post("/reward")
async def reward(decision_id: str, converted: bool):
    reward_value = 1.0 if converted else 0.0
    bandit.record_reward(decision_id, reward_value)
    return {"recorded": True}
```

Real-time AI enables immediate, intelligent responses to streaming data. Start with well-defined use cases and gradually increase complexity.

## Resources

- [Spark Structured Streaming](https://spark.apache.org/docs/latest/structured-streaming-programming-guide.html)
- [MLflow Model Serving](https://mlflow.org/docs/latest/models.html)
- [Azure OpenAI Service](https://learn.microsoft.com/en-us/azure/ai-services/openai/)
- [Redis for Feature Stores](https://redis.io/docs/stack/search/reference/vectors/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
