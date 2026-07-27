---
title: "Azure OpenAI Function Calling Patterns: Building Intelligent Agents"
author: Michael John Peña
draft: false
date: 2023-06-18
tags:
  - Azure OpenAI
  - Function Calling
  - AI Agents
  - GPT-4
  - Patterns

---

I wrote "Azure OpenAI Function Calling Patterns: Building Intelligent Agents" to share practical, production-minded guidance on this topic.

## Function Calling Architecture

```
┌─────────────────────────────────────────────────────┐
│              Function Calling Agent                  │
├─────────────────────────────────────────────────────┤
│                                                      │
│  User ──▶ Agent ──▶ GPT-4 ──▶ Function Decision    │
│              │                       │              │
│              │                       ▼              │
│              │               ┌──────────────┐       │
│              │               │ Function     │       │
│              │               │ Definitions  │       │
│              │               └──────┬───────┘       │
│              │                      │               │
│              │    ┌─────────────────▼────────────┐ │
│              │    │       Execute Function       │ │
│              │    │  - API calls                 │ │
│              │    │  - Database queries          │ │
│              │    │  - External services         │ │
│              │    └─────────────────┬────────────┘ │
│              │                      │              │
│              │                      ▼              │
│              │    ┌─────────────────────────────┐  │
│              │    │    Return Result to GPT     │  │
│              │    └─────────────────────────────┘  │
│              │                      │              │
│              ◀──────────────────────┘              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Comprehensive Function Definitions

```python
from openai import AzureOpenAI
import json

client = AzureOpenAI(
    api_key="your-api-key",
    api_version="2023-07-01-preview",
    azure_endpoint="https://your-resource.openai.azure.com"
)

# Well-designed function definitions
functions = [
    {
        "name": "search_knowledge_base",
        "description": "Search the company knowledge base for information. Use this when the user asks questions about company policies, procedures, or documentation.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to find relevant documents"
                },
                "category": {
                    "type": "string",
                    "enum": ["hr", "it", "finance", "legal", "general"],
                    "description": "Filter by document category"
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results to return",
                    "default": 5
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "create_support_ticket",
        "description": "Create a support ticket for IT or HR issues. Use when the user needs help that requires human follow-up.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Brief title describing the issue"
                },
                "description": {
                    "type": "string",
                    "description": "Detailed description of the problem"
                },
                "priority": {
                    "type": "string",
                    "enum": ["low", "medium", "high", "critical"],
                    "description": "Urgency level"
                },
                "category": {
                    "type": "string",
                    "enum": ["hardware", "software", "access", "hr", "other"]
                }
            },
            "required": ["title", "description", "priority", "category"]
        }
    },
    {
        "name": "get_employee_info",
        "description": "Get information about an employee. Use when the user asks about contact info, department, or reporting structure.",
        "parameters": {
            "type": "object",
            "properties": {
                "email": {
                    "type": "string",
                    "description": "Employee email address"
                },
                "name": {
                    "type": "string",
                    "description": "Employee name (partial match supported)"
                },
                "fields": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Specific fields to retrieve",
                    "default": ["name", "email", "department", "manager"]
                }
            }
        }
    },
    {
        "name": "schedule_meeting",
        "description": "Schedule a meeting with one or more participants. Use when the user wants to set up a meeting.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "participants": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Email addresses of participants"
                },
                "duration_minutes": {
                    "type": "integer",
                    "enum": [15, 30, 45, 60, 90, 120]
                },
                "preferred_times": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Preferred date/times in ISO format"
                },
                "description": {"type": "string"}
            },
            "required": ["title", "participants", "duration_minutes"]
        }
    }
]
```

## Agent Implementation

```python
class IntelligentAgent:
    def __init__(self, client, functions, system_prompt):
        self.client = client
        self.functions = functions
        self.system_prompt = system_prompt
        self.conversation_history = []
        self.function_handlers = {}

    def register_handler(self, function_name: str, handler: callable):
        """Register a handler for a function"""
        self.function_handlers[function_name] = handler

    def execute_function(self, name: str, arguments: dict) -> dict:
        """Execute a function and return results"""
        if name not in self.function_handlers:
            return {"error": f"Unknown function: {name}"}

        try:
            return self.function_handlers[name](**arguments)
        except Exception as e:
            return {"error": str(e)}

    def chat(self, user_message: str, max_iterations: int = 5) -> str:
        """Process user message with function calling loop"""

        self.conversation_history.append({
            "role": "user",
            "content": user_message
        })

        messages = [
            {"role": "system", "content": self.system_prompt}
        ] + self.conversation_history

        for iteration in range(max_iterations):
            response = self.client.chat.completions.create(
                model="gpt-4",
                messages=messages,
                functions=self.functions,
                function_call="auto",
                temperature=0.7
            )

            assistant_message = response.choices[0].message

            if assistant_message.function_call:
                # Execute function
                function_name = assistant_message.function_call.name
                function_args = json.loads(assistant_message.function_call.arguments)

                print(f"[Agent] Calling {function_name} with {function_args}")

                result = self.execute_function(function_name, function_args)

                # Add to conversation
                messages.append({
                    "role": "assistant",
                    "content": None,
                    "function_call": {
                        "name": function_name,
                        "arguments": assistant_message.function_call.arguments
                    }
                })
                messages.append({
                    "role": "function",
                    "name": function_name,
                    "content": json.dumps(result)
                })

            else:
                # Final response
                final_response = assistant_message.content
                self.conversation_history.append({
                    "role": "assistant",
                    "content": final_response
                })
                return final_response

        return "I apologize, but I was unable to complete your request. Please try rephrasing."

    def clear_history(self):
        """Clear conversation history"""
        self.conversation_history = []
