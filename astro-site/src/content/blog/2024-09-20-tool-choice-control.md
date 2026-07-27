---
title: "Tool Choice Control: Fine-Tuning When and How AI Uses Tools"
author: "Michael John Peña"
draft: false
date: 2024-09-20
tags: ["OpenAI", "Tools", "Function Calling", "AI", "Control"]

---

I wrote "Tool Choice Control: Fine-Tuning When and How AI Uses Tools" to share practical, production-minded guidance on this topic.

## Tool Choice Options

```python
from openai import OpenAI
import json

client = OpenAI()

tools = [
    {
        "type": "function",
        "function": {
            "name": "search_database",
            "description": "Search the product database",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_order",
            "description": "Create a new order",
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {"type": "string"},
                    "quantity": {"type": "integer"}
                },
                "required": ["product_id", "quantity"]
            }
        }
    }
]

# Option 1: "auto" - Model decides (default)
response = client.chat.completions.create(
    model="gpt-4o-2024-08-06",
    messages=[{"role": "user", "content": "Hello!"}],
    tools=tools,
    tool_choice="auto"  # Model may or may not use tools
)

# Option 2: "none" - Never use tools
response = client.chat.completions.create(
    model="gpt-4o-2024-08-06",
    messages=[{"role": "user", "content": "Search for laptops"}],
    tools=tools,
    tool_choice="none"  # Model will respond without tools
)

# Option 3: "required" - Must use a tool
response = client.chat.completions.create(
    model="gpt-4o-2024-08-06",
    messages=[{"role": "user", "content": "What products do you have?"}],
    tools=tools,
    tool_choice="required"  # Model must call at least one tool
)

# Option 4: Specific function - Force a particular tool
response = client.chat.completions.create(
    model="gpt-4o-2024-08-06",
    messages=[{"role": "user", "content": "I want to buy something"}],
    tools=tools,
    tool_choice={
        "type": "function",
        "function": {"name": "search_database"}
    }
)
```

## Dynamic Tool Selection

```python
from typing import List, Optional, Literal
from enum import Enum

class ConversationState(Enum):
    BROWSING = "browsing"
    SELECTING = "selecting"
    CHECKOUT = "checkout"
    SUPPORT = "support"

class DynamicToolSelector:
    """Select appropriate tools and control based on conversation state"""

    def __init__(self):
        self.all_tools = self._define_all_tools()

    def _define_all_tools(self) -> dict:
        return {
            "search_database": {
                "type": "function",
                "function": {
                    "name": "search_database",
                    "description": "Search products",
                    "parameters": {
                        "type": "object",
                        "properties": {"query": {"type": "string"}},
                        "required": ["query"]
                    }
                }
            },
            "get_product_details": {
                "type": "function",
                "function": {
                    "name": "get_product_details",
                    "description": "Get product details",
                    "parameters": {
                        "type": "object",
                        "properties": {"product_id": {"type": "string"}},
                        "required": ["product_id"]
                    }
                }
            },
            "add_to_cart": {
                "type": "function",
                "function": {
                    "name": "add_to_cart",
                    "description": "Add item to cart",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "product_id": {"type": "string"},
                            "quantity": {"type": "integer"}
                        },
                        "required": ["product_id", "quantity"]
                    }
                }
            },
            "process_payment": {
                "type": "function",
                "function": {
                    "name": "process_payment",
                    "description": "Process payment",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "amount": {"type": "number"},
                            "payment_method": {"type": "string"}
                        },
                        "required": ["amount", "payment_method"]
                    }
                }
            },
            "contact_support": {
                "type": "function",
                "function": {
                    "name": "contact_support",
                    "description": "Contact human support",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "issue": {"type": "string"},
                            "priority": {"type": "string"}
                        },
                        "required": ["issue"]
                    }
                }
            }
        }

    def get_tools_for_state(self, state: ConversationState) -> tuple:
        """Return (tools, tool_choice) based on state"""

        if state == ConversationState.BROWSING:
            tools = [
                self.all_tools["search_database"],
                self.all_tools["get_product_details"]
            ]
            return tools, "auto"

        elif state == ConversationState.SELECTING:
            tools = [
                self.all_tools["get_product_details"],
                self.all_tools["add_to_cart"]
            ]
            return tools, "auto"

        elif state == ConversationState.CHECKOUT:
            tools = [
                self.all_tools["process_payment"]
            ]
            # Force payment processing during checkout
            return tools, {"type": "function", "function": {"name": "process_payment"}}

        elif state == ConversationState.SUPPORT:
            tools = [
                self.all_tools["contact_support"]
            ]
            return tools, "required"  # Must escalate

        return [], "none"

# Usage
selector = DynamicToolSelector()

def chat_with_state(message: str, state: ConversationState) -> str:
    tools, tool_choice = selector.get_tools_for_state(state)

    response = client.chat.completions.create(
        model="gpt-4o-2024-08-06",
        messages=[{"role": "user", "content": message}],
        tools=tools if tools else None,
        tool_choice=tool_choice if tools else None
    )

    return response
```

