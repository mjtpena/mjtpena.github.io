---
title: "Identity-First Security: The New Perimeter"
author: Michael John Pena
draft: false
date: 2021-12-15
tags:
  - Security
  - Identity
  - Azure AD
  - Authentication
  - Authorization

---

I wrote "Identity-First Security: The New Perimeter" to share practical, production-minded guidance on this topic.

## Azure AD as the Identity Foundation

```csharp
// Modern authentication with MSAL
using Microsoft.Identity.Client;
using Microsoft.Identity.Web;

public class IdentityService
{
    private readonly IConfidentialClientApplication _app;

    public IdentityService(IConfiguration config)
    {
        _app = ConfidentialClientApplicationBuilder
            .Create(config["AzureAd:ClientId"])
            .WithClientSecret(config["AzureAd:ClientSecret"])
            .WithAuthority(AzureCloudInstance.AzurePublic, config["AzureAd:TenantId"])
            .Build();
    }

    public async Task<string> GetAccessTokenForResourceAsync(string[] scopes)
    {
        var result = await _app.AcquireTokenForClient(scopes)
            .ExecuteAsync();

        return result.AccessToken;
    }

    public async Task<AuthenticationResult> AcquireTokenOnBehalfOfAsync(
        string userToken,
        string[] scopes)
    {
        var userAssertion = new UserAssertion(userToken);

        return await _app.AcquireTokenOnBehalfOf(scopes, userAssertion)
            .ExecuteAsync();
    }
}

// ASP.NET Core configuration
public void ConfigureServices(IServiceCollection services)
{
    services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddMicrosoftIdentityWebApi(Configuration.GetSection("AzureAd"));

    services.AddAuthorization(options =>
    {
        options.AddPolicy("RequireAdminRole", policy =>
            policy.RequireRole("Admin"));

        options.AddPolicy("RequireScope", policy =>
            policy.RequireClaim("scp", "api.read", "api.write"));

        options.AddPolicy("RequireGroupMembership", policy =>
            policy.RequireClaim("groups", "data-engineers-group-id"));
    });

    services.AddMicrosoftIdentityWebApiAuthentication(Configuration)
        .EnableTokenAcquisitionToCallDownstreamApi()
        .AddInMemoryTokenCaches();
}
```

## Implementing RBAC

```python
# Custom RBAC implementation
from dataclasses import dataclass
from enum import Enum
from typing import List, Set
import functools

class Permission(Enum):
    READ_DATA = "data:read"
    WRITE_DATA = "data:write"
    DELETE_DATA = "data:delete"
    ADMIN = "admin:*"

@dataclass
class Role:
    name: str
    permissions: Set[Permission]

# Define roles
ROLES = {
    "viewer": Role("viewer", {Permission.READ_DATA}),
    "editor": Role("editor", {Permission.READ_DATA, Permission.WRITE_DATA}),
    "admin": Role("admin", {Permission.READ_DATA, Permission.WRITE_DATA, Permission.DELETE_DATA, Permission.ADMIN})
}

class AuthorizationService:
    def __init__(self, user_roles_provider):
        self.user_roles_provider = user_roles_provider

    def get_user_permissions(self, user_id: str) -> Set[Permission]:
        roles = self.user_roles_provider.get_roles(user_id)
        permissions = set()
        for role_name in roles:
            if role_name in ROLES:
                permissions.update(ROLES[role_name].permissions)
        return permissions

    def has_permission(self, user_id: str, required_permission: Permission) -> bool:
        user_permissions = self.get_user_permissions(user_id)

        # Check for admin wildcard
        if Permission.ADMIN in user_permissions:
            return True

        return required_permission in user_permissions

def require_permission(permission: Permission):
    """Decorator for permission-based access control"""
    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Get user from request context
            user_id = get_current_user_id()
            auth_service = get_auth_service()

            if not auth_service.has_permission(user_id, permission):
                raise AuthorizationError(f"User lacks permission: {permission.value}")

            return await func(*args, **kwargs)
        return wrapper
    return decorator

# Usage
@require_permission(Permission.WRITE_DATA)
async def update_record(record_id: str, data: dict):
    # Implementation
    pass
```

## Service Principal Best Practices

