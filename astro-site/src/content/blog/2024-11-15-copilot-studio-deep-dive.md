---
title: "Copilot Studio Deep Dive: Building Custom AI Assistants"
description: "Copilot Studio bridges the gap between low-code simplicity and enterprise requirements. Start with templates and progressively add custom actions as needs…"
author: Michael John Peña
draft: false
date: 2024-11-15
tags:
  - Azure
  - AI
  - Copilot Studio
  - Low-Code
  - Enterprise AI
---

## Copilot Studio Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Copilot Studio                            │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Topics     │  │   Actions    │  │  Knowledge   │      │
│  │  (Dialogs)   │  │ (Connectors) │  │   Sources    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────┐      │
│  │           Generative AI Orchestration             │      │
│  │  (GPT-4o + Custom Instructions + RAG)            │      │
│  └──────────────────────────────────────────────────┘      │
├─────────────────────────────────────────────────────────────┤
│  Channels: Teams | Web | Slack | Custom                     │
└─────────────────────────────────────────────────────────────┘
```

## Creating a Data Platform Copilot

### Step 1: Define the Copilot

```yaml
# copilot-definition.yaml
copilot:
  name: DataPlatformAssistant
  description: |
    An AI assistant that helps users interact with our data platform.
    Capabilities include:
    - Answering questions about data assets
    - Executing approved queries
    - Creating reports and dashboards
    - Explaining data lineage

  personality:
    tone: professional
    verbosity: balanced
    expertise_level: adaptive  # Adjusts to user

  instructions: |
    You are the Data Platform Assistant for Contoso.

    Your primary responsibilities:
    1. Help users find and understand data assets
    2. Answer questions about data quality and lineage
    3. Execute pre-approved queries on behalf of users
    4. Guide users through self-service analytics

    Important guidelines:
    - Always verify user permissions before data access
    - Explain technical concepts in business terms
    - Suggest relevant documentation when appropriate
    - Escalate to data team for complex requests

  fallback_behavior:
    unknown_intent: search_knowledge_base
    no_results: offer_escalation
    error: apologize_and_retry
```

### Step 2: Configure Knowledge Sources

```yaml
# Knowledge sources are configured in Copilot Studio portal
# Example configuration for different source types:

# copilot-knowledge-config.yaml
knowledge_sources:

  # SharePoint documentation - configured via portal
  - name: "SharePoint Docs"
    type: sharepoint
    configuration:
      site_url: "https://contoso.sharepoint.com/sites/DataPlatform"
      include_folders:
        - "Documentation"
        - "Data Dictionary"
        - "Best Practices"
        - "FAQs"
      # Sync settings configured in portal

  # Website/Public documentation
  - name: "Microsoft Learn"
    type: public_website
    configuration:
      urls:
        - "https://learn.microsoft.com/fabric/"
      crawl_depth: 2

  # Custom API data via Power Automate flow
  - name: "Data Catalog"
    type: power_automate_flow
    configuration:
      flow_name: "Get Data Catalog"
      # Flow connects to Fabric REST API

# In Copilot Studio:
# 1. Go to your copilot > Knowledge
# 2. Click "Add knowledge"
# 3. Select source type (SharePoint, Website, Files, Dataverse)
# 4. Configure connection and authentication
# 5. Set sync schedule

# For custom data sources, create a Power Automate flow:
# - Trigger: When called from Copilot Studio
# - Action: HTTP request to Fabric API
# - Return: Formatted response for copilot consumption
```

### Step 3: Build Topics (Conversation Flows)

```yaml
# topics/data-discovery.yaml
topic:
  name: DataDiscovery
  trigger_phrases:
    - "find data about"
    - "where can I find"
    - "what data do we have for"
    - "search for dataset"

  conversation:
    - type: question
      id: get_domain
      prompt: "What business domain are you looking for data in?"
      options:
        - Sales
        - Marketing
        - Finance
        - Operations
        - Customer

    - type: action
      id: search_catalog
      action: SearchDataCatalog
      parameters:
        domain: "${get_domain.value}"
        query: "${trigger.entity.search_term}"

    - type: condition
      id: check_results
      condition: "${search_catalog.result_count} > 0"
      true_branch:
        - type: message
          content: |
            I found ${search_catalog.result_count} datasets in ${get_domain.value}:

            ${foreach search_catalog.results as dataset}
            **${dataset.name}**
            - Description: ${dataset.description}
            - Owner: ${dataset.owner}
            - Quality Score: ${dataset.quality_score}%
            ${endforeach}

            Would you like more details on any of these?

      false_branch:
        - type: message
          content: "I couldn't find datasets matching your criteria. Let me search our documentation instead."
        - type: action
          action: SearchKnowledgeBase
          parameters:
            query: "${trigger.original_text}"
