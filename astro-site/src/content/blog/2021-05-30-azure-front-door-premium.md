---
title: "Azure Front Door Standard/Premium: Global Application Delivery"
author: Michael John Peña
draft: false
date: 2021-05-30
tags:
  - Azure
  - Networking
  - CDN
  - Front Door
  - Performance
---

Azure Front Door Standard/Premium is the convergence I've been waiting for since the days when you had to choose between classic Front Door (global routing and WAF), Azure CDN (content delivery), and API Management (API gateway) as separate services with different management planes. Standard/Premium unifies global HTTP load balancing, CDN edge caching, WAF at the edge, Private Link to origin, and health probes into one resource. Premium adds the Private Link origin support and security analytics that Standard omits. For applications that need global reach, DDoS mitigation at the edge, and WAF without a separate deployment, Front Door Premium is the right top-of-stack choice.

## Standard vs Premium

| Feature | Standard | Premium |
|---------|----------|---------|
| Global HTTP load balancing | Yes | Yes |
| SSL offload | Yes | Yes |
| Custom domains | Yes | Yes |
| Caching | Yes | Yes |
| Compression | Yes | Yes |
| URL redirect/rewrite | Yes | Yes |
| WAF | Managed rules | Managed + Custom + Bot |
| Private Link | No | Yes |
| Enhanced analytics | No | Yes |

## Creating Front Door

```bash
# Create Front Door profile
az afd profile create \
    --profile-name my-frontdoor \
    --resource-group my-rg \
    --sku Premium_AzureFrontDoor

# Create endpoint
az afd endpoint create \
    --profile-name my-frontdoor \
    --resource-group my-rg \
    --endpoint-name myapp \
    --enabled-state Enabled

# Create origin group
az afd origin-group create \
    --profile-name my-frontdoor \
    --resource-group my-rg \
    --origin-group-name primary-origins \
    --probe-request-type HEAD \
    --probe-protocol Https \
    --probe-path /health \
    --probe-interval-in-seconds 30 \
    --sample-size 4 \
    --successful-samples-required 3

# Add origins
az afd origin create \
    --profile-name my-frontdoor \
    --resource-group my-rg \
    --origin-group-name primary-origins \
    --origin-name webapp-eastus \
    --host-name myapp-eastus.azurewebsites.net \
    --origin-host-header myapp-eastus.azurewebsites.net \
    --priority 1 \
    --weight 1000 \
    --enabled-state Enabled \
    --http-port 80 \
    --https-port 443

az afd origin create \
    --profile-name my-frontdoor \
    --resource-group my-rg \
    --origin-group-name primary-origins \
    --origin-name webapp-westus \
    --host-name myapp-westus.azurewebsites.net \
    --origin-host-header myapp-westus.azurewebsites.net \
    --priority 1 \
    --weight 1000 \
    --enabled-state Enabled
```

## Route Configuration

```bash
# Create route
az afd route create \
    --profile-name my-frontdoor \
    --resource-group my-rg \
    --endpoint-name myapp \
    --route-name default-route \
    --origin-group primary-origins \
    --supported-protocols Https \
    --https-redirect Enabled \
    --patterns-to-match "/*" \
    --forwarding-protocol HttpsOnly \
    --link-to-default-domain Enabled

# Create route for API with different origin
az afd route create \
    --profile-name my-frontdoor \
    --resource-group my-rg \
    --endpoint-name myapp \
    --route-name api-route \
    --origin-group api-origins \
    --patterns-to-match "/api/*" \
    --forwarding-protocol HttpsOnly \
    --cache-configuration '{"queryStringCachingBehavior": "IgnoreQueryString"}'
```

## Rules Engine

Configure advanced routing rules:

