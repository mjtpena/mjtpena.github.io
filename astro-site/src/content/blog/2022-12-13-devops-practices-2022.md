---
title: "DevOps Practices That Defined 2022"
author: Michael John Peña
draft: false
date: 2022-12-13
tags:
  - DevOps
  - CI/CD
  - Automation
  - Best Practices
  - Platform Engineering
---

## DORA Metrics Focus

The four key metrics gained mainstream adoption:

```python
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List

@dataclass
class DeploymentEvent:
    timestamp: datetime
    service: str
    success: bool
    lead_time_hours: float

@dataclass
class IncidentEvent:
    start_time: datetime
    resolution_time: datetime
    service: str
    severity: str

class DORAMetrics:
    def __init__(self, deployments: List[DeploymentEvent], incidents: List[IncidentEvent]):
        self.deployments = deployments
        self.incidents = incidents

    def deployment_frequency(self, period_days: int = 30) -> float:
        """Deployments per day over the period."""
        cutoff = datetime.now() - timedelta(days=period_days)
        recent = [d for d in self.deployments if d.timestamp > cutoff]
        return len(recent) / period_days

    def lead_time_for_changes(self) -> float:
        """Average lead time from commit to production (hours)."""
        return sum(d.lead_time_hours for d in self.deployments) / len(self.deployments)

    def change_failure_rate(self) -> float:
        """Percentage of deployments causing incidents."""
        failed = sum(1 for d in self.deployments if not d.success)
        return failed / len(self.deployments) * 100

    def time_to_restore(self) -> float:
        """Average time to restore service (hours)."""
        restore_times = [
            (i.resolution_time - i.start_time).total_seconds() / 3600
            for i in self.incidents
        ]
        return sum(restore_times) / len(restore_times) if restore_times else 0

    def performance_level(self) -> str:
        """Assess overall DORA performance."""
        df = self.deployment_frequency()
        lt = self.lead_time_for_changes()
        cfr = self.change_failure_rate()
        ttr = self.time_to_restore()

        if df >= 1 and lt < 24 and cfr < 15 and ttr < 1:
            return "Elite"
        elif df >= 0.14 and lt < 168 and cfr < 30 and ttr < 24:
            return "High"
        elif df >= 0.033 and lt < 720 and cfr < 45 and ttr < 168:
            return "Medium"
        else:
            return "Low"
```

## Shift-Left Security

Security integrated earlier in the pipeline:

```yaml
# GitHub Actions with security scanning
name: CI Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      # Secret scanning
      - name: Scan for secrets
        uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          base: ${{ github.event.pull_request.base.sha }}
          head: ${{ github.event.pull_request.head.sha }}

      # Dependency scanning
      - name: Run Snyk
        uses: snyk/actions/dotnet@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --severity-threshold=high

      # SAST scanning
      - name: Run CodeQL
        uses: github/codeql-action/analyze@v2
        with:
          languages: csharp

      # Container scanning
      - name: Build and scan container
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.IMAGE_NAME }}
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'

      # Upload results
      - name: Upload security results
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: 'trivy-results.sarif'

  build:
    needs: security-scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Build
        run: dotnet build

      - name: Test
        run: dotnet test --collect:"XPlat Code Coverage"
```

## Infrastructure as Code Maturity

IaC practices became more sophisticated:

```hcl
# Terraform with modules and best practices
terraform {
  required_version = ">= 1.3.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }

  backend "azurerm" {
    resource_group_name  = "tf-state"
    storage_account_name = "tfstateaccount"
    container_name       = "tfstate"
    key                  = "prod.terraform.tfstate"
  }
}

# Policy as code
resource "azurerm_policy_assignment" "require_tags" {
  name                 = "require-tags"
  scope                = azurerm_resource_group.main.id
  policy_definition_id = azurerm_policy_definition.require_tags.id
  description          = "Require tags on all resources"

  non_compliance_message {
    content = "Resources must have environment and owner tags"
  }
}

# Modular infrastructure
module "networking" {
  source = "./modules/networking"

  vnet_name           = "${var.prefix}-vnet"
  address_space       = var.vnet_address_space
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location

  subnets = {
    "aks" = {
      address_prefix = "10.0.1.0/24"
      service_endpoints = ["Microsoft.Storage", "Microsoft.Sql"]
    }
    "data" = {
      address_prefix = "10.0.2.0/24"
      service_endpoints = ["Microsoft.Storage"]
      delegation = {
        name    = "delegation"
        service = "Microsoft.DBforPostgreSQL/flexibleServers"
      }
    }
  }
}

module "kubernetes" {
  source = "./modules/aks"

  cluster_name        = "${var.prefix}-aks"
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  subnet_id           = module.networking.subnet_ids["aks"]

  depends_on = [module.networking]
}
```

## Observability as Standard

Three pillars implemented consistently:

