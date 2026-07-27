---
title: "Fabric and Copilot Studio Integration: Building Data-Driven AI Assistants"
author: Michael John Peña
draft: false
date: 2024-11-28
tags:
  - Azure
  - Microsoft Fabric
  - Copilot Studio
  - Integration
  - AI

---

I wrote "Fabric and Copilot Studio Integration: Building Data-Driven AI Assistants" to share practical, production-minded guidance on this topic.

## Integration Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                Fabric + Copilot Studio                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  User → Copilot Studio → Actions → Fabric APIs → Data       │
│              │                          │                    │
│              ↓                          ↓                    │
│       [Knowledge Base]          [Lakehouse/Warehouse]       │
│       [Conversation Flow]       [Semantic Model]            │
│       [Security]                [AI Skills]                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Setting Up the Integration

### Step 1: Create Fabric Connector

Create a custom connector using OpenAPI specification:

```yaml
# fabric-data-connector.swagger.yaml
swagger: "2.0"
info:
  title: "Fabric Data Connector"
  version: "1.0"
host: "api.fabric.microsoft.com"
basePath: "/v1"
schemes: ["https"]
securityDefinitions:
  oauth2:
    type: oauth2
    flow: accessCode
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/authorize"
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/token"
    scopes:
      https://api.fabric.microsoft.com/.default: "Access Fabric API"

paths:
  /workspaces/{workspaceId}/lakehouses/{lakehouseId}/queries:
    post:
      operationId: "ExecuteQuery"
      summary: "Execute SQL query against lakehouse"
      parameters:
        - name: workspaceId
          in: path
          required: true
          type: string
        - name: lakehouseId
          in: path
          required: true
          type: string
        - name: body
          in: body
          schema:
            type: object
            properties:
              query:
                type: string

# Register in Power Platform: Connectors > Custom connectors > Import OpenAPI
```

```python
# Alternative: Azure Function wrapper for Fabric queries
class FabricDataConnector:
    """Custom connector for Microsoft Fabric."""

    name = "Microsoft Fabric Data"
    description = "Query and analyze data in Microsoft Fabric"

    auth = ConnectorAuth(
        type="oauth2",
        provider="azure_ad",
        scopes=[
            "https://api.fabric.microsoft.com/.default"
        ]
    )

    base_url = "https://api.fabric.microsoft.com/v1"

    operations = [
        Operation(
            id="executeQuery",
            name="Execute SQL Query",
            description="Run a SQL query against a Fabric lakehouse or warehouse",
            method="POST",
            path="/workspaces/{workspaceId}/lakehouses/{lakehouseId}/queries",
            parameters={
                "workspaceId": {"type": "string", "required": True},
                "lakehouseId": {"type": "string", "required": True},
                "query": {"type": "string", "required": True}
            }
        ),
        Operation(
            id="getTableSchema",
            name="Get Table Schema",
            description="Get the schema of a table",
            method="GET",
            path="/workspaces/{workspaceId}/lakehouses/{lakehouseId}/tables/{tableName}/schema"
        ),
        Operation(
            id="listTables",
            name="List Tables",
            description="List all tables in a lakehouse",
            method="GET",
            path="/workspaces/{workspaceId}/lakehouses/{lakehouseId}/tables"
        )
    ]

# Register the connector
await copilot_studio.connectors.register(FabricDataConnector)
```

### Step 2: Create Actions

