---
title: "Copilot for Pull Requests: AI-Enhanced Code Review"
description: "Commit messages: {chr(10).join(f'- {c}' for c in commits)} response = await self.client.chatcompletion( model=\"gpt-4\", messages=[{\"role\": \"user\", \"content\"…"
author: Michael John Pena
draft: false
date: 2023-04-04
tags:
  - GitHub
  - AI
  - Copilot
  - Code Review
  - DevOps
---

## Auto-Generated PR Descriptions

When you create a PR, Copilot analyzes your changes and generates a comprehensive description:

```python
class PRDescriptionGenerator:
    """Generate PR descriptions from code changes."""

    def __init__(self, client, github_api):
        self.client = client
        self.github = github_api

    async def generate_description(
        self,
        owner: str,
        repo: str,
        base: str,
        head: str
    ) -> dict:
        """Generate PR description from branch comparison."""

        # Get diff
        diff = await self.github.compare(owner, repo, base, head)

        # Get commit messages
        commits = await self.github.get_commits(owner, repo, base, head)
        commit_messages = [c["message"] for c in commits]

        # Analyze changes
        analysis = await self._analyze_changes(diff, commit_messages)

        # Generate description
        description = await self._generate_description(analysis)

        return {
            "title": description["title"],
            "body": description["body"],
            "labels": description.get("suggested_labels", []),
            "reviewers": description.get("suggested_reviewers", [])
        }

    async def _analyze_changes(
        self,
        diff: str,
        commits: list[str]
    ) -> dict:
        """Analyze what changed and why."""

        prompt = f"""Analyze these code changes.

Diff (truncated):
```diff
{diff[:8000]}
```

Commit messages:
{chr(10).join(f'- {c}' for c in commits)}

Determine:
1. Type of change (feature/bugfix/refactor/docs/test)
2. Main components affected
3. Key changes made
4. Potential impact
5. Risk level (low/medium/high)

Return as JSON."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1
        )

        import json
        try:
            return json.loads(response.content)
        except:
            return {"type": "unknown", "changes": diff[:500]}

    async def _generate_description(self, analysis: dict) -> dict:
        """Generate markdown description."""

        prompt = f"""Generate a PR description from this analysis.

Analysis:
{json.dumps(analysis, indent=2)}

Create:
1. Concise title (max 72 chars, format: "type: description")
2. Summary section
3. Changes section with bullet points
4. Testing section
5. Checklist for reviewer

Format as markdown."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        # Extract title (first line) and body
        lines = response.content.split("\n")
        title = lines[0].replace("# ", "").strip()
        body = "\n".join(lines[1:]).strip()

        return {"title": title, "body": body}
```

## AI Code Review

```python
class AICodeReviewer:
    """Automated code review using AI."""

    def __init__(self, client):
        self.client = client
        self.review_categories = [
            "correctness",
            "security",
            "performance",
            "maintainability",
            "testing"
        ]

    async def review_pr(
        self,
        diff: str,
        context_files: dict = None
    ) -> dict:
        """Perform comprehensive code review."""

        reviews = {}
        for category in self.review_categories:
            reviews[category] = await self._review_category(
                diff, category, context_files
            )

        # Aggregate findings
        all_comments = []
        for category, review in reviews.items():
            for finding in review.get("findings", []):
                all_comments.append({
                    "category": category,
                    **finding
                })

        # Sort by severity
        severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        all_comments.sort(key=lambda x: severity_order.get(x.get("severity", "low"), 4))

        return {
            "summary": await self._generate_summary(reviews),
            "comments": all_comments,
            "approve": not any(c["severity"] in ["critical", "high"] for c in all_comments)
        }

    async def _review_category(
        self,
        diff: str,
        category: str,
        context: dict = None
    ) -> dict:
        """Review for specific category."""

        prompts = {
            "correctness": "Check for logic errors, bugs, and incorrect implementations",
            "security": "Check for security vulnerabilities, injection risks, auth issues",
            "performance": "Check for performance issues, N+1 queries, memory leaks",
            "maintainability": "Check for code clarity, naming, documentation",
            "testing": "Check for test coverage, edge cases, test quality"
        }

        prompt = f"""Review this code diff for {category} issues.

Focus: {prompts[category]}

Diff:
```diff
{diff[:10000]}
```

For each issue found, provide:
- file: filename
- line: line number (from diff)
- severity: critical/high/medium/low
- issue: description
- suggestion: how to fix

Return JSON: {{"findings": [...]}}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[
                {"role": "system", "content": f"You are an expert code reviewer focusing on {category}."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1
        )

        import json
        try:
            return json.loads(response.content)
        except:
            return {"findings": []}

    async def _generate_summary(self, reviews: dict) -> str:
        """Generate review summary."""

        total_findings = sum(len(r.get("findings", [])) for r in reviews.values())

        if total_findings == 0:
            return "LGTM! No significant issues found."

        summary_parts = []
        for category, review in reviews.items():
            findings = review.get("findings", [])
            if findings:
                summary_parts.append(f"- **{category.title()}**: {len(findings)} issue(s)")

        return f"Found {total_findings} issue(s):\n" + "\n".join(summary_parts)
```

