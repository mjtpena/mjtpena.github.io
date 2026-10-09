---
title: "Edge Copilot: AI Built Into Your Browser"
description: "Edge Copilot brings AI assistance to every webpage, transforming passive browsing into active learning and productivity."
author: Michael John Pena
draft: false
date: 2023-04-12
tags:
  - Microsoft
  - AI
  - Edge
  - Copilot
  - Browser
---

## Edge Copilot Features

### Page Summarization
```python
class EdgePageSummarizer:
    """Summarize web pages using AI."""

    async def summarize_page(
        self,
        page_content: str,
        summary_type: str = "key_points"
    ) -> str:
        """Summarize current page."""

        types = {
            "key_points": "Extract the 5 most important points",
            "brief": "Provide a 2-3 sentence summary",
            "detailed": "Provide a comprehensive summary",
            "eli5": "Explain like I'm 5 years old"
        }

        prompt = f"""{types.get(summary_type, types['key_points'])}

Content:
{page_content[:10000]}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content
```

### Contextual Q&A
```python
class EdgeContextualQA:
    """Answer questions about the current page."""

    async def answer_about_page(
        self,
        page_content: str,
        question: str
    ) -> str:
        """Answer question using page content."""

        prompt = f"""Answer this question based on the webpage content.

Webpage Content:
{page_content[:8000]}

Question: {question}

If the answer isn't in the content, say so."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content
```

### Compose Assistant
```python
class EdgeComposeAssistant:
    """Help compose text in Edge."""

    async def compose(
        self,
        task: str,
        context: str = None,
        tone: str = "professional",
        length: str = "medium",
        format_type: str = "paragraph"
    ) -> str:
        """Compose text for various purposes."""

        length_words = {"short": 50, "medium": 150, "long": 400}

        prompt = f"""Compose text for this task.

Task: {task}
{f'Context: {context}' if context else ''}
Tone: {tone}
Length: ~{length_words.get(length, 150)} words
Format: {format_type}

Generate appropriate content."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content

    async def rewrite(
        self,
        text: str,
        style: str = "professional"
    ) -> str:
        """Rewrite text in different style."""

        prompt = f"""Rewrite this text in a {style} style.

Original: {text}

Maintain the meaning while adjusting the tone."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content
```

### PDF Analysis
```python
class EdgePDFAnalyzer:
    """Analyze PDFs opened in Edge."""

    async def analyze_pdf(
        self,
        pdf_text: str,
        analysis_type: str = "summary"
    ) -> str:
        """Analyze PDF content."""

        prompts = {
            "summary": "Summarize this document",
            "key_findings": "Extract key findings and conclusions",
            "questions": "Generate 5 questions this document answers",
            "outline": "Create a detailed outline of this document"
        }

        prompt = f"""{prompts.get(analysis_type, prompts['summary'])}

Document:
{pdf_text[:15000]}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content

    async def answer_about_pdf(
        self,
        pdf_text: str,
        question: str
    ) -> str:
        """Answer questions about PDF."""

        prompt = f"""Answer this question about the document.

Document:
{pdf_text[:12000]}

Question: {question}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content
```

## Building Browser Extensions with AI

```python
class AIBrowserExtension:
    """Pattern for AI-powered browser extensions."""

    async def get_page_context(self) -> dict:
        """Get context from current page."""
        # In a real extension, this would use browser APIs
        return {
            "url": "current_url",
            "title": "page_title",
            "content": "page_content",
            "selection": "selected_text"
        }

    async def process_selection(
        self,
        selected_text: str,
        action: str
    ) -> str:
        """Process selected text with AI."""

        actions = {
            "explain": f"Explain this: {selected_text}",
            "summarize": f"Summarize: {selected_text}",
            "translate": f"Translate to English: {selected_text}",
            "simplify": f"Simplify: {selected_text}",
            "expand": f"Expand on: {selected_text}"
        }

        prompt = actions.get(action, f"{action}: {selected_text}")

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content

    async def smart_search(
        self,
        query: str,
        current_page_context: str = None
    ) -> dict:
        """Enhanced search with AI understanding."""

        context_prompt = ""
        if current_page_context:
            context_prompt = f"\nContext from current page: {current_page_context[:1000]}"

        prompt = f"""Help find information for this search.

Query: {query}
{context_prompt}

Provide:
1. Refined search terms
2. What to look for
3. Suggested sources"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        return {"guidance": response.content}
```

Edge Copilot brings AI assistance to every webpage, transforming passive browsing into active learning and productivity.
