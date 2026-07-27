---
title: Power Virtual Agents - Building Conversational AI Without Code
author: Michael John Peña
draft: false
date: 2021-04-08
url: /blog/power-virtual-agents-conversational-ai/
tags:
  - Power Platform
  - Power Virtual Agents
  - Chatbots
  - Conversational AI
  - Microsoft 365

---

I wrote "2021-04-08-power-virtual-agents-conversational-ai" to share practical, production-minded guidance on this topic.

## Understanding Power Virtual Agents

PVA provides:
- **No-code bot building** - Visual authoring canvas
- **Natural language understanding** - Built-in AI
- **Multi-channel deployment** - Teams, websites, Facebook
- **Power Platform integration** - Flows, Dataverse, connectors
- **Analytics** - Conversation insights and performance metrics

## Creating Your First Bot

### Step 1: Design Topics

Topics are the building blocks of your bot. Each topic handles a specific intent.

```yaml
Topic: Order Status
Trigger Phrases:
  - "Where is my order"
  - "Check order status"
  - "Track my order"
  - "Order tracking"
  - "When will my order arrive"
  - "Is my order shipped"

Conversation Flow:
  1. Ask for order number
  2. Validate format
  3. Look up order
  4. Display status
  5. Offer additional help
```

### Step 2: Build the Conversation

```yaml
Node 1 - Message:
  Text: "I can help you track your order! Could you please provide your order number?"

Node 2 - Question:
  Identify: "Order Number"
  Entity: Custom regex pattern "ORD-[0-9]{6}"
  Variable: varOrderNumber

  Reprompt:
    Max attempts: 2
    Message: "Please enter a valid order number in the format ORD-XXXXXX"

  No match:
    Message: "I couldn't recognize that order number. Let me transfer you to an agent."
    Action: Escalate

Node 3 - Action:
  Call Flow: "Get Order Status"
  Input: varOrderNumber
  Output: varOrderDetails

Node 4 - Condition:
  If: varOrderDetails.Found = true
    Node 5 - Message:
      Text: |
        Here's the status of your order {varOrderNumber}:

        **Status:** {varOrderDetails.Status}
        **Shipped Date:** {varOrderDetails.ShippedDate}
        **Estimated Delivery:** {varOrderDetails.EstimatedDelivery}
        **Carrier:** {varOrderDetails.Carrier}
        **Tracking Number:** {varOrderDetails.TrackingNumber}
  Else:
    Node 6 - Message:
      Text: "I couldn't find an order with that number. Please verify the order number or contact support."
```

## Building Custom Entities

Create entities to recognize specific information:

```yaml
Entity: Product Category
Type: Closed List
Items:
  - Electronics:
      Synonyms: [electronics, tech, gadgets, devices]
  - Clothing:
      Synonyms: [clothes, apparel, fashion, wear]
  - Home & Garden:
      Synonyms: [home, garden, furniture, decor]
  - Sports:
      Synonyms: [sports, fitness, outdoor, athletic]

Entity: Order Number
Type: Regex
Pattern: "ORD-[0-9]{6}"

Entity: Date Range
Type: Prebuilt
Subtype: datetimeV2
```

## Power Automate Integration

Connect your bot to business systems:

### Flow: Get Order Status

```yaml
Trigger: Power Virtual Agents
Input:
  - OrderNumber (Text)

Actions:
  - Get Order from Dataverse:
      Filter: cr_ordernumber eq '@{triggerBody()['text']}'

  - Condition: Order Found
      Yes:
        - Get Shipment Details:
            Filter: _cr_orderid_value eq '@{outputs('Get_Order')?['body/cr_orderid']}'

        - Compose Response:
            Found: true
            Status: '@{outputs('Get_Order')?['body/cr_status']}'
            ShippedDate: '@{outputs('Get_Shipment')?['body/cr_shippeddate']}'
            EstimatedDelivery: '@{outputs('Get_Shipment')?['body/cr_estimateddelivery']}'
            Carrier: '@{outputs('Get_Shipment')?['body/cr_carrier']}'
            TrackingNumber: '@{outputs('Get_Shipment')?['body/cr_trackingnumber']}'

      No:
        - Compose Response:
            Found: false

Output:
  - Return value to PVA: '@{outputs('Compose_Response')}'
```

### Flow: Create Support Ticket

```yaml
Trigger: Power Virtual Agents
Inputs:
  - CustomerEmail (Text)
  - IssueCategory (Text)
  - IssueDescription (Text)
  - Priority (Text)

Actions:
  - Get Customer:
      Filter: emailaddress1 eq '@{triggerBody()['CustomerEmail']}'

  - Create Case:
      Title: '@{triggerBody()['IssueCategory']} - @{utcNow()}'
      Customer: '@{outputs('Get_Customer')?['body/contactid']}'
      Description: '@{triggerBody()['IssueDescription']}'
      Priority: '@{triggerBody()['Priority']}'
      Origin: 'Chatbot'

  - Send Confirmation Email:
      To: '@{triggerBody()['CustomerEmail']}'
      Subject: 'Support Ticket Created - @{outputs('Create_Case')?['body/ticketnumber']}'
      Body: |
        Your support ticket has been created.
        Ticket Number: @{outputs('Create_Case')?['body/ticketnumber']}
        We'll respond within 24 hours.

Output:
  - TicketNumber: '@{outputs('Create_Case')?['body/ticketnumber']}'
```

