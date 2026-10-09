---
title: "Fabric Analytics Agents: Automated Data Analysis"
description: "Analytics agents reduce manual toil while improving data reliability. Start with monitoring agents for quick wins, then expand to exploration and quality…"
author: Michael John Peña
draft: false
date: 2024-11-21
tags:
  - Azure
  - Microsoft Fabric
  - Analytics Agents
  - Automation
  - Data Analysis
---

## Types of Analytics Agents

```
┌─────────────────────────────────────────────────────────────┐
│                   Analytics Agent Patterns                   │
├─────────────────┬─────────────────┬─────────────────────────┤
│  Data Quality   │   Exploration   │    Monitoring           │
│     Agent       │     Agent       │      Agent              │
├─────────────────┼─────────────────┼─────────────────────────┤
│ - Profile data  │ - Auto EDA      │ - Anomaly detection     │
│ - Find issues   │ - Find patterns │ - Alert on changes      │
│ - Suggest fixes │ - Correlations  │ - Root cause analysis   │
│ - Track trends  │ - Outliers      │ - Trend monitoring      │
└─────────────────┴─────────────────┴─────────────────────────┘
```

## Data Quality Agent with LangChain

```python
from langchain.agents import AgentExecutor, create_openai_functions_agent
from langchain_openai import AzureChatOpenAI
from langchain.tools import tool
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from pyspark.sql import SparkSession
import json

# Initialize Spark and LLM
spark = SparkSession.builder.getOrCreate()
llm = AzureChatOpenAI(
    deployment_name="gpt-4o",
    api_version="2024-02-15-preview"
)

@tool
def profile_table(table_name: str) -> str:
    """Profile a table to get statistics about data quality."""
    df = spark.table(table_name)

    profile = {
        "row_count": df.count(),
        "columns": []
    }

    for col in df.columns:
        col_stats = {
            "name": col,
            "dtype": str(df.schema[col].dataType),
            "null_count": df.filter(df[col].isNull()).count(),
            "distinct_count": df.select(col).distinct().count()
        }
        profile["columns"].append(col_stats)

    return json.dumps(profile, indent=2)

@tool
def check_duplicates(table_name: str, key_columns: str) -> str:
    """Check for duplicate records based on key columns."""
    df = spark.table(table_name)
    keys = [k.strip() for k in key_columns.split(",")]

    duplicates = df.groupBy(keys).count().filter("count > 1")
    dup_count = duplicates.count()

    return f"Found {dup_count} duplicate key combinations in {table_name}"

@tool
def check_referential_integrity(fact_table: str, dim_table: str,
                                 fact_key: str, dim_key: str) -> str:
    """Check referential integrity between fact and dimension tables."""
    fact_df = spark.table(fact_table)
    dim_df = spark.table(dim_table)

    orphans = fact_df.join(
        dim_df,
        fact_df[fact_key] == dim_df[dim_key],
        "left_anti"
    )
    orphan_count = orphans.count()

    return f"Found {orphan_count} orphan records in {fact_table} without matching {dim_table}"

@tool
def run_quality_rule(table_name: str, condition: str) -> str:
    """Run a custom quality rule on a table."""
    df = spark.table(table_name)
    violations = df.filter(f"NOT ({condition})")
    violation_count = violations.count()
    total_count = df.count()

    return f"Quality rule '{condition}': {violation_count} violations out of {total_count} records ({100*violation_count/total_count:.2f}%)"

# Create agent
tools = [profile_table, check_duplicates, check_referential_integrity, run_quality_rule]

prompt = ChatPromptTemplate.from_messages([
    ("system", """You are a data quality analyst agent. Analyze tables for quality issues and provide actionable recommendations.

For each analysis:
1. Profile the table first
2. Check for common issues (nulls, duplicates, referential integrity)
3. Summarize findings with severity levels
4. Suggest specific fixes"""),
    ("human", "{input}"),
    MessagesPlaceholder(variable_name="agent_scratchpad")
])

agent = create_openai_functions_agent(llm, tools, prompt)
quality_agent = AgentExecutor(agent=agent, tools=tools, verbose=True)

# Run quality analysis
result = quality_agent.invoke({
    "input": "Analyze the data quality of gold.customer_360 table. Check for duplicates on customer_id and validate that email addresses are not null."
})

print(result["output"])
```

## Data Exploration Agent with Semantic Kernel

