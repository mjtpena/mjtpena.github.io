---
title: "Power Apps Cards: Micro-Apps for Microsoft Teams"
author: Michael John Peña
draft: false
date: 2022-04-02
tags:
  - Power Platform
  - Power Apps
  - Microsoft Teams
  - Cards
  - Low-Code

---

I wrote "Power Apps Cards: Micro-Apps for Microsoft Teams" to share practical, production-minded guidance on this topic.

## What Are Power Apps Cards?

Cards are lightweight, interactive UI components that:
- Appear inline in Teams conversations
- Support data input and actions
- Connect to Dataverse and other data sources
- Can be triggered from flows or bots

## Creating Your First Card

### Card Designer

```yaml
# Card structure
card:
  name: "Expense Approval"
  description: "Quick expense approval card"

  inputs:
    - name: expenseId
      type: text
      required: true
    - name: amount
      type: number
      required: true
    - name: description
      type: text

  layout:
    - type: TextBlock
      text: "Expense Approval Request"
      size: Large
      weight: Bolder

    - type: FactSet
      facts:
        - title: "Amount"
          value: "${amount}"
        - title: "Description"
          value: "${description}"

    - type: ActionSet
      actions:
        - type: Action.Submit
          title: "Approve"
          data:
            action: "approve"
            expenseId: "${expenseId}"
        - type: Action.Submit
          title: "Reject"
          data:
            action: "reject"
            expenseId: "${expenseId}"
```

### Power Fx in Cards

```powerfx
// Card formulas
Card.OnSubmit = Switch(
    Card.SubmitData.action,
    "approve",
        Patch(
            Expenses,
            LookUp(Expenses, ID = Card.SubmitData.expenseId),
            {Status: "Approved", ApprovedBy: User().Email, ApprovedDate: Now()}
        );
        Notify("Expense approved!", NotificationType.Success),
    "reject",
        Patch(
            Expenses,
            LookUp(Expenses, ID = Card.SubmitData.expenseId),
            {Status: "Rejected", RejectedBy: User().Email, RejectedDate: Now()}
        );
        Notify("Expense rejected", NotificationType.Information)
)
```

## Card Types

### Approval Card

```yaml
card:
  name: "Leave Request Approval"

  inputs:
    - name: requestId
      type: text
    - name: employeeName
      type: text
    - name: startDate
      type: date
    - name: endDate
      type: date
    - name: leaveType
      type: text

  layout:
    - type: Container
      style: emphasis
      items:
        - type: TextBlock
          text: "Leave Request"
          size: Large

    - type: ColumnSet
      columns:
        - width: auto
          items:
            - type: Image
              url: "${employeePhoto}"
              size: Small
              style: Person
        - width: stretch
          items:
            - type: TextBlock
              text: "${employeeName}"
              weight: Bolder
            - type: TextBlock
              text: "${leaveType}"
              isSubtle: true

    - type: FactSet
      facts:
        - title: "From"
          value: "${startDate}"
        - title: "To"
          value: "${endDate}"
        - title: "Days"
          value: "${daysCount}"

    - type: ActionSet
      actions:
        - type: Action.Submit
          title: "Approve"
          style: positive
          data: {action: "approve"}
        - type: Action.Submit
          title: "Reject"
          style: destructive
          data: {action: "reject"}
        - type: Action.ShowCard
          title: "Add Comment"
          card:
            type: AdaptiveCard
            body:
              - type: Input.Text
                id: comment
                placeholder: "Enter comment..."
                isMultiline: true
            actions:
              - type: Action.Submit
                title: "Submit with Comment"
                data: {action: "reject_with_comment"}
```

### Data Entry Card

```yaml
card:
  name: "Quick Ticket"

  layout:
    - type: TextBlock
      text: "Create Support Ticket"
      size: Medium
      weight: Bolder

    - type: Input.Text
      id: subject
      label: "Subject"
      isRequired: true
      errorMessage: "Subject is required"

    - type: Input.ChoiceSet
      id: priority
      label: "Priority"
      style: compact
      value: "medium"
      choices:
        - title: "Low"
          value: "low"
        - title: "Medium"
          value: "medium"
        - title: "High"
          value: "high"
        - title: "Critical"
          value: "critical"

    - type: Input.Text
      id: description
      label: "Description"
      isMultiline: true
      maxLength: 500

    - type: ActionSet
      actions:
        - type: Action.Submit
          title: "Create Ticket"
          style: positive
```

### Status Update Card

```yaml
card:
  name: "Project Status"
  refresh:
    action:
      type: Action.Execute
      verb: "refresh"
    userIds: [] # Refresh for all users

  layout:
    - type: TextBlock
      text: "Project: ${projectName}"
      size: Large

    - type: ProgressBar
      title: "Completion"
      value: ${completionPercent}
      valueLabel: "${completionPercent}%"

    - type: FactSet
      facts:
        - title: "Status"
          value: "${status}"
        - title: "Due Date"
          value: "${dueDate}"
        - title: "Owner"
          value: "${ownerName}"

    - type: ActionSet
      actions:
        - type: Action.OpenUrl
          title: "View Details"
          url: "${projectUrl}"
        - type: Action.Submit
          title: "Update Status"
          data: {action: "update"}
```

