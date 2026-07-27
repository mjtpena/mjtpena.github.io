---
title: "Documentation with AI: Automating Technical Writing for Data Projects"
author: Michael John Peña
draft: false
date: 2025-01-24
tags:
  - Documentation
  - AI
  - Technical Writing
  - Data Engineering
  - Best Practices

---

I wrote "Documentation with AI: Automating Technical Writing for Data Projects" to share practical, production-minded guidance on this topic.

## Documentation Types for Data Projects

```
Code Documentation
├── Function/Class docstrings
├── Inline comments
└── README files

Technical Documentation
├── Architecture diagrams
├── Data dictionaries
├── API documentation
└── Runbooks

Process Documentation
├── Data lineage
├── Pipeline documentation
├── Change logs
└── Incident reports

User Documentation
├── User guides
├── FAQs
├── Tutorials
└── Glossaries
```

## Automated Docstring Generation

```python
from azure.ai.foundry import AIFoundryClient

class DocstringGenerator:
    def __init__(self, llm_client: AIFoundryClient):
        self.llm = llm_client

    async def generate_docstring(self, code: str, style: str = "google") -> str:
        """Generate docstring for Python code."""

        style_examples = {
            "google": '''
            """Short description.

            Long description if needed.

            Args:
                param1: Description of param1.
                param2: Description of param2.

            Returns:
                Description of return value.

            Raises:
                ExceptionType: When this exception is raised.

            Example:
                >>> function_name(arg1, arg2)
                expected_output
            """
            ''',
            "numpy": '''
            """
            Short description.

            Parameters
            -------\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
