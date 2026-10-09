---
title: "Microsoft Fabric AI Skills: Natural Language Analytics"
description: "AI Skills democratize data access while maintaining governance. Start with well-defined domains and expand based on user feedback."
author: Michael John Peña
draft: false
date: 2024-11-20
tags:
  - Azure
  - Microsoft Fabric
  - AI Skills
  - Natural Language
  - Analytics
---

## Understanding AI Skills

AI Skills are configurable natural language interfaces to your Fabric data:

```
User Question → AI Skill → SQL Generation → Execution → Natural Language Response
                   ↓
            [Schema Context + Instructions + Guardrails]
```

## Creating Your First AI Skill

### Basic Setup

```python
# AI Skills are created via Fabric portal or REST API
# Below shows the configuration pattern using REST API
from azure.identity import DefaultAzureCredential
import requests
import json

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
base_url = "https://api.fabric.microsoft.com/v1"

workspace_id = "your-workspace-id"

# AI Skill configuration
ai_skill_config = {
    "displayName": "SalesAnalyst",
    "type": "AISkill",
    "description": "Analyze sales data using natural language questions",

    # Configuration stored as part of the item definition
    "definition": {
        "dataSources": [{
            "type": "lakehouse",
            "workspace": "SalesAnalytics",
            "name": "SalesLakehouse",
            "tables": ["gold.sales_fact", "dim.products", "dim.customers", "dim.regions"]
        }],

        "instructions": """You are a sales data analyst.
        Help users understand sales performance, trends, and patterns.

        Key metrics:
        - Revenue: SUM(sales_fact.amount)
        - Units: SUM(sales_fact.quantity)
        - Average Order Value: AVG(sales_fact.amount)
        - Customer Count: COUNT(DISTINCT customer_id)

        When answering:
        1. Always include the time period in your response
        2. Compare to previous periods when relevant
        3. Highlight notable trends or anomalies
        4. Suggest follow-up questions""",

        "examples": [
            {
                "question": "What were our sales last month?",
                "sql": """
                    SELECT
                        SUM(amount) as total_revenue,
                        SUM(quantity) as total_units,
                        COUNT(DISTINCT customer_id) as unique_customers
                    FROM gold.sales_fact
                    WHERE date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
                      AND date < DATE_TRUNC('month', CURRENT_DATE)
                """
            },
            {
                "question": "Top 5 products by revenue",
                "sql": """
                    SELECT
                        p.product_name,
                        SUM(s.amount) as revenue
                    FROM gold.sales_fact s
                    JOIN dim.products p ON s.product_id = p.product_id
                    GROUP BY p.product_name
                    ORDER BY revenue DESC
                    LIMIT 5
                """
            }
        ]
    }
}

# Create AI Skill via REST API
response = requests.post(
    f"{base_url}/workspaces/{workspace_id}/items",
    headers=headers,
    json=ai_skill_config
)
print(f"AI Skill created: {response.json()}")
```

### Adding Guardrails

```python
# Guardrails are configured as part of the AI Skill definition
# These are applied when the skill processes queries

guardrails_config = {
    # Row-level security based on user
    "rowFilters": [{
        "table": "gold.sales_fact",
        "condition": "region_id IN (SELECT region_id FROM user_regions WHERE user_email = '{user_email}')"
    }],

    # Column masking for sensitive data
    "columnMasks": [{
        "table": "dim.customers",
        "column": "email",
        "maskFunction": "CONCAT(LEFT(email, 3), '***@', SUBSTRING_INDEX(email, '@', -1))"
    }],

    # Query restrictions
    "restrictions": [
        {
            "type": "row_limit",
            "config": {"max_rows": 10000}
        },
        {
            "type": "blocked_operations",
            "config": {"operations": ["DELETE", "UPDATE", "INSERT", "DROP", "ALTER"]}
        },
        {
            "type": "blocked_tables",
            "config": {"tables": ["raw.*", "staging.*", "pii.*"]}
        },
        {
            "type": "query_timeout",
            "config": {"timeout_seconds": 30}
        }
    ]
}

# Update AI Skill with guardrails via REST API
skill_id = "your-skill-id"
update_payload = {
    "definition": {
        "guardrails": guardrails_config
    }
}

response = requests.patch(
    f"{base_url}/workspaces/{workspace_id}/items/{skill_id}",
    headers=headers,
    json=update_payload
)
print(f"Guardrails added: {response.status_code}")
```

## Advanced Schema Configuration

### Semantic Layer Integration