## Intelligent Reviewer Suggestions

```python
class ReviewerSuggester:
    """Suggest reviewers based on code changes."""

    def __init__(self, github_api, expertise_db):
        self.github = github_api
        self.expertise = expertise_db

    async def suggest_reviewers(
        self,
        diff: str,
        repo: str,
        exclude: list[str] = None
    ) -> list[dict]:
        """Suggest appropriate reviewers."""

        exclude = exclude or []

        # Analyze changed areas
        changed_files = self._extract_changed_files(diff)
        changed_areas = self._categorize_files(changed_files)

        # Get contributors for those files
        file_contributors = await self._get_file_contributors(
            repo, changed_files
        )

        # Match to expertise database
        expertise_matches = self._match_expertise(changed_areas)

        # Combine and rank
        candidates = {}
        for user in set(file_contributors + expertise_matches):
            if user in exclude:
                continue

            score = 0
            reasons = []

            if user in file_contributors:
                score += 3
                reasons.append("Previously contributed to changed files")

            if user in expertise_matches:
                score += 2
                reasons.append(f"Expertise in {', '.join(changed_areas)}")

            candidates[user] = {"score": score, "reasons": reasons}

        # Sort by score
        ranked = sorted(
            candidates.items(),
            key=lambda x: x[1]["score"],
            reverse=True
        )

        return [
            {"user": user, **data}
            for user, data in ranked[:5]
        ]

    def _extract_changed_files(self, diff: str) -> list[str]:
        """Extract file paths from diff."""
        import re
        files = re.findall(r'^\+\+\+ b/(.+)$', diff, re.MULTILINE)
        return files

    def _categorize_files(self, files: list[str]) -> list[str]:
        """Categorize files by area."""
        areas = set()
        for f in files:
            if "/api/" in f:
                areas.add("api")
            if "/models/" in f or "model" in f:
                areas.add("models")
            if "/test" in f:
                areas.add("testing")
            if ".sql" in f or "/db/" in f:
                areas.add("database")
            if ".css" in f or ".tsx" in f or ".jsx" in f:
                areas.add("frontend")
        return list(areas)
```

## Automated PR Labeling

```python
class PRLabeler:
    """Automatically label PRs based on content."""

    async def suggest_labels(
        self,
        diff: str,
        title: str,
        description: str
    ) -> list[str]:
        """Suggest labels for PR."""

        prompt = f"""Suggest labels for this pull request.

Title: {title}
Description: {description[:1000]}

Changes (sample):
```diff
{diff[:3000]}
```

Available labels:
- bug: Bug fixes
- feature: New features
- enhancement: Improvements
- documentation: Doc changes
- refactor: Code refactoring
- test: Test additions/changes
- security: Security fixes
- breaking: Breaking changes
- dependencies: Dependency updates
- size/small: <100 lines
- size/medium: 100-500 lines
- size/large: >500 lines

Return JSON array of applicable labels."""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        import json
        try:
            return json.loads(response.content)
        except:
            return ["needs-review"]
```

## Integration Example

```python
class CopilotPRWorkflow:
    """Complete Copilot-powered PR workflow."""

    def __init__(self, client, github_api):
        self.description_gen = PRDescriptionGenerator(client, github_api)
        self.reviewer = AICodeReviewer(client)
        self.suggester = ReviewerSuggester(github_api, None)
        self.labeler = PRLabeler()

    async def process_new_pr(
        self,
        owner: str,
        repo: str,
        pr_number: int
    ) -> dict:
        """Process a new PR with AI assistance."""

        # Get PR details
        pr = await self.github.get_pr(owner, repo, pr_number)

        # Generate or improve description
        if not pr["body"] or len(pr["body"]) < 50:
            description = await self.description_gen.generate_description(
                owner, repo, pr["base"], pr["head"]
            )
            await self.github.update_pr(owner, repo, pr_number, description)

        # Suggest reviewers
        reviewers = await self.suggester.suggest_reviewers(
            pr["diff"], f"{owner}/{repo}", exclude=[pr["author"]]
        )
        await self.github.request_reviewers(
            owner, repo, pr_number,
            [r["user"] for r in reviewers[:2]]
        )

        # Auto-label
        labels = await self.labeler.suggest_labels(
            pr["diff"], pr["title"], pr["body"]
        )
        await self.github.add_labels(owner, repo, pr_number, labels)

        # Initial review
        review = await self.reviewer.review_pr(pr["diff"])

        # Post review comments
        for comment in review["comments"]:
            await self.github.create_review_comment(
                owner, repo, pr_number, comment
            )

        return {
            "description_generated": True,
            "reviewers_suggested": reviewers,
            "labels_added": labels,
            "review_posted": True,
            "auto_approve": review["approve"]
        }
```

Copilot for Pull Requests streamlines code review while maintaining quality. The combination of auto-generated descriptions, intelligent reviewers, and AI-powered feedback makes the PR process faster and more thorough.
