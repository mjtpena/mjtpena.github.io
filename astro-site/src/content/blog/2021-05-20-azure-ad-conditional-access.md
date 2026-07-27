---
title: "Azure AD Conditional Access: Zero Trust Authentication Policies"
author: Michael John Peña
draft: false
date: 2021-05-20
tags:
  - Azure
  - Security
  - Identity
  - Azure AD
  - Zero Trust
---

Conditional Access is where the "never trust, always verify" principle of Zero Trust actually gets operationalised. Every sign-in to every app goes through the policy engine: who is the user, what's their role, is the device compliant, where is the request coming from, what application is being accessed? The policies layer—require MFA for external access, block legacy authentication, require compliant device for corporate data, restrict high-privilege roles to named locations. The implementation trap I see most: turning on Conditional Access without report-only mode first. Report-only shows you exactly which users would be blocked by a policy before it enforces. Skipping that step and going straight to enforcement has blocked C-suite executives and brought support queues to a standstill more than once.

## The Zero Trust Model

Zero Trust assumes breach and verifies each request as if it originated from an untrusted network:
- **Verify explicitly**: Always authenticate and authorize
- **Use least privilege**: Limit access with Just-In-Time and Just-Enough-Access
- **Assume breach**: Minimize blast radius and segment access

Conditional Access implements these principles.

## Policy Components

Every Conditional Access policy has:
- **Assignments**: Who and what the policy applies to
- **Conditions**: When the policy applies
- **Access Controls**: What happens when conditions are met

## Common Policies

### Require MFA for Administrators

```json
{
  "displayName": "Require MFA for Admins",
  "state": "enabled",
  "conditions": {
    "users": {
      "includeRoles": [
        "62e90394-69f5-4237-9190-012177145e10",
        "194ae4cb-b126-40b2-bd5b-6091b380977d",
        "f28a1f50-f6e7-4571-818b-6a12f2af6b6c"
      ]
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
```

### Block Legacy Authentication

```json
{
  "displayName": "Block Legacy Authentication",
  "state": "enabled",
  "conditions": {
    "users": {
      "includeUsers": ["All"]
    },
    "applications": {
      "includeApplications": ["All"]
    },
    "clientAppTypes": [
      "exchangeActiveSync",
      "other"
    ]
  },
  "grantControls": {
    "operator": "OR",
    "builtInControls": ["block"]
  }
}
```

### Require Compliant Device for Sensitive Apps

```json
{
  "displayName": "Require Compliant Device for Finance Apps",
  "state": "enabled",
  "conditions": {
    "users": {
      "includeGroups": ["finance-team-group-id"]
    },
    "applications": {
      "includeApplications": ["finance-app-id"]
    },
    "platforms": {
      "includePlatforms": ["windows", "macOS", "iOS", "android"]
    }
  },
  "grantControls": {
    "operator": "AND",
    "builtInControls": ["compliantDevice", "mfa"]
  }
}
```

## Creating Policies with Graph API

```python
import requests

graph_url = "https://graph.microsoft.com/v1.0"
headers = {
    "Authorization": f"Bearer {access_token}",
    "Content-Type": "application/json"
}

def create_conditional_access_policy(policy):
    """Create a new Conditional Access policy"""
    response = requests.post(
        f"{graph_url}/identity/conditionalAccess/policies",
        headers=headers,
        json=policy
    )
    return response.json()

# Require MFA for risky sign-ins
risky_signin_policy = {
    "displayName": "Require MFA for Risky Sign-ins",
    "state": "enabledForReportingButNotEnforced",  # Start in report-only
    "conditions": {
        "users": {
            "includeUsers": ["All"],
            "excludeUsers": ["break-glass-account-id"]
        },
        "applications": {
            "includeApplications": ["All"]
        },
        "signInRiskLevels": ["high", "medium"]
    },
    "grantControls": {
        "operator": "OR",
        "builtInControls": ["mfa"]
    }
}

result = create_conditional_access_policy(risky_signin_policy)
print(f"Created policy: {result['id']}")
```

## Named Locations

Define trusted network locations:

```python
def create_named_location(name, ip_ranges):
    """Create IP-based named location"""
    location = {
        "@odata.type": "#microsoft.graph.ipNamedLocation",
        "displayName": name,
        "isTrusted": True,
        "ipRanges": [
            {
                "@odata.type": "#microsoft.graph.iPv4CidrRange",
                "cidrAddress": ip
            }
            for ip in ip_ranges
        ]
    }

    response = requests.post(
        f"{graph_url}/identity/conditionalAccess/namedLocations",
        headers=headers,
        json=location
    )
    return response.json()

# Create corporate network location
corporate_network = create_named_location(
    "Corporate Network",
    ["203.0.113.0/24", "198.51.100.0/24"]
)

# Create country-based location
def create_country_location(name, countries):
    location = {
        "@odata.type": "#microsoft.graph.countryNamedLocation",
        "displayName": name,
        "countriesAndRegions": countries,
        "includeUnknownCountriesAndRegions": False
    }

    response = requests.post(
        f"{graph_url}/identity/conditionalAccess/namedLocations",
        headers=headers,
        json=location
    )
    return response.json()

allowed_countries = create_country_location(
    "Allowed Countries",
    ["AU", "US", "GB", "NZ"]
)
```