```bicep
// Service principal with minimal permissions
resource appRegistration 'Microsoft.Graph/applications@v1.0' = {
  displayName: 'DataPipelineApp'
  signInAudience: 'AzureADMyOrg'
  requiredResourceAccess: [
    {
      resourceAppId: '00000003-0000-0000-c000-000000000000' // Microsoft Graph
      resourceAccess: [
        {
          id: 'e1fe6dd8-ba31-4d61-89e7-88639da4683d' // User.Read
          type: 'Scope'
        }
      ]
    }
  ]
}

// Use certificate-based auth instead of secrets
resource servicePrincipal 'Microsoft.Graph/servicePrincipals@v1.0' = {
  appId: appRegistration.appId
  keyCredentials: [
    {
      type: 'AsymmetricX509Cert'
      usage: 'Verify'
      key: base64(certificate.publicKey)
      endDateTime: dateTimeAdd(utcNow(), 'P1Y')
    }
  ]
}
```

```python
# Certificate-based authentication
from azure.identity import CertificateCredential
from azure.keyvault.secrets import SecretClient

def get_certificate_credential(
    tenant_id: str,
    client_id: str,
    certificate_path: str
) -> CertificateCredential:
    """Create credential using certificate"""
    return CertificateCredential(
        tenant_id=tenant_id,
        client_id=client_id,
        certificate_path=certificate_path,
        # Use certificate chain if available
        send_certificate_chain=True
    )

# For production: Load certificate from Key Vault
async def get_credential_from_keyvault():
    # Bootstrap with managed identity
    bootstrap_credential = ManagedIdentityCredential()
    kv_client = SecretClient(
        vault_url="https://identity-vault.vault.azure.net",
        credential=bootstrap_credential
    )

    # Get certificate
    cert_secret = await kv_client.get_secret("app-certificate")

    return CertificateCredential(
        tenant_id=os.environ["AZURE_TENANT_ID"],
        client_id=os.environ["AZURE_CLIENT_ID"],
        certificate_data=base64.b64decode(cert_secret.value)
    )
```

## Privileged Identity Management

```powershell
# Configure PIM for Azure resources
$params = @{
    RoleDefinitionId = "/subscriptions/$subscriptionId/providers/Microsoft.Authorization/roleDefinitions/$roleId"
    PrincipalId = $userId
    RequestType = "SelfActivate"
    ScheduleInfo = @{
        StartDateTime = (Get-Date).ToUniversalTime().ToString("o")
        Expiration = @{
            Type = "AfterDuration"
            Duration = "PT8H"  # 8 hours
        }
    }
    Justification = "Production deployment support"
    TicketInfo = @{
        TicketNumber = "INC001234"
        TicketSystem = "ServiceNow"
    }
}

# Request elevation
New-MgRoleManagementDirectoryRoleEligibilityScheduleRequest @params

# Configure PIM settings
$settings = @{
    Rules = @(
        @{
            "@odata.type" = "#microsoft.graph.unifiedRoleManagementPolicyExpirationRule"
            Id = "Expiration_EndUser_Assignment"
            IsExpirationRequired = $true
            MaximumDuration = "PT8H"
        },
        @{
            "@odata.type" = "#microsoft.graph.unifiedRoleManagementPolicyApprovalRule"
            Id = "Approval_EndUser_Assignment"
            Setting = @{
                IsApprovalRequired = $true
                ApprovalStages = @(
                    @{
                        ApprovalStageTimeOutInDays = 1
                        EscalationTimeInMinutes = 0
                        IsApproverJustificationRequired = $true
                        IsEscalationEnabled = $false
                        PrimaryApprovers = @(
                            @{
                                "@odata.type" = "#microsoft.graph.groupMembers"
                                GroupId = $approverGroupId
                            }
                        )
                    }
                )
            }
        },
        @{
            "@odata.type" = "#microsoft.graph.unifiedRoleManagementPolicyNotificationRule"
            Id = "Notification_Admin_EndUser_Assignment"
            NotificationType = "Email"
            RecipientType = "Admin"
            NotificationLevel = "All"
        }
    )
}
```

## API Security with OAuth 2.0