```python
# Semantic layer configuration for AI Skills
# This metadata helps the AI generate better queries

semantic_layer_config = {
    "name": "SalesSemantics",

    "measures": [
        {
            "name": "Total Revenue",
            "expression": "SUM(sales_fact.amount)",
            "format": "currency",
            "description": "Total sales revenue in USD"
        },
        {
            "name": "Units Sold",
            "expression": "SUM(sales_fact.quantity)",
            "format": "number",
            "description": "Total number of units sold"
        },
        {
            "name": "Average Order Value",
            "expression": "AVG(sales_fact.amount)",
            "format": "currency",
            "description": "Average revenue per order"
        },
        {
            "name": "Year-over-Year Growth",
            "expression": """
                (SUM(CASE WHEN YEAR(date) = YEAR(CURRENT_DATE) THEN amount END) -
                 SUM(CASE WHEN YEAR(date) = YEAR(CURRENT_DATE) - 1 THEN amount END)) /
                NULLIF(SUM(CASE WHEN YEAR(date) = YEAR(CURRENT_DATE) - 1 THEN amount END), 0) * 100
            """,
            "format": "percentage",
            "description": "Year-over-year revenue growth"
        }
    ],

    "dimensions": [
        {
            "name": "Product Category",
            "expression": "products.category",
            "hierarchy": ["products.category", "products.subcategory", "products.product_name"]
        },
        {
            "name": "Region",
            "expression": "regions.region_name",
            "hierarchy": ["regions.country", "regions.region_name", "regions.city"]
        },
        {
            "name": "Time",
            "expression": "sales_fact.date",
            "hierarchy": ["YEAR(date)", "QUARTER(date)", "MONTH(date)", "date"]
        }
    ],

    "relationships": [
        {"from": "sales_fact.product_id", "to": "products.product_id"},
        {"from": "sales_fact.customer_id", "to": "customers.customer_id"},
        {"from": "sales_fact.region_id", "to": "regions.region_id"}
    ]
}

# Add semantic layer to AI Skill via REST API update
update_payload = {
    "definition": {
        "semanticLayer": semantic_layer_config
    }
}

response = requests.patch(
    f"{base_url}/workspaces/{workspace_id}/items/{skill_id}",
    headers=headers,
    json=update_payload
)
```

### Custom Functions

```python
# Custom SQL functions are created in the Lakehouse/Warehouse
# and referenced in the AI Skill configuration

from pyspark.sql import SparkSession
spark = SparkSession.builder.getOrCreate()

# Create custom functions in the Lakehouse SQL endpoint
spark.sql("""
    CREATE OR REPLACE FUNCTION get_fiscal_quarter(d DATE)
    RETURNS STRING
    RETURN CONCAT('FY', YEAR(d) + CASE WHEN MONTH(d) >= 4 THEN 1 ELSE 0 END,
                  ' Q', CAST(CEIL((MONTH(d) + 9) % 12 / 3.0) AS INT))
""")

spark.sql("""
    CREATE OR REPLACE FUNCTION calculate_moving_average(metric_value DOUBLE, partition_col STRING, order_col DATE)
    RETURNS DOUBLE
    RETURN AVG(metric_value) OVER (
        PARTITION BY partition_col
        ORDER BY order_col
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    )
""")

# Reference these functions in the AI Skill configuration
custom_functions_config = [
    {
        "name": "get_fiscal_quarter",
        "description": "Convert date to fiscal quarter (FY starts April)",
        "usage": "get_fiscal_quarter(date_column)"
    },
    {
        "name": "calculate_moving_average",
        "description": "Calculate 7-day moving average",
        "usage": "calculate_moving_average(value, partition_col, date_col)"
    }
]

# Update AI Skill to include function documentation
update_payload = {
    "definition": {
        "customFunctions": custom_functions_config
    }
}

response = requests.patch(
    f"{base_url}/workspaces/{workspace_id}/items/{skill_id}",
    headers=headers,
    json=update_payload
)
```

## Using AI Skills

### Direct Query Interface

```python
# Query AI Skills via REST API
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

workspace_id = "your-workspace-id"
skill_id = "your-skill-id"

def ask_ai_skill(question: str, context: dict = None) -> dict:
    """Query an AI Skill with a natural language question."""
    payload = {
        "question": question
    }
    if context:
        payload["context"] = context

    response = requests.post(
        f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items/{skill_id}/query",
        headers=headers,
        json=payload
    )
    return response.json()

# Simple question
result = ask_ai_skill(
    question="How did we perform last quarter compared to the same quarter last year?"
)

print(f"Answer: {result.get('answer')}")
print(f"SQL: {result.get('sqlQuery')}")
print(f"Data: {result.get('data')}")
print(f"Confidence: {result.get('confidenceScore')}")

# With context
result = ask_ai_skill(
    question="Show me the trend",
    context={
        "previous_question": "What are our top 5 products?",
        "previous_result": previous_result.get('data'),
        "filters": {"region": "North America"}
    }
)
```

### Conversational Interface

