---
title: "Azure Application Gateway v2: Regional Load Balancing Deep Dive"
description: "Application Gateway v2 is where the regional Layer 7 load balancer story became production-serious for enterprise workloads. Autoscaling means you don't…"
author: Michael John Peña
draft: false
date: 2021-05-31
tags:
  - Azure
  - Networking
  - Load Balancing
  - Application Gateway
  - Security
---

Application Gateway v2 is where the regional Layer 7 load balancer story became production-serious for enterprise workloads. Autoscaling means you don't pre-provision for peak—the gateway scales out automatically and you pay for what you use. Zone redundancy puts gateway instances across availability zones so a single zone failure doesn't take down your ingress. The WAF policy integration (shared policies across multiple gateways, per-site WAF overrides, custom rules) is far more flexible than WAF v1's inline configuration. The use cases I deploy it for most often: multi-site hosting with URL-based routing for a microservices application, SSL offload with Key Vault certificate integration, and mutual TLS authentication for B2B API endpoints.

## V1 vs V2

| Feature | Standard V1 | Standard V2 |
|---------|------------|-------------|
| Autoscaling | No | Yes |
| Zone redundancy | No | Yes |
| Static VIP | No | Yes |
| Header rewrite | No | Yes |
| Key Vault integration | No | Yes |
| AKS Ingress Controller | No | Yes |
| Performance | Fixed | Better |

## Creating Application Gateway V2

```bash
# Create public IP
az network public-ip create \
    --name appgw-pip \
    --resource-group my-rg \
    --location eastus \
    --allocation-method Static \
    --sku Standard \
    --zone 1 2 3

# Create Application Gateway
az network application-gateway create \
    --name my-appgw \
    --resource-group my-rg \
    --location eastus \
    --sku Standard_v2 \
    --capacity 2 \
    --vnet-name my-vnet \
    --subnet appgw-subnet \
    --public-ip-address appgw-pip \
    --priority 100

# Enable autoscaling
az network application-gateway update \
    --name my-appgw \
    --resource-group my-rg \
    --set autoscaleConfiguration.minCapacity=2 \
    --set autoscaleConfiguration.maxCapacity=10
```

## Backend Pools

```bash
# Add backend pool with VMs
az network application-gateway address-pool create \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --name web-backend-pool \
    --servers 10.0.1.4 10.0.1.5 10.0.1.6

# Add backend pool with FQDN
az network application-gateway address-pool create \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --name webapp-pool \
    --servers myapp.azurewebsites.net

# Add backend pool with App Service
az network application-gateway address-pool create \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --name api-pool \
    --servers myapi.azurewebsites.net
```

## HTTP Settings

```bash
# Create HTTP settings for web backend
az network application-gateway http-settings create \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --name web-http-settings \
    --port 80 \
    --protocol Http \
    --cookie-based-affinity Enabled \
    --affinity-cookie-name ApplicationGatewayAffinity \
    --timeout 30

# Create HTTPS settings with host header override
az network application-gateway http-settings create \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --name webapp-https-settings \
    --port 443 \
    --protocol Https \
    --host-name-from-backend-pool true \
    --timeout 30 \
    --probe webapp-health-probe
```

## Health Probes

```bash
# Create custom health probe
az network application-gateway probe create \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --name webapp-health-probe \
    --protocol Https \
    --host-name-from-http-settings true \
    --path /health \
    --interval 30 \
    --threshold 3 \
    --timeout 30 \
    --match-status-codes 200-399
```

## URL-Based Routing

```bash
# Create URL path map
az network application-gateway url-path-map create \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --name url-path-map \
    --paths /api/* \
    --address-pool api-pool \
    --http-settings webapp-https-settings \
    --default-address-pool web-backend-pool \
    --default-http-settings web-http-settings

# Add additional path rules
az network application-gateway url-path-map rule create \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --name images-rule \
    --path-map-name url-path-map \
    --paths /images/* /static/* \
    --address-pool cdn-pool \
    --http-settings static-http-settings

# Create routing rule with URL path map
az network application-gateway rule create \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --name path-based-rule \
    --http-listener https-listener \
    --url-path-map url-path-map \
    --priority 100
```

## SSL/TLS Configuration

```python
from azure.mgmt.network import NetworkManagementClient

# Configure SSL profile
ssl_profile = {
    "name": "modern-ssl-profile",
    "ssl_policy": {
        "policy_type": "Custom",
        "min_protocol_version": "TLSv1_2",
        "cipher_suites": [
            "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
            "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
            "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
            "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256"
        ]
    }
}

# Add certificate from Key Vault
ssl_cert = {
    "name": "my-ssl-cert",
    "key_vault_secret_id": "https://my-keyvault.vault.azure.net/secrets/ssl-cert"
}
```

```bash
# Enable Key Vault integration (requires managed identity)
az network application-gateway identity assign \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --identity appgw-identity

# Create SSL certificate from Key Vault
az network application-gateway ssl-cert create \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --name my-ssl-cert \
    --key-vault-secret-id https://my-keyvault.vault.azure.net/secrets/ssl-cert

# Create HTTPS listener
az network application-gateway http-listener create \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --name https-listener \
    --frontend-ip appGwPublicFrontendIp \
    --frontend-port port_443 \
    --ssl-cert my-ssl-cert \
    --host-names www.contoso.com contoso.com
```

