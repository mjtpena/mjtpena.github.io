---
title: "Variable Groups in Azure DevOps"
author: "Michael John Peña"
draft: false
date: 2022-10-27
tags: ["Azure", "Azure DevOps", "Variables", "Configuration"]

---

I wrote "Variable Groups in Azure DevOps" to share practical, production-minded guidance on this topic.

## Using Variable Groups

```yaml
# Pipeline using variable groups
trigger: [main]

variables:
  - group: 'common-settings'
  - group: 'production-secrets'
  - name: localVar
    value: 'local-value'

stages:
  - stage: Build
    jobs:
      - job: BuildJob
        steps:
          - script: |
              echo "API URL: $(ApiUrl)"
              echo "Environment: $(Environment)"
```

## Variable Group Configuration

```yaml
# Variable group structure
variable_groups:
  - name: 'common-settings'
    variables:
      ApiUrl: 'https://api.example.com'
      Environment: 'production'
      LogLevel: 'info'

  - name: 'production-secrets'
    link_to_key_vault: true
    key_vault: 'production-keyvault'
    secrets:
      - DatabasePassword
      - ApiKey
      - CertificateThumbprint
```

## Key Vault Integration

```yaml
# Link variable group to Azure Key Vault
# Project Settings > Pipelines > Library > Variable Groups

variable_group:
  name: 'keyvault-secrets'
  type: 'AzureKeyVault'
  azureSubscription: 'AzureConnection'
  keyVaultName: 'my-keyvault'
  secretsFilter: '*'  # Or specific: 'DbPassword,ApiKey'
```

Variable groups simplify configuration management across multiple pipelines.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
