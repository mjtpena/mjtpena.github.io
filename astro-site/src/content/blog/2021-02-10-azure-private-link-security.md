---
title: Securing Azure Services with Private Link
author: Michael John Peña
draft: false
date: 2021-02-10
url: /blog/azure-private-link-security/
tags:
  - Azure
  - Security
  - Networking
  - Private Link
  - Zero Trust
---

## Understanding Private Link

Private Link provides several key benefits:

- **Private connectivity** - Access services over private IP addresses
- **Data exfiltration protection** - Service endpoints are mapped to specific resources
- **Global reach** - Works across regions and even across Azure AD tenants
- **No NAT or gateway devices** - Direct connectivity without complex networking

## Creating a Private Endpoint for Azure Storage

Let's create a private endpoint for an Azure Storage account:

```bash
# Create a resource group
az group create --name rg-privatelink-demo --location eastus

# Create a virtual network
az network vnet create \
    --name vnet-privatelink \
    --resource-group rg-privatelink-demo \
    --address-prefix 10.0.0.0/16 \
    --subnet-name subnet-private-endpoints \
    --subnet-prefix 10.0.1.0/24

# Disable private endpoint network policies
az network vnet subnet update \
    --name subnet-private-endpoints \
    --resource-group rg-privatelink-demo \
    --vnet-name vnet-privatelink \
    --disable-private-endpoint-network-policies true

# Create a storage account
az storage account create \
    --name mystoragepl2021 \
    --resource-group rg-privatelink-demo \
    --location eastus \
    --sku Standard_LRS \
    --kind StorageV2

# Create a private endpoint
az network private-endpoint create \
    --name pe-storage \
    --resource-group rg-privatelink-demo \
    --vnet-name vnet-privatelink \
    --subnet subnet-private-endpoints \
    --private-connection-resource-id $(az storage account show --name mystoragepl2021 --resource-group rg-privatelink-demo --query id -o tsv) \
    --connection-name storage-connection \
    --group-id blob
```

## Configuring Private DNS

For seamless name resolution, configure a private DNS zone:

```bash
# Create a private DNS zone
az network private-dns zone create \
    --name "privatelink.blob.core.windows.net" \
    --resource-group rg-privatelink-demo

# Link DNS zone to virtual network
az network private-dns link vnet create \
    --name storage-dns-link \
    --resource-group rg-privatelink-demo \
    --zone-name "privatelink.blob.core.windows.net" \
    --virtual-network vnet-privatelink \
    --registration-enabled false

# Create DNS records from private endpoint
az network private-endpoint dns-zone-group create \
    --endpoint-name pe-storage \
    --resource-group rg-privatelink-demo \
    --name storage-dns-zone-group \
    --private-dns-zone "privatelink.blob.core.windows.net" \
    --zone-name blob
```

## Private Link for Multiple Services

Here's a Terraform configuration for Private Link across multiple Azure services:

```hcl
terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 2.90"
    }
  }
}

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "main" {
  name     = "rg-privatelink-demo"
  location = "eastus"
}

resource "azurerm_virtual_network" "main" {
  name                = "vnet-privatelink"
  address_space       = ["10.0.0.0/16"]
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_subnet" "private_endpoints" {
  name                 = "subnet-private-endpoints"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]

  enforce_private_link_endpoint_network_policies = true
}

# Azure SQL Database with Private Link
resource "azurerm_mssql_server" "main" {
  name                         = "sql-privatelink-demo"
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  version                      = "12.0"
  administrator_login          = "sqladmin"
  administrator_login_password = var.sql_password

  public_network_access_enabled = false
}

resource "azurerm_private_endpoint" "sql" {
  name                = "pe-sql"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  subnet_id           = azurerm_subnet.private_endpoints.id

  private_service_connection {
    name                           = "sql-connection"
    private_connection_resource_id = azurerm_mssql_server.main.id
    subresource_names              = ["sqlServer"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "sql-dns-zone-group"
    private_dns_zone_ids = [azurerm_private_dns_zone.sql.id]
  }
}

resource "azurerm_private_dns_zone" "sql" {
  name                = "privatelink.database.windows.net"
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "sql" {
  name                  = "sql-dns-link"
  resource_group_name   = azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.sql.name
  virtual_network_id    = azurerm_virtual_network.main.id
}

# Azure Key Vault with Private Link
resource "azurerm_key_vault" "main" {
  name                       = "kv-privatelink-demo"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  soft_delete_retention_days = 7

  network_acls {
    bypass         = "AzureServices"
    default_action = "Deny"
  }
}

resource "azurerm_private_endpoint" "keyvault" {
  name                = "pe-keyvault"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  subnet_id           = azurerm_subnet.private_endpoints.id

  private_service_connection {
    name                           = "keyvault-connection"
    private_connection_resource_id = azurerm_key_vault.main.id
    subresource_names              = ["vault"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "keyvault-dns-zone-group"
    private_dns_zone_ids = [azurerm_private_dns_zone.keyvault.id]
  }
}

resource "azurerm_private_dns_zone" "keyvault" {
  name                = "privatelink.vaultcore.azure.net"
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_private_dns_zone_virtual_network_link" "keyvault" {
  name                  = "keyvault-dns-link"
  resource_group_name   = azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.keyvault.name
  virtual_network_id    = azurerm_virtual_network.main.id
}

data "azurerm_client_config" "current" {}

variable "sql_password" {
  type      = string
  sensitive = true
}
```

## Testing Private Connectivity

Verify private connectivity from a VM in the same VNet:

```python
import socket
import requests
from azure.storage.blob import BlobServiceClient
from azure.identity import DefaultAzureCredential

def test_dns_resolution(hostname):
    """Test DNS resolution for private endpoint."""
    try:
        ip_address = socket.gethostbyname(hostname)
        print(f"DNS Resolution: {hostname} -> {ip_address}")

        # Check if it's a private IP
        if ip_address.startswith("10.") or ip_address.startswith("172.") or ip_address.startswith("192.168."):
            print("SUCCESS: Resolves to private IP address")
            return True
        else:
            print("WARNING: Resolves to public IP address")
            return False
    except socket.gaierror as e:
        print(f"ERROR: DNS resolution failed - {e}")
        return False

def test_storage_connectivity(account_name, container_name):
    """Test connectivity to Azure Storage via private endpoint."""

    account_url = f"https://{account_name}.blob.core.windows.net"

    # Test DNS resolution
    test_dns_resolution(f"{account_name}.blob.core.windows.net")

    # Test connectivity
    credential = DefaultAzureCredential()
    blob_service_client = BlobServiceClient(
        account_url=account_url,
        credential=credential
    )

    try:
        # List containers
        containers = list(blob_service_client.list_containers())
        print(f"SUCCESS: Connected to storage account")
        print(f"Found {len(containers)} containers")

        # Test blob operations
        container_client = blob_service_client.get_container_client(container_name)
        if not container_client.exists():
            container_client.create_container()
            print(f"Created container: {container_name}")

        # Upload a test blob
        blob_client = container_client.get_blob_client("test-blob.txt")
        blob_client.upload_blob("Hello from Private Link!", overwrite=True)
        print("SUCCESS: Uploaded test blob")

        return True
    except Exception as e:
        print(f"ERROR: {e}")
        return False

def test_sql_connectivity(server_name, database_name, username, password):
    """Test connectivity to Azure SQL via private endpoint."""
    import pyodbc

    # Test DNS resolution
    test_dns_resolution(f"{server_name}.database.windows.net")

    connection_string = f"""
        Driver={{ODBC Driver 17 for SQL Server}};
        Server={server_name}.database.windows.net;
        Database={database_name};
        Uid={username};
        Pwd={password};
        Encrypt=yes;
        TrustServerCertificate=no;
    """

    try:
        conn = pyodbc.connect(connection_string)
        cursor = conn.cursor()
        cursor.execute("SELECT @@VERSION")
        row = cursor.fetchone()
        print(f"SUCCESS: Connected to SQL Server")
        print(f"Version: {row[0][:50]}...")
        conn.close()
        return True
    except Exception as e:
        print(f"ERROR: {e}")
        return False

# Run tests
if __name__ == "__main__":
    print("=" * 50)
    print("Testing Private Link Connectivity")
    print("=" * 50)

    # Test Storage
    print("\n--- Azure Storage ---")
    test_storage_connectivity("mystoragepl2021", "test-container")

    # Test SQL
    print("\n--- Azure SQL ---")
    test_sql_connectivity("sql-privatelink-demo", "mydb", "sqladmin", "your-password")
```

## Private Link Service (Custom Services)

Expose your own services via Private Link:

```bash
# Create an internal load balancer
az network lb create \
    --name ilb-private-service \
    --resource-group rg-privatelink-demo \
    --sku Standard \
    --vnet-name vnet-privatelink \
    --subnet subnet-private-endpoints \
    --frontend-ip-name frontend \
    --backend-pool-name backend

# Create a Private Link Service
az network private-link-service create \
    --name pls-my-service \
    --resource-group rg-privatelink-demo \
    --vnet-name vnet-privatelink \
    --subnet subnet-private-endpoints \
    --lb-name ilb-private-service \
    --lb-frontend-ip-configs frontend \
    --location eastus

# Get the alias for sharing
az network private-link-service show \
    --name pls-my-service \
    --resource-group rg-privatelink-demo \
    --query alias
```

Consumers can then create private endpoints to your service:

```bash
# In consumer subscription
az network private-endpoint create \
    --name pe-consumer \
    --resource-group rg-consumer \
    --vnet-name vnet-consumer \
    --subnet subnet-endpoints \
    --private-connection-resource-id "/subscriptions/{provider-sub}/resourceGroups/rg-privatelink-demo/providers/Microsoft.Network/privateLinkServices/pls-my-service" \
    --connection-name consumer-connection \
    --manual-request true \
    --request-message "Please approve access for department X"
```

## Monitoring Private Endpoints

Set up monitoring for private endpoints:

```kusto
// Private endpoint connection status
AzureDiagnostics
| where Category == "PrivateEndpointConnections"
| project TimeGenerated, Resource, ProvisioningState, PrivateLinkServiceConnectionState
| order by TimeGenerated desc

// Traffic through private endpoints
AzureNetworkAnalytics_CL
| where SubType_s == "FlowLog"
| where DestIP_s startswith "10.0.1."  // Private endpoint subnet
| summarize BytesSent = sum(BytesSent_d), BytesReceived = sum(BytesReceived_d)
    by bin(TimeGenerated, 1h), DestIP_s
| render timechart
```

## Best Practices

1. **Centralized DNS Management**: Use Azure Private DNS zones linked to a hub VNet
2. **Disable Public Access**: After configuring Private Link, disable public endpoints
3. **Use Network Security Groups**: Apply NSGs to private endpoint subnets
4. **Monitor Connections**: Track private endpoint connection states
5. **Plan IP Addressing**: Ensure sufficient IP addresses in private endpoint subnets

## Conclusion

Azure Private Link is essential for organizations implementing Zero Trust security models. By eliminating public internet exposure for Azure services, you significantly reduce your attack surface while maintaining seamless connectivity.

Start with critical services like Azure SQL and Key Vault, then expand to other PaaS services as you mature your private networking strategy.