```

### Step 4: Create Custom Actions

```yaml
# Custom actions in Copilot Studio are created using Power Automate flows
# or custom connectors. Here's how to create a Fabric query action:

# Step 1: Create a Power Automate flow for the action
# Flow name: "Execute Approved Query"

# Power Automate Flow Definition:
# Trigger: "When Power Virtual Agents calls a flow"
# Inputs:
#   - query_name (Text)
#   - days_back (Number)
#   - limit (Number)

# Actions:
# 1. Initialize variable: APPROVED_QUERIES (Object)
# 2. Condition: Check if query_name exists in approved list
# 3. HTTP Action: Call Fabric SQL endpoint
# 4. Parse JSON: Format response
# 5. Return to PVA: Send response back

# Step 2: Azure Function alternative for complex logic
```

```python
# Azure Function to execute approved queries
import azure.functions as func
from azure.identity import DefaultAzureCredential
import pyodbc
import json

APPROVED_QUERIES = {
    "daily_sales_summary": """
        SELECT TOP 100
            date, region,
            SUM(revenue) as total_revenue,
            COUNT(DISTINCT customer_id) as unique_customers
        FROM gold.sales_fact
        WHERE date >= DATEADD(day, -{days_back}, GETDATE())
        GROUP BY date, region
        ORDER BY total_revenue DESC
    """,
    "product_performance": """
        SELECT TOP {limit}
            p.product_name, p.category,
            SUM(s.quantity) as units_sold,
            SUM(s.revenue) as revenue
        FROM gold.sales_fact s
        JOIN dim.products p ON s.product_id = p.product_id
        WHERE s.date >= DATEADD(day, -{days_back}, GETDATE())
        GROUP BY p.product_name, p.category
        ORDER BY revenue DESC
    """
}

def main(req: func.HttpRequest) -> func.HttpResponse:
    query_name = req.params.get('query_name')
    days_back = req.params.get('days_back', '7')
    limit = req.params.get('limit', '10')

    if query_name not in APPROVED_QUERIES:
        return func.HttpResponse(json.dumps({"error": "Query not approved"}), status_code=400)

    query = APPROVED_QUERIES[query_name].format(days_back=days_back, limit=limit)

    # Connect to Fabric SQL endpoint
    conn_str = "Driver={ODBC Driver 18 for SQL Server};Server=<workspace>.datawarehouse.fabric.microsoft.com;Database=<warehouse>;Authentication=ActiveDirectoryDefault"
    with pyodbc.connect(conn_str) as conn:
        cursor = conn.cursor()
        cursor.execute(query)
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()

    return func.HttpResponse(json.dumps({"columns": columns, "data": [list(row) for row in rows]}))
```

### Step 5: Configure Authentication and Security

```yaml
# security-config.yaml
security:
  authentication:
    provider: azure_ad
    required: true
    allowed_tenants:
      - contoso.com

  authorization:
    model: rbac
    roles:
      - name: DataViewer
        permissions:
          - read_catalog
          - search_knowledge
          - execute_approved_queries

      - name: DataAnalyst
        permissions:
          - read_catalog
          - search_knowledge
          - execute_approved_queries
          - create_reports
          - access_raw_data

      - name: DataAdmin
        permissions:
          - all

    role_mappings:
      - aad_group: "Data Viewers"
        role: DataViewer
      - aad_group: "Data Analysts"
        role: DataAnalyst
      - aad_group: "Data Platform Team"
        role: DataAdmin

  data_loss_prevention:
    enabled: true
    rules:
      - name: block_pii
        pattern: '\b\d{3}-\d{2}-\d{4}\b'  # SSN
        action: redact

      - name: block_credit_cards
        pattern: '\b\d{16}\b'
        action: redact

  audit:
    enabled: true
    log_destination: azure_monitor
    retention_days: 90
