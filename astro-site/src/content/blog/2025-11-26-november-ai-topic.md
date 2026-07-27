---
title: "Cost Management for Azure AI Services: Budgeting and Optimization"
author: Michael John Peña
draft: false
date: 2025-11-26
tags:
  - Cost Management
  - Azure AI
  - FinOps
  - Budget
  - Optimization

---

I wrote "Cost Management for Azure AI Services: Budgeting and Optimization" to share practical, production-minded guidance on this topic.

## Understanding AI Costs

Azure AI costs depend on multiple factors: model selection, token usage, deployment type (serverless vs. provisioned), and regional pricing. Visibility into these components enables informed decisions.

## Cost Tracking Implementation

Build comprehensive cost monitoring:

```python
from azure.mgmt.costmanagement import CostManagementClient
from azure.identity import DefaultAzureCredential
from dataclasses import dataclass
from datetime import datetime, timedelta
import pandas as pd

@dataclass
class CostBreakdown:
    service: str
    resource: str
    daily_cost: float
    monthly_projection: float
    trend: str

class AICostTracker:
    def __init__(self, subscription_id: str):
        self.client = CostManagementClient(
            credential=DefaultAzureCredential(),
            subscription_id=subscription_id
        )
        self.subscription_id = subscription_id

    def get_ai_costs(self, days: int = 30) -> list[CostBreakdown]:
        """Get cost breakdown for AI services."""

        scope = f"/subscriptions/{self.subscription_id}"

        query = {
            "type": "ActualCost",
            "timeframe": "Custom",
            "timePeriod": {
                "from": (datetime.now() - timedelta(days=days)).isoformat(),
                "to": datetime.now().isoformat()
            },
            "dataset": {
                "granularity": "Daily",
                "aggregation": {
                    "totalCost": {
                        "name": "Cost",
                        "function": "Sum"
                    }
                },
                "grouping": [
                    {"type": "Dimension", "name": "ServiceName"},
                    {"type": "Dimension", "name": "ResourceId"}
                ],
                "filter": {
                    "or": [
                        {"dimensions": {"name": "ServiceName", "operator": "In",
                                       "values": ["Azure OpenAI", "Cognitive Services",
                                                 "Azure AI Search"]}},
                        {"tags": {"name": "category", "operator": "In",
                                 "values": ["ai", "ml"]}}
                    ]
                }
            }
        }

        result = self.client.query.usage(scope=scope, parameters=query)

        # Process results into cost breakdown
        costs = []
        for row in result.rows:
            daily_avg = row[2] / days
            monthly_proj = daily_avg * 30

            # Calculate trend
            recent_avg = self._get_recent_average(row[1], 7)
            trend = "increasing" if recent_avg > daily_avg else "decreasing"

            costs.append(CostBreakdown(
                service=row[0],
                resource=row[1],
                daily_cost=daily_avg,
                monthly_projection=monthly_proj,
                trend=trend
            ))

        return costs

    def set_budget_alert(
        self,
        resource_group: str,
        monthly_budget: float,
        alert_thresholds: list[int] = [50, 75, 90, 100]
    ):
        """Create budget with alerts for AI resources."""

        from azure.mgmt.consumption import ConsumptionManagementClient

        consumption_client = ConsumptionManagementClient(
            credential=DefaultAzureCredential(),
            subscription_id=self.subscription_id
        )

        scope = f"/subscriptions/{self.subscription_id}/resourceGroups/{resource_group}"

        notifications = {}
        for threshold in alert_thresholds:
            notifications[f"alert_{threshold}"] = {
                "enabled": True,
                "operator": "GreaterThan",
                "threshold": threshold,
                "contactEmails": ["ai-team@company.com"],
                "contactRoles": ["Owner", "Contributor"]
            }

        budget = {
            "category": "Cost",
            "amount": monthly_budget,
            "timeGrain": "Monthly",
            "timePeriod": {
                "startDate": datetime.now().replace(day=1).isoformat(),
                "endDate": (datetime.now().replace(day=1) + timedelta(days=365)).isoformat()
            },
            "filter": {
                "tags": {
                    "name": "category",
                    "operator": "In",
                    "values": ["ai"]
                }
            },
            "notifications": notifications
        }

        consumption_client.budgets.create_or_update(
            scope=scope,
            budget_name=f"{resource_group}-ai-budget",
            parameters=budget
        )
```

## Token Usage Optimization

Implement strategies to reduce token consumption:

```python
class TokenOptimizer:
    def __init__(self):
        self.tiktoken = tiktoken.encoding_for_model("gpt-4")

    def estimate_cost(self, messages: list[dict], model: str) -> dict:
        """Estimate request cost before execution."""

        pricing = {
            "gpt-4": {"input": 0.03, "output": 0.06},
            "gpt-4-turbo": {"input": 0.01, "output": 0.03},
            "gpt-3.5-turbo": {"input": 0.0005, "output": 0.0015}
        }

        input_tokens = sum(
            len(self.tiktoken.encode(m["content"]))
            for m in messages
        )

        # Estimate output (typically 2-3x input for conversations)
        estimated_output = input_tokens * 2

        model_pricing = pricing.get(model, pricing["gpt-4"])

        return {
            "input_tokens": input_tokens,
            "estimated_output_tokens": estimated_output,
            "estimated_cost": (
                (input_tokens / 1000) * model_pricing["input"] +
                (estimated_output / 1000) * model_pricing["output"]
            )
        }

    def optimize_prompt(self, prompt: str, max_tokens: int) -> str:
        """Reduce prompt size while preserving meaning."""

        current_tokens = len(self.tiktoken.encode(prompt))

        if current_tokens <= max_tokens:
            return prompt

        # Compression strategies
        # 1. Remove redundant whitespace
        prompt = " ".join(prompt.split())

        # 2. Use abbreviations for common terms
        abbreviations = {
            "for example": "e.g.",
            "that is": "i.e.",
            "and so on": "etc."
        }
        for full, abbrev in abbreviations.items():
            prompt = prompt.replace(full, abbrev)

        return prompt
```

Effective cost management combines visibility, budgeting, and optimization. Regular review of AI spending patterns helps identify opportunities to reduce costs without compromising functionality.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
