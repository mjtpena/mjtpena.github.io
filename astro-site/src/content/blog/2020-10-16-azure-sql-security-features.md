---
title: "Azure SQL Security Features: Protect Your Data"
description: "Encrypt sensitive columns—keys never exposed to SQL Server. Azure SQL security is comprehensive—use all layers for maximum protection."
author: Michael John Peña
draft: false
date: 2020-10-16
tags:
  - Azure
  - SQL
  - Security
  - Database
---

## Security Layers

```
┌─────────────────────────────────────┐
│         Network Security            │
│   (Firewall, Private Link, VNet)    │
├─────────────────────────────────────┤
│       Access Management             │
│   (Azure AD, SQL Auth, RBAC)        │
├─────────────────────────────────────┤
│       Data Protection               │
│   (TDE, Always Encrypted, Masking)  │
├─────────────────────────────────────┤
│       Threat Protection             │
│   (ATP, Auditing, Vulnerability)    │
└─────────────────────────────────────┘
```

## Firewall Rules

```bash
# Allow specific IP
az sql server firewall-rule create \
    --resource-group myRG \
    --server myserver \
    --name AllowMyIP \
    --start-ip-address 203.0.113.50 \
    --end-ip-address 203.0.113.50

# Allow Azure services
az sql server firewall-rule create \
    --resource-group myRG \
    --server myserver \
    --name AllowAzureServices \
    --start-ip-address 0.0.0.0 \
    --end-ip-address 0.0.0.0
```

## Azure AD Authentication

```sql
-- Create Azure AD admin
-- In Azure Portal: SQL Server → Azure Active Directory → Set admin

-- Create contained user from Azure AD
CREATE USER [user@domain.com] FROM EXTERNAL PROVIDER;
ALTER ROLE db_datareader ADD MEMBER [user@domain.com];

-- Create Azure AD group user
CREATE USER [MyAzureADGroup] FROM EXTERNAL PROVIDER;
ALTER ROLE db_owner ADD MEMBER [MyAzureADGroup];
```

## Always Encrypted

Encrypt sensitive columns—keys never exposed to SQL Server.

```sql
-- Create column master key
CREATE COLUMN MASTER KEY MyCMK
WITH (
    KEY_STORE_PROVIDER_NAME = 'AZURE_KEY_VAULT',
    KEY_PATH = 'https://myvault.vault.azure.net/keys/MyKey/abc123'
);

-- Create column encryption key
CREATE COLUMN ENCRYPTION KEY MyCEK
WITH VALUES (
    COLUMN_MASTER_KEY = MyCMK,
    ALGORITHM = 'RSA_OAEP',
    ENCRYPTED_VALUE = 0x01700000...
);

-- Create table with encrypted columns
CREATE TABLE Patients (
    PatientId INT PRIMARY KEY,
    SSN CHAR(11) ENCRYPTED WITH (
        COLUMN_ENCRYPTION_KEY = MyCEK,
        ENCRYPTION_TYPE = Deterministic,
        ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256'
    ),
    Diagnosis NVARCHAR(100) ENCRYPTED WITH (
        COLUMN_ENCRYPTION_KEY = MyCEK,
        ENCRYPTION_TYPE = Randomized,
        ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256'
    )
);
```

## Dynamic Data Masking

```sql
-- Mask email column
ALTER TABLE Users
ALTER COLUMN Email ADD MASKED WITH (FUNCTION = 'email()');

-- Mask partial SSN
ALTER TABLE Employees
ALTER COLUMN SSN ADD MASKED WITH (FUNCTION = 'partial(0,"XXX-XX-",4)');

-- Grant unmask permission
GRANT UNMASK TO DataAnalyst;
```

## Row-Level Security

```sql
-- Create security policy
CREATE SCHEMA Security;
GO

CREATE FUNCTION Security.fn_securitypredicate(@TenantId INT)
RETURNS TABLE
WITH SCHEMABINDING
AS
    RETURN SELECT 1 AS fn_securitypredicate_result
    WHERE @TenantId = CAST(SESSION_CONTEXT(N'TenantId') AS INT);
GO

CREATE SECURITY POLICY TenantFilter
ADD FILTER PREDICATE Security.fn_securitypredicate(TenantId) ON dbo.Sales
WITH (STATE = ON);
```

## Auditing

```bash
# Enable server auditing to blob storage
az sql server audit-policy update \
    --resource-group myRG \
    --server myserver \
    --state Enabled \
    --storage-account mystorageaccount \
    --retention-days 90
```

## Advanced Threat Protection

```bash
# Enable ATP
az sql db threat-policy update \
    --resource-group myRG \
    --server myserver \
    --database mydb \
    --state Enabled \
    --email-addresses security@company.com \
    --email-account-admins Enabled
```

Azure SQL security is comprehensive—use all layers for maximum protection.
