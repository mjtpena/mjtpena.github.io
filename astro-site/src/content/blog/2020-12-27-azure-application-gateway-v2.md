---
title: "Azure Application Gateway v2: Advanced Load Balancing"
description: "App Gateway v1 was a credible Layer 7 load balancer. v2 is the upgrade that makes it the default I reach for in front of internal AKS clusters and App…"
author: Michael John Peña
draft: false
date: 2020-12-27
tags:
  - Azure
  - Application Gateway
  - Load Balancing
  - Networking
---

App Gateway v1 was a credible Layer 7 load balancer. v2 is the upgrade that makes it the default I reach for in front of internal AKS clusters and App Services. Autoscaling out of the box (no more guessing instance counts), zone redundancy, faster TLS termination, and integration with the Application Gateway Ingress Controller for AKS. Pair it with WAF Premium and you've covered routing, TLS, and the OWASP top ten in one resource.

## v2 Improvements

| Feature | v1 | v2 |
|---------|----|----|
| Autoscaling | Manual | Automatic |
| Zone redundancy | No | Yes |
| Header rewrite | No | Yes |
| WAF 3.0 | No | Yes |
| Performance | Good | 5x better |

## Create Application Gateway v2

```bash
# Create subnet
az network vnet subnet create \
    --resource-group myRG \
    --vnet-name myVNet \
    --name AppGatewaySubnet \
    --address-prefix 10.0.2.0/24

# Create public IP
az network public-ip create \
    --resource-group myRG \
    --name appgw-pip \
    --sku Standard \
    --allocation-method Static

# Create Application Gateway
az network application-gateway create \
    --name myAppGateway \
    --resource-group myRG \
    --location eastus \
    --sku Standard_v2 \
    --capacity 2 \
    --vnet-name myVNet \
    --subnet AppGatewaySubnet \
    --public-ip-address appgw-pip \
    --http-settings-cookie-based-affinity Enabled \
    --frontend-port 443 \
    --http-settings-port 80 \
    --http-settings-protocol Http \
    --servers 10.0.1.4 10.0.1.5
```

## SSL Termination

```bash
# Add SSL certificate
az network application-gateway ssl-cert create \
    --resource-group myRG \
    --gateway-name myAppGateway \
    --name myCert \
    --cert-file /path/to/cert.pfx \
    --cert-password "password"

# Create HTTPS listener
az network application-gateway http-listener create \
    --resource-group myRG \
    --gateway-name myAppGateway \
    --name httpsListener \
    --frontend-port 443 \
    --ssl-cert myCert
```

## URL-Based Routing

```bash
# Create backend pool for API
az network application-gateway address-pool create \
    --resource-group myRG \
    --gateway-name myAppGateway \
    --name apiPool \
    --servers 10.0.1.10 10.0.1.11

# Create URL path map
az network application-gateway url-path-map create \
    --resource-group myRG \
    --gateway-name myAppGateway \
    --name pathMap \
    --paths /api/* \
    --address-pool apiPool \
    --default-address-pool webPool \
    --http-settings appGatewayBackendHttpSettings

# Create path rule
az network application-gateway url-path-map rule create \
    --resource-group myRG \
    --gateway-name myAppGateway \
    --path-map-name pathMap \
    --name apiRule \
    --paths /api/* \
    --address-pool apiPool
```

## Header Rewrite

```bash
# Create rewrite rule set
az network application-gateway rewrite-rule set create \
    --resource-group myRG \
    --gateway-name myAppGateway \
    --name rewriteRules

# Add rewrite rule
az network application-gateway rewrite-rule create \
    --resource-group myRG \
    --gateway-name myAppGateway \
    --rule-set-name rewriteRules \
    --name addSecurityHeaders \
    --response-headers 'X-Frame-Options=DENY' 'X-Content-Type-Options=nosniff' \
    --request-headers 'X-Forwarded-For={var_add_x_forwarded_for_proxy}'
```

## Autoscaling

```bash
# Configure autoscale
az network application-gateway update \
    --resource-group myRG \
    --name myAppGateway \
    --min-capacity 2 \
    --max-capacity 10
```

## Health Probes

```bash
# Create custom health probe
az network application-gateway probe create \
    --resource-group myRG \
    --gateway-name myAppGateway \
    --name healthProbe \
    --protocol Http \
    --host-name-from-http-settings true \
    --path /health \
    --interval 30 \
    --timeout 30 \
    --threshold 3 \
    --match-status-codes 200-399
```

## WAF Integration

```bash
# Create WAF policy
az network application-gateway waf-policy create \
    --name myWAFPolicy \
    --resource-group myRG

# Enable managed rules
az network application-gateway waf-policy managed-rule rule-set add \
    --policy-name myWAFPolicy \
    --resource-group myRG \
    --type OWASP \
    --version 3.2

# Associate with gateway
az network application-gateway update \
    --name myAppGateway \
    --resource-group myRG \
    --waf-policy myWAFPolicy
```

## Connection Draining

```bash
az network application-gateway update \
    --resource-group myRG \
    --name myAppGateway \
    --connection-draining-timeout 60
```

Application Gateway v2: enterprise-grade L7 load balancing.
