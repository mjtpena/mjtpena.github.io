---
title: "Power BI Embed for Organization: Internal Analytics Integration"
author: Michael John Peña
draft: false
date: 2022-04-21
tags:
  - Power BI
  - Embedded Analytics
  - Azure AD
  - Internal Apps
  - Enterprise
---

## When to Use

```yaml
use_cases:
  - Internal portals
  - SharePoint integration
  - Custom line-of-business apps
  - Teams applications

requirements:
  - Users have Power BI Pro or Premium Per User licenses
  - Azure AD authentication
  - Report sharing permissions
```

## Implementation

### Azure AD App Registration

```bash
# Register application
az ad app create \
    --display-name "Internal-PowerBI-App" \
    --reply-urls "https://internalapp.company.com/callback" \
    --available-to-other-tenants false
```

### React with MSAL

```jsx
import { useMsal } from "@azure/msal-react";
import { PowerBIEmbed } from 'powerbi-client-react';
import { models } from 'powerbi-client';

function InternalDashboard() {
    const { instance, accounts } = useMsal();
    const [accessToken, setAccessToken] = useState(null);

    useEffect(() => {
        async function acquireToken() {
            const request = {
                scopes: ["https://analysis.windows.net/powerbi/api/.default"],
                account: accounts[0]
            };

            try {
                const response = await instance.acquireTokenSilent(request);
                setAccessToken(response.accessToken);
            } catch (error) {
                const response = await instance.acquireTokenPopup(request);
                setAccessToken(response.accessToken);
            }
        }

        if (accounts.length > 0) {
            acquireToken();
        }
    }, [instance, accounts]);

    if (!accessToken) return <div>Authenticating...</div>;

    return (
        <PowerBIEmbed
            embedConfig={{
                type: 'report',
                id: 'report-id',
                embedUrl: 'https://app.powerbi.com/reportEmbed?reportId=...',
                accessToken: accessToken,
                tokenType: models.TokenType.Aad,  // AAD token
                settings: {
                    panes: {
                        filters: { expanded: false },
                        pageNavigation: { visible: true }
                    }
                }
            }}
            cssClassName="report-container"
        />
    );
}
```

### Backend Token Acquisition (C#)

```csharp
public class PowerBIService
{
    private readonly IConfidentialClientApplication _app;

    public PowerBIService(IConfiguration config)
    {
        _app = ConfidentialClientApplicationBuilder
            .Create(config["AzureAd:ClientId"])
            .WithClientSecret(config["AzureAd:ClientSecret"])
            .WithAuthority(new Uri($"https://login.microsoftonline.com/{config["AzureAd:TenantId"]}"))
            .Build();
    }

    public async Task<string> GetUserToken(string userAssertion)
    {
        // On-behalf-of flow
        var result = await _app.AcquireTokenOnBehalfOf(
            new[] { "https://analysis.windows.net/powerbi/api/.default" },
            new UserAssertion(userAssertion)
        ).ExecuteAsync();

        return result.AccessToken;
    }
}
```

## SharePoint Integration

```html
<!-- SharePoint Web Part -->
<script src="https://cdn.powerbi.com/libs/powerbi-client/2.19.1/powerbi.min.js"></script>

<div id="embedContainer"></div>

<script>
    // Get SharePoint context token
    async function getToken() {
        const tokenResponse = await fetch('/_api/SP.OAuth.Token/Acquire', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                resource: 'https://analysis.windows.net/powerbi/api'
            })
        });
        return (await tokenResponse.json()).access_token;
    }

    async function embedReport() {
        const token = await getToken();

        const config = {
            type: 'report',
            tokenType: powerbi.models.TokenType.Aad,
            accessToken: token,
            embedUrl: 'https://app.powerbi.com/reportEmbed?reportId=...',
            id: 'report-id'
        };

        powerbi.embed(document.getElementById('embedContainer'), config);
    }

    embedReport();
</script>
```

## Teams Tab Integration

```jsx
import { app, authentication } from "@microsoft/teams-js";
import { PowerBIEmbed } from 'powerbi-client-react';

function TeamsTab() {
    const [token, setToken] = useState(null);

    useEffect(() => {
        app.initialize().then(() => {
            authentication.getAuthToken({
                resources: ["https://analysis.windows.net/powerbi/api"]
            }).then(setToken);
        });
    }, []);

    if (!token) return <div>Loading...</div>;

    return (
        <PowerBIEmbed
            embedConfig={{
                type: 'report',
                accessToken: token,
                tokenType: 1, // AAD
                embedUrl: embedUrl,
                id: reportId
            }}
        />
    );
}
```

## Permission Management

```csharp
// Check user permissions before embedding
public async Task<bool> UserCanAccessReport(string userId, string reportId)
{
    var client = await GetAuthenticatedClient(userId);

    try
    {
        var report = await client.Reports.GetReportAsync(
            Guid.Parse(_workspaceId),
            Guid.Parse(reportId)
        );
        return true;
    }
    catch (HttpOperationException ex) when (ex.Response.StatusCode == HttpStatusCode.Forbidden)
    {
        return false;
    }
}
```

## Best Practices

```yaml
authentication:
  - Use MSAL for token acquisition
  - Implement token caching
  - Handle token refresh gracefully

permissions:
  - Verify user access before embedding
  - Respect Power BI sharing settings
  - Use workspaces for permission management

user_experience:
  - Match app theme with Power BI theme
  - Handle authentication errors gracefully
  - Provide fallback for unlicensed users
```

## Conclusion

Embed for organization leverages existing Power BI investments:
- Seamless Azure AD integration
- Respects organizational security policies
- No additional capacity costs
- Full Power BI feature set

It's ideal for internal applications requiring rich analytics.

## Resources

- [User Owns Data Documentation](https://docs.microsoft.com/en-us/power-bi/developer/embedded/embed-sample-for-your-organization)
- [MSAL.js Documentation](https://docs.microsoft.com/en-us/azure/active-directory/develop/msal-overview)
