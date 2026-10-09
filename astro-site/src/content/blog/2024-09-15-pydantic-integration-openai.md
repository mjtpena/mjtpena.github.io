---
title: "Pydantic Integration with OpenAI: Type-Safe AI Development"
description: "Pydantic integration makes OpenAI's structured outputs truly type-safe, catching errors at development time and ensuring your AI-generated data is always valid."
author: "Michael John Peña"
draft: false
date: 2024-09-15
tags: ["Pydantic", "OpenAI", "Python", "Type Safety", "AI"]
---

## Basic Pydantic Integration

```python
from openai import OpenAI
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

client = OpenAI()

class Author(BaseModel):
    name: str
    email: Optional[str] = None

class BlogPost(BaseModel):
    title: str = Field(description="The title of the blog post")
    slug: str = Field(description="URL-friendly version of title")
    summary: str = Field(description="Brief summary, max 200 chars", max_length=200)
    tags: List[str] = Field(description="Relevant tags", max_length=5)
    author: Author
    published: bool = False

def generate_blog_metadata(content: str) -> BlogPost:
    """Generate structured blog post metadata"""

    response = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {
                "role": "system",
                "content": "Generate blog post metadata from the content. Author should be 'AI Assistant' with no email."
            },
            {
                "role": "user",
                "content": content
            }
        ],
        response_format=BlogPost
    )

    return response.choices[0].message.parsed

# Usage
post = generate_blog_metadata("""
Today we're exploring how to use Pydantic with OpenAI's API
for type-safe AI development. This powerful combination ensures
your LLM outputs are always valid and properly typed.
""")

print(f"Title: {post.title}")
print(f"Tags: {post.tags}")
```

## Advanced Pydantic Features

### Validators and Constraints

```python
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import List
import re

class CodeAnalysis(BaseModel):
    language: str = Field(description="Programming language detected")
    complexity: str = Field(description="Complexity: low, medium, high")
    functions: List[str] = Field(description="List of function names found")
    lines_of_code: int = Field(ge=1, description="Total lines of code")
    has_tests: bool = Field(description="Whether tests are present")

    @field_validator('language')
    @classmethod
    def validate_language(cls, v: str) -> str:
        valid_languages = ['python', 'javascript', 'typescript', 'java', 'go', 'rust']
        if v.lower() not in valid_languages:
            # Normalize to closest match or keep as-is
            return v.lower()
        return v.lower()

    @field_validator('complexity')
    @classmethod
    def validate_complexity(cls, v: str) -> str:
        valid = ['low', 'medium', 'high']
        if v.lower() not in valid:
            return 'medium'  # Default
        return v.lower()

    @field_validator('functions')
    @classmethod
    def clean_function_names(cls, v: List[str]) -> List[str]:
        # Remove any invalid characters from function names
        cleaned = []
        for name in v:
            clean_name = re.sub(r'[^a-zA-Z0-9_]', '', name)
            if clean_name:
                cleaned.append(clean_name)
        return cleaned

def analyze_code(code: str) -> CodeAnalysis:
    response = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {"role": "system", "content": "Analyze the provided code."},
            {"role": "user", "content": code}
        ],
        response_format=CodeAnalysis
    )

    return response.choices[0].message.parsed
```

### Nested Models with Composition

