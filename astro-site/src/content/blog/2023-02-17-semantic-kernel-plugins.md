---
title: "Semantic Kernel Plugins: Extending AI with Custom Skills"
author: Michael John Peña
draft: false
date: 2023-02-17
tags:
  - Semantic Kernel
  - Azure
  - OpenAI
  - Plugins
  - AI
---

## Plugin Structure

```python
import semantic_kernel as sk
from semantic_kernel.skill_definition import sk_function, sk_function_context_parameter

class AzureServicesPlugin:
    """Plugin for Azure service recommendations."""

    @sk_function(
        description="Recommends Azure compute service based on requirements",
        name="recommend_compute"
    )
    @sk_function_context_parameter(name="workload", description="Type of workload")
    @sk_function_context_parameter(name="scale", description="Expected scale")
    def recommend_compute(self, context: sk.SKContext) -> str:
        workload = context["workload"].lower()
        scale = context["scale"].lower()

        recommendations = {
            ("web", "small"): "Azure App Service (Basic tier)",
            ("web", "large"): "Azure Kubernetes Service",
            ("batch", "small"): "Azure Functions",
            ("batch", "large"): "Azure Batch",
            ("ml", "small"): "Azure ML Compute Instance",
            ("ml", "large"): "Azure ML Compute Cluster"
        }

        key = (workload, scale)
        return recommendations.get(key, "Azure Virtual Machines")

# Register plugin
kernel.import_skill(AzureServicesPlugin(), "AzureServices")
```

## Combining Semantic and Native Functions

```python
# Create a plugin with both types
class DataAnalysisPlugin:
    """Plugin combining code and AI for data analysis."""

    def __init__(self, kernel: sk.Kernel):
        self.kernel = kernel
        self._register_semantic_functions()

    def _register_semantic_functions(self):
        # Semantic function for interpreting results
        interpret_prompt = """
Interpret these data analysis results for a business stakeholder:

Results:
{{$results}}

Provide insights in plain English:"""

        self.interpret_function = self.kernel.create_semantic_function(
            prompt_template=interpret_prompt,
            function_name="interpret",
            skill_name="DataAnalysis",
            max_tokens=500
        )

    @sk_function(
        description="Calculates basic statistics",
        name="calculate_stats"
    )
    @sk_function_context_parameter(name="data", description="Comma-separated numbers")
    def calculate_stats(self, context: sk.SKContext) -> str:
        import statistics
        numbers = [float(x.strip()) for x in context["data"].split(",")]

        stats = {
            "count": len(numbers),
            "mean": statistics.mean(numbers),
            "median": statistics.median(numbers),
            "stdev": statistics.stdev(numbers) if len(numbers) > 1 else 0,
            "min": min(numbers),
            "max": max(numbers)
        }

        return str(stats)

    @sk_function(
        description="Analyzes and interprets data",
        name="analyze"
    )
    @sk_function_context_parameter(name="data", description="Comma-separated numbers")
    async def analyze(self, context: sk.SKContext) -> str:
        # First calculate stats
        stats = self.calculate_stats(context)

        # Then interpret with AI
        context["results"] = stats
        interpretation = await self.interpret_function.invoke_async(context=context)

        return f"Statistics: {stats}\n\nInterpretation: {interpretation}"
```

## Plugin Configuration

```python
import os
import yaml

class ConfigurablePlugin:
    """Plugin with external configuration."""

    def __init__(self, config_path: str):
        with open(config_path) as f:
            self.config = yaml.safe_load(f)

    @sk_function(description="Get configured endpoints", name="get_endpoint")
    @sk_function_context_parameter(name="service", description="Service name")
    def get_endpoint(self, context: sk.SKContext) -> str:
        service = context["service"]
        endpoints = self.config.get("endpoints", {})
        return endpoints.get(service, "Unknown service")

# config.yaml:
# endpoints:
#   storage: https://mystorage.blob.core.windows.net
#   database: https://mydb.documents.azure.com
#   search: https://mysearch.search.windows.net
```

## HTTP Plugin for API Calls

```python
import aiohttp
import json

class HttpPlugin:
    """Plugin for making HTTP requests."""

    @sk_function(
        description="Makes a GET request to a URL",
        name="get"
    )
    @sk_function_context_parameter(name="url", description="URL to request")
    async def get(self, context: sk.SKContext) -> str:
        url = context["url"]
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                return await response.text()

    @sk_function(
        description="Makes a POST request with JSON body",
        name="post"
    )
    @sk_function_context_parameter(name="url", description="URL to request")
    @sk_function_context_parameter(name="body", description="JSON body")
    async def post(self, context: sk.SKContext) -> str:
        url = context["url"]
        body = json.loads(context["body"])

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=body) as response:
                return await response.text()

# Register and use
kernel.import_skill(HttpPlugin(), "Http")

# Usage with planner
plan = await planner.create_plan_async(
    "Get the weather for Seattle from the weather API"
)
```

