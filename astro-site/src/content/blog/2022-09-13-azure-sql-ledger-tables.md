---
title: "Ledger Tables in Azure SQL Database"
description: "Ledger tables maintain a complete history of all changes with cryptographic hashes, making it possible to verify that data hasn't been tampered with."
author: "Michael John Peña"
draft: false
date: 2022-09-13
tags: ["Azure", "SQL Database", "Ledger", "Security", "Blockchain"]
---

## Understanding Ledger Tables

Ledger tables maintain a complete history of all changes with cryptographic hashes, making it possible to verify that data hasn't been tampered with.

### Creating Updatable Ledger Tables

```sql
-- Create an updatable ledger table
CREATE TABLE dbo.BankTransactions
(
    TransactionID INT NOT NULL PRIMARY KEY,
    AccountID INT NOT NULL,
    TransactionType NVARCHAR(10) NOT NULL,
    Amount DECIMAL(18, 2) NOT NULL,
    Description NVARCHAR(200),
    TransactionDate DATETIME2 NOT NULL DEFAULT GETUTCDATE()
)
WITH (
    SYSTEM_VERSIONING = ON,
    LEDGER = ON
);

-- View ledger table metadata
SELECT
    t.name AS table_name,
    t.ledger_type_desc,
    h.name AS history_table_name,
    lv.name AS ledger_view_name
FROM sys.tables t
JOIN sys.tables h ON t.history_table_id = h.object_id
JOIN sys.views lv ON t.ledger_view_id = lv.object_id
WHERE t.name = 'BankTransactions';
```

### Creating Append-Only Ledger Tables

```sql
-- Create an append-only ledger table (no updates or deletes allowed)
CREATE TABLE dbo.AuditLog
(
    LogID INT IDENTITY(1,1) NOT NULL,
    EventType NVARCHAR(50) NOT NULL,
    EventDescription NVARCHAR(MAX) NOT NULL,
    UserID INT NOT NULL,
    EventTimestamp DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    SourceIP NVARCHAR(50)
)
WITH (LEDGER = ON (APPEND_ONLY = ON));

-- Attempting to update or delete will fail
-- UPDATE dbo.AuditLog SET EventType = 'Modified' WHERE LogID = 1;
-- Error: Cannot update or delete data in an append-only ledger table
```

### Inserting and Querying Ledger Data

```csharp
using Microsoft.Data.SqlClient;

public class LedgerService
{
    private readonly string _connectionString;

    public LedgerService(string connectionString)
    {
        _connectionString = connectionString;
    }

    public async Task<int> RecordTransactionAsync(BankTransaction transaction)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var sql = @"
            INSERT INTO dbo.BankTransactions
                (TransactionID, AccountID, TransactionType, Amount, Description)
            VALUES
                (@TransactionID, @AccountID, @TransactionType, @Amount, @Description);

            SELECT SCOPE_IDENTITY();";

        using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@TransactionID", transaction.TransactionID);
        command.Parameters.AddWithValue("@AccountID", transaction.AccountID);
        command.Parameters.AddWithValue("@TransactionType", transaction.TransactionType);
        command.Parameters.AddWithValue("@Amount", transaction.Amount);
        command.Parameters.AddWithValue("@Description", transaction.Description ?? (object)DBNull.Value);

        var result = await command.ExecuteScalarAsync();
        return Convert.ToInt32(result);
    }

    public async Task<List<LedgerEntry>> GetTransactionHistoryAsync(int transactionId)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        // Query the ledger view to see all versions
        var sql = @"
            SELECT
                TransactionID,
                AccountID,
                TransactionType,
                Amount,
                Description,
                ledger_start_transaction_id,
                ledger_end_transaction_id,
                ledger_start_sequence_number,
                ledger_end_sequence_number
            FROM dbo.BankTransactions_Ledger
            WHERE TransactionID = @TransactionID
            ORDER BY ledger_start_sequence_number";

        using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@TransactionID", transactionId);

        var entries = new List<LedgerEntry>();
        using var reader = await command.ExecuteReaderAsync();

        while (await reader.ReadAsync())
        {
            entries.Add(new LedgerEntry
            {
                TransactionID = reader.GetInt32(0),
                AccountID = reader.GetInt32(1),
                TransactionType = reader.GetString(2),
                Amount = reader.GetDecimal(3),
                Description = reader.IsDBNull(4) ? null : reader.GetString(4),
                StartTransactionId = reader.GetInt64(5),
                EndTransactionId = reader.IsDBNull(6) ? null : reader.GetInt64(6),
                StartSequenceNumber = reader.GetInt64(7),
                EndSequenceNumber = reader.IsDBNull(8) ? null : reader.GetInt64(8)
            });
        }

        return entries;
    }
}

public class BankTransaction
{
    public int TransactionID { get; set; }
    public int AccountID { get; set; }
    public string TransactionType { get; set; }
    public decimal Amount { get; set; }
    public string Description { get; set; }
}

public class LedgerEntry : BankTransaction
{
    public long StartTransactionId { get; set; }
    public long? EndTransactionId { get; set; }
    public long StartSequenceNumber { get; set; }
    public long? EndSequenceNumber { get; set; }
}
```

