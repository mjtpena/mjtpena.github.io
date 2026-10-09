---
title: "Power BI Embedded: Analytics in Your Applications"
author: Michael John Peña
draft: false
date: 2022-04-19
tags:
  - Power BI
  - Embedded Analytics
  - Data Visualization
  - Azure
  - Development
---

## Embedding Options

```yaml
embed_for_customers:
  description: External users access embedded content
  licensing: App owns data (capacity-based)
  authentication: Your app authenticates
  use_case: Customer-facing portals

embed_for_organization:
  description: Internal users with Power BI licenses
  licensing: User owns data (per-user)
  authentication: Azure AD
  use_case: Internal applications
```

## Setting Up Embedded Analytics

### Register Azure AD Application

```bash
# Create app registration
az ad app create \
    --display-name "PowerBI-Embedded-App" \
    --reply-urls "https://myapp.com/callback" \
    --required-resource-accesses @manifest.json
```

```json
// manifest.json - Required permissions
{
    "resourceAppId": "00000009-0000-0000-c000-000000000000",
    "resourceAccess": [
        {
            "id": "4ae1bf56-f562-4747-b7bc-2fa0874ed46f",
            "type": "Scope"
        },
        {
            "id": "7f33e027-4039-419b-938e-2f8ca153e68e",
            "type": "Scope"
        }
    ]
}
```

### Create Embedded Capacity

```bash
# Create Power BI Embedded capacity
az powerbi embedded-capacity create \
    --resource-group analytics-rg \
    --name myembeddedcapacity \
    --location eastus \
    --sku-name A2 \
    --sku-tier PBIE_Azure \
    --administration-members "admin@company.com"
```

## Embedding Reports

### JavaScript SDK

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://cdn.powerbi.com/libs/powerbi-client/2.19.1/powerbi.min.js"></script>
</head>
<body>
    <div id="reportContainer" style="height: 600px;"></div>

    <script>
        // Get embed token from your backend
        async function embedReport() {
            const response = await fetch('/api/embed-token');
            const embedConfig = await response.json();

            const reportContainer = document.getElementById('reportContainer');

            const report = powerbi.embed(reportContainer, {
                type: 'report',
                id: embedConfig.reportId,
                embedUrl: embedConfig.embedUrl,
                accessToken: embedConfig.token,
                tokenType: 1,  // Embed token
                settings: {
                    filterPaneEnabled: false,
                    navContentPaneEnabled: false,
                    background: models.BackgroundType.Transparent
                }
            });

            report.on('loaded', function() {
                console.log('Report loaded');
            });

            report.on('error', function(event) {
                console.error('Error:', event.detail);
            });
        }

        embedReport();
    </script>
</body>
</html>
```

### Backend Token Generation (C#)

```csharp
using Microsoft.PowerBI.Api;
using Microsoft.PowerBI.Api.Models;
using Microsoft.Rest;

public class PowerBIEmbedService
{
    private readonly string _workspaceId;
    private readonly string _reportId;
    private readonly PowerBIClient _client;

    public PowerBIEmbedService(IConfiguration config)
    {
        _workspaceId = config["PowerBI:WorkspaceId"];
        _reportId = config["PowerBI:ReportId"];

        var credential = new ClientCredential(
            config["AzureAd:ClientId"],
            config["AzureAd:ClientSecret"]
        );

        var authResult = await AuthenticationContext
            .AcquireTokenAsync("https://analysis.windows.net/powerbi/api", credential);

        _client = new PowerBIClient(
            new Uri("https://api.powerbi.com"),
            new TokenCredentials(authResult.AccessToken)
        );
    }

