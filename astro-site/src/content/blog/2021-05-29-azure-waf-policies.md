---
title: "Azure Web Application Firewall: Custom Rules and Policies"
author: Michael John Peña
draft: false
date: 2021-05-29
tags:
  - Azure
  - Security
  - WAF
  - Web Security
  - Application Gateway
---

## WAF Deployment Options

| Platform | Use Case | Global/Regional |
|----------|----------|-----------------|
| Application Gateway | Regional apps, traditional | Regional |
| Front Door | Global apps, edge protection | Global |
| CDN | Static content protection | Global |

## Creating WAF Policies

### Application Gateway WAF Policy

```bash
# Create WAF policy
az network application-gateway waf-policy create \
    --name web-waf-policy \
    --resource-group my-rg \
    --location eastus

# Enable OWASP managed rules
az network application-gateway waf-policy managed-rule rule-set add \
    --policy-name web-waf-policy \
    --resource-group my-rg \
    --type OWASP \
    --version 3.2
```

### Front Door WAF Policy

```bash
# Create Front Door WAF policy
az network front-door waf-policy create \
    --name frontdoor-waf-policy \
    --resource-group my-rg \
    --mode Prevention \
    --sku Premium_AzureFrontDoor

# Add managed rule set
az network front-door waf-policy managed-rule-definition add \
    --policy-name frontdoor-waf-policy \
    --resource-group my-rg \
    --type Microsoft_DefaultRuleSet \
    --version 2.0
```

## Managed Rule Sets

### OWASP Core Rule Set

```python
from azure.mgmt.network import NetworkManagementClient

# Configure OWASP rules with exclusions
waf_policy = {
    "location": "eastus",
    "managed_rules": {
        "managed_rule_sets": [
            {
                "rule_set_type": "OWASP",
                "rule_set_version": "3.2",
                "rule_group_overrides": [
                    {
                        "rule_group_name": "REQUEST-942-APPLICATION-ATTACK-SQLI",
                        "rules": [
                            {
                                "rule_id": "942430",
                                "state": "Disabled"  # Disable false-positive rule
                            }
                        ]
                    }
                ]
            }
        ],
        "exclusions": [
            {
                "match_variable": "RequestHeaderNames",
                "selector_match_operator": "Equals",
                "selector": "X-Custom-Header"
            },
            {
                "match_variable": "RequestCookieNames",
                "selector_match_operator": "StartsWith",
                "selector": "session_"
            }
        ]
    }
}
```

### Bot Protection Rules

```bash
# Add bot protection
az network application-gateway waf-policy managed-rule rule-set add \
    --policy-name web-waf-policy \
    --resource-group my-rg \
    --type Microsoft_BotManagerRuleSet \
    --version 1.0
```

## Custom Rules

### Rate Limiting

```python
# Rate limit by client IP
rate_limit_rule = {
    "name": "RateLimitByIP",
    "priority": 1,
    "rule_type": "RateLimitRule",
    "rate_limit_duration": "OneMin",
    "rate_limit_threshold": 100,
    "match_conditions": [
        {
            "match_variables": [
                {
                    "variable_name": "RemoteAddr"
                }
            ],
            "operator": "IPMatch",
            "negation_condition": False,
            "match_values": ["0.0.0.0/0"],  # All IPs
            "transforms": []
        }
    ],
    "action": "Block"
}
```

### Geo-Blocking

```python
# Block traffic from specific countries
geo_block_rule = {
    "name": "GeoBlockRule",
    "priority": 2,
    "rule_type": "MatchRule",
    "match_conditions": [
        {
            "match_variables": [
                {
                    "variable_name": "RemoteAddr"
                }
            ],
            "operator": "GeoMatch",
            "negation_condition": False,
            "match_values": ["CN", "RU", "KP"],  # Countries to block
            "transforms": []
        }
    ],
    "action": "Block"
}
```

### Block Specific Paths

```python
# Block access to admin paths from external IPs
admin_protection_rule = {
    "name": "ProtectAdminPaths",
    "priority": 3,
    "rule_type": "MatchRule",
    "match_conditions": [
        {
            "match_variables": [
                {
                    "variable_name": "RequestUri"
                }
            ],
            "operator": "Contains",
            "negation_condition": False,
            "match_values": ["/admin", "/wp-admin", "/administrator"],
            "transforms": ["Lowercase"]
        },
        {
            "match_variables": [
                {
                    "variable_name": "RemoteAddr"
                }
            ],
            "operator": "IPMatch",
            "negation_condition": True,  # NOT in allowed IPs
            "match_values": ["10.0.0.0/8", "192.168.1.0/24"],
            "transforms": []
        }
    ],
    "action": "Block"
}
```

### Header Validation

