---
title: "AI-Assisted Data Modeling: From Requirements to Schema"
author: Michael John Peña
draft: false
date: 2025-01-20
tags:
  - AI
  - Data Modeling
  - Database Design
  - Azure
  - Architecture

---

I wrote "AI-Assisted Data Modeling: From Requirements to Schema" to share practical, production-minded guidance on this topic.

## The AI-Assisted Modeling Workflow

```
Traditional:
Requirements → Manual Analysis → ERD → Review → Schema → DDL

AI-Assisted:
Requirements → AI Analysis → Initial Model → Human Review → Refinement → Schema → DDL
```

## From Natural Language to Data Model

```python
from azure.ai.foundry import AIFoundryClient

class AIDataModeler:
    def __init__(self, llm_client: AIFoundryClient):
        self.llm = llm_client

    async def generate_model(self, requirements: str, model_type: str = "dimensional") -> dict:
        """Generate data model from business requirements."""

        if model_type == "dimensional":
            prompt = self._dimensional_prompt(requirements)
        elif model_type == "normalized":
            prompt = self._normalized_prompt(requirements)
        else:
            prompt = self._generic_prompt(requirements)

        response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2
        )

        model = json.loads(response.choices[0].message.content)

        # Validate and enhance
        model = self._validate_model(model)
        model = self._add_best_practices(model)

        return model

    def _dimensional_prompt(self, requirements: str) -> str:
        return f"""Design a dimensional data model (star schema) based on these requirements:

        Requirements:
        {requirements}

        Return a JSON structure:
        {{
            "model_name": "name",
            "description": "what this model represents",
            "facts": [
                {{
                    "name": "fact_table_name",
                    "description": "what this fact represents",
                    "grain": "what one row represents",
                    "measures": [
                        {{"name": "column_name", "type": "decimal|integer", "description": "what it measures", "aggregation": "sum|avg|count"}}
                    ],
                    "degenerate_dimensions": [
                        {{"name": "column_name", "type": "string|integer", "description": "description"}}
                    ],
                    "foreign_keys": ["dimension_name", ...]
                }}
            ],
            "dimensions": [
                {{
                    "name": "dim_table_name",
                    "description": "what this dimension represents",
                    "type": "Type1|Type2|Type3",
                    "attributes": [
                        {{"name": "column_name", "type": "string|integer|date", "description": "description"}}
                    ],
                    "hierarchies": [
                        {{"name": "hierarchy_name", "levels": ["level1", "level2", ...]}}
                    ]
                }}
            ],
            "relationships": [
                {{"fact": "fact_name", "dimension": "dim_name", "type": "many_to_one"}}
            ]
        }}

        Follow dimensional modeling best practices:
        - Identify business processes for facts
        - Identify descriptive context for dimensions
        - Define clear grain for each fact
        - Use surrogate keys for dimensions
        - Consider slowly changing dimensions"""

    def _normalized_prompt(self, requirements: str) -> str:
        return f"""Design a normalized data model (3NF) based on these requirements:

        Requirements:
        {requirements}

        Return a JSON structure:
        {{
            "model_name": "name",
            "description": "what this model represents",
            "entities": [
                {{
                    "name": "entity_name",
                    "description": "what this entity represents",
                    "attributes": [
                        {{
                            "name": "column_name",
                            "type": "string|integer|decimal|date|boolean",
                            "nullable": true|false,
                            "description": "description",
                            "constraints": ["primary_key", "unique", "foreign_key:table.column"]
                        }}
                    ]
                }}
            ],
            "relationships": [
                {{
                    "name": "relationship_name",
                    "from_entity": "entity1",
                    "to_entity": "entity2",
                    "cardinality": "one_to_one|one_to_many|many_to_many",
                    "on_delete": "cascade|set_null|restrict"
                }}
            ]
        }}

        Follow normalization best practices:
        - Eliminate redundancy
        - Ensure referential integrity
        - Use appropriate data types
        - Define clear primary keys"""
```

## Iterative Refinement

```python
class InteractiveModeler:
    def __init__(self, base_modeler: AIDataModeler):
        self.modeler = base_modeler
        self.current_model = None
        self.history = []

    async def start(self, requirements: str) -> dict:
        """Start a new modeling session."""
        self.current_model = await self.modeler.generate_model(requirements)
        self.history.append({"action": "initial", "model": self.current_model.copy()})
        return self.current_model

    async def refine(self, feedback: str) -> dict:
        """Refine model based on feedback."""
        response = await self.modeler.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Current data model:
                {json.dumps(self.current_model, indent=2)}

                User feedback:
                {feedback}

                Update the model based on the feedback. Return the complete updated model in the same JSON format.
                Explain your changes briefly."""
            }]
        )

        # Parse response (model + explanation)
        result = self._parse_refinement(response.choices[0].message.content)

        self.current_model = result["model"]
        self.history.append({
            "action": "refine",
            "feedback": feedback,
            "changes": result["explanation"],
            "model": self.current_model.copy()
        })

        return result

    async def add_entity(self, description: str) -> dict:
        """Add a new entity based on description."""
        return await self.refine(f"Add a new entity: {description}")

    async def modify_entity(self, entity_name: str, changes: str) -> dict:
        """Modify an existing entity."""
        return await self.refine(f"Modify entity '{entity_name}': {changes}")

    async def add_relationship(self, description: str) -> dict:
        """Add a relationship between entities."""
        return await self.refine(f"Add relationship: {description}")

    async def optimize_for(self, use_case: str) -> dict:
        """Optimize model for specific use case."""
        return await self.refine(f"Optimize this model for: {use_case}")
```

