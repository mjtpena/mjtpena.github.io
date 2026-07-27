---
title: "Power BI Embed for Customers: Building Analytics Portals"
author: Michael John Peña
draft: false
date: 2022-04-20
tags:
  - Power BI
  - Embedded Analytics
  - SaaS
  - Multi-tenant
  - Development

---

I wrote "Power BI Embed for Customers: Building Analytics Portals" to share practical, production-minded guidance on this topic.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Your Application                       │
│                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │   Frontend  │    │   Backend   │    │  Power BI   │ │
│  │  (React/    │◄──►│   (API)     │◄──►│   Service   │ │
│  │   Angular)  │    │             │    │             │ │
│  └─────────────┘    └─────────────┘    └─────────────┘ │
│         │                  │                  │         │
│         │                  │                  │         │
│         ▼                  ▼                  ▼         │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Embedded Capacity (A1-A6)          │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Service Principal Setup

```bash
# Create service principal
az ad sp create-for-rbac \
    --name "PowerBI-Embed-SP" \
    --role "Contributor" \
    --scopes "/subscriptions/{subscription-id}"

# Grant Power BI permissions
# In Azure Portal > Azure AD > App registrations > API permissions
# Add: Power BI Service - All permissions
```

### Workspace Configuration

```csharp
// Add service principal to workspace as Admin
using Microsoft.PowerBI.Api;

public async Task ConfigureWorkspace(string workspaceId, string servicePrincipalId)
{
    var groupUser = new GroupUser
    {
        Identifier = servicePrincipalId,
        PrincipalType = PrincipalType.App,
        GroupUserAccessRight = GroupUserAccessRight.Admin
    };

    await _client.Groups.AddGroupUserAsync(
        Guid.Parse(workspaceId),
        groupUser
    );
}
```

## Multi-Tenant Implementation

### Per-Customer Workspaces

```csharp
public class MultiTenantEmbedService
{
    private readonly PowerBIClient _client;

    public async Task<string> ProvisionTenantWorkspace(string tenantId, string tenantName)
    {
        // Create workspace for tenant
        var workspace = await _client.Groups.CreateGroupAsync(
            new GroupCreationRequest
            {
                Name = $"Customer-{tenantId}-{tenantName}"
            }
        );

        // Clone template reports
        await CloneTemplateReports(workspace.Id, tenantId);

        // Set up dataset with tenant connection
        await ConfigureTenantDataset(workspace.Id, tenantId);

        return workspace.Id.ToString();
    }

    private async Task CloneTemplateReports(Guid workspaceId, string tenantId)
    {
        var templateWorkspaceId = _config["PowerBI:TemplateWorkspaceId"];
        var templates = await _client.Reports.GetReportsInGroupAsync(
            Guid.Parse(templateWorkspaceId)
        );

        foreach (var template in templates.Value)
        {
            await _client.Reports.CloneReportInGroupAsync(
                Guid.Parse(templateWorkspaceId),
                template.Id,
                new CloneReportRequest
                {
                    Name = template.Name,
                    TargetWorkspaceId = workspaceId
                }
            );
        }
    }
}
```

### Row-Level Security Approach

```csharp
public async Task<EmbedConfig> GetTenantEmbedConfig(string tenantId, string userId)
{
    var report = await GetReportForTenant(tenantId);

    var tokenRequest = new GenerateTokenRequestV2
    {
        Reports = new List<GenerateTokenRequestV2Report>
        {
            new GenerateTokenRequestV2Report(report.Id)
        },
        Datasets = new List<GenerateTokenRequestV2Dataset>
        {
            new GenerateTokenRequestV2Dataset(report.DatasetId)
        },
        Identities = new List<EffectiveIdentity>
        {
            new EffectiveIdentity(
                username: userId,
                datasets: new List<string> { report.DatasetId },
                roles: new List<string> { "TenantFilter" },
                customData: tenantId  // Pass tenant ID for RLS
            )
        }
    };

    var token = await _client.EmbedToken.GenerateTokenAsync(tokenRequest);

    return new EmbedConfig
    {
        ReportId = report.Id.ToString(),
        EmbedUrl = report.EmbedUrl,
        Token = token.Token,
        Expiration = token.Expiration
    };
}
```

