---
title: "Azure AI Agent Service Preview: Building Intelligent Agents"
author: Michael John Peña
draft: false
date: 2024-05-22
tags:
  - Azure
  - AI Agents
  - Azure AI
  - Autonomous AI
  - Microsoft Build

---

I wrote "Azure AI Agent Service Preview: Building Intelligent Agents" to share practical, production-minded guidance on this topic.

## What is Azure AI Agent Service?

Azure AI Agent Service provides:
- **Managed agent runtime** - No infrastructure to manage
- **Built-in tools** - Code execution, file handling, web search
- **Memory management** - Persistent conversation state
- **Safety controls** - Content filtering and guardrails
- **Observability** - Built-in tracing and monitoring

## Creating Your First Agent

```python
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import Agent, AgentTool
from azure.identity import DefaultAzureCredential

# Connect to project
client = AIProjectClient(
    credential=DefaultAzureCredential(),
    subscription_id="your-subscription",
    resource_group_name="your-rg",
    project_name="your-project"
)

# Create an agent
agent = client.agents.create(
    name="data-analyst",
    model="gpt-4o",
    instructions="""You are a data analyst assistant.
    Help users analyze data, create visualizations, and generate insights.
    Always explain your methodology and findings clearly.""",
    tools=[
        AgentTool(type="code_interpreter"),
        AgentTool(type="file_search")
    ]
)

print(f"Agent created: {agent.id}")
```

## Agent Conversations

```python
# Create a conversation thread
thread = client.agents.create_thread()

# Add a message
message = client.agents.create_message(
    thread_id=thread.id,
    role="user",
    content="Analyze the sales data and identify trends"
)

# Run the agent
run = client.agents.create_run(
    thread_id=thread.id,
    agent_id=agent.id
)

# Wait for completion
while run.status in ["queued", "in_progress"]:
    time.sleep(1)
    run = client.agents.get_run(thread_id=thread.id, run_id=run.id)

# Get response
messages = client.agents.list_messages(thread_id=thread.id)
for msg in messages:
    if msg.role == "assistant":
        print(msg.content)
```

## Built-in Tools

### Code Interpreter

```python
# Agent with code interpreter
agent = client.agents.create(
    name="code-agent",
    model="gpt-4o",
    instructions="You can execute Python code to solve problems.",
    tools=[AgentTool(type="code_interpreter")]
)

# Upload a file for analysis
file = client.agents.upload_file(
    file=open("sales_data.csv", "rb"),
    purpose="assistants"
)

# Create message with file
message = client.agents.create_message(
    thread_id=thread.id,
    role="user",
    content="Analyze this CSV and create a chart showing monthly trends",
    file_ids=[file.id]
)

# The agent will:
# 1. Read the CSV
# 2. Write Python code to analyze it
# 3. Execute the code
# 4. Generate visualizations
# 5. Return insights and charts
```

### File Search

```python
# Create a vector store for files
vector_store = client.agents.create_vector_store(
    name="company-docs"
)

# Upload documents
for doc_path in ["policy.pdf", "handbook.pdf", "procedures.docx"]:
    file = client.agents.upload_file(
        file=open(doc_path, "rb"),
        purpose="assistants"
    )
    client.agents.add_file_to_vector_store(
        vector_store_id=vector_store.id,
        file_id=file.id
    )

# Agent with file search
agent = client.agents.create(
    name="hr-assistant",
    model="gpt-4o",
    instructions="Answer questions about company policies using the provided documents.",
    tools=[AgentTool(type="file_search")],
    tool_resources={
        "file_search": {
            "vector_store_ids": [vector_store.id]
        }
    }
)
```

### Custom Functions

```python
from azure.ai.projects.models import FunctionTool, FunctionDefinition

# Define custom functions
functions = [
    FunctionDefinition(
        name="get_weather",
        description="Get current weather for a location",
        parameters={
            "type": "object",
            "properties": {
                "location": {
                    "type": "string",
                    "description": "City name"
                }
            },
            "required": ["location"]
        }
    ),
    FunctionDefinition(
        name="search_database",
        description="Search the product database",
        parameters={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "category": {"type": "string"}
            },
            "required": ["query"]
        }
    )
]

# Create agent with functions
agent = client.agents.create(
    name="assistant",
    model="gpt-4o",
    instructions="Help users with weather and product information.",
    tools=[FunctionTool(functions=functions)]
)

# Handle function calls
def handle_run(thread_id: str, run_id: str):
    run = client.agents.get_run(thread_id=thread_id, run_id=run_id)

    while run.status == "requires_action":
        tool_calls = run.required_action.submit_tool_outputs.tool_calls
        tool_outputs = []

        for call in tool_calls:
            if call.function.name == "get_weather":
                args = json.loads(call.function.arguments)
                result = get_weather(args["location"])
            elif call.function.name == "search_database":
                args = json.loads(call.function.arguments)
                result = search_database(args["query"], args.get("category"))

            tool_outputs.append({
                "tool_call_id": call.id,
                "output": json.dumps(result)
            })

        run = client.agents.submit_tool_outputs(
            thread_id=thread_id,
            run_id=run_id,
            tool_outputs=tool_outputs
        )

    return run
```