```

## Function Handler Implementations

```python
# Knowledge base search
def search_knowledge_base(query: str, category: str = None, max_results: int = 5) -> dict:
    """Search knowledge base using Azure Cognitive Search"""
    from azure.search.documents import SearchClient

    search_client = SearchClient(
        endpoint=search_endpoint,
        index_name="knowledge-base",
        credential=credential
    )

    filter_expr = f"category eq '{category}'" if category else None

    results = search_client.search(
        search_text=query,
        filter=filter_expr,
        top=max_results,
        select=["title", "content", "category", "url"]
    )

    documents = []
    for result in results:
        documents.append({
            "title": result["title"],
            "snippet": result["content"][:300] + "...",
            "category": result["category"],
            "url": result["url"]
        })

    return {
        "results": documents,
        "total_found": len(documents)
    }

# Support ticket creation
def create_support_ticket(title: str, description: str, priority: str, category: str) -> dict:
    """Create ticket in ServiceNow or similar system"""
    import requests

    ticket_data = {
        "short_description": title,
        "description": description,
        "priority": {"low": 4, "medium": 3, "high": 2, "critical": 1}[priority],
        "category": category,
        "caller_id": current_user_email
    }

    response = requests.post(
        f"{servicenow_url}/api/now/table/incident",
        json=ticket_data,
        auth=(servicenow_user, servicenow_password)
    )

    result = response.json()

    return {
        "success": True,
        "ticket_number": result["result"]["number"],
        "message": f"Ticket {result['result']['number']} created successfully"
    }

# Employee lookup
def get_employee_info(email: str = None, name: str = None, fields: list = None) -> dict:
    """Query Microsoft Graph for employee information"""
    import requests

    if email:
        user = graph_client.users.get(email)
    elif name:
        users = graph_client.users.list(filter=f"startswith(displayName, '{name}')")
        user = users[0] if users else None
    else:
        return {"error": "Must provide email or name"}

    if not user:
        return {"error": "Employee not found"}

    default_fields = ["displayName", "mail", "department", "manager"]
    fields = fields or default_fields

    result = {field: getattr(user, field, None) for field in fields}

    return result

# Meeting scheduler
def schedule_meeting(title: str, participants: list, duration_minutes: int,
                     preferred_times: list = None, description: str = "") -> dict:
    """Schedule meeting via Microsoft Graph"""

    # Find available time
    availability = check_availability(participants, duration_minutes)

    if not availability["available_slots"]:
        return {
            "success": False,
            "message": "No common available times found",
            "suggestion": "Try different participants or duration"
        }

    # Create meeting
    meeting = {
        "subject": title,
        "body": {"content": description},
        "start": {"dateTime": availability["available_slots"][0]["start"]},
        "end": {"dateTime": availability["available_slots"][0]["end"]},
        "attendees": [{"emailAddress": {"address": p}} for p in participants]
    }

    result = graph_client.me.events.create(meeting)

    return {
        "success": True,
        "meeting_id": result.id,
        "scheduled_time": availability["available_slots"][0]["start"],
        "message": f"Meeting '{title}' scheduled successfully"
    }
```

## Using the Agent

```python
# Initialize agent
agent = IntelligentAgent(
    client=client,
    functions=functions,
    system_prompt="""You are a helpful corporate assistant. You can:
- Search the company knowledge base for policies and documentation
- Create support tickets for IT or HR issues
- Look up employee information
- Schedule meetings

Always be helpful and professional. When you need more information, ask clarifying questions."""
)

# Register handlers
agent.register_handler("search_knowledge_base", search_knowledge_base)
agent.register_handler("create_support_ticket", create_support_ticket)
agent.register_handler("get_employee_info", get_employee_info)
agent.register_handler("schedule_meeting", schedule_meeting)

# Chat
response = agent.chat("What is the company policy on remote work?")
print(response)

response = agent.chat("I can't access my email, can you create a ticket for me?")
print(response)
```

Function calling patterns enable sophisticated AI agents. Tomorrow, I will cover building AI agents in more depth.

## Resources

- [Function Calling Guide](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/how-to/function-calling)
- [OpenAI Cookbook](https://github.com/openai/openai-cookbook)
- [Azure OpenAI Best Practices](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/concepts/advanced-prompt-engineering)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
