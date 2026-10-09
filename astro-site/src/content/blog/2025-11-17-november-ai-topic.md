---
title: "Ignite 2025 Day 3: Copilot Extensions and Agent Framework"
description: "The Copilot agent framework represents a significant step toward enterprise AI automation, enabling organizations to build intelligent assistants that work…"
author: Michael John Peña
draft: false
date: 2025-11-17
tags:
  - Ignite 2025
  - Copilot
  - AI Agents
  - Microsoft 365
  - Announcements
---

## Copilot Agent Framework

The new agent framework enables building autonomous AI assistants that operate within Microsoft 365:

```typescript
// Define a declarative agent for HR operations
import { CopilotAgentBuilder, ActionDefinition, KnowledgeSource } from '@microsoft/copilot-sdk';

const hrAgent = new CopilotAgentBuilder()
  .setName("HR Assistant")
  .setDescription("Helps employees with HR-related questions and tasks")

  .addKnowledgeSources([
    {
      type: "sharepoint",
      sites: ["/sites/HR-Policies", "/sites/Benefits"],
      permissions: "respect-source"  // Inherits document permissions
    },
    {
      type: "graph-connector",
      connection: "workday-connector"
    }
  ])

  .addActions([
    {
      name: "submitTimeOff",
      description: "Submit a time off request for the user",
      parameters: {
        startDate: { type: "date", required: true },
        endDate: { type: "date", required: true },
        type: { type: "enum", values: ["vacation", "sick", "personal"] }
      },
      handler: async (params, context) => {
        // Call Workday API
        const result = await workdayClient.submitTimeOff({
          employeeId: context.user.employeeId,
          ...params
        });
        return {
          success: true,
          requestId: result.id,
          message: `Time off request ${result.id} submitted for approval`
        };
      }
    },
    {
      name: "checkBenefitsEnrollment",
      description: "Check current benefits enrollment status",
      handler: async (params, context) => {
        const enrollment = await benefitsService.getEnrollment(
          context.user.employeeId
        );
        return enrollment;
      }
    }
  ])

  .setGuardrails({
    maxActionsPerTurn: 3,
    requireConfirmation: ["submitTimeOff", "updateBenefits"],
    auditLogging: true
  })

  .build();

// Deploy to tenant
await hrAgent.deploy({
  availability: "organization",
  allowedGroups: ["all-employees"]
});
```

## Enhanced Plugin Architecture

Plugins can now include complex multi-step workflows:

```yaml
# copilot-plugin.yaml
name: expense-management
displayName: Expense Management
description: Submit and manage expense reports

capabilities:
  - conversational
  - proactive-notifications

actions:
  - name: createExpenseReport
    description: Create a new expense report
    steps:
      - prompt: "What is this expense report for?"
        saveAs: purpose
      - prompt: "Upload receipts or enter amounts manually"
        type: file-upload-or-form
        saveAs: expenses
      - action: validateExpenses
        input: $expenses
      - action: submitForApproval
        input:
          purpose: $purpose
          expenses: $expenses
        requireConfirmation: true

  - name: checkExpenseStatus
    description: Check status of submitted expense reports
    api:
      endpoint: /api/expenses/status
      method: GET
      authentication: user-delegated

notifications:
  - trigger: expense-approved
    message: "Your expense report {reportId} for ${amount} has been approved!"
  - trigger: expense-rejected
    message: "Your expense report {reportId} was rejected. Reason: {reason}"
```

## Copilot Studio Integration

Copilot Studio now supports deploying agents across Microsoft 365:

- Teams integration with adaptive cards
- Outlook add-in deployment
- SharePoint web part embedding
- Power Platform connector

The Copilot agent framework represents a significant step toward enterprise AI automation, enabling organizations to build intelligent assistants that work naturally within existing Microsoft 365 workflows.
