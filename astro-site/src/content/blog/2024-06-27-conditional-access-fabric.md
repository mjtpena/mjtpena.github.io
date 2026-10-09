---
title: "Conditional Access Policies for Microsoft Fabric"
description: "Conditional Access enables Zero Trust security by controlling access based on conditions. Today I'm exploring how to implement Conditional Access for…"
author: Michael John Peña
draft: false
date: 2024-06-27
tags:
  - Microsoft Fabric
  - Conditional Access
  - Zero Trust
  - Security
  - Microsoft Entra ID
---

Conditional Access enables Zero Trust security by controlling access based on conditions. Today I'm exploring how to implement Conditional Access for Microsoft Fabric.

## Conditional Access Overview

```
Conditional Access Signals:
├── User/Group
│   ├── Specific users
│   ├── Security groups
│   └── Directory roles
├── Location
│   ├── Named locations
│   ├── IP ranges
│   └── Countries
├── Device
│   ├── Platform (Windows, macOS, iOS, Android)
│   ├── Device state (Compliant, Hybrid joined)
│   └── Device filters
├── Application
│   ├── Microsoft Fabric
│   └── Power BI Service
├── Risk Level
│   ├── Sign-in risk
│   └── User risk
└── Session
    ├── Sign-in frequency
    └── Browser sessions
```

## Basic Policy Configuration

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
from enum import Enum

class GrantControl(Enum):
    BLOCK = "block"
    MFA = "mfa"
    COMPLIANT_DEVICE = "compliantDevice"
    HYBRID_JOINED = "domainJoinedDevice"
    APPROVED_APP = "approvedApplication"
    APP_PROTECTION = "compliantApplication"
    PASSWORD_CHANGE = "passwordChange"
    TERMS_OF_USE = "termsOfUse"

class SessionControl(Enum):
    SIGN_IN_FREQUENCY = "signInFrequency"
    PERSISTENT_BROWSER = "persistentBrowser"
    CONTINUOUS_ACCESS = "continuousAccessEvaluation"
    DISABLE_RESILIENCE = "disableResilienceDefaults"
    APP_ENFORCED = "cloudAppSecurity"

@dataclass
class ConditionalAccessPolicy:
    display_name: str
    state: str = "enabled"  # enabled, disabled, enabledForReportingButNotEnforced
    conditions: Dict = field(default_factory=dict)
    grant_controls: List[GrantControl] = field(default_factory=list)
    session_controls: Dict = field(default_factory=dict)

class ConditionalAccessManager:
    """Manage Conditional Access policies for Fabric."""

    FABRIC_APP_ID = "00000009-0000-0000-c000-000000000000"  # Microsoft Fabric
    POWER_BI_APP_ID = "00000009-0000-0000-c000-000000000000"  # Power BI Service

    def __init__(self, graph_client):
        self.graph = graph_client

    def create_policy(self, policy: ConditionalAccessPolicy) -> dict:
        """Create a Conditional Access policy."""
        policy_config = {
            "displayName": policy.display_name,
            "state": policy.state,
            "conditions": policy.conditions,
            "grantControls": {
                "operator": "AND",
                "builtInControls": [gc.value for gc in policy.grant_controls]
            }
        }

        if policy.session_controls:
            policy_config["sessionControls"] = policy.session_controls

        return self.graph.conditional_access_policies.create(policy_config)

    def create_fabric_mfa_policy(
        self,
        name: str,
        included_groups: List[str],
        excluded_groups: List[str] = None
    ):
        """Create MFA policy for Fabric access."""
        conditions = {
            "users": {
                "includeGroups": included_groups
            },
            "applications": {
                "includeApplications": [self.FABRIC_APP_ID]
            }
        }

        if excluded_groups:
            conditions["users"]["excludeGroups"] = excluded_groups

        policy = ConditionalAccessPolicy(
            display_name=name,
            conditions=conditions,
            grant_controls=[GrantControl.MFA]
        )

        return self.create_policy(policy)

    def create_location_based_policy(
        self,
        name: str,
        allowed_locations: List[str],
        blocked_locations: List[str] = None
    ):
        """Create location-based access policy."""
        conditions = {
            "users": {
                "includeUsers": ["All"]
            },
            "applications": {
                "includeApplications": [self.FABRIC_APP_ID]
            },
            "locations": {
                "includeLocations": blocked_locations or ["All"],
                "excludeLocations": allowed_locations
            }
        }

        policy = ConditionalAccessPolicy(
            display_name=name,
            conditions=conditions,
            grant_controls=[GrantControl.BLOCK]
        )

        return self.create_policy(policy)

    def create_device_compliance_policy(
        self,
        name: str,
        platforms: List[str] = None
    ):
        """Require compliant devices for Fabric access."""
        conditions = {
            "users": {
                "includeUsers": ["All"]
            },
            "applications": {
                "includeApplications": [self.FABRIC_APP_ID]
            }
        }

        if platforms:
            conditions["platforms"] = {
                "includePlatforms": platforms
            }

        policy = ConditionalAccessPolicy(
            display_name=name,
            conditions=conditions,
            grant_controls=[GrantControl.COMPLIANT_DEVICE]
        )

        return self.create_policy(policy)