### RLS DAX Expression

```dax
// In Power BI Desktop, define RLS role "TenantFilter"
[TenantId] = CUSTOMDATA()

// Or for multiple conditions
[TenantId] = CUSTOMDATA()
OR
[IsPublic] = TRUE
```

## Token Management

```csharp
public class TokenManager
{
    private readonly IMemoryCache _cache;
    private readonly IEmbedService _embedService;

    public async Task<string> GetOrRefreshToken(string cacheKey, Func<Task<EmbedToken>> generateToken)
    {
        if (_cache.TryGetValue(cacheKey, out TokenCacheEntry cached))
        {
            // Return cached if not expiring soon
            if (cached.Expiration > DateTime.UtcNow.AddMinutes(5))
            {
                return cached.Token;
            }
        }

        // Generate new token
        var newToken = await generateToken();

        _cache.Set(cacheKey, new TokenCacheEntry
        {
            Token = newToken.Token,
            Expiration = newToken.Expiration.Value
        }, newToken.Expiration.Value - DateTime.UtcNow);

        return newToken.Token;
    }
}
```

## Frontend Integration (React)

```jsx
import { PowerBIEmbed } from 'powerbi-client-react';
import { models } from 'powerbi-client';

function CustomerDashboard({ tenantId }) {
    const [embedConfig, setEmbedConfig] = useState(null);

    useEffect(() => {
        async function loadConfig() {
            const response = await fetch(`/api/embed/${tenantId}`);
            const config = await response.json();
            setEmbedConfig(config);
        }
        loadConfig();
    }, [tenantId]);

    if (!embedConfig) return <div>Loading...</div>;

    return (
        <PowerBIEmbed
            embedConfig={{
                type: 'report',
                id: embedConfig.reportId,
                embedUrl: embedConfig.embedUrl,
                accessToken: embedConfig.token,
                tokenType: models.TokenType.Embed,
                settings: {
                    panes: {
                        filters: { visible: false },
                        pageNavigation: { visible: true }
                    },
                    background: models.BackgroundType.Transparent
                }
            }}
            cssClassName="report-container"
            getEmbeddedComponent={(report) => {
                // Store report reference for interactions
                window.currentReport = report;
            }}
        />
    );
}
```

## Capacity Planning

```yaml
capacity_tiers:
  A1:
    cores: 1
    memory: 3GB
    max_concurrent_users: ~50
    cost: ~$1/hour

  A2:
    cores: 2
    memory: 5GB
    max_concurrent_users: ~100
    cost: ~$2/hour

  A4:
    cores: 8
    memory: 25GB
    max_concurrent_users: ~400
    cost: ~$8/hour

considerations:
  - Scale based on concurrent users
  - Consider auto-pause for cost savings
  - Monitor capacity metrics
  - Plan for peak usage
```

## Best Practices

```yaml
security:
  - Never expose service principal credentials to frontend
  - Use short-lived embed tokens (1 hour max)
  - Implement RLS for data isolation
  - Validate tenant access server-side

performance:
  - Cache embed tokens appropriately
  - Use Premium/Embedded for better performance
  - Optimize report design for embedding
  - Implement lazy loading

scalability:
  - Design for multi-tenancy from start
  - Use parameterized datasets where possible
  - Consider workspace per tenant for isolation
  - Monitor and scale capacity proactively
```

## Conclusion

Embed for customers enables powerful analytics in customer-facing applications:
- No Power BI licenses required for end users
- Complete control over user experience
- Secure multi-tenant data access
- Scalable capacity-based pricing

## Resources

- [Embed for Customers Tutorial](https://docs.microsoft.com/en-us/power-bi/developer/embedded/embed-sample-for-customers)
- [Service Principal Configuration](https://docs.microsoft.com/en-us/power-bi/developer/embedded/embed-service-principal)
- [Capacity Planning](https://docs.microsoft.com/en-us/power-bi/developer/embedded/embedded-capacity-planning)

