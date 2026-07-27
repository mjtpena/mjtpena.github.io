---
title: "GPT-4 on Azure OpenAI: What to Expect"
author: Michael John Pena
draft: false
date: 2023-03-17
tags:
  - Azure
  - OpenAI
  - AI
  - GPT-4
  - Enterprise

---

I wrote "GPT-4 on Azure OpenAI: What to Expect" to share practical, production-minded guidance on this topic.

## Azure OpenAI Advantages for GPT-4

### Enterprise Security
- **Private endpoints**: Keep traffic within your VNet
- **Data residency**: Choose your Azure region
- **No training on your data**: Your prompts aren't used to train models
- **Compliance**: HIPAA, SOC 2, ISO 27001, and more

### Integration Benefits
- **Azure AD authentication**: Use managed identities
- **API Management**: Governance, rate limiting, analytics
- **Private Link**: No public internet exposure
- **Monitoring**: Application Insights integration

## Preparing Your Azure Environment

```bicep
// Bicep template for Azure OpenAI with GPT-4 ready configuration

param location string = 'eastus'
param openAIName string = 'myopenai'

resource openAI 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: openAIName
  location: location
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: openAIName
    networkAcls: {
      defaultAction: 'Deny'
      virtualNetworkRules: []
      ipRules: []
    }
    publicNetworkAccess: 'Disabled'
  }
}

// Private endpoint for secure access
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-04-01' = {
  name: '${openAIName}-pe'
  location: location
  properties: {
    subnet: {
      id: subnetId
    }
    privateLinkServiceConnections: [
      {
        name: '${openAIName}-plsc'
        properties: {
          privateLinkServiceId: openAI.id
          groupIds: [
            'account'
          ]
        }
      }
    ]
  }
}

// GPT-4 deployment (when available)
resource gpt4Deployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openAI
  name: 'gpt-4'
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4'
      version: '0314'  // Version will vary
    }
    scaleSettings: {
      scaleType: 'Standard'
    }
  }
}

// GPT-4-32K deployment
resource gpt432kDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openAI
  name: 'gpt-4-32k'
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4-32k'
      version: '0314'
    }
    scaleSettings: {
      scaleType: 'Standard'
    }
  }
}

output endpoint string = openAI.properties.endpoint
```

## Authentication with Managed Identity

```python
from azure.identity import DefaultAzureCredential, ManagedIdentityCredential
from azure.core.credentials import AzureKeyCredential
import openai

class AzureOpenAIClient:
    """Azure OpenAI client with managed identity support."""

    def __init__(
        self,
        endpoint: str,
        use_managed_identity: bool = True,
        api_key: str = None
    ):
        self.endpoint = endpoint

        if use_managed_identity:
            # Use managed identity (recommended for production)
            credential = DefaultAzureCredential()
            token = credential.get_token("https://cognitiveservices.azure.com/.default")

            openai.api_type = "azure_ad"
            openai.api_key = token.token
        else:
            # Use API key (for development)
            openai.api_type = "azure"
            openai.api_key = api_key

        openai.api_base = endpoint
        openai.api_version = "2023-03-15-preview"

    async def chat_completion(
        self,
        messages: list,
        deployment: str = "gpt-4",
        **kwargs
    ) -> dict:
        """Chat completion with automatic token refresh."""
        try:
            response = await openai.ChatCompletion.acreate(
                engine=deployment,
                messages=messages,
                **kwargs
            )
            return response

        except openai.error.AuthenticationError:
            # Token expired, refresh
            await self._refresh_token()
            return await openai.ChatCompletion.acreate(
                engine=deployment,
                messages=messages,
                **kwargs
            )

    async def _refresh_token(self):
        """Refresh Azure AD token."""
        credential = DefaultAzureCredential()
        token = credential.get_token("https://cognitiveservices.azure.com/.default")
        openai.api_key = token.token
```

## Quota and Capacity Planning

GPT-4 will have separate quotas from GPT-3.5:

```python
from dataclasses import dataclass
from enum import Enum

class ModelTier(Enum):
    GPT35_TURBO = "gpt-35-turbo"
    GPT4 = "gpt-4"
    GPT4_32K = "gpt-4-32k"

@dataclass
class QuotaConfig:
    model: ModelTier
    tokens_per_minute: int
    requests_per_minute: int

# Expected quota structure (estimates)
EXPECTED_QUOTAS = {
    ModelTier.GPT35_TURBO: QuotaConfig(ModelTier.GPT35_TURBO, 120000, 720),
    ModelTier.GPT4: QuotaConfig(ModelTier.GPT4, 40000, 200),
    ModelTier.GPT4_32K: QuotaConfig(ModelTier.GPT4_32K, 80000, 60),
}

class QuotaManager:
    """Manage Azure OpenAI quotas."""

    def __init__(self, quotas: dict[ModelTier, QuotaConfig]):
        self.quotas = quotas
        self.usage = {tier: {"tokens": 0, "requests": 0} for tier in ModelTier}

    def can_make_request(
        self,
        model: ModelTier,
        estimated_tokens: int
    ) -> tuple[bool, str]:
        """Check if request is within quota."""
        quota = self.quotas.get(model)
        if not quota:
            return False, f"No quota configured for {model}"

        usage = self.usage[model]

        if usage["tokens"] + estimated_tokens > quota.tokens_per_minute:
            return False, f"Token quota exceeded for {model}"

        if usage["requests"] + 1 > quota.requests_per_minute:
            return False, f"Request quota exceeded for {model}"

        return True, "OK"

    def record_usage(self, model: ModelTier, tokens: int):
        """Record token usage."""
        self.usage[model]["tokens"] += tokens
        self.usage[model]["requests"] += 1

    def reset_minute(self):
        """Reset per-minute counters."""
        for tier in ModelTier:
            self.usage[tier] = {"tokens": 0, "requests": 0}
```