```csharp
// Secure API with proper token validation
public class TokenValidationMiddleware
{
    private readonly RequestDelegate _next;
    private readonly TokenValidationParameters _validationParameters;

    public TokenValidationMiddleware(RequestDelegate next, IConfiguration config)
    {
        _next = next;
        _validationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = $"https://login.microsoftonline.com/{config["AzureAd:TenantId"]}/v2.0",
            ValidateAudience = true,
            ValidAudience = config["AzureAd:ClientId"],
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(5),
            ValidateIssuerSigningKey = true,
            IssuerSigningKeyResolver = (token, securityToken, kid, parameters) =>
            {
                // Fetch signing keys from Azure AD
                var client = new HttpClient();
                var json = client.GetStringAsync(
                    $"https://login.microsoftonline.com/{config["AzureAd:TenantId"]}/discovery/v2.0/keys"
                ).Result;
                var keys = JsonWebKeySet.Create(json);
                return keys.GetSigningKeys();
            }
        };
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var authHeader = context.Request.Headers["Authorization"].FirstOrDefault();

        if (authHeader == null || !authHeader.StartsWith("Bearer "))
        {
            context.Response.StatusCode = 401;
            return;
        }

        var token = authHeader.Substring("Bearer ".Length);

        try
        {
            var handler = new JwtSecurityTokenHandler();
            var principal = handler.ValidateToken(token, _validationParameters, out _);

            // Add claims to context
            context.User = principal;

            // Validate additional claims
            if (!ValidateCustomClaims(principal))
            {
                context.Response.StatusCode = 403;
                return;
            }

            await _next(context);
        }
        catch (SecurityTokenException)
        {
            context.Response.StatusCode = 401;
        }
    }

    private bool ValidateCustomClaims(ClaimsPrincipal principal)
    {
        // Check for required claims
        var tenantId = principal.FindFirst("tid")?.Value;
        var allowedTenants = new[] { "your-tenant-id" };

        return allowedTenants.Contains(tenantId);
    }
}
```

## Identity Governance

```python
# Access review automation
from msgraph.core import GraphClient
from azure.identity import DefaultAzureCredential

async def create_access_review():
    credential = DefaultAzureCredential()
    client = GraphClient(credential=credential)

    review_definition = {
        "displayName": "Quarterly Access Review - Data Team",
        "descriptionForAdmins": "Review access for data engineering team members",
        "descriptionForReviewers": "Please review if users still need access",
        "scope": {
            "@odata.type": "#microsoft.graph.accessReviewQueryScope",
            "query": "/groups/{group-id}/members",
            "queryType": "MicrosoftGraph"
        },
        "instanceEnumerationScope": {
            "@odata.type": "#microsoft.graph.accessReviewQueryScope",
            "query": "/groups/{group-id}",
            "queryType": "MicrosoftGraph"
        },
        "settings": {
            "mailNotificationsEnabled": True,
            "reminderNotificationsEnabled": True,
            "justificationRequiredOnApproval": True,
            "defaultDecisionEnabled": True,
            "defaultDecision": "Deny",
            "instanceDurationInDays": 14,
            "autoApplyDecisionsEnabled": True,
            "recommendationsEnabled": True,
            "recurrence": {
                "pattern": {
                    "type": "absoluteMonthly",
                    "interval": 3,
                    "dayOfMonth": 1
                },
                "range": {
                    "type": "noEnd",
                    "startDate": "2021-12-01"
                }
            }
        },
        "reviewers": [
            {
                "query": "/users/{manager-id}",
                "queryType": "MicrosoftGraph"
            }
        ]
    }

    response = await client.post(
        "/identityGovernance/accessReviews/definitions",
        json=review_definition
    )

    return response.json()
```

## Key Identity Principles for 2021

1. **Identity is the Perimeter**: Control access through identity, not network location
2. **Passwordless When Possible**: FIDO2, Windows Hello, Authenticator app
3. **Continuous Evaluation**: Don't trust tokens forever
4. **Least Privilege**: Just enough access, just in time
5. **Automate Governance**: Regular access reviews, automated remediation

Identity-first security in 2021 meant rethinking how we control access. The tools are mature; the challenge is implementation discipline.

## Resources

- [Microsoft Identity Platform](https://docs.microsoft.com/en-us/azure/active-directory/develop/)
- [Azure AD Best Practices](https://docs.microsoft.com/en-us/azure/active-directory/fundamentals/active-directory-ops-guide-intro)
- [MSAL Documentation](https://docs.microsoft.com/en-us/azure/active-directory/develop/msal-overview)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
