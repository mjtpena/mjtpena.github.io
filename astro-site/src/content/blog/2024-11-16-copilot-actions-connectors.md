---
title: "Copilot Actions and Connectors: Extending AI Capabilities"
author: Michael John Peña
draft: false
date: 2024-11-16
tags:
  - Azure
  - AI
  - Copilot
  - Connectors
  - Integration

---

I wrote "Copilot Actions and Connectors: Extending AI Capabilities" to share practical, production-minded guidance on this topic.

## Understanding the Action Framework

```
User Request → Copilot → Action Router → Connector → External System
                  ↑                           ↓
                  └──── Response ←── Transform ←┘
```

## Building Custom Actions

### Simple Action: Data Lookup

Actions in Copilot Studio are implemented using Power Automate flows or Azure Functions.

```python
# Azure Function implementation for customer lookup action
import azure.functions as func
import json
from azure.identity import DefaultAzureCredential

def main(req: func.HttpRequest) -> func.HttpResponse:
    """Customer lookup action - called from Copilot Studio via HTTP connector."""

    identifier = req.params.get('identifier')
    include_history = req.params.get('include_history', 'false').lower() == 'true'

    if not identifier:
        return func.HttpResponse(
            json.dumps({"success": False, "message": "Identifier required"}),
            status_code=400,
            mimetype="application/json"
        )

    # Connect to your CRM (example using Dataverse)
    credential = DefaultAzureCredential()
    # ... CRM lookup logic ...

    # Mock response for example
    if "@" in identifier:
        customer = {"id": "C001", "name": "John Doe", "email": identifier}
    else:
        customer = {"id": identifier, "name": "John Doe", "email": "john@example.com"}

    result = {
        "success": True,
        "data": {
            "id": customer["id"],
            "name": customer["name"],
            "email": customer["email"],
            "tier": "Gold",
            "account_manager": "Jane Smith"
        },
        "message": f"Found customer: {customer['name']}"
    }

    if include_history:
        result["data"]["purchase_history"] = {
            "total_orders": 15,
            "lifetime_value": 5000.00,
            "recent_orders": [{"date": "2024-01-15", "amount": 150.00}]
        }

    return func.HttpResponse(json.dumps(result), mimetype="application/json")

# In Copilot Studio:
# 1. Create a custom connector or use HTTP action
# 2. Configure the Azure Function URL
# 3. Define input/output parameters in the topic
```

### Complex Action: Multi-Step Workflow

Multi-step workflows are best implemented using Power Automate flows.

```yaml
# Power Automate flow definition for multi-step analytics report
# Flow: CreateAnalyticsReportAction

trigger:
  type: "When Power Virtual Agents calls a flow"
  inputs:
    - report_type: string
    - date_range: string
    - recipients: array

steps:
  - name: "Gather Requirements"
    action: "Compose"
    inputs:
      report_config:
        type: "@{triggerBody()['report_type']}"
        range: "@{triggerBody()['date_range']}"

  - name: "Query Fabric Data"
    action: "HTTP"
    inputs:
      method: "POST"
      uri: "https://api.fabric.microsoft.com/v1/workspaces/.../queries"
      headers:
        Authorization: "Bearer @{...}"

  - name: "Generate Visuals"
    action: "Call Azure Function"
    # Generate charts using matplotlib/plotly

  - name: "Compile Report"
    action: "Create file"
    # Create PDF using reporting library

  - name: "Distribute"
    action: "Send Email"
    inputs:
      to: "@{triggerBody()['recipients']}"
      subject: "Your Analytics Report"
      attachments: "@{outputs('Compile_Report')}"

# Register this flow as an action in Copilot Studio
```

