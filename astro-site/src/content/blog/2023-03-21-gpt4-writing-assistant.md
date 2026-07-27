---
title: "Building a GPT-4 Writing Assistant"
author: Michael John Pena
draft: false
date: 2023-03-21
tags:
  - OpenAI
  - AI
  - GPT-4
  - Writing
  - Content

---

I wrote "Building a GPT-4 Writing Assistant" to share practical, production-minded guidance on this topic.

## Writing Assistant Architecture

```python
from enum import Enum
from dataclasses import dataclass
from typing import Optional

class ContentType(Enum):
    BLOG_POST = "blog_post"
    DOCUMENTATION = "documentation"
    EMAIL = "email"
    REPORT = "report"
    PROPOSAL = "proposal"

class Tone(Enum):
    FORMAL = "formal"
    CASUAL = "casual"
    TECHNICAL = "technical"
    PERSUASIVE = "persuasive"

@dataclass
class WritingContext:
    content_type: ContentType
    tone: Tone
    audience: str
    word_count: Optional[int] = None
    key_points: Optional[list[str]] = None
    style_guide: Optional[str] = None

class WritingAssistant:
    """GPT-4 powered writing assistant."""

    def __init__(self, client):
        self.client = client

    async def draft(
        self,
        topic: str,
        context: WritingContext
    ) -> str:
        """Create initial draft."""

        key_points_str = ""
        if context.key_points:
            key_points_str = "\nKey points to cover:\n" + "\n".join(f"- {p}" for p in context.key_points)

        word_limit = f"\nTarget length: ~{context.word_count} words" if context.word_count else ""

        prompt = f"""Write a {context.content_type.value} about: {topic}

Audience: {context.audience}
Tone: {context.tone.value}
{key_points_str}
{word_limit}
{f'Style guide: {context.style_guide}' if context.style_guide else ''}

Create a well-structured, engaging piece."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[
                {"role": "system", "content": f"You are a skilled technical writer creating {context.content_type.value} content."},
                {"role": "user", "content": prompt}
            ]
        )

        return response.content

    async def outline(
        self,
        topic: str,
        context: WritingContext
    ) -> str:
        """Create detailed outline."""

        prompt = f"""Create a detailed outline for a {context.content_type.value} about: {topic}

Audience: {context.audience}
{f'Target length: {context.word_count} words' if context.word_count else ''}

Provide:
1. Proposed title options (3)
2. Introduction hook
3. Main sections with subsections
4. Key points for each section
5. Conclusion approach
6. Suggested examples/code samples"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Editing and Improvement

```python
class ContentEditor:
    """Edit and improve content with GPT-4."""

    def __init__(self, client):
        self.client = client

    async def edit(
        self,
        content: str,
        focus: str = "all"
    ) -> dict:
        """Edit content for improvement."""

        focuses = {
            "all": "grammar, clarity, flow, and style",
            "grammar": "grammar and punctuation only",
            "clarity": "clarity and readability",
            "concise": "making it more concise without losing meaning",
            "engaging": "making it more engaging and compelling"
        }

        focus_instruction = focuses.get(focus, focuses["all"])

        prompt = f"""Edit this content, focusing on {focus_instruction}.

Original:
{content}

Provide:
1. Edited version
2. List of changes made
3. Suggestions for further improvement"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3
        )

        return {"edited": response.content}

    async def suggest_improvements(
        self,
        content: str
    ) -> dict:
        """Suggest improvements without editing."""

        prompt = f"""Review this content and suggest improvements.

Content:
{content}

Provide feedback on:
1. Structure and flow
2. Clarity of main points
3. Engagement level
4. Technical accuracy (if applicable)
5. Missing elements
6. Specific sentences that could be improved

Be constructive and specific."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return {"suggestions": response.content}

    async def adapt_for_audience(
        self,
        content: str,
        original_audience: str,
        target_audience: str
    ) -> str:
        """Adapt content for different audience."""

        prompt = f"""Adapt this content for a different audience.

Original audience: {original_audience}
Target audience: {target_audience}

Original content:
{content}

Rewrite for the target audience, adjusting:
- Technical depth
- Terminology
- Examples
- Tone
- Assumptions"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Technical Documentation

```python
class TechnicalDocWriter:
    """Generate technical documentation."""

    async def document_api_endpoint(
        self,
        endpoint_info: dict
    ) -> str:
        """Document an API endpoint."""

        import json
        endpoint_str = json.dumps(endpoint_info, indent=2)

        prompt = f"""Create technical documentation for this API endpoint.

Endpoint Info:
{endpoint_str}

Include:
1. Endpoint description
2. Authentication requirements
3. Request parameters (path, query, body)
4. Request example
5. Response schema
6. Response examples (success and error)
7. Error codes
8. Usage notes and best practices

