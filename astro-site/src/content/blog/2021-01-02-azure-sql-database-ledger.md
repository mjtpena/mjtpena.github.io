---
title: "Tamper-Evident Audit Trails in Azure SQL Database"
description: "How to make tampering detectable in Azure SQL Database with temporal tables, a T-SQL hash chain, auditing, and immutable blob storage."
author: Michael John Peña
draft: false
date: 2021-01-02
tags:
  - Azure
  - SQL
  - Security
  - Compliance
  - Storage
---

Most "audit trail" tables in line-of-business databases are only as trustworthy as the least careful person with `db_owner`. An auditor asking "how do you know nobody changed these payment records?" isn't asking whether you log changes. They're asking whether a privileged insider could change the data *and* the log without anyone noticing. Azure SQL Database has no single switch for that, but you can build a design where tampering is detectable by combining features that are generally available today.

## Tamper-proof versus tamper-evident

Be precise about the goal, because it changes the design. **Tamper-proof** means nobody can alter the data. Inside a database you administer, that isn't achievable: someone can always hold enough rights to drop a trigger, switch off a feature or restore an old backup. **Tamper-evident** means alterations can still happen, but they leave proof that can't be erased by the same person.

My rule of thumb: put the evidence somewhere the database administrators can't write to. Every layer below follows from that.

| Layer | What it gives you | What a privileged insider can still do |
|---|---|---|
| Temporal tables | Automatic row history | Turn off system versioning and edit history |
| Append-only table with triggers | Blocks casual `UPDATE`/`DELETE` | Disable or drop the trigger |
| Hash chain in T-SQL | Any edit to a row breaks the chain | Recompute the whole chain after the edit |
| Chain head anchored in immutable blob storage | Recomputed chains no longer match the anchor | Nothing silent, as long as the storage is controlled by a different team |
| Azure SQL auditing to immutable storage | A record of who ran what, including the tampering itself | Nothing silent, under the same separation |

## Temporal tables: history, not evidence