```python
import semantic_kernel as sk
from semantic_kernel.connectors.ai.open_ai import AzureChatCompletion
from semantic_kernel.functions import kernel_function
import pandas as pd
from pyspark.sql import SparkSession

# Initialize Semantic Kernel
kernel = sk.Kernel()
kernel.add_service(AzureChatCompletion(
    deployment_name="gpt-4o",
    endpoint="https://your-resource.openai.azure.com/",
    api_key="your-api-key"
))

spark = SparkSession.builder.getOrCreate()

class ExplorationPlugin:
    """Plugin for data exploration tasks."""

    @kernel_function(
        name="get_statistics",
        description="Get descriptive statistics for a table"
    )
    def get_statistics(self, table_name: str) -> str:
        df = spark.table(table_name)
        stats = df.describe().toPandas().to_markdown()
        return stats

    @kernel_function(
        name="find_correlations",
        description="Find correlations between numeric columns"
    )
    def find_correlations(self, table_name: str) -> str:
        df = spark.table(table_name)
        numeric_cols = [f.name for f in df.schema.fields
                       if str(f.dataType) in ['IntegerType', 'DoubleType', 'LongType']]

        correlations = []
        for i, col1 in enumerate(numeric_cols):
            for col2 in numeric_cols[i+1:]:
                corr = df.stat.corr(col1, col2)
                if abs(corr) > 0.5:
                    correlations.append(f"{col1} <-> {col2}: {corr:.3f}")

        return "\n".join(correlations) if correlations else "No strong correlations found"

    @kernel_function(
        name="detect_outliers",
        description="Detect outliers in numeric columns using IQR method"
    )
    def detect_outliers(self, table_name: str, column: str) -> str:
        df = spark.table(table_name)
        quantiles = df.approxQuantile(column, [0.25, 0.75], 0.01)
        q1, q3 = quantiles[0], quantiles[1]
        iqr = q3 - q1
        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr

        outliers = df.filter(f"{column} < {lower_bound} OR {column} > {upper_bound}")
        outlier_count = outliers.count()
        total_count = df.count()

        return f"Column {column}: {outlier_count} outliers ({100*outlier_count/total_count:.2f}%) outside [{lower_bound:.2f}, {upper_bound:.2f}]"

    @kernel_function(
        name="analyze_distribution",
        description="Analyze the distribution of a column"
    )
    def analyze_distribution(self, table_name: str, column: str) -> str:
        df = spark.table(table_name)

        # Get value distribution
        distribution = df.groupBy(column).count().orderBy("count", ascending=False)
        top_values = distribution.limit(10).toPandas()

        return f"Top 10 values in {column}:\n{top_values.to_markdown()}"

# Add plugin to kernel
kernel.add_plugin(ExplorationPlugin(), plugin_name="exploration")

# Create exploration function
explore_prompt = """
Analyze the following data exploration request and use the available tools to provide insights.

Request: {{$request}}

Steps:
1. Get basic statistics
2. Look for correlations
3. Check for outliers in key numeric columns
4. Summarize key findings and patterns
"""

exploration_function = kernel.add_function(
    plugin_name="analyst",
    function_name="explore",
    prompt=explore_prompt
)

# Run exploration
async def explore_data(table_name: str, focus_areas: list):
    result = await kernel.invoke(
        exploration_function,
        request=f"Explore {table_name} focusing on {', '.join(focus_areas)}"
    )
    return str(result)

# Usage
import asyncio
insights = asyncio.run(explore_data(
    "gold.sales_fact",
    ["trends", "correlations", "anomalies"]
))
print(insights)
```

## Monitoring Agent with OpenAI Assistants

```python
from openai import AzureOpenAI
import json
from datetime import datetime, timedelta

client = AzureOpenAI(
    api_version="2024-05-01-preview",
    azure_endpoint="https://your-resource.openai.azure.com/"
)

# Define monitoring tools
tools = [
    {
        "type": "function",
        "function": {
            "name": "query_metric",
            "description": "Query a metric value from the data platform",
            "parameters": {
                "type": "object",
                "properties": {
                    "metric_name": {"type": "string", "description": "Name of the metric"},
                    "time_range": {"type": "string", "description": "Time range (e.g., '1h', '24h', '7d')"}
                },
                "required": ["metric_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "detect_anomaly",
            "description": "Check if a metric value is anomalous",
            "parameters": {
                "type": "object",
                "properties": {
                    "metric_name": {"type": "string"},
                    "current_value": {"type": "number"},
                    "algorithm": {"type": "string", "enum": ["zscore", "iqr", "prophet"]}
                },
                "required": ["metric_name", "current_value"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "send_alert",
            "description": "Send an alert notification",
            "parameters": {
                "type": "object",
                "properties": {
                    "severity": {"type": "string", "enum": ["info", "warning", "critical"]},
                    "message": {"type": "string"},
                    "channel": {"type": "string", "enum": ["teams", "email", "pagerduty"]}
                },
                "required": ["severity", "message", "channel"]
            }
        }
    }
]

# Create assistant
assistant = client.beta.assistants.create(
    name="Data Monitoring Agent",
    instructions="""You are a data monitoring agent. Your job is to:
1. Query metrics regularly
2. Detect anomalies
3. Investigate root causes
4. Send appropriate alerts

When anomalies are detected:
- Critical: PagerDuty + Teams
- Warning: Teams
- Info: Email digest""",
    model="gpt-4o",
    tools=tools
)

def handle_tool_call(tool_name: str, arguments: dict):
    """Handle tool calls from the assistant."""
    if tool_name == "query_metric":
        # Query from your data platform
        spark = SparkSession.builder.getOrCreate()
        metric = arguments["metric_name"]
        # Example query
        result = spark.sql(f"SELECT current_value FROM metrics WHERE name = '{metric}'").first()
        return {"value": result[0] if result else None, "timestamp": datetime.utcnow().isoformat()}

    elif tool_name == "detect_anomaly":
        # Use statistical methods
        current = arguments["current_value"]
        # Simplified anomaly detection
        historical_mean = 100  # Would come from historical data
        historical_std = 15
        zscore = abs(current - historical_mean) / historical_std
        return {"is_anomaly": zscore > 3, "zscore": zscore}

    elif tool_name == "send_alert":
        # Send to appropriate channel
        print(f"ALERT [{arguments['severity']}]: {arguments['message']}")
        return {"sent": True, "channel": arguments["channel"]}

    return {"error": "Unknown tool"}

# Run monitoring check
def run_monitoring_check(metrics: list):
    """Run a monitoring check on specified metrics."""
    thread = client.beta.threads.create()

    client.beta.threads.messages.create(
        thread_id=thread.id,
        role="user",
        content=f"Check the following metrics for anomalies: {', '.join(metrics)}. Investigate any issues and alert if necessary."
    )

    run = client.beta.threads.runs.create(
        thread_id=thread.id,
        assistant_id=assistant.id
    )

    # Poll for completion and handle tool calls
    while run.status in ["queued", "in_progress", "requires_action"]:
        if run.status == "requires_action":
            tool_outputs = []
            for tool_call in run.required_action.submit_tool_outputs.tool_calls:
                result = handle_tool_call(
                    tool_call.function.name,
                    json.loads(tool_call.function.arguments)
                )
                tool_outputs.append({
                    "tool_call_id": tool_call.id,
                    "output": json.dumps(result)
                })

            run = client.beta.threads.runs.submit_tool_outputs(
                thread_id=thread.id,
                run_id=run.id,
                tool_outputs=tool_outputs
            )
        else:
            import time
            time.sleep(1)
            run = client.beta.threads.runs.retrieve(thread_id=thread.id, run_id=run.id)

    # Get final response
    messages = client.beta.threads.messages.list(thread_id=thread.id)
    return messages.data[0].content[0].text.value

# Example usage
result = run_monitoring_check(["daily_revenue", "order_count", "data_freshness"])
print(result)
```