```python
from pydantic import BaseModel, Field
from typing import List, Optional
from enum import Enum
from datetime import date

class TaskStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    BLOCKED = "blocked"

class Person(BaseModel):
    name: str
    role: str

class Risk(BaseModel):
    description: str
    severity: str = Field(description="low, medium, high, critical")
    mitigation: str

class Milestone(BaseModel):
    name: str
    target_date: str = Field(description="ISO date format YYYY-MM-DD")
    deliverables: List[str]
    owner: Person

class Task(BaseModel):
    id: str
    title: str
    description: str
    status: TaskStatus
    assignee: Optional[Person] = None
    estimated_hours: float = Field(ge=0)
    dependencies: List[str] = Field(default_factory=list)

class ProjectPlan(BaseModel):
    """Comprehensive project plan model"""

    name: str
    description: str
    start_date: str
    end_date: str
    team: List[Person]
    milestones: List[Milestone]
    tasks: List[Task]
    risks: List[Risk]
    total_budget: Optional[float] = None

    @model_validator(mode='after')
    def validate_dates(self):
        # Ensure end_date is after start_date
        if self.start_date >= self.end_date:
            raise ValueError("end_date must be after start_date")
        return self

def create_project_plan(description: str) -> ProjectPlan:
    """Generate a complete project plan from description"""

    response = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {
                "role": "system",
                "content": """
                Create a detailed project plan. Use realistic dates starting from 2024-10-01.
                Include at least 3 team members, 3 milestones, 5 tasks, and 2 risks.
                Task IDs should be T001, T002, etc.
                """
            },
            {
                "role": "user",
                "content": description
            }
        ],
        response_format=ProjectPlan
    )

    return response.choices[0].message.parsed
```

### Generic Models

```python
from pydantic import BaseModel
from typing import TypeVar, Generic, List

T = TypeVar('T')

class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    page_size: int
    has_more: bool

class SearchResult(BaseModel):
    title: str
    snippet: str
    relevance_score: float = Field(ge=0, le=1)

# Note: For OpenAI, you need concrete types
class SearchResults(BaseModel):
    items: List[SearchResult]
    total: int
    query: str

def search_documents(query: str, documents: List[str]) -> SearchResults:
    docs_text = "\n\n".join([f"Doc {i+1}: {d}" for i, d in enumerate(documents)])

    response = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {
                "role": "system",
                "content": f"Search through documents and return relevant results.\n\nDocuments:\n{docs_text}"
            },
            {
                "role": "user",
                "content": f"Query: {query}"
            }
        ],
        response_format=SearchResults
    )

    return response.choices[0].message.parsed
```

### Custom Serialization

```python
from pydantic import BaseModel, field_serializer, ConfigDict
from typing import Any
from decimal import Decimal

class FinancialReport(BaseModel):
    model_config = ConfigDict(
        json_encoders={Decimal: str}
    )

    company: str
    revenue: float
    expenses: float
    profit: float
    currency: str = "USD"

    @property
    def profit_margin(self) -> float:
        if self.revenue == 0:
            return 0
        return (self.profit / self.revenue) * 100

    @field_serializer('revenue', 'expenses', 'profit')
    def serialize_money(self, value: float) -> str:
        return f"{self.currency} {value:,.2f}"

    def to_summary(self) -> str:
        return f"""
Financial Report: {self.company}
Revenue: {self.serialize_money(self.revenue)}
Expenses: {self.serialize_money(self.expenses)}
Profit: {self.serialize_money(self.profit)}
Margin: {self.profit_margin:.1f}%
"""
```

## Error Handling

```python
from pydantic import ValidationError

def safe_parse(text: str, model_class) -> tuple:
    """Safely parse with detailed error handling"""

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-2024-08-06",
            messages=[
                {"role": "user", "content": text}
            ],
            response_format=model_class
        )

        message = response.choices[0].message

        if message.refusal:
            return None, f"Model refused: {message.refusal}"

        return message.parsed, None

    except ValidationError as e:
        errors = []
        for error in e.errors():
            loc = " -> ".join(str(l) for l in error["loc"])
            errors.append(f"{loc}: {error['msg']}")
        return None, f"Validation errors:\n" + "\n".join(errors)

    except Exception as e:
        return None, f"Unexpected error: {str(e)}"

# Usage
result, error = safe_parse("Some text", BlogPost)
if error:
    print(f"Failed: {error}")
else:
    print(f"Success: {result}")
```

Pydantic integration makes OpenAI's structured outputs truly type-safe, catching errors at development time and ensuring your AI-generated data is always valid.
