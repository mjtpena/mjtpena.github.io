---
title: "Tuning CodeQL Code Scanning: Query Suites, Custom Queries and SARIF"
description: "How to tune GitHub code scanning in early 2022: choosing CodeQL query suites, scoping paths, writing a custom query, and adding third-party SARIF results."
author: Michael John Peña
draft: false
date: 2022-01-13
url: /blog/github-code-scanning/
tags:
  - GitHub
  - Security
  - GitHub Actions
  - CodeQL
---

Turning on CodeQL is the easy part. The starter workflow takes five minutes, and then the real question arrives: are these the right alerts? Too few queries and code scanning becomes a green tick nobody believes; too many and developers learn that the Security tab is noise. Tuning is what decides which of those you end up with.

Licensing, rollout order and the base workflow are in [the GitHub Advanced Security rollout post](/blog/2022-01-11-github-advanced-security/). What follows assumes code scanning as of January 2022, with CodeQL Action v1.

## Where tuning lives

There are two places to customise CodeQL analysis: inputs on the `github/codeql-action/init` step, and a separate configuration file referenced by that step. Inputs are fine for one-off changes, but I put anything non-trivial in a config file under `.github/codeql/`. It's reviewable on its own, it's reusable across workflows, and it keeps the workflow file about *when* to scan rather than *what* to scan.

Here's the init step pointing at a config file. The rest of the workflow (checkout, build for compiled languages, analyze) is the same as in the rollout post:

```yaml
- name: Initialise CodeQL
  uses: github/codeql-action/init@v1
  with:
    languages: ${{ matrix.language }}
    config-file: ./.github/codeql/codeql-config.yml
```

And a config file that adds the extended security queries, a local query pack, and path scoping:

```yaml
# .github/codeql/codeql-config.yml
name: "Security config"

queries:
  - uses: security-extended
  - uses: ./codeql/custom-queries

paths:
  - src
paths-ignore:
  - 'src/**/*.test.js'
  - src/vendor
```

Quote any glob that contains `*`; GitHub's reference asks for it, and a pattern starting with `*` isn't valid YAML unquoted. The full list of keys is in GitHub's [code scanning configuration reference](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options).

## Choosing a query suite

CodeQL ships three built-in suites per language. Adding a suite with `queries` runs it *in addition to* the default suite; set `disable-default-queries: true` in the config file if you want to replace the defaults entirely.

| Suite | What it adds | When I'd use it |
|---|---|---|
| Default (no setting) | High-precision security queries | Every repository, from day one |
| `security-extended` | Default plus lower-precision and lower-severity security queries | Internet-facing services, once the team is triaging the default results |
| `security-and-quality` | `security-extended` plus maintainability and reliability queries | Rarely; only if the team has agreed to use code scanning as a code-quality tool too |

Two things trip people up here. First, `security-and-quality` already contains `security-extended`, so listing both (which I see often in copied config files) does nothing except make the intent unclear. Second, the quality queries produce alerts with severities like `warning` and `note` that sit in the same Security tab as SQL injection findings. If your team already has a linter that enforces style and maintainability, running the quality suite as well mostly duplicates it in a less convenient place.

My recommendation: default suite everywhere, `security-extended` on anything that handles untrusted input, and skip `security-and-quality` unless you have a specific reason.

## Scoping what gets analysed

`paths` and `paths-ignore` in the config file control which files CodeQL analyses. They work as you'd expect for interpreted languages such as JavaScript/TypeScript and Python, where CodeQL extracts source files directly from disk.