```python
# Conversational interface using session-based queries
import uuid

class AISkillConversation:
    def __init__(self, workspace_id: str, skill_id: str):
        self.workspace_id = workspace_id
        self.skill_id = skill_id
        self.session_id = str(uuid.uuid4())
        self.history = []

    def ask(self, question: str) -> dict:
        """Ask a question in the conversation context."""
        payload = {
            "question": question,
            "sessionId": self.session_id,
            "conversationHistory": self.history
        }

        response = requests.post(
            f"https://api.fabric.microsoft.com/v1/workspaces/{self.workspace_id}/items/{self.skill_id}/query",
            headers=headers,
            json=payload
        )

        result = response.json()
        self.history.append({"question": question, "answer": result.get("answer")})
        return result

    def summarize(self) -> str:
        """Get a summary of the conversation."""
        return "\n".join([f"Q: {h['question']}\nA: {h['answer']}" for h in self.history])

# Start a conversation
conversation = AISkillConversation(workspace_id, skill_id)

# Multi-turn interaction
response1 = conversation.ask("What were our sales last month?")
print(response1.get("answer"))

response2 = conversation.ask("Break that down by product category")
print(response2.get("answer"))

response3 = conversation.ask("Which category grew the most vs previous month?")
print(response3.get("answer"))

# Get conversation summary
summary = conversation.summarize()
print(summary)
```

### Integration with Power BI

```python
# Use Semantic Link for Power BI integration with AI Skills
import sempy.fabric as fabric
from openai import AzureOpenAI

# Azure OpenAI client for DAX generation
aoai_client = AzureOpenAI(
    azure_endpoint="https://your-aoai.openai.azure.com/",
    api_version="2024-02-01"
)

def generate_dax_from_natural_language(question: str, workspace: str, dataset: str) -> dict:
    """Generate DAX from natural language using AI and Semantic Link."""

    # Get model metadata using Semantic Link
    tables = fabric.list_tables(dataset=dataset, workspace=workspace)
    measures = fabric.list_measures(dataset=dataset, workspace=workspace)

    model_context = f"Tables: {tables.to_dict()}\nMeasures: {measures.to_dict()}"

    # Generate DAX using Azure OpenAI
    response = aoai_client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "system",
            "content": f"You are a DAX expert. Generate a DAX measure based on the model:\n{model_context}"
        }, {
            "role": "user",
            "content": question
        }]
    )

    dax_code = response.choices[0].message.content

    return {
        "measure_code": dax_code,
        "suggested_visual": "Bar chart with category on axis and measure as value"
    }

# Generate DAX from natural language
dax = generate_dax_from_natural_language(
    question="Show revenue by category with year-over-year comparison",
    workspace="SalesAnalytics",
    dataset="SalesModel"
)

print(f"DAX Measure:\n{dax['measure_code']}")
print(f"Visual Suggestion: {dax['suggested_visual']}")
```

## Monitoring and Optimization

```python
# Monitor AI Skills using Fabric REST API and custom logging
from azure.identity import DefaultAzureCredential
import requests
from datetime import datetime, timedelta

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default").token
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

def get_skill_usage(workspace_id: str, skill_id: str, days: int = 30) -> dict:
    """Get usage metrics for an AI Skill."""
    # Query activity logs via Fabric Admin API
    start_date = (datetime.now() - timedelta(days=days)).isoformat()

    response = requests.get(
        f"https://api.fabric.microsoft.com/v1/admin/activityevents",
        headers=headers,
        params={
            "startDateTime": start_date,
            "endDateTime": datetime.now().isoformat(),
            "filter": f"itemId eq '{skill_id}'"
        }
    )

    events = response.json().get("activityEventEntities", [])

    # Aggregate metrics
    total_questions = len(events)
    unique_users = len(set(e.get("userId") for e in events))
    successful = sum(1 for e in events if e.get("status") == "Succeeded")
    success_rate = (successful / total_questions * 100) if total_questions > 0 else 0

    return {
        "total_questions": total_questions,
        "unique_users": unique_users,
        "success_rate": round(success_rate, 1),
        "events": events
    }

# Get usage metrics
usage = get_skill_usage(workspace_id, skill_id, days=30)
print(f"Total questions: {usage['total_questions']}")
print(f"Unique users: {usage['unique_users']}")
print(f"Success rate: {usage['success_rate']}%")

# Analyze failed questions from logs
failed_events = [e for e in usage["events"] if e.get("status") == "Failed"]
for event in failed_events[:20]:
    print(f"Question: {event.get('parameters', {}).get('question')}")
    print(f"Error: {event.get('errorMessage')}")
    print("---")
```

AI Skills democratize data access while maintaining governance. Start with well-defined domains and expand based on user feedback.

## Resources

- [AI Skills Documentation](https://learn.microsoft.com/en-us/fabric/ai-skills)
- [Semantic Layer Guide](https://learn.microsoft.com/en-us/fabric/semantic-models)
- [Best Practices](https://learn.microsoft.com/en-us/fabric/ai-skills/best-practices)
