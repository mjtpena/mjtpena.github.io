---
title: Azure Confidential Computing - Protecting Data in Use
author: Michael John Peña
draft: false
date: 2021-04-25
url: /blog/azure-confidential-computing-secure-enclaves/
tags:
  - Azure
  - Confidential Computing
  - Security
  - TEE
  - Data Protection
---

Confidential Computing addresses the attack surface that most cloud encryption doesn't touch: data while it's actively being processed in memory. Encryption at rest protects storage; encryption in transit protects network; Trusted Execution Environments protect the compute itself—the application and its data are isolated inside a hardware-enforced enclave that the hypervisor, the host OS, and even Azure operators cannot inspect. The practical use cases I've been asked about: processing health records on cloud infrastructure that a hospital's legal team won't approve for conventional cloud, multi-party analytics where each party's data must stay encrypted even from the other parties, and financial fraud models where training data is subject to data sovereignty constraints.

## Understanding Confidential Computing

### The Three States of Data

```
Data at Rest     → Encryption (Storage encryption, BitLocker)
Data in Transit  → Encryption (TLS, VPN)
Data in Use      → Confidential Computing (TEE, Secure Enclaves)
```

### How TEEs Work

```
┌─────────────────────────────────────────┐
│            Host Environment              │
│  ┌─────────────────────────────────────┐ │
│  │    Trusted Execution Environment    │ │
│  │  ┌───────────────────────────────┐  │ │
│  │  │    Encrypted Memory Region    │  │ │
│  │  │    • Code                     │  │ │
│  │  │    • Data                     │  │ │
│  │  │    • Processor State          │  │ │
│  │  └───────────────────────────────┘  │ │
│  │                                      │ │
│  │  Hardware-enforced isolation:       │ │
│  │  • Host OS cannot access           │ │
│  │  • Hypervisor cannot access        │ │
│  │  • Physical access protected       │ │
│  └─────────────────────────────────────┘ │
│                                          │
│  Untrusted components can interact      │
│  only through defined interfaces        │
└─────────────────────────────────────────┘
```

## Azure Confidential Computing Options

### 1. Confidential VMs (AMD SEV-SNP)

```bash
# Create a confidential VM
az vm create \
    --resource-group confidential-rg \
    --name confidential-vm \
    --image "Canonical:UbuntuServer:18_04-lts-cvm:latest" \
    --size Standard_DC4s_v3 \
    --security-type ConfidentialVM \
    --os-disk-security-encryption-type VMGuestStateOnly \
    --enable-vtpm true \
    --enable-secure-boot true \
    --admin-username azureuser \
    --ssh-key-value ~/.ssh/id_rsa.pub
```

### 2. DCsv2/DCsv3 Series (Intel SGX)

```bash
# Create Intel SGX-enabled VM
az vm create \
    --resource-group confidential-rg \
    --name sgx-vm \
    --image "Canonical:UbuntuServer:18_04-lts-gen2:latest" \
    --size Standard_DC4s_v2 \
    --admin-username azureuser \
    --ssh-key-value ~/.ssh/id_rsa.pub

# Install SGX driver and SDK
# On the VM:
curl -fsSL https://download.01.org/intel-sgx/sgx-linux/2.15/distro/ubuntu18.04-server/sgx_linux_x64_driver_2.11.0_2d2b795.bin -o sgx_driver.bin
chmod +x sgx_driver.bin
sudo ./sgx_driver.bin
```

### 3. Confidential Containers (AKS)

```yaml
# confidential-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: confidential-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: confidential-app
  template:
    metadata:
      labels:
        app: confidential-app
    spec:
      runtimeClassName: kata-cc-isolation
      containers:
      - name: confidential-container
        image: mcr.microsoft.com/aci/sgx-sample:1.0
        resources:
          limits:
            kubernetes.io/sgx_epc_mem_in_MiB: "64"
        ports:
        - containerPort: 8080
```

## Building SGX Applications

### Open Enclave SDK Setup

```bash
# Install Open Enclave SDK on Ubuntu
echo 'deb [arch=amd64] https://download.01.org/intel-sgx/sgx_repo/ubuntu focal main' | sudo tee /etc/apt/sources.list.d/intel-sgx.list
wget -qO - https://download.01.org/intel-sgx/sgx_repo/ubuntu/intel-sgx-deb.key | sudo apt-key add -

sudo apt update
sudo apt install -y open-enclave

# Set environment variables
source /opt/openenclave/share/openenclave/openenclaverc
```