### Verifying Ledger Integrity

```sql
-- Generate digests for verification
DECLARE @digest_locations NVARCHAR(MAX) =
    (SELECT * FROM sys.database_ledger_digest_locations
     FOR JSON AUTO, INCLUDE_NULL_VALUES);

-- Verify the ledger
EXECUTE sp_verify_database_ledger_from_digest_storage
    @digest_locations;

-- Get database ledger blocks
SELECT
    block_id,
    block_sequence_number,
    block_hash,
    table_hashes,
    ledger_create_time
FROM sys.database_ledger_blocks
ORDER BY block_sequence_number DESC;

-- View ledger transactions
SELECT
    transaction_id,
    commit_time,
    principal_name,
    table_hashes
FROM sys.database_ledger_transactions
ORDER BY commit_time DESC;
```

### Programmatic Verification

```csharp
public class LedgerVerificationService
{
    private readonly string _connectionString;

    public async Task<VerificationResult> VerifyLedgerAsync()
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        try
        {
            // Get digest locations
            var digestQuery = @"
                SELECT * FROM sys.database_ledger_digest_locations
                FOR JSON AUTO, INCLUDE_NULL_VALUES";

            string digestLocations;
            using (var cmd = new SqlCommand(digestQuery, connection))
            {
                digestLocations = (string)await cmd.ExecuteScalarAsync();
            }

            // Run verification
            var verifyQuery = @"
                EXECUTE sp_verify_database_ledger_from_digest_storage @digest_locations";

            using var verifyCmd = new SqlCommand(verifyQuery, connection);
            verifyCmd.Parameters.AddWithValue("@digest_locations", digestLocations);

            await verifyCmd.ExecuteNonQueryAsync();

            return new VerificationResult
            {
                IsValid = true,
                VerificationTime = DateTime.UtcNow,
                Message = "Ledger verification successful"
            };
        }
        catch (SqlException ex)
        {
            return new VerificationResult
            {
                IsValid = false,
                VerificationTime = DateTime.UtcNow,
                Message = $"Ledger verification failed: {ex.Message}"
            };
        }
    }

    public async Task<List<LedgerBlock>> GetRecentBlocksAsync(int count = 10)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var query = $@"
            SELECT TOP (@count)
                block_id,
                block_sequence_number,
                CONVERT(NVARCHAR(MAX), block_hash, 1) AS block_hash,
                ledger_create_time
            FROM sys.database_ledger_blocks
            ORDER BY block_sequence_number DESC";

        using var command = new SqlCommand(query, connection);
        command.Parameters.AddWithValue("@count", count);

        var blocks = new List<LedgerBlock>();
        using var reader = await command.ExecuteReaderAsync();

        while (await reader.ReadAsync())
        {
            blocks.Add(new LedgerBlock
            {
                BlockId = reader.GetInt64(0),
                SequenceNumber = reader.GetInt64(1),
                BlockHash = reader.GetString(2),
                CreateTime = reader.GetDateTime(3)
            });
        }

        return blocks;
    }
}

public class VerificationResult
{
    public bool IsValid { get; set; }
    public DateTime VerificationTime { get; set; }
    public string Message { get; set; }
}

public class LedgerBlock
{
    public long BlockId { get; set; }
    public long SequenceNumber { get; set; }
    public string BlockHash { get; set; }
    public DateTime CreateTime { get; set; }
}
```

## Use Cases for Ledger Tables

1. **Financial records** - Immutable transaction history
2. **Audit trails** - Compliance and regulatory requirements
3. **Healthcare records** - Tamper-evident patient data
4. **Supply chain** - Provenance tracking
5. **Legal documents** - Chain of custody

Ledger tables provide enterprise-grade data integrity without the overhead of maintaining a separate blockchain infrastructure.