Format in Markdown."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def create_tutorial(
        self,
        technology: str,
        goal: str,
        prerequisites: list[str] = None
    ) -> str:
        """Create step-by-step tutorial."""

        prereqs = ""
        if prerequisites:
            prereqs = "\nPrerequisites:\n" + "\n".join(f"- {p}" for p in prerequisites)

        prompt = f"""Create a comprehensive tutorial.

Technology: {technology}
Goal: {goal}
{prereqs}

Structure:
1. Introduction - what we'll build
2. Prerequisites check
3. Step-by-step instructions
4. Code examples for each step
5. Testing/validation at each stage
6. Troubleshooting common issues
7. Next steps

Make it practical and hands-on."""

        response = await self.client.chat_completion(
            model="gpt-4-32k",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def document_architecture(
        self,
        architecture_description: str
    ) -> str:
        """Create architecture documentation."""

        prompt = f"""Create architecture documentation from this description.

Description:
{architecture_description}

Document:
1. Overview and context
2. Architecture diagram (describe in text for later diagram creation)
3. Component breakdown
4. Data flows
5. Integration points
6. Security considerations
7. Scalability notes
8. Operational requirements
9. Decision rationale

Format as professional technical documentation."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Email and Communication

```python
class CommunicationAssistant:
    """Write professional communications."""

    async def draft_email(
        self,
        purpose: str,
        recipient: str,
        key_points: list[str],
        tone: str = "professional"
    ) -> str:
        """Draft professional email."""

        points = "\n".join(f"- {p}" for p in key_points)

        prompt = f"""Draft a professional email.

Purpose: {purpose}
Recipient: {recipient}
Tone: {tone}

Key points to cover:
{points}

Create:
1. Subject line options (3)
2. Email body
3. Appropriate sign-off"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def improve_email(
        self,
        email: str,
        goal: str = "more professional"
    ) -> str:
        """Improve existing email."""

        prompt = f"""Improve this email to make it {goal}.

Original:
{email}

Provide improved version and explain changes."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def summarize_thread(
        self,
        email_thread: str
    ) -> dict:
        """Summarize email thread."""

        prompt = f"""Summarize this email thread.

Thread:
{email_thread}

Provide:
1. Brief summary (2-3 sentences)
2. Key decisions made
3. Action items (who, what, when)
4. Open questions
5. Suggested response (if reply needed)"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return {"summary": response.content}
```

## Content Expansion and Compression

```python
class ContentTransformer:
    """Transform content length and format."""

    async def expand(
        self,
        content: str,
        target_length: int,
        areas_to_expand: list[str] = None
    ) -> str:
        """Expand content to target length."""

        focus = ""
        if areas_to_expand:
            focus = f"\nFocus expansion on: {', '.join(areas_to_expand)}"

        prompt = f"""Expand this content to approximately {target_length} words.

Original ({len(content.split())} words):
{content}
{focus}

Expand by:
- Adding more detail and examples
- Including additional relevant points
- Deepening explanations
- Adding transitions

Maintain the original voice and message."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def compress(
        self,
        content: str,
        target_length: int
    ) -> str:
        """Compress content to target length."""

        prompt = f"""Compress this content to approximately {target_length} words.

Original ({len(content.split())} words):
{content}

Maintain:
- Key messages
- Essential examples
- Logical flow

Remove:
- Redundancy
- Unnecessary details
- Filler words"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def convert_format(
        self,
        content: str,
        source_format: str,
        target_format: str
    ) -> str:
        """Convert between content formats."""

        prompt = f"""Convert this content from {source_format} to {target_format}.

Original ({source_format}):
{content}

Adapt for {target_format} format while preserving key information."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Style Consistency

```python
class StyleEnforcer:
    """Enforce consistent writing style."""

    def __init__(self, client, style_guide: str = None):
        self.client = client
        self.style_guide = style_guide

    async def apply_style(
        self,
        content: str,
        style_rules: list[str] = None
    ) -> str:
        """Apply style guide to content."""

        rules = self.style_guide or ""
        if style_rules:
            rules += "\n" + "\n".join(f"- {r}" for r in style_rules)

        prompt = f"""Apply these style guidelines to the content.

Style Guidelines:
{rules}

Content:
{content}

Return the content updated to match the style guide."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def check_consistency(
        self,
        documents: list[str]
    ) -> dict:
        """Check consistency across documents."""

        docs_str = "\n---\n".join([f"Document {i+1}:\n{d[:2000]}" for i, d in enumerate(documents)])

        prompt = f"""Check these documents for consistency.

{docs_str}

Identify inconsistencies in:
1. Terminology
2. Formatting
3. Tone
4. Technical accuracy
5. Capitalization/naming conventions

List all inconsistencies found with recommendations."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return {"inconsistencies": response.content}
```

GPT-4's writing capabilities go far beyond autocomplete. With proper prompting and structure, it becomes a powerful writing partner for technical content creation.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
