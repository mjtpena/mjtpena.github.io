---
title: "Terraform Azure Provider: Infrastructure as Code Basics"
author: Michael John Peña
draft: false
date: 2020-09-02
tags:
  - Azure
  - Terraform
  - IaC
  - DevOps
---

After several years of writing ARM templates, picking up Terraform felt like getting glasses for the first time. The same infrastructure-as-code idea, but the syntax stops fighting you, the state model is explicit instead of magical, and the multi-cloud story actually works. Most of my Azure work now lives in Terraform unless a client has standardised on Bicep, and the AzureRM provider is mature enough that there are very few features I miss.

## Provider Configuration

```hcl
terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 2.0"
    }
  }
  backend "azurerm" {
    resource_group_name  = "terraform-state-rg"
    storage_account_name = "tfstatestore"
    container_name       = "tfstate"
    key                  = "prod.terraform.tfstate"
  }
}

provider "azurerm" {
  features {}
}
```

## Resource Example

```hcl
resource "azurerm_resource_group" "main" {
  name     = "data-platform-rg"
  location = "Australia East"
  tags = {
    Environment = "Production"
    Project     = "DataPlatform"
  }
}

resource "azurerm_storage_account" "datalake" {
  name                     = "mydatalakestore"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "GRS"
  is_hns_enabled           = true  # Enable hierarchical namespace for ADLS Gen2

  tags = azurerm_resource_group.main.tags
}

resource "azurerm_synapse_workspace" "synapse" {
  name                                 = "mysynapseworkspace"
  resource_group_name                  = azurerm_resource_group.main.name
  location                             = azurerm_resource_group.main.location
  storage_data_lake_gen2_filesystem_id = azurerm_storage_data_lake_gen2_filesystem.default.id
  sql_administrator_login              = "sqladmin"
  sql_administrator_login_password     = var.sql_admin_password
}
```

## Workflow

```bash
terraform init      # Initialize and download providers
terraform plan      # Preview changes
terraform apply     # Apply changes
terraform destroy   # Tear down (be careful!)
```

The combination of declarative syntax and state management makes Terraform my go-to for Azure infrastructure.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
