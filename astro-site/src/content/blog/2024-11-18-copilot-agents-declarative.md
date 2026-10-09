---
title: "Copilot Agents: Declarative and Custom Engine Approaches"
description: "Start with declarative agents for rapid prototyping and move to custom engines when you hit limitations."
author: Michael John Peña
draft: false
date: 2024-11-18
tags:
  - Azure
  - AI
  - Copilot
  - AI Agents
  - Microsoft 365
---

## Agent Architecture Comparison

```
┌─────────────────────────────────────────────────────────────┐
│                    Copilot Agents                            │
├────────────────────────┬────────────────────────────────────┤
│   Declarative Agents   │     Custom Engine Agents           │
├────────────────────────┼────────────────────────────────────┤
│ - YAML/JSON config     │ - Full code control               │
│ - Pre-built actions    │ - Custom AI models                │
│ - Microsoft hosting    │ - Self-hosted or Azure            │
│ - Quick deployment     │ - Complex logic                   │
│ - Limited customization│ - Maximum flexibility             │
└────────────────────────┴────────────────────────────────────┘
```

## Declarative Agents

Declarative agents are defined through configuration, without custom code:

### Agent Manifest

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/copilot/declarative-agent/v1.0/schema.json",
  "version": "v1.0",
  "name": "Data Platform Assistant",
  "description": "Helps users with data platform questions and tasks",
  "instructions": "You are a helpful assistant for our data platform. Help users find data, understand schemas, and answer questions about our analytics environment. Always be professional and accurate. If you don't know something, say so and suggest who to contact.",
  "conversation_starters": [
    {
      "text": "What datasets do we have for customer analytics?"
    },
    {
      "text": "How do I request access to the sales data?"
    },
    {
      "text": "What's the data freshness for the marketing lakehouse?"
    }
  ],
  "capabilities": [
    {
      "name": "WebSearch",
      "sites": [
        "https://learn.microsoft.com/fabric",
        "https://docs.contoso.com/data-platform"
      ]
    },
    {
      "name": "GraphConnectors",
      "connections": [
        "DataCatalogConnection",
        "TeamSitesConnection"
      ]
    },
    {
      "name": "OneDriveAndSharePoint",
      "include_files": [
        "/sites/DataPlatform/Documentation/*",
        "/sites/DataPlatform/Data Dictionary/*"
      ]
    }
  ],
  "actions": [
    {
      "id": "searchDataCatalog",
      "file": "actions/search-catalog.json"
    },
    {
      "id": "requestAccess",
      "file": "actions/request-access.json"
    }
  ]
}
```

### Declarative Action Definition

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/copilot/plugin/v2.1/schema.json",
  "schema_version": "v2.1",
  "name_for_human": "Data Catalog Search",
  "name_for_model": "searchDataCatalog",
  "description_for_human": "Search for datasets in our data catalog",
  "description_for_model": "Search the organization's data catalog to find datasets, tables, and data assets. Returns dataset names, descriptions, owners, and access information.",
  "api": {
    "type": "openapi",
    "url": "https://api.contoso.com/datacatalog/openapi.json"
  },
  "auth": {
    "type": "oauth2",
    "authorization_url": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    "token_url": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    "scopes": "api://data-catalog/.default"
  },
  "functions": [
    {
      "name": "searchDatasets",
      "description": "Search for datasets by name, description, or tags",
      "parameters": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "Search query"
          },
          "domain": {
            "type": "string",
            "enum": ["sales", "marketing", "finance", "operations"],
            "description": "Business domain to filter by"
          },
          "dataType": {
            "type": "string",
            "enum": ["table", "view", "file", "stream"],
            "description": "Type of data asset"
          }
        },
        "required": ["query"]
      }
    },
    {
      "name": "getDatasetDetails",
      "description": "Get detailed information about a specific dataset",
      "parameters": {
        "type": "object",
        "properties": {
          "datasetId": {
            "type": "string",
            "description": "The unique identifier of the dataset"
          }
        },
        "required": ["datasetId"]
      }
    }
  ]
}
```

### Deploying Declarative Agents

```bash
# Package the agent
npx @microsoft/teams-ai package --manifest agent-manifest.json --output dist/

# Deploy to Teams Admin Center
# Or use Teams Toolkit in VS Code

# Test locally
npx @microsoft/teams-ai dev --manifest agent-manifest.json
```

## Custom Engine Agents

For complex scenarios, custom engine agents provide full control:

### Custom Agent with Azure AI Foundry

