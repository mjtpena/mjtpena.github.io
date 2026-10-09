---
title: "Reliable Data Extraction with LLMs: Patterns and Practices"
description: "Reliable extraction requires careful schema design, multi-pass validation, and explicit handling of uncertainty. These patterns help you build extraction…"
author: "Michael John Peña"
draft: false
date: 2024-09-17
tags: ["Data Extraction", "LLM", "AI", "NLP", "Python"]
---

## The Extraction Challenge

```python
from openai import OpenAI
from pydantic import BaseModel, Field
from typing import List, Optional
from enum import Enum

client = OpenAI()

# Define what we want to extract
class ContactInfo(BaseModel):
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None

class Company(BaseModel):
    name: str
    industry: Optional[str] = None
    website: Optional[str] = None

class Person(BaseModel):
    name: str
    title: Optional[str] = None
    company: Optional[Company] = None
    contact: Optional[ContactInfo] = None

class ExtractionResult(BaseModel):
    people: List[Person]
    companies: List[Company]
    dates: List[str]
    monetary_values: List[str]
    confidence: float = Field(ge=0, le=1)

def extract_entities(text: str) -> ExtractionResult:
    """Extract structured entities from text"""

    response = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {
                "role": "system",
                "content": """
                Extract all entities from the text. Be thorough but only include
                information that is explicitly stated or strongly implied.
                Set confidence based on clarity of the source text.
                """
            },
            {
                "role": "user",
                "content": text
            }
        ],
        response_format=ExtractionResult
    )

    return response.choices[0].message.parsed
```

## Multi-Pass Extraction

```python
from typing import Dict, Any
import json

class MultiPassExtractor:
    """
    Use multiple passes for higher quality extraction
    """

    def __init__(self):
        self.client = OpenAI()

    def extract(self, text: str) -> Dict[str, Any]:
        # Pass 1: Initial extraction
        initial = self._initial_extraction(text)

        # Pass 2: Validate and enrich
        validated = self._validate_extraction(text, initial)

        # Pass 3: Fill gaps
        final = self._fill_gaps(text, validated)

        return final

    def _initial_extraction(self, text: str) -> dict:
        """First pass: broad extraction"""

        response = self.client.chat.completions.create(
            model="gpt-4o-2024-08-06",
            messages=[
                {
                    "role": "system",
                    "content": "Extract all entities, facts, and relationships from the text."
                },
                {"role": "user", "content": text}
            ],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)

    def _validate_extraction(self, text: str, extraction: dict) -> dict:
        """Second pass: validate extracted data"""

        response = self.client.chat.completions.create(
            model="gpt-4o-2024-08-06",
            messages=[
                {
                    "role": "system",
                    "content": """
                    Review this extraction against the source text.
                    Mark each field as 'verified', 'uncertain', or 'incorrect'.
                    Fix any errors and add confidence scores.
                    """
                },
                {
                    "role": "user",
                    "content": f"Source: {text}\n\nExtraction: {json.dumps(extraction)}"
                }
            ],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)

    def _fill_gaps(self, text: str, validated: dict) -> dict:
        """Third pass: fill in missing information"""

        response = self.client.chat.completions.create(
            model="gpt-4o-2024-08-06",
            messages=[
                {
                    "role": "system",
                    "content": """
                    Look for any information in the source that wasn't captured.
                    Add missing fields but don't hallucinate - only add what's there.
                    """
                },
                {
                    "role": "user",
                    "content": f"Source: {text}\n\nCurrent extraction: {json.dumps(validated)}"
                }
            ],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)
```

## Domain-Specific Extraction

```python
# Invoice extraction
class LineItem(BaseModel):
    description: str
    quantity: float
    unit_price: float
    total: float

class Invoice(BaseModel):
    invoice_number: str
    date: str
    vendor: Company
    customer: Company
    line_items: List[LineItem]
    subtotal: float
    tax: float
    total: float
    payment_terms: Optional[str] = None
    due_date: Optional[str] = None

def extract_invoice(text: str) -> Invoice:
    """Extract invoice data with domain-specific handling"""

    response = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {
                "role": "system",
                "content": """
                Extract invoice information. Ensure:
                - All monetary values are numbers (not strings)
                - Dates are in ISO format (YYYY-MM-DD)
                - Line item totals = quantity * unit_price
                - Subtotal = sum of line item totals
                - Total = subtotal + tax
                """
            },
            {"role": "user", "content": text}
        ],
        response_format=Invoice
    )

    return response.choices[0].message.parsed

# Resume extraction
class Education(BaseModel):
    institution: str
    degree: str
    field: str
    graduation_year: Optional[int] = None
    gpa: Optional[float] = None

class Experience(BaseModel):
    company: str
    title: str
    start_date: str
    end_date: Optional[str] = None
    description: str
    achievements: List[str]

class Resume(BaseModel):
    name: str
    contact: ContactInfo
    summary: Optional[str] = None
    experience: List[Experience]
    education: List[Education]
    skills: List[str]
    certifications: List[str] = []

def extract_resume(text: str) -> Resume:
    """Extract resume information"""

    response = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {
                "role": "system",
                "content": """
                Extract resume information. Order experience by date (most recent first).
                Parse skills into individual items. Identify certifications specifically.
                """
            },
            {"role": "user", "content": text}
        ],
        response_format=Resume
    )

    return response.choices[0].message.parsed
```

