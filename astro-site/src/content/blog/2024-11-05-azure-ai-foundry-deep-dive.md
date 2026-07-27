---
title: "Azure AI Foundry Deep Dive: Building Enterprise AI Applications"
author: Michael John Peña
draft: false
date: 2024-11-05
tags:
  - Azure
  - AI
  - Azure AI Foundry
  - Enterprise AI
  - Ignite 2024

---

I wrote "Azure AI Foundry Deep Dive: Building Enterprise AI Applications" to share practical, production-minded guidance on this topic.

## Setting Up Your First AI Foundry Project

```python
from azure.ai.foundry import AIFoundryClient
from azure.ai.foundry.projects import Project
from azure.identity import DefaultAzureCredential

# Initialize the client
credential = DefaultAzureCredential()
client = AIFoundryClient(
    credential=credential,
    subscription_id="your-subscription-id"
)

# Create a new project
project = client.projects.create(
    name="data-analytics-assistant",
    resource_group="rg-ai-production",
    location="eastus2",
    description="AI assistant for data analytics tasks",
    tags={"environment": "production", "team": "data-engineering"}
)

print(f"Project created: {project.name}")
print(f"Project ID: {project.id}")
```

## The AI Foundry Project Structure

```
my-ai-project/
├── .ai/
│   ├── config.yaml           # Project configuration
│   └── connections.yaml      # Data and service connections
├── src/
│   ├── agents/               # AI agent definitions
│   ├── prompts/              # Prompt templates
│   ├── tools/                # Custom tools
│   └── flows/                # Orchestration flows
├── evaluations/
│   ├── test_cases.jsonl      # Test data
│   └── metrics.py            # Custom evaluation metrics
├── deployments/
│   └── production.yaml       # Deployment configuration
└── ai-foundry.yaml           # Project manifest
```

## Configuring Connections

```yaml
# .ai/connections.yaml
connections:
  - name: azure-openai-prod
    type: azure_openai
    endpoint: ${AZURE_OPENAI_ENDPOINT}
    api_key: ${AZURE_OPENAI_KEY}
    api_version: "2024-10-01"

  - name: fabric-lakehouse
    type: azure_data
    connection_string: ${FABRIC_CONNECTION_STRING}

  - name: cognitive-search
    type: azure_search
    endpoint: ${SEARCH_ENDPOINT}
    api_key: ${SEARCH_KEY}
```

## Building a Data Analysis Agent

```python
from azure.ai.foundry.agents import Agent, Tool, AgentConfig
from azure.ai.foundry import AIFoundryClient

# Define tools for the agent
class FabricQueryTool(Tool):
    name = "fabric_query"
    description = "Execute SQL queries against Microsoft Fabric Lakehouse"

    def __init__(self, connection_name: str):
        self.connection = connection_name

    async def execute(self, query: str) -> dict:
        """Execute SQL query and return results."""
        from azure.ai.foundry.connections import get_connection

        conn = get_connection(self.connection)
        result = await conn.execute_query(query)

        return {
            "columns": result.columns,
            "rows": result.rows[:100],  # Limit for context
            "row_count": len(result.rows),
            "truncated": len(result.rows) > 100
        }

class ChartGeneratorTool(Tool):
    name = "generate_chart"
    description = "Generate a chart from data"

    async def execute(self, data: dict, chart_type: str, title: str) -> str:
        """Generate chart and return URL."""
        import matplotlib.pyplot as plt
        import io
        import base64

        fig, ax = plt.subplots(figsize=(10, 6))

        if chart_type == "bar":
            ax.bar(data["labels"], data["values"])
        elif chart_type == "line":
            ax.plot(data["labels"], data["values"])
        elif chart_type == "pie":
            ax.pie(data["values"], labels=data["labels"], autopct='%1.1f%%')

        ax.set_title(title)

        buffer = io.BytesIO()
        plt.savefig(buffer, format='png')
        buffer.seek(0)
        image_base64 = base64.b64encode(buffer.getvalue()).decode()

        return f"data:image/png;base64,{image_base64}"

# Create the agent
data_analyst = Agent(
    name="DataAnalyst",
    model="gpt-4o",
    config=AgentConfig(
        temperature=0.1,
        max_tokens=4000
    ),
    instructions="""You are a data analyst assistant with access to a Microsoft Fabric Lakehouse.

Your capabilities:
1. Query data using SQL via the fabric_query tool
2. Create visualizations using the generate_chart tool
3. Provide insights and recommendations based on data

When answering questions:
1. First understand what data is needed
2. Write and execute appropriate SQL queries
3. Analyze the results
4. Create visualizations when helpful
5. Provide clear, actionable insights

Always explain your reasoning and methodology.""",
    tools=[
        FabricQueryTool("fabric-lakehouse"),
        ChartGeneratorTool()
    ]
)
```

## Running the Agent