## Advanced Conversation Design

### Multi-Turn Dialogs

```yaml
Topic: Book Appointment
Nodes:
  1. Message: "I'll help you schedule an appointment. Let me gather some information."

  2. Question - Service Type:
      Ask: "What type of service do you need?"
      Options:
        - Consultation
        - Follow-up
        - New Patient
      Save to: varServiceType

  3. Question - Preferred Date:
      Ask: "What date works best for you?"
      Entity: datetimeV2
      Save to: varPreferredDate

      Condition - Weekend:
        If: dayOfWeek(varPreferredDate) in [0, 6]
        Message: "We're not open on weekends. Please choose a weekday."
        Redirect to: Node 3

  4. Action - Get Available Slots:
      Flow: "Get Available Appointments"
      Inputs: varServiceType, varPreferredDate
      Output: varAvailableSlots

  5. Condition - Slots Available:
      If: length(varAvailableSlots) > 0
        6. Question - Select Slot:
            Ask: "Here are the available times. Please select one:"
            Options: varAvailableSlots
            Save to: varSelectedSlot

        7. Action - Book Appointment:
            Flow: "Create Appointment"
            Inputs: varServiceType, varSelectedSlot
            Output: varConfirmation

        8. Message:
            Text: |
              Your appointment is confirmed!
              **Date:** {varSelectedSlot.Date}
              **Time:** {varSelectedSlot.Time}
              **Service:** {varServiceType}
              **Confirmation:** {varConfirmation.Number}

      Else:
        9. Message: "No appointments available on that date. Would you like to try another date?"
        10. Redirect to: Node 3
```

### Handling Interruptions

```yaml
System Topic: Interrupt
Trigger: User changes subject mid-conversation

Response:
  Message: "It looks like you'd like to discuss something else. Would you like to:"
  Options:
    - "Continue where we left off"
    - "Start fresh with the new topic"

  If: "Continue"
    Return to previous topic
  Else:
    Clear conversation state
    Route to new topic
```

### Fallback and Escalation

```yaml
System Topic: Fallback
Trigger: Unrecognized input after 2 attempts

Actions:
  1. Message: "I'm having trouble understanding. Let me try to help differently."

  2. Adaptive Card:
      Type: "ActionSet"
      Actions:
        - "Browse FAQ"
        - "Search Knowledge Base"
        - "Talk to a Person"

  3. If: "Talk to a Person"
      Message: "I'll connect you with a support agent. Please hold..."
      Action: Transfer to Live Agent

      Live Agent Handoff:
        Context:
          - Conversation transcript
          - Customer info
          - Failed intents
```

## Adaptive Cards

Create rich interactive responses:

```json
{
  "type": "AdaptiveCard",
  "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
  "version": "1.3",
  "body": [
    {
      "type": "TextBlock",
      "text": "Order Status",
      "weight": "Bolder",
      "size": "Medium"
    },
    {
      "type": "FactSet",
      "facts": [
        {
          "title": "Order #:",
          "value": "${OrderNumber}"
        },
        {
          "title": "Status:",
          "value": "${Status}"
        },
        {
          "title": "Est. Delivery:",
          "value": "${EstimatedDelivery}"
        }
      ]
    },
    {
      "type": "ActionSet",
      "actions": [
        {
          "type": "Action.OpenUrl",
          "title": "Track Package",
          "url": "${TrackingUrl}"
        },
        {
          "type": "Action.Submit",
          "title": "Report Issue",
          "data": {
            "action": "reportIssue",
            "orderId": "${OrderId}"
          }
        }
      ]
    }
  ]
}
```

## Analytics and Improvement

### Key Metrics to Monitor

```yaml
Analytics Dashboard:
  Engagement:
    - Total sessions
    - Unique users
    - Messages per session
    - Session duration

  Resolution:
    - Resolution rate
    - Escalation rate
    - Abandonment rate

  Topics:
    - Topic frequency
    - Topic completion rate
    - Topic escalation rate

  Customer Satisfaction:
    - CSAT scores
    - Feedback sentiment
```

### Continuous Improvement

```yaml
Review Process:
  Weekly:
    - Review unrecognized utterances
    - Add new trigger phrases
    - Update entity synonyms

  Monthly:
    - Analyze escalation patterns
    - Identify new topic opportunities
    - Review customer feedback

  Quarterly:
    - Conversation flow optimization
    - Integration improvements
    - New feature rollout
```

## Best Practices

1. **Start simple** - Launch with core topics, expand iteratively
2. **Use clear language** - Avoid jargon in bot responses
3. **Provide options** - Guide users with suggested actions
4. **Handle errors gracefully** - Always have a fallback path
5. **Test extensively** - Use the test bot before publishing
6. **Monitor analytics** - Continuously improve based on data
7. **Enable feedback** - Let users rate their experience

## Conclusion

Power Virtual Agents makes conversational AI accessible to everyone. By combining intuitive topic design with Power Automate integration, you can create sophisticated chatbots that automate customer service, streamline internal processes, and provide 24/7 support. The key is starting with well-defined topics and continuously improving based on analytics and user feedback.