# Usage
ca_mgr = ConditionalAccessManager(graph_client)

# Require MFA for all Fabric users
ca_mgr.create_fabric_mfa_policy(
    name="Fabric-Require-MFA",
    included_groups=["All Users"],
    excluded_groups=["Service Accounts"]
)

# Block access from untrusted locations
ca_mgr.create_location_based_policy(
    name="Fabric-Block-Untrusted-Locations",
    allowed_locations=["Corporate Network", "Trusted Countries"],
    blocked_locations=["All"]
)

# Require compliant devices
ca_mgr.create_device_compliance_policy(
    name="Fabric-Compliant-Device-Required",
    platforms=["windows", "macOS", "iOS", "android"]
)
```

## Named Locations

```python
class NamedLocationManager:
    """Manage named locations for Conditional Access."""

    def __init__(self, graph_client):
        self.graph = graph_client

    def create_ip_location(
        self,
        name: str,
        ip_ranges: List[str],
        is_trusted: bool = False
    ):
        """Create an IP-based named location."""
        location_config = {
            "@odata.type": "#microsoft.graph.ipNamedLocation",
            "displayName": name,
            "isTrusted": is_trusted,
            "ipRanges": [
                {"@odata.type": "#microsoft.graph.iPv4CidrRange", "cidrAddress": ip}
                if "." in ip else
                {"@odata.type": "#microsoft.graph.iPv6CidrRange", "cidrAddress": ip}
                for ip in ip_ranges
            ]
        }

        return self.graph.named_locations.create(location_config)

    def create_country_location(
        self,
        name: str,
        countries: List[str],
        include_unknown: bool = False
    ):
        """Create a country-based named location."""
        location_config = {
            "@odata.type": "#microsoft.graph.countryNamedLocation",
            "displayName": name,
            "countriesAndRegions": countries,
            "includeUnknownCountriesAndRegions": include_unknown
        }

        return self.graph.named_locations.create(location_config)

    def list_locations(self) -> List[dict]:
        """List all named locations."""
        return self.graph.named_locations.list()

# Usage
location_mgr = NamedLocationManager(graph_client)

# Create corporate network location
location_mgr.create_ip_location(
    name="Corporate Network",
    ip_ranges=[
        "10.0.0.0/8",
        "192.168.1.0/24",
        "203.0.113.0/24"  # Public IP range
    ],
    is_trusted=True
)

# Create allowed countries
location_mgr.create_country_location(
    name="Allowed Countries",
    countries=["US", "CA", "GB", "AU", "NZ"],
    include_unknown=False
)

