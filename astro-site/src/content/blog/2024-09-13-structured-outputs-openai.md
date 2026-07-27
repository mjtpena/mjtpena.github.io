---
title: "Structured Outputs: Reliable JSON from OpenAI Models"
author: "Michael John Peña"
draft: false
date: 2024-09-13
tags: ["OpenAI", "Structured Outputs", "JSON", "AI", "API"]

---

I wrote "Structured Outputs: Reliable JSON from OpenAI Models" to share practical, production-minded guidance on this topic.

## Basic Structured Outputs

```python
from openai import OpenAI
from pydantic import BaseModel
from typing import List, Optional

client = OpenAI()

# Define your schema using Pydantic
class ProductReview(BaseModel):
    product_name: str
    rating: int
    pros: List[str]
    cons: List[str]
    summary: str
    recommended: bool

def extract_review(text: str) -> ProductReview:
    """Extract structured review data from text"""

    response = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {
                "role": "system",
                "content": "Extract product review information from the text."
            },
            {
                "role": "user",
                "content": text
            }
        ],
        response_format=ProductReview
    )

    return response.choices[0].message.parsed

# Usage
review_text = """
Just got the new XPhone Pro and I'm impressed! The camera is
incredible - best photos I've ever taken on a phone. Battery
lasts all day. However, it's quite heavy and the price is steep
at $1200. Face unlock is fast but fails in low light. Overall,
I'd give it 4 out of 5 stars. Definitely recommend if budget
isn't a concern.
"""

review = extract_review(review_text)
print(f"Product: {review.product_name}")
print(f"Rating: {review.rating}/5")
print(f"Recommended: {review.recommended}")
```

## Complex Nested Structures

```python
from pydantic import BaseModel, Field
from typing import List, Optional
from enum import Enum

class Priority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class TaskStatus(str, Enum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    DONE = "done"

class SubTask(BaseModel):
    title: str
    estimated_hours: float
    status: TaskStatus

class Task(BaseModel):
    title: str
    description: str
    priority: Priority
    estimated_hours: float
    dependencies: List[str] = []
    subtasks: List[SubTask] = []
    assignee: Optional[str] = None

class ProjectPlan(BaseModel):
    project_name: str
    description: str
    tasks: List[Task]
    total_estimated_hours: float
    critical_path: List[str]

def create_project_plan(requirements: str) -> ProjectPlan:
    """Generate a structured project plan from requirements"""

    response = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {
                "role": "system",
                "content": """
                You are a project manager. Create a detailed project plan
                from the given requirements. Include realistic time estimates
                and identify the critical path.
                """
            },
            {
                "role": "user",
                "content": requirements
            }
        ],
        response_format=ProjectPlan
    )

    return response.choices[0].message.parsed

# Usage
plan = create_project_plan("""
Build a mobile app for food delivery:
- User registration and authentication
- Restaurant browsing and search
- Order placement and tracking
- Payment integration
- Push notifications
""")

print(f"Project: {plan.project_name}")
print(f"Total hours: {plan.total_estimated_hours}")
print(f"Critical path: {' -> '.join(plan.critical_path)}")
```

## JSON Schema Mode (Without Pydantic)

```python
def extract_with_schema(text: str, schema: dict) -> dict:
    """Extract data using a raw JSON schema"""

    response = client.chat.completions.create(
        model="gpt-4o-2024-08-06",
        messages=[
            {"role": "system", "content": "Extract information according to the schema."},
            {"role": "user", "content": text}
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "extraction",
                "strict": True,
                "schema": schema
            }
        }
    )

    import json
    return json.loads(response.choices[0].message.content)

# Define schema manually
person_schema = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "age": {"type": "integer"},
        "email": {"type": "string"},
        "skills": {
            "type": "array",
            "items": {"type": "string"}
        }
    },
    "required": ["name", "age", "email", "skills"],
    "additionalProperties": False
}

result = extract_with_schema(
    "John is 32 years old, works as a developer. Contact: john@example.com. Knows Python, TypeScript, and Go.",
    person_schema
)
```

## Handling Refusals

```python
class AnalysisResult(BaseModel):
    findings: List[str]
    risk_level: str
    recommendations: List[str]

def safe_analysis(text: str) -> Optional[AnalysisResult]:
    """Handle cases where the model might refuse"""

    response = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {"role": "system", "content": "Analyze the security implications."},
            {"role": "user", "content": text}
        ],
        response_format=AnalysisResult
    )

    message = response.choices[0].message

    # Check for refusal
    if message.refusal:
        print(f"Model refused: {message.refusal}")
        return None

    return message.parsed
```

## Streaming Structured Outputs

```python
from pydantic import BaseModel
from typing import List
import json

class StepByStepSolution(BaseModel):
    problem: str
    steps: List[str]
    final_answer: str
    confidence: float

def stream_structured_response(prompt: str):
    """Stream structured output with partial JSON"""

    response = client.chat.completions.create(
        model="gpt-4o-2024-08-06",
        messages=[
            {"role": "system", "content": "Solve problems step by step."},
            {"role": "user", "content": prompt}
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "solution",
                "strict": True,
                "schema": StepByStepSolution.model_json_schema()
            }
        },
        stream=True
    )

    partial_json = ""
    for chunk in response:
        if chunk.choices[0].delta.content:
            partial_json += chunk.choices[0].delta.content
            print(chunk.choices[0].delta.content, end="", flush=True)

    print()  # Newline
    return json.loads(partial_json)
```

## Best Practices

```python
from pydantic import BaseModel, Field, field_validator
from typing import List, Annotated

class WellDefinedSchema(BaseModel):
    """Use Field for better descriptions and constraints"""

    name: Annotated[str, Field(
        description="The full name of the person",
        min_length=1,
        max_length=100
    )]

    age: Annotated[int, Field(
        description="Age in years",
        ge=0,
        le=150
    )]

    tags: Annotated[List[str], Field(
        description="Relevant tags, max 5",
        max_length=5
    )]

    @field_validator('name')
    @classmethod
    def name_must_not_be_empty(cls, v):
        if not v.strip():
            raise ValueError('Name cannot be empty')
        return v.strip()

# Use descriptive schema names
class CustomerFeedbackAnalysis(BaseModel):
    """Analysis of customer feedback with sentiment and action items"""

    sentiment: Annotated[str, Field(
        description="Overall sentiment: positive, negative, neutral, or mixed"
    )]

    key_points: Annotated[List[str], Field(
        description="Main points raised by the customer"
    )]

    action_items: Annotated[List[str], Field(
        description="Suggested follow-up actions for support team"
    )]

    urgency: Annotated[int, Field(
        description="Urgency level from 1 (low) to 5 (high)",
        ge=1,
        le=5
    )]
```

## Error Handling

```python
from openai import APIError
from pydantic import ValidationError

def robust_structured_extraction(text: str, schema_class):
    """Handle various error scenarios"""

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o-2024-08-06",
            messages=[
                {"role": "user", "content": text}
            ],
            response_format=schema_class
        )

        if response.choices[0].message.refusal:
            return {"error": "refusal", "message": response.choices[0].message.refusal}

        return {"success": True, "data": response.choices[0].message.parsed}

    except ValidationError as e:
        return {"error": "validation", "message": str(e)}

    except APIError as e:
        return {"error": "api", "message": str(e)}
```

Structured Outputs transform unreliable text generation into dependable data extraction. Use them whenever you need guaranteed JSON structure from your AI applications.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