```python
# Azure Function for complex report generation
class CreateAnalyticsReportAction:
    """Multi-step action to create and distribute analytics report."""

    name = "CreateAnalyticsReport"
    description = "Generate an analytics report and distribute to stakeholders"

    steps = [
        Step(
            name="gather_requirements",
            description="Collect report requirements from user"
        ),
        Step(
            name="query_data",
            description="Execute queries to gather report data"
        ),
        Step(
            name="generate_visuals",
            description="Create charts and visualizations"
        ),
        Step(
            name="compile_report",
            description="Assemble the final report"
        ),
        Step(
            name="distribute",
            description="Send report to stakeholders"
        )
    ]

    async def execute_gather_requirements(self, context) -> dict:
        """Interactive step to gather report requirements."""

        # This would trigger a conversation to collect:
        return {
            "report_type": context.get("report_type", "sales_summary"),
            "date_range": context.get("date_range", "last_month"),
            "dimensions": context.get("dimensions", ["region", "product"]),
            "metrics": context.get("metrics", ["revenue", "units"]),
            "recipients": context.get("recipients", [])
        }

    async def execute_query_data(self, context) -> dict:
        """Query data based on requirements."""

        requirements = context["gather_requirements"]

        # Build dynamic query
        query = self.build_query(
            report_type=requirements["report_type"],
            date_range=requirements["date_range"],
            dimensions=requirements["dimensions"],
            metrics=requirements["metrics"]
        )

        result = await self.fabric_client.execute_query(query)

        return {
            "data": result.to_dict(),
            "row_count": len(result),
            "query_time_ms": result.execution_time_ms
        }

    async def execute_generate_visuals(self, context) -> dict:
        """Generate visualizations from data."""

        data = context["query_data"]["data"]
        requirements = context["gather_requirements"]

        visuals = []

        # Auto-detect appropriate chart types
        for metric in requirements["metrics"]:
            for dimension in requirements["dimensions"]:
                chart_type = self.suggest_chart_type(dimension, metric)
                visual = await self.chart_service.create(
                    data=data,
                    x=dimension,
                    y=metric,
                    chart_type=chart_type
                )
                visuals.append(visual)

        return {"visuals": visuals}

    async def execute_compile_report(self, context) -> dict:
        """Compile final report document."""

        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas
        import io

        buffer = io.BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=letter)

        # Add title
        requirements = context["gather_requirements"]
        pdf.drawString(100, 750, f"Analytics Report: {requirements['report_type']}")
        pdf.drawString(100, 730, f"Period: {requirements['date_range']}")

        # Add visuals
        y_position = 700
        for visual in context["generate_visuals"]["visuals"]:
            pdf.drawImage(visual.image_path, 100, y_position - 200, width=400, height=200)
            y_position -= 220

        pdf.save()
        buffer.seek(0)

        # Upload to storage
        report_url = await self.storage.upload(
            content=buffer,
            filename=f"report_{datetime.now().isoformat()}.pdf"
        )

        return {"report_url": report_url}

    async def execute_distribute(self, context) -> dict:
        """Distribute report to stakeholders."""

        recipients = context["gather_requirements"]["recipients"]
        report_url = context["compile_report"]["report_url"]

        # Send via email
        for recipient in recipients:
            await self.email_service.send(
                to=recipient,
                subject="Your Analytics Report is Ready",
                body=f"Your requested report is available: {report_url}",
                attachments=[report_url]
            )

        return {
            "distributed_to": recipients,
            "distribution_time": datetime.now().isoformat()
        }
```

## Building Connectors

### REST API Connector

Connectors are defined using OpenAPI specifications and registered in Power Platform.

```yaml
# OpenAPI connector definition for Microsoft Fabric
# fabric-connector.swagger.json

swagger: "2.0"
info:
  title: "Microsoft Fabric Connector"
  version: "1.0"
host: "api.fabric.microsoft.com"
basePath: "/v1"
schemes: ["https"]
securityDefinitions:
  oauth2:
    type: "oauth2"
    flow: "accessCode"
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/authorize"
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/token"
    scopes:
      https://api.fabric.microsoft.com/.default: "Access Fabric"

paths:
  /workspaces:
    get:
      operationId: "ListWorkspaces"
      summary: "List workspaces"
      responses:
        200:
          description: "Success"
  /workspaces/{workspaceId}/items:
    get:
      operationId: "ListItems"
      parameters:
        - name: workspaceId
          in: path
          required: true
          type: string

# Python implementation for custom connector logic
class FabricConnector:
    """Connector for Microsoft Fabric APIs."""

    name = "Microsoft Fabric"
    description = "Connect to Microsoft Fabric workspaces and execute queries"
    icon_url = "https://assets.microsoft.com/fabric-icon.png"

    auth = AuthType.OAUTH2
    oauth_config = {
        "authorization_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "scopes": ["https://api.fabric.microsoft.com/.default"]
    }

    base_url = "https://api.fabric.microsoft.com/v1"

    operations = {
        "list_workspaces": Operation(
            method="GET",
            path="/workspaces",
            description="List all accessible workspaces",
            response_schema={
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "displayName": {"type": "string"},
                        "type": {"type": "string"}
                    }
                }
            }
        ),

        "execute_query": Operation(
            method="POST",
            path="/workspaces/{workspace_id}/lakehouses/{lakehouse_id}/queries",
            description="Execute a SQL query against a lakehouse",
            parameters={
                "workspace_id": {"type": "string", "required": True},
                "lakehouse_id": {"type": "string", "required": True}
            },
            body_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "maxRows": {"type": "integer", "default": 1000}
                }
            }
        ),

        "get_table_schema": Operation(
            method="GET",
            path="/workspaces/{workspace_id}/lakehouses/{lakehouse_id}/tables/{table_name}/schema",
            description="Get schema for a lakehouse table"
        )
    }

    def transform_response(self, operation: str, response: dict) -> dict:
        """Transform API responses for Copilot consumption."""

        if operation == "execute_query":
            return {
                "summary": f"Query returned {len(response.get('results', []))} rows",
                "columns": response.get("schema", {}).get("columns", []),
                "data": response.get("results", [])[:10],  # Sample for display
                "total_rows": len(response.get("results", []))
            }

        return response
```

### Database Connector

For database connections, use Power Platform SQL connectors or create custom connectors.

