---
title: "Azure AD B2B Collaboration: Secure Partner Access"
author: Michael John Peña
draft: false
date: 2021-05-22
tags:
  - Azure
  - Identity
  - Azure AD
  - B2B
  - Collaboration

---

I wrote "Azure AD B2B Collaboration: Secure Partner Access" to share practical, production-minded guidance on this topic.

## What is Azure AD B2B?

B2B allows you to invite external users who authenticate with their own identity provider:
- Another Azure AD tenant
- Microsoft accounts
- Google accounts
- SAML/WS-Fed identity providers
- Email one-time passcode

Guests appear in your directory but authenticate elsewhere.

## Inviting Guest Users

### Via Azure Portal or Graph API

```python
import requests

graph_url = "https://graph.microsoft.com/v1.0"
headers = {
    "Authorization": f"Bearer {access_token}",
    "Content-Type": "application/json"
}

def invite_guest_user(email, display_name, redirect_url=None):
    """Invite external user as guest"""
    invitation = {
        "invitedUserEmailAddress": email,
        "invitedUserDisplayName": display_name,
        "inviteRedirectUrl": redirect_url or "https://myapps.microsoft.com",
        "sendInvitationMessage": True,
        "invitedUserMessageInfo": {
            "customizedMessageBody": "You've been invited to collaborate with Contoso. Click accept to get started."
        }
    }

    response = requests.post(
        f"{graph_url}/invitations",
        headers=headers,
        json=invitation
    )

    return response.json()

# Invite a partner
result = invite_guest_user(
    email="partner@fabrikam.com",
    display_name="Partner User",
    redirect_url="https://portal.contoso.com"
)

print(f"Invitation sent. Status: {result['status']}")
print(f"Redeem URL: {result['inviteRedeemUrl']}")
```

### Bulk Invitations

```python
import csv
from concurrent.futures import ThreadPoolExecutor

def bulk_invite_from_csv(csv_file):
    """Invite multiple users from CSV file"""
    results = []

    with open(csv_file, 'r') as f:
        reader = csv.DictReader(f)
        users = list(reader)

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [
            executor.submit(
                invite_guest_user,
                user['email'],
                user['name'],
                user.get('redirect_url')
            )
            for user in users
        ]

        for future, user in zip(futures, users):
            try:
                result = future.result()
                results.append({
                    'email': user['email'],
                    'status': 'success',
                    'id': result.get('invitedUser', {}).get('id')
                })
            except Exception as e:
                results.append({
                    'email': user['email'],
                    'status': 'failed',
                    'error': str(e)
                })

    return results

# CSV format: email,name,redirect_url
# partner1@external.com,Partner One,https://app.contoso.com
# partner2@external.com,Partner Two,https://app.contoso.com
```

## Cross-Tenant Access Settings

Configure how your organization interacts with others:

```python
def configure_cross_tenant_access(tenant_id, settings):
    """Configure access settings for specific tenant"""

    policy = {
        "tenantId": tenant_id,
        "b2bCollaborationInbound": {
            "usersAndGroups": {
                "accessType": "allowed",
                "targets": [
                    {
                        "target": "AllUsers",
                        "targetType": "user"
                    }
                ]
            },
            "applications": {
                "accessType": "allowed",
                "targets": [
                    {
                        "target": settings.get("allowed_apps", ["AllApplications"])[0],
                        "targetType": "application"
                    }
                ]
            }
        },
        "b2bCollaborationOutbound": {
            "usersAndGroups": {
                "accessType": "allowed",
                "targets": [
                    {
                        "target": settings.get("outbound_group", "AllUsers"),
                        "targetType": "user"
                    }
                ]
            }
        },
        "inboundTrust": {
            "isMfaAccepted": settings.get("trust_mfa", True),
            "isCompliantDeviceAccepted": settings.get("trust_compliant", False),
            "isHybridAzureADJoinedDeviceAccepted": settings.get("trust_hybrid_join", False)
        }
    }

    response = requests.post(
        f"{graph_url}/policies/crossTenantAccessPolicy/partners",
        headers=headers,
        json=policy
    )

    return response.json()

# Trust MFA from partner tenant
configure_cross_tenant_access(
    tenant_id="partner-tenant-guid",
    settings={
        "trust_mfa": True,
        "trust_compliant": True,
        "allowed_apps": ["sharepoint-app-id"]
    }
)
```

## Self-Service Sign-Up

Allow guests to sign up for specific apps:

```python
def create_self_service_signup_flow():
    """Create user flow for self-service guest signup"""

    # Create user flow
    user_flow = {
        "id": "B2X_1_partner_signup",
        "userFlowType": "signUpOrSignIn",
        "userFlowTypeVersion": 1,
        "identityProviders": [
            {"id": "Email-Password-Authentication"}
        ]
    }

    response = requests.post(
        f"{graph_url}/identity/b2xUserFlows",
        headers=headers,
        json=user_flow
    )

    flow_id = response.json()['id']

    # Add attributes to collect
    attributes = [
        {"id": "city"},
        {"id": "companyName"},
        {"id": "jobTitle"}
    ]

    for attr in attributes:
        requests.post(
            f"{graph_url}/identity/b2xUserFlows/{flow_id}/userAttributeAssignments",
            headers=headers,
            json={"userAttribute": attr}
        )

    return flow_id
```

