---
title: "Natural Language to Code: The Future of Programming"
author: Michael John Peña
draft: false
date: 2022-12-03
tags:
  - AI
  - ChatGPT
  - Code Generation
  - Natural Language
  - Future

---

I wrote "Natural Language to Code: The Future of Programming" to share practical, production-minded guidance on this topic.

## The Evolution of Programming Interfaces

We've come a long way:

1. **Machine code**: Direct binary instructions
2. **Assembly**: Mnemonics for machine operations
3. **High-level languages**: Human-readable syntax
4. **Frameworks**: Abstractions over common patterns
5. **Low-code**: Visual programming
6. **Natural language**: Describe intent, get code

## How It Works

ChatGPT understands programming concepts and can translate descriptions into code:

**Input**: "Create a Python script that reads a CSV file, filters rows where the 'status' column equals 'active', and exports the result to a new CSV file."

**Output**:
```python
import pandas as pd
import sys

def filter_active_records(input_file: str, output_file: str) -> int:
    """
    Reads a CSV file, filters for active records, and exports to a new file.

    Args:
        input_file: Path to the input CSV file
        output_file: Path to the output CSV file

    Returns:
        Number of active records found
    """
    # Read the CSV file
    df = pd.read_csv(input_file)

    # Filter for active status
    active_df = df[df['status'] == 'active']

    # Export to new CSV
    active_df.to_csv(output_file, index=False)

    return len(active_df)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python filter_active.py <input.csv> <output.csv>")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    count = filter_active_records(input_path, output_path)
    print(f"Exported {count} active records to {output_path}")
```

## Complex Examples

### Database Operations

**Input**: "Write a SQL query that finds customers who made purchases in the last 30 days but haven't purchased in the previous 30 days (reactivated customers)"

**Output**:
```sql
WITH recent_purchasers AS (
    SELECT DISTINCT customer_id
    FROM orders
    WHERE order_date >= DATEADD(day, -30, GETDATE())
),
previous_purchasers AS (
    SELECT DISTINCT customer_id
    FROM orders
    WHERE order_date >= DATEADD(day, -60, GETDATE())
      AND order_date < DATEADD(day, -30, GETDATE())
)
SELECT
    c.customer_id,
    c.customer_name,
    c.email,
    MAX(o.order_date) as latest_order_date,
    COUNT(o.order_id) as recent_order_count
FROM customers c
JOIN recent_purchasers rp ON c.customer_id = rp.customer_id
LEFT JOIN previous_purchasers pp ON c.customer_id = pp.customer_id
JOIN orders o ON c.customer_id = o.customer_id
    AND o.order_date >= DATEADD(day, -30, GETDATE())
WHERE pp.customer_id IS NULL
GROUP BY c.customer_id, c.customer_name, c.email
ORDER BY latest_order_date DESC;
```

### Infrastructure as Code

**Input**: "Create Terraform code for an Azure setup with a VNet, two subnets (public and private), a Network Security Group allowing HTTP/HTTPS inbound, and an Application Gateway"

**Output**:
```hcl
resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
}

resource "azurerm_virtual_network" "main" {
  name                = "${var.prefix}-vnet"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  address_space       = ["10.0.0.0/16"]
}

resource "azurerm_subnet" "public" {
  name                 = "public-subnet"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]
}

resource "azurerm_subnet" "private" {
  name                 = "private-subnet"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.2.0/24"]
}

resource "azurerm_subnet" "appgw" {
  name                 = "appgw-subnet"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.3.0/24"]
}

resource "azurerm_network_security_group" "web" {
  name                = "${var.prefix}-web-nsg"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  security_rule {
    name                       = "AllowHTTP"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowHTTPS"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }
}

resource "azurerm_public_ip" "appgw" {
  name                = "${var.prefix}-appgw-pip"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_application_gateway" "main" {
  name                = "${var.prefix}-appgw"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location

  sku {
    name     = "Standard_v2"
    tier     = "Standard_v2"
    capacity = 2
  }

  gateway_ip_configuration {
    name      = "gateway-ip-config"
    subnet_id = azurerm_subnet.appgw.id
  }

  frontend_port {
    name = "http-port"
    port = 80
  }

  frontend_ip_configuration {
    name                 = "frontend-ip"
    public_ip_address_id = azurerm_public_ip.appgw.id
  }

  backend_address_pool {
    name = "backend-pool"
  }

  backend_http_settings {
    name                  = "http-settings"
    cookie_based_affinity = "Disabled"
    port                  = 80
    protocol              = "Http"
    request_timeout       = 30
  }

  http_listener {
    name                           = "http-listener"
    frontend_ip_configuration_name = "frontend-ip"
    frontend_port_name             = "http-port"
    protocol                       = "Http"
  }

  request_routing_rule {
    name                       = "routing-rule"
    rule_type                  = "Basic"
    http_listener_name         = "http-listener"
    backend_address_pool_name  = "backend-pool"
    backend_http_settings_name = "http-settings"
    priority                   = 100
  }
}
```

