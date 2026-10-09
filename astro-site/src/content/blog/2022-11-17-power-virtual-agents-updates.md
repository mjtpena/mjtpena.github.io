---
title: "Power Virtual Agents Updates: Low-Code Conversational AI"
author: Michael John Peña
draft: false
date: 2022-11-17
tags:
  - Power Platform
  - Power Virtual Agents
  - Conversational AI
  - Low-Code
  - Microsoft
---

## What's New in Power Virtual Agents

### GPT-Powered Responses

Power Virtual Agents now can generate responses using GPT models:

```yaml
# Topic: General Knowledge Query
trigger_phrases:
  - "Tell me about"
  - "What is"
  - "Explain"

nodes:
  - type: Question
    variable: topic
    prompt: "What would you like to know about?"

  - type: Action
    connection: Azure OpenAI
    inputs:
      prompt: "Explain {topic} in simple terms for a business user."
      max_tokens: 200
    output_variable: gpt_response

  - type: Message
    text: "{gpt_response}"
```

### Enhanced Topic Design

Topics now support more complex logic:

```yaml
# Topic: Order Management
trigger_phrases:
  - "Check my order"
  - "Order status"
  - "Where is my package"

nodes:
  - type: Question
    variable: order_number
    prompt: "What's your order number?"
    validation:
      type: regex
      pattern: "^[A-Z]{2}[0-9]{6}$"
      error_message: "Please enter a valid order number (e.g., AB123456)"

  - type: Action
    connection: Dataverse
    operation: GetOrder
    inputs:
      order_id: "{order_number}"
    output_variable: order_data

  - type: Condition
    conditions:
      - expression: "{order_data.status} == 'shipped'"
        nodes:
          - type: Message
            text: "Your order {order_number} has shipped! Tracking: {order_data.tracking_number}"
          - type: AdaptiveCard
            template: order_tracking_card
            data: order_data

      - expression: "{order_data.status} == 'processing'"
        nodes:
          - type: Message
            text: "Your order is being processed. Expected ship date: {order_data.estimated_ship_date}"

      - expression: "default"
        nodes:
          - type: Message
            text: "I couldn't find order {order_number}. Would you like to speak with an agent?"
          - type: TransferToAgent
            skill_name: "Order Support"
```

## Integration with Power Automate

Create complex workflows triggered by chatbot interactions:

```json
{
  "definition": {
    "triggers": {
      "When_PVA_calls_flow": {
        "type": "Request",
        "kind": "PowerVirtualAgents"
      }
    },
    "actions": {
      "Get_Customer_Data": {
        "type": "OpenApiConnection",
        "inputs": {
          "host": {
            "connectionName": "shared_commondataservice"
          },
          "method": "get",
          "path": "/v2/datasets/@{encodeURIComponent('org')}/tables/@{encodeURIComponent('contacts')}/items",
          "queries": {
            "$filter": "emailaddress1 eq '@{triggerBody()?['email']}'"
          }
        }
      },
      "Check_Loyalty_Status": {
        "type": "OpenApiConnection",
        "inputs": {
          "host": {
            "connectionName": "shared_sql"
          },
          "method": "get",
          "path": "/datasets/@{encodeURIComponent('server.database.windows.net')}/tables/@{encodeURIComponent('LoyaltyMembers')}/items",
          "queries": {
            "$filter": "CustomerId eq '@{body('Get_Customer_Data')?['value'][0]['contactid']}'"
          }
        }
      },
      "Return_to_PVA": {
        "type": "Response",
        "kind": "PowerVirtualAgents",
        "inputs": {
          "statusCode": 200,
          "body": {
            "customer_name": "@{body('Get_Customer_Data')?['value'][0]['fullname']}",
            "loyalty_tier": "@{body('Check_Loyalty_Status')?['value'][0]['Tier']}",
            "points_balance": "@{body('Check_Loyalty_Status')?['value'][0]['Points']}"
          }
        }
      }
    }
  }
}
```

## Adaptive Cards in PVA

Create rich interactive experiences:

```json
{
  "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
  "type": "AdaptiveCard",
  "version": "1.4",
  "body": [
    {
      "type": "Container",
      "items": [
        {
          "type": "TextBlock",
          "text": "Order Status: ${order_number}",
          "weight": "Bolder",
          "size": "Large"
        },
        {
          "type": "FactSet",
          "facts": [
            {
              "title": "Status",
              "value": "${status}"
            },
            {
              "title": "Shipping",
              "value": "${shipping_method}"
            },
            {
              "title": "Estimated Delivery",
              "value": "${estimated_delivery}"
            }
          ]
        },
        {
          "type": "ColumnSet",
          "columns": [
            {
              "type": "Column",
              "width": "stretch",
              "items": [
                {
                  "type": "Image",
                  "url": "${tracking_map_url}",
                  "altText": "Package location map"
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "actions": [
    {
      "type": "Action.Submit",
      "title": "Track Package",
      "data": {
        "action": "track",
        "tracking_number": "${tracking_number}"
      }
    },
    {
      "type": "Action.OpenUrl",
      "title": "View Order Details",
      "url": "${order_details_url}"
    }
  ]
}
```