## Database Plugin

```python
import pyodbc

class SqlPlugin:
    """Plugin for SQL database operations."""

    def __init__(self, connection_string: str):
        self.connection_string = connection_string

    @sk_function(
        description="Executes a SQL query and returns results",
        name="query"
    )
    @sk_function_context_parameter(name="sql", description="SQL query to execute")
    def query(self, context: sk.SKContext) -> str:
        sql = context["sql"]

        # Security: Only allow SELECT queries
        if not sql.strip().upper().startswith("SELECT"):
            return "Error: Only SELECT queries are allowed"

        with pyodbc.connect(self.connection_string) as conn:
            cursor = conn.cursor()
            cursor.execute(sql)
            columns = [column[0] for column in cursor.description]
            rows = cursor.fetchall()

            result = {
                "columns": columns,
                "rows": [list(row) for row in rows],
                "row_count": len(rows)
            }

            return json.dumps(result)

    @sk_function(
        description="Lists available tables in the database",
        name="list_tables"
    )
    def list_tables(self, context: sk.SKContext) -> str:
        with pyodbc.connect(self.connection_string) as conn:
            cursor = conn.cursor()
            tables = cursor.tables(tableType='TABLE')
            table_list = [table.table_name for table in tables]
            return json.dumps(table_list)
```

## Plugin Chaining with Context

```python
async def run_plugin_chain(kernel: sk.Kernel, user_request: str):
    """Chain multiple plugins to fulfill a request."""

    context = kernel.create_new_context()
    context["request"] = user_request

    # Step 1: Parse the request with AI
    parse_function = kernel.create_semantic_function(
        prompt_template="""
Extract the following from the user request:
- action: what they want to do
- entity: what they want to act on
- parameters: any specific values

Request: {{$request}}

Return as JSON:""",
        function_name="parse",
        skill_name="RequestParser"
    )

    parsed = await parse_function.invoke_async(context=context)
    request_data = json.loads(str(parsed))

    # Step 2: Route to appropriate plugin
    if request_data["action"] == "query":
        sql_plugin = kernel.skills.get_function("Sql", "query")
        context["sql"] = request_data["parameters"].get("sql", "")
        result = await sql_plugin.invoke_async(context=context)

    elif request_data["action"] == "recommend":
        azure_plugin = kernel.skills.get_function("AzureServices", "recommend_compute")
        context["workload"] = request_data["parameters"].get("workload", "web")
        context["scale"] = request_data["parameters"].get("scale", "small")
        result = await azure_plugin.invoke_async(context=context)

    else:
        result = "Unknown action"

    return str(result)
```

## Testing Plugins

```python
import pytest
import semantic_kernel as sk

class TestAzureServicesPlugin:
    """Tests for AzureServicesPlugin."""

    def setup_method(self):
        self.kernel = sk.Kernel()
        self.plugin = AzureServicesPlugin()
        self.kernel.import_skill(self.plugin, "AzureServices")

    def test_recommend_compute_web_small(self):
        context = self.kernel.create_new_context()
        context["workload"] = "web"
        context["scale"] = "small"

        result = self.plugin.recommend_compute(context)
        assert "App Service" in result

    def test_recommend_compute_batch_large(self):
        context = self.kernel.create_new_context()
        context["workload"] = "batch"
        context["scale"] = "large"

        result = self.plugin.recommend_compute(context)
        assert "Batch" in result

    def test_unknown_combination(self):
        context = self.kernel.create_new_context()
        context["workload"] = "unknown"
        context["scale"] = "unknown"

        result = self.plugin.recommend_compute(context)
        assert "Virtual Machines" in result
```

## Best Practices

1. **Single responsibility**: Each plugin should do one thing well
2. **Clear descriptions**: Help planners understand what functions do
3. **Validate inputs**: Check parameters before using
4. **Handle errors gracefully**: Return meaningful error messages
5. **Test independently**: Unit test plugins without the full kernel

## Resources

- [Semantic Kernel Plugins](https://learn.microsoft.com/semantic-kernel/ai-orchestration/plugins)
- [Native Functions Guide](https://learn.microsoft.com/semantic-kernel/ai-orchestration/native-functions)
- [Plugin Samples](https://github.com/microsoft/semantic-kernel/tree/main/samples/skills)