```python
# Custom database connector using Azure Functions
import pyodbc
import json
import azure.functions as func

class AzureSQLConnector:
    """Connector for Azure SQL Database."""

    name = "Azure SQL"
    description = "Connect to Azure SQL databases"

    connection_parameters = {
        "server": {"type": "string", "required": True},
        "database": {"type": "string", "required": True},
        "authentication": {
            "type": "enum",
            "values": ["sql", "azure_ad", "managed_identity"],
            "default": "managed_identity"
        }
    }

    async def test_connection(self) -> bool:
        """Test database connectivity."""
        try:
            await self.execute_query("SELECT 1")
            return True
        except Exception:
            return False

    async def get_schema(self) -> dict:
        """Get database schema for AI context."""

        query = """
        SELECT
            t.TABLE_SCHEMA,
            t.TABLE_NAME,
            c.COLUMN_NAME,
            c.DATA_TYPE,
            c.IS_NULLABLE
        FROM INFORMATION_SCHEMA.TABLES t
        JOIN INFORMATION_SCHEMA.COLUMNS c
            ON t.TABLE_NAME = c.TABLE_NAME
        WHERE t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME, c.ORDINAL_POSITION
        """

        result = await self.execute_query(query)

        # Transform to hierarchical structure
        schema = {}
        for row in result:
            table_key = f"{row['TABLE_SCHEMA']}.{row['TABLE_NAME']}"
            if table_key not in schema:
                schema[table_key] = {"columns": []}
            schema[table_key]["columns"].append({
                "name": row["COLUMN_NAME"],
                "type": row["DATA_TYPE"],
                "nullable": row["IS_NULLABLE"] == "YES"
            })

        return schema

    def generate_natural_language_context(self, schema: dict) -> str:
        """Generate schema description for AI."""

        descriptions = []
        for table, info in schema.items():
            cols = ", ".join([f"{c['name']} ({c['type']})" for c in info["columns"]])
            descriptions.append(f"Table {table} has columns: {cols}")

        return "\n".join(descriptions)
```

## Chaining Actions and Connectors

Action chains are implemented using Power Automate flow sequences.

```yaml
# Power Automate flow for chained data insights pipeline
name: "DataInsightsPipeline"
trigger: "When Power Virtual Agents calls a flow"

steps:
  # Step 1: Query data
  - name: "QueryFabric"
    action: "HTTP"
    uri: "https://api.fabric.microsoft.com/..."

  # Step 2: Analyze data
  - name: "AnalyzeData"
    action: "Azure Function"
    inputs:
      data: "@{outputs('QueryFabric')}"

  # Step 3: Generate narrative
  - name: "GenerateNarrative"
    action: "Azure OpenAI"
    inputs:
      prompt: "Analyze: @{outputs('AnalyzeData')}"

  # Step 4: Create visualization (conditional)
  - name: "CreateVisualization"
    condition: "@{outputs('AnalyzeData')['visualization_recommended']}"
    action: "Azure Function"

# Return combined results to Copilot
```

```python
# Python implementation of chained pipeline
class DataInsightsPipeline:
    """Chain multiple actions for end-to-end insights."""

    name = "GenerateDataInsights"
    description = "Query data, analyze it, and generate insights"

    chain = [
        {
            "action": "FabricConnector.execute_query",
            "input_mapping": {
                "query": "${user_query}",
                "workspace_id": "${workspace_id}"
            },
            "output_key": "query_result"
        },
        {
            "action": "AnalyzeData",
            "input_mapping": {
                "data": "${query_result.data}"
            },
            "output_key": "analysis"
        },
        {
            "action": "GenerateNarrative",
            "input_mapping": {
                "analysis": "${analysis}",
                "original_question": "${user_question}"
            },
            "output_key": "narrative"
        },
        {
            "action": "CreateVisualization",
            "input_mapping": {
                "data": "${query_result.data}",
                "chart_suggestion": "${analysis.suggested_chart}"
            },
            "output_key": "visualization",
            "conditional": "${analysis.visualization_recommended}"
        }
    ]

    async def execute(self, user_question: str, workspace_id: str) -> dict:
        context = {
            "user_question": user_question,
            "workspace_id": workspace_id
        }

        for step in self.chain:
            # Check conditional
            if "conditional" in step:
                if not self.evaluate_condition(step["conditional"], context):
                    continue

            # Map inputs
            inputs = self.map_inputs(step["input_mapping"], context)

            # Execute action
            result = await self.execute_action(step["action"], inputs)

            # Store output
            context[step["output_key"]] = result

        return {
            "narrative": context.get("narrative"),
            "visualization": context.get("visualization"),
            "raw_data": context.get("query_result", {}).get("data")
        }
```

Actions and connectors are the bridge between conversational AI and enterprise systems. Build them with security, error handling, and user experience in mind.

## Resources

- [Copilot Studio Actions](https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-actions)
- [Connector Development](https://learn.microsoft.com/en-us/connectors/custom-connectors/)
- [Power Platform Connectors](https://learn.microsoft.com/en-us/connectors/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
