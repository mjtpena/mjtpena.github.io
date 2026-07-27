---
title: "Structured Output with JSON Mode: Reliable Data Extraction from LLMs"
author: Michael John Peña
draft: false
date: 2025-07-26
tags:
  - Structured Output
  - JSON Mode
  - LLM
  - Data Extraction
  - Python

---

I wrote "Structured Output with JSON Mode: Reliable Data Extraction from LLMs" to share practical, production-minded guidance on this topic.

## Using OpenAI Structured Outputs

The structured output feature ensures responses match your exact schema:

```python
from openai import AzureOpenAI
from pydantic import BaseModel
from typing import Optional
from enum import Enum

class Priority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class ExtractedTicket(BaseModel):
    title: str
    description: str
    priority: Priority
    category: str
    affected_system: Optional[str]
    estimated_hours: Optional[float]
    tags: list[str]

client = AzureOpenAI(...)

async def extract_ticket_info(email_content: str) -> ExtractedTicket:
    response = await client.beta.chat.completions.parse(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": """Extract support ticket information from customer emails.
                Infer priority from urgency language.
                Categories: billing, technical, feature-request, general"""
            },
            {
                "role": "user",
                "content": email_content
            }
        ],
        response_format=ExtractedTicket
    )

    return response.choices[0].message.parsed

# Usage
email = """
Subject: URGENT - Production server down!

Our main application server crashed this morning and we can't
process any orders. This is affecting our entire business.
The error logs mention database connection timeouts.

Please help immediately!
"""

ticket = await extract_ticket_info(email)
# Returns: ExtractedTicket(
#     title="Production server down",
#     priority=Priority.CRITICAL,
#     category="technical",
#     affected_system="application server",
#     ...
# )
```

## Handling Complex Nested Structures

Define complex schemas with nested objects:

```python
class LineItem(BaseModel):
    description: str
    quantity: int
    unit_price: float
    total: float

class Invoice(BaseModel):
    invoice_number: str
    vendor_name: str
    issue_date: str
    due_date: str
    line_items: list[LineItem]
    subtotal: float
    tax_rate: float
    tax_amount: float
    total_amount: float
    payment_terms: Optional[str]

async def extract_invoice(document_text: str) -> Invoice:
    return await client.beta.chat.completions.parse(
        model="gpt-4o",
        messages=[{"role": "user", "content": f"Extract invoice data:\n\n{document_text}"}],
        response_format=Invoice
    ).choices[0].message.parsed
```

## Validation and Error Handling

Structured outputs eliminate parsing errors. Add business validation for semantic correctness - the schema ensures format, you ensure meaning.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
