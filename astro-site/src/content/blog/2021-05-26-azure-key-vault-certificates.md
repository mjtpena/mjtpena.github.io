---
title: "Azure Key Vault Certificates: Complete Lifecycle Management"
author: Michael John Peña
draft: false
date: 2021-05-26
tags:
  - Azure
  - Security
  - Key Vault
  - Certificates
  - PKI
---

## Certificate Storage Concepts

Key Vault stores certificates as:
- **Certificate**: The X.509 certificate (public)
- **Key**: The private key (protected)
- **Secret**: The combined certificate + private key (for download)

## Creating Certificates

### Self-Signed Certificate

```python
from azure.identity import DefaultAzureCredential
from azure.keyvault.certificates import CertificateClient, CertificatePolicy

credential = DefaultAzureCredential()
vault_url = "https://my-keyvault.vault.azure.net"
client = CertificateClient(vault_url, credential)

# Create self-signed certificate
policy = CertificatePolicy(
    issuer_name="Self",
    subject="CN=myapp.contoso.com",
    validity_in_months=12,
    exportable=True,
    key_type="RSA",
    key_size=2048,
    content_type="application/x-pkcs12",  # or "application/x-pem-file"
    san_dns_names=["myapp.contoso.com", "www.myapp.contoso.com"]
)

# Start certificate creation
operation = client.begin_create_certificate(
    certificate_name="myapp-cert",
    policy=policy
)

# Wait for completion
certificate = operation.result()
print(f"Certificate created: {certificate.name}")
print(f"Thumbprint: {certificate.properties.x509_thumbprint.hex()}")
```

### CA-Issued Certificate

```python
# Policy for CA-issued certificate
ca_policy = CertificatePolicy(
    issuer_name="DigiCertCA",  # Pre-configured CA issuer
    subject="CN=api.contoso.com,O=Contoso,C=US",
    validity_in_months=24,
    exportable=True,
    key_type="RSA",
    key_size=4096,
    content_type="application/x-pem-file",
    san_dns_names=["api.contoso.com", "api-staging.contoso.com"],
    key_usage=["digitalSignature", "keyEncipherment"],
    enhanced_key_usage=["1.3.6.1.5.5.7.3.1"]  # Server authentication
)

# Create CSR and submit to CA
operation = client.begin_create_certificate(
    certificate_name="api-cert",
    policy=ca_policy
)

# Check status
print(f"Status: {operation.status()}")

# For manual issuers, get CSR
pending = client.get_certificate_operation("api-cert")
if pending.csr:
    import base64
    csr_pem = f"-----BEGIN CERTIFICATE REQUEST-----\n{base64.b64encode(pending.csr).decode()}\n-----END CERTIFICATE REQUEST-----"
    print(f"CSR:\n{csr_pem}")
```

## Importing Certificates

```python
import base64

def import_pfx_certificate(client, cert_name, pfx_path, password=None):
    """Import certificate from PFX file"""

    with open(pfx_path, 'rb') as f:
        pfx_data = f.read()

    # Import requires base64-encoded content
    certificate = client.import_certificate(
        certificate_name=cert_name,
        certificate_bytes=pfx_data,
        password=password,
        policy=CertificatePolicy(
            exportable=True,
            content_type="application/x-pkcs12"
        )
    )

    return certificate

def import_pem_certificate(client, cert_name, cert_path, key_path):
    """Import certificate from PEM files"""

    with open(cert_path, 'r') as f:
        cert_pem = f.read()

    with open(key_path, 'r') as f:
        key_pem = f.read()

    # Combine into single PEM
    combined_pem = cert_pem + "\n" + key_pem

    certificate = client.import_certificate(
        certificate_name=cert_name,
        certificate_bytes=combined_pem.encode(),
        policy=CertificatePolicy(
            exportable=True,
            content_type="application/x-pem-file"
        )
    )

    return certificate
```

## Retrieving Certificates

```python
from azure.keyvault.secrets import SecretClient
from cryptography import x509
from cryptography.hazmat.primitives import serialization
import base64

def get_certificate_with_key(vault_url, cert_name, credential):
    """Get certificate with private key"""

    # Get certificate (public only)
    cert_client = CertificateClient(vault_url, credential)
    certificate = cert_client.get_certificate(cert_name)

    # Get secret (contains private key)
    secret_client = SecretClient(vault_url, credential)
    secret = secret_client.get_secret(cert_name)

    if certificate.policy.content_type == "application/x-pem-file":
        # PEM format - can use directly
        pem_data = secret.value
        return {
            'certificate': certificate,
            'pem': pem_data
        }
    else:
        # PKCS#12 format - decode
        pfx_data = base64.b64decode(secret.value)
        return {
            'certificate': certificate,
            'pfx': pfx_data
        }

def get_certificate_for_ssl(vault_url, cert_name, credential):
    """Get certificate in format usable for SSL"""

    result = get_certificate_with_key(vault_url, cert_name, credential)

    if 'pem' in result:
        return result['pem'].encode()
    else:
        # Convert PKCS#12 to PEM
        from cryptography.hazmat.primitives.serialization import pkcs12

        private_key, certificate, chain = pkcs12.load_key_and_certificates(
            result['pfx'],
            password=None
        )

        # Export to PEM
        pem_key = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        )

        pem_cert = certificate.public_bytes(serialization.Encoding.PEM)

        return pem_cert + pem_key
```

