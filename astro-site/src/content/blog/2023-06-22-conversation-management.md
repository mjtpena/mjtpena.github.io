---
title: "Conversation Management: Building Production Chat Systems"
description: "Robust conversation management enables reliable production chat systems. Tomorrow, I will cover context pruning strategies."
author: Michael John Peña
draft: false
date: 2023-06-22
tags:
  - Azure OpenAI
  - Chatbots
  - Production Systems
  - State Management
  - Architecture
---

## Conversation Lifecycle

```python
from enum import Enum
from datetime import datetime, timedelta

class ConversationStatus(Enum):
    ACTIVE = "active"
    IDLE = "idle"
    WAITING_FOR_INPUT = "waiting_for_input"
    PROCESSING = "processing"
    ESCALATED = "escalated"
    CLOSED = "closed"

class ConversationLifecycle:
    def __init__(self, idle_timeout_minutes: int = 30, max_duration_hours: int = 24):
        self.idle_timeout = timedelta(minutes=idle_timeout_minutes)
        self.max_duration = timedelta(hours=max_duration_hours)

    def check_status(self, conversation) -> ConversationStatus:
        now = datetime.utcnow()

        # Check if conversation has exceeded max duration
        if now - conversation.created_at > self.max_duration:
            return ConversationStatus.CLOSED

        # Check if idle too long
        if now - conversation.updated_at > self.idle_timeout:
            return ConversationStatus.IDLE

        return conversation.status

    def handle_idle(self, conversation, manager):
        """Handle idle conversation"""
        # Send reminder or close
        if conversation.reminder_sent:
            manager.close_conversation(conversation.session_id, "Closed due to inactivity")
        else:
            manager.send_message(
                conversation.session_id,
                "Are you still there? Let me know if you need any more help.",
                role="system"
            )
            conversation.reminder_sent = True
```

## Conversation Routing

```python
class ConversationRouter:
    """Route conversations based on intent and context"""

    def __init__(self, client):
        self.client = client
        self.handlers = {}

    def register_handler(self, intent: str, handler: callable):
        self.handlers[intent] = handler

    def classify_intent(self, message: str, context: dict) -> str:
        """Classify user intent"""
        classification_prompt = f"""Classify the user's intent from this message.

Context: {json.dumps(context)}
User message: {message}

Possible intents:
- order_status: Checking order status
- product_inquiry: Questions about products
- support_request: Technical support needed
- billing_question: Payment or billing related
- general_inquiry: General questions
- complaint: Expressing dissatisfaction
- human_agent: Requesting human assistance

Return only the intent name."""

        response = self.client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": classification_prompt}],
            max_tokens=20,
            temperature=0
        )

        return response.choices[0].message.content.strip().lower()

    def route(self, message: str, conversation) -> str:
        """Route message to appropriate handler"""
        intent = self.classify_intent(message, conversation.context)

        if intent in self.handlers:
            return self.handlers[intent](message, conversation)

        # Default handler
        return self.handlers.get("general_inquiry", self.default_handler)(message, conversation)

    def default_handler(self, message: str, conversation) -> str:
        return "I'm not sure how to help with that. Could you please rephrase?"
```

## Handoff to Human Agents

```python
class HumanHandoff:
    """Manage handoff to human agents"""

    def __init__(self, queue_service):
        self.queue = queue_service
        self.escalation_triggers = [
            "speak to human",
            "talk to agent",
            "real person",
            "escalate",
            "supervisor"
        ]

    def should_escalate(self, message: str, conversation) -> tuple[bool, str]:
        """Determine if conversation should escalate"""

        # Explicit request
        if any(trigger in message.lower() for trigger in self.escalation_triggers):
            return True, "User requested human assistance"

        # Too many failed attempts
        if conversation.context.get("failed_attempts", 0) >= 3:
            return True, "Multiple failed resolution attempts"

        # Sentiment analysis
        if self._detect_frustration(conversation.messages):
            return True, "Detected user frustration"

        # Complex issue
        if conversation.context.get("complexity_score", 0) > 8:
            return True, "Issue too complex for automated resolution"

        return False, None

    def initiate_handoff(self, conversation, reason: str) -> dict:
        """Create handoff request"""

        # Prepare summary for human agent
        summary = self._create_handoff_summary(conversation)

        handoff_request = {
            "conversation_id": conversation.session_id,
            "reason": reason,
            "summary": summary,
            "priority": self._calculate_priority(conversation),
            "context": conversation.context,
            "messages": [m.to_dict() for m in conversation.messages[-20:]],
            "created_at": datetime.utcnow().isoformat()
        }

        # Add to queue
        ticket_id = self.queue.add(handoff_request)

        return {
            "ticket_id": ticket_id,
            "estimated_wait": self.queue.estimate_wait_time(),
            "message": "I'm connecting you with a human agent. Please wait..."
        }

    def _create_handoff_summary(self, conversation) -> str:
        """Create summary for human agent"""
        prompt = f"""Create a brief summary for a human agent taking over this conversation:

Conversation:
{chr(10).join([f"{m.role}: {m.content}" for m in conversation.messages])}

Include:
1. Customer's main issue/request
2. What the bot tried
3. Why escalation is needed
4. Any relevant context (order numbers, account info, etc.)"""

        response = self.client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200
        )

        return response.choices[0].message.content

    def _detect_frustration(self, messages) -> bool:
        """Detect user frustration from messages"""
        recent_user_messages = [m.content for m in messages[-5:] if m.role == "user"]

        indicators = ["!", "?!", "frustrated", "annoyed", "useless", "terrible", "worst"]
        frustration_count = sum(
            1 for msg in recent_user_messages
            if any(ind in msg.lower() for ind in indicators)
        )

        return frustration_count >= 2

    def _calculate_priority(self, conversation) -> int:
        """Calculate handoff priority (1=highest)"""
        priority = 5  # Default medium

        # VIP customer
        if conversation.context.get("customer_tier") == "premium":
            priority -= 2

        # Payment issue
        if conversation.context.get("intent") == "billing":
            priority -= 1

        # Long wait already
        duration = datetime.utcnow() - conversation.created_at
        if duration > timedelta(minutes=15):
            priority -= 1

        return max(1, priority)
```

