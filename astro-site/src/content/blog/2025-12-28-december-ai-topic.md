---
title: "Infrastructure as Code Best Practices: Lessons from 100+ Deployments"
author: Michael John Peña
draft: false
date: 2025-12-28
tags:
  - Infrastructure-as-Code
  - Terraform
  - Bicep
  - DevOps
  - Best-Practices

---

I wrote "Infrastructure as Code Best Practices: Lessons from 100+ Deployments" to share practical, production-minded guidance on this topic.

## 1. Use Modules Religiously

Never repeat infrastructure definitions. Create reusable modules:

```hcl
# modules/azure-function/main.tf
variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "app_settings" {
  type    = map(string)
  default = {}
}

resource "azurerm_linux_function_app" "function" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = data.azurerm_resource_group.rg.location

  service_plan_id            = azurerm_service_plan.plan.id
  storage_account_name       = azurerm_storage_account.storage.name
  storage_account_access_key = azurerm_storage_account.storage.primary_access_key

  site_config {
    application_stack {
      dotnet_version = "8.0"
    }
  }

  app_settings = merge({
    "FUNCTIONS_WORKER_RUNTIME" = "dotnet-isolated"
  }, var.app_settings)
}

# Usage
module "order_processor" {
  source              = "./modules/azure-function"
  name                = "order-processor-${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  app_settings = {
    "ServiceBusConnection" = azurerm_servicebus_namespace.main.default_primary_connection_string
  }
}
```

## 2. Environment Separation with Workspaces

```hcl
# environments/dev.tfvars
environment = "dev"
sku_tier    = "Basic"
replicas    = 1

# environments/prod.tfvars
environment = "prod"
sku_tier    = "Premium"
replicas    = 3

# main.tf
resource "azurerm_service_plan" "plan" {
  name     = "plan-${var.environment}"
  sku_name = var.sku_tier == "Premium" ? "P1v3" : "B1"
}
```

## 3. State Management

Always use remote state with locking:

```hcl
terraform {
  backend "azurerm" {
    resource_group_name  = "terraform-state-rg"
    storage_account_name = "tfstateprod"
    container_name       = "tfstate"
    key                  = "project.tfstate"
  }
}
```

## 4. Naming Conventions

Consistent naming prevents confusion:

```hcl
locals {
  name_prefix = "${var.project}-${var.environment}-${var.region_short}"

  naming = {
    resource_group   = "rg-${local.name_prefix}"
    storage_account  = "st${replace(local.name_prefix, "-", "")}"
    key_vault        = "kv-${local.name_prefix}"
    function_app     = "func-${local.name_prefix}"
  }
}
```

## 5. Validation Before Apply

```hcl
variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "sku_tier" {
  type = string
  validation {
    condition     = var.environment != "prod" || var.sku_tier == "Premium"
    error_message = "Production must use Premium tier."
  }
}
```

## 6. Output Everything Important

```hcl
output "function_app_url" {
  value       = "https://${azurerm_linux_function_app.function.default_hostname}"
  description = "The URL of the deployed function app"
}

output "connection_strings" {
  value = {
    storage     = azurerm_storage_account.storage.primary_connection_string
    service_bus = azurerm_servicebus_namespace.main.default_primary_connection_string
  }
  sensitive = true
}
```

## 7. Use Data Sources for Dependencies

```hcl
# Reference existing resources instead of hardcoding
data "azurerm_client_config" "current" {}

data "azurerm_key_vault" "shared" {
  name                = "kv-shared-${var.environment}"
  resource_group_name = "rg-shared-${var.environment}"
}

resource "azurerm_key_vault_access_policy" "function" {
  key_vault_id = data.azurerm_key_vault.shared.id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = azurerm_linux_function_app.function.identity[0].principal_id

  secret_permissions = ["Get", "List"]
}
```

## Key Principles

1. **Immutable infrastructure** - Replace, don't modify
2. **Everything in code** - No manual portal changes
3. **Review before apply** - Use `terraform plan` in CI/CD
4. **Test in lower environments** - Never apply to prod first
5. **Document with comments** - Future you will thank present you

IaC is a skill that compounds. These practices become second nature and save countless hours of debugging and recovery.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
