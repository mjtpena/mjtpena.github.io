---
title: "Azure Managed HSM: FIPS 140-2 Level 3 Key Management"
author: Michael John Peña
draft: false
date: 2021-05-27
tags:
  - Azure
  - Security
  - HSM
  - Cryptography
  - Key Vault

---

I wrote "Azure Managed HSM: FIPS 140-2 Level 3 Key Management" to share practical, production-minded guidance on this topic.

## Managed HSM vs Key Vault

| Feature | Key Vault Premium | Managed HSM |
|---------|------------------|-------------|
| HSM Type | Multi-tenant | Single-tenant |
| FIPS Level | 140-2 Level 2 | 140-2 Level 3 |
| Admin Control | Azure-managed | Customer-managed |
| Key Sovereignty | Shared | Dedicated |
| Availability | Regional | Multi-region (pool) |
| Price | Per operation | Per HSM hour |

## Creating a Managed HSM

```bash
# Create Managed HSM pool
az keyvault create \
    --hsm-name my-managed-hsm \
    --resource-group security-rg \
    --location eastus \
    --administrators "user1@contoso.com" "user2@contoso.com" \
    --retention-days 90

# Note: HSM starts in "not activated" state
# Need to download and activate with security domain
```

## Security Domain Setup

The security domain is critical - it enables customer-controlled recovery:

```bash
# Download the security domain
# Requires 3 RSA key pairs for quorum (2 of 3 minimum)

# Generate RSA keys for security domain
openssl genrsa -out key1.pem 2048
openssl genrsa -out key2.pem 2048
openssl genrsa -out key3.pem 2048

# Extract public keys
openssl rsa -in key1.pem -outform PEM -pubout -out key1.pub
openssl rsa -in key2.pem -outform PEM -pubout -out key2.pub
openssl rsa -in key3.pem -outform PEM -pubout -out key3.pub

# Download security domain (requires 2-of-3 quorum)
az keyvault security-domain download \
    --hsm-name my-managed-hsm \
    --sd-wrapping-keys key1.pub key2.pub key3.pub \
    --sd-quorum 2 \
    --security-domain-file security-domain.json
```

## Key Operations

### Creating Keys

```python
from azure.identity import DefaultAzureCredential
from azure.keyvault.keys import KeyClient
from azure.keyvault.keys.crypto import CryptographyClient, EncryptionAlgorithm

credential = DefaultAzureCredential()
hsm_url = "https://my-managed-hsm.managedhsm.azure.net"

key_client = KeyClient(hsm_url, credential)

# Create RSA key
rsa_key = key_client.create_rsa_key(
    name="rsa-signing-key",
    size=4096,
    hardware_protected=True,
    key_operations=["sign", "verify"]
)

# Create EC key
ec_key = key_client.create_ec_key(
    name="ec-signing-key",
    curve="P-256K",  # secp256k1 for blockchain
    hardware_protected=True,
    key_operations=["sign", "verify"]
)

# Create AES key (symmetric)
from azure.keyvault.keys import KeyType
aes_key = key_client.create_oct_key(
    name="aes-encryption-key",
    size=256,
    hardware_protected=True,
    key_operations=["encrypt", "decrypt", "wrapKey", "unwrapKey"]
)
```

### Cryptographic Operations

```python
def encrypt_data(hsm_url, key_name, plaintext, credential):
    """Encrypt data using HSM key"""

    key_client = KeyClient(hsm_url, credential)
    key = key_client.get_key(key_name)

    crypto_client = CryptographyClient(key, credential)

    result = crypto_client.encrypt(
        algorithm=EncryptionAlgorithm.rsa_oaep_256,
        plaintext=plaintext.encode()
    )

    return result.ciphertext

def decrypt_data(hsm_url, key_name, ciphertext, credential):
    """Decrypt data using HSM key"""

    key_client = KeyClient(hsm_url, credential)
    key = key_client.get_key(key_name)

    crypto_client = CryptographyClient(key, credential)

    result = crypto_client.decrypt(
        algorithm=EncryptionAlgorithm.rsa_oaep_256,
        ciphertext=ciphertext
    )

    return result.plaintext.decode()

def sign_data(hsm_url, key_name, data, credential):
    """Sign data using HSM key"""

    key_client = KeyClient(hsm_url, credential)
    key = key_client.get_key(key_name)

    crypto_client = CryptographyClient(key, credential)

    # Hash the data first
    import hashlib
    digest = hashlib.sha256(data.encode()).digest()

    result = crypto_client.sign(
        algorithm="RS256",
        digest=digest
    )

    return result.signature

def verify_signature(hsm_url, key_name, data, signature, credential):
    """Verify signature using HSM key"""

    key_client = KeyClient(hsm_url, credential)
    key = key_client.get_key(key_name)

    crypto_client = CryptographyClient(key, credential)

    import hashlib
    digest = hashlib.sha256(data.encode()).digest()

    result = crypto_client.verify(
        algorithm="RS256",
        digest=digest,
        signature=signature
    )

    return result.is_valid
```