```csharp
// .NET 7 with OpenTelemetry
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using OpenTelemetry.Logs;

var builder = WebApplication.CreateBuilder(args);

// Configure OpenTelemetry
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource
        .AddService("order-service")
        .AddAttributes(new Dictionary<string, object>
        {
            ["environment"] = builder.Environment.EnvironmentName,
            ["version"] = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "unknown"
        }))
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddSqlClientInstrumentation(options => options.SetDbStatementForText = true)
        .AddSource("OrderService")
        .AddAzureMonitorTraceExporter(options =>
        {
            options.ConnectionString = builder.Configuration["ApplicationInsights:ConnectionString"];
        }))
    .WithMetrics(metrics => metrics
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddRuntimeInstrumentation()
        .AddMeter("OrderService")
        .AddAzureMonitorMetricExporter(options =>
        {
            options.ConnectionString = builder.Configuration["ApplicationInsights:ConnectionString"];
        }));

builder.Logging.AddOpenTelemetry(logging => logging
    .AddAzureMonitorLogExporter(options =>
    {
        options.ConnectionString = builder.Configuration["ApplicationInsights:ConnectionString"];
    }));

// Custom metrics
public class OrderMetrics
{
    private readonly Counter<long> _ordersCreated;
    private readonly Histogram<double> _orderProcessingTime;

    public OrderMetrics(IMeterFactory meterFactory)
    {
        var meter = meterFactory.Create("OrderService");

        _ordersCreated = meter.CreateCounter<long>(
            "orders.created",
            description: "Number of orders created");

        _orderProcessingTime = meter.CreateHistogram<double>(
            "orders.processing.duration",
            unit: "ms",
            description: "Order processing duration");
    }

    public void OrderCreated(string region) =>
        _ordersCreated.Add(1, new KeyValuePair<string, object?>("region", region));

    public void RecordProcessingTime(double milliseconds) =>
        _orderProcessingTime.Record(milliseconds);
}
```

## Feature Flags and Progressive Delivery

Controlled rollouts became standard:

```csharp
// Feature flag implementation
public class FeatureFlags
{
    private readonly IFeatureManager _featureManager;

    public FeatureFlags(IFeatureManager featureManager)
    {
        _featureManager = featureManager;
    }

    public async Task<bool> IsEnabledAsync(string feature, string? userId = null)
    {
        var context = new TargetingContext
        {
            UserId = userId,
            Groups = await GetUserGroupsAsync(userId)
        };

        return await _featureManager.IsEnabledAsync(feature, context);
    }
}

// Usage in controller
[ApiController]
public class CheckoutController : ControllerBase
{
    private readonly FeatureFlags _features;

    [HttpPost("checkout")]
    public async Task<IActionResult> Checkout(CheckoutRequest request)
    {
        if (await _features.IsEnabledAsync("new-checkout-flow", request.UserId))
        {
            return await NewCheckoutFlowAsync(request);
        }

        return await LegacyCheckoutAsync(request);
    }
}
```

## ChatOps Integration

Collaboration in chat channels:

```python
# Slack bot for deployments
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

app = App(token=os.environ["SLACK_BOT_TOKEN"])

@app.command("/deploy")
def handle_deploy_command(ack, body, client):
    ack()

    service = body.get("text", "").split()[0]
    environment = body.get("text", "").split()[1] if len(body.get("text", "").split()) > 1 else "staging"
    user = body["user_name"]

    # Verify permissions
    if not can_deploy(user, service, environment):
        client.chat_postMessage(
            channel=body["channel_id"],
            text=f":x: {user} is not authorized to deploy {service} to {environment}"
        )
        return

    # Request approval for production
    if environment == "production":
        client.chat_postMessage(
            channel=body["channel_id"],
            blocks=[
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f":rocket: *Deployment Request*\n{user} wants to deploy `{service}` to `{environment}`"
                    }
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "Approve"},
                            "style": "primary",
                            "action_id": "approve_deploy",
                            "value": f"{service}|{environment}|{user}"
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "Deny"},
                            "style": "danger",
                            "action_id": "deny_deploy",
                            "value": f"{service}|{environment}|{user}"
                        }
                    ]
                }
            ]
        )
    else:
        # Auto-deploy to non-production
        trigger_deployment(service, environment)
        client.chat_postMessage(
            channel=body["channel_id"],
            text=f":white_check_mark: Deployment of `{service}` to `{environment}` started by {user}"
        )
```

## Key Lessons from 2022

```python
devops_lessons = {
    "measure_what_matters": "DORA metrics provide actionable insights",
    "security_is_everyones_job": "Shift-left security is non-negotiable",
    "automate_everything": "Manual processes don't scale",
    "observability_first": "Can't improve what you can't see",
    "progressive_delivery": "Big-bang releases are risky",
    "platform_thinking": "DevOps evolves into platform engineering"
}
```

## Conclusion

DevOps in 2022 moved toward standardization and maturity. The practices that worked are now well-understood; the challenge is consistent implementation. Organizations that invest in these practices see measurable improvements in velocity, quality, and reliability.

## Resources

- [DORA Research](https://www.devops-research.com/)
- [DevOps Handbook](https://itrevolution.com/the-devops-handbook/)
- [Platform Engineering](https://platformengineering.org/)
- [OpenTelemetry](https://opentelemetry.io/)