```yaml
# actions/query-fabric.yaml
action:
  name: QueryFabricData
  description: Execute natural language queries against Fabric data
  connector: FabricDataConnector

  inputs:
    - name: userQuestion
      type: string
      description: The user's question about the data

  steps:
    - name: generateSQL
      type: ai_generate
      config:
        model: gpt-4o
        system_prompt: |
          You are a SQL expert. Convert natural language to SQL.
          Available tables and schemas:
          ${fabricSchemaContext}

          Generate only SELECT queries. No modifications allowed.
        user_prompt: "${userQuestion}"
        output_format: sql

    - name: validateQuery
      type: function
      config:
        function: validateSQLSafety
        input: "${generateSQL.output}"

    - name: executeQuery
      type: connector
      config:
        operation: executeQuery
        parameters:
          workspaceId: "${env.FABRIC_WORKSPACE_ID}"
          lakehouseId: "${env.FABRIC_LAKEHOUSE_ID}"
          query: "${generateSQL.output}"

    - name: formatResponse
      type: ai_generate
      config:
        model: gpt-4o
        system_prompt: |
          Format the query results as a clear, concise response.
          Include relevant numbers and insights.
          If appropriate, suggest follow-up questions.
        user_prompt: |
          User asked: ${userQuestion}
          Query used: ${generateSQL.output}
          Results: ${executeQuery.output}

  outputs:
    - name: answer
      value: "${formatResponse.output}"
    - name: sqlUsed
      value: "${generateSQL.output}"
    - name: rawData
      value: "${executeQuery.output}"
```

### Step 3: Build the Copilot

```yaml
# copilot/data-assistant.yaml
copilot:
  name: FabricDataAssistant
  description: AI assistant for exploring and analyzing Fabric data

  instructions: |
    You are a data assistant that helps users explore and analyze data
    in Microsoft Fabric. You can:

    1. Answer questions about data using natural language
    2. Explain data schemas and relationships
    3. Create simple visualizations
    4. Suggest analyses and insights

    Guidelines:
    - Always explain what data you're using
    - Be transparent about query limitations
    - Suggest follow-up questions
    - Escalate complex requests to data team

  knowledge_sources:
    - type: sharepoint
      site: "DataPlatform"
      folders: ["Data Dictionary", "FAQs"]

    - type: fabric_metadata
      workspace: "${env.FABRIC_WORKSPACE_ID}"
      include: ["tables", "semantic_models"]

  actions:
    - QueryFabricData
    - GetTableSchema
    - CreateVisualization

  conversation_starters:
    - "What were our sales last month?"
    - "Show me the top customers by revenue"
    - "What data do we have about products?"
    - "Explain our data model"

  security:
    authentication: azure_ad
    row_level_security: enabled
    audit_logging: enabled
```

## Advanced Integration Patterns

### Pattern 1: Semantic Model Integration

```python
# Azure Function for semantic model queries via DAX
import azure.functions as func
import json
from azure.identity import DefaultAzureCredential
import sempy.fabric as fabric

def semantic_model_query(req: func.HttpRequest) -> func.HttpResponse:
    """Query Fabric Semantic Models with DAX - called from Copilot Studio."""

class SemanticModelQueryAction:
    """Query Fabric Semantic Models with DAX."""

    name = "QuerySemanticModel"
    description = "Run DAX queries against a Fabric semantic model"

    async def execute(self, question: str, model_name: str) -> dict:
        # Generate DAX from natural language
        dax_query = await self.generate_dax(question, model_name)

        # Execute DAX query
        result = await self.fabric_client.execute_dax(
            workspace_id=self.workspace_id,
            dataset_id=await self.get_dataset_id(model_name),
            query=dax_query
        )

        # Format response
        response = await self.format_response(question, dax_query, result)

        return {
            "answer": response,
            "dax_used": dax_query,
            "data": result.to_dict()
        }

    async def generate_dax(self, question: str, model_name: str) -> str:
        """Generate DAX from natural language."""

        # Get model metadata
        metadata = await self.fabric_client.get_semantic_model_metadata(model_name)

        prompt = f"""Convert this question to DAX for the semantic model.

Model: {model_name}
Tables: {metadata['tables']}
Measures: {metadata['measures']}
Relationships: {metadata['relationships']}

Question: {question}

Return only the DAX query."""

        response = await self.ai_client.chat.complete(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.choices[0].message.content
```

### Pattern 2: AI Skills Integration

