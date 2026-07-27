---
title: "Power BI Embedded: Analytics in Your Applications"
author: Michael John Peña
draft: false
date: 2020-11-23
tags:
  - Power BI
  - Embedded Analytics
  - Data Visualization
  - SaaS

---


"Can my customers get the dashboard inside my product?" is one of the most common questions I get from product teams once Power BI lands internally. Power BI Embedded is the answer for ISV-style scenarios: you license capacity, the end users don't need a Power BI licence, and reports render inside your application with row-level security and your own theme. The pricing model is the part most teams underestimate—plan capacity carefully.

## Embedding Scenarios

| Scenario | Authentication | Use Case |
|----------|---------------|----------|
| App Owns Data | Service Principal | SaaS multi-tenant |
| User Owns Data | Azure AD | Internal apps |

## Creating Embedded Capacity

```bash
# Create Power BI Embedded capacity
az powerbi embedded-capacity create \
    --name myembedded \
    --resource-group myRG \
    --location eastus \
    --sku-name A1 \
    --administrators admin@company.com
```

## App Owns Data Setup

### Register Azure AD Application

```bash
# Register app
az ad app create \
    --display-name "PowerBI-Embed-App" \
    --sign-in-audience AzureADMyOrg

# Create service principal
az ad sp create --id <app-id>

# Add to Power BI Admin (Azure Portal)
```

### Authenticate and Get Token

```csharp
public async Task<string> GetPowerBIToken()
{
    var app = ConfidentialClientApplicationBuilder
        .Create(_config["AzureAd:ClientId"])
        .WithClientSecret(_config["AzureAd:ClientSecret"])
        .WithAuthority($"https://login.microsoftonline.com/{_config["AzureAd:TenantId"]}")
        .Build();

    var scopes = new[] { "https://analysis.windows.net/powerbi/api/.default" };
    var result = await app.AcquireTokenForClient(scopes).ExecuteAsync();

    return result.AccessToken;
}
```

### Get Embed Config

```csharp
public async Task<EmbedConfig> GetEmbedConfig(Guid workspaceId, Guid reportId)
{
    var token = await GetPowerBIToken();
    var client = new PowerBIClient(new TokenCredentials(token));

    // Get report
    var report = await client.Reports.GetReportInGroupAsync(workspaceId, reportId);

    // Generate embed token
    var generateTokenRequest = new GenerateTokenRequest(
        accessLevel: "View",
        allowSaveAs: false
    );
    var embedToken = await client.Reports.GenerateTokenInGroupAsync(
        workspaceId, reportId, generateTokenRequest);

    return new EmbedConfig
    {
        EmbedUrl = report.EmbedUrl,
        EmbedToken = embedToken.Token,
        ReportId = reportId,
        TokenExpiry = embedToken.Expiration
    };
}
```

## JavaScript Embedding

```html
<div id="reportContainer" style="height: 600px;"></div>

<script src="https://cdn.jsdelivr.net/npm/powerbi-client@2.18.0/dist/powerbi.min.js"></script>
<script>
    async function embedReport() {
        const config = await fetch('/api/embed-config').then(r => r.json());

        const embedConfig = {
            type: 'report',
            id: config.reportId,
            embedUrl: config.embedUrl,
            accessToken: config.embedToken,
            tokenType: pbi.models.TokenType.Embed,
            settings: {
                panes: {
                    filters: { visible: false },
                    pageNavigation: { visible: true }
                },
                background: pbi.models.BackgroundType.Transparent
            }
        };

        const reportContainer = document.getElementById('reportContainer');
        const powerbi = new pbi.service.Service(
            pbi.factories.hpmFactory,
            pbi.factories.wpmpFactory,
            pbi.factories.routerFactory
        );

        const report = powerbi.embed(reportContainer, embedConfig);

        report.on('loaded', function() {
            console.log('Report loaded');
        });

        report.on('error', function(event) {
            console.error('Error:', event.detail);
        });
    }

    embedReport();
</script>
```

## Row-Level Security

```csharp
// Generate token with RLS
var generateTokenRequest = new GenerateTokenRequest(
    accessLevel: "View",
    identities: new List<EffectiveIdentity>
    {
        new EffectiveIdentity(
            username: user.Email,
            roles: new List<string> { "SalesRegion" },
            datasets: new List<string> { datasetId.ToString() }
        )
    }
);
```

## Multi-Tenant Architecture

```
┌────────────────────────────────────────────┐
│           Your SaaS Application            │
└───────────────────┬────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
   ┌────┴────┐            ┌────┴────┐
   │Tenant A │            │Tenant B │
   │Workspace│            │Workspace│
   │Reports  │            │Reports  │
   │Dataset  │            │Dataset  │
   └─────────┘            └─────────┘
```

## Capacity SKUs

| SKU | vCores | RAM | Cost/hr |
|-----|--------|-----|---------|
| A1 | 1 | 3 GB | ~$1.00 |
| A2 | 2 | 5 GB | ~$2.00 |
| A3 | 4 | 10 GB | ~$4.00 |
| A4 | 8 | 25 GB | ~$8.00 |

Power BI Embedded: branded analytics at scale.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n