[System-versioned temporal tables](https://learn.microsoft.com/en-us/sql/relational-databases/tables/temporal-tables) are the first thing people reach for, and they're excellent for "what did this row look like last Tuesday?" queries. The engine writes the previous version of every updated or deleted row into a history table, and you can't modify that history table directly while `SYSTEM_VERSIONING = ON`.

The catch is that anyone with `CONTROL` on the table and its history table (which `db_owner` has) can run `ALTER TABLE ... SET (SYSTEM_VERSIONING = OFF)`, edit both tables freely and switch versioning back on. Nothing in the data shows that it happened. Temporal tables are a convenience feature, not a control. Use them for history, but don't present them to an auditor as integrity protection.

## An append-only table with a hash chain

For records that must never change (payments, approvals, consent events), I'd model them as an append-only event table and link each row to the previous one with a SHA-256 hash. Change any column in any row, or delete a row, and every hash after it stops matching.

```sql
CREATE TABLE dbo.PaymentEvents
(
    EventId       BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_PaymentEvents PRIMARY KEY,
    AccountId     INT           NOT NULL,
    Amount        DECIMAL(18, 2) NOT NULL,
    EventType     NVARCHAR(50)  NOT NULL,
    RecordedAtUtc DATETIME2(3)  NOT NULL,
    PreviousHash  BINARY(32)    NOT NULL,
    RowHash       BINARY(32)    NOT NULL
);
GO

CREATE TRIGGER dbo.trg_PaymentEvents_AppendOnly
ON dbo.PaymentEvents
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 50001, N'dbo.PaymentEvents is append-only.', 1;
END;
GO
```

The trigger only stops accidents and well-meaning developers. Its real value is that disabling it requires an explicit `DISABLE TRIGGER` or `DROP TRIGGER` statement, which auditing will capture. `TRUNCATE TABLE` is the other gap: it doesn't fire `DELETE` triggers, so it skips this one entirely. It does need `ALTER` permission on the table, `BATCH_COMPLETED_GROUP` auditing records it, and the anchors described below will expose the missing rows.

Writes go through a stored procedure so the hash is always computed the same way. The application lock serialises appenders, because two concurrent inserts would otherwise read the same previous hash and fork the chain.

```sql
CREATE PROCEDURE dbo.AppendPaymentEvent
    @AccountId INT,
    @Amount    DECIMAL(18, 2),
    @EventType NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    BEGIN TRANSACTION;

    EXEC sp_getapplock
        @Resource  = N'PaymentEvents_chain',
        @LockMode  = N'Exclusive',
        @LockOwner = N'Transaction';

    DECLARE @RecordedAtUtc DATETIME2(3) = SYSUTCDATETIME();

    DECLARE @PreviousHash BINARY(32) = ISNULL(
        (SELECT TOP (1) RowHash FROM dbo.PaymentEvents ORDER BY EventId DESC),
        CAST(0x00 AS BINARY(32)));

    DECLARE @RowHash BINARY(32) = HASHBYTES(N'SHA2_256', CONCAT(
        @AccountId, N'|',
        CONVERT(NVARCHAR(40), @Amount), N'|',
        @EventType, N'|',
        CONVERT(NVARCHAR(30), @RecordedAtUtc, 126), N'|',
        CONVERT(NVARCHAR(64), @PreviousHash, 2)));

    INSERT INTO dbo.PaymentEvents
        (AccountId, Amount, EventType, RecordedAtUtc, PreviousHash, RowHash)
    VALUES
        (@AccountId, @Amount, @EventType, @RecordedAtUtc, @PreviousHash, @RowHash);

    COMMIT TRANSACTION;
END;
GO
```

A few deliberate choices here. [`HASHBYTES`](https://learn.microsoft.com/en-us/sql/t-sql/functions/hashbytes-transact-sql) with `SHA2_256` is built in, so there's no CLR or application-side crypto to keep in sync. Values are converted to strings with explicit styles (style 126 for the timestamp, style 2 for hex without the `0x` prefix) so the verification query reproduces exactly the same input. The timestamp is captured once into a variable rather than relying on a column default, because the hash has to cover the value that's actually stored. If free-text columns could contain the `|` delimiter, hash a length-prefixed form instead, or two different rows could produce the same input string.

Verification recomputes every hash and compares each row's `PreviousHash` with the row before it:

```sql
WITH chain AS
(
    SELECT
        EventId,
        RowHash,
        PreviousHash,
        HASHBYTES(N'SHA2_256', CONCAT(
            AccountId, N'|',
            CONVERT(NVARCHAR(40), Amount), N'|',
            EventType, N'|',
            CONVERT(NVARCHAR(30), RecordedAtUtc, 126), N'|',
            CONVERT(NVARCHAR(64), PreviousHash, 2))) AS RecomputedHash,
        LAG(RowHash, 1, CAST(0x00 AS BINARY(32))) OVER (ORDER BY EventId) AS ExpectedPreviousHash
    FROM dbo.PaymentEvents
)
SELECT
    EventId,
    CASE
        WHEN RowHash <> RecomputedHash THEN N'Row contents changed'
        ELSE N'Chain broken (row inserted or deleted before this one)'
    END AS Problem
FROM chain
WHERE RowHash <> RecomputedHash
   OR PreviousHash <> ExpectedPreviousHash
ORDER BY EventId;
```

An empty result means the chain is internally consistent. That's not the same as untampered: deleting the most recent rows leaves a perfectly consistent chain behind, which brings us to the part most home-grown designs skip.

## Anchor the chain outside the database

A hash chain on its own proves nothing against someone who controls the database: they can edit row 500 and then recompute rows 500 onwards. The fix is to regularly publish the latest `RowHash` (the "head" of the chain) to storage that the database team can't overwrite. If the chain is later rewritten, the recomputed head for that `EventId` won't match the published one.

Azure Blob Storage [immutable storage](https://learn.microsoft.com/en-us/azure/storage/blobs/immutable-storage-overview) is the right target. A time-based retention policy puts a container into a write once, read many (WORM) state. While a time-based retention policy is in place, blobs in the container can't be modified or deleted until their retention period ends. Locking the policy means it can't be deleted or shortened, only extended (up to five times). The storage account should sit in a subscription or resource group owned by security or risk, not by the people who administer the database. Don't substitute a [lifecycle management rule](/blog/2020-08-08-azure-blob-storage-lifecycle/) for this: anyone with the right role can edit one, so it's a cost tool, not a control.

```powershell
# Run by the security team, not the database team.
# Retention of 2555 days is roughly seven years; adjust to your obligations.
Set-AzRmStorageContainerImmutabilityPolicy `
    -ResourceGroupName "<your-security-rg>" `
    -StorageAccountName "<youranchorstorage>" `
    -ContainerName "chain-anchors" `
    -ImmutabilityPeriod 2555
```

Each anchor is written as a new block blob and never appended to, so this container doesn't need protected append writes. Leave the policy unlocked while you test, then lock it. The lock cmdlet needs the policy's current ETag:

```powershell
$policy = Get-AzRmStorageContainerImmutabilityPolicy `
    -ResourceGroupName "<your-security-rg>" `
    -StorageAccountName "<youranchorstorage>" `
    -ContainerName "chain-anchors"

Lock-AzRmStorageContainerImmutabilityPolicy `
    -ResourceGroupName "<your-security-rg>" `
    -StorageAccountName "<youranchorstorage>" `
    -ContainerName "chain-anchors" `
    -Etag $policy.Etag
```

Locking is irreversible, which is exactly the point.

The export job then writes one small blob per run, named so it never collides with an earlier one. This fragment assumes the job already has a signed-in Az context and SQL credentials from a secure store such as Key Vault:

```powershell
# Fragment: $sqlCredential and the Az context come from your automation setup.
$head = Invoke-Sqlcmd `
    -ServerInstance "<your-server>.database.windows.net" `
    -Database "<your-database>" `
    -Username $sqlCredential.UserName `
    -Password $sqlCredential.GetNetworkCredential().Password `
    -Query "SELECT TOP (1) EventId, CONVERT(VARCHAR(64), RowHash, 2) AS RowHash FROM dbo.PaymentEvents ORDER BY EventId DESC;"

$anchor = [ordered]@{
    database      = "<your-database>"
    eventId       = $head.EventId
    rowHash       = $head.RowHash
    capturedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json

$fileName = "anchor-$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')).json"
$path = Join-Path ([System.IO.Path]::GetTempPath()) $fileName
Set-Content -Path $path -Value $anchor -Encoding UTF8

$ctx = New-AzStorageContext -StorageAccountName "<youranchorstorage>" -UseConnectedAccount
Set-AzStorageBlobContent -File $path -Container "chain-anchors" -Blob $fileName -Context $ctx
```

How often you anchor sets your exposure window. Anything written since the last anchor could be rewritten undetected by someone with full database access, so hourly is a sensible default for financial events and daily is usually fine for lower-risk records. To verify, take any anchor, recompute the hash for that `EventId` with the query above, and compare. If the anchored `EventId` no longer exists, or the table's maximum `EventId` is lower than the latest anchor, treat that as tampering.

## Turn on auditing, and send it somewhere immutable too

The hash chain tells you *that* something changed. [Azure SQL auditing](https://learn.microsoft.com/en-us/azure/azure-sql/database/auditing-overview) tells you *who* and *how*. The default action groups include `BATCH_COMPLETED_GROUP`, which records every batch executed, so `ALTER TABLE ... SET (SYSTEM_VERSIONING = OFF)`, `DISABLE TRIGGER` and the `UPDATE` that followed them all land in the log.

Auditing writes to a `sqldbauditlogs` container in the audit storage account, which it creates on the first write. The logs are append blobs, so once that container exists it needs its own time-based retention policy with "Allow additional appends" enabled. Two constraints from the documentation catch people out: the audit retention setting can't be 0 when an immutability policy is in place, and the storage retention interval has to be shorter than the auditing retention.

```powershell
Set-AzSqlDatabaseAudit `
    -ResourceGroupName "<your-sql-rg>" `
    -ServerName "<your-server>" `
    -DatabaseName "<your-database>" `
    -BlobStorageTargetState Enabled `
    -StorageAccountResourceId "/subscriptions/<subscription-id>/resourceGroups/<your-security-rg>/providers/Microsoft.Storage/storageAccounts/<yourauditstorage>" `
    -RetentionInDays 3650
```

After the first audit records arrive, the security team applies the policy to the audit container. A 2,555-day immutability period sits inside the 3,650-day audit retention, which satisfies the "shorter than audit retention" rule:

```powershell
Set-AzRmStorageContainerImmutabilityPolicy `
    -ResourceGroupName "<your-security-rg>" `
    -StorageAccountName "<yourauditstorage>" `
    -ContainerName "sqldbauditlogs" `
    -ImmutabilityPeriod 2555 `
    -AllowProtectedAppendWrite $true
```

I'd enable auditing at the server level as well, so a new database on that server can't quietly start life unaudited.

## When not to build this

This design has real costs, so don't apply it everywhere:

- **Write throughput.** The application lock serialises every insert into the chain. That's fine for typical transactional volumes, but measure it under your own load before relying on it, and it's the wrong design for high-volume telemetry. Partition into several independent chains (per account or per business unit) if you need more.
- **Mutable data.** If the business legitimately updates records, a hash chain over the current state fights you. Chain the *events* that change the state, and keep the current state in an ordinary table derived from them.
- **Multi-party trust.** If several organisations who don't trust each other need to agree on the same record, a database you operate will never satisfy them, however well anchored. That's the case for a shared ledger such as Azure Blockchain Service, along with all the operational overhead that comes with it.
- **No separation of duties.** If the same person administers the database, the storage account and the subscription, the anchors are theatre. Fix the access model first.

## The decision

If an auditor needs evidence that records weren't altered, temporal tables alone aren't enough, and neither is a trigger. Use an append-only table with a hash chain for the records that matter, publish the chain head to locked immutable storage that the database team can't touch, and run Azure SQL auditing into a second immutable container. None of it is exotic. The hard part is the organisational one: making sure the people who could tamper with the data are not the people who control the evidence.
