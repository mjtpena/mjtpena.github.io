---
title: "AI-Powered Code Review: Integrating LLMs into Development Workflows"
description: "While linters catch syntax issues, AI reviewers understand context, identify logical errors, suggest architectural improvements, and explain complex code…"
author: Michael John Peña
draft: false
date: 2025-11-28
tags:
  - Code Review
  - DevOps
  - GitHub
  - LLM
  - Automation
---

## Beyond Linting

While linters catch syntax issues, AI reviewers understand context, identify logical errors, suggest architectural improvements, and explain complex code changes to reviewers.

## GitHub Action Integration

Create an automated review workflow:

```yaml
# .github/workflows/ai-review.yml
name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  ai-review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Get changed files
        id: changed
        uses: tj-actions/changed-files@v40
        with:
          files: |
            **/*.py
            **/*.ts
            **/*.js

      - name: Run AI Review
        uses: actions/github-script@v7
        env:
          AZURE_OPENAI_ENDPOINT: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
          AZURE_OPENAI_KEY: ${{ secrets.AZURE_OPENAI_KEY }}
        with:
          script: |
            const { execSync } = require('child_process');

            const changedFiles = '${{ steps.changed.outputs.all_changed_files }}'.split(' ');

            for (const file of changedFiles) {
              if (!file) continue;

              // Get diff for this file
              const diff = execSync(`git diff origin/main...HEAD -- ${file}`).toString();

              // Call AI review
              const review = await reviewCode(file, diff);

              if (review.suggestions.length > 0) {
                await github.rest.pulls.createReview({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  pull_number: context.issue.number,
                  event: 'COMMENT',
                  comments: review.suggestions.map(s => ({
                    path: file,
                    line: s.line,
                    body: s.comment
                  }))
                });
              }
            }
```

## Review Engine Implementation

```python
from openai import AzureOpenAI
from dataclasses import dataclass
import re

@dataclass
class ReviewSuggestion:
    line: int
    severity: str  # "critical", "warning", "suggestion"
    category: str
    comment: str

class AICodeReviewer:
    def __init__(self, openai_client: AzureOpenAI):
        self.client = openai_client
        self.review_prompt = """
You are an expert code reviewer. Analyze the following code diff and provide specific, actionable feedback.

Focus on:
1. Bugs and logical errors
2. Security vulnerabilities
3. Performance issues
4. Code clarity and maintainability
5. Best practices violations

For each issue found, provide:
- Line number (from the diff)
- Severity (critical/warning/suggestion)
- Category (bug/security/performance/style)
- Clear explanation and suggested fix

Diff:
{diff}

Respond in JSON format:
{{
  "summary": "Brief overall assessment",
  "suggestions": [
    {{"line": 10, "severity": "warning", "category": "performance", "comment": "..."}}
  ]
}}
"""

    async def review_diff(self, file_path: str, diff: str) -> list[ReviewSuggestion]:
        """Review code diff and return suggestions."""

        response = await self.client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are an expert code reviewer."},
                {"role": "user", "content": self.review_prompt.format(diff=diff)}
            ],
            response_format={"type": "json_object"}
        )

        result = json.loads(response.choices[0].message.content)

        suggestions = []
        for s in result.get("suggestions", []):
            suggestions.append(ReviewSuggestion(
                line=s["line"],
                severity=s["severity"],
                category=s["category"],
                comment=self._format_comment(s, file_path)
            ))

        return suggestions

    def _format_comment(self, suggestion: dict, file_path: str) -> str:
        """Format suggestion as GitHub comment."""

        emoji = {
            "critical": "🚨",
            "warning": "⚠️",
            "suggestion": "💡"
        }

        return f"""
{emoji.get(suggestion['severity'], '📝')} **{suggestion['category'].title()}** ({suggestion['severity']})

{suggestion['comment']}
```