## Conversation Analytics

```python
class ConversationAnalytics:
    """Track and analyze conversation metrics"""

    def __init__(self, metrics_store):
        self.store = metrics_store

    def track_conversation(self, conversation):
        """Track conversation metrics"""
        metrics = {
            "session_id": conversation.session_id,
            "duration_seconds": (conversation.updated_at - conversation.created_at).total_seconds(),
            "message_count": len(conversation.messages),
            "user_messages": len([m for m in conversation.messages if m.role == "user"]),
            "resolution_status": conversation.context.get("resolved", False),
            "escalated": conversation.status == ConversationStatus.ESCALATED,
            "intents": conversation.context.get("intents_detected", []),
            "satisfaction_score": conversation.context.get("satisfaction"),
            "timestamp": datetime.utcnow().isoformat()
        }

        self.store.record(metrics)

    def get_summary_stats(self, timeframe: str = "24h") -> dict:
        """Get summary statistics"""
        data = self.store.query(timeframe)

        return {
            "total_conversations": len(data),
            "avg_duration_seconds": sum(d["duration_seconds"] for d in data) / len(data) if data else 0,
            "resolution_rate": sum(1 for d in data if d["resolution_status"]) / len(data) if data else 0,
            "escalation_rate": sum(1 for d in data if d["escalated"]) / len(data) if data else 0,
            "avg_messages": sum(d["message_count"] for d in data) / len(data) if data else 0,
            "top_intents": self._get_top_intents(data),
            "avg_satisfaction": sum(d.get("satisfaction_score", 0) for d in data if d.get("satisfaction_score")) / len([d for d in data if d.get("satisfaction_score")]) if data else 0
        }

    def _get_top_intents(self, data, top_n=5) -> list:
        """Get most common intents"""
        intent_counts = {}
        for d in data:
            for intent in d.get("intents", []):
                intent_counts[intent] = intent_counts.get(intent, 0) + 1

        sorted_intents = sorted(intent_counts.items(), key=lambda x: x[1], reverse=True)
        return sorted_intents[:top_n]
```

## Complete Example

```python
class ProductionChatSystem:
    def __init__(self, config):
        self.client = AzureOpenAI(**config["openai"])
        self.manager = ConversationManager(self.client, config["system_prompt"])
        self.router = ConversationRouter(self.client)
        self.handoff = HumanHandoff(config["queue_service"])
        self.analytics = ConversationAnalytics(config["metrics_store"])
        self.store = ConversationStore(config["redis_url"])

        self._register_handlers()

    def _register_handlers(self):
        self.router.register_handler("order_status", self.handle_order_status)
        self.router.register_handler("product_inquiry", self.handle_product_inquiry)
        self.router.register_handler("human_agent", self.handle_human_request)

    async def handle_message(self, session_id: str, message: str) -> dict:
        # Load or create conversation
        conversation = self.store.load(session_id) or self.manager.get_or_create_conversation(session_id)

        # Check for escalation
        should_escalate, reason = self.handoff.should_escalate(message, conversation)
        if should_escalate:
            result = self.handoff.initiate_handoff(conversation, reason)
            conversation.status = ConversationStatus.ESCALATED
            self.store.save(conversation)
            return {"type": "escalation", "data": result}

        # Route and process
        response = self.router.route(message, conversation)
        conversation.add_message("user", message)
        conversation.add_message("assistant", response)

        # Save state
        self.store.save(conversation)

        # Track analytics
        self.analytics.track_conversation(conversation)

        return {"type": "response", "message": response}
```

Robust conversation management enables reliable production chat systems. Tomorrow, I will cover context pruning strategies.

## Resources

- [Conversation Design Best Practices](https://designguidelines.withgoogle.com/conversation/)
- [Building Production Chat Systems](https://www.deeplearning.ai/short-courses/building-systems-with-chatgpt/)