## Managing Guest Lifecycle

### Access Reviews

```python
def create_guest_access_review():
    """Create access review for guest users"""

    review = {
        "displayName": "Quarterly Guest Review",
        "descriptionForAdmins": "Review guest user access quarterly",
        "descriptionForReviewers": "Please review if these guests still need access",
        "scope": {
            "@odata.type": "#microsoft.graph.accessReviewQueryScope",
            "query": "/users?$filter=userType eq 'Guest'",
            "queryType": "MicrosoftGraph"
        },
        "reviewers": [
            {
                "query": "/users/{manager-id}",
                "queryType": "MicrosoftGraph"
            }
        ],
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
                    "startDate": "2021-06-01"
                }
            }
        }
    }

    response = requests.post(
        f"{graph_url}/identityGovernance/accessReviews/definitions",
        headers=headers,
        json=review
    )

    return response.json()
```

### Guest Cleanup

```python
from datetime import datetime, timedelta

def find_stale_guests(inactive_days=90):
    """Find guest users who haven't signed in recently"""

    cutoff_date = (datetime.utcnow() - timedelta(days=inactive_days)).isoformat() + "Z"

    query = f"userType eq 'Guest' and signInActivity/lastSignInDateTime lt {cutoff_date}"

    response = requests.get(
        f"{graph_url}/users",
        headers=headers,
        params={
            "$filter": query,
            "$select": "id,displayName,mail,signInActivity,createdDateTime"
        }
    )

    return response.json().get('value', [])

def remove_stale_guests(dry_run=True):
    """Remove or disable stale guest accounts"""

    stale_guests = find_stale_guests(inactive_days=180)

    for guest in stale_guests:
        print(f"Stale guest: {guest['displayName']} ({guest['mail']})")
        print(f"  Last sign-in: {guest.get('signInActivity', {}).get('lastSignInDateTime', 'Never')}")

        if not dry_run:
            # Option 1: Delete
            # requests.delete(f"{graph_url}/users/{guest['id']}", headers=headers)

            # Option 2: Block sign-in
            requests.patch(
                f"{graph_url}/users/{guest['id']}",
                headers=headers,
                json={"accountEnabled": False}
            )
            print(f"  Disabled account")

    return len(stale_guests)
```

## Conditional Access for Guests

```python
# Require MFA for all guest access
guest_mfa_policy = {
    "displayName": "Require MFA for Guests",
    "state": "enabled",
    "conditions": {
        "users": {
            "includeGuestsOrExternalUsers": {
                "guestOrExternalUserTypes": "b2bCollaborationGuest,b2bCollaborationMember",
                "externalTenants": {
                    "membershipKind": "all"
                }
            }
        },
        "applications": {
            "includeApplications": ["All"]
        }
    },
    "grantControls": {
        "operator": "OR",
        "builtInControls": ["mfa"]
    }
}

# Restrict guests to specific apps
guest_app_restriction = {
    "displayName": "Restrict Guest App Access",
    "state": "enabled",
    "conditions": {
        "users": {
            "includeGuestsOrExternalUsers": {
                "guestOrExternalUserTypes": "b2bCollaborationGuest"
            }
        },
        "applications": {
            "includeApplications": ["All"],
            "excludeApplications": [
                "sharepoint-app-id",
                "teams-app-id"
            ]
        }
    },
    "grantControls": {
        "operator": "OR",
        "builtInControls": ["block"]
    }
}
```

## Monitoring Guest Activity

```kusto
// Guest sign-in activity
SigninLogs
| where TimeGenerated > ago(30d)
| where UserType == "Guest"
| summarize
    SignInCount = count(),
    UniqueApps = dcount(AppDisplayName),
    LastSignIn = max(TimeGenerated)
    by UserPrincipalName, UserDisplayName
| order by SignInCount desc

// Failed guest sign-ins
SigninLogs
| where TimeGenerated > ago(7d)
| where UserType == "Guest"
| where ResultType != 0
| summarize FailedCount = count() by UserPrincipalName, ResultDescription
| order by FailedCount desc

// Guest access by application
SigninLogs
| where TimeGenerated > ago(30d)
| where UserType == "Guest"
| summarize
    GuestCount = dcount(UserPrincipalName),
    SignInCount = count()
    by AppDisplayName
| order by GuestCount desc
```

## Best Practices

1. **Limit guest permissions**: Use Conditional Access to restrict access
2. **Regular access reviews**: Quarterly reviews of guest necessity
3. **Trust MFA from partners**: Accept MFA from trusted tenants
4. **Monitor activity**: Track guest sign-ins and resource access
5. **Automate lifecycle**: Remove inactive guests automatically

## Resources

- [B2B Documentation](https://docs.microsoft.com/en-us/azure/active-directory/external-identities/)
- [Cross-Tenant Access](https://docs.microsoft.com/en-us/azure/active-directory/external-identities/cross-tenant-access-overview)
- [Access Reviews](https://docs.microsoft.com/en-us/azure/active-directory/governance/access-reviews-overview)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