## Session Controls

Control session behavior:

```python
# Policy with session controls
session_policy = {
    "displayName": "Limited Session for Unmanaged Devices",
    "state": "enabled",
    "conditions": {
        "users": {
            "includeUsers": ["All"]
        },
        "applications": {
            "includeApplications": ["Office365"]
        },
        "deviceStates": {
            "excludeDeviceStates": ["compliant", "domainJoined"]
        }
    },
    "grantControls": {
        "operator": "OR",
        "builtInControls": ["mfa"]
    },
    "sessionControls": {
        "signInFrequency": {
            "value": 4,
            "type": "hours",
            "isEnabled": True
        },
        "persistentBrowser": {
            "mode": "never",
            "isEnabled": True
        },
        "cloudAppSecurity": {
            "cloudAppSecurityType": "mcasConfigured",
            "isEnabled": True
        }
    }
}
```

## Report-Only Mode

Test policies before enforcement:

```python
def analyze_report_only_impact():
    """Analyze impact of report-only policies"""
    query = """
    SigninLogs
    | where TimeGenerated > ago(7d)
    | where ConditionalAccessPolicies has "reportOnly"
    | mv-expand CAPolicy = parse_json(ConditionalAccessPolicies)
    | where CAPolicy.enforcedReportOnlyMode == "reportOnlyFailure"
    | summarize
        BlockedSessions = count(),
        UniqueUsers = dcount(UserPrincipalName)
        by PolicyName = tostring(CAPolicy.displayName)
    | order by BlockedSessions desc
    """
    return execute_log_analytics_query(query)

# Export impact report
impact = analyze_report_only_impact()
for policy in impact:
    print(f"Policy: {policy['PolicyName']}")
    print(f"  Would block: {policy['BlockedSessions']} sessions")
    print(f"  Affecting: {policy['UniqueUsers']} users")
```

## Monitoring and Troubleshooting

### Sign-in Log Analysis

```kusto
// Conditional Access failures
SigninLogs
| where TimeGenerated > ago(24h)
| where ResultType != 0
| mv-expand CAPolicy = parse_json(ConditionalAccessPolicies)
| where CAPolicy.result == "failure"
| summarize
    FailureCount = count(),
    Users = make_set(UserPrincipalName, 10)
    by
        PolicyName = tostring(CAPolicy.displayName),
        FailureReason = tostring(CAPolicy.enforcedGrantControls)
| order by FailureCount desc

// MFA registration gaps
SigninLogs
| where TimeGenerated > ago(7d)
| where ResultType == 50074  // MFA required but not registered
| summarize
    AttemptCount = count(),
    LastAttempt = max(TimeGenerated)
    by UserPrincipalName
| order by AttemptCount desc
```

### What-If Analysis

```python
def what_if_analysis(user_id, app_id, conditions=None):
    """Evaluate which policies would apply"""
    request_body = {
        "subject": {
            "userId": user_id
        },
        "resourceActions": {
            "application": {
                "applicationId": app_id
            }
        }
    }

    if conditions:
        request_body["signInConditions"] = conditions

    response = requests.post(
        f"{graph_url}/identity/conditionalAccess/evaluate",
        headers=headers,
        json=request_body
    )

    result = response.json()

    print(f"Policies that would apply:")
    for policy in result.get("appliedPolicies", []):
        print(f"  - {policy['displayName']}: {policy['result']}")

    return result

# Test what happens for a user accessing SharePoint from unknown location
what_if_analysis(
    user_id="user-guid",
    app_id="sharepoint-app-id",
    conditions={
        "location": {
            "countryOrRegion": "CN"
        },
        "devicePlatform": "iOS",
        "signInRiskLevel": "low"
    }
)
```

## Best Practices

1. **Start with report-only**: Test policies before enforcing
2. **Exclude break-glass accounts**: Always have emergency access
3. **Use groups for assignments**: Easier to manage than individual users
4. **Layer policies**: Multiple specific policies over one complex policy
5. **Monitor sign-in logs**: Identify issues before users report them

```python
# Policy deployment checklist
def deploy_policy_safely(policy):
    """Safe policy deployment process"""

    # 1. Create in report-only mode
    policy["state"] = "enabledForReportingButNotEnforced"
    created = create_conditional_access_policy(policy)
    policy_id = created["id"]

    # 2. Monitor for 7 days
    print(f"Policy {policy_id} created in report-only mode")
    print("Monitor for 7 days before enabling")

    # 3. Check impact
    impact = analyze_report_only_impact()
    if impact.get(policy["displayName"], {}).get("BlockedSessions", 0) > 1000:
        print("WARNING: High impact detected. Review before enabling.")
        return

    # 4. Enable policy
    enable_policy(policy_id)
    print(f"Policy {policy_id} enabled")
```

## Resources

- [Conditional Access Documentation](https://docs.microsoft.com/en-us/azure/active-directory/conditional-access/)
- [Policy Templates](https://docs.microsoft.com/en-us/azure/active-directory/conditional-access/concept-conditional-access-policy-common)
- [Troubleshooting Guide](https://docs.microsoft.com/en-us/azure/active-directory/conditional-access/troubleshoot-conditional-access)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