```python
from azure.mgmt.frontdoor import FrontDoorManagementClient

# Create rule set
rule_set = frontdoor_client.rule_sets.create(
    resource_group_name="my-rg",
    profile_name="my-frontdoor",
    rule_set_name="security-rules"
)

# Add security headers rule
security_headers_rule = {
    "name": "AddSecurityHeaders",
    "order": 1,
    "conditions": [
        {
            "name": "UrlPath",
            "parameters": {
                "typeName": "DeliveryRuleUrlPathMatchConditionParameters",
                "operator": "Any"
            }
        }
    ],
    "actions": [
        {
            "name": "ModifyResponseHeader",
            "parameters": {
                "typeName": "DeliveryRuleHeaderActionParameters",
                "headerAction": "Overwrite",
                "headerName": "X-Content-Type-Options",
                "value": "nosniff"
            }
        },
        {
            "name": "ModifyResponseHeader",
            "parameters": {
                "headerAction": "Overwrite",
                "headerName": "X-Frame-Options",
                "value": "DENY"
            }
        },
        {
            "name": "ModifyResponseHeader",
            "parameters": {
                "headerAction": "Overwrite",
                "headerName": "Content-Security-Policy",
                "value": "default-src 'self'"
            }
        }
    ]
}

# URL rewrite rule
rewrite_rule = {
    "name": "RewriteApiVersions",
    "order": 2,
    "conditions": [
        {
            "name": "UrlPath",
            "parameters": {
                "operator": "BeginsWith",
                "matchValues": ["/api/v1/"]
            }
        }
    ],
    "actions": [
        {
            "name": "UrlRewrite",
            "parameters": {
                "sourcePattern": "/api/v1/(.*)",
                "destination": "/api/current/$1",
                "preserveUnmatchedPath": False
            }
        }
    ]
}

# Redirect rule
redirect_rule = {
    "name": "RedirectWWW",
    "order": 3,
    "conditions": [
        {
            "name": "HostName",
            "parameters": {
                "operator": "Equal",
                "matchValues": ["www.contoso.com"]
            }
        }
    ],
    "actions": [
        {
            "name": "UrlRedirect",
            "parameters": {
                "redirectType": "PermanentRedirect",
                "destinationProtocol": "Https",
                "customHostname": "contoso.com"
            }
        }
    ]
}
```

## Caching Configuration

```python
# Configure caching behavior
cache_config = {
    "caching_behavior": "HonorOrigin",  # or OverrideAlways, OverrideIfOriginMissing, Disabled
    "cache_duration": "1:00:00",  # 1 hour
    "query_string_caching_behavior": "UseQueryString",
    "compression_settings": {
        "is_compression_enabled": True,
        "content_types_to_compress": [
            "text/html",
            "text/css",
            "text/javascript",
            "application/javascript",
            "application/json",
            "application/xml",
            "image/svg+xml"
        ]
    }
}

# Cache bypass for dynamic content
dynamic_route = {
    "patterns_to_match": ["/api/*", "/auth/*"],
    "cache_configuration": {
        "caching_behavior": "Disabled"
    }
}

# Long cache for static assets
static_route = {
    "patterns_to_match": ["/static/*", "*.js", "*.css", "*.png", "*.jpg"],
    "cache_configuration": {
        "caching_behavior": "OverrideAlways",
        "cache_duration": "7:00:00:00"  # 7 days
    }
}
```

## Private Link Origins (Premium)

Connect to private backends:

```bash
# Create private link origin
az afd origin create \
    --profile-name my-frontdoor \
    --resource-group my-rg \
    --origin-group-name private-origins \
    --origin-name private-webapp \
    --host-name myapp.azurewebsites.net \
    --enable-private-link true \
    --private-link-resource /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Web/sites/myapp \
    --private-link-location eastus \
    --private-link-request-message "Front Door connection"

# Approve private endpoint on the origin side
az network private-endpoint-connection approve \
    --resource-group my-rg \
    --resource-name myapp \
    --type Microsoft.Web/sites \
    --name <connection-name>
```

## Custom Domains and SSL

```bash
# Add custom domain
az afd custom-domain create \
    --profile-name my-frontdoor \
    --resource-group my-rg \
    --custom-domain-name www-contoso \
    --host-name www.contoso.com \
    --certificate-type ManagedCertificate \
    --minimum-tls-version TLS12

# Associate with endpoint
az afd route update \
    --profile-name my-frontdoor \
    --resource-group my-rg \
    --endpoint-name myapp \
    --route-name default-route \
    --custom-domains www-contoso
```

## WAF Integration