```python
# Require specific header for API access
api_header_rule = {
    "name": "RequireAPIKey",
    "priority": 4,
    "rule_type": "MatchRule",
    "match_conditions": [
        {
            "match_variables": [
                {
                    "variable_name": "RequestUri"
                }
            ],
            "operator": "BeginsWith",
            "match_values": ["/api/"],
            "transforms": ["Lowercase"]
        },
        {
            "match_variables": [
                {
                    "variable_name": "RequestHeaders",
                    "selector": "X-API-Key"
                }
            ],
            "operator": "Equal",
            "negation_condition": True,  # Header NOT present
            "match_values": [""],
            "transforms": []
        }
    ],
    "action": "Block"
}
```

## WAF Modes

```bash
# Detection mode - log but don't block
az network application-gateway waf-policy update \
    --name web-waf-policy \
    --resource-group my-rg \
    --set policySettings.mode=Detection

# Prevention mode - actively block
az network application-gateway waf-policy update \
    --name web-waf-policy \
    --resource-group my-rg \
    --set policySettings.mode=Prevention
```

## Logging and Diagnostics

```bash
# Enable WAF logs
az monitor diagnostic-settings create \
    --name waf-diagnostics \
    --resource /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/web-waf-policy \
    --workspace /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.OperationalInsights/workspaces/security-workspace \
    --logs '[
        {"category": "ApplicationGatewayAccessLog", "enabled": true},
        {"category": "ApplicationGatewayFirewallLog", "enabled": true}
    ]'
```

### Log Analytics Queries

```kusto
// WAF blocked requests
AzureDiagnostics
| where ResourceType == "APPLICATIONGATEWAYS"
| where Category == "ApplicationGatewayFirewallLog"
| where action_s == "Blocked"
| project
    TimeGenerated,
    clientIp_s,
    requestUri_s,
    ruleId_s,
    message
| order by TimeGenerated desc

// Top blocked rules
AzureDiagnostics
| where Category == "ApplicationGatewayFirewallLog"
| where action_s == "Blocked"
| summarize count() by ruleId_s, Message
| order by count_ desc
| take 20

// Blocked requests by country
AzureDiagnostics
| where Category == "ApplicationGatewayFirewallLog"
| where action_s == "Blocked"
| extend GeoInfo = geo_info_from_ip_address(clientIp_s)
| summarize count() by tostring(GeoInfo.country)
| order by count_ desc

// Detection vs Prevention comparison
AzureDiagnostics
| where Category == "ApplicationGatewayFirewallLog"
| summarize
    Detected = countif(action_s == "Detected"),
    Blocked = countif(action_s == "Blocked")
    by bin(TimeGenerated, 1h)
| render timechart
```

## False Positive Handling

```python
def analyze_waf_false_positives(workspace_id, days=7):
    """Analyze potential false positives in WAF logs"""

    query = f"""
    AzureDiagnostics
    | where TimeGenerated > ago({days}d)
    | where Category == "ApplicationGatewayFirewallLog"
    | where action_s == "Blocked"
    | summarize
        BlockCount = count(),
        UniqueIPs = dcount(clientIp_s),
        SampleRequests = make_set(requestUri_s, 5)
        by ruleId_s, Message
    | where BlockCount > 100 and UniqueIPs > 10
    | order by BlockCount desc
    """

    # High block count from many IPs might indicate false positive
    return execute_log_analytics_query(workspace_id, query)

def create_exclusion_for_false_positive(policy_name, rg, rule_id, exclusion):
    """Create exclusion for identified false positive"""

    # Add exclusion to policy
    exclusion_config = {
        "match_variable": exclusion["variable"],
        "selector_match_operator": exclusion["operator"],
        "selector": exclusion["selector"]
    }

    # Apply via Azure CLI or SDK
    return exclusion_config
```

## Integration with Application Gateway

```bash
# Create Application Gateway with WAF
az network application-gateway create \
    --name my-appgw \
    --resource-group my-rg \
    --location eastus \
    --sku WAF_v2 \
    --capacity 2 \
    --vnet-name my-vnet \
    --subnet appgw-subnet \
    --public-ip-address appgw-pip \
    --http-settings-cookie-based-affinity Disabled \
    --frontend-port 443 \
    --http-settings-port 80 \
    --http-settings-protocol Http \
    --routing-rule-type Basic \
    --waf-policy web-waf-policy

# Associate WAF policy with listener
az network application-gateway http-listener update \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --name https-listener \
    --waf-policy web-waf-policy
```

## Best Practices

1. **Start in Detection mode**: Analyze logs before enabling Prevention
2. **Tune exclusions**: Add exclusions for legitimate traffic patterns
3. **Use managed rules**: Keep rule sets updated automatically
4. **Layer with custom rules**: Add business-specific protections
5. **Monitor continuously**: Set up alerts for anomalies

## Resources

- [Azure WAF Documentation](https://docs.microsoft.com/en-us/azure/web-application-firewall/)
- [OWASP Rule Set](https://docs.microsoft.com/en-us/azure/web-application-firewall/ag/application-gateway-crs-rulegroups-rules)
- [Custom Rules](https://docs.microsoft.com/en-us/azure/web-application-firewall/ag/custom-waf-rules-overview)
