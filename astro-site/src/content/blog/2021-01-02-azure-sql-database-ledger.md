---
title: "Azure SQL Database Ledger: Tamper-Proof Data"
description: "SQL Ledger: trust through cryptographic verification."
author: Michael John Peña
draft: false
date: 2021-01-02
tags:
  - Azure
  - SQL
  - Ledger
  - Security
---

## Ledger Tables Types

### Updatable Ledger Tables

```sql
-- Track all changes (INSERT, UPDATE, DELETE)
CREATE TABLE Accounts (
    AccountId INT PRIMARY KEY,
    Name NVARCHAR(100),
    Balance DECIMAL(18,2)
)
WITH (LEDGER = ON);
```

### Append-Only Ledger Tables

```sql
-- Only INSERT allowed (immutable audit log)
CREATE TABLE AuditLog (
    EventId INT IDENTITY PRIMARY KEY,
    EventTime DATETIME2 DEFAULT GETUTCDATE(),
    EventType NVARCHAR(50),
    Details NVARCHAR(MAX)
)
WITH (
    LEDGER = ON,
    APPEND_ONLY = ON
);
```

## System Columns

```sql
-- Ledger adds hidden columns automatically
SELECT
    AccountId,
    Name,
    Balance,
    ledger_transaction_id,
    ledger_sequence_number,
    ledger_operation_type,
    ledger_operation_type_desc
FROM Accounts
FOR LEDGER_HISTORY;
```

## History View

```sql
-- Query complete history
SELECT * FROM Accounts_Ledger;

-- Results include:
-- AccountId, Name, Balance (data columns)
-- ledger_start_transaction_id
-- ledger_end_transaction_id
-- ledger_start_sequence_number
-- ledger_end_sequence_number
-- ledger_operation_type (1=INSERT, 2=DELETE)
```

## Verification

```sql
-- Generate database digest
EXEC sys.sp_generate_database_ledger_digest;

-- Returns JSON with hash of all transactions
-- Store digest externally for verification
```

```python
# Store digest in Azure Confidential Ledger
from azure.confidential_ledger import ConfidentialLedgerClient

client = ConfidentialLedgerClient(...)
client.create_ledger_entry(contents=digest_json)
```

## Verify Integrity

```sql
-- Verify ledger integrity
EXEC sys.sp_verify_database_ledger
    @digest_locations = N'[{
        "path": "https://myacl.confidential-ledger.azure.com",
        "last_digest_block_id": 100
    }]';
```

## Use Cases

| Scenario | Benefit |
|----------|---------|
| Financial transactions | Audit trail |
| Healthcare records | Compliance |
| Supply chain | Provenance |
| Voting systems | Integrity |

## Example: Financial Audit

```sql
-- Create ledger table
CREATE TABLE Transactions (
    TransactionId INT IDENTITY PRIMARY KEY,
    FromAccount INT,
    ToAccount INT,
    Amount DECIMAL(18,2),
    TransactionTime DATETIME2 DEFAULT GETUTCDATE()
)
WITH (LEDGER = ON, APPEND_ONLY = ON);

-- Insert transactions
INSERT INTO Transactions (FromAccount, ToAccount, Amount)
VALUES (1001, 1002, 500.00);

-- Query audit trail
SELECT
    TransactionId,
    FromAccount,
    ToAccount,
    Amount,
    TransactionTime,
    ledger_transaction_id
FROM Transactions;

-- Verify no tampering
EXEC sys.sp_verify_database_ledger;
```

## Automatic Digest Storage

```sql
-- Configure automatic digest storage
ALTER DATABASE CURRENT
SET LEDGER_DIGEST_STORAGE =
    PATH = 'https://myacl.confidential-ledger.azure.com'
    WITH CREDENTIAL = MyACLCredential;
```

## Key Benefits

1. **Tamper evidence** - Cryptographic hashes detect changes
2. **Historical queries** - Full change history
3. **External verification** - Digests stored outside SQL
4. **No blockchain complexity** - Standard SQL interfaces

SQL Ledger: trust through cryptographic verification.