## Rewrite Rules

```bash
# Create rewrite rule set
az network application-gateway rewrite-rule set create \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --name security-headers

# Add rewrite rule for security headers
az network application-gateway rewrite-rule create \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --rule-set-name security-headers \
    --name add-security-headers \
    --sequence 100 \
    --response-headers "X-Content-Type-Options=nosniff" \
                       "X-Frame-Options=DENY" \
                       "X-XSS-Protection=1; mode=block"

# URL rewrite
az network application-gateway rewrite-rule create \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --rule-set-name rewrites \
    --name rewrite-api-version \
    --sequence 200 \
    --conditions '[{
        "variable": "var_uri_path",
        "pattern": "/api/v1/(.*)",
        "ignoreCase": true
    }]' \
    --modified-path "/api/current/{var_uri_path_1}"
```

## AKS Ingress Controller

```bash
# Enable AGIC add-on for AKS
az aks enable-addons \
    --name my-aks-cluster \
    --resource-group my-rg \
    --addons ingress-appgw \
    --appgw-id /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Network/applicationGateways/my-appgw
```

Kubernetes Ingress resource:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
  annotations:
    kubernetes.io/ingress.class: azure/application-gateway
    appgw.ingress.kubernetes.io/ssl-redirect: "true"
    appgw.ingress.kubernetes.io/connection-draining: "true"
    appgw.ingress.kubernetes.io/connection-draining-timeout: "30"
    appgw.ingress.kubernetes.io/cookie-based-affinity: "true"
spec:
  tls:
  - hosts:
    - www.contoso.com
    secretName: ssl-secret
  rules:
  - host: www.contoso.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: frontend-svc
            port:
              number: 80
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: api-svc
            port:
              number: 80
```

## WAF Integration

```bash
# Create WAF policy
az network application-gateway waf-policy create \
    --name appgw-waf-policy \
    --resource-group my-rg \
    --location eastus

# Enable OWASP rules
az network application-gateway waf-policy managed-rule rule-set add \
    --policy-name appgw-waf-policy \
    --resource-group my-rg \
    --type OWASP \
    --version 3.2

# Associate WAF policy with Application Gateway
az network application-gateway update \
    --name my-appgw \
    --resource-group my-rg \
    --set firewallPolicy.id=/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Network/applicationGatewayWebApplicationFirewallPolicies/appgw-waf-policy
```

## Monitoring

```kusto
// Backend health by pool
AzureDiagnostics
| where ResourceType == "APPLICATIONGATEWAYS"
| where Category == "ApplicationGatewayAccessLog"
| summarize
    HealthyCount = countif(httpStatus_d < 500),
    UnhealthyCount = countif(httpStatus_d >= 500)
    by backendPoolName_s, bin(TimeGenerated, 5m)
| extend HealthRatio = todouble(HealthyCount) / (HealthyCount + UnhealthyCount) * 100

// Request latency by backend
AzureDiagnostics
| where ResourceType == "APPLICATIONGATEWAYS"
| where Category == "ApplicationGatewayAccessLog"
| summarize
    p50 = percentile(timeTaken_d, 50),
    p95 = percentile(timeTaken_d, 95),
    p99 = percentile(timeTaken_d, 99)
    by backendPoolName_s, bin(TimeGenerated, 5m)
| render timechart

// Connection counts
AzureDiagnostics
| where ResourceType == "APPLICATIONGATEWAYS"
| where Category == "ApplicationGatewayPerformanceLog"
| project
    TimeGenerated,
    requestCount_d,
    healthyHostCount_d,
    unHealthyHostCount_d,
    throughput_d
| render timechart
```

## Autoscaling Configuration

```python
autoscale_config = {
    "min_capacity": 2,
    "max_capacity": 10,
    "scale_up": {
        "metric": "Throughput",
        "threshold": 100000,  # bytes/sec
        "time_grain": "PT1M",
        "time_window": "PT5M",
        "cooldown": "PT10M"
    },
    "scale_down": {
        "metric": "CurrentConnections",
        "threshold": 1000,
        "time_grain": "PT1M",
        "time_window": "PT10M",
        "cooldown": "PT30M"
    }
}
```

## Best Practices

1. **Use V2 SKU**: Better performance and features
2. **Enable autoscaling**: Handle traffic spikes automatically
3. **Configure health probes**: Custom probes for accurate backend health
4. **Use zone redundancy**: Deploy across availability zones
5. **Integrate with Key Vault**: Automatic certificate rotation
6. **Enable WAF**: Layer 7 protection against web attacks

## Resources

- [Application Gateway Documentation](https://docs.microsoft.com/en-us/azure/application-gateway/)
- [Autoscaling](https://docs.microsoft.com/en-us/azure/application-gateway/application-gateway-autoscaling-zone-redundant)
- [AGIC Documentation](https://docs.microsoft.com/en-us/azure/application-gateway/ingress-controller-overview)
