---
title: "JSON Schema Enforcement in LLM Applications"
author: "Michael John Peña"
draft: false
date: 2024-09-14
tags: ["JSON Schema", "OpenAI", "AI", "Data Validation", "API"]

---

I wrote "JSON Schema Enforcement in LLM Applications" to share practical, production-minded guidance on this topic.

## Understanding JSON Schema Basics

```python
# A comprehensive JSON Schema example
entity_schema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
        "name": {
            "type": "string",
            "description": "Entity name",
            "minLength": 1,
            "maxLength": 200
        },
        "type": {
            "type": "string",
            "enum": ["person", "organization", "location", "event"]
        },
        "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
        },
        "attributes": {
            "type": "object",
            "additionalProperties": {"type": "string"}
        },
        "relationships": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "target": {"type": "string"},
                    "relation": {"type": "string"}
                },
                "required": ["target", "relation"]
            }
        }
    },
    "required": ["name", "type", "confidence"],
    "additionalProperties": False
}
```

## OpenAI Strict Mode

```python
from openai import OpenAI

client = OpenAI()

def extract_with_strict_schema(text: str, schema: dict) -> dict:
    """
    Use OpenAI's strict mode for guaranteed schema compliance
    """
    response = client.chat.completions.create(
        model="gpt-4o-2024-08-06",
        messages=[
            {
                "role": "system",
                "content": "Extract entities from the text according to the schema."
            },
            {
                "role": "user",
                "content": text
            }
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "entity_extraction",
                "strict": True,  # Enforces schema compliance
                "schema": schema
            }
        }
    )

    import json
    return json.loads(response.choices[0].message.content)
```

## Schema Design Patterns

### Pattern 1: Discriminated Unions

```python
# Handle different types with a discriminator field
action_schema = {
    "type": "object",
    "properties": {
        "action_type": {
            "type": "string",
            "enum": ["create", "update", "delete"]
        },
        "target": {"type": "string"},
        "payload": {"type": "object"}
    },
    "required": ["action_type", "target"],
    "allOf": [
        {
            "if": {
                "properties": {"action_type": {"const": "create"}}
            },
            "then": {
                "properties": {
                    "payload": {
                        "type": "object",
                        "required": ["name", "data"]
                    }
                },
                "required": ["payload"]
            }
        },
        {
            "if": {
                "properties": {"action_type": {"const": "delete"}}
            },
            "then": {
                "properties": {
                    "confirm": {"type": "boolean"}
                },
                "required": ["confirm"]
            }
        }
    ],
    "additionalProperties": False
}
```

### Pattern 2: Recursive Structures

```python
# Schema for tree-like structures
tree_node_schema = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "value": {"type": "string"},
        "children": {
            "type": "array",
            "items": {"$ref": "#"}  # Recursive reference
        }
    },
    "required": ["id", "value"],
    "additionalProperties": False
}

# For OpenAI, you need to flatten recursive schemas
def flatten_tree_schema(max_depth: int = 3) -> dict:
    """Generate a non-recursive schema with fixed depth"""

    def build_level(depth: int) -> dict:
        if depth == 0:
            return {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "value": {"type": "string"}
                },
                "required": ["id", "value"],
                "additionalProperties": False
            }

        return {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "value": {"type": "string"},
                "children": {
                    "type": "array",
                    "items": build_level(depth - 1)
                }
            },
            "required": ["id", "value"],
            "additionalProperties": False
        }

    return build_level(max_depth)
```

### Pattern 3: Optional Fields with Defaults

```python
from typing import Optional, List
from pydantic import BaseModel, Field

class ConfiguredExtraction(BaseModel):
    """Schema with sensible defaults"""

    primary_entity: str = Field(
        description="The main entity being discussed"
    )

    secondary_entities: List[str] = Field(
        default_factory=list,
        description="Other entities mentioned"
    )

    sentiment: str = Field(
        default="neutral",
        description="Overall sentiment"
    )

    confidence: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Confidence in extraction"
    )

    metadata: Optional[dict] = Field(
        default=None,
        description="Additional context if available"
    )
```

## Validation Strategies

```python
import json
from jsonschema import validate, ValidationError, Draft202012Validator

class SchemaValidator:
    """Validate LLM outputs against JSON schemas"""

    def __init__(self, schema: dict):
        self.schema = schema
        self.validator = Draft202012Validator(schema)

    def validate(self, data: dict) -> tuple[bool, list]:
        """
        Validate data and return (is_valid, errors)
        """
        errors = list(self.validator.iter_errors(data))
        return len(errors) == 0, [str(e) for e in errors]

    def validate_and_fix(self, data: dict) -> dict:
        """
        Attempt to fix common validation issues
        """
        is_valid, errors = self.validate(data)

        if is_valid:
            return data

        fixed_data = data.copy()

        for error in self.validator.iter_errors(data):
            path = list(error.path)

            # Handle type coercion
            if error.validator == "type":
                expected_type = error.schema.get("type")
                current_value = self._get_nested(fixed_data, path)

                if expected_type == "string":
                    self._set_nested(fixed_data, path, str(current_value))
                elif expected_type == "integer":
                    self._set_nested(fixed_data, path, int(float(current_value)))
                elif expected_type == "number":
                    self._set_nested(fixed_data, path, float(current_value))

        return fixed_data

    def _get_nested(self, data: dict, path: list):
        for key in path:
            data = data[key]
        return data

    def _set_nested(self, data: dict, path: list, value):
        for key in path[:-1]:
            data = data[key]
        data[path[-1]] = value

# Usage
validator = SchemaValidator(entity_schema)
is_valid, errors = validator.validate(extracted_data)
```

## Handling Schema Evolution

```python
from typing import Dict, Any

class SchemaVersionManager:
    """Manage schema versions for backward compatibility"""

    def __init__(self):
        self.schemas: Dict[str, Dict[str, Any]] = {}
        self.migrations: Dict[str, callable] = {}

    def register_schema(self, version: str, schema: dict):
        self.schemas[version] = schema

    def register_migration(self, from_version: str, to_version: str,
                          migration_fn: callable):
        self.migrations[f"{from_version}->{to_version}"] = migration_fn

    def migrate(self, data: dict, from_version: str, to_version: str) -> dict:
        """Migrate data between schema versions"""
        migration_key = f"{from_version}->{to_version}"

        if migration_key in self.migrations:
            return self.migrations[migration_key](data)

        raise ValueError(f"No migration path from {from_version} to {to_version}")

# Example usage
manager = SchemaVersionManager()

# Register schemas
manager.register_schema("v1", {"properties": {"name": {"type": "string"}}})
manager.register_schema("v2", {
    "properties": {
        "full_name": {"type": "string"},
        "created_at": {"type": "string"}
    }
})

# Register migration
def migrate_v1_to_v2(data):
    return {
        "full_name": data.get("name", ""),
        "created_at": "2024-09-14T00:00:00Z"
    }

manager.register_migration("v1", "v2", migrate_v1_to_v2)
```

## Best Practices

1. **Always use strict mode** when available for guaranteed compliance
2. **Design schemas defensively** with clear constraints
3. **Include descriptions** for every field to guide the LLM
4. **Handle missing fields** gracefully with defaults
5. **Version your schemas** for long-term maintenance
6. **Validate both input and output** for complete safety

JSON schema enforcement transforms unpredictable LLM outputs into reliable, type-safe data that your applications can trust.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