```python
from teams.ai import Application, TurnState
from teams.ai.planners import ActionPlanner, AzureOpenAIPlanner
from azure.ai.foundry import AIFoundryClient

# Initialize AI Foundry client
ai_client = AIFoundryClient(...)

# Custom planner with domain logic
class DataPlatformPlanner(ActionPlanner):
    """Custom planner for data platform operations."""

    def __init__(self, ai_client: AIFoundryClient):
        self.ai_client = ai_client
        self.schema_cache = {}

    async def plan(self, context: TurnState) -> list:
        """Generate plan based on user request."""

        user_message = context.activity.text

        # Enrich context with schema information
        if self.needs_schema_context(user_message):
            schemas = await self.get_relevant_schemas(user_message)
            context.temp.schema_context = schemas

        # Use AI to generate plan
        plan = await self.ai_client.chat.complete(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": self.get_system_prompt(context)
                },
                {"role": "user", "content": user_message}
            ],
            functions=self.get_available_functions(),
            function_call="auto"
        )

        return self.parse_plan(plan)

    def get_system_prompt(self, context: TurnState) -> str:
        base_prompt = """You are a data platform assistant.
        Help users with data discovery, access, and analysis.

        Available functions:
        - search_catalog: Search for data assets
        - get_schema: Get table schema
        - run_query: Execute approved queries
        - request_access: Request data access
        """

        if context.temp.schema_context:
            base_prompt += f"\n\nRelevant schemas:\n{context.temp.schema_context}"

        return base_prompt

# Create Teams application
app = Application[TurnState](
    bot_id=os.environ["BOT_ID"],
    planner=DataPlatformPlanner(ai_client)
)

# Define actions
@app.action("search_catalog")
async def search_catalog(context: TurnState, parameters: dict):
    """Search the data catalog."""

    results = await catalog_client.search(
        query=parameters.get("query"),
        filters=parameters.get("filters", {})
    )

    # Format for user
    if not results:
        return "No datasets found matching your criteria."

    response = "Found these datasets:\n\n"
    for dataset in results[:5]:
        response += f"**{dataset.name}**\n"
        response += f"- Description: {dataset.description}\n"
        response += f"- Owner: {dataset.owner}\n"
        response += f"- Domain: {dataset.domain}\n\n"

    return response

@app.action("run_query")
async def run_query(context: TurnState, parameters: dict):
    """Execute an approved query."""

    query_name = parameters.get("query_name")
    query_params = parameters.get("parameters", {})

    # Verify query is approved
    if query_name not in APPROVED_QUERIES:
        return "This query is not in the approved list. Please contact the data team."

    # Execute query
    result = await fabric_client.execute_query(
        APPROVED_QUERIES[query_name].format(**query_params)
    )

    # Format response
    return format_query_results(result)

@app.action("request_access")
async def request_access(context: TurnState, parameters: dict):
    """Submit a data access request."""

    dataset_id = parameters.get("dataset_id")
    justification = parameters.get("justification")
    user = context.activity.from_property

    # Create access request
    request = await access_manager.create_request(
        user_id=user.id,
        user_email=user.email,
        dataset_id=dataset_id,
        justification=justification
    )

    # Notify approvers
    await notify_approvers(request)

    return f"Access request #{request.id} submitted. The data owner will review your request."

# Error handling
@app.error
async def on_error(context: TurnState, error: Exception):
    """Handle errors gracefully."""

    logger.error(f"Error in agent: {error}", exc_info=True)

    return "I encountered an error processing your request. Please try again or contact support."
```

### Multi-Modal Custom Agent

```python
from teams.ai import Application
from azure.ai.vision import ImageAnalysisClient

class MultiModalAgent:
    """Agent that handles text, images, and files."""

    def __init__(self):
        self.vision_client = ImageAnalysisClient(...)
        self.ai_client = AIFoundryClient(...)

    async def process_message(self, context: TurnState):
        """Process any type of message."""

        attachments = context.activity.attachments or []

        # Check for images
        images = [a for a in attachments if a.content_type.startswith("image/")]
        if images:
            return await self.process_image(context, images[0])

        # Check for files
        files = [a for a in attachments if a.content_type in SUPPORTED_FILE_TYPES]
        if files:
            return await self.process_file(context, files[0])

        # Text message
        return await self.process_text(context)

    async def process_image(self, context: TurnState, image):
        """Process image with vision capabilities."""

        # Download image
        image_data = await self.download_attachment(image)

        # Analyze with Azure AI Vision
        analysis = await self.vision_client.analyze(
            image_data=image_data,
            visual_features=["caption", "objects", "text"]
        )

        # Combine with user's question
        user_question = context.activity.text or "What's in this image?"

        response = await self.ai_client.chat.complete(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_question},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{image_data}"}
                        }
                    ]
                }
            ]
        )

        return response.choices[0].message.content

    async def process_file(self, context: TurnState, file):
        """Process uploaded files."""

        file_data = await self.download_attachment(file)

        if file.content_type == "application/vnd.ms-excel":
            return await self.analyze_excel(file_data, context.activity.text)

        elif file.content_type == "application/pdf":
            return await self.analyze_pdf(file_data, context.activity.text)

        return "I can analyze Excel files and PDFs. Please upload one of those."
```

## Choosing the Right Approach

| Criteria | Declarative | Custom Engine |
|----------|-------------|---------------|
| Development time | Hours | Days to weeks |
| Maintenance | Low | Medium to high |
| Customization | Limited | Unlimited |
| Hosting | Microsoft | Self or Azure |
| Cost | Per-message | Infrastructure + usage |
| Best for | Standard use cases | Complex requirements |

Start with declarative agents for rapid prototyping and move to custom engines when you hit limitations.

## Resources

- [Declarative Agents Guide](https://learn.microsoft.com/en-us/copilot/extensibility/declarative-agents)
- [Teams AI Library](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/teams-ai-library)
- [Custom Engine Samples](https://github.com/microsoft/teams-ai)
