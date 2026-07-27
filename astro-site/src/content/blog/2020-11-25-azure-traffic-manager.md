---
title: "Azure Traffic Manager: Global DNS Load Balancing"
author: Michael John Peña
draft: false
date: 2020-11-25
tags:
  - Azure
  - Traffic Manager
  - DNS
  - Load Balancing
---

Traffic Manager is a deeply unglamorous service that has saved a couple of my projects. It works at the DNS layer—no traffic flows through it, just the resolution—so it's cheap and fast, with the trade-off that failover is bounded by TTLs and client DNS caching. For multi-region active-active, regional failover, or simple geo-routing, it's still the workhorse. Front Door covers the HTTPS-aware cases; Traffic Manager covers everything else.

## Routing Methods

| Method | Use Case |
|--------|----------|
| Priority | Active/passive failover |
| Weighted | A/B testing, gradual migration |
| Performance | Route to closest endpoint |
| Geographic | Compliance, data residency |
| Multivalue | Return multiple healthy endpoints |
| Subnet | Route specific IPs to specific endpoints |

## Creating Traffic Manager Profile

```bash
# Create profile
az network traffic-manager profile create \
    --name my-traffic-manager \
    --resource-group myRG \
    --routing-method Performance \
    --unique-dns-name myapp-global \
    --ttl 60 \
    --protocol HTTPS \
    --port 443 \
    --path /health

# Add endpoints
az network traffic-manager endpoint create \
    --name eastus-endpoint \
    --profile-name my-traffic-manager \
    --resource-group myRG \
    --type azureEndpoints \
    --target-resource-id /subscriptions/.../sites/myapp-eastus \
    --endpoint-status Enabled

az network traffic-manager endpoint create \
    --name westus-endpoint \
    --profile-name my-traffic-manager \
    --resource-group myRG \
    --type azureEndpoints \
    --target-resource-id /subscriptions/.../sites/myapp-westus \
    --endpoint-status Enabled
```

## Priority (Failover)

```bash
az network traffic-manager profile create \
    --name failover-profile \
    --resource-group myRG \
    --routing-method Priority

# Primary endpoint
az network traffic-manager endpoint create \
    --name primary \
    --profile-name failover-profile \
    --resource-group myRG \
    --type azureEndpoints \
    --target-resource-id /subscriptions/.../sites/myapp-primary \
    --priority 1

# Secondary endpoint
az network traffic-manager endpoint create \
    --name secondary \
    --profile-name failover-profile \
    --resource-group myRG \
    --type azureEndpoints \
    --target-resource-id /subscriptions/.../sites/myapp-secondary \
    --priority 2
```

## Weighted (A/B Testing)

```bash
az network traffic-manager profile create \
    --name weighted-profile \
    --resource-group myRG \
    --routing-method Weighted

# 90% to production
az network traffic-manager endpoint create \
    --name production \
    --profile-name weighted-profile \
    --resource-group myRG \
    --type azureEndpoints \
    --target-resource-id /subscriptions/.../sites/myapp-prod \
    --weight 90

# 10% to canary
az network traffic-manager endpoint create \
    --name canary \
    --profile-name weighted-profile \
    --resource-group myRG \
    --type azureEndpoints \
    --target-resource-id /subscriptions/.../sites/myapp-canary \
    --weight 10
```

## Geographic Routing

```bash
az network traffic-manager profile create \
    --name geo-profile \
    --resource-group myRG \
    --routing-method Geographic

az network traffic-manager endpoint create \
    --name europe \
    --profile-name geo-profile \
    --resource-group myRG \
    --type azureEndpoints \
    --target-resource-id /subscriptions/.../sites/myapp-europe \
    --geo-mapping GEO-EU

az network traffic-manager endpoint create \
    --name us \
    --profile-name geo-profile \
    --resource-group myRG \
    --type azureEndpoints \
    --target-resource-id /subscriptions/.../sites/myapp-us \
    --geo-mapping GEO-NA
```

## Nested Profiles

```bash
# Child profile (performance within region)
az network traffic-manager profile create \
    --name us-performance \
    --resource-group myRG \
    --routing-method Performance

# Parent profile (geographic between regions)
az network traffic-manager profile create \
    --name global-geo \
    --resource-group myRG \
    --routing-method Geographic

# Nested endpoint
az network traffic-manager endpoint create \
    --name us-nested \
    --profile-name global-geo \
    --resource-group myRG \
    --type nestedEndpoints \
    --target-resource-id /subscriptions/.../trafficmanagerprofiles/us-performance \
    --min-child-endpoints 1 \
    --geo-mapping GEO-NA
```

## Health Monitoring

```bash
# Custom health check
az network traffic-manager profile update \
    --name my-traffic-manager \
    --resource-group myRG \
    --protocol HTTPS \
    --port 443 \
    --path /api/health \
    --interval 30 \
    --timeout 10 \
    --tolerated-failures 3
```

## Endpoint Status

```bash
# Check endpoint health
az network traffic-manager endpoint show \
    --name eastus-endpoint \
    --profile-name my-traffic-manager \
    --resource-group myRG \
    --type azureEndpoints \
    --query "endpointMonitorStatus"
```

Traffic Manager: global traffic distribution made simple.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
