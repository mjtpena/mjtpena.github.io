---
title: "Event-Driven AI: Building Reactive Intelligent Systems"
author: Michael John Peña
draft: false
date: 2025-02-01
tags:
  - AI
  - Event-Driven
  - Architecture
  - Azure
  - Serverless

---

I wrote "Event-Driven AI: Building Reactive Intelligent Systems" to share practical, production-minded guidance on this topic.

## Event-Driven AI Patterns

```
Event Sources                    Processing                      Outcomes
    │                               │                               │
    ▼                               ▼                               ▼
┌──────────────┐             ┌──────────────┐              ┌──────────────┐
│ Data Changes │────────────►│ AI Inference │─────────────►│ Alerts       │
│ User Actions │             │ Enrichment   │              │ Actions      │
│ System Events│             │ Classification│              │ Updates      │
│ Scheduled    │             │ Generation   │              │ Workflows    │
└──────────────┘             └──────────────┘              └──────────────┘
```

## Pattern 1: Event-Triggered Inference

```python
import azure.functions as func
from azure.ai.foundry import AIFoundryClient
from azure.servicebus import ServiceBusClient
import json

app = func.FunctionApp()

ai_client = AIFoundryClient(project="event-ai", credential=DefaultAzureCredential())

@app.service_bus_topic_trigger(
    arg_name="message",
    topic_name="data-changes",
    subscription_name="ai-processor",
    connection="ServiceBusConnection"
)
async def process_data_change(message: func.ServiceBusMessage):
    """Process data change events with AI."""

    event = json.loads(message.get_body().decode())

    if event["type"] == "customer_created":
        await enrich_customer(event["data"])
    elif event["type"] == "order_placed":
        await analyze_order(event["data"])
    elif event["type"] == "feedback_received":
        await analyze_sentiment(event["data"])

async def enrich_customer(customer: dict) -> dict:
    """Enrich new customer data with AI."""

    response = await ai_client.chat.complete_async(
        deployment="gpt-4o-mini",
        messages=[{
            "role": "user",
            "content": f"""Analyze this customer data and provide enrichment:

            {json.dumps(customer)}

            Return JSON with:
            - predicted_segment (enterprise/smb/consumer)
            - industry_classification
            - potential_value (high/medium/low)
            - recommended_products: []"""
        }]
    )

    enrichment = json.loads(response.choices[0].message.content)

    # Update customer record
    await update_customer(customer["id"], enrichment)

    # Trigger downstream events
    await publish_event("customer_enriched", {
        "customer_id": customer["id"],
        "enrichment": enrichment
    })

    return enrichment
```

## Pattern 2: Change Data Capture with AI

```python
from azure.cosmos import CosmosClient

class CDCProcessor:
    def __init__(self, cosmos_client: CosmosClient, ai_client: AIFoundryClient):
        self.cosmos = cosmos_client
        self.ai_client = ai_client
        self.container = cosmos_client.get_database_client("main").get_container_client("items")

    async def process_change_feed(self):
        """Process Cosmos DB change feed with AI."""

        # Start from beginning or continuation token
        change_feed = self.container.query_items_change_feed(
            is_start_from_beginning=False,
            partition_key_range_id="0"
        )

        for change in change_feed:
            await self._process_change(change)

    async def _process_change(self, change: dict):
        """Process individual change with AI."""

        # Determine change type
        if change.get("_deleted"):
            change_type = "delete"
        elif change.get("_ts") == change.get("_created_ts"):
            change_type = "create"
        else:
            change_type = "update"

        # AI-powered change analysis
        if change_type == "update":
            analysis = await self._analyze_update(change)

            if analysis.get("significant_change"):
                await self._trigger_workflow(change, analysis)

    async def _analyze_update(self, change: dict) -> dict:
        """Analyze if update is significant."""

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": f"""Analyze this data change:

                Changed document: {json.dumps(change)}

                Determine:
                1. Is this a significant change? (affects business metrics, requires action)
                2. What type of change? (correction, update, escalation)
                3. Should this trigger a workflow?

                Return JSON: {{significant_change: bool, change_type: str, trigger_workflow: bool, reason: str}}"""
            }]
        )

        return json.loads(response.choices[0].message.content)
```

## Pattern 3: Event Sourcing with AI