### Simple Enclave Application

```c
// enclave/enclave.c
#include "enclave_t.h"
#include <string.h>

// This function runs inside the secure enclave
void enclave_process_secret(const char* input, char* output, size_t output_size) {
    // Process sensitive data inside enclave
    // Data is encrypted in memory, protected from host OS

    // Example: Simple encryption (in practice, use proper crypto)
    size_t input_len = strlen(input);
    for (size_t i = 0; i < input_len && i < output_size - 1; i++) {
        output[i] = input[i] ^ 0x42;  // XOR encryption
    }
    output[input_len] = '\0';
}

// Seal data for persistent storage
int enclave_seal_data(
    const uint8_t* plaintext,
    size_t plaintext_size,
    uint8_t* sealed_data,
    size_t* sealed_size
) {
    // Use SGX sealing to encrypt data with enclave-specific key
    // Only this enclave can unseal the data later
    oe_result_t result = oe_seal(
        NULL, 0,  // Additional authenticated data
        OE_SEAL_POLICY_UNIQUE,  // Seal to this specific enclave
        plaintext, plaintext_size,
        NULL, 0,  // Optional context
        sealed_data, sealed_size
    );

    return result == OE_OK ? 0 : -1;
}
```

### Host Application

```c
// host/host.c
#include <openenclave/host.h>
#include "enclave_u.h"
#include <stdio.h>

int main(int argc, char* argv[]) {
    oe_enclave_t* enclave = NULL;
    oe_result_t result;

    // Create enclave
    result = oe_create_enclave_enclave(
        "enclave.signed",
        OE_ENCLAVE_TYPE_SGX,
        OE_ENCLAVE_FLAG_DEBUG,
        NULL, 0,
        &enclave
    );

    if (result != OE_OK) {
        fprintf(stderr, "Failed to create enclave: %s\n", oe_result_str(result));
        return 1;
    }

    // Call enclave function
    char output[256];
    result = enclave_process_secret(enclave, "secret data", output, sizeof(output));

    if (result == OE_OK) {
        printf("Processed result: %s\n", output);
    }

    // Terminate enclave
    oe_terminate_enclave(enclave);

    return 0;
}
```

### EDL File (Enclave Definition Language)

```edl
// enclave.edl
enclave {
    trusted {
        // Functions that run inside the enclave
        public void enclave_process_secret(
            [in, string] const char* input,
            [out, size=output_size] char* output,
            size_t output_size
        );

        public int enclave_seal_data(
            [in, size=plaintext_size] const uint8_t* plaintext,
            size_t plaintext_size,
            [out, size=sealed_size] uint8_t* sealed_data,
            [in, out] size_t* sealed_size
        );
    };

    untrusted {
        // Functions that call into untrusted host
        void host_log_message([in, string] const char* message);
    };
};
```

## Attestation

### Remote Attestation Flow

```
1. Client requests attestation report from enclave
2. Enclave generates quote (signed by Intel)
3. Quote sent to Azure Attestation Service
4. Azure verifies quote and returns JWT token
5. Client verifies JWT and trusts enclave
```

### Using Azure Attestation

```python
from azure.security.attestation import AttestationClient
from azure.identity import DefaultAzureCredential

# Create attestation client
endpoint = "https://myattestation.eus.attest.azure.net"
credential = DefaultAzureCredential()
client = AttestationClient(endpoint, credential)

# Attest SGX enclave
import base64

# Quote from enclave
sgx_quote = get_sgx_quote_from_enclave()

# Request attestation
response = client.attest_sgx_enclave(
    quote=base64.b64encode(sgx_quote).decode()
)

# Verify token
token = response.token
print(f"Attestation Token: {token}")

# Parse claims
import jwt
claims = jwt.decode(token, options={"verify_signature": False})
print(f"Enclave MRENCLAVE: {claims.get('x-ms-sgx-mrenclave')}")
print(f"Product ID: {claims.get('x-ms-sgx-product-id')}")
```

## Confidential Computing Use Cases

### 1. Multi-Party Computation

