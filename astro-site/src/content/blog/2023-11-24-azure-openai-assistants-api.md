---
title: "Azure OpenAI Assistants API: Enterprise AI Agents"
author: "Michael John Peña"
draft: false
date: 2023-11-24
tags: ["Azure", "OpenAI", "Assistants API", "AI Agents", "Enterprise"]

---

I wrote "Azure OpenAI Assistants API: Enterprise AI Agents" to share practical, production-minded guidance on this topic.

The Azure OpenAI Assistants API — launched in preview on Azure shortly after the OpenAI DevDay announcement in November 2023 — is the stateful AI agent platform that changes the architecture of conversational AI applications in a meaningful way. Before Assistants API, every conversational application had to implement its own state management: storing the conversation history, managing the context window, deciding what to summarise or prune as the conversation grew, and handling tool execution loops. Assistants API provides all of this as a managed service: Threads persist conversation history server-side with automatic context management, the Run abstraction handles the reasoning and tool execution loop, and built-in tools (Code Interpreter, Retrieval, custom Functions) are available without the application implementing the tool execution plumbing. The enterprise case for using the Azure variant over the direct OpenAI endpoint: Azure's existing data handling agreements, private endpoints, and Azure RBAC integration apply to Assistants API operations.

## Azure OpenAI Assistants Overview

```python
from openai import AzureOpenAI
from typing import List, Dict, Optional
import time

class AzureAssistantsClient:
    def __init__(
        self,
        azure_endpoint: str,
        api_key: str,
        api_version: str = "2024-02-15-preview"
    ):
        self.client = AzureOpenAI(
            azure_endpoint=azure_endpoint,
            api_key=api_key,
            api_version=api_version
        )

    def create_assistant(
        self,
        name: str,
        instructions: str,
        model: str,  # Your deployment name
        tools: List[dict] = None
    ):
        """Create an assistant on Azure OpenAI."""
        assistant = self.client.beta.assistants.create(
            name=name,
            instructions=instructions,
            model=model,
            tools=tools or []
        )
        return assistant

    def create_thread(self):
        """Create a new conversation thread."""
        return self.client.beta.threads.create()

    def add_message(self, thread_id: str, content: str, role: str = "user"):
        """Add a message to a thread."""
        return self.client.beta.threads.messages.create(
            thread_id=thread_id,
            role=role,
            content=content
        )

    def run_assistant(self, thread_id: str, assistant_id: str):
        """Run the assistant on a thread and wait for completion."""
        run = self.client.beta.threads.runs.create(
            thread_id=thread_id,
            assistant_id=assistant_id
        )

        # Poll for completion
        while run.status in ["queued", "in_progress"]:
            time.sleep(1)
            run = self.client.beta.threads.runs.retrieve(
                thread_id=thread_id,
                run_id=run.id
            )

        return run

    def get_messages(self, thread_id: str):
        """Get all messages from a thread."""
        return self.client.beta.threads.messages.list(thread_id=thread_id)

# Initialize client
client = AzureAssistantsClient(
    azure_endpoint="https://your-resource.openai.azure.com",
    api_key="your-api-key"
)
```

## Building an Enterprise Data Analyst Assistant

```python
def create_data_analyst_assistant(client: AzureAssistantsClient):
    """Create a data analyst assistant with code interpreter."""

    instructions = """You are an expert data analyst for an enterprise company.

Your capabilities:
1. Analyze CSV and Excel data files
2. Create visualizations (charts, graphs)
3. Perform statistical analysis
4. Generate insights and recommendations

Guidelines:
- Always validate data before analysis
- Explain your methodology
- Highlight key insights clearly
- Suggest follow-up analyses
- Be mindful of data privacy

When presenting results:
- Use clear, non-technical language for executives
- Provide technical details in appendix
- Include confidence levels where applicable
"""

    assistant = client.create_assistant(
        name="Enterprise Data Analyst",
        instructions=instructions,
        model="gpt-4-turbo",  # Your deployment name
        tools=[
            {"type": "code_interpreter"}
        ]
    )

    return assistant

# Create the assistant
analyst = create_data_analyst_assistant(client)
print(f"Created assistant: {analyst.id}")
```

## File Handling with Assistants