```python
from dataclasses import dataclass
from typing import Any
import uuid

@dataclass
class Event:
    id: str
    type: str
    data: dict
    timestamp: datetime
    ai_metadata: dict = None

class EventSourcedAI:
    def __init__(self, event_store, ai_client):
        self.event_store = event_store
        self.ai_client = ai_client

    async def handle_command(self, command: dict) -> list[Event]:
        """Process command and generate events with AI assistance."""

        # Get current state from events
        entity_id = command["entity_id"]
        current_state = await self._rebuild_state(entity_id)

        # AI-assisted decision making
        decision = await self._ai_decide(command, current_state)

        # Generate events based on decision
        events = self._generate_events(command, decision)

        # Store events
        for event in events:
            await self.event_store.append(event)

        return events

    async def _rebuild_state(self, entity_id: str) -> dict:
        """Rebuild state from event history."""

        events = await self.event_store.get_events(entity_id)

        state = {"id": entity_id}
        for event in events:
            state = self._apply_event(state, event)

        return state

    async def _ai_decide(self, command: dict, current_state: dict) -> dict:
        """Use AI to make decision based on command and state."""

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "system",
                "content": """You are a decision engine. Given a command and current state,
                determine the appropriate action and any validation errors."""
            }, {
                "role": "user",
                "content": f"""
                Command: {json.dumps(command)}
                Current State: {json.dumps(current_state)}

                Decide:
                1. Should this command be accepted?
                2. What events should be generated?
                3. Any side effects to trigger?

                Return JSON: {{
                    accepted: bool,
                    rejection_reason: str or null,
                    events_to_generate: [{{type: str, data: dict}}],
                    side_effects: [{{type: str, data: dict}}]
                }}"""
            }]
        )

        return json.loads(response.choices[0].message.content)
```

## Pattern 4: Saga Orchestration with AI

```python
class AISagaOrchestrator:
    """Orchestrate multi-step workflows with AI decision making."""

    def __init__(self, ai_client, service_bus_client):
        self.ai_client = ai_client
        self.service_bus = service_bus_client

    async def execute_saga(self, saga_type: str, initial_data: dict) -> dict:
        """Execute a saga with AI-guided steps."""

        saga_id = str(uuid.uuid4())
        state = {
            "saga_id": saga_id,
            "type": saga_type,
            "status": "running",
            "steps_completed": [],
            "data": initial_data
        }

        while state["status"] == "running":
            # AI determines next step
            next_step = await self._determine_next_step(state)

            if next_step["action"] == "complete":
                state["status"] = "completed"
                break

            if next_step["action"] == "compensate":
                await self._compensate(state)
                state["status"] = "compensated"
                break

            # Execute step
            try:
                result = await self._execute_step(next_step, state)
                state["steps_completed"].append({
                    "step": next_step,
                    "result": result,
                    "timestamp": datetime.utcnow().isoformat()
                })
                state["data"].update(result.get("data_updates", {}))
            except Exception as e:
                state["last_error"] = str(e)
                # AI decides whether to retry, compensate, or fail
                recovery = await self._determine_recovery(state, e)
                if recovery["action"] == "retry":
                    continue
                elif recovery["action"] == "compensate":
                    await self._compensate(state)
                    state["status"] = "compensated"
                else:
                    state["status"] = "failed"

        return state

    async def _determine_next_step(self, state: dict) -> dict:
        """AI determines the next step in the saga."""

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Determine the next step for this saga:

                Saga Type: {state['type']}
                Steps Completed: {json.dumps(state['steps_completed'])}
                Current Data: {json.dumps(state['data'])}

                Return JSON: {{
                    action: "execute" | "complete" | "compensate",
                    step_name: str,
                    step_config: dict,
                    reason: str
                }}"""
            }]
        )

        return json.loads(response.choices[0].message.content)
```

## Pattern 5: Event-Driven Notifications

```python
class AINotificationEngine:
    """Generate intelligent notifications from events."""

    def __init__(self, ai_client, notification_service):
        self.ai_client = ai_client
        self.notification_service = notification_service

    async def process_event(self, event: dict):
        """Process event and generate appropriate notifications."""

        # Determine notification need
        notification_spec = await self._determine_notification(event)

        if not notification_spec["should_notify"]:
            return

        # Generate personalized messages for each recipient
        for recipient in notification_spec["recipients"]:
            message = await self._generate_message(event, recipient)

            await self.notification_service.send(
                recipient=recipient,
                channel=notification_spec["channel"],
                message=message
            )

    async def _determine_notification(self, event: dict) -> dict:
        """Determine if and how to notify."""

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": f"""Analyze this event for notification:

                Event: {json.dumps(event)}

                Determine:
                1. Should this generate a notification?
                2. Who should be notified?
                3. What channel (email/slack/sms/push)?
                4. What urgency level?

                Return JSON: {{
                    should_notify: bool,
                    recipients: [{{id: str, role: str}}],
                    channel: str,
                    urgency: "immediate" | "normal" | "digest",
                    reason: str
                }}"""
            }]
        )

        return json.loads(response.choices[0].message.content)

    async def _generate_message(self, event: dict, recipient: dict) -> str:
        """Generate personalized notification message."""

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": f"""Generate a notification message:

                Event: {json.dumps(event)}
                Recipient Role: {recipient['role']}

                Write a clear, concise message appropriate for this recipient.
                Be specific and actionable."""
            }],
            max_tokens=150
        )

        return response.choices[0].message.content
```

## Best Practices

1. **Idempotency**: Ensure AI processing is idempotent for retry safety
2. **Async processing**: Use queues to decouple event production from AI processing
3. **Dead letter queues**: Handle failed AI processing gracefully
4. **Cost awareness**: Monitor AI costs per event type
5. **Observability**: Trace events through AI processing

Event-driven AI enables responsive, intelligent systems. Start with simple event handlers and evolve to complex orchestration as needed.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
