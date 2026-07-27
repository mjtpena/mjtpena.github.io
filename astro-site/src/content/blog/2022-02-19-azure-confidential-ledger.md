---
title: "Azure Confidential Ledger: Tamper-Proof Record Keeping"
author: Michael John Peña
draft: false
date: 2022-02-19
url: /blog/azure-confidential-ledger/
tags:
  - azure
  - blockchain
  - security
  - compliance

---

I wrote "Azure Confidential Ledger: Tamper-Proof Record Keeping" to share practical, production-minded guidance on this topic.

## Understanding Confidential Ledger

Key features:
- Tamper-evident blockchain
- Runs in Azure Confidential Computing enclaves
- Cryptographically verifiable
- No single point of trust

## Creating a Confidential Ledger

```bicep
resource confidentialLedger 'Microsoft.ConfidentialLedger/ledgers@2022-05-13' = {
  name: 'ledger-${environment}'
  location: location
  properties: {
    ledgerType: 'Private'
    aadBasedSecurityPrincipals: [
      {
        principalId: adminPrincipalId
        ledgerRoleName: 'Administrator'
      }
      {
        principalId: appPrincipalId
        ledgerRoleName: 'Contributor'
      }
    ]
    certBasedSecurityPrincipals: []
  }
}

output ledgerUri string = confidentialLedger.properties.ledgerUri
output identityServiceUri string = confidentialLedger.properties.identityServiceUri
```

## Writing to the Ledger

```csharp
using Azure.Identity;
using Azure.Security.ConfidentialLedger;

public class AuditLedgerService
{
    private readonly ConfidentialLedgerClient _client;

    public AuditLedgerService(string ledgerUri)
    {
        var credential = new DefaultAzureCredential();
        _client = new ConfidentialLedgerClient(new Uri(ledgerUri), credential);
    }

    public async Task<string> WriteAuditEntryAsync(AuditEntry entry)
    {
        var content = JsonSerializer.Serialize(entry);

        // Write to ledger - this is immutable once committed
        var operation = await _client.PostLedgerEntryAsync(
            WaitUntil.Completed,
            RequestContent.Create(new { contents = content }),
            collectionId: "audit-log");

        var response = operation.Value;
        return response.TransactionId;
    }

    public async Task<AuditEntry> ReadAuditEntryAsync(string transactionId)
    {
        var response = await _client.GetLedgerEntryAsync(transactionId);
        var entry = response.Value;

        return JsonSerializer.Deserialize<AuditEntry>(entry.Contents);
    }

    public async Task<bool> VerifyTransactionAsync(string transactionId)
    {
        // Get receipt for cryptographic verification
        var receipt = await _client.GetReceiptAsync(transactionId);

        // Verify the receipt against the ledger
        return await _client.VerifyReceiptAsync(receipt.Value);
    }
}

public class AuditEntry
{
    public string EventType { get; set; }
    public string UserId { get; set; }
    public string Action { get; set; }
    public string ResourceId { get; set; }
    public Dictionary<string, object> Details { get; set; }
    public DateTime Timestamp { get; set; }
}
```

## Python SDK Example

