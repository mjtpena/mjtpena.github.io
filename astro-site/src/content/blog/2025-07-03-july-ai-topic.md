---
title: "Claude 3.5 Sonnet for Code Review: Automated PR Analysis Patterns"
description: "Claude 3.5 Sonnet has become my go-to model for automated code review workflows. Its exceptional ability to understand context across large codebases makes…"
author: Michael John Peña
draft: false
date: 2025-07-03
tags:
  - Claude
  - Anthropic
  - Code Review
  - DevOps
  - Python
---

Claude 3.5 Sonnet has become my go-to model for automated code review workflows. Its exceptional ability to understand context across large codebases makes it ideal for catching subtle bugs and suggesting improvements. Here's how I've integrated it into my CI/CD pipeline.

## Building the Review Agent

The key is providing sufficient context while staying within token limits. I use a chunking strategy that prioritizes changed files and their immediate dependencies:

```python
import anthropic
from github import Github
import difflib

class ClaudeCodeReviewer:
    def __init__(self, anthropic_key: str, github_token: str):
        self.claude = anthropic.Anthropic(api_key=anthropic_key)
        self.github = Github(github_token)

    async def review_pr(self, repo_name: str, pr_number: int) -> dict:
        repo = self.github.get_repo(repo_name)
        pr = repo.get_pull(pr_number)

        # Gather context
        diff_context = self._build_diff_context(pr)

        review = await self.claude.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system="""You are an expert code reviewer. Analyze the PR diff and provide:
            1. Security vulnerabilities (critical)
            2. Performance concerns (high)
            3. Code quality issues (medium)
            4. Style suggestions (low)
            Format as structured JSON.""",
            messages=[{
                "role": "user",
                "content": f"Review this PR:\n\n{diff_context}"
            }]
        )

        return self._parse_review(review.content[0].text)

    def _build_diff_context(self, pr) -> str:
        files = pr.get_files()
        context_parts = []
        for file in files:
            if file.patch and len(file.patch) < 10000:
                context_parts.append(f"## {file.filename}\n```diff\n{file.patch}\n```")
        return "\n\n".join(context_parts)
```

## Handling Large PRs

For PRs exceeding context limits, I implement a two-pass review: first analyzing each file independently, then synthesizing findings with Claude's extended thinking capability. This maintains accuracy while handling enterprise-scale changes.

## Integration with GitHub Actions

The reviewer runs on every PR, posting inline comments for critical issues and a summary review. Non-blocking suggestions go into a separate discussion thread, keeping the PR review focused on what matters most.