```python
class AssistantFileManager:
    def __init__(self, azure_client: AzureAssistantsClient):
        self.client = azure_client.client

    def upload_file(self, file_path: str, purpose: str = "assistants") -> str:
        """Upload a file for use with assistants."""
        with open(file_path, "rb") as f:
            file = self.client.files.create(file=f, purpose=purpose)
        return file.id

    def attach_file_to_assistant(self, assistant_id: str, file_id: str):
        """Attach a file to an assistant for retrieval."""
        return self.client.beta.assistants.files.create(
            assistant_id=assistant_id,
            file_id=file_id
        )

    def create_message_with_file(
        self,
        thread_id: str,
        content: str,
        file_ids: List[str]
    ):
        """Create a message with attached files."""
        return self.client.beta.threads.messages.create(
            thread_id=thread_id,
            role="user",
            content=content,
            file_ids=file_ids
        )

    def download_generated_file(self, file_id: str, output_path: str):
        """Download a file generated by the assistant."""
        content = self.client.files.content(file_id)
        with open(output_path, "wb") as f:
            f.write(content.read())

# Example: Analyze a sales report
file_manager = AssistantFileManager(client)

# Upload data file
file_id = file_manager.upload_file("quarterly_sales.csv")

# Create thread and analyze
thread = client.create_thread()
file_manager.create_message_with_file(
    thread.id,
    "Analyze this quarterly sales data. Create a visualization of trends and identify top-performing products.",
    [file_id]
)

# Run analysis
run = client.run_assistant(thread.id, analyst.id)
messages = client.get_messages(thread.id)

# Get response with any generated files
for message in messages.data:
    if message.role == "assistant":
        print(message.content[0].text.value)
        # Check for generated images/files
        for annotation in message.content[0].text.annotations:
            if hasattr(annotation, 'file_path'):
                file_manager.download_generated_file(
                    annotation.file_path.file_id,
                    "generated_chart.png"
                )
```

## Function Calling with Assistants

```python
import json

def create_assistant_with_functions(client: AzureAssistantsClient):
    """Create an assistant with custom function tools."""

    tools = [
        {
            "type": "function",
            "function": {
                "name": "query_database",
                "description": "Execute a SQL query against the company database",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The SQL query to execute"
                        },
                        "database": {
                            "type": "string",
                            "enum": ["sales", "inventory", "customers"],
                            "description": "Which database to query"
                        }
                    },
                    "required": ["query", "database"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "send_email",
                "description": "Send an email notification",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "to": {"type": "string"},
                        "subject": {"type": "string"},
                        "body": {"type": "string"}
                    },
                    "required": ["to", "subject", "body"]
                }
            }
        },
        {"type": "code_interpreter"}
    ]

    return client.create_assistant(
        name="Enterprise Operations Assistant",
        instructions="You help with database queries and operational tasks.",
        model="gpt-4-turbo",
        tools=tools
    )

def handle_function_calls(client: AzureAssistantsClient, run, thread_id: str):
    """Handle function calls from the assistant."""

    while run.status == "requires_action":
        tool_outputs = []

        for tool_call in run.required_action.submit_tool_outputs.tool_calls:
            function_name = tool_call.function.name
            arguments = json.loads(tool_call.function.arguments)

            # Execute the function
            if function_name == "query_database":
                result = execute_database_query(
                    arguments["query"],
                    arguments["database"]
                )
            elif function_name == "send_email":
                result = send_notification_email(
                    arguments["to"],
                    arguments["subject"],
                    arguments["body"]
                )
            else:
                result = {"error": f"Unknown function: {function_name}"}

            tool_outputs.append({
                "tool_call_id": tool_call.id,
                "output": json.dumps(result)
            })

        # Submit results back to the assistant
        run = client.client.beta.threads.runs.submit_tool_outputs(
            thread_id=thread_id,
            run_id=run.id,
            tool_outputs=tool_outputs
        )

        # Wait for next status
        while run.status in ["queued", "in_progress"]:
            time.sleep(1)
            run = client.client.beta.threads.runs.retrieve(
                thread_id=thread_id,
                run_id=run.id
            )

    return run

def execute_database_query(query: str, database: str) -> dict:
    """Execute database query (implement with your actual database)."""
    # Simulated result
    return {"rows": [{"id": 1, "value": 100}], "count": 1}

def send_notification_email(to: str, subject: str, body: str) -> dict:
    """Send email notification (implement with your email service)."""
    return {"status": "sent", "message_id": "msg-123"}
```

## Enterprise Best Practices

```python
enterprise_best_practices = {
    "security": [
        "Use Azure AD authentication instead of API keys",
        "Enable Private Endpoints for network isolation",
        "Implement content filtering policies",
        "Log all interactions for audit purposes"
    ],
    "data_governance": [
        "Don't upload sensitive data to assistants",
        "Use file retention policies",
        "Implement data classification checks",
        "Regular cleanup of uploaded files"
    ],
    "cost_management": [
        "Monitor token usage per assistant",
        "Set up budget alerts",
        "Implement conversation length limits",
        "Use appropriate model tiers"
    ],
    "reliability": [
        "Implement retry logic with exponential backoff",
        "Handle rate limits gracefully",
        "Monitor assistant performance metrics",
        "Have fallback strategies"
    ]
}
```

Tomorrow, we'll explore Threads and Messages in depth for building conversational AI applications!\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