# Create blocked countries
location_mgr.create_country_location(
    name="Blocked Countries",
    countries=["RU", "CN", "KP", "IR"],
    include_unknown=True
)
```

## Risk-Based Policies

```python
class RiskBasedPolicyManager:
    """Create risk-based Conditional Access policies."""

    def __init__(self, graph_client):
        self.graph = graph_client
        self.ca_mgr = ConditionalAccessManager(graph_client)

    def create_sign_in_risk_policy(
        self,
        name: str,
        risk_levels: List[str],
        action: GrantControl
    ):
        """Create policy based on sign-in risk."""
        conditions = {
            "users": {
                "includeUsers": ["All"]
            },
            "applications": {
                "includeApplications": [ConditionalAccessManager.FABRIC_APP_ID]
            },
            "signInRiskLevels": risk_levels  # low, medium, high
        }

        policy = ConditionalAccessPolicy(
            display_name=name,
            conditions=conditions,
            grant_controls=[action]
        )

        return self.ca_mgr.create_policy(policy)

    def create_user_risk_policy(
        self,
        name: str,
        risk_levels: List[str],
        require_password_change: bool = True
    ):
        """Create policy based on user risk."""
        conditions = {
            "users": {
                "includeUsers": ["All"]
            },
            "applications": {
                "includeApplications": [ConditionalAccessManager.FABRIC_APP_ID]
            },
            "userRiskLevels": risk_levels
        }

        grant_controls = [GrantControl.MFA]
        if require_password_change:
            grant_controls.append(GrantControl.PASSWORD_CHANGE)

        policy = ConditionalAccessPolicy(
            display_name=name,
            conditions=conditions,
            grant_controls=grant_controls
        )

        return self.ca_mgr.create_policy(policy)

    def create_comprehensive_risk_policy(self):
        """Create comprehensive risk-based policies."""
        # Block high-risk sign-ins
        self.create_sign_in_risk_policy(
            name="Fabric-Block-High-Risk-SignIn",
            risk_levels=["high"],
            action=GrantControl.BLOCK
        )

        # Require MFA for medium-risk sign-ins
        self.create_sign_in_risk_policy(
            name="Fabric-MFA-Medium-Risk-SignIn",
            risk_levels=["medium"],
            action=GrantControl.MFA
        )

        # Require password change for high-risk users
        self.create_user_risk_policy(
            name="Fabric-Password-Change-High-Risk-User",
            risk_levels=["high"],
            require_password_change=True
        )

# Usage
risk_mgr = RiskBasedPolicyManager(graph_client)
risk_mgr.create_comprehensive_risk_policy()
```

## Session Controls

```python
class SessionControlManager:
    """Manage session controls for Fabric."""

    def __init__(self, graph_client):
        self.graph = graph_client
        self.ca_mgr = ConditionalAccessManager(graph_client)

    def create_sign_in_frequency_policy(
        self,
        name: str,
        frequency_hours: int,
        target_groups: List[str]
    ):
        """Require re-authentication after specified period."""
        conditions = {
            "users": {
                "includeGroups": target_groups
            },
            "applications": {
                "includeApplications": [ConditionalAccessManager.FABRIC_APP_ID]
            }
        }

        session_controls = {
            "signInFrequency": {
                "value": frequency_hours,
                "type": "hours",
                "isEnabled": True
            }
        }

        policy = ConditionalAccessPolicy(
            display_name=name,
            conditions=conditions,
            grant_controls=[GrantControl.MFA],
            session_controls=session_controls
        )

        return self.ca_mgr.create_policy(policy)

    def create_persistent_browser_policy(
        self,
        name: str,
        allow_persistent: bool = False
    ):
        """Control browser session persistence."""
        conditions = {
            "users": {
                "includeUsers": ["All"]
            },
            "applications": {
                "includeApplications": [ConditionalAccessManager.FABRIC_APP_ID]
            },
            "clientAppTypes": ["browser"]
        }

        session_controls = {
            "persistentBrowser": {
                "mode": "always" if allow_persistent else "never",
                "isEnabled": True
            }
        }

        policy = ConditionalAccessPolicy(
            display_name=name,
            conditions=conditions,
            grant_controls=[],
            session_controls=session_controls
        )

        return self.ca_mgr.create_policy(policy)

    def create_continuous_access_evaluation_policy(
        self,
        name: str,
        mode: str = "strictEnforcement"
    ):
        """Enable Continuous Access Evaluation."""
        conditions = {
            "users": {
                "includeUsers": ["All"]
            },
            "applications": {
                "includeApplications": [ConditionalAccessManager.FABRIC_APP_ID]
            }
        }

        session_controls = {
            "continuousAccessEvaluation": {
                "mode": mode,  # disabled, strictEnforcement
                "isEnabled": True
            }
        }

        policy = ConditionalAccessPolicy(
            display_name=name,
            conditions=conditions,
            grant_controls=[],
            session_controls=session_controls
        )

        return self.ca_mgr.create_policy(policy)

# Usage
session_mgr = SessionControlManager(graph_client)

