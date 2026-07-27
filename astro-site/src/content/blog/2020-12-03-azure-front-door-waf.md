---
title: "Azure Front Door WAF: Web Application Firewall"
author: Michael John Peña
draft: false
date: 2020-12-03
tags:
  - Azure
  - Front Door
  - Security
  - WAF
---

A WAF in front of every public app is no longer a nice-to-have. Bots scan you within minutes of going live, and "we'll add WAF later" is how breaches happen. Front Door's WAF is the option I default to for global apps: managed rule sets aligned to OWASP, custom rules for IP/geo/header logic, and bot manager add-ons. Tune the rule set in detection mode first—prevention mode on day one will block legitimate traffic and you'll spend a week explaining yourself.

## WAF Policy

```bash
# Create WAF policy
az network front-door waf-policy create \
    --name myWAFPolicy \
    --resource-group myRG \
    --mode Prevention \
    --sku Premium_AzureFrontDoor
```

## Managed Rule Sets

```bash
# Add OWASP rule set
az network front-door waf-policy managed-rules add \
    --policy-name myWAFPolicy \
    --resource-group myRG \
    --type Microsoft_DefaultRuleSet \
    --version 2.1

# Add bot protection
az network front-door waf-policy managed-rules add \
    --policy-name myWAFPolicy \
    --resource-group myRG \
    --type Microsoft_BotManagerRuleSet \
    --version 1.0
```

## Rule Set Categories

| Category | Protection |
|----------|------------|
| SQL Injection | `SELECT * FROM; DROP TABLE` |
| XSS | `<script>alert(1)</script>` |
| Local File Inclusion | `../../../etc/passwd` |
| Remote Code Execution | Shell commands |
| Protocol Violations | Malformed requests |
| Bot Protection | Bad bots, crawlers |

## Custom Rules

```bash
# Block specific IPs
az network front-door waf-policy rule create \
    --policy-name myWAFPolicy \
    --resource-group myRG \
    --name BlockBadIPs \
    --priority 100 \
    --rule-type MatchRule \
    --action Block \
    --match-conditions '[{
        "matchVariable": "RemoteAddr",
        "operator": "IPMatch",
        "matchValue": ["192.0.2.0/24", "198.51.100.0/24"]
    }]'
```

## Rate Limiting

```bash
# Rate limit by IP
az network front-door waf-policy rule create \
    --policy-name myWAFPolicy \
    --resource-group myRG \
    --name RateLimitByIP \
    --priority 200 \
    --rule-type RateLimitRule \
    --action Block \
    --rate-limit-threshold 1000 \
    --rate-limit-duration-in-minutes 1 \
    --match-conditions '[{
        "matchVariable": "RequestUri",
        "operator": "Contains",
        "matchValue": ["/api/"]
    }]'
```

## Geo-Filtering

```bash
# Block specific countries
az network front-door waf-policy rule create \
    --policy-name myWAFPolicy \
    --resource-group myRG \
    --name GeoBlock \
    --priority 300 \
    --rule-type MatchRule \
    --action Block \
    --match-conditions '[{
        "matchVariable": "SocketAddr",
        "operator": "GeoMatch",
        "matchValue": ["CN", "RU", "KP"]
    }]'
```

## Rule Exclusions

```json
{
    "exclusions": [
        {
            "matchVariable": "RequestHeaderNames",
            "selectorMatchOperator": "Equals",
            "selector": "x-custom-header"
        },
        {
            "matchVariable": "RequestBodyPostArgNames",
            "selectorMatchOperator": "StartsWith",
            "selector": "ignore_"
        }
    ]
}
```

## Associate with Front Door

```bash
# Link WAF policy to Front Door endpoint
az afd security-policy create \
    --profile-name myFrontDoor \
    --resource-group myRG \
    --security-policy-name mySecurityPolicy \
    --domains /subscriptions/.../afdEndpoints/myEndpoint \
    --waf-policy /subscriptions/.../FrontDoorWebApplicationFirewallPolicies/myWAFPolicy
```

## Monitoring and Logs

```kusto
// WAF logs query
AzureDiagnostics
| where Category == "FrontDoorWebApplicationFirewallLog"
| where action_s == "Block"
| project
    TimeGenerated,
    clientIP_s,
    requestUri_s,
    ruleName_s,
    details_msg_s
| order by TimeGenerated desc
| take 100
```

## Detection vs Prevention

```bash
# Detection mode (log only)
az network front-door waf-policy update \
    --name myWAFPolicy \
    --resource-group myRG \
    --mode Detection

# Prevention mode (block attacks)
az network front-door waf-policy update \
    --name myWAFPolicy \
    --resource-group myRG \
    --mode Prevention
```

## Best Practices

1. Start in Detection mode
2. Analyze logs for false positives
3. Create exclusions as needed
4. Switch to Prevention mode
5. Monitor continuously

Front Door WAF: your first line of defense.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
