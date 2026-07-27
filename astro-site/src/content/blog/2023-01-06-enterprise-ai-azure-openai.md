---
title: "Enterprise AI with Azure OpenAI: Security, Compliance, and Governance"
author: Michael John Peña
draft: false
date: 2023-01-06
tags:
  - Azure
  - OpenAI
  - Enterprise
  - Security
  - Compliance

---


The question I kept hearing from enterprise clients in January 2023 was some variation of: "We've seen what ChatGPT can do—how do we get that capability without putting my confidential data through OpenAI's servers?" Azure OpenAI Service is the answer to that specific question, and it's worth being precise about what the enterprise features actually provide. The data privacy commitment: prompts and completions sent to Azure OpenAI endpoints associated with your Azure subscription are not used by Microsoft or OpenAI to train the underlying models—this is the contractual commitment that distinguishes Azure OpenAI from the consumer ChatGPT API or OpenAI's direct API. The network isolation: Azure OpenAI supports Private Endpoints (deploying the Azure OpenAI resource's endpoint into a customer VNet so that all API traffic stays on private network paths, never traversing the public internet). The compliance posture: Azure OpenAI is covered under Azure's SOC 1/2/3, ISO 27001, HIPAA BAA, and EU Model Clauses compliance certifications—the same compliance framework that makes Azure acceptable for regulated data processing applies to Azure OpenAI.

## The Enterprise Security Model

Azure OpenAI Service inherits all of Azure's enterprise security capabilities:

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Azure Subscription                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                Virtual Network                        │   │
│  │  ┌─────────────┐     ┌─────────────────────────┐    │   │
│  │  │ Your App    │────▶│ Private Endpoint        │    │   │
│  │  │ Service     │     │ (Azure OpenAI)          │    │   │
│  │  └─────────────┘     └─────────────────────────┘    │   │
│  │                              │                        │   │
│  │                              ▼                        │   │
│  │                      ┌───────────────┐               │   │
│  │                      │ Azure OpenAI  │               │   │
│  │                      │ Service       │               │   │
│  │                      └───────────────┘               │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Setting Up Private Endpoints

Keep your API calls within Azure's backbone network:

```python
# Terraform configuration for private endpoint
resource "azurerm_private_endpoint" "openai" {
  name                = "pe-openai-${var.environment}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  subnet_id           = azurerm_subnet.private.id

  private_service_connection {
    name                           = "openai-connection"
    private_connection_resource_id = azurerm_cognitive_account.openai.id
    subresource_names              = ["account"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "openai-dns-zone-group"
    private_dns_zone_ids = [azurerm_private_dns_zone.openai.id]
  }
}

resource "azurerm_private_dns_zone" "openai" {
  name                = "privatelink.openai.azure.com"
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "openai" {
  name                  = "openai-vnet-link"
  resource_group_name   = azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.openai.name
  virtual_network_id    = azurerm_virtual_network.main.id
}
```

## Managed Identity Authentication

Eliminate API keys with managed identity:

```python
from azure.identity import DefaultAzureCredential, ManagedIdentityCredential
import openai
import requests

class SecureOpenAIClient:
    """Azure OpenAI client using managed identity."""

    def __init__(self, endpoint: str):
        self.endpoint = endpoint
        self.api_version = "2022-12-01"

        # Use managed identity in production, DefaultAzureCredential for development
        if os.getenv("ENVIRONMENT") == "production":
            self.credential = ManagedIdentityCredential()
        else:
            self.credential = DefaultAzureCredential()

    def _get_token(self) -> str:
        """Get access token for Azure OpenAI."""
        token = self.credential.get_token("https://cognitiveservices.azure.com/.default")
        return token.token

    def complete(self, deployment: str, prompt: str, **kwargs) -> str:
        """Make a completion request using managed identity."""
        url = f"{self.endpoint}/openai/deployments/{deployment}/completions"

        headers = {
            "Authorization": f"Bearer {self._get_token()}",
            "Content-Type": "application/json"
        }

        params = {"api-version": self.api_version}

        body = {
            "prompt": prompt,
            "max_tokens": kwargs.get("max_tokens", 500),
            "temperature": kwargs.get("temperature", 0.7)
        }

        response = requests.post(url, headers=headers, params=params, json=body)
        response.raise_for_status()

        return response.json()["choices"][0]["text"]

# Usage
client = SecureOpenAIClient("https://my-openai.openai.azure.com")
result = client.complete("gpt35", "Explain cloud security in one sentence:")
```

## RBAC for Azure OpenAI

Configure role-based access control:

```bash
# Assign roles for different team members

# Developers - can use models but not manage them
az role assignment create \
    --assignee "developer@contoso.com" \
    --role "Cognitive Services OpenAI User" \
    --scope "/subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.CognitiveServices/accounts/{account}"

# Data Scientists - can deploy and manage models
az role assignment create \
    --assignee "datascience-team@contoso.com" \
    --role "Cognitive Services OpenAI Contributor" \
    --scope "/subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.CognitiveServices/accounts/{account}"

# Security team - read-only access for auditing
az role assignment create \
    --assignee "security-team@contoso.com" \
    --role "Reader" \
    --scope "/subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.CognitiveServices/accounts/{account}"
```

## Compliance and Data Residency

Azure OpenAI supports regional deployment for data residency:

```python
# Configuration for different compliance requirements

REGIONAL_CONFIG = {
    "europe": {
        "endpoint": "https://my-openai-eu.openai.azure.com",
        "region": "westeurope",
        "compliance": ["GDPR", "ISO 27001"]
    },
    "us_healthcare": {
        "endpoint": "https://my-openai-us.openai.azure.com",
        "region": "eastus",
        "compliance": ["HIPAA", "SOC 2", "FedRAMP"]
    },
    "australia": {
        "endpoint": "https://my-openai-au.openai.azure.com",
        "region": "australiaeast",
        "compliance": ["IRAP", "ISO 27001"]
    }
}

def get_regional_client(region: str) -> SecureOpenAIClient:
    """Get a client configured for the specified region."""
    config = REGIONAL_CONFIG.get(region)
    if not config:
        raise ValueError(f"Unknown region: {region}")

    return SecureOpenAIClient(config["endpoint"])
```

## Audit Logging

Enable comprehensive logging for compliance:

```python
# Azure Monitor diagnostic settings
resource "azurerm_monitor_diagnostic_setting" "openai" {
  name                       = "openai-diagnostics"
  target_resource_id         = azurerm_cognitive_account.openai.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  log {
    category = "Audit"
    enabled  = true

    retention_policy {
      enabled = true
      days    = 365
    }
  }

  log {
    category = "RequestResponse"
    enabled  = true

    retention_policy {
      enabled = true
      days    = 90
    }
  }

  metric {
    category = "AllMetrics"
    enabled  = true

    retention_policy {
      enabled = true
      days    = 90
    }
  }
}
```

Query logs with KQL:

```kusto
// Query Azure OpenAI usage logs
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.COGNITIVESERVICES"
| where Category == "RequestResponse"
| project
    TimeGenerated,
    OperationName,
    CallerIPAddress,
    DurationMs,
    ResultSignature,
    properties_s
| order by TimeGenerated desc
| take 100
```

## Data Loss Prevention

Implement DLP to prevent sensitive data leakage:

```python
import re
from typing import List, Tuple

class DLPFilter:
    """Data Loss Prevention filter for Azure OpenAI requests."""

    PATTERNS = {
        "credit_card": r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b",
        "ssn": r"\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b",
        "email": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
        "phone": r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b",
        "api_key": r"\b(sk-[a-zA-Z0-9]{32,}|[A-Za-z0-9]{32,})\b"
    }

    def __init__(self, enabled_patterns: List[str] = None):
        self.enabled_patterns = enabled_patterns or list(self.PATTERNS.keys())

    def scan(self, text: str) -> List[Tuple[str, str]]:
        """Scan text for sensitive data patterns."""
        findings = []

        for pattern_name in self.enabled_patterns:
            pattern = self.PATTERNS.get(pattern_name)
            if pattern:
                matches = re.findall(pattern, text)
                for match in matches:
                    findings.append((pattern_name, match))

        return findings

    def redact(self, text: str) -> str:
        """Redact sensitive data from text."""
        redacted = text

        for pattern_name in self.enabled_patterns:
            pattern = self.PATTERNS.get(pattern_name)
            if pattern:
                redacted = re.sub(pattern, f"[REDACTED-{pattern_name.upper()}]", redacted)

        return redacted

    def validate(self, text: str) -> bool:
        """Return True if text contains no sensitive data."""
        return len(self.scan(text)) == 0

class SecureOpenAIWrapper:
    """OpenAI client with DLP protection."""

    def __init__(self, client: SecureOpenAIClient, dlp_filter: DLPFilter):
        self.client = client
        self.dlp_filter = dlp_filter

    def complete(self, deployment: str, prompt: str, **kwargs) -> str:
        """Make a completion with DLP filtering."""
        # Scan input for sensitive data
        findings = self.dlp_filter.scan(prompt)

        if findings:
            # Option 1: Reject the request
            raise ValueError(f"Sensitive data detected: {[f[0] for f in findings]}")

            # Option 2: Redact and continue (uncomment to use)
            # prompt = self.dlp_filter.redact(prompt)

        return self.client.complete(deployment, prompt, **kwargs)

# Usage
dlp = DLPFilter(enabled_patterns=["credit_card", "ssn", "api_key"])
secure_client = SecureOpenAIWrapper(
    SecureOpenAIClient("https://my-openai.openai.azure.com"),
    dlp
)

# This will raise an error due to credit card number
try:
    result = secure_client.complete(
        "gpt35",
        "Process this payment: 4111-1111-1111-1111"
    )
except ValueError as e:
    print(f"Blocked: {e}")
```

## Cost Governance

Implement cost controls and monitoring:

```python
from dataclasses import dataclass
from datetime import datetime, timedelta
import redis

@dataclass
class CostLimits:
    daily_limit_usd: float = 100.0
    monthly_limit_usd: float = 2000.0
    per_request_limit_tokens: int = 4000

class CostGovernor:
    """Track and limit Azure OpenAI costs."""

    # Pricing per 1K tokens
    PRICING = {
        "text-davinci-003": 0.02,
        "text-curie-001": 0.002,
        "gpt-35-turbo": 0.002
    }

    def __init__(self, redis_client: redis.Redis, limits: CostLimits):
        self.redis = redis_client
        self.limits = limits

    def _get_daily_key(self) -> str:
        return f"openai:cost:daily:{datetime.now().strftime('%Y-%m-%d')}"

    def _get_monthly_key(self) -> str:
        return f"openai:cost:monthly:{datetime.now().strftime('%Y-%m')}"

    def check_limits(self) -> bool:
        """Check if within cost limits."""
        daily_cost = float(self.redis.get(self._get_daily_key()) or 0)
        monthly_cost = float(self.redis.get(self._get_monthly_key()) or 0)

        if daily_cost >= self.limits.daily_limit_usd:
            raise Exception(f"Daily cost limit exceeded: ${daily_cost:.2f}")

        if monthly_cost >= self.limits.monthly_limit_usd:
            raise Exception(f"Monthly cost limit exceeded: ${monthly_cost:.2f}")

        return True

    def record_usage(self, model: str, tokens: int):
        """Record token usage and estimated cost."""
        rate = self.PRICING.get(model, 0.02)
        cost = (tokens / 1000) * rate

        # Increment daily and monthly costs
        pipe = self.redis.pipeline()
        pipe.incrbyfloat(self._get_daily_key(), cost)
        pipe.expire(self._get_daily_key(), 86400 * 2)  # 2 days TTL
        pipe.incrbyfloat(self._get_monthly_key(), cost)
        pipe.expire(self._get_monthly_key(), 86400 * 35)  # 35 days TTL
        pipe.execute()

    def get_usage_report(self) -> dict:
        """Get current usage statistics."""
        return {
            "daily_cost": float(self.redis.get(self._get_daily_key()) or 0),
            "daily_limit": self.limits.daily_limit_usd,
            "monthly_cost": float(self.redis.get(self._get_monthly_key()) or 0),
            "monthly_limit": self.limits.monthly_limit_usd
        }
```

## Best Practices Summary

1. **Network Security**: Use private endpoints, disable public access
2. **Authentication**: Prefer managed identity over API keys
3. **Authorization**: Implement RBAC with least privilege
4. **Data Protection**: Implement DLP scanning on inputs
5. **Compliance**: Choose regions based on regulatory requirements
6. **Monitoring**: Enable diagnostic logging for audit trails
7. **Cost Control**: Implement usage tracking and limits

## Resources

- [Azure OpenAI Security Baseline](https://learn.microsoft.com/security/benchmark/azure/baselines/cognitive-services-security-baseline)
- [Private Endpoints for Cognitive Services](https://learn.microsoft.com/azure/cognitive-services/cognitive-services-virtual-networks)
- [RBAC Roles](https://learn.microsoft.com/azure/cognitive-services/openai/how-to/role-based-access-control)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n