## Cost Management

```python
from azure.mgmt.costmanagement import CostManagementClient
from azure.identity import DefaultAzureCredential
from datetime import datetime, timedelta

class OpenAICostTracker:
    """Track Azure OpenAI costs."""

    PRICING = {
        "gpt-35-turbo": {"input": 0.002, "output": 0.002},
        "gpt-4": {"input": 0.03, "output": 0.06},
        "gpt-4-32k": {"input": 0.06, "output": 0.12},
    }

    def __init__(self, subscription_id: str, resource_group: str):
        self.credential = DefaultAzureCredential()
        self.cost_client = CostManagementClient(self.credential, subscription_id)
        self.resource_group = resource_group

    def estimate_cost(
        self,
        model: str,
        input_tokens: int,
        output_tokens: int
    ) -> float:
        """Estimate cost for a request."""
        pricing = self.PRICING.get(model, self.PRICING["gpt-35-turbo"])
        input_cost = (input_tokens / 1000) * pricing["input"]
        output_cost = (output_tokens / 1000) * pricing["output"]
        return input_cost + output_cost

    def get_daily_spend(self) -> dict:
        """Get Azure OpenAI spend for today."""
        # Query cost management API
        scope = f"/subscriptions/{self.subscription_id}/resourceGroups/{self.resource_group}"

        today = datetime.utcnow().date()
        yesterday = today - timedelta(days=1)

        query = {
            "type": "ActualCost",
            "timeframe": "Custom",
            "timePeriod": {
                "from": yesterday.isoformat(),
                "to": today.isoformat()
            },
            "dataset": {
                "granularity": "Daily",
                "filter": {
                    "dimensions": {
                        "name": "ServiceName",
                        "operator": "In",
                        "values": ["Azure OpenAI"]
                    }
                }
            }
        }

        result = self.cost_client.query.usage(scope, query)
        return result
```

## Monitoring and Alerting

```python
# Application Insights custom metrics for GPT-4

from opencensus.ext.azure import metrics_exporter
from opencensus.stats import aggregation, measure, stats, view

# Define measures
gpt4_tokens_measure = measure.MeasureInt(
    "gpt4_tokens",
    "Number of GPT-4 tokens used",
    "tokens"
)

gpt4_latency_measure = measure.MeasureFloat(
    "gpt4_latency",
    "GPT-4 request latency",
    "ms"
)

gpt4_cost_measure = measure.MeasureFloat(
    "gpt4_cost",
    "GPT-4 request cost",
    "USD"
)

# Define views
gpt4_tokens_view = view.View(
    "gpt4_tokens_total",
    "Total GPT-4 tokens",
    [],
    gpt4_tokens_measure,
    aggregation.SumAggregation()
)

# Export to Application Insights
exporter = metrics_exporter.new_metrics_exporter(
    connection_string="InstrumentationKey=..."
)

class GPT4Monitor:
    def __init__(self):
        self.stats_recorder = stats.stats_recorder

    def record_request(
        self,
        tokens: int,
        latency_ms: float,
        cost: float,
        success: bool
    ):
        """Record GPT-4 request metrics."""
        mmap = self.stats_recorder.new_measurement_map()
        mmap.measure_int_put(gpt4_tokens_measure, tokens)
        mmap.measure_float_put(gpt4_latency_measure, latency_ms)
        mmap.measure_float_put(gpt4_cost_measure, cost)
        mmap.record()
```

## Migration Checklist

When GPT-4 becomes available on Azure:

1. **Request quota increase** - Apply early as capacity may be limited
2. **Create deployments** - Deploy GPT-4 and GPT-4-32K models
3. **Update authentication** - Ensure managed identity is configured
4. **Set up monitoring** - Track usage, latency, and costs
5. **Configure alerts** - Budget and quota alerts
6. **Test thoroughly** - Validate prompts work as expected
7. **Gradual rollout** - Start with non-critical workloads

## Expected Timeline

Based on Microsoft's patterns:
- **Initial availability**: Limited regions, waitlist
- **Broader rollout**: 4-8 weeks after initial
- **GA**: 2-3 months after announcement

Stay updated through Azure OpenAI documentation and Microsoft announcements.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