# Require re-auth every 8 hours for sensitive groups
session_mgr.create_sign_in_frequency_policy(
    name="Fabric-8Hour-SignIn-Frequency",
    frequency_hours=8,
    target_groups=["Data Engineers", "Data Admins"]
)

# Disable persistent browser sessions
session_mgr.create_persistent_browser_policy(
    name="Fabric-No-Persistent-Browser",
    allow_persistent=False
)

# Enable CAE for real-time policy enforcement
session_mgr.create_continuous_access_evaluation_policy(
    name="Fabric-Enable-CAE",
    mode="strictEnforcement"
)
```

## Policy Monitoring

```python
class CAPolicyMonitor:
    """Monitor Conditional Access policy effectiveness."""

    def __init__(self, graph_client, log_analytics_client):
        self.graph = graph_client
        self.logs = log_analytics_client

    def get_policy_impact(self, policy_id: str, days: int = 7) -> dict:
        """Analyze impact of a specific policy."""
        query = f"""
        SigninLogs
        | where TimeGenerated > ago({days}d)
        | where ConditionalAccessPolicies has '{policy_id}'
        | extend PolicyResult = tostring(parse_json(ConditionalAccessPolicies)[0].result)
        | summarize
            TotalSignIns = count(),
            Blocked = countif(PolicyResult == "failure"),
            Succeeded = countif(PolicyResult == "success"),
            NotApplied = countif(PolicyResult == "notApplied")
        """

        return self.logs.query(query)

    def get_blocked_sign_ins(self, days: int = 7) -> List[dict]:
        """Get all blocked sign-ins."""
        query = f"""
        SigninLogs
        | where TimeGenerated > ago({days}d)
        | where ResultType != 0
        | where AppDisplayName has "Fabric" or AppDisplayName has "Power BI"
        | project
            TimeGenerated,
            UserPrincipalName,
            AppDisplayName,
            ResultType,
            ResultDescription,
            Location,
            DeviceDetail,
            ConditionalAccessStatus,
            ConditionalAccessPolicies
        | order by TimeGenerated desc
        """

        return self.logs.query(query)

    def get_mfa_usage_report(self, days: int = 30) -> dict:
        """Report on MFA usage for Fabric."""
        query = f"""
        SigninLogs
        | where TimeGenerated > ago({days}d)
        | where AppDisplayName has "Fabric" or AppDisplayName has "Power BI"
        | summarize
            TotalSignIns = count(),
            MFASatisfied = countif(AuthenticationRequirement == "multiFactorAuthentication"),
            SingleFactor = countif(AuthenticationRequirement == "singleFactorAuthentication")
        by bin(TimeGenerated, 1d)
        | order by TimeGenerated asc
        """

        return self.logs.query(query)

    def simulate_policy(
        self,
        policy_id: str,
        user_id: str,
        conditions: dict
    ) -> dict:
        """Simulate policy evaluation (What If)."""
        return self.graph.conditional_access_policies.evaluate(
            policy_id=policy_id,
            user_id=user_id,
            conditions=conditions
        )

# Usage
monitor = CAPolicyMonitor(graph_client, log_analytics_client)

# Check policy impact
impact = monitor.get_policy_impact("policy-123", days=7)
print(f"Blocked: {impact['Blocked']}, Succeeded: {impact['Succeeded']}")

# Get blocked sign-ins for investigation
blocked = monitor.get_blocked_sign_ins(days=1)
for signin in blocked[:10]:
    print(f"{signin['TimeGenerated']}: {signin['UserPrincipalName']} - {signin['ResultDescription']}")
```

## Best Practices

1. **Start in report-only mode** - Test before enforcing
2. **Use named locations** - Cleaner policy management
3. **Exclude break-glass accounts** - Emergency access
4. **Layer policies** - Don't rely on single policy
5. **Monitor continuously** - Track effectiveness

## What's Next

Tomorrow I'll cover network security in Microsoft Fabric.

## Resources

- [Conditional Access for Power BI and Fabric](https://learn.microsoft.com/fabric/security/conditional-access)
- [Microsoft Entra Conditional Access](https://learn.microsoft.com/entra/identity/conditional-access/)
- [Zero Trust Security](https://learn.microsoft.com/security/zero-trust/)
