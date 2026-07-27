---
title: "Embedding Power BI Reports in Your Applications"
author: Michael John Peña
draft: false
date: 2020-08-03
tags:
  - Power BI
  - Azure
  - Analytics
  - Embedded

---


A client this month wanted dashboards living inside their existing customer portal — "looks like my app, not like Power BI." That's the embedded analytics conversation, and with everyone working from home this year, I'm having it more often than ever. Here's the path I take when standing up Power BI Embedded with the App-Owns-Data pattern, which is the right shape for almost any SaaS scenario.

## Understanding the Options

Power BI offers two embedding scenarios:

1. **Embed for your organization** - Users sign in with their Power BI account
2. **Embed for your customers** - Your app authenticates on behalf of users (App owns data)

For SaaS applications, "Embed for your customers" is typically the right choice.

## Setting Up the Azure Resources

```bash
# Create a Power BI Embedded capacity
az powerbi embedded-capacity create \
    --resource-group rg-analytics \
    --name pbiembedded2020 \
    --location australiaeast \
    --sku-name A1 \
    --sku-tier PBIE_Azure \
    --administration-members "admin@contoso.com"
```

## Registering an Azure AD Application

```bash
# Register the app
az ad app create \
    --display-name "Power BI Embedded App" \
    --reply-urls "https://localhost:5001/signin-oidc"

# Create a client secret
az ad app credential reset \
    --id <app-id> \
    --credential-description "Power BI Secret"
```

## The Backend Service

A small service whose only job is to mint embed tokens. Keep this on the server side — the client secret never goes to the browser:

```csharp
using Microsoft.Identity.Client;
using Microsoft.PowerBI.Api;
using Microsoft.PowerBI.Api.Models;
using Microsoft.Rest;

public class PowerBIService
{
    private readonly string _clientId;
    private readonly string _clientSecret;
    private readonly string _tenantId;
    private readonly string _workspaceId;
    private readonly string _reportId;

    public PowerBIService(IConfiguration config)
    {
        _clientId = config["PowerBI:ClientId"];
        _clientSecret = config["PowerBI:ClientSecret"];
        _tenantId = config["PowerBI:TenantId"];
        _workspaceId = config["PowerBI:WorkspaceId"];
        _reportId = config["PowerBI:ReportId"];
    }

    private async Task<string> GetAccessTokenAsync()
    {
        var app = ConfidentialClientApplicationBuilder
            .Create(_clientId)
            .WithClientSecret(_clientSecret)
            .WithAuthority(new Uri($"https://login.microsoftonline.com/{_tenantId}"))
            .Build();

        var scopes = new[] { "https://analysis.windows.net/powerbi/api/.default" };
        var result = await app.AcquireTokenForClient(scopes).ExecuteAsync();
        return result.AccessToken;
    }

    public async Task<EmbedConfig> GetEmbedConfigAsync()
    {
        var accessToken = await GetAccessTokenAsync();
        var tokenCredentials = new TokenCredentials(accessToken, "Bearer");

        using var client = new PowerBIClient(
            new Uri("https://api.powerbi.com"),
            tokenCredentials);

        var report = await client.Reports.GetReportInGroupAsync(
            Guid.Parse(_workspaceId),
            Guid.Parse(_reportId));

        var generateTokenRequest = new GenerateTokenRequest(
            accessLevel: "View",
            datasetId: report.DatasetId);

        var embedToken = await client.Reports.GenerateTokenInGroupAsync(
            Guid.Parse(_workspaceId),
            Guid.Parse(_reportId),
            generateTokenRequest);

        return new EmbedConfig
        {
            ReportId = _reportId,
            EmbedUrl = report.EmbedUrl,
            EmbedToken = embedToken.Token,
            TokenExpiry = embedToken.Expiration
        };
    }
}

public class EmbedConfig
{
    public string ReportId { get; set; }
    public string EmbedUrl { get; set; }
    public string EmbedToken { get; set; }
    public DateTime? TokenExpiry { get; set; }
}
```

## The API Controller

```csharp
[ApiController]
[Route("api/[controller]")]
public class PowerBIController : ControllerBase
{
    private readonly PowerBIService _powerBIService;

    public PowerBIController(PowerBIService powerBIService)
    {
        _powerBIService = powerBIService;
    }

    [HttpGet("embed-config")]
    public async Task<ActionResult<EmbedConfig>> GetEmbedConfig()
    {
        var config = await _powerBIService.GetEmbedConfigAsync();
        return Ok(config);
    }
}
```

## Frontend Integration

Use the Power BI JavaScript library:

```html
<script src="https://cdn.jsdelivr.net/npm/powerbi-client@2.13.0/dist/powerbi.min.js"></script>

<div id="reportContainer" style="height: 600px;"></div>

<script>
async function embedReport() {
    const response = await fetch('/api/powerbi/embed-config');
    const config = await response.json();

    const embedConfiguration = {
        type: 'report',
        id: config.reportId,
        embedUrl: config.embedUrl,
        accessToken: config.embedToken,
        tokenType: models.TokenType.Embed,
        settings: {
            panes: {
                filters: { visible: false },
                pageNavigation: { visible: true }
            }
        }
    };

    const reportContainer = document.getElementById('reportContainer');
    const report = powerbi.embed(reportContainer, embedConfiguration);

    report.on('loaded', function() {
        console.log('Report loaded');
    });

    report.on('error', function(event) {
        console.error(event.detail);
    });
}

embedReport();
</script>
```

## Row-Level Security

For multi-tenant applications, implement RLS:

```csharp
var generateTokenRequest = new GenerateTokenRequest(
    accessLevel: "View",
    identities: new List<EffectiveIdentity>
    {
        new EffectiveIdentity(
            username: currentUser.Email,
            roles: new List<string> { "TenantRole" },
            datasets: new List<string> { report.DatasetId })
    });
```

## Cost Considerations

Embedded is capacity-based, which is a different mental model from per-user licensing. A few rules I share with clients:

- **A1 is the smallest reservation and it is genuinely small.** Fine for an internal pilot, not for hundreds of concurrent users.
- **Pause when you don't need it.** A capacity is billed when running. For dev/test, scripted pause/resume saves real money.
- **Dataset refresh time eats capacity too**, not just rendering. A handful of expensive nightly refreshes can starve daytime user requests on a small SKU.
- **Premium Per User (PPU)** is the cheapest way to develop and test embedded scenarios without committing to a capacity.

The thing I keep telling clients about embedded analytics: the technical embed is the easy part. The hard part is the data model and row-level security underneath it. Get that right and the rest is wiring.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n