## Schema Generation

```python
class SchemaGenerator:
    def __init__(self, model: dict):
        self.model = model

    def generate_ddl(self, dialect: str = "fabric") -> str:
        """Generate DDL for the data model."""
        if dialect == "fabric":
            return self._generate_fabric_ddl()
        elif dialect == "postgres":
            return self._generate_postgres_ddl()
        elif dialect == "snowflake":
            return self._generate_snowflake_ddl()
        else:
            raise ValueError(f"Unknown dialect: {dialect}")

    def _generate_fabric_ddl(self) -> str:
        """Generate Fabric Warehouse DDL."""
        ddl_statements = []

        # Generate dimension tables first
        for dim in self.model.get("dimensions", []):
            ddl = self._dimension_to_ddl(dim)
            ddl_statements.append(ddl)

        # Generate fact tables
        for fact in self.model.get("facts", []):
            ddl = self._fact_to_ddl(fact)
            ddl_statements.append(ddl)

        return "\n\n".join(ddl_statements)

    def _dimension_to_ddl(self, dim: dict) -> str:
        """Generate DDL for dimension table."""
        columns = []

        # Surrogate key
        columns.append(f"    {dim['name']}_key BIGINT NOT NULL")

        # Natural key
        columns.append(f"    {dim['name']}_id VARCHAR(50) NOT NULL")

        # Attributes
        for attr in dim["attributes"]:
            col_type = self._map_type(attr["type"])
            nullable = "NULL" if attr.get("nullable", True) else "NOT NULL"
            columns.append(f"    {attr['name']} {col_type} {nullable}")

        # SCD columns if Type 2
        if dim.get("type") == "Type2":
            columns.extend([
                "    effective_date DATE NOT NULL",
                "    expiration_date DATE",
                "    is_current BIT NOT NULL DEFAULT 1"
            ])

        # Audit columns
        columns.extend([
            "    created_at DATETIME2 NOT NULL DEFAULT GETDATE()",
            "    updated_at DATETIME2 NOT NULL DEFAULT GETDATE()"
        ])

        ddl = f"""-- {dim['description']}
CREATE TABLE {dim['name']} (
{chr(10).join(columns)},
    CONSTRAINT PK_{dim['name']} PRIMARY KEY ({dim['name']}_key)
);"""

        return ddl

    def _fact_to_ddl(self, fact: dict) -> str:
        """Generate DDL for fact table."""
        columns = []

        # Foreign keys to dimensions
        for fk in fact["foreign_keys"]:
            columns.append(f"    {fk}_key BIGINT NOT NULL")

        # Degenerate dimensions
        for dd in fact.get("degenerate_dimensions", []):
            col_type = self._map_type(dd["type"])
            columns.append(f"    {dd['name']} {col_type}")

        # Measures
        for measure in fact["measures"]:
            col_type = self._map_type(measure["type"])
            columns.append(f"    {measure['name']} {col_type}")

        # Date key (typically required)
        columns.append("    date_key INT NOT NULL")

        # Audit
        columns.append("    loaded_at DATETIME2 NOT NULL DEFAULT GETDATE()")

        ddl = f"""-- {fact['description']}
-- Grain: {fact['grain']}
CREATE TABLE {fact['name']} (
{chr(10).join(columns)}
);

-- Foreign key constraints
"""
        # Add FK constraints
        for fk in fact["foreign_keys"]:
            ddl += f"""ALTER TABLE {fact['name']}
ADD CONSTRAINT FK_{fact['name']}_{fk}
FOREIGN KEY ({fk}_key) REFERENCES {fk}({fk}_key);

"""

        return ddl

    def _map_type(self, logical_type: str) -> str:
        """Map logical types to Fabric types."""
        type_map = {
            "string": "VARCHAR(255)",
            "text": "VARCHAR(MAX)",
            "integer": "INT",
            "bigint": "BIGINT",
            "decimal": "DECIMAL(18,2)",
            "date": "DATE",
            "datetime": "DATETIME2",
            "boolean": "BIT"
        }
        return type_map.get(logical_type, "VARCHAR(255)")
```

## Model Documentation

```python
class ModelDocumenter:
    def __init__(self, llm_client):
        self.llm = llm_client

    async def generate_documentation(self, model: dict) -> str:
        """Generate comprehensive documentation for data model."""

        response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Generate comprehensive documentation for this data model:

                {json.dumps(model, indent=2)}

                Include:
                1. Executive Summary
                2. Model Overview diagram description
                3. Entity Descriptions (purpose, key attributes, relationships)
                4. Data Dictionary (all columns with descriptions)
                5. Business Rules and Constraints
                6. Usage Examples (sample queries)
                7. Maintenance Guidelines

                Format as Markdown."""
            }]
        )

        return response.choices[0].message.content

    async def generate_erd_description(self, model: dict) -> str:
        """Generate Mermaid diagram for ERD."""

        response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Generate a Mermaid ER diagram for this data model:

                {json.dumps(model, indent=2)}

                Use Mermaid erDiagram syntax. Include key attributes and relationships."""
            }]
        )

        return response.choices[0].message.content
```

## Best Practices

1. **Start with requirements**: AI needs clear business context
2. **Review critically**: AI-generated models are starting points
3. **Iterate**: Use feedback loops to refine
4. **Validate**: Check against known patterns and constraints
5. **Document**: Generate documentation alongside the model

AI-assisted data modeling accelerates the initial design phase but doesn't replace expertise. Use it to generate options quickly, then apply your domain knowledge to refine.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