## Triggering Cards from Power Automate

```json
{
    "definition": {
        "triggers": {
            "When_expense_submitted": {
                "type": "ApiConnection",
                "inputs": {
                    "host": {
                        "connectionName": "shared_commondataserviceforapps"
                    },
                    "method": "post",
                    "path": "/v2/datasets/@{encodeURIComponent('default.cds')}/tables/@{encodeURIComponent('expenses')}/onnewitems"
                }
            }
        },
        "actions": {
            "Get_Manager": {
                "type": "ApiConnection",
                "inputs": {
                    "method": "get",
                    "path": "/v2/datasets/@{encodeURIComponent('default.cds')}/tables/@{encodeURIComponent('users')}/items/@{triggerBody()?['_submittedby_value']}"
                }
            },
            "Post_Card_to_Teams": {
                "type": "ApiConnection",
                "inputs": {
                    "method": "post",
                    "path": "/v1.0/teams/@{outputs('Get_Manager')?['body/manager_id']}/channels/@{variables('ApprovalChannelId')}/messages",
                    "body": {
                        "body": {
                            "contentType": "html",
                            "content": "<attachment id=\"expense-approval-card\"></attachment>"
                        },
                        "attachments": [
                            {
                                "id": "expense-approval-card",
                                "contentType": "application/vnd.microsoft.card.adaptive",
                                "content": "@{outputs('Generate_Card_JSON')}"
                            }
                        ]
                    }
                }
            }
        }
    }
}
```

## Handling Card Submissions

```powerfx
// In Power Apps or Power Automate
// Handle the submit action

// Power Automate flow for card submission
When_card_submitted ->
    Switch(triggerBody()?['action'],
        "approve" ->
            // Update record
            Update_Expense_Status("Approved")
            // Send confirmation
            Post_Confirmation_Card()
            // Notify submitter
            Send_Email_Notification(),

        "reject" ->
            Update_Expense_Status("Rejected")
            Post_Rejection_Card()
            Send_Email_Notification(),

        "reject_with_comment" ->
            Update_Expense_With_Comment()
            Post_Rejection_Card()
    )
```

## Card Refresh

Enable automatic card updates:

```yaml
card:
  name: "Live Status Card"

  # Enable refresh
  refresh:
    mode: automatic
    action:
      type: Action.Execute
      verb: "refreshCard"
    userIds: ["user1@company.com", "user2@company.com"]

  # Card body updates when refreshed
  body:
    - type: TextBlock
      text: "Last Updated: ${lastUpdated}"

    - type: FactSet
      facts:
        - title: "Current Status"
          value: "${currentStatus}"
        - title: "Items Processed"
          value: "${processedCount}"
```

## Best Practices

### Design Guidelines

```yaml
guidelines:
  simplicity:
    - Keep cards focused on single task
    - Limit to 3-4 actions maximum
    - Use clear, concise labels

  accessibility:
    - Provide alt text for images
    - Use sufficient color contrast
    - Support keyboard navigation

  responsiveness:
    - Design for mobile-first
    - Test on different screen sizes
    - Use flexible layouts

  performance:
    - Minimize data fetched
    - Use caching where appropriate
    - Optimize image sizes
```

### Error Handling

```powerfx
// Robust card submission handling
Card.OnSubmit = If(
    IsBlank(Card.SubmitData.requiredField),
    Notify("Required field missing", NotificationType.Error),

    // Try the operation
    With(
        {result: Patch(Table, Record, Updates)},
        If(
            IsError(result),
            Notify("Failed to save: " & FirstError.Message, NotificationType.Error),
            Notify("Saved successfully!", NotificationType.Success);
            RefreshCard()
        )
    )
)
```

## Integration Scenarios

### Approval Workflows

```
1. User submits request
2. Flow sends card to approver in Teams
3. Approver clicks Approve/Reject in card
4. Flow processes response
5. Card updates to show outcome
6. Notifications sent to all parties
```

### Data Collection

```
1. Bot asks user for information
2. Card displayed for structured input
3. User fills form and submits
4. Data stored in Dataverse
5. Confirmation card shown
```

### Status Dashboards

```
1. Scheduled flow runs periodically
2. Aggregates current metrics
3. Posts/updates card in channel
4. Users see live status without navigation
```

## Conclusion

Power Apps Cards enable contextual micro-interactions within Microsoft Teams:
- Approvals without leaving chat
- Quick data entry
- Real-time status updates
- Reduced context switching

They're perfect for repetitive tasks that don't warrant a full application.

## Resources

- [Power Apps Cards Documentation](https://docs.microsoft.com/en-us/power-apps/cards/overview)
- [Adaptive Cards Designer](https://adaptivecards.io/designer/)
- [Teams Card Reference](https://docs.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference)

