---
title: "Power BI Embedded for Customers: App-Owns-Data with a Service Principal"
description: "How to embed Power BI reports in a customer-facing app with a service principal, embed tokens, row-level security and a right-sized A SKU capacity."
author: Michael John Peña
draft: false
date: 2020-08-03
tags:
  - Power BI
  - Embedded Analytics
  - Azure
  - C#
  - Security
---

A client this month wanted dashboards inside their existing customer portal, with the brief "looks like my app, not like Power BI." Remote work this year has made that request routine: customers expect reporting inside the product they already log in to, not another portal with another password. Power BI Embedded handles this well, but only if you choose the right embedding model, identity and capacity at the start. Changing any of the three later is expensive.

## Pick the embedding model first

Power BI has two embedding scenarios, and they are not interchangeable:

| | Embed for your organisation (user owns data) | Embed for your customers (app owns data) |
|---|---|---|
| Who signs in to Power BI | Each end user, with their own Azure AD account | Your application, on the users' behalf |
| End-user licence | Power BI Pro (or content on Premium) | None. Users never touch Power BI |
| Token sent to the browser | Azure AD access token | Embed token, scoped to specific reports |
| Security boundary | Power BI permissions and RLS on the user's identity | Your app's auth plus RLS on an *effective identity* you pass in |
| Typical fit | Intranets, SharePoint, internal line-of-business apps | SaaS products, customer portals, ISVs |

