---
title: Advanced Traffic Management with Azure Front Door Rules Engine
description: "Front Door's global load balancing and caching are easy to understand. The Rules Engine is the part that turns it into a real edge platform. Conditions on…"
author: Michael John Peña
draft: false
date: 2021-02-09
url: /blog/azure-front-door-rules-engine/
tags:
  - Azure
  - Front Door
  - CDN
  - Networking
  - Traffic Management
---

Front Door's global load balancing and caching are easy to understand. The Rules Engine is the part that turns it into a real edge platform. Conditions on request URL, headers, query string, device type, HTTP method—and actions that redirect, rewrite, modify headers, change origin, or override caching behaviour. I've used it to enforce HTTPS without a backend change, route `/api/*` and `/app/*` to different origins from a single domain, and implement country-based redirects that would otherwise require code. Once you think in rules, the architecture possibilities expand considerably.

## Understanding Rules Engine

The Rules Engine processes requests in order of rule priority. Each rule consists of:

- **Match conditions** - What requests to apply the rule to
- **Actions** - What to do with matching requests

Rules are evaluated top to bottom, and multiple rules can match a single request.

## Creating Rules Engine Configuration

Let's create a comprehensive Rules Engine configuration using Azure CLI:

```bash
# Create a Front Door instance first
az network front-door create \
    --name myFrontDoor \
    --resource-group myResourceGroup \
    --backend-address myapp.azurewebsites.net \
    --frontend-host-name myapp.azurefd.net

# Create Rules Engine configuration
az network front-door rules-engine create \
    --front-door-name myFrontDoor \
    --resource-group myResourceGroup \
    --name MyRulesEngine
```

## Common Rule Patterns

### 1. Force HTTPS Redirect

```json
{
    "name": "EnforceHTTPS",
    "priority": 1,
    "matchConditions": [
        {
            "matchVariable": "RequestScheme",
            "operator": "Equal",
            "matchValue": ["HTTP"]
        }
    ],
    "actions": [
        {
            "actionType": "Redirect",
            "redirectType": "Moved",
            "redirectProtocol": "HttpsOnly"
        }
    ]
}
```

### 2. WWW to Non-WWW Redirect

```json
{
    "name": "RemoveWWW",
    "priority": 2,
    "matchConditions": [
        {
            "matchVariable": "RequestHeader",
            "selector": "Host",
            "operator": "BeginsWith",
            "matchValue": ["www."]
        }
    ],
    "actions": [
        {
            "actionType": "Redirect",
            "redirectType": "PermanentRedirect",
            "redirectProtocol": "MatchRequest",
            "customHost": "myapp.com"
        }
    ]
}
```

### 3. Add Security Headers

```json
{
    "name": "SecurityHeaders",
    "priority": 3,
    "matchConditions": [
        {
            "matchVariable": "RequestUri",
            "operator": "Any"
        }
    ],
    "actions": [
        {
            "actionType": "ModifyResponseHeader",
            "headerAction": "Overwrite",
            "headerName": "X-Content-Type-Options",
            "headerValue": "nosniff"
        },
        {
            "actionType": "ModifyResponseHeader",
            "headerAction": "Overwrite",
            "headerName": "X-Frame-Options",
            "headerValue": "SAMEORIGIN"
        },
        {
            "actionType": "ModifyResponseHeader",
            "headerAction": "Overwrite",
            "headerName": "X-XSS-Protection",
            "headerValue": "1; mode=block"
        },
        {
            "actionType": "ModifyResponseHeader",
            "headerAction": "Overwrite",
            "headerName": "Strict-Transport-Security",
            "headerValue": "max-age=31536000; includeSubDomains"
        },
        {
            "actionType": "ModifyResponseHeader",
            "headerAction": "Overwrite",
            "headerName": "Content-Security-Policy",
            "headerValue": "default-src 'self'; script-src 'self' 'unsafe-inline'"
        }
    ]
}
```

