---
title: "Certificate-Less Authentication: Simplifying Service Identity"
author: Michael John Peña
draft: false
date: 2022-02-15
url: /blog/certificate-less-authentication/
tags:
  - azure
  - security
  - certificates
  - authentication

---

I wrote "Certificate-Less Authentication: Simplifying Service Identity" to share practical, production-minded guidance on this topic.

## The Certificate Management Problem

Traditional certificate authentication requires:
- Certificate generation and signing
- Secure storage
- Regular rotation (typically every 90 days to 1 year)
- Monitoring for expiration
- Distribution to all services

## Moving to Certificate-Less

### From Certificate to Managed Identity

Before (certificate-based):

```csharp
// Old approach with certificate
var certificate = new X509Certificate2("path/to/cert.pfx", "password");
var clientCredential = new ClientCertificateCredential(
    tenantId,
    clientId,
    certificate);
```

After (managed identity):

```csharp
// New approach - no certificates
var credential = new DefaultAzureCredential();
// Works automatically in Azure with managed identity
```

### Azure AD App Registration

```bash
# Old: Create app with certificate
az ad app create --display-name "MyApp" \
  --credential-description "MyCert" \
  --key-type AsymmetricX509Cert \
  --key-value "$(cat cert.pem)"

# New: Create app with federated credential (no certificate)
az ad app create --display-name "MyApp"
az ad app federated-credential create \
  --id $APP_ID \
  --parameters '{
    "name": "kubernetes-federation",
    "issuer": "https://myaks.oidc.issuer.url",
    "subject": "system:serviceaccount:default:my-service-account",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

## Service-to-Service Authentication

### Azure Functions to Azure SQL

```bicep
// Infrastructure setup
resource sqlServer 'Microsoft.Sql/servers@2021-11-01' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: 'sqladmin'
    administratorLoginPassword: adminPassword
    administrators: {
      azureADOnlyAuthentication: true  // No SQL passwords
      principalType: 'Group'
      login: 'DBAdmins'
      sid: dbAdminGroupId
      tenantId: subscription().tenantId
    }
  }
}

resource functionApp 'Microsoft.Web/sites@2021-03-01' = {
  name: functionAppName
  identity: {
    type: 'SystemAssigned'
  }
}

// Grant function access to database
resource sqlRoleAssignment 'Microsoft.Sql/servers/databases/sqlPermissions@2021-11-01' = {
  // Configured via SQL commands
}
```

```sql
-- Grant function app access to database
CREATE USER [my-function-app] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [my-function-app];
ALTER ROLE db_datawriter ADD MEMBER [my-function-app];
```

```csharp
// Function code - no connection string secrets
public class DataFunction
{
    [FunctionName("QueryData")]
    public async Task<IActionResult> QueryData(
        [HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequest req)
    {
        var credential = new DefaultAzureCredential();
        var token = await credential.GetTokenAsync(
            new TokenRequestContext(new[] { "https://database.windows.net/.default" }));

        using var connection = new SqlConnection(
            "Server=myserver.database.windows.net;Database=mydb;");
        connection.AccessToken = token.Token;
        await connection.OpenAsync();

        // Query data
        using var command = new SqlCommand("SELECT * FROM Users", connection);
        var result = await command.ExecuteReaderAsync();
        // ...
    }
}
```

### API-to-API Authentication

```csharp
// Calling another API with managed identity
public class ApiClient
{
    private readonly HttpClient _httpClient;
    private readonly DefaultAzureCredential _credential;
    private readonly string _apiScope;

    public ApiClient(string apiBaseUrl, string apiScope)
    {
        _httpClient = new HttpClient { BaseAddress = new Uri(apiBaseUrl) };
        _credential = new DefaultAzureCredential();
        _apiScope = apiScope;
    }

    public async Task<T> GetAsync<T>(string path)
    {
        // Get token for target API
        var token = await _credential.GetTokenAsync(
            new TokenRequestContext(new[] { _apiScope }));

        _httpClient.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", token.Token);

        var response = await _httpClient.GetAsync(path);
        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<T>();
    }
}
```

## Monitoring Certificate-Less Authentication

```kusto
// Log Analytics - track identity usage
AADManagedIdentitySignInLogs
| where TimeGenerated > ago(24h)
| summarize
    SuccessfulAuth = countif(ResultType == 0),
    FailedAuth = countif(ResultType != 0)
    by ServicePrincipalId, ResourceDisplayName, bin(TimeGenerated, 1h)
| order by TimeGenerated desc

// Track federated credential usage
AADServicePrincipalSignInLogs
| where TimeGenerated > ago(24h)
| where AuthenticationProcessingDetails contains "FederatedIdentityCredential"
| project
    TimeGenerated,
    ServicePrincipalName,
    ResourceDisplayName,
    IPAddress,
    ResultType
```

## Migration Checklist

1. **Inventory existing certificates**
   - Document all services using certificate auth
   - Note expiration dates and rotation schedules

2. **Enable managed identity**
   - Add system-assigned identity to Azure resources
   - Create user-assigned identity for shared scenarios

3. **Configure permissions**
   - Grant managed identities access via RBAC
   - Update Azure AD applications

4. **Update application code**
   - Replace certificate credential with DefaultAzureCredential
   - Remove certificate storage and loading logic

5. **Test thoroughly**
   - Verify all authentication paths work
   - Check local development experience

6. **Deprecate certificates**
   - Remove old certificates after validation
   - Update documentation

Certificate-less authentication dramatically simplifies operations while improving security posture.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