```

### Step 6: Deploy to Channels

```yaml
# Deployment is configured in Copilot Studio portal
# Go to your copilot > Channels

# Teams Deployment:
# 1. Click "Microsoft Teams" in channels
# 2. Configure:
teams_config:
  app_name: "Data Platform Assistant"
  short_description: "AI assistant for data platform"
  long_description: "Your AI assistant for data platform questions"
  icon: "Upload 192x192 PNG"
  accent_color: "#0078D4"
  welcome_message: "Hi! I'm your Data Platform Assistant. How can I help you today?"
  suggested_actions:
    - "Find sales data"
    - "Check data quality"
    - "Create a report"

# 3. Click "Add to Teams" to publish

# Web Widget Deployment:
# 1. Click "Custom website" in channels
# 2. Copy the embed code provided
# 3. Add to your website

# Example embed code (generated by Copilot Studio):
```

```html
<!-- Web widget embed code -->
<iframe
  src="https://copilotstudio.microsoft.com/environments/Default/bots/cr123_dataAssistant/webchat?__version__=2"
  frameborder="0"
  style="width: 100%; height: 600px;">
</iframe>

<!-- Or use the Web Chat SDK for more customization -->
<script src="https://cdn.botframework.com/botframework-webchat/latest/webchat.js"></script>
<script>
  window.WebChat.renderWebChat({
    directLine: window.WebChat.createDirectLine({
      token: 'YOUR_DIRECT_LINE_TOKEN'
    }),
    styleOptions: {
      accent: '#0078D4',
      botAvatarInitials: 'DP',
      userAvatarInitials: 'U'
    }
  }, document.getElementById('webchat'));
</script>
<div id="webchat" style="height: 600px; width: 400px;"></div>
```

## Monitoring and Analytics

```yaml
# Analytics are available in Copilot Studio portal
# Go to your copilot > Analytics

# Available metrics in the portal:
analytics_dashboard:
  overview:
    - total_conversations
    - unique_users
    - resolution_rate
    - average_satisfaction

  conversation_metrics:
    - sessions_over_time
    - engagement_rate
    - escalation_rate
    - average_session_duration

  topic_performance:
    - top_triggered_topics
    - topic_completion_rate
    - topic_escalation_rate

  user_satisfaction:
    - csat_scores
    - feedback_trends

# Export analytics data via Power BI:
# 1. Go to Analytics > Power BI
# 2. Connect your Power BI workspace
# 3. Create custom dashboards

# Programmatic access via Dataverse:
# Analytics data is stored in Dataverse tables
```

```python
# Query analytics from Dataverse using Power Platform SDK
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://your-org.crm.dynamics.com/.default").token

headers = {"Authorization": f"Bearer {token}"}
dataverse_url = "https://your-org.crm.dynamics.com/api/data/v9.2"

# Query conversation sessions
sessions_response = requests.get(
    f"{dataverse_url}/conversationtranscripts",
    headers=headers,
    params={"$top": 100, "$orderby": "createdon desc"}
)

sessions = sessions_response.json().get("value", [])
print(f"Recent conversations: {len(sessions)}")

# For detailed analytics, use the Copilot Studio Analytics Power BI template
```

Copilot Studio bridges the gap between low-code simplicity and enterprise requirements. Start with templates and progressively add custom actions as needs evolve.

## Resources

- [Copilot Studio Documentation](https://learn.microsoft.com/en-us/microsoft-copilot-studio/)
- [Building Custom Topics](https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-create-topics)
- [Actions and Connectors](https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-actions)