## Agent Orchestration with LangGraph

```python
from langgraph.graph import StateGraph, END
from typing import TypedDict, Annotated
import operator

class AgentState(TypedDict):
    messages: Annotated[list, operator.add]
    quality_score: float
    findings: list
    next_agent: str

def quality_agent_node(state: AgentState) -> AgentState:
    """Data quality check agent."""
    # Run quality checks
    quality_score = 95  # From actual checks
    findings = ["Minor null values in email column"]

    return {
        "messages": state["messages"] + [f"Quality score: {quality_score}"],
        "quality_score": quality_score,
        "findings": state.get("findings", []) + findings,
        "next_agent": "explorer" if quality_score < 95 else "monitor"
    }

def exploration_agent_node(state: AgentState) -> AgentState:
    """Data exploration agent."""
    # Run exploration
    findings = ["Found correlation between column A and B"]

    return {
        "messages": state["messages"] + ["Exploration complete"],
        "quality_score": state["quality_score"],
        "findings": state.get("findings", []) + findings,
        "next_agent": "monitor"
    }

def monitoring_agent_node(state: AgentState) -> AgentState:
    """Monitoring and alerting agent."""
    # Check metrics and alert if needed
    return {
        "messages": state["messages"] + ["Monitoring check complete"],
        "quality_score": state["quality_score"],
        "findings": state["findings"],
        "next_agent": "end"
    }

def route_to_next(state: AgentState) -> str:
    """Route to next agent based on state."""
    next_agent = state.get("next_agent", "end")
    return next_agent if next_agent != "end" else END

# Build the graph
workflow = StateGraph(AgentState)

# Add nodes
workflow.add_node("quality", quality_agent_node)
workflow.add_node("explorer", exploration_agent_node)
workflow.add_node("monitor", monitoring_agent_node)

# Add edges
workflow.set_entry_point("quality")
workflow.add_conditional_edges("quality", route_to_next, {
    "explorer": "explorer",
    "monitor": "monitor",
    END: END
})
workflow.add_conditional_edges("explorer", route_to_next, {
    "monitor": "monitor",
    END: END
})
workflow.add_edge("monitor", END)

# Compile
orchestrator = workflow.compile()

# Run workflow
initial_state = {
    "messages": ["Starting daily health check"],
    "quality_score": 0,
    "findings": [],
    "next_agent": "quality"
}

result = orchestrator.invoke(initial_state)
print(f"Findings: {result['findings']}")
print(f"Quality Score: {result['quality_score']}")
```

Analytics agents reduce manual toil while improving data reliability. Start with monitoring agents for quick wins, then expand to exploration and quality agents.

## Resources

- [LangChain Agents](https://python.langchain.com/docs/modules/agents/)
- [Semantic Kernel](https://learn.microsoft.com/semantic-kernel/)
- [OpenAI Assistants API](https://platform.openai.com/docs/assistants/overview)
- [LangGraph](https://langchain-ai.github.io/langgraph/)
