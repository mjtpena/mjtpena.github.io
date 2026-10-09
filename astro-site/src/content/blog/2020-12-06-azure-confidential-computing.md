---
title: "Azure Confidential Computing: Encrypt Data in Use"
description: "\"It can't be processed if it can't be decrypted, but you can't process encrypted data.\" That truism quietly stopped being true. Confidential Computing uses…"
author: Michael John Peña
draft: false
date: 2020-12-06
tags:
  - Azure
  - Security
  - Confidential Computing
  - TEE
---

"It can't be processed if it can't be decrypted, but you can't process encrypted data." That truism quietly stopped being true. Confidential Computing uses hardware Trusted Execution Environments (Intel SGX, and now AMD SEV-SNP on DCasv5) to keep data encrypted *in memory* while you compute on it. The use cases I keep meeting are multi-party analytics—two banks wanting to detect fraud across their pooled data without either side seeing the other's records. That used to be a thought experiment; now it's a deployment.

## Why Confidential Computing?

Traditional encryption:
- **At rest**: Storage encryption ✓
- **In transit**: TLS encryption ✓
- **In use**: Unencrypted ✗

Confidential computing closes this gap.

## Confidential VM Options

| VM Series | TEE Technology |
|-----------|----------------|
| DCsv2 | Intel SGX |
| DCsv3/DCdsv3 | Intel SGX |
| DCasv5/DCadsv5 | AMD SEV-SNP |
| ECasv5/ECadsv5 | AMD SEV-SNP |

## Creating a Confidential VM

```bash
# Intel SGX VM
az vm create \
    --resource-group myRG \
    --name my-confidential-vm \
    --image Canonical:0001-com-ubuntu-confidential-vm-focal:20_04-lts-cvm:latest \
    --size Standard_DC4s_v3 \
    --admin-username azureuser \
    --generate-ssh-keys \
    --security-type ConfidentialVM \
    --os-disk-security-encryption-type VMGuestStateOnly
```

## Intel SGX Enclaves

```c
// Enclave code (runs in protected memory)
#include "Enclave_t.h"

void ecall_process_sensitive_data(
    const char* encrypted_data,
    size_t data_len,
    char* result)
{
    // Data is decrypted only inside enclave
    char* decrypted = decrypt_in_enclave(encrypted_data, data_len);

    // Process sensitive data
    process_data(decrypted);

    // Encrypt result before returning
    encrypt_result(result);
}
```

```c
// Host application
#include "Enclave_u.h"
#include <sgx_urts.h>

int main() {
    sgx_enclave_id_t enclave_id;

    // Create enclave
    sgx_create_enclave("Enclave.signed.so", 0, NULL, NULL, &enclave_id, NULL);

    // Call enclave function
    ecall_process_sensitive_data(enclave_id, encrypted_input, input_len, result);

    // Enclave processed data without exposing it to host OS
    return 0;
}
```

## Open Enclave SDK

```c
#include <openenclave/enclave.h>

OE_ECALL void process_data(uint8_t* input, size_t size, uint8_t* output)
{
    // Run inside TEE
    // Even cloud provider cannot see this data
    for (size_t i = 0; i < size; i++) {
        output[i] = transform(input[i]);
    }
}
```

## Confidential Containers

```yaml
# AKS with confidential containers
apiVersion: apps/v1
kind: Deployment
metadata:
  name: confidential-app
spec:
  template:
    spec:
      runtimeClassName: kata-cc  # Confidential containers runtime
      containers:
      - name: app
        image: myacr.azurecr.io/confidential-app:latest
        resources:
          limits:
            kubernetes.azure.com/sgx_epc_mem: "128Mi"
```

## Attestation

Verify enclave integrity before sharing secrets:

```python
from azure.security.attestation import AttestationClient

client = AttestationClient(endpoint="https://myattestation.eus.attest.azure.net")

# Get attestation token
token = client.attest_sgx_enclave(
    quote=enclave_quote,
    runtime_data=runtime_data
)

# Verify claims
claims = token.get_body()
if claims["x-ms-sgx-is-debuggable"] == False:
    # Safe to share secrets with enclave
    share_secret(enclave)
```

## Use Cases

| Use Case | Benefit |
|----------|---------|
| Healthcare | Process patient data securely |
| Finance | Multi-party computation |
| ML Training | Train on sensitive data |
| Key Management | Protect cryptographic keys |

## Always Encrypted with Enclaves

```sql
-- SQL Server with secure enclaves
CREATE COLUMN MASTER KEY CMK1
WITH (
    KEY_STORE_PROVIDER_NAME = 'AZURE_KEY_VAULT',
    KEY_PATH = 'https://vault.vault.azure.net/keys/CMK1/...'
);

CREATE COLUMN ENCRYPTION KEY CEK1
WITH VALUES (
    COLUMN_MASTER_KEY = CMK1,
    ALGORITHM = 'RSA_OAEP',
    ENCRYPTED_VALUE = 0x...
);

-- Queries on encrypted data run in enclave
SELECT * FROM Patients
WHERE SSN = @ssn  -- Rich queries on encrypted columns
```

Confidential computing: trust no one, protect everything.