## Implementing with ARM Template

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "frontDoorName": {
            "type": "string"
        }
    },
    "resources": [
        {
            "type": "Microsoft.Network/frontDoors/rulesEngines",
            "apiVersion": "2020-05-01",
            "name": "[concat(parameters('frontDoorName'), '/AdvancedRules')]",
            "properties": {
                "rules": [
                    {
                        "name": "EnforceHTTPS",
                        "priority": 1,
                        "action": {
                            "requestHeaderActions": [],
                            "responseHeaderActions": [],
                            "routeConfigurationOverride": {
                                "@odata.type": "#Microsoft.Azure.FrontDoor.Models.FrontdoorRedirectConfiguration",
                                "redirectType": "Moved",
                                "redirectProtocol": "HttpsOnly"
                            }
                        },
                        "matchConditions": [
                            {
                                "rulesEngineMatchVariable": "RequestScheme",
                                "rulesEngineOperator": "Equal",
                                "rulesEngineMatchValue": ["HTTP"]
                            }
                        ]
                    },
                    {
                        "name": "GeoblockingRule",
                        "priority": 2,
                        "action": {
                            "requestHeaderActions": [],
                            "responseHeaderActions": [],
                            "routeConfigurationOverride": {
                                "@odata.type": "#Microsoft.Azure.FrontDoor.Models.FrontdoorRedirectConfiguration",
                                "redirectType": "Found",
                                "redirectProtocol": "HttpsOnly",
                                "customPath": "/blocked.html"
                            }
                        },
                        "matchConditions": [
                            {
                                "rulesEngineMatchVariable": "RemoteAddress",
                                "rulesEngineOperator": "GeoMatch",
                                "rulesEngineMatchValue": ["CN", "RU"],
                                "negateCondition": false
                            }
                        ]
                    },
                    {
                        "name": "APIVersioning",
                        "priority": 3,
                        "action": {
                            "requestHeaderActions": [
                                {
                                    "headerActionType": "Overwrite",
                                    "headerName": "X-API-Version",
                                    "value": "v2"
                                }
                            ],
                            "responseHeaderActions": []
                        },
                        "matchConditions": [
                            {
                                "rulesEngineMatchVariable": "RequestPath",
                                "rulesEngineOperator": "BeginsWith",
                                "rulesEngineMatchValue": ["/api/"]
                            }
                        ]
                    },
                    {
                        "name": "MobileRedirect",
                        "priority": 4,
                        "action": {
                            "requestHeaderActions": [],
                            "responseHeaderActions": [],
                            "routeConfigurationOverride": {
                                "@odata.type": "#Microsoft.Azure.FrontDoor.Models.FrontdoorRedirectConfiguration",
                                "redirectType": "Found",
                                "redirectProtocol": "HttpsOnly",
                                "customHost": "m.myapp.com"
                            }
                        },
                        "matchConditions": [
                            {
                                "rulesEngineMatchVariable": "RequestHeader",
                                "selector": "User-Agent",
                                "rulesEngineOperator": "Contains",
                                "rulesEngineMatchValue": ["Mobile", "Android", "iPhone"],
                                "transforms": ["Lowercase"]
                            }
                        ],
                        "matchProcessingBehavior": "Stop"
                    }
                ]
            }
        }
    ]
}
```

## A/B Testing with Rules Engine

Implement A/B testing by routing traffic based on cookies or headers:

```python
import requests
import json

def configure_ab_testing(subscription_id, resource_group, front_door_name):
    """Configure A/B testing rules for Front Door."""

    rules_engine_config = {
        "properties": {
            "rules": [
                {
                    "name": "ABTestVariantA",
                    "priority": 1,
                    "action": {
                        "requestHeaderActions": [
                            {
                                "headerActionType": "Overwrite",
                                "headerName": "X-AB-Test",
                                "value": "variant-a"
                            }
                        ],
                        "routeConfigurationOverride": {
                            "@odata.type": "#Microsoft.Azure.FrontDoor.Models.FrontdoorForwardingConfiguration",
                            "backendPool": {
                                "id": f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/frontDoors/{front_door_name}/backendPools/VariantA"
                            }
                        }
                    },
                    "matchConditions": [
                        {
                            "rulesEngineMatchVariable": "RequestHeader",
                            "selector": "Cookie",
                            "rulesEngineOperator": "Contains",
                            "rulesEngineMatchValue": ["ab_test=variant_a"]
                        }
                    ]
                },
                {
                    "name": "ABTestVariantB",
                    "priority": 2,
                    "action": {
                        "requestHeaderActions": [
                            {
                                "headerActionType": "Overwrite",
                                "headerName": "X-AB-Test",
                                "value": "variant-b"
                            }
                        ],
                        "routeConfigurationOverride": {
                            "@odata.type": "#Microsoft.Azure.FrontDoor.Models.FrontdoorForwardingConfiguration",
                            "backendPool": {
                                "id": f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/frontDoors/{front_door_name}/backendPools/VariantB"
                            }
                        }
                    },
                    "matchConditions": [
                        {
                            "rulesEngineMatchVariable": "RequestHeader",
                            "selector": "Cookie",
                            "rulesEngineOperator": "Contains",
                            "rulesEngineMatchValue": ["ab_test=variant_b"]
                        }
                    ]
                },
                {
                    "name": "ABTestNewUsers",
                    "priority": 3,
                    "action": {
                        "responseHeaderActions": [
                            {
                                "headerActionType": "Overwrite",
                                "headerName": "Set-Cookie",
                                "value": "ab_test=variant_a; Path=/; Max-Age=2592000"
                            }
                        ],
                        "routeConfigurationOverride": {
                            "@odata.type": "#Microsoft.Azure.FrontDoor.Models.FrontdoorForwardingConfiguration",
                            "backendPool": {
                                "id": f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/frontDoors/{front_door_name}/backendPools/VariantA"
                            }
                        }
                    },
                    "matchConditions": [
                        {
                            "rulesEngineMatchVariable": "RequestHeader",
                            "selector": "Cookie",
                            "rulesEngineOperator": "Contains",
                            "rulesEngineMatchValue": ["ab_test"],
                            "negateCondition": True
                        }
                    ]
                }
            ]
        }
    }

    return rules_engine_config
