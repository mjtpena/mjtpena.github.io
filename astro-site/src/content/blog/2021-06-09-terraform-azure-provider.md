---
title: Terraform Azure Provider Fundamentals
description: "Terraform with the AzureRM provider is the infrastructure-as-code choice I recommend to teams that need multi-cloud portability or already have Terraform…"
author: Michael John Peña
draft: false
date: 2021-06-09
url: /blog/terraform-azure-provider/
tags:
  - Terraform
  - Azure
  - Infrastructure as Code
  - DevOps
---

Terraform with the AzureRM provider is the infrastructure-as-code choice I recommend to teams that need multi-cloud portability or already have Terraform experience from AWS or GCP. The provider coverage for Azure is comprehensive—most services have resources and data sources that track the ARM API closely. The patterns that matter most in practice: remote state in Azure Blob Storage with state locking via lease, workspaces for environment separation, modules for reusable infrastructure components, and the provider alias pattern for deploying to multiple subscriptions in one configuration. For Azure-native teams without multi-cloud requirements, Bicep is now my default recommendation, but Terraform is well-established and the community modules are excellent.

## Setting Up the Azure Provider

### Basic Configuration

```hcl
# versions.tf
terraform {
  required_version = ">= 1.0.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 2.65"
    }
  }

  backend "azurerm" {
    resource_group_name  = "tfstate-rg"
    storage_account_name = "tfstatestorage"
    container_name       = "tfstate"
    key                  = "terraform.tfstate"
  }
}

# providers.tf
provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = true
    }
    virtual_machine {
      delete_os_disk_on_deletion = true
    }
  }
}
```

### Authentication Methods

```hcl
# Using Service Principal
provider "azurerm" {
  features {}

  subscription_id = var.subscription_id
  client_id       = var.client_id
  client_secret   = var.client_secret
  tenant_id       = var.tenant_id
}

# Using Azure CLI (for development)
provider "azurerm" {
  features {}
  # No credentials needed - uses az login
}

# Using Managed Identity
provider "azurerm" {
  features {}
  use_msi = true
}
```

## Resource Group and Basic Resources

```hcl
# variables.tf
variable "environment" {
  type        = string
  description = "Environment name (dev, staging, prod)"
}

variable "location" {
  type        = string
  default     = "australiaeast"
  description = "Azure region"
}

variable "project_name" {
  type        = string
  description = "Project name for resource naming"
}

# main.tf
locals {
  common_tags = {
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "Terraform"
    CreatedDate = timestamp()
  }

  name_prefix = "${var.project_name}-${var.environment}"
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.name_prefix}"
  location = var.location
  tags     = local.common_tags
}
```

## App Service Infrastructure

```hcl
# app-service.tf
resource "azurerm_app_service_plan" "main" {
  name                = "asp-${local.name_prefix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  kind                = "Linux"
  reserved            = true

  sku {
    tier = var.environment == "prod" ? "Standard" : "Basic"
    size = var.environment == "prod" ? "S1" : "B1"
  }

  tags = local.common_tags
}

resource "azurerm_app_service" "main" {
  name                = "app-${local.name_prefix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  app_service_plan_id = azurerm_app_service_plan.main.id

  site_config {
    linux_fx_version = "DOTNETCORE|6.0"
    always_on        = var.environment == "prod"
    http2_enabled    = true
    min_tls_version  = "1.2"

    cors {
      allowed_origins     = var.cors_origins
      support_credentials = true
    }
  }

  app_settings = {
    "ASPNETCORE_ENVIRONMENT"                = var.environment == "prod" ? "Production" : "Development"
    "APPLICATIONINSIGHTS_CONNECTION_STRING" = azurerm_application_insights.main.connection_string
    "KeyVaultUri"                           = azurerm_key_vault.main.vault_uri
  }

  identity {
    type = "SystemAssigned"
  }

  https_only = true

  tags = local.common_tags
}

# Deployment slots for production
resource "azurerm_app_service_slot" "staging" {
  count               = var.environment == "prod" ? 1 : 0
  name                = "staging"
  app_service_name    = azurerm_app_service.main.name
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  app_service_plan_id = azurerm_app_service_plan.main.id

  site_config {
    linux_fx_version = "DOTNETCORE|6.0"
    always_on        = true
  }

  tags = local.common_tags
}
```

## Azure SQL Database

```hcl
# sql.tf
resource "azurerm_mssql_server" "main" {
  name                         = "sql-${local.name_prefix}"
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  version                      = "12.0"
  administrator_login          = var.sql_admin_username
  administrator_login_password = var.sql_admin_password
  minimum_tls_version          = "1.2"

  azuread_administrator {
    login_username = var.aad_admin_username
    object_id      = var.aad_admin_object_id
  }

  tags = local.common_tags
}

resource "azurerm_mssql_database" "main" {
  name           = "sqldb-${local.name_prefix}"
  server_id      = azurerm_mssql_server.main.id
  collation      = "SQL_Latin1_General_CP1_CI_AS"
  max_size_gb    = var.environment == "prod" ? 50 : 2
  sku_name       = var.environment == "prod" ? "S1" : "Basic"
  zone_redundant = var.environment == "prod"

  short_term_retention_policy {
    retention_days = var.environment == "prod" ? 35 : 7
  }

  long_term_retention_policy {
    weekly_retention  = var.environment == "prod" ? "P4W" : null
    monthly_retention = var.environment == "prod" ? "P12M" : null
  }

  tags = local.common_tags
}

# Firewall rules
resource "azurerm_mssql_firewall_rule" "azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_mssql_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# Virtual network rule for App Service
resource "azurerm_mssql_virtual_network_rule" "main" {
  name      = "app-service-vnet-rule"
  server_id = azurerm_mssql_server.main.id
  subnet_id = azurerm_subnet.app_service.id
}
```