### Key Wrapping

```python
def wrap_key(hsm_url, wrapping_key_name, key_to_wrap, credential):
    """Wrap a key using HSM key"""

    key_client = KeyClient(hsm_url, credential)
    wrapping_key = key_client.get_key(wrapping_key_name)

    crypto_client = CryptographyClient(wrapping_key, credential)

    result = crypto_client.wrap_key(
        algorithm="RSA-OAEP-256",
        key=key_to_wrap
    )

    return result.encrypted_key

def unwrap_key(hsm_url, wrapping_key_name, wrapped_key, credential):
    """Unwrap a key using HSM key"""

    key_client = KeyClient(hsm_url, credential)
    wrapping_key = key_client.get_key(wrapping_key_name)

    crypto_client = CryptographyClient(wrapping_key, credential)

    result = crypto_client.unwrap_key(
        algorithm="RSA-OAEP-256",
        encrypted_key=wrapped_key
    )

    return result.key
```

## Role-Based Access Control

Managed HSM uses its own RBAC model:

```bash
# Built-in roles:
# - Managed HSM Administrator
# - Managed HSM Crypto Officer
# - Managed HSM Crypto User
# - Managed HSM Crypto Service Encryption
# - Managed HSM Backup
# - Managed HSM Policy Administrator

# Assign role
az keyvault role assignment create \
    --hsm-name my-managed-hsm \
    --role "Managed HSM Crypto User" \
    --assignee "user@contoso.com" \
    --scope /keys

# Assign role for specific key
az keyvault role assignment create \
    --hsm-name my-managed-hsm \
    --role "Managed HSM Crypto User" \
    --assignee "app-service-principal-id" \
    --scope /keys/my-specific-key
```

### Custom Role Definition

```python
# Create custom role with limited permissions
custom_role = {
    "roleName": "Key Encryption Only",
    "description": "Can only use keys for encryption operations",
    "actions": [],
    "notActions": [],
    "dataActions": [
        "Microsoft.KeyVault/managedHsm/keys/read/action",
        "Microsoft.KeyVault/managedHsm/keys/encrypt/action",
        "Microsoft.KeyVault/managedHsm/keys/decrypt/action"
    ],
    "notDataActions": []
}

# Apply via REST API
import requests

response = requests.put(
    f"https://my-managed-hsm.managedhsm.azure.net/providers/Microsoft.Authorization/roleDefinitions/{role_id}",
    headers={"Authorization": f"Bearer {token}"},
    json=custom_role
)
```

## Backup and Recovery

```bash
# Full HSM backup to Azure Blob Storage
az keyvault backup start \
    --hsm-name my-managed-hsm \
    --storage-account-name backupstorage \
    --blob-container-name hsm-backups \
    --storage-container-SAS-token "sv=2020-08-04&ss=b..."

# Restore HSM from backup
az keyvault restore start \
    --hsm-name new-managed-hsm \
    --storage-account-name backupstorage \
    --blob-container-name hsm-backups \
    --storage-container-SAS-token "sv=2020-08-04&ss=b..." \
    --backup-folder mhsm-my-managed-hsm-2021-05-27
```

## Monitoring and Logging

```bash
# Enable diagnostic logging
az monitor diagnostic-settings create \
    --name hsm-diagnostics \
    --resource /subscriptions/.../managedHsms/my-managed-hsm \
    --workspace /subscriptions/.../workspaces/security-workspace \
    --logs '[
        {"category": "AuditEvent", "enabled": true, "retentionPolicy": {"enabled": true, "days": 365}}
    ]'
```

Query audit logs:

```kusto
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.KEYVAULT"
| where ResourceType == "MANAGEDHSMS"
| where OperationName contains "Crypto"
| project
    TimeGenerated,
    OperationName,
    CallerIPAddress,
    ResultType,
    KeyName = tostring(properties_s.id)
| order by TimeGenerated desc
```

## Use Cases

**Regulatory Compliance**
- FIPS 140-2 Level 3 certification required
- Dedicated HSM for data sovereignty
- Full control over key lifecycle

**Financial Services**
- Payment card key management
- Signature operations for transactions
- HSM-backed encryption for PCI compliance

**Healthcare**
- HIPAA-compliant key management
- Patient data encryption keys
- Audit trail for all key operations

## Resources

- [Managed HSM Documentation](https://docs.microsoft.com/en-us/azure/key-vault/managed-hsm/)
- [Security Domain](https://docs.microsoft.com/en-us/azure/key-vault/managed-hsm/security-domain)
- [Best Practices](https://docs.microsoft.com/en-us/azure/key-vault/managed-hsm/best-practices)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