## Agent Memory

```python
# Threads provide conversation memory
# Each thread maintains full conversation history

# Continue an existing conversation
thread_id = "thread_abc123"

# Add new message
message = client.agents.create_message(
    thread_id=thread_id,
    role="user",
    content="Based on our earlier analysis, what else should we consider?"
)

# Agent has full context from previous messages
run = client.agents.create_run(
    thread_id=thread_id,
    agent_id=agent.id
)
```

## Streaming Responses

```python
async def stream_agent_response(thread_id: str, agent_id: str):
    """Stream agent responses for real-time UX."""

    async with client.agents.create_run_stream(
        thread_id=thread_id,
        agent_id=agent_id
    ) as stream:
        async for event in stream:
            if event.type == "thread.message.delta":
                # Stream text content
                for delta in event.data.delta.content:
                    if delta.type == "text":
                        print(delta.text.value, end="", flush=True)

            elif event.type == "thread.run.step.delta":
                # Track tool usage
                if event.data.delta.step_details:
                    print(f"\n[Using tool: {event.data.delta.step_details.type}]")

            elif event.type == "thread.run.completed":
                print("\n[Run completed]")
                break

# Usage
asyncio.run(stream_agent_response(thread.id, agent.id))
```

## Multi-Agent Patterns

```python
class AgentOrchestrator:
    """Orchestrate multiple specialized agents."""

    def __init__(self, client):
        self.client = client
        self.agents = {}

    def register_agent(self, role: str, agent_id: str):
        self.agents[role] = agent_id

    async def route_query(self, query: str, thread_id: str) -> str:
        # Use a router agent to determine which specialist to use
        router_response = await self._ask_router(query)
        target_agent = self.agents.get(router_response["role"])

        if not target_agent:
            return "No suitable agent found for this query."

        # Forward to specialist
        return await self._ask_agent(target_agent, query, thread_id)

    async def _ask_router(self, query: str) -> dict:
        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"Route this query to the appropriate agent. Available: {list(self.agents.keys())}. Return JSON: {{\"role\": \"agent_name\"}}"
                },
                {"role": "user", "content": query}
            ],
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)

# Usage
orchestrator = AgentOrchestrator(client)
orchestrator.register_agent("data_analyst", data_agent.id)
orchestrator.register_agent("hr_specialist", hr_agent.id)
orchestrator.register_agent("tech_support", tech_agent.id)

response = await orchestrator.route_query(
    "How do I analyze last quarter's sales?",
    thread_id
)
```

## Safety and Guardrails

```python
# Configure content filtering
agent = client.agents.create(
    name="safe-agent",
    model="gpt-4o",
    instructions="Be helpful while following all safety guidelines.",
    tools=[AgentTool(type="code_interpreter")],
    metadata={
        "content_filter": "strict",
        "allow_code_execution": True,
        "allowed_domains": ["company.com", "azure.com"]
    }
)

# Add custom guardrails
GUARDRAIL_PROMPT = """
Before responding, verify:
1. Response does not contain PII
2. Response does not include confidential information
3. Response is appropriate for professional context
4. Code execution is sandboxed and safe
"""

agent_with_guardrails = client.agents.create(
    name="guarded-agent",
    model="gpt-4o",
    instructions=f"{GUARDRAIL_PROMPT}\n\nYou are a helpful assistant."
)
```

## Monitoring Agents

```python
# Get agent metrics
metrics = client.agents.get_metrics(
    agent_id=agent.id,
    start_time=datetime.now() - timedelta(days=7),
    end_time=datetime.now()
)

print(f"Total runs: {metrics['total_runs']}")
print(f"Success rate: {metrics['success_rate']:.2%}")
print(f"Avg tokens: {metrics['avg_tokens_per_run']}")
print(f"Avg duration: {metrics['avg_duration_seconds']:.1f}s")

# List recent runs
runs = client.agents.list_runs(agent_id=agent.id, limit=10)
for run in runs:
    print(f"Run {run.id}: {run.status} - {run.created_at}")
```

## Best Practices

1. **Clear instructions** - Be specific about agent capabilities and limits
2. **Appropriate tools** - Only enable needed tools
3. **Error handling** - Handle function call failures gracefully
4. **Token management** - Monitor and limit conversation length
5. **Testing** - Test agent behavior with diverse inputs

## What's Next

Tomorrow I'll dive deeper into building AI agents and orchestration patterns.

## Resources

- [Azure AI Agent Service](https://learn.microsoft.com/azure/ai-services/agents/)
- [Agent Best Practices](https://learn.microsoft.com/azure/ai-services/agents/best-practices)
- [OpenAI Assistants API](https://platform.openai.com/docs/assistants/overview)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
