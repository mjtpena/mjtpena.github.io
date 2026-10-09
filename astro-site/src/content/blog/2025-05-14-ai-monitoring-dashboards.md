---
title: "AI Monitoring Dashboards: Visualizing AI System Health"
description: "Comprehensive monitoring dashboards enable proactive AI operations management."
author: Michael John Peña
draft: false
date: 2025-05-14
tags:
  - AI
  - Monitoring
  - Dashboards
  - Observability
  - Operations
---

## AI Monitoring Dashboard

```python
from azure.monitor.query import LogsQueryClient
from azure.identity import DefaultAzureCredential
import pandas as pd
from datetime import datetime, timedelta

class AIMonitoringDashboard:
    def __init__(self, workspace_id: str):
        self.workspace_id = workspace_id
        self.client = LogsQueryClient(DefaultAzureCredential())

    async def get_latency_metrics(self, hours: int = 24) -> pd.DataFrame:
        """Get latency metrics for AI endpoints."""
        query = """
        AzureDiagnostics
        | where Category == "AIInference"
        | where TimeGenerated > ago({hours}h)
        | summarize
            avg_latency = avg(DurationMs),
            p50_latency = percentile(DurationMs, 50),
            p95_latency = percentile(DurationMs, 95),
            p99_latency = percentile(DurationMs, 99),
            request_count = count()
            by bin(TimeGenerated, 1h), EndpointName
        | order by TimeGenerated asc
        """.format(hours=hours)

        return await self.execute_query(query)

    async def get_quality_metrics(self, hours: int = 24) -> pd.DataFrame:
        """Get quality metrics for AI responses."""
        query = """
        customMetrics
        | where name in ("ai.relevancy", "ai.faithfulness", "ai.coherence")
        | where timestamp > ago({hours}h)
        | summarize
            avg_score = avg(value),
            min_score = min(value),
            max_score = max(value)
            by bin(timestamp, 1h), name, cloud_RoleName
        | order by timestamp asc
        """.format(hours=hours)

        return await self.execute_query(query)

    async def get_cost_metrics(self, days: int = 30) -> pd.DataFrame:
        """Get cost metrics for AI usage."""
        query = """
        customMetrics
        | where name == "ai.token_cost"
        | where timestamp > ago({days}d)
        | summarize
            total_cost = sum(value),
            avg_cost_per_request = avg(value)
            by bin(timestamp, 1d), cloud_RoleName, customDimensions.model
        | order by timestamp asc
        """.format(days=days)

        return await self.execute_query(query)

    async def get_error_metrics(self, hours: int = 24) -> pd.DataFrame:
        """Get error metrics for AI endpoints."""
        query = """
        AzureDiagnostics
        | where Category == "AIInference"
        | where TimeGenerated > ago({hours}h)
        | summarize
            total_requests = count(),
            error_count = countif(ResultCode >= 400),
            error_rate = todouble(countif(ResultCode >= 400)) / count() * 100
            by bin(TimeGenerated, 1h), EndpointName
        | order by TimeGenerated asc
        """.format(hours=hours)

        return await self.execute_query(query)

    async def get_token_usage(self, hours: int = 24) -> pd.DataFrame:
        """Get token usage metrics."""
        query = """
        customMetrics
        | where name in ("ai.input_tokens", "ai.output_tokens")
        | where timestamp > ago({hours}h)
        | summarize
            total_tokens = sum(value)
            by bin(timestamp, 1h), name, customDimensions.model
        | order by timestamp asc
        """.format(hours=hours)

        return await self.execute_query(query)

    def build_dashboard_data(self) -> dict:
        """Build complete dashboard data."""
        return {
            "latency": self.get_latency_metrics(),
            "quality": self.get_quality_metrics(),
            "costs": self.get_cost_metrics(),
            "errors": self.get_error_metrics(),
            "tokens": self.get_token_usage(),
            "summary": self.get_summary_stats()
        }
```

Comprehensive monitoring dashboards enable proactive AI operations management.