## Multi-language Support

Configure bot for multiple languages:

```yaml
# Settings
languages:
  primary: en-us
  secondary:
    - es-mx
    - fr-ca
    - de-de

localization:
  greeting:
    en-us: "Hello! How can I help you today?"
    es-mx: "¡Hola! ¿Cómo puedo ayudarte hoy?"
    fr-ca: "Bonjour! Comment puis-je vous aider aujourd'hui?"
    de-de: "Hallo! Wie kann ich Ihnen heute helfen?"

  order_prompt:
    en-us: "Please enter your order number"
    es-mx: "Por favor ingrese su número de pedido"
    fr-ca: "Veuillez entrer votre numéro de commande"
    de-de: "Bitte geben Sie Ihre Bestellnummer ein"
```

## Analytics and Insights

Track bot performance with built-in analytics:

```yaml
# Analytics Configuration
analytics:
  track_topics: true
  track_sessions: true
  custom_events:
    - name: order_lookup
      properties:
        - order_found
        - order_status
    - name: agent_transfer
      properties:
        - reason
        - wait_time

  kpis:
    - resolution_rate
    - avg_session_length
    - user_satisfaction
    - escalation_rate
```

## Security and Governance

```yaml
# Governance Settings
security:
  authentication:
    required: true
    providers:
      - azure_ad
    scopes:
      - User.Read
      - profile

  data_handling:
    pii_detection: true
    log_retention_days: 30
    mask_sensitive_data: true

  dlp_policies:
    - name: "Block External Sharing"
      connectors:
        blocked:
          - Twitter
          - Facebook
        allowed:
          - SharePoint
          - Dataverse
          - Azure OpenAI
```

## Custom Entities

Define domain-specific entities:

```yaml
entities:
  product_category:
    type: closed_list
    values:
      - name: electronics
        synonyms: ["tech", "gadgets", "devices"]
      - name: clothing
        synonyms: ["apparel", "fashion", "wear"]
      - name: home
        synonyms: ["furniture", "decor", "household"]

  order_status:
    type: closed_list
    values:
      - processing
      - shipped
      - delivered
      - cancelled
      - returned

  date_reference:
    type: prebuilt
    prebuilt_type: datetimeV2
```

## Integration with Teams

Deploy bot to Microsoft Teams:

```yaml
# Teams Configuration
teams_settings:
  app_name: "Contoso Support Bot"
  description: "Get help with orders, returns, and general questions"

  scopes:
    - personal
    - team
    - groupchat

  commands:
    - command: "order"
      description: "Check order status"
    - command: "return"
      description: "Start a return"
    - command: "help"
      description: "Get help"

  message_extension:
    enabled: true
    type: search
    search_commands:
      - id: "productSearch"
        title: "Search Products"
        description: "Search our product catalog"
```

## Best Practices

1. **Start with common scenarios**: Build topics for the most frequent questions first
2. **Use fallback topics**: Always have a graceful fallback when the bot doesn't understand
3. **Test with real users**: Get feedback from actual users early
4. **Monitor and improve**: Use analytics to identify gaps and improve topics
5. **Integrate thoughtfully**: Only add integrations that provide real value

## Publishing and Deployment

```yaml
# Deployment Configuration
deployment:
  environments:
    - name: development
      url: "https://dev-bot.contoso.com"
      auto_deploy: true

    - name: staging
      url: "https://staging-bot.contoso.com"
      approval_required: true
      approvers:
        - bot-admins@contoso.com

    - name: production
      url: "https://bot.contoso.com"
      approval_required: true
      approvers:
        - it-leadership@contoso.com

  channels:
    - teams
    - web
    - facebook_messenger

  versioning:
    strategy: semantic
    current: "2.1.0"
```

## Conclusion

Power Virtual Agents makes conversational AI accessible to citizen developers while providing the depth needed for enterprise scenarios. The combination of low-code design, powerful integrations, and AI capabilities enables organizations to quickly deploy intelligent chatbots that improve customer and employee experiences.

## Resources

- [Power Virtual Agents Documentation](https://docs.microsoft.com/en-us/power-virtual-agents/)
- [PVA + Power Automate](https://docs.microsoft.com/en-us/power-virtual-agents/advanced-flow)
- [Teams Integration](https://docs.microsoft.com/en-us/power-virtual-agents/publication-add-bot-to-microsoft-teams)
- [Analytics](https://docs.microsoft.com/en-us/power-virtual-agents/analytics-overview)