```python
# Scenario: Multiple parties compute on combined data
# without revealing their individual datasets

# Party A's encrypted data in enclave
party_a_data = load_encrypted_data("party_a.enc")

# Party B's encrypted data in enclave
party_b_data = load_encrypted_data("party_b.enc")

# Computation happens inside TEE
# Neither party can see the other's raw data
# Only the result is shared
result = confidential_compute(party_a_data, party_b_data)

# Result is encrypted before leaving enclave
encrypted_result = seal_result(result)
```

### 2. Confidential Machine Learning

```python
# Training on sensitive data
from confidential_ml import SecureTrainer

# Initialize secure training environment
trainer = SecureTrainer(
    enclave_config="config.json",
    attestation_url="https://attest.azure.net"
)

# Data remains encrypted in memory during training
trainer.load_encrypted_data("training_data.enc", key_from_attestation=True)

# Model training happens in TEE
model = trainer.train(
    algorithm="gradient_boosting",
    parameters={"n_estimators": 100}
)

# Export encrypted model
trainer.export_model("model.enc")
```

### 3. Secure Key Management

```python
# Hardware-backed key storage
class ConfidentialKeyVault:
    def __init__(self, enclave):
        self.enclave = enclave

    def generate_key(self, key_id: str) -> bytes:
        """Generate key inside enclave, never exposed in plaintext"""
        return self.enclave.call("generate_key", key_id)

    def encrypt(self, key_id: str, plaintext: bytes) -> bytes:
        """Encrypt data using key stored in enclave"""
        return self.enclave.call("encrypt", key_id, plaintext)

    def decrypt(self, key_id: str, ciphertext: bytes) -> bytes:
        """Decrypt data using key stored in enclave"""
        return self.enclave.call("decrypt", key_id, ciphertext)

    def seal_key(self, key_id: str) -> bytes:
        """Seal key for persistent storage"""
        return self.enclave.call("seal_key", key_id)
```

## SQL Server Always Encrypted with Secure Enclaves

```sql
-- Enable enclave for database
ALTER DATABASE ContosoHR
SET ALLOW_SNAPSHOT_ISOLATION ON;

-- Create column master key with enclave computations
CREATE COLUMN MASTER KEY CMK1
WITH (
    KEY_STORE_PROVIDER_NAME = 'AZURE_KEY_VAULT',
    KEY_PATH = 'https://myvault.vault.azure.net/keys/CMK1',
    ENCLAVE_COMPUTATIONS (SIGNATURE = 0x...)
);

-- Create column encryption key
CREATE COLUMN ENCRYPTION KEY CEK1
WITH VALUES (
    COLUMN_MASTER_KEY = CMK1,
    ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256',
    ENCRYPTED_VALUE = 0x...
);

-- Create table with encrypted columns
CREATE TABLE Employees (
    EmployeeID int IDENTITY(1,1),
    SSN char(11) ENCRYPTED WITH (
        COLUMN_ENCRYPTION_KEY = CEK1,
        ENCRYPTION_TYPE = Randomized,
        ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256'
    ),
    Salary money ENCRYPTED WITH (
        COLUMN_ENCRYPTION_KEY = CEK1,
        ENCRYPTION_TYPE = Randomized,
        ALGORITHM = 'AEAD_AES_256_CBC_HMAC_SHA_256'
    )
);

-- Rich queries on encrypted data (requires enclave)
SELECT * FROM Employees WHERE Salary > 50000;
```

## Best Practices

1. **Minimize TCB (Trusted Computing Base)** - Keep enclave code small and auditable
2. **Validate all inputs** - Don't trust data from outside the enclave
3. **Use attestation** - Always verify enclave identity before sending secrets
4. **Handle side channels** - Be aware of timing and cache attacks
5. **Seal sensitive state** - Persist data securely between runs
6. **Plan for key rotation** - Design for enclave upgrades
7. **Monitor and audit** - Log security-relevant events
8. **Defense in depth** - Confidential computing is one layer, not the only layer

## Conclusion

Azure Confidential Computing extends security guarantees to data in use, enabling new scenarios like multi-party computation and confidential AI. While the technology adds complexity, it provides strong isolation guarantees backed by hardware. As regulatory requirements tighten and data sensitivity increases, confidential computing will become an essential tool in the security arsenal.
