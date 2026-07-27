---
title: "Azure Application Gateway: Layer 7 Load Balancing"
author: Michael John Peña
draft: false
date: 2020-09-23
tags:
  - Azure
  - Application Gateway
  - Load Balancing
  - Networking
---

"Why don't I just use Azure Load Balancer?" is the question I get most often when someone first sees Application Gateway in the architecture diagram. The answer is that Load Balancer is Layer 4 — IPs and ports, no idea what HTTP is. Application Gateway is Layer 7 — URL routing, SSL termination, WAF, cookie-based session affinity. For web traffic, those features are non-negotiable. For everything else, Load Balancer is fine and cheaper.

## Key Features

- **URL-based routing**: Route /api/* to backend A, /images/* to backend B
- **SSL termination**: Offload SSL at the gateway
- **Session affinity**: Cookie-based sticky sessions
- **WAF**: Web Application Firewall protection
- **Autoscaling**: Handle traffic spikes

## Basic Configuration

```hcl
resource "azurerm_application_gateway" "main" {
  name                = "myappgateway"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  sku {
    name     = "WAF_v2"
    tier     = "WAF_v2"
  }

  autoscale_configuration {
    min_capacity = 2
    max_capacity = 10
  }

  gateway_ip_configuration {
    name      = "gateway-ip"
    subnet_id = azurerm_subnet.appgw.id
  }

  frontend_port {
    name = "https-port"
    port = 443
  }

  frontend_ip_configuration {
    name                 = "frontend-ip"
    public_ip_address_id = azurerm_public_ip.appgw.id
  }

  backend_address_pool {
    name = "api-backend"
  }

  backend_http_settings {
    name                  = "api-settings"
    cookie_based_affinity = "Disabled"
    port                  = 80
    protocol              = "Http"
    request_timeout       = 60
    probe_name            = "api-probe"
  }

  http_listener {
    name                           = "https-listener"
    frontend_ip_configuration_name = "frontend-ip"
    frontend_port_name             = "https-port"
    protocol                       = "Https"
    ssl_certificate_name           = "wildcard-cert"
  }

  request_routing_rule {
    name                       = "api-rule"
    rule_type                  = "PathBasedRouting"
    http_listener_name         = "https-listener"
    url_path_map_name          = "url-map"
  }

  url_path_map {
    name                               = "url-map"
    default_backend_address_pool_name  = "api-backend"
    default_backend_http_settings_name = "api-settings"

    path_rule {
      name                       = "api-path"
      paths                      = ["/api/*"]
      backend_address_pool_name  = "api-backend"
      backend_http_settings_name = "api-settings"
    }
  }

  probe {
    name                = "api-probe"
    protocol            = "Http"
    path                = "/health"
    host                = "127.0.0.1"
    interval            = 30
    timeout             = 30
    unhealthy_threshold = 3
  }
}
```

## vs. Azure Load Balancer

| Feature | App Gateway | Load Balancer |
|---------|-------------|---------------|
| Layer | 7 (HTTP) | 4 (TCP/UDP) |
| SSL Termination | Yes | No |
| URL Routing | Yes | No |
| WAF | Yes | No |
| WebSockets | Yes | Yes |

Use Application Gateway for web traffic, Load Balancer for everything else.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
