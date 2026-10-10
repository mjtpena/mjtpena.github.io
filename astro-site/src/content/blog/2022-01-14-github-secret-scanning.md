---
title: "GitHub Secret Scanning: What to Do When the Alert Fires"
description: "How GitHub secret scanning works in early 2022, what it misses, and a practical playbook for triaging alerts, custom patterns, and rotating leaked keys."
author: Michael John Peña
draft: false
date: 2022-01-14
url: /blog/github-secret-scanning/
tags:
  - GitHub
  - Security
  - DevOps
  - Key Vault
  - Python
---

Secret scanning tells you a credential is sitting in your Git history. It does not tell you whether anyone used it, and it does nothing to stop the next one being committed. Most teams switch it on, see a handful of alerts, close them as "revoked" after deleting the line from `main`, and move on. That leaves the key valid and still in history. The useful part of secret scanning is the response process you build around it, so that's what this post covers.

If you're still deciding whether to buy GitHub Advanced Security or how to roll it out across an organisation, start with my [GitHub Advanced Security rollout post](/blog/2022-01-11-github-advanced-security/). It covers licensing and the script to enable secret scanning in bulk. Here I'm assuming it's already on.

## What secret scanning actually does in January 2022

There are two different products under one name, and people mix them up all the time.

| | Public repositories | Private and internal repositories |
|---|---|---|
| Cost | Free, always on | Requires GitHub Advanced Security |
| Who gets told | The service provider (partner program) | Repository admins and the people you configure |
| Alerts in the Security tab | No | Yes |
| Custom patterns | No | Yes |
| What gets scanned | New pushes (partner patterns only) | The full history when you enable it, then every push |