For compiled languages (C/C++, C#, Go and Java), CodeQL learns about the code by observing the build, so what it analyses is mostly whatever you compile. If you want to leave a project out of a C# analysis, the reliable way is to exclude it from the build step in the workflow, for example by building a specific solution or project file rather than the whole repository. Don't assume a `paths-ignore` entry will hide a compiled project.

Be careful about what you exclude. Ignoring test files and vendored third-party code is reasonable; they inflate alert counts with findings you'll never fix in that repository. Ignoring a directory because it "has too many alerts" is how real vulnerabilities go unseen. If a path is excluded, the reason should be written down next to it in the config file's pull request.

## When a custom query is worth it

Writing CodeQL queries is a skill in its own right, and the built-in suites cover the common vulnerability classes better than most teams will by hand. So I don't start with custom queries. Where they earn their place is in rules that are specific to your organisation, the kind no generic scanner can know about:

- An internal helper that's been deprecated because it uses a weak cipher.
- A wrapper around a database client that bypasses parameterisation.
- A framework convention, such as "every controller action must go through our authorisation decorator".

The first case is the simplest pattern: flag every call to a banned function. A local query pack is a directory with a `qlpack.yml` and one or more `.ql` files:

```yaml
# codeql/custom-queries/qlpack.yml
name: my-org/javascript-custom-queries
version: 0.0.1
libraryPathDependencies: codeql/javascript-all
```

```ql
/**
 * @name Use of deprecated legacyEncrypt helper
 * @description legacyEncrypt uses a deprecated cipher. Use the platform crypto wrapper instead.
 * @kind problem
 * @problem.severity error
 * @security-severity 7.5
 * @precision high
 * @id my-org/js/legacy-encrypt
 * @tags security
 *       external/cwe/cwe-327
 */

import javascript

from DataFlow::CallNode call
where call.getCalleeName() = "legacyEncrypt"
select call, "legacyEncrypt uses a deprecated cipher. Use the platform crypto wrapper instead."
```

The metadata block matters as much as the logic. `@kind problem` makes CodeQL report a location and message, `@id` must be unique and stable because alerts are tracked by it, and the `security` tag together with `@security-severity` gives the alert one of the [critical, high, medium or low levels introduced in July 2021](https://github.blog/changelog/2021-07-19-codeql-code-scanning-new-severity-levels-for-security-alerts/). A score of 7.5 maps to high, which means this alert will fail the pull request check under the default threshold. The [CodeQL query metadata reference](https://codeql.github.com/docs/writing-codeql-queries/metadata-for-codeql-queries/) lists every property.

This query matches by name only, so it would also flag an unrelated function that happens to be called `legacyEncrypt`. For a banned-helper rule that trade-off is usually fine. Once you need "data from a request reaches this sink", you're into taint tracking with the `TaintTracking::Configuration` classes, and that is where I'd budget real time, test cases, and someone who has written CodeQL before.

## Bringing other scanners into the same view

Code scanning isn't only CodeQL. Any tool that writes [SARIF](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/integrate-with-existing-tools/upload-sarif-file) can upload results with the `upload-sarif` action, and the alerts appear in the Security tab and on pull requests alongside CodeQL's. This is the strongest argument for code scanning over a set of disconnected tools: developers have one list to triage, in one place.

Here's ESLint (with security-focused rules configured in your `.eslintrc`) reporting into code scanning using Microsoft's SARIF formatter:

```yaml
# .github/workflows/eslint.yml
name: ESLint

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  eslint:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
      actions: read  # required for upload-sarif on private repositories

    steps:
      - name: Checkout repository
        uses: actions/checkout@v2

      - name: Install dependencies
        run: |
          npm ci
          npm install --no-save @microsoft/eslint-formatter-sarif

      - name: Run ESLint
        run: npx eslint . --format @microsoft/eslint-formatter-sarif --output-file eslint-results.sarif
        continue-on-error: true

      - name: Upload results to code scanning
        uses: github/codeql-action/upload-sarif@v1
        with:
          sarif_file: eslint-results.sarif
          category: eslint
```

`continue-on-error` matters because ESLint exits with a non-zero code when it finds problems, which would otherwise stop the job before the upload. The pull request check from code scanning becomes the gate instead. The `category` input keeps these results separate from other analyses of the same commit; since CodeQL Action 1.0.23 in November 2021, you can also upload several SARIF files from one job as long as each has its own category. Keep the action on `@v1` and current rather than pinning an early 1.0.2x release, because the unique-category check in those versions has had bugs.

A word of caution: every tool you add has its own false-positive profile, and they all land in the same list. Add one scanner at a time and tune it before adding the next.

## Triage at scale with the REST API

Once several repositories are scanned, someone will ask for a report. The [code scanning REST API](https://docs.github.com/en/rest/code-scanning/code-scanning) returns alerts per repository, including the rule's `security_severity_level`. This script lists open critical and high alerts, following pagination (the endpoint returns 30 results per page by default, so a script that reads only the first page will undercount):

```python
import os

import requests

GITHUB_API = "https://api.github.com"
OWNER = "<your-org>"
REPO = "<your-repo>"


def list_open_alerts(owner: str, repo: str, token: str) -> list:
    alerts = []
    page = 1
    while True:
        response = requests.get(
            f"{GITHUB_API}/repos/{owner}/{repo}/code-scanning/alerts",
            headers={
                "Authorization": f"token {token}",
                "Accept": "application/vnd.github.v3+json",
            },
            params={"state": "open", "per_page": 100, "page": page},
            timeout=30,
        )
        response.raise_for_status()
        batch = response.json()
        if not batch:
            return alerts
        alerts.extend(batch)
        if len(batch) < 100:
            return alerts
        page += 1


if __name__ == "__main__":
    open_alerts = list_open_alerts(OWNER, REPO, os.environ["GITHUB_TOKEN"])
    urgent = [
        alert
        for alert in open_alerts
        if alert["rule"].get("security_severity_level") in ("critical", "high")
    ]
    print(f"{len(open_alerts)} open alerts, {len(urgent)} critical or high")
    for alert in urgent:
        location = alert["most_recent_instance"]["location"]
        print(f"{alert['rule']['id']}: {location['path']}:{location['start_line']}")
```

Use `.get()` on `security_severity_level`: alerts from non-security queries and from many third-party tools don't have one. The token needs the `security_events` scope (or `repo`) for private repositories.

The other half of tuning is dismissal. An alert can be dismissed as "False positive", "Won't fix" or "Used in tests", and anyone with write access to the repository can do it. That's a lot of people with a quiet off switch, so I'd agree up front what each reason means: "False positive" for a query that's genuinely wrong about this code, "Used in tests" only for test code, and "Won't fix" only with a named owner accepting the risk. The same API returns `dismissed_reason`, `dismissed_by` and `dismissed_at` on each alert (query with `state=dismissed`), which is enough to review dismissals each month and spot one person clearing a whole rule. If the same rule keeps getting dismissed across repositories, stop dismissing it one alert at a time: exclude the path, drop the suite, or fix the custom query.

What I wouldn't do is use this API to build a custom merge gate. The code scanning check on each pull request already fails on the severities you choose in the repository's Security & analysis settings, and that's the check to mark as required in branch protection.

## What to take from this

Every setting above comes down to one decision rule: if an alert class is never fixed, change the config; don't keep dismissing it. A dismissal is a judgement about one piece of code, while a config change is a judgement about a whole rule, made in a pull request where someone can disagree. Keep that line clear and the Security tab stays a list the team believes enough to act on.