If your users are external customers who don't (and shouldn't) have Power BI accounts, you want **embed for your customers**. That's the scenario this post covers. Microsoft's [embed for your customers tutorial](https://learn.microsoft.com/power-bi/developer/embedded/embed-sample-for-customers) walks through the same flow with its sample app.

The mistake I see most often is treating "app owns data" as "the app owns security". Your application authenticates the user, but Power BI only enforces what you put in the embed token. If a shared dataset has no RLS roles, a token generated without an effective identity shows every customer every other customer's numbers. Once roles exist, Power BI refuses to issue a token without one, which is the behaviour you want. More on that below.

## Use a service principal, not a master user

For app-owns-data there are two ways your backend can authenticate to Power BI:

- **Master user:** a real Azure AD account with a Pro licence, signed in with username and password. It works, but you're storing a person's password, it trips over MFA and Conditional Access, and it breaks when someone changes the password.
- **Service principal:** an Azure AD app registration that authenticates with a client secret or certificate. No password, no licence, no MFA headaches.

I default to the service principal. Its constraints are worth knowing up front, and they're documented in [Embed Power BI content with service principal](https://learn.microsoft.com/power-bi/developer/embedded/embed-service-principal):

1. A Power BI admin must turn on **Allow service principals to use Power BI APIs** under the tenant's developer settings. Scope it to a security group that contains your app's service principal, not the whole organisation. Make sure **Embed content in apps** is enabled too.
2. The service principal only works with the **new workspace experience**. It can't reach classic workspaces or anyone's "My workspace".
3. Add the service principal to the workspace as a Member or Admin.
4. You don't need to grant Power BI API permissions on the app registration in Azure AD. Access comes from workspace membership.

Create the app registration and its service principal with the Azure CLI:

```bash
# Register the application and capture its appId
APP_ID=$(az ad app create \
    --display-name "<your-app-name>-powerbi-embed" \
    --query appId --output tsv)

# Create the service principal for the application
az ad sp create --id "$APP_ID"

# Add a client secret (store the returned password in Key Vault, not in source control)
az ad app credential reset \
    --id "$APP_ID" \
    --append \
    --credential-description "pbi-embed"
```

Secrets expire (`az ad app credential reset` defaults to one year), so put rotation in your runbook, or use a certificate (`--cert`) and load it from Key Vault.

Then add the security group to the tenant setting and the service principal to the workspace through the Power BI portal.

## Provision and size the capacity

Embed tokens for production need the workspace to sit on dedicated capacity. Without capacity you get a limited number of free trial tokens, which is enough for development and nothing else. For customer-facing embedding the usual choice is an Azure **A SKU**, billed by the hour with no commitment.

A SKUs are bought in Azure, can be paused, and only serve embedded content. EM and P SKUs are bought in the Microsoft 365 admin center on a monthly or annual commitment. EM suits embedding into Microsoft apps such as SharePoint and Teams, and P is the better fit when the same capacity also has to serve your own staff in the Power BI service, because P lets users with free licences view content there.

| SKU | v-cores | Memory |
|---|---|---|
| A1 | 1 | 3 GB |
| A2 | 2 | 5 GB |
| A3 | 4 | 10 GB |
| A4 | 8 | 25 GB |
| A5 | 16 | 50 GB |
| A6 | 32 | 100 GB |

A4 has the same resources as a Premium P1. [Capacity and SKUs in Power BI embedded analytics](https://learn.microsoft.com/power-bi/developer/embedded/embedded-capacity) has the details. I create capacities with the Az.PowerBIEmbedded PowerShell module:

```powershell
# Requires the Az.PowerBIEmbedded module: Install-Module Az.PowerBIEmbedded
New-AzPowerBIEmbeddedCapacity `
    -ResourceGroupName "<your-resource-group>" `
    -Name "<yourcapacityname>" `
    -Location "australiaeast" `
    -Sku "A1" `
    -Administrator "<admin@your-tenant.onmicrosoft.com>"

# Pause it outside working hours in dev/test, resume when needed
Suspend-AzPowerBIEmbeddedCapacity -ResourceGroupName "<your-resource-group>" -Name "<yourcapacityname>"
Resume-AzPowerBIEmbeddedCapacity -ResourceGroupName "<your-resource-group>" -Name "<yourcapacityname>"
```

Capacity names must be lowercase letters and numbers only. Once it's running, assign the workspace to the capacity in the workspace settings.

## The backend: mint embed tokens server-side

The backend has one job: authenticate as the service principal, look up the report, and return an embed token scoped to that report and to the current customer. The client secret and the Azure AD access token never leave the server. The browser only gets the embed token.

This uses MSAL.NET (`Microsoft.Identity.Client` 4.x) and the v3 Power BI .NET SDK (`Microsoft.PowerBI.Api` 3.14.0, the current release). Version 3 changed workspace and report IDs to `Guid` and the access level to the `TokenAccessLevel` enum, so v2 samples won't compile against it unchanged.

```csharp
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Identity.Client;
using Microsoft.PowerBI.Api;
using Microsoft.PowerBI.Api.Models;
using Microsoft.Rest;

public class EmbedConfig
{
    public string ReportId { get; set; }
    public string EmbedUrl { get; set; }
    public string EmbedToken { get; set; }
    public DateTime? TokenExpiry { get; set; }
}

public class PowerBIEmbedService
{
    private static readonly string[] Scopes = { "https://analysis.windows.net/powerbi/api/.default" };

    private readonly IConfidentialClientApplication _msalClient;
    private readonly Guid _workspaceId;
    private readonly Guid _reportId;

    public PowerBIEmbedService(IConfiguration config)
    {
        // Build once and reuse: MSAL caches the app token in memory
        _msalClient = ConfidentialClientApplicationBuilder
            .Create(config["PowerBI:ClientId"])
            .WithClientSecret(config["PowerBI:ClientSecret"])
            .WithAuthority($"https://login.microsoftonline.com/{config["PowerBI:TenantId"]}")
            .Build();

        _workspaceId = Guid.Parse(config["PowerBI:WorkspaceId"]);
        _reportId = Guid.Parse(config["PowerBI:ReportId"]);
    }

    public async Task<EmbedConfig> GetEmbedConfigAsync(string customerTenantKey)
    {
        var authResult = await _msalClient.AcquireTokenForClient(Scopes).ExecuteAsync();
        var credentials = new TokenCredentials(authResult.AccessToken, "Bearer");

        using var client = new PowerBIClient(new Uri("https://api.powerbi.com"), credentials);

        Report report = await client.Reports.GetReportInGroupAsync(_workspaceId, _reportId);

        // The effective identity is what RLS filters on. Never omit it for a multi-tenant dataset.
        var identity = new EffectiveIdentity(
            username: customerTenantKey,
            datasets: new List<string> { report.DatasetId },
            roles: new List<string> { "CustomerTenant" });

        var tokenRequest = new GenerateTokenRequest(
            accessLevel: TokenAccessLevel.View,
            identities: new List<EffectiveIdentity> { identity });

        EmbedToken embedToken = await client.Reports.GenerateTokenInGroupAsync(
            _workspaceId, _reportId, tokenRequest);

        return new EmbedConfig
        {
            ReportId = report.Id.ToString(),
            EmbedUrl = report.EmbedUrl,
            EmbedToken = embedToken.Token,
            TokenExpiry = embedToken.Expiration
        };
    }
}
```

The controller derives the customer key from the signed-in user's claims, never from a query string:

```csharp
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class PowerBIController : ControllerBase
{
    private readonly PowerBIEmbedService _embedService;

    public PowerBIController(PowerBIEmbedService embedService)
    {
        _embedService = embedService;
    }

    [HttpGet("embed-config")]
    public async Task<ActionResult<EmbedConfig>> GetEmbedConfig()
    {
        // "tenant_key" is whatever claim your own identity provider issues for the customer
        var tenantKey = User.FindFirst("tenant_key")?.Value;
        if (string.IsNullOrEmpty(tenantKey))
        {
            return Forbid();
        }

        return Ok(await _embedService.GetEmbedConfigAsync(tenantKey));
    }
}
```

Register `PowerBIEmbedService` as a singleton so the MSAL client and its token cache live for the life of the app. This fragment goes in `Startup.ConfigureServices`:

```csharp
services.AddSingleton<PowerBIEmbedService>();
```

Each page load costs one `GenerateToken` round trip, and the Power BI REST API throttles callers that hammer it. If many users share a tenant key, cache the embed token per tenant key and reuse it until a few minutes before it expires. An embed token can't outlive the Azure AD token used to create it (about an hour), and it carries the effective identity, so cache strictly per tenant key and never across tenants. Leave `datasetId` off the token request for a View token: that parameter only matters when you're issuing a token to create a report, and the dataset is already scoped through the effective identity.

## Row-level security is the real security boundary

In the Power BI Desktop model, create a role called `CustomerTenant` on the table that holds the tenant key, with a DAX filter like:

```dax
[TenantKey] = USERNAME()
```

With an embed token, `USERNAME()` returns whatever you passed as the effective identity's `username`. For import and DirectQuery datasets the username is just a string that `USERNAME()` returns, so a tenant key works and keeps customer email addresses out of the token. Live connections to Analysis Services are the exception: there it has to be a user the server recognises. The [RLS for embedded content docs](https://learn.microsoft.com/power-bi/developer/embedded/embedded-row-level-security) cover the rules, including that once a dataset has roles defined, the token request has to include an identity.

My rule of thumb: put the tenant key on a small dimension table and let relationships carry the filter to the facts. One filter in one place is easy to test. A filter on every fact table becomes a gap the first time someone adds a table and forgets it.

## The frontend

The browser loads the `powerbi-client` JavaScript library, asks your API for the embed configuration, and embeds the report. Using the UMD build from a CDN, the models live on `window['powerbi-client']`:

```html
<script src="https://cdn.jsdelivr.net/npm/powerbi-client@2.14.0/dist/powerbi.min.js"></script>

<div id="reportContainer" style="height: 600px;"></div>

<script>
  const models = window['powerbi-client'].models;
  let report;

  async function fetchEmbedConfig() {
    const response = await fetch('/api/powerbi/embed-config', { credentials: 'same-origin' });
    if (!response.ok) {
      const err = new Error('Embed config request failed: ' + response.status);
      err.status = response.status;
      throw err;
    }
    return response.json();
  }

  function scheduleTokenRefresh(expiry) {
    // Refresh two minutes before the embed token expires
    const msUntilRefresh = new Date(expiry).getTime() - Date.now() - 2 * 60 * 1000;
    setTimeout(async () => {
      try {
        const config = await fetchEmbedConfig();
        await report.setAccessToken(config.embedToken);
        scheduleTokenRefresh(config.tokenExpiry);
      } catch (err) {
        if (err.status === 401 || err.status === 403) {
          // The app session has expired: retrying won't help, so send the user back through sign-in
          window.location.reload();
          return;
        }
        // Transient failure (network, 5xx): log it and retry in 30 seconds rather than stopping silently
        console.error('Token refresh failed', err);
        setTimeout(() => scheduleTokenRefresh(expiry), 30 * 1000);
      }
    }, Math.max(msUntilRefresh, 0));
  }

  async function embedReport() {
    const config = await fetchEmbedConfig();

    report = powerbi.embed(document.getElementById('reportContainer'), {
      type: 'report',
      id: config.reportId,
      embedUrl: config.embedUrl,
      accessToken: config.embedToken,
      tokenType: models.TokenType.Embed,
      permissions: models.Permissions.Read,
      settings: {
        filterPaneEnabled: false,
        navContentPaneEnabled: true
      }
    });

    report.on('loaded', () => scheduleTokenRefresh(config.tokenExpiry));
    report.on('error', (event) => console.error(event.detail));
  }

  embedReport();
</script>
```

Embed tokens are short-lived, so a dashboard left open over lunch will stop working unless you refresh the token. `setAccessToken` swaps it in without reloading the report.

## Cost and capacity traps

Capacity billing is a different mental model from per-user licensing, and it's where most embedded projects get surprised:

- **A1 is small.** One v-core and 3 GB of memory is fine for a pilot, not for hundreds of concurrent users or a large import model. Load test with realistic reports before you commit to a SKU.
- **Refreshes and queries share the same v-cores.** A heavy nightly refresh on a small SKU can starve daytime report rendering, and memory pressure evicts datasets. Schedule refreshes for quiet hours and keep models lean.
- **Pause dev and test capacities.** A SKUs bill hourly while running. A scheduled suspend and resume (an Azure Automation runbook is enough) cuts the bill in proportion to the hours saved: an A1 running only 10 hours a weekday runs 50 of the week's 168 hours, so it costs under a third of one left on 24/7.
- **Scale up or down without redeploying.** Changing the SKU on an A capacity is an Azure operation, so you can scale up for a month-end reporting peak and back down afterwards.

## When not to use this

App-owns-data is the wrong choice when your users are your own staff who already have Power BI Pro licences. Embed for your organisation keeps their identity end to end and saves you building token plumbing. It's also overkill if customers only need a few static numbers. A chart library on top of your own API will be cheaper and faster than a capacity running around the clock.

When you do need customer-facing analytics, decide three things on day one: service principal over master user, RLS on an effective identity for every token, and a capacity size you've load tested. The embed code is the easy part. The data model and the security model underneath it decide whether the project works.