```

## URL Rewriting

Rewrite URLs without client-side redirects:

```json
{
    "name": "RewriteAPIPath",
    "priority": 5,
    "action": {
        "requestHeaderActions": [],
        "responseHeaderActions": [],
        "routeConfigurationOverride": {
            "@odata.type": "#Microsoft.Azure.FrontDoor.Models.FrontdoorForwardingConfiguration",
            "customForwardingPath": "/v2/",
            "forwardingProtocol": "HttpsOnly",
            "backendPool": {
                "id": "/subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.Network/frontDoors/{fd}/backendPools/APIPool"
            }
        }
    },
    "matchConditions": [
        {
            "rulesEngineMatchVariable": "RequestPath",
            "rulesEngineOperator": "BeginsWith",
            "rulesEngineMatchValue": ["/api/v1/"]
        }
    ]
}
```

## Cache Control Rules

Control caching behavior at the edge:

```json
{
    "name": "StaticAssetCaching",
    "priority": 6,
    "action": {
        "responseHeaderActions": [
            {
                "headerActionType": "Overwrite",
                "headerName": "Cache-Control",
                "value": "public, max-age=31536000, immutable"
            }
        ],
        "routeConfigurationOverride": {
            "@odata.type": "#Microsoft.Azure.FrontDoor.Models.FrontdoorForwardingConfiguration",
            "cacheConfiguration": {
                "queryParameterStripDirective": "StripNone",
                "dynamicCompression": "Enabled",
                "cacheDuration": "P365D"
            }
        }
    },
    "matchConditions": [
        {
            "rulesEngineMatchVariable": "RequestFilenameExtension",
            "rulesEngineOperator": "Equal",
            "rulesEngineMatchValue": ["js", "css", "png", "jpg", "gif", "svg", "woff", "woff2"]
        }
    ]
}
```

## Monitoring Rules Engine

Query Front Door logs to analyze rule effectiveness:

```kusto
// Rules Engine rule hits
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.NETWORK"
| where Category == "FrontdoorAccessLog"
| where isnotempty(rulesEngineMatchNames_s)
| extend RulesMatched = split(rulesEngineMatchNames_s, ",")
| mv-expand RulesMatched
| summarize Count = count() by tostring(RulesMatched), bin(TimeGenerated, 1h)
| render timechart

// Rule processing time
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.NETWORK"
| where Category == "FrontdoorAccessLog"
| where isnotempty(rulesEngineMatchNames_s)
| summarize
    AvgTimeTaken = avg(timeTaken_d),
    P95TimeTaken = percentile(timeTaken_d, 95),
    RequestCount = count()
    by rulesEngineMatchNames_s
| order by RequestCount desc

// Redirect rule effectiveness
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.NETWORK"
| where Category == "FrontdoorAccessLog"
| where httpStatusCode_d in (301, 302, 307, 308)
| summarize Count = count() by httpStatusCode_d, requestUri_s
| order by Count desc
| take 100
```

## Best Practices

1. **Order Rules by Priority**: Most specific rules should have higher priority
2. **Use Stop Processing**: Use `matchProcessingBehavior: "Stop"` when you don't want further rules to apply
3. **Test Thoroughly**: Test rules in a staging environment first
4. **Monitor Performance**: Track rule processing time and effectiveness
5. **Document Rules**: Maintain documentation for complex rule logic
6. **Version Control**: Store rules configuration in source control

## Conclusion

Azure Front Door Rules Engine provides powerful capabilities for customizing traffic handling at the edge. By combining match conditions and actions, you can implement complex routing logic, security headers, A/B testing, and caching strategies without modifying your backend applications.

Start with simple rules like HTTPS enforcement and gradually add more sophisticated logic as needed.
