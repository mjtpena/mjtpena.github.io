---
title: "Build 2025: The Copilot Stack Deep Dive"
author: Michael John Peña
draft: false
date: 2025-05-03
tags:
  - Microsoft
  - Build
  - Copilot
  - Development
  - Stack

---

I wrote "Build 2025: The Copilot Stack Deep Dive" to share practical, production-minded guidance on this topic.

## Copilot Stack Architecture

### Layer 1: Foundation Models
- Access to GPT-5, Claude 4, Gemini 2
- Microsoft's own models (Phi-4, MAI-1)
- Automatic model routing and fallback

### Layer 2: AI Orchestration
- Semantic Kernel 2.0 release
- Built-in memory and planning
- Cross-service orchestration

### Layer 3: Copilot Services
- Grounding with enterprise data
- Safety and compliance filters
- Multi-turn conversation management

### Layer 4: User Experiences
- Copilot in Microsoft 365
- Custom Copilots in Copilot Studio
- Embedded Copilot components

## Building Custom Copilots

```csharp
// Copilot Studio API for custom copilots
using Microsoft.Copilot.Studio;

var copilot = new CopilotBuilder()
    .WithName("SalesAssistant")
    .WithDescription("Helps sales team with customer insights")
    .WithModel("gpt-4o")
    .WithGrounding(new GroundingConfig
    {
        DataSources = new[]
        {
            new SharePointDataSource("https://company.sharepoint.com/sales"),
            new DynamicsDataSource("https://company.crm.dynamics.com")
        },
        SearchType = SearchType.Hybrid
    })
    .WithTopics(new[]
    {
        new Topic("CustomerLookup", "Find customer information"),
        new Topic("SalesForecast", "Get sales predictions"),
        new Topic("CompetitorAnalysis", "Analyze competitors")
    })
    .WithSafetyFilters(SafetyLevel.Enterprise)
    .Build();

// Deploy copilot
var deployment = await copilot.DeployAsync(new DeploymentConfig
{
    Channel = Channel.Teams,
    Users = UserGroup.SalesTeam,
    Analytics = true
});
```

## Copilot Extensions Framework

```typescript
// Building a Copilot extension
import { CopilotExtension, Message, Response } from '@microsoft/copilot-sdk';

class InventoryExtension extends CopilotExtension {
    name = "Inventory Lookup";
    description = "Check product inventory levels";

    async handleMessage(message: Message): Promise<Response> {
        const product = this.extractProduct(message.text);
        const inventory = await this.inventoryService.check(product);

        return {
            text: `Current inventory for ${product}: ${inventory.quantity} units`,
            adaptiveCard: this.buildInventoryCard(inventory),
            citations: [{ source: "Inventory System", url: "..." }]
        };
    }
}
```

The Copilot Stack makes it straightforward to build AI-powered applications across the Microsoft ecosystem.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