## Handling Ambiguity

```python
class AmbiguousValue(BaseModel):
    value: str
    alternatives: List[str] = []
    confidence: float
    context: str

class ExtractionWithUncertainty(BaseModel):
    certain_fields: Dict[str, Any]
    uncertain_fields: List[AmbiguousValue]
    missing_fields: List[str]
    extraction_notes: str

def extract_with_uncertainty(text: str, schema_description: str) -> ExtractionWithUncertainty:
    """
    Extract data while explicitly tracking uncertainty
    """

    response = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {
                "role": "system",
                "content": f"""
                Extract information according to this schema: {schema_description}

                Be explicit about uncertainty:
                - Put clear, unambiguous values in 'certain_fields'
                - Put ambiguous values in 'uncertain_fields' with alternatives
                - List fields you couldn't find in 'missing_fields'
                - Add notes about extraction challenges
                """
            },
            {"role": "user", "content": text}
        ],
        response_format=ExtractionWithUncertainty
    )

    return response.choices[0].message.parsed

# Usage
result = extract_with_uncertainty(
    "John (or maybe Jon) Smith, Senior Dev at Acme (might be ACME Corp)",
    "Person with name, title, company"
)

# Access uncertain data explicitly
for uncertain in result.uncertain_fields:
    print(f"{uncertain.value} (confidence: {uncertain.confidence})")
    print(f"  Alternatives: {uncertain.alternatives}")
```

## Validation and Correction

```python
from typing import Tuple

class ExtractionValidator:
    """Validate and correct extracted data"""

    def __init__(self):
        self.client = OpenAI()

    def validate_and_correct(self, extraction: BaseModel,
                            source_text: str) -> Tuple[BaseModel, List[str]]:
        """
        Validate extraction against source and return corrections
        """
        corrections = []

        # Convert to dict for analysis
        data = extraction.model_dump()

        # Check for hallucinations
        hallucination_check = self._check_hallucinations(data, source_text)
        if hallucination_check:
            corrections.extend(hallucination_check)

        # Check internal consistency
        consistency_check = self._check_consistency(data)
        if consistency_check:
            corrections.extend(consistency_check)

        # Apply corrections
        if corrections:
            corrected = self._apply_corrections(extraction, corrections)
            return corrected, corrections

        return extraction, []

    def _check_hallucinations(self, data: dict, source: str) -> List[str]:
        """Check if extracted data is supported by source"""

        response = self.client.chat.completions.create(
            model="gpt-4o-2024-08-06",
            messages=[
                {
                    "role": "system",
                    "content": """
                    Check if each value in the extraction is supported by the source.
                    Return a list of values that appear to be hallucinated.
                    Format: ["field_name: issue description"]
                    """
                },
                {
                    "role": "user",
                    "content": f"Source: {source}\n\nExtraction: {json.dumps(data)}"
                }
            ],
            response_format={"type": "json_object"}
        )

        result = json.loads(response.choices[0].message.content)
        return result.get("hallucinations", [])

    def _check_consistency(self, data: dict) -> List[str]:
        """Check internal consistency of extracted data"""
        issues = []

        # Example: Check if totals add up
        if 'line_items' in data and 'subtotal' in data:
            calculated = sum(item.get('total', 0) for item in data['line_items'])
            if abs(calculated - data['subtotal']) > 0.01:
                issues.append(f"subtotal: Calculated {calculated}, extracted {data['subtotal']}")

        return issues

    def _apply_corrections(self, extraction: BaseModel,
                          corrections: List[str]) -> BaseModel:
        """Apply corrections to extraction"""
        # Re-extract with corrections guidance
        response = self.client.beta.chat.completions.parse(
            model="gpt-4o-2024-08-06",
            messages=[
                {
                    "role": "system",
                    "content": f"""
                    Fix these issues in the extraction:
                    {chr(10).join(corrections)}
                    """
                },
                {
                    "role": "user",
                    "content": extraction.model_dump_json()
                }
            ],
            response_format=type(extraction)
        )

        return response.choices[0].message.parsed
```

Reliable extraction requires careful schema design, multi-pass validation, and explicit handling of uncertainty. These patterns help you build extraction systems you can trust in production.