## Auto-Renewal Configuration

```python
from azure.keyvault.certificates import (
    LifetimeAction,
    CertificatePolicyAction
)

# Create certificate with auto-renewal
auto_renew_policy = CertificatePolicy(
    issuer_name="DigiCertCA",
    subject="CN=api.contoso.com",
    validity_in_months=12,
    lifetime_actions=[
        LifetimeAction(
            action=CertificatePolicyAction.AUTO_RENEW,
            days_before_expiry=30  # Renew 30 days before expiry
        ),
        LifetimeAction(
            action=CertificatePolicyAction.EMAIL_CONTACTS,
            lifetime_percentage=80  # Email when 80% of lifetime passed
        )
    ]
)

# Update existing certificate policy
client.update_certificate_policy(
    certificate_name="api-cert",
    policy=auto_renew_policy
)
```

## Certificate Contacts

```python
from azure.keyvault.certificates import CertificateContact

# Set contacts for certificate notifications
contacts = [
    CertificateContact(email="security@contoso.com", name="Security Team"),
    CertificateContact(email="ops@contoso.com", name="Operations")
]

client.set_contacts(contacts)

# Get current contacts
current_contacts = client.get_contacts()
for contact in current_contacts:
    print(f"Contact: {contact.name} <{contact.email}>")
```

## Using Certificates with Azure Services

### App Service

```bash
# Import Key Vault certificate to App Service
az webapp config ssl import \
    --resource-group my-rg \
    --name my-webapp \
    --key-vault my-keyvault \
    --key-vault-certificate-name my-cert

# Bind certificate to custom domain
az webapp config ssl bind \
    --resource-group my-rg \
    --name my-webapp \
    --certificate-thumbprint <thumbprint> \
    --ssl-type SNI
```

### Azure Functions

```python
# In function, load certificate from Key Vault
import azure.functions as func
from azure.identity import DefaultAzureCredential
from azure.keyvault.certificates import CertificateClient
import ssl
import requests

def main(req: func.HttpRequest) -> func.HttpResponse:
    credential = DefaultAzureCredential()
    cert_client = CertificateClient(
        "https://my-keyvault.vault.azure.net",
        credential
    )

    # Get certificate for client authentication
    cert_pem = get_certificate_for_ssl(
        "https://my-keyvault.vault.azure.net",
        "client-cert",
        credential
    )

    # Write to temp file for requests
    import tempfile
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pem') as f:
        f.write(cert_pem)
        cert_path = f.name

    # Use certificate for mutual TLS
    response = requests.get(
        "https://api.partner.com/secure-endpoint",
        cert=cert_path
    )

    return func.HttpResponse(response.text)
```

### Application Gateway

```bash
# Create SSL certificate from Key Vault
az network application-gateway ssl-cert create \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --name my-ssl-cert \
    --key-vault-secret-id https://my-keyvault.vault.azure.net/secrets/my-cert

# Use in HTTPS listener
az network application-gateway http-listener update \
    --gateway-name my-appgw \
    --resource-group my-rg \
    --name https-listener \
    --ssl-cert my-ssl-cert
```

## Certificate Monitoring

```python
from datetime import datetime, timedelta

def check_expiring_certificates(client, days_threshold=30):
    """Find certificates expiring soon"""

    expiring = []
    threshold_date = datetime.utcnow() + timedelta(days=days_threshold)

    for cert_props in client.list_properties_of_certificates():
        cert = client.get_certificate(cert_props.name)

        if cert.properties.expires_on and cert.properties.expires_on < threshold_date:
            expiring.append({
                'name': cert.name,
                'expires_on': cert.properties.expires_on,
                'thumbprint': cert.properties.x509_thumbprint.hex()
            })

    return expiring

# Check and alert
expiring = check_expiring_certificates(client, days_threshold=30)
for cert in expiring:
    print(f"WARNING: {cert['name']} expires on {cert['expires_on']}")
```

## Resources

- [Key Vault Certificates Documentation](https://docs.microsoft.com/en-us/azure/key-vault/certificates/)
- [Certificate Client Library](https://docs.microsoft.com/en-us/python/api/overview/azure/keyvault-certificates-readme)
- [Certificate Issuers](https://docs.microsoft.com/en-us/azure/key-vault/certificates/about-certificates)
