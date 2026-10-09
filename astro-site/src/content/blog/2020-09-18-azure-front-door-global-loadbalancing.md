---
title: "Azure Front Door: Global Load Balancing and CDN"
description: "Front Door is the global entry point for serious production workloads."
author: Michael John Peña
draft: false
date: 2020-09-18
tags:
  - Azure
  - Front Door
  - CDN
  - Performance
---

## Key Features

1. **Global HTTP load balancing** with instant failover
2. **SSL offloading** at the edge
3. **URL-based routing**
4. **Session affinity**
5. **WAF integration**
6. **Caching at edge**

## Basic Configuration

```hcl
resource "azurerm_frontdoor" "main" {
  name                = "myapp-frontdoor"
  resource_group_name = azurerm_resource_group.main.name

  routing_rule {
    name               = "default-route"
    accepted_protocols = ["Http", "Https"]
    patterns_to_match  = ["/*"]
    frontend_endpoints = ["default-frontend"]
    forwarding_configuration {
      forwarding_protocol = "HttpsOnly"
      backend_pool_name   = "app-backends"
    }
  }

  backend_pool {
    name = "app-backends"
    backend {
      host_header = "myapp-eastus.azurewebsites.net"
      address     = "myapp-eastus.azurewebsites.net"
      http_port   = 80
      https_port  = 443
      priority    = 1
      weight      = 50
    }
    backend {
      host_header = "myapp-westeurope.azurewebsites.net"
      address     = "myapp-westeurope.azurewebsites.net"
      http_port   = 80
      https_port  = 443
      priority    = 1
      weight      = 50
    }
    health_probe_name   = "healthProbe"
    load_balancing_name = "loadBalancing"
  }

  frontend_endpoint {
    name      = "default-frontend"
    host_name = "myapp-frontdoor.azurefd.net"
  }
}
```

## WAF Policy

```hcl
resource "azurerm_frontdoor_firewall_policy" "main" {
  name                = "myapp-waf"
  resource_group_name = azurerm_resource_group.main.name

  managed_rule {
    type    = "DefaultRuleSet"
    version = "1.0"
  }

  managed_rule {
    type    = "Microsoft_BotManagerRuleSet"
    version = "1.0"
  }

  custom_rule {
    name     = "RateLimit"
    priority = 100
    type     = "RateLimitRule"
    action   = "Block"
    rate_limit_threshold = 1000
    rate_limit_duration_in_minutes = 1
    match_condition {
      match_variable = "RequestUri"
      operator       = "Any"
    }
  }
}
```

## Use Cases

- **Multi-region active-active** deployment
- **DDoS protection** at the edge
- **API acceleration** with caching
- **Blue-green deployments** with traffic routing

Front Door is the global entry point for serious production workloads.