    public async Task<EmbedConfig> GetEmbedConfig(string username, string[] roles = null)
    {
        var report = await _client.Reports.GetReportInGroupAsync(
            Guid.Parse(_workspaceId),
            Guid.Parse(_reportId)
        );

        var generateTokenRequest = new GenerateTokenRequestV2
        {
            Reports = new List<GenerateTokenRequestV2Report>
            {
                new GenerateTokenRequestV2Report(Guid.Parse(_reportId))
            },
            Datasets = new List<GenerateTokenRequestV2Dataset>
            {
                new GenerateTokenRequestV2Dataset(report.DatasetId)
            }
        };

        // Apply RLS if roles specified
        if (roles != null && roles.Length > 0)
        {
            generateTokenRequest.Identities = new List<EffectiveIdentity>
            {
                new EffectiveIdentity(
                    username,
                    datasets: new List<string> { report.DatasetId },
                    roles: roles.ToList()
                )
            };
        }

        var embedToken = await _client.EmbedToken.GenerateTokenAsync(generateTokenRequest);

        return new EmbedConfig
        {
            ReportId = report.Id.ToString(),
            EmbedUrl = report.EmbedUrl,
            Token = embedToken.Token,
            TokenExpiry = embedToken.Expiration
        };
    }
}
```

## Interactive Features

### Filtering Reports

```javascript
// Apply filters programmatically
const filter = {
    $schema: "http://powerbi.com/product/schema#basic",
    target: {
        table: "Sales",
        column: "Region"
    },
    operator: "In",
    values: ["North", "South"]
};

report.setFilters([filter]);

// Date range filter
const dateFilter = {
    $schema: "http://powerbi.com/product/schema#advanced",
    target: {
        table: "Sales",
        column: "Date"
    },
    logicalOperator: "And",
    conditions: [
        { operator: "GreaterThanOrEqual", value: "2022-01-01" },
        { operator: "LessThan", value: "2022-04-01" }
    ]
};

report.setFilters([dateFilter]);
```

### Handling Events

```javascript
// Selection event
report.on('dataSelected', function(event) {
    const data = event.detail;
    console.log('Selected data:', data.dataPoints);

    // Navigate to detail page
    if (data.dataPoints.length > 0) {
        const customerId = data.dataPoints[0].identity[0].equals;
        window.location.href = `/customer/${customerId}`;
    }
});

// Page change event
report.on('pageChanged', function(event) {
    console.log('New page:', event.detail.newPage.displayName);
});

// Button click event (for bookmarks)
report.on('buttonClicked', function(event) {
    console.log('Button clicked:', event.detail);
});
```

## Row-Level Security

### Define Roles in Power BI

```dax
// In Power BI Desktop, create role "RegionalManager"
[Region] = USERNAME() OR [ManagerEmail] = USERPRINCIPALNAME()
```

### Apply RLS in Embed Token

```csharp
var identity = new EffectiveIdentity(
    username: "user@company.com",
    datasets: new List<string> { datasetId },
    roles: new List<string> { "RegionalManager" }
);

// For dynamic RLS
var identity = new EffectiveIdentity(
    username: userEmail,
    datasets: new List<string> { datasetId },
    roles: new List<string> { "SalesRep" },
    customData: region  // Pass custom data for RLS filter
);
```

## Performance Optimization

```javascript
// Pre-load reports
powerbi.preload({
    type: 'report',
    embedUrl: embedUrl
});

// Use bootstrap for faster initial load
const config = {
    type: 'report',
    embedUrl: embedUrl,
    settings: {
        background: models.BackgroundType.Transparent
    }
};

const report = powerbi.bootstrap(container, config);

// Later, apply token when available
report.setAccessToken(accessToken);
```

## Best Practices

```yaml
performance:
  - Use Premium/Embedded capacity
  - Pre-load reports when possible
  - Minimize visual count per page
  - Use aggregations for large datasets

security:
  - Always use embed tokens (not AAD tokens for external)
  - Implement RLS for data security
  - Set short token expiry
  - Validate user permissions server-side

user_experience:
  - Handle loading states
  - Provide error feedback
  - Enable mobile layout for responsive
  - Consider white-labeling options
```

## Conclusion

Power BI Embedded enables rich analytics in any application:
- Interactive reports and dashboards
- Secure multi-tenant access
- Programmatic control and customization
- Scalable capacity-based pricing

It's the foundation for analytics-powered applications.

## Resources

- [Power BI Embedded Documentation](https://docs.microsoft.com/en-us/power-bi/developer/embedded/)
- [JavaScript SDK](https://github.com/microsoft/PowerBI-JavaScript)
- [Embedding Setup Tool](https://app.powerbi.com/embedsetup)