```bash
# Create WAF policy
az afd waf-policy create \
    --name frontdoor-waf \
    --resource-group my-rg \
    --sku Premium_AzureFrontDoor \
    --mode Prevention

# Add managed rules
az afd waf-policy managed-rule-set add \
    --policy-name frontdoor-waf \
    --resource-group my-rg \
    --type Microsoft_DefaultRuleSet \
    --version 2.0

# Add bot protection
az afd waf-policy managed-rule-set add \
    --policy-name frontdoor-waf \
    --resource-group my-rg \
    --type Microsoft_BotManagerRuleSet \
    --version 1.0

# Associate with endpoint
az afd security-policy create \
    --profile-name my-frontdoor \
    --resource-group my-rg \
    --security-policy-name waf-security \
    --domains /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Cdn/profiles/my-frontdoor/afdEndpoints/myapp \
    --waf-policy /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/frontdoor-waf
```

## Monitoring and Analytics

```kusto
// Request distribution by POP
AzureDiagnostics
| where ResourceType == "FRONTDOORS"
| summarize count() by pop_s
| render piechart

// Origin health
AzureDiagnostics
| where ResourceType == "FRONTDOORS"
| where Category == "FrontdoorHealthProbeLog"
| summarize
    Healthy = countif(result_s == "Healthy"),
    Unhealthy = countif(result_s == "Unhealthy")
    by origin_s, bin(TimeGenerated, 5m)
| render timechart

// Cache hit ratio
AzureDiagnostics
| where ResourceType == "FRONTDOORS"
| where Category == "FrontdoorAccessLog"
| summarize
    CacheHits = countif(cacheStatus_s in ("HIT", "PARTIAL_HIT")),
    CacheMisses = countif(cacheStatus_s in ("MISS", "NOTCACHEABLE"))
    by bin(TimeGenerated, 1h)
| extend HitRatio = todouble(CacheHits) / (CacheHits + CacheMisses) * 100
| project TimeGenerated, HitRatio
| render timechart

// Response time percentiles
AzureDiagnostics
| where ResourceType == "FRONTDOORS"
| where Category == "FrontdoorAccessLog"
| summarize
    p50 = percentile(timeTaken_d, 50),
    p95 = percentile(timeTaken_d, 95),
    p99 = percentile(timeTaken_d, 99)
    by bin(TimeGenerated, 5m)
| render timechart
```

## Terraform Configuration

```hcl
resource "azurerm_cdn_frontdoor_profile" "main" {
  name                = "my-frontdoor"
  resource_group_name = azurerm_resource_group.main.name
  sku_name            = "Premium_AzureFrontDoor"
}

resource "azurerm_cdn_frontdoor_endpoint" "main" {
  name                     = "myapp"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id
}

resource "azurerm_cdn_frontdoor_origin_group" "main" {
  name                     = "primary-origins"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.main.id

  health_probe {
    interval_in_seconds = 30
    path                = "/health"
    protocol            = "Https"
    request_type        = "HEAD"
  }

  load_balancing {
    sample_size                 = 4
    successful_samples_required = 3
  }
}

resource "azurerm_cdn_frontdoor_origin" "webapp" {
  name                          = "webapp-origin"
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.main.id
  host_name                     = azurerm_linux_web_app.main.default_hostname
  origin_host_header            = azurerm_linux_web_app.main.default_hostname
  certificate_name_check_enabled = true
  enabled                       = true
  http_port                     = 80
  https_port                    = 443
  priority                      = 1
  weight                        = 1000
}

resource "azurerm_cdn_frontdoor_route" "main" {
  name                          = "default-route"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.main.id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.main.id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.webapp.id]

  supported_protocols    = ["Https"]
  patterns_to_match      = ["/*"]
  forwarding_protocol    = "HttpsOnly"
  link_to_default_domain = true
  https_redirect_enabled = true
}
```

## Resources

- [Front Door Documentation](https://docs.microsoft.com/en-us/azure/frontdoor/)
- [Rules Engine](https://docs.microsoft.com/en-us/azure/frontdoor/front-door-rules-engine)
- [Private Link Origins](https://docs.microsoft.com/en-us/azure/frontdoor/private-link)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