## Safety Controls

```python
class ToolSafetyController:
    """Control tool usage based on safety policies"""

    def __init__(self):
        self.dangerous_tools = {"delete_data", "process_payment", "send_email"}
        self.require_confirmation = {"create_order", "update_profile"}
        self.rate_limits = {}

    def filter_tools(self, tools: List[dict], user_permissions: List[str]) -> List[dict]:
        """Filter tools based on user permissions"""
        return [
            tool for tool in tools
            if self._user_can_use(tool["function"]["name"], user_permissions)
        ]

    def _user_can_use(self, tool_name: str, permissions: List[str]) -> bool:
        """Check if user has permission for this tool"""
        if tool_name in self.dangerous_tools:
            return f"admin:{tool_name}" in permissions
        return True

    def get_tool_choice(self, tool_name: str, already_confirmed: bool) -> dict:
        """Determine appropriate tool choice with safety checks"""

        if tool_name in self.dangerous_tools:
            if not already_confirmed:
                return "none"  # Require explicit confirmation

        if tool_name in self.require_confirmation:
            return {
                "type": "function",
                "function": {"name": f"confirm_{tool_name}"}
            }

        return {"type": "function", "function": {"name": tool_name}}

    def check_rate_limit(self, tool_name: str, user_id: str) -> bool:
        """Check if tool usage is within rate limits"""
        key = f"{user_id}:{tool_name}"
        # Implementation depends on your rate limiting system
        return True

# Confirmation flow
def execute_with_confirmation(message: str, tools: List[dict],
                              pending_action: dict = None) -> dict:
    """Execute tools with confirmation for sensitive actions"""

    if pending_action:
        # User is confirming a pending action
        if "yes" in message.lower() or "confirm" in message.lower():
            # Execute the pending action
            result = execute_tool(pending_action["tool_call"])
            return {"status": "executed", "result": result}
        else:
            return {"status": "cancelled"}

    response = client.chat.completions.create(
        model="gpt-4o-2024-08-06",
        messages=[{"role": "user", "content": message}],
        tools=tools,
        tool_choice="auto"
    )

    message = response.choices[0].message

    if message.tool_calls:
        call = message.tool_calls[0]

        # Check if this requires confirmation
        if call.function.name in ["process_payment", "delete_data"]:
            return {
                "status": "pending_confirmation",
                "action": {
                    "name": call.function.name,
                    "args": json.loads(call.function.arguments),
                    "tool_call": call
                },
                "message": f"Are you sure you want to {call.function.name}?"
            }

        # Execute directly
        result = execute_tool(call)
        return {"status": "executed", "result": result}

    return {"status": "response", "content": message.content}
```

## Workflow Control

```python
class WorkflowController:
    """Control tool usage through a defined workflow"""

    def __init__(self):
        self.workflow = {
            "start": {"allowed_tools": ["search_database"], "next": "found_results"},
            "found_results": {"allowed_tools": ["get_details", "search_database"], "next": "viewing_product"},
            "viewing_product": {"allowed_tools": ["add_to_cart", "search_database"], "next": "cart_updated"},
            "cart_updated": {"allowed_tools": ["checkout", "continue_shopping"], "next": "checkout"},
            "checkout": {"allowed_tools": ["process_payment"], "next": "complete"}
        }
        self.current_state = "start"

    def get_allowed_tools(self, all_tools: List[dict]) -> List[dict]:
        """Get tools allowed in current state"""
        allowed_names = self.workflow[self.current_state]["allowed_tools"]
        return [t for t in all_tools if t["function"]["name"] in allowed_names]

    def transition(self, executed_tool: str):
        """Move to next state based on executed tool"""
        next_state = self.workflow[self.current_state].get("next")
        if next_state:
            self.current_state = next_state

    def can_proceed(self) -> bool:
        """Check if workflow allows proceeding"""
        return self.current_state != "complete"

# Usage
workflow = WorkflowController()

while workflow.can_proceed():
    allowed = workflow.get_allowed_tools(all_tools)

    response = client.chat.completions.create(
        model="gpt-4o-2024-08-06",
        messages=[{"role": "user", "content": user_input}],
        tools=allowed,
        tool_choice="required" if len(allowed) == 1 else "auto"
    )

    if response.choices[0].message.tool_calls:
        tool_name = response.choices[0].message.tool_calls[0].function.name
        workflow.transition(tool_name)
```

Tool choice control is essential for building AI applications that are predictable, safe, and aligned with your business logic. Use these patterns to guide model behavior exactly as needed.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