## Key Vault Integration

```hcl
# keyvault.tf
data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "main" {
  name                        = "kv-${local.name_prefix}"
  location                    = azurerm_resource_group.main.location
  resource_group_name         = azurerm_resource_group.main.name
  tenant_id                   = data.azurerm_client_config.current.tenant_id
  sku_name                    = "standard"
  soft_delete_retention_days  = 7
  purge_protection_enabled    = var.environment == "prod"

  network_acls {
    bypass         = "AzureServices"
    default_action = "Deny"
    ip_rules       = var.allowed_ip_ranges
    virtual_network_subnet_ids = [azurerm_subnet.app_service.id]
  }

  tags = local.common_tags
}

# Access policy for Terraform service principal
resource "azurerm_key_vault_access_policy" "terraform" {
  key_vault_id = azurerm_key_vault.main.id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = data.azurerm_client_config.current.object_id

  secret_permissions = [
    "Get", "List", "Set", "Delete", "Purge", "Recover"
  ]

  key_permissions = [
    "Get", "List", "Create", "Delete", "Update"
  ]
}

# Access policy for App Service
resource "azurerm_key_vault_access_policy" "app_service" {
  key_vault_id = azurerm_key_vault.main.id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = azurerm_app_service.main.identity[0].principal_id

  secret_permissions = ["Get", "List"]
}

# Store secrets
resource "azurerm_key_vault_secret" "sql_connection" {
  name         = "SqlConnectionString"
  value        = "Server=tcp:${azurerm_mssql_server.main.fully_qualified_domain_name},1433;Database=${azurerm_mssql_database.main.name};Authentication=Active Directory Managed Identity;"
  key_vault_id = azurerm_key_vault.main.id

  depends_on = [azurerm_key_vault_access_policy.terraform]
}
```

## Virtual Network Configuration

```hcl
# network.tf
resource "azurerm_virtual_network" "main" {
  name                = "vnet-${local.name_prefix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = ["10.0.0.0/16"]

  tags = local.common_tags
}

resource "azurerm_subnet" "app_service" {
  name                 = "snet-app-service"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]

  delegation {
    name = "app-service-delegation"

    service_delegation {
      name = "Microsoft.Web/serverFarms"
      actions = [
        "Microsoft.Network/virtualNetworks/subnets/action"
      ]
    }
  }

  service_endpoints = ["Microsoft.Sql", "Microsoft.KeyVault", "Microsoft.Storage"]
}

resource "azurerm_subnet" "private_endpoints" {
  name                                           = "snet-private-endpoints"
  resource_group_name                            = azurerm_resource_group.main.name
  virtual_network_name                           = azurerm_virtual_network.main.name
  address_prefixes                               = ["10.0.2.0/24"]
  enforce_private_link_endpoint_network_policies = true
}

# VNet integration for App Service
resource "azurerm_app_service_virtual_network_swift_connection" "main" {
  app_service_id = azurerm_app_service.main.id
  subnet_id      = azurerm_subnet.app_service.id
}
```

## Application Insights

```hcl
# monitoring.tf
resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-${local.name_prefix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = var.environment == "prod" ? 90 : 30

  tags = local.common_tags
}

resource "azurerm_application_insights" "main" {
  name                = "appi-${local.name_prefix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"

  tags = local.common_tags
}

# Alerts
resource "azurerm_monitor_metric_alert" "high_cpu" {
  name                = "alert-high-cpu-${local.name_prefix}"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_app_service.main.id]
  description         = "Alert when CPU usage is high"

  criteria {
    metric_namespace = "Microsoft.Web/sites"
    metric_name      = "CpuPercentage"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }

  action {
    action_group_id = azurerm_monitor_action_group.main.id
  }

  tags = local.common_tags
}

resource "azurerm_monitor_action_group" "main" {
  name                = "ag-${local.name_prefix}"
  resource_group_name = azurerm_resource_group.main.name
  short_name          = "alerts"

  email_receiver {
    name          = "ops-team"
    email_address = var.alert_email
  }

  tags = local.common_tags
}
```

## Outputs

```hcl
# outputs.tf
output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "app_service_url" {
  value = "https://${azurerm_app_service.main.default_site_hostname}"
}

output "app_service_identity_principal_id" {
  value = azurerm_app_service.main.identity[0].principal_id
}

output "key_vault_uri" {
  value = azurerm_key_vault.main.vault_uri
}

output "sql_server_fqdn" {
  value = azurerm_mssql_server.main.fully_qualified_domain_name
}

output "application_insights_instrumentation_key" {
  value     = azurerm_application_insights.main.instrumentation_key
  sensitive = true
}
```

## Conclusion

Terraform with the Azure Provider offers a powerful way to manage Azure infrastructure declaratively. By organizing resources into logical files, using variables for environment-specific values, and leveraging data sources for existing resources, you create maintainable and repeatable infrastructure. Start with basic resources and progressively add networking, security, and monitoring configurations.

## References

- [Terraform Azure Provider Documentation](https://registry.terraform.io/providers/hashicorp/azurerm/latest/docs)
- [Terraform Best Practices](https://www.terraform-best-practices.com/)