On **public repositories**, GitHub runs the [secret scanning partner program](https://docs.github.com/en/code-security/secret-scanning/secret-scanning-partner-program). When a commit contains a string matching a format registered by a partner (Azure, AWS, Slack, Stripe and many others), GitHub sends it to that provider. The provider validates it and decides whether to revoke the credential or contact the owner. You, the repository owner, don't get an alert in GitHub. You find out when Microsoft or AWS emails you, or when your key stops working.

On **private and internal repositories**, secret scanning has been [generally available since April 2021](https://github.blog/changelog/2021-04-01-secret-scanning-for-private-repositories-is-generally-available/) as part of Advanced Security. Matches become alerts in the repository's Security tab, and admins get notified. The provider is *not* told, because your code is private. That's the right default, but it means revocation is entirely your job.

The other thing to be clear on: secret scanning is **detective, not preventive**. It scans after the push. By the time you see the alert, the secret is on GitHub's servers, in every clone pulled since, and possibly in a fork or a CI log. Treat every true positive as compromised.

## The triage playbook

When an alert fires, I want the same four steps every time, in this order.

1. **Revoke or rotate the credential first.** Not "remove it from the file". Rotate it at the source so the leaked value is worthless. Matches in private repositories are never sent to the provider, so even a partner token type (an Azure key, a GitHub personal access token) found there is not auto-revoked. Nobody will rotate it unless you do.
2. **Find every place it was used.** Check the provider's audit logs (Azure Activity Log, CloudTrail, Slack access logs) for activity between the commit time and the rotation.
3. **Fix how the application gets the secret.** If the code needed a literal key in a config file, the next developer will do it again. Move it to Key Vault, a managed identity, or an Actions secret.
4. **Close the alert with an honest resolution.** Only then.

Rewriting Git history is optional and usually last. It's disruptive for everyone with a clone, and it doesn't un-leak anything. I only do it when the secret can't be rotated, which should be almost never.

### Closing alerts with the right resolution

The alert resolutions are `revoked`, `false_positive`, `wont_fix` and `used_in_tests`. They matter because they're your audit trail. "Revoked" should mean someone actually rotated the credential. If your team closes everything as revoked to clear the backlog, the Security tab becomes fiction. `used_in_tests` is for dummy values in fixtures; if a test file holds a *real* key, it's not a test value.

For repeat noise from fixture folders, exclude paths with `paths-ignore` in `.github/secret_scanning.yml`, as described in the [GHAS rollout post](/blog/2022-01-11-github-advanced-security/). Use it sparingly.

## Reporting on alerts with the REST API

The Security tab is fine for one repository. Across many, you need the [secret scanning REST API](https://docs.github.com/en/rest/secret-scanning). The repository endpoints let you list, get and update alerts, and since December 2021 the API also returns locations: the file path, line numbers and commit SHA for each occurrence. That's the piece that makes triage scriptable, because you can route an alert to whoever owns the file or made the commit.

This script lists open alerts for a repository with their locations. It needs a personal access token with the `repo` scope from someone who can view security alerts. It deliberately never prints the `secret` field the API returns; a report that copies leaked keys into a CI log or a spreadsheet is a second leak.

```python
import os
import sys

import requests

API = "https://api.github.com"
HEADERS = {
    "Authorization": f"token {os.environ['GITHUB_TOKEN']}",
    "Accept": "application/vnd.github.v3+json",
}


def get_all(url, params=None):
    """Follow Link-header pagination and return every item."""
    items = []
    params = dict(params or {}, per_page=100)
    while url:
        response = requests.get(url, headers=HEADERS, params=params, timeout=30)
        response.raise_for_status()
        items.extend(response.json())
        url = response.links.get("next", {}).get("url")
        params = None  # the "next" URL already carries the query string
    return items


def open_alerts_report(owner, repo):
    alerts = get_all(
        f"{API}/repos/{owner}/{repo}/secret-scanning/alerts", {"state": "open"}
    )
    for alert in alerts:
        print(f"#{alert['number']}  {alert['secret_type']}  opened {alert['created_at']}")
        locations = get_all(
            f"{API}/repos/{owner}/{repo}/secret-scanning/alerts/{alert['number']}/locations"
        )
        for location in locations:
            details = location["details"]
            print(
                f"    {details['path']}:{details['start_line']}"
                f"  commit {details['commit_sha'][:7]}"
            )
    print(f"{len(alerts)} open alert(s) in {owner}/{repo}")


if __name__ == "__main__":
    open_alerts_report(sys.argv[1], sys.argv[2])
```

Run it as `GITHUB_TOKEN=<your-token> python alerts.py <your-org> <your-repo>`. There's also an [endpoint to list secret scanning alerts for an organisation](https://docs.github.com/en/rest/secret-scanning/secret-scanning#list-secret-scanning-alerts-for-an-organization), still in beta, if you want one call across every repository. Because it's beta, I wouldn't build anything critical on its response shape yet.

I'd resist automating the *close* step. A script can't verify that a key was rotated. Keep closure a human decision and use automation for the reporting and routing.

## Custom patterns for your own credentials

Partner patterns only cover tokens issued by those providers. Your internal API keys, connection strings for in-house services and signing secrets are invisible to secret scanning unless you add custom patterns. GitHub added custom patterns (in beta) for private repositories in June 2021, at repository and organisation level, and enterprise level followed. The feature is still in beta in January 2022, so expect the UI and behaviour to change.

You define them in the UI under **Settings > Security & analysis**: a name, a regular expression for the secret format, and optional before/after expressions to anchor the match. There is no API or config file for them yet.

My rules of thumb for custom patterns:

- **Patterns only work well on secrets with structure.** A key with a fixed prefix such as `myorg_live_` followed by 32 base62 characters is detectable. A random 16-character password is not, and a loose regex will bury you in false positives.
- **Test the regex locally before saving it.** There's no dry run yet, so a bad pattern goes straight to producing alerts across the history of every repository it applies to. Run it against a clone with `git grep -E` or `git log -p | grep -E` first.
- **Put the prefix in at the source.** If your platform team issues internal keys, give them a recognisable prefix. GitHub did exactly this with its [own token formats in 2021](https://github.blog/2021-04-05-behind-githubs-new-authentication-token-formats/) (`ghp_`, `gho_` and friends), and it's the single biggest improvement you can make to detection accuracy.

## Catch it before the push

Since secret scanning only sees what has already been pushed, a local check is still worth having. A simple pre-commit hook catches the obvious cases. It's a fragment of defence, not a replacement: developers can skip hooks with `--no-verify`, and hooks aren't installed by `git clone`.

```bash
#!/usr/bin/env bash
# Save as .git/hooks/pre-commit and make it executable (chmod +x).
set -euo pipefail

patterns=(
  'AKIA[0-9A-Z]{16}'                    # AWS access key ID
  'AccountKey=[A-Za-z0-9+/]{86}=='      # Azure Storage account key in a connection string
  'gh[pousr]_[A-Za-z0-9]{36}'           # GitHub tokens (2021 format)
)

# Only check added lines, so a commit that deletes a leaked key isn't blocked.
staged=$(git diff --cached -U0 | grep '^+' | grep -v '^+++' || true)

for pattern in "${patterns[@]}"; do
  if grep -qE "$pattern" <<< "$staged"; then
    echo "Possible secret matching '$pattern' in staged changes. Commit blocked."
    exit 1
  fi
done
```

For anything beyond a personal repository, I'd use a maintained tool instead of hand-rolled regexes. Gitleaks and Yelp's detect-secrets both run as pre-commit hooks and in CI, and the [pre-commit framework](https://pre-commit.com/) makes installation repeatable across a team.

## Rotating a leaked Azure Storage key

Step one of the playbook is rotation, so it should be rehearsed. Azure Storage account keys are the leak I'd expect most often in Azure shops, because connection strings are so easy to paste into `appsettings.json`. Each account has two keys, which lets you rotate without downtime if your applications read the key from Key Vault.

```bash
#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="<your-resource-group>"
ACCOUNT="<your-storage-account>"
VAULT="<your-key-vault>"

# 1. Point applications at key2 while key1 is regenerated.
KEY2=$(az storage account keys list -g "$RESOURCE_GROUP" -n "$ACCOUNT" \
  --query "[?keyName=='key2'].value" -o tsv)
az keyvault secret set --vault-name "$VAULT" --name storage-account-key \
  --value "$KEY2" --output none

# 2. Regenerate the leaked primary key (key1) so the value on GitHub stops working.
az storage account keys renew -g "$RESOURCE_GROUP" -n "$ACCOUNT" --key primary --output none

echo "primary (key1) regenerated; applications should now be using key2 from Key Vault."
```

This assumes the leaked value was `key1`, which the CLI calls `primary`, and that your applications pick up the new Key Vault value on restart or refresh. Check which key leaked first; regenerating the wrong one breaks production and leaves the leak live. Also remember that any SAS tokens signed with the regenerated key are invalidated too.

The better fix is to not have a key at all. For Azure services that support it, a managed identity with an RBAC role removes the secret entirely, and secret scanning has nothing to find. I covered the Key Vault side of this in [Azure Key Vault: secrets management best practices](/blog/2020-09-13-azure-key-vault-secrets-management/).

## When secret scanning isn't enough

Secret scanning is cheap insurance, but don't mistake it for a secrets strategy.

- **It won't help with unstructured secrets.** Passwords, generic bearer tokens and database credentials in a free-form string mostly slip through.
- **It won't see secrets outside the repository.** Build logs, wiki pages, issue comments, Teams messages and container images are out of scope.
- **On public repositories, you're not in the loop.** If you publish open source and want to know about leaks yourself, you need your own tooling in CI.
- **It can't stop a push.** Pair it with local hooks and a rule that no credential ever lives in source.

## My take

Turn secret scanning on everywhere you're licensed to, but spend your effort on what happens after an alert fires. Write down the rotation steps for your most common credential types before you need them. Give internal keys a prefix and a custom pattern. Never close an alert as revoked until the key is actually dead. If the alert count isn't trending towards zero, the real fix is fewer secrets: managed identities, Key Vault references and OIDC wherever the platform supports them.