```python
from azure.ai.foundry.agents import AgentRuntime

async def analyze_sales_data():
    runtime = AgentRuntime(client)

    # Start a conversation
    conversation = await runtime.create_conversation(
        agent=data_analyst,
        metadata={"user_id": "analyst-001", "department": "sales"}
    )

    # First query
    response = await conversation.send_message(
        "What were our top 10 products by revenue last quarter?"
    )
    print(f"Agent: {response.content}")

    # Follow-up
    response = await conversation.send_message(
        "Show me a bar chart of those results"
    )
    print(f"Agent: {response.content}")

    # Check tool usage
    for tool_call in response.tool_calls:
        print(f"Tool used: {tool_call.tool_name}")
        print(f"Input: {tool_call.input}")
        print(f"Output: {tool_call.output}")

    return conversation.id

# Run the analysis
conversation_id = await analyze_sales_data()
```

## Implementing Evaluation

```python
from azure.ai.foundry.evaluation import Evaluator, EvalMetric
from typing import List

class SQLAccuracyMetric(EvalMetric):
    """Custom metric for SQL query accuracy."""
    name = "sql_accuracy"

    async def compute(self, prediction: str, reference: str) -> float:
        # Compare SQL structure and results
        pred_normalized = self.normalize_sql(prediction)
        ref_normalized = self.normalize_sql(reference)

        if pred_normalized == ref_normalized:
            return 1.0

        # Partial credit for correct structure
        pred_parts = set(pred_normalized.split())
        ref_parts = set(ref_normalized.split())
        overlap = len(pred_parts & ref_parts) / len(ref_parts)

        return overlap

    def normalize_sql(self, sql: str) -> str:
        import re
        sql = sql.upper()
        sql = re.sub(r'\s+', ' ', sql)
        sql = sql.strip()
        return sql

# Run evaluation
evaluator = Evaluator(
    client=client,
    metrics=[
        "relevance",        # Built-in
        "coherence",        # Built-in
        "groundedness",     # Built-in
        SQLAccuracyMetric() # Custom
    ]
)

test_cases = [
    {
        "input": "What is our total revenue this year?",
        "expected_sql": "SELECT SUM(revenue) FROM sales WHERE YEAR(sale_date) = 2024",
        "expected_answer_contains": ["revenue", "total", "2024"]
    },
    {
        "input": "Show me customer count by region",
        "expected_sql": "SELECT region, COUNT(*) FROM customers GROUP BY region",
        "expected_answer_contains": ["region", "customers", "count"]
    }
]

results = await evaluator.evaluate(
    agent=data_analyst,
    test_cases=test_cases,
    num_runs=3  # Average over multiple runs
)

print(f"Overall Score: {results.overall_score:.2f}")
for metric, score in results.metric_scores.items():
    print(f"  {metric}: {score:.2f}")
```

## Deploying to Production

```yaml
# deployments/production.yaml
deployment:
  name: data-analyst-production
  agent: DataAnalyst

  compute:
    type: managed
    sku: Standard_D4s_v3
    min_instances: 2
    max_instances: 10

  scaling:
    metric: requests_per_second
    target: 100
    scale_up_threshold: 80
    scale_down_threshold: 20

  monitoring:
    application_insights: true
    custom_metrics:
      - query_latency
      - token_usage
      - error_rate

  security:
    authentication: azure_ad
    allowed_origins:
      - "https://app.contoso.com"
    rate_limiting:
      requests_per_minute: 100
      tokens_per_minute: 50000
```

```python
# Deploy using SDK
deployment = client.deployments.create(
    project_name="data-analytics-assistant",
    config_path="deployments/production.yaml"
)

print(f"Deployment URL: {deployment.endpoint}")
print(f"Status: {deployment.status}")
```

## Monitoring and Observability

```python
from azure.ai.foundry.monitoring import Dashboard, Alert

# Create monitoring dashboard
dashboard = Dashboard(
    name="data-analyst-monitoring",
    project="data-analytics-assistant",
    panels=[
        {"type": "time_series", "metric": "request_count", "title": "Requests"},
        {"type": "time_series", "metric": "latency_p95", "title": "P95 Latency"},
        {"type": "pie_chart", "metric": "tool_usage", "title": "Tool Distribution"},
        {"type": "table", "metric": "error_logs", "title": "Recent Errors"}
    ]
)

# Set up alerts
alert = Alert(
    name="high-error-rate",
    condition="error_rate > 0.05",
    window_minutes=5,
    action="email",
    recipients=["oncall@company.com"]
)

client.monitoring.create_dashboard(dashboard)
client.monitoring.create_alert(alert)
```

Azure AI Foundry provides the foundation for building enterprise-grade AI applications with proper tooling, evaluation, and monitoring. The platform continues to evolve rapidly with new capabilities announced at Ignite 2024.

## Resources

- [Azure AI Foundry Documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/)
- [AI Foundry SDK Reference](https://learn.microsoft.com/en-us/python/api/azure-ai-foundry/)
- [Best Practices Guide](https://learn.microsoft.com/en-us/azure/ai-foundry/best-practices/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
