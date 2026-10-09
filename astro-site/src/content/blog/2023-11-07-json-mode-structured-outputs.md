---
title: "JSON Mode: Reliable Structured Outputs from GPT-4"
description: "JSON mode in GPT-4 Turbo (gpt-4-1106-preview) is a simple addition that solves a real, persistent annoyance in LLM application development: the model…"
author: "Michael John Peña"
draft: false
date: 2023-11-07
tags: ["OpenAI", "JSON", "API", "GPT-4", "Structured Data"]
---

JSON mode in GPT-4 Turbo (`gpt-4-1106-preview`) is a simple addition that solves a real, persistent annoyance in LLM application development: the model sometimes produces JSON with explanatory text around it, or adds trailing commas, or wraps the JSON in markdown code fences, or — most frustratingly — produces perfectly valid JSON for nine out of ten queries and then breaks your parser on the tenth. Setting `response_format: {"type": "json_object"}` instructs the model to return only parseable JSON with no surrounding text, which makes structured output pipelines substantially more reliable. The constraint to note: you still need to describe the expected JSON structure in your prompt — JSON mode doesn't infer the schema, it only guarantees the format is valid JSON. And the `json_object` response format requires that the word "json" appears somewhere in your prompt, or the API returns an error.

## Enabling JSON Mode

```python
from openai import OpenAI
import json

client = OpenAI()

response = client.chat.completions.create(
    model="gpt-4-1106-preview",
    response_format={"type": "json_object"},  # Enable JSON mode
    messages=[
        {
            "role": "system",
            "content": "You are a helpful assistant that outputs JSON."
        },
        {
            "role": "user",
            "content": "Extract the key entities from: 'Apple Inc. announced iPhone 15 in Cupertino on September 12, 2023'"
        }
    ]
)

data = json.loads(response.choices[0].message.content)
print(json.dumps(data, indent=2))
```

Output:
```json
{
  "entities": {
    "organization": "Apple Inc.",
    "product": "iPhone 15",
    "location": "Cupertino",
    "date": "2023-09-12"
  }
}
```

## Enforcing Specific Schemas

While JSON mode guarantees valid JSON, you can guide the structure with detailed prompts:

```python
def extract_with_schema(text: str, schema: dict) -> dict:
    """Extract data according to a specific schema."""
    schema_description = json.dumps(schema, indent=2)

    response = client.chat.completions.create(
        model="gpt-4-1106-preview",
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": f"""You are a data extraction assistant.
                Always output JSON matching this exact schema:
                {schema_description}

                If a field cannot be determined, use null."""
            },
            {
                "role": "user",
                "content": f"Extract data from: {text}"
            }
        ]
    )

    return json.loads(response.choices[0].message.content)

# Define your schema
invoice_schema = {
    "invoice_number": "string",
    "vendor": {
        "name": "string",
        "address": "string",
        "tax_id": "string or null"
    },
    "line_items": [
        {
            "description": "string",
            "quantity": "number",
            "unit_price": "number",
            "total": "number"
        }
    ],
    "subtotal": "number",
    "tax": "number",
    "total": "number",
    "due_date": "ISO date string"
}

# Extract from invoice text
invoice_text = """
Invoice #INV-2023-1234
From: Acme Corp, 123 Main St, Tax ID: 12-3456789
Items:
- Widget A x 5 @ $10.00 = $50.00
- Widget B x 3 @ $25.00 = $75.00
Subtotal: $125.00
Tax (8%): $10.00
Total Due: $135.00
Due: November 30, 2023
"""

result = extract_with_schema(invoice_text, invoice_schema)
print(json.dumps(result, indent=2))
```

## Building Type-Safe Applications

Combine JSON mode with Pydantic for type-safe applications:

```python
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import date

class LineItem(BaseModel):
    description: str
    quantity: int
    unit_price: float
    total: float

class Vendor(BaseModel):
    name: str
    address: str
    tax_id: Optional[str] = None

class Invoice(BaseModel):
    invoice_number: str
    vendor: Vendor
    line_items: List[LineItem]
    subtotal: float
    tax: float
    total: float
    due_date: date

def extract_invoice(text: str) -> Invoice:
    """Extract and validate invoice data."""
    schema = Invoice.model_json_schema()

    response = client.chat.completions.create(
        model="gpt-4-1106-preview",
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": f"Extract invoice data matching this schema: {json.dumps(schema)}"
            },
            {
                "role": "user",
                "content": text
            }
        ]
    )

    data = json.loads(response.choices[0].message.content)
    return Invoice(**data)  # Validates against Pydantic model

# Usage with validation
try:
    invoice = extract_invoice(invoice_text)
    print(f"Invoice {invoice.invoice_number} from {invoice.vendor.name}")
    print(f"Total: ${invoice.total:.2f}")
except Exception as e:
    print(f"Validation error: {e}")
```

## Practical Use Cases

### API Response Generation

```python
def generate_api_response(query: str, context: str) -> dict:
    """Generate a standardized API response."""
    response = client.chat.completions.create(
        model="gpt-4-1106-preview",
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": """Generate responses in this format:
                {
                    "success": boolean,
                    "data": object or null,
                    "message": string,
                    "suggestions": array of strings
                }"""
            },
            {
                "role": "user",
                "content": f"Context: {context}\nQuery: {query}"
            }
        ]
    )

    return json.loads(response.choices[0].message.content)
```

### Data Transformation

```python
def transform_data(source_data: dict, target_format: str) -> dict:
    """Transform data between formats."""
    response = client.chat.completions.create(
        model="gpt-4-1106-preview",
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": f"Transform the input data to this format: {target_format}"
            },
            {
                "role": "user",
                "content": json.dumps(source_data)
            }
        ]
    )

    return json.loads(response.choices[0].message.content)

# Transform legacy format to new format
legacy_data = {"firstName": "John", "lastName": "Doe", "dob": "1990-01-15"}
new_format = '{"full_name": "string", "birth_date": "ISO date", "age": number}'

transformed = transform_data(legacy_data, new_format)
```

## Error Handling

```python
def safe_json_extract(prompt: str, max_retries: int = 3) -> dict:
    """Safely extract JSON with retries."""
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
                model="gpt-4-1106-preview",
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": "Output valid JSON only."},
                    {"role": "user", "content": prompt}
                ]
            )

            return json.loads(response.choices[0].message.content)

        except json.JSONDecodeError as e:
            if attempt == max_retries - 1:
                raise
            continue

    return {}
```

## Conclusion

JSON mode eliminates one of the biggest pain points in LLM application development - unreliable structured outputs. Combined with Pydantic validation, you can build robust, type-safe applications. Tomorrow, we'll explore the seed parameter for reproducible outputs!
