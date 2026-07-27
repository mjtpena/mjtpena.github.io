---
title: "Multimodal Conversations with GPT-4o"
author: Michael John Peña
draft: false
date: 2024-05-05
tags:
  - AI
  - OpenAI
  - GPT-4o
  - Multimodal
  - Conversational AI

---

I wrote "Multimodal Conversations with GPT-4o" to share practical, production-minded guidance on this topic.

## The Multimodal Conversation Flow

A typical multimodal conversation might look like:

```
User: [Shows image of error log] "What's wrong here?"
GPT-4o: [Analyzes image, identifies issue]
User: [Voice] "Can you help me fix it?"
GPT-4o: [Voice response with code suggestion]
User: [Shows updated screenshot] "Is this right now?"
GPT-4o: [Confirms or suggests corrections]
```

## Building a Multimodal Chat Interface

```python
from dataclasses import dataclass
from typing import List, Optional, Literal
from enum import Enum
import base64

class MessageType(Enum):
    TEXT = "text"
    IMAGE = "image"
    AUDIO = "audio"

@dataclass
class MultimodalMessage:
    role: Literal["user", "assistant", "system"]
    content_type: MessageType
    content: str  # text, base64 image, or base64 audio

class MultimodalChat:
    def __init__(self, client, system_prompt: str = None):
        self.client = client
        self.messages = []
        if system_prompt:
            self.messages.append({
                "role": "system",
                "content": system_prompt
            })

    def add_text(self, text: str, role: str = "user"):
        self.messages.append({
            "role": role,
            "content": text
        })

    def add_image(self, image_path: str, text: str = ""):
        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")

        content = []
        if text:
            content.append({"type": "text", "text": text})
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{image_data}"}
        })

        self.messages.append({
            "role": "user",
            "content": content
        })

    def chat(self, user_input=None) -> str:
        if user_input:
            self.add_text(user_input)

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=self.messages,
            max_tokens=2000
        )

        assistant_message = response.choices[0].message.content
        self.messages.append({
            "role": "assistant",
            "content": assistant_message
        })

        return assistant_message
```

## Practical Example: Debug Assistant

```python
class DebugAssistant:
    def __init__(self, client):
        self.chat = MultimodalChat(
            client,
            system_prompt="""You are an expert debugging assistant.
            Analyze error logs, screenshots, and code to help diagnose issues.
            Be concise and provide actionable solutions."""
        )

    def analyze_error(self, error_screenshot: str) -> str:
        self.chat.add_image(
            error_screenshot,
            "I'm seeing this error. What's wrong and how do I fix it?"
        )
        return self.chat.chat()

    def provide_context(self, code_snippet: str) -> str:
        return self.chat.chat(f"Here's the relevant code:\n```\n{code_snippet}\n```")

    def verify_fix(self, fixed_screenshot: str) -> str:
        self.chat.add_image(
            fixed_screenshot,
            "I made changes. Does this look correct now?"
        )
        return self.chat.chat()

# Usage
assistant = DebugAssistant(client)

# Step 1: Show the error
print(assistant.analyze_error("error_screen.png"))
# Output: "The error shows a NullReferenceException on line 42..."

# Step 2: Provide code context
print(assistant.provide_context("""
def process_data(items):
    for item in items:
        result = item.value * 2
    return result
"""))
# Output: "The issue is that 'result' is only set inside the loop..."

# Step 3: Verify the fix
print(assistant.verify_fix("fixed_screen.png"))
# Output: "Yes, the error is resolved. The code now correctly..."
```

## Combining Audio and Vision

For real-time applications:

```javascript
class MultimodalRealtimeClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.ws = null;
    }

    async connect() {
        this.ws = new WebSocket(
            'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview',
            ['realtime', `openai-insecure-api-key.${this.apiKey}`, 'openai-beta.realtime-v1']
        );

        this.ws.onopen = () => {
            this.configure();
        };
    }

    configure() {
        this.ws.send(JSON.stringify({
            type: 'session.update',
            session: {
                modalities: ['text', 'audio'],
                voice: 'alloy',
                instructions: `You are a multimodal assistant that can discuss
                    images shared earlier in the conversation while responding
                    with voice.`
            }
        }));
    }

    async sendImageForDiscussion(imageBase64, description) {
        // First, send image via REST API to establish context
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: description },
                        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
                    ]
                }]
            })
        });

        const data = await response.json();
        this.imageContext = data.choices[0].message.content;

        // Update realtime session with image context
        this.ws.send(JSON.stringify({
            type: 'session.update',
            session: {
                instructions: `Previous image analysis: ${this.imageContext}\n\n
                    Use this context when the user asks about the image.`
            }
        }));
    }
}
```

## Context Management Strategies

Managing context across modalities:

```python
class ConversationContext:
    def __init__(self, max_images: int = 5, max_tokens: int = 100000):
        self.messages = []
        self.image_count = 0
        self.max_images = max_images
        self.max_tokens = max_tokens
        self.token_count = 0

    def add_message(self, message: dict, estimated_tokens: int):
        # Check if we need to trim context
        while self.token_count + estimated_tokens > self.max_tokens:
            self._trim_oldest()

        self.messages.append(message)
        self.token_count += estimated_tokens

        # Count images
        if isinstance(message.get("content"), list):
            for item in message["content"]:
                if item.get("type") == "image_url":
                    self.image_count += 1

        # Trim old images if needed
        while self.image_count > self.max_images:
            self._remove_oldest_image()

    def _trim_oldest(self):
        if len(self.messages) > 1:  # Keep system message
            removed = self.messages.pop(1)
            # Estimate and subtract tokens
            self.token_count -= self._estimate_tokens(removed)

    def _remove_oldest_image(self):
        for i, msg in enumerate(self.messages):
            if isinstance(msg.get("content"), list):
                for j, item in enumerate(msg["content"]):
                    if item.get("type") == "image_url":
                        msg["content"].pop(j)
                        self.image_count -= 1
                        return

    def _estimate_tokens(self, message) -> int:
        # Simplified estimation
        if isinstance(message.get("content"), str):
            return len(message["content"]) // 4
        return 500  # Default for complex messages
```

## Best Practices

1. **Maintain coherent context** - Reference previous images/audio naturally
2. **Handle modality transitions** - Smoothly switch between text and voice
3. **Optimize token usage** - Summarize previous visual context when possible
4. **Provide clear instructions** - Tell the model how to handle each modality
5. **Design for failure** - Handle cases where one modality fails

## Real-World Application: Data Analytics Assistant

```python
class DataAnalyticsAssistant:
    def __init__(self, client):
        self.client = client
        self.context = []

    async def analyze_dashboard(self, screenshot_path: str) -> str:
        """Analyze a dashboard screenshot and provide insights."""
        with open(screenshot_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "You are a data analyst. Analyze dashboards and provide actionable insights."
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Analyze this dashboard and highlight key insights."},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_data}"}}
                    ]
                }
            ]
        )

        return response.choices[0].message.content

    def follow_up(self, question: str) -> str:
        """Ask follow-up questions about the analysis."""
        self.context.append({"role": "user", "content": question})

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=self.context
        )

        answer = response.choices[0].message.content
        self.context.append({"role": "assistant", "content": answer})

        return answer
```

## What's Next

Tomorrow I'll cover Azure OpenAI GPT-4o deployment and configuration specifics.

## Resources

- [GPT-4o Multimodal Guide](https://platform.openai.com/docs/guides/vision)
- [Conversation Best Practices](https://platform.openai.com/docs/guides/chat)
- [Token Management](https://platform.openai.com/docs/guides/rate-limits)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