```python
from azure.identity import DefaultAzureCredential
from azure.confidentialledger import ConfidentialLedgerClient
from azure.confidentialledger.identity_service import ConfidentialLedgerIdentityServiceClient
import json
from datetime import datetime

class ConfidentialAuditLog:
    def __init__(self, ledger_url: str, identity_url: str):
        credential = DefaultAzureCredential()

        # Get ledger identity
        identity_client = ConfidentialLedgerIdentityServiceClient(identity_url)
        ledger_cert = identity_client.get_ledger_identity(ledger_url.split('//')[1].split('.')[0])

        self.client = ConfidentialLedgerClient(
            ledger_url,
            credential=credential,
            ledger_certificate_path=ledger_cert.ledger_tls_certificate
        )

    def log_event(self, event_type: str, user_id: str, action: str, details: dict) -> str:
        """Log an immutable audit event."""
        entry = {
            "eventType": event_type,
            "userId": user_id,
            "action": action,
            "details": details,
            "timestamp": datetime.utcnow().isoformat()
        }

        # Post to ledger
        result = self.client.create_ledger_entry(
            entry={"contents": json.dumps(entry)},
            collection_id="audit-events"
        )

        # Wait for commit
        transaction_id = result["transactionId"]
        self.client.wait_until_committed(transaction_id)

        return transaction_id

    def get_audit_trail(self, collection_id: str = "audit-events"):
        """Retrieve all entries from the audit trail."""
        entries = []
        for entry in self.client.list_ledger_entries(collection_id=collection_id):
            entries.append({
                "transactionId": entry.transaction_id,
                "contents": json.loads(entry.contents),
                "collectionId": entry.collection_id
            })
        return entries

    def verify_entry(self, transaction_id: str) -> bool:
        """Verify an entry hasn't been tampered with."""
        receipt = self.client.get_receipt(transaction_id)
        # Verification logic using Merkle tree proof
        return self._verify_merkle_proof(receipt)

# Usage
ledger = ConfidentialAuditLog(
    "https://my-ledger.confidential-ledger.azure.com",
    "https://identity.confidential-ledger.azure.com"
)

tx_id = ledger.log_event(
    event_type="DATA_ACCESS",
    user_id="user@company.com",
    action="EXPORT",
    details={
        "table": "customers",
        "records": 1000,
        "format": "csv"
    }
)
```

## Use Cases

### Financial Audit Trail

```csharp
public class FinancialAuditService
{
    private readonly AuditLedgerService _ledger;

    public async Task RecordTransactionAsync(FinancialTransaction transaction)
    {
        var auditEntry = new AuditEntry
        {
            EventType = "FINANCIAL_TRANSACTION",
            UserId = transaction.InitiatedBy,
            Action = transaction.Type.ToString(),
            ResourceId = transaction.TransactionId,
            Details = new Dictionary<string, object>
            {
                ["amount"] = transaction.Amount,
                ["currency"] = transaction.Currency,
                ["fromAccount"] = transaction.FromAccount,
                ["toAccount"] = transaction.ToAccount,
                ["approvedBy"] = transaction.ApprovedBy
            },
            Timestamp = DateTime.UtcNow
        };

        var txId = await _ledger.WriteAuditEntryAsync(auditEntry);

        // Store transaction ID for future verification
        transaction.LedgerTransactionId = txId;
    }

    public async Task<bool> VerifyTransactionIntegrityAsync(string ledgerTxId)
    {
        return await _ledger.VerifyTransactionAsync(ledgerTxId);
    }
}
```

### Healthcare Compliance

```csharp
public class HealthcareAuditService
{
    public async Task LogPatientDataAccessAsync(
        string userId,
        string patientId,
        string accessType,
        string purpose)
    {
        var entry = new AuditEntry
        {
            EventType = "PATIENT_DATA_ACCESS",
            UserId = userId,
            Action = accessType,
            ResourceId = patientId,
            Details = new Dictionary<string, object>
            {
                ["purpose"] = purpose,
                ["hipaaCompliance"] = true,
                ["accessLocation"] = GetAccessLocation()
            },
            Timestamp = DateTime.UtcNow
        };

        await _ledger.WriteAuditEntryAsync(entry);
    }
}
```

## Querying the Ledger

```csharp
public async Task<List<AuditEntry>> GetAuditTrailAsync(
    string resourceId,
    DateTime? fromDate = null,
    DateTime? toDate = null)
{
    var entries = new List<AuditEntry>();

    await foreach (var page in _client.GetLedgerEntriesAsync(collectionId: "audit-log"))
    {
        var entry = JsonSerializer.Deserialize<AuditEntry>(page.Contents);

        if (entry.ResourceId == resourceId &&
            (fromDate == null || entry.Timestamp >= fromDate) &&
            (toDate == null || entry.Timestamp <= toDate))
        {
            entries.Add(entry);
        }
    }

    return entries;
}
```

Azure Confidential Ledger provides cryptographically verifiable, tamper-proof record keeping for compliance-critical scenarios.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