### API Integration

**Input**: "Write TypeScript code to fetch data from Microsoft Graph API, get the current user's calendar events for the next week, and format them as a summary"

**Output**:
```typescript
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { ClientSecretCredential } from '@azure/identity';

interface CalendarEvent {
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName: string };
  isAllDay: boolean;
}

interface EventSummary {
  title: string;
  startTime: Date;
  endTime: Date;
  duration: string;
  location: string;
}

async function getCalendarSummary(): Promise<EventSummary[]> {
  // Initialize authentication
  const credential = new ClientSecretCredential(
    process.env.TENANT_ID!,
    process.env.CLIENT_ID!,
    process.env.CLIENT_SECRET!
  );

  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default']
  });

  const client = Client.initWithMiddleware({ authProvider });

  // Calculate date range
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Fetch calendar events
  const events = await client
    .api('/me/calendar/events')
    .query({
      startDateTime: now.toISOString(),
      endDateTime: nextWeek.toISOString(),
      $select: 'subject,start,end,location,isAllDay',
      $orderby: 'start/dateTime',
      $top: 50
    })
    .get();

  // Format events
  return events.value.map((event: CalendarEvent): EventSummary => {
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);
    const durationMs = end.getTime() - start.getTime();
    const durationHours = Math.floor(durationMs / (1000 * 60 * 60));
    const durationMinutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

    return {
      title: event.subject,
      startTime: start,
      endTime: end,
      duration: event.isAllDay
        ? 'All day'
        : `${durationHours}h ${durationMinutes}m`,
      location: event.location?.displayName || 'No location'
    };
  });
}

async function main() {
  try {
    const events = await getCalendarSummary();

    console.log('📅 Your upcoming events:\n');

    events.forEach(event => {
      const date = event.startTime.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
      const time = event.startTime.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });

      console.log(`${date} ${time} - ${event.title}`);
      console.log(`  Duration: ${event.duration}`);
      console.log(`  Location: ${event.location}\n`);
    });
  } catch (error) {
    console.error('Error fetching calendar:', error);
  }
}

main();
```

## The Programmer's Evolving Role

Natural language to code doesn't eliminate programmers - it changes what we focus on:

**Less time on**:
- Syntax memorization
- Boilerplate code
- Looking up API documentation
- Basic implementations

**More time on**:
- Architecture and design
- Understanding requirements
- Reviewing and improving generated code
- Testing and validation
- Security considerations

## Best Practices

1. **Be specific**: "Create a function" vs "Create an async TypeScript function that handles errors"
2. **Provide context**: Include relevant constraints and requirements
3. **Iterate**: Refine through conversation
4. **Verify**: Always review and test generated code
5. **Learn**: Use it as a learning tool, not just a code generator

## Conclusion

Natural language to code is here, and it's remarkably capable. The developers who thrive will be those who learn to effectively communicate with these tools while maintaining their critical thinking about code quality, security, and design.

## Resources

- [ChatGPT](https://chat.openai.com/)
- [GitHub Copilot](https://github.com/features/copilot)
- [OpenAI Codex](https://openai.com/blog/openai-codex/)