```python
# Azure Function to call Fabric AI Skills from Copilot Studio
import azure.functions as func
from azure.identity import DefaultAzureCredential
import requests

def ai_skills_action(req: func.HttpRequest) -> func.HttpResponse:
    """Call Fabric AI Skills - invoked from Copilot Studio action."""

class AISkillsAction:
    """Leverage Fabric AI Skills from Copilot Studio."""

    name = "UseFabricAISkill"
    description = "Use a Fabric AI Skill to answer data questions"

    async def execute(self, question: str, skill_name: str) -> dict:
        client = AISkillsClient(workspace=self.workspace_id)

        # Use the AI Skill
        result = await client.ask(
            skill=skill_name,
            question=question
        )

        return {
            "answer": result.answer,
            "sql_used": result.sql_query,
            "confidence": result.confidence_score,
            "data": result.data
        }

# Register action
copilot.add_action(AISkillsAction(
    workspace_id=os.environ["FABRIC_WORKSPACE_ID"],
    default_skill="SalesAnalysis"
))
```

### Pattern 3: Multi-Source Data Assistant

```yaml
# Multi-source copilot configuration
copilot:
  name: EnterpriseDataAssistant

  actions:
    # Fabric Lakehouse queries
    - name: QueryLakehouse
      connector: FabricConnector
      operation: executeQuery

    # Semantic Model for BI
    - name: QuerySemanticModel
      type: custom
      implementation: SemanticModelQueryAction

    # Real-time data
    - name: QueryRealTimeData
      connector: FabricKQLConnector
      operation: executeKQL

    # External APIs
    - name: GetMarketData
      connector: ExternalMarketDataConnector

  routing:
    type: ai_router
    model: gpt-4o
    rules:
      - condition: "question contains 'real-time' or 'current'"
        action: QueryRealTimeData

      - condition: "question about 'reports' or 'dashboards'"
        action: QuerySemanticModel

      - condition: "question about 'market' or 'competitors'"
        action: GetMarketData

      - default: QueryLakehouse
```

## Security Configuration

```yaml
# Security settings
security:
  authentication:
    type: azure_ad
    required: true

  authorization:
    type: rbac
    role_mappings:
      - aad_group: "Data Viewers"
        permissions: [read]
        data_scope: "own_region"

      - aad_group: "Data Analysts"
        permissions: [read, export]
        data_scope: "all"

  data_loss_prevention:
    enabled: true
    block_pii: true
    max_export_rows: 1000

  audit:
    enabled: true
    log_questions: true
    log_queries: true
    log_results: false  # Don't log actual data
    destination: azure_monitor
```

## Deployment

Deployment is done through Copilot Studio portal:

```yaml
# Deployment configuration in Copilot Studio

# Teams Deployment:
# 1. Go to Copilot Studio > Your Copilot > Channels > Microsoft Teams
# 2. Configure:
teams_deployment:
  app_name: "Data Assistant"
  description: "Your AI assistant for data questions"
  icon: "Upload 192x192 PNG icon"
  accent_color: "#0078D4"

# 3. Click "Add to Teams" or "Submit for admin approval"

# Web Widget Deployment:
# 1. Go to Channels > Custom website
# 2. Copy the provided embed code

# Example embed code:
```

```html
<!-- Web widget embed code from Copilot Studio -->
<iframe
  src="https://copilotstudio.microsoft.com/environments/Default-xxx/bots/cr123_dataAssistant/webchat"
  style="width: 400px; height: 600px; border: none;">
</iframe>

<!-- For custom styling, use the Web Chat SDK -->
<script src="https://cdn.botframework.com/botframework-webchat/latest/webchat.js"></script>
<script>
  window.WebChat.renderWebChat({
    directLine: window.WebChat.createDirectLine({ token: 'YOUR_TOKEN' }),
    styleOptions: { accent: '#0078D4' }
  }, document.getElementById('webchat'));
</script>
```

The Fabric + Copilot Studio integration makes enterprise data conversationally accessible while maintaining security and governance.

## Resources

- [Copilot Studio + Fabric](https://learn.microsoft.com/en-us/microsoft-copilot-studio/fabric-integration)
- [Fabric AI Skills](https://learn.microsoft.com/en-us/fabric/ai-skills)
- [Custom Connectors](https://learn.microsoft.com/en-us/connectors/custom-connectors/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
