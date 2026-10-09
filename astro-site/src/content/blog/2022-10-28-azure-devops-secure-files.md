---
title: "Secure Files in Azure DevOps"
description: "Secure Files protect sensitive credentials while enabling automated pipelines."
author: "Michael John Peña"
draft: false
date: 2022-10-28
tags: ["Azure", "Azure DevOps", "Security", "Files"]
---

## Using Secure Files

```yaml
# Download and use secure files
trigger: [main]

pool:
  vmImage: 'macos-latest'

steps:
  - task: DownloadSecureFile@1
    name: signingCert
    inputs:
      secureFile: 'ios-signing.p12'

  - task: DownloadSecureFile@1
    name: provisionProfile
    inputs:
      secureFile: 'app-store.mobileprovision'

  - script: |
      # Install certificate
      security import $(signingCert.secureFilePath) -P $(CertPassword) -A

      # Copy provisioning profile
      mkdir -p ~/Library/MobileDevice/Provisioning\ Profiles
      cp $(provisionProfile.secureFilePath) ~/Library/MobileDevice/Provisioning\ Profiles/
    displayName: 'Install signing credentials'

  - task: Xcode@5
    inputs:
      actions: 'build'
      scheme: 'MyApp'
      signingOption: 'manual'
```

## Common Use Cases

```yaml
# SSH keys
- task: InstallSSHKey@0
  inputs:
    knownHostsEntry: 'github.com ssh-rsa AAAA...'
    sshKeySecureFile: 'github-deploy-key'

# Kubernetes config
- task: DownloadSecureFile@1
  name: kubeconfig
  inputs:
    secureFile: 'production-kubeconfig'

- script: |
    export KUBECONFIG=$(kubeconfig.secureFilePath)
    kubectl get pods
```

Secure Files protect sensitive credentials while enabling automated pipelines.
