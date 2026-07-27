---
title: "Event-Driven AI Integration: Connecting AI to Business Events"
author: Michael John Peña
draft: false
date: 2025-02-21
tags:
  - AI
  - Event-Driven
  - Integration
  - Architecture
  - Azure

---

I wrote "Event-Driven AI Integration: Connecting AI to Business Events" to share practical, production-minded guidance on this topic.

## Event-Driven AI Patterns

```python
from azure.eventhub.aio import EventHubConsumerClient
from azure.ai.foundry import AIFoundryClient

class EventDrivenAI:
    """Process business events with AI."""

    def __init__(self, eventhub_conn: str, ai_client: AIFoundryClient):
        self.consumer = EventHubConsumerClient.from_connection_string(
            eventhub_conn,
            consumer_group="ai-processor"
        )
        self.ai_client = ai_client
        self.handlers = {}

    def register_handler(self, event_type: str, handler):
        """Register AI handler for event type."""
        self.handlers[event_type] = handler

    async def process_events(self):
        """Process events with registered AI handlers."""

        async def on_event(partition_context, event):
            data = json.loads(event.body_as_str())
            event_type = data.get("type")

            handler = self.handlers.get(event_type)
            if handler:
                result = await handler(data, self.ai_client)
                await self._emit_result(event_type, data, result)

            await partition_context.update_checkpoint(event)

        await self.consumer.receive(on_event=on_event, starting_position="-1")

# Usage
ai_events = EventDrivenAI(conn_str, ai_client)

@ai_events.register_handler("customer_feedback")
async def handle_feedback(event: dict, ai: AIFoundryClient) -> dict:
    response = await ai.chat.complete_async(
        deployment="gpt-4o-mini",
        messages=[{"role": "user", "content": f"Analyze sentiment: {event['text']}"}]
    )
    return {"sentiment": response.choices[0].message.content}

await ai_events.process_events()
```

Event-driven AI enables intelligent, automated responses to business events. Start with high-value events where AI can add immediate value.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
