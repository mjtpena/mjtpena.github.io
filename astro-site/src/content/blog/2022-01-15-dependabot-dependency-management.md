---
title: "Dependabot: Automated Dependency Updates and Security"
author: Michael John Peña
draft: false
date: 2022-01-15
url: /blog/dependabot-dependency-management/
tags:
  - github
  - security
  - dependencies
  - automation

---

I wrote "Dependabot: Automated Dependency Updates and Security" to share practical, production-minded guidance on this topic.

## Configuring Dependabot

Create a configuration file in your repository:

```yaml
# .github/dependabot.yml
version: 2
updates:
  # .NET dependencies
  - package-ecosystem: "nuget"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
      timezone: "Australia/Sydney"
    open-pull-requests-limit: 10
    reviewers:
      - "security-team"
    labels:
      - "dependencies"
      - "automated"
    commit-message:
      prefix: "nuget"
    ignore:
      - dependency-name: "Newtonsoft.Json"
        versions: ["13.x"]  # Stay on 12.x for compatibility

  # npm dependencies
  - package-ecosystem: "npm"
    directory: "/frontend"
    schedule:
      interval: "daily"
    groups:
      development-dependencies:
        patterns:
          - "@types/*"
          - "eslint*"
          - "prettier"
        update-types:
          - "minor"
          - "patch"

  # Docker base images
  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
    reviewers:
      - "platform-team"

  # GitHub Actions
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

## Security Updates

Enable security updates for immediate patching:

```yaml
# Repository settings -> Security & analysis -> Dependabot security updates
# Or via API:

name: Enable Dependabot Security
on:
  workflow_dispatch:

jobs:
  enable:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v6
        with:
          script: |
            await github.rest.repos.update({
              owner: context.repo.owner,
              repo: context.repo.repo,
              security_and_analysis: {
                dependabot_security_updates: { status: 'enabled' }
              }
            });
```

## Auto-Merge Safe Updates

Automatically merge patch updates that pass tests:

```yaml
# .github/workflows/dependabot-auto-merge.yml
name: Dependabot Auto-Merge

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: write
  pull-requests: write

jobs:
  auto-merge:
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]'

    steps:
      - name: Dependabot metadata
        id: metadata
        uses: dependabot/fetch-metadata@v1
        with:
          github-token: "${{ secrets.GITHUB_TOKEN }}"

      - name: Auto-merge patch updates
        if: steps.metadata.outputs.update-type == 'version-update:semver-patch'
        run: gh pr merge --auto --merge "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Auto-merge minor dev dependencies
        if: |
          steps.metadata.outputs.update-type == 'version-update:semver-minor' &&
          steps.metadata.outputs.dependency-type == 'direct:development'
        run: gh pr merge --auto --merge "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Grouping Updates

Group related updates into single PRs:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      aws-sdk:
        patterns:
          - "@aws-sdk/*"
      azure:
        patterns:
          - "@azure/*"
      testing:
        patterns:
          - "jest*"
          - "@testing-library/*"
        update-types:
          - "minor"
          - "patch"
```

## Monitoring Dependabot Alerts

```python
import requests
from collections import defaultdict

def analyze_dependabot_alerts(owner, repo, token):
    url = f"https://api.github.com/repos/{owner}/{repo}/dependabot/alerts"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json"
    }

    response = requests.get(url, headers=headers, params={"state": "open"})
    alerts = response.json()

    analysis = {
        "total": len(alerts),
        "by_severity": defaultdict(int),
        "by_ecosystem": defaultdict(int),
        "critical": []
    }

    for alert in alerts:
        severity = alert["security_advisory"]["severity"]
        ecosystem = alert["dependency"]["package"]["ecosystem"]

        analysis["by_severity"][severity] += 1
        analysis["by_ecosystem"][ecosystem] += 1

        if severity == "critical":
            analysis["critical"].append({
                "package": alert["dependency"]["package"]["name"],
                "advisory": alert["security_advisory"]["summary"],
                "cve": alert["security_advisory"].get("cve_id"),
                "patched_versions": alert["security_vulnerability"].get("first_patched_version")
            })

    return analysis

# Generate report
report = analyze_dependabot_alerts("myorg", "myrepo", token)
print(f"Total open alerts: {report['total']}")
print(f"Critical alerts: {len(report['critical'])}")
for critical in report['critical']:
    print(f"  - {critical['package']}: {critical['advisory']}")
```

## Best Practices

1. **Start with security updates** - Enable for immediate protection
2. **Use weekly schedule** - Balance updates with review capacity
3. **Group related packages** - Reduce PR noise
4. **Auto-merge patches** - If tests pass
5. **Review major updates carefully** - Breaking changes require attention

Dependabot is an essential tool for maintaining secure and up-to-date dependencies.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
