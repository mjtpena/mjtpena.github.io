---
title: "GitHub Secret Scanning: Protecting Your Credentials"
author: Michael John Peña
draft: false
date: 2022-01-14
url: /blog/github-secret-scanning/
tags:
  - github
  - security
  - secrets
  - devsecops

---

I wrote "GitHub Secret Scanning: Protecting Your Credentials" to share practical, production-minded guidance on this topic.

## How Secret Scanning Works

GitHub partners with service providers to detect over 100 types of secrets. When a secret is detected, both you and the provider are notified, allowing for immediate revocation.

## Enabling Secret Scanning

```yaml
# Enable via repository settings or API
name: Enable Secret Scanning
on:
  workflow_dispatch:

jobs:
  enable:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v6
        with:
          github-token: ${{ secrets.ADMIN_TOKEN }}
          script: |
            await github.rest.repos.update({
              owner: context.repo.owner,
              repo: context.repo.repo,
              security_and_analysis: {
                secret_scanning: { status: 'enabled' },
                secret_scanning_push_protection: { status: 'enabled' }
              }
            });
```

## Push Protection

Push protection blocks commits containing secrets before they reach the repository:

```bash
# When you try to push a commit with a secret:
$ git push origin main

remote: error: GH013: Repository rule violations found for refs/heads/main.
remote:
remote: - GITHUB PUSH PROTECTION
remote:   ——————————————————————————————————————————
remote:   Resolve the following violations before pushing again
remote:
remote:   - Push cannot contain secrets
remote:
remote:
remote:     —— Azure Storage Account Access Key ——————————
remote:     locations:
remote:       - commit: abc123
remote:         path: config/settings.json:15
remote:
remote:     To push, remove secret from commit(s) or follow this URL to allow the secret.
remote:     https://github.com/org/repo/security/secret-scanning/unblock-secret/...
```

## Handling Secret Alerts

```python
import requests
from datetime import datetime

class SecretScanningManager:
    def __init__(self, token, owner, repo):
        self.token = token
        self.owner = owner
        self.repo = repo
        self.base_url = f"https://api.github.com/repos/{owner}/{repo}"
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json"
        }

    def get_alerts(self, state="open"):
        url = f"{self.base_url}/secret-scanning/alerts"
        response = requests.get(url, headers=self.headers, params={"state": state})
        return response.json()

    def resolve_alert(self, alert_number, resolution, comment=None):
        """
        Resolutions: false_positive, wont_fix, revoked, used_in_tests
        """
        url = f"{self.base_url}/secret-scanning/alerts/{alert_number}"
        data = {
            "state": "resolved",
            "resolution": resolution
        }
        if comment:
            data["resolution_comment"] = comment

        response = requests.patch(url, headers=self.headers, json=data)
        return response.json()

    def get_alert_locations(self, alert_number):
        url = f"{self.base_url}/secret-scanning/alerts/{alert_number}/locations"
        response = requests.get(url, headers=self.headers)
        return response.json()

    def generate_report(self):
        alerts = self.get_alerts()
        report = {
            "generated_at": datetime.now().isoformat(),
            "total_alerts": len(alerts),
            "by_type": {},
            "details": []
        }

        for alert in alerts:
            secret_type = alert["secret_type"]
            report["by_type"][secret_type] = report["by_type"].get(secret_type, 0) + 1

            locations = self.get_alert_locations(alert["number"])
            report["details"].append({
                "number": alert["number"],
                "type": secret_type,
                "created_at": alert["created_at"],
                "locations": [loc["details"]["path"] for loc in locations]
            })

        return report

# Usage
manager = SecretScanningManager(token, "myorg", "myrepo")
alerts = manager.get_alerts()
for alert in alerts:
    print(f"Alert #{alert['number']}: {alert['secret_type']}")
```

## Custom Secret Patterns

Define organization-wide custom patterns:

```yaml
# Organization-level custom pattern (via UI or API)
name: Internal API Key
pattern: 'MYORG_[A-Za-z0-9]{32}'
description: Internal service API keys
severity: high
```

## Pre-commit Hook for Local Detection

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Common secret patterns
patterns=(
    'AKIA[0-9A-Z]{16}'                          # AWS Access Key
    '[a-zA-Z0-9_-]*:[a-zA-Z0-9_-]*@.*\.blob\.core\.windows\.net'  # Azure Storage
    'ghp_[a-zA-Z0-9]{36}'                       # GitHub PAT
    'sk-[a-zA-Z0-9]{48}'                        # OpenAI API Key
)

for pattern in "${patterns[@]}"; do
    if git diff --cached | grep -qE "$pattern"; then
        echo "ERROR: Potential secret detected matching pattern: $pattern"
        echo "Please remove the secret before committing."
        exit 1
    fi
done

exit 0
```

## Automation for Secret Rotation

```python
import subprocess
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient

def rotate_exposed_secret(secret_name, vault_url):
    """Automatically rotate a secret that was exposed."""

    credential = DefaultAzureCredential()
    client = SecretClient(vault_url=vault_url, credential=credential)

    # Generate new secret
    new_value = subprocess.run(
        ["openssl", "rand", "-base64", "32"],
        capture_output=True, text=True
    ).stdout.strip()

    # Update in Key Vault
    client.set_secret(secret_name, new_value)

    # Log rotation
    print(f"Rotated secret: {secret_name}")

    return new_value
```

Secret scanning is a critical layer in your defense-in-depth security strategy.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
