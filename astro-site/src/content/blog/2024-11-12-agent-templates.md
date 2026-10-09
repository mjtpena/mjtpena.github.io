---
title: "AI Agent Templates: Quick Start Patterns for Enterprise Use Cases"
description: "Templates accelerate agent development by providing battle-tested patterns. Start with a template, customize for your needs, and iterate based on real usage."
author: Michael John Peña
draft: false
date: 2024-11-12
tags:
  - Azure
  - AI
  - AI Agents
  - Templates
  - Best Practices
---

## Available Agent Templates

Azure AI Foundry includes templates for:
- Customer Service Agent
- Data Analysis Agent
- Document Processing Agent
- Code Assistant Agent
- Research Agent

## Template 1: Customer Service Agent

```python
from azure.ai.foundry.templates import CustomerServiceAgent
from azure.ai.foundry.tools import (
    KnowledgeBaseTool,
    TicketSystemTool,
    OrderLookupTool
)

# Initialize from template
agent = CustomerServiceAgent.from_template(
    name="SupportBot",
    model="gpt-4o",
    company_name="Contoso",
    tone="professional and friendly",
    escalation_threshold=3  # Escalate after 3 failed attempts
)

# Add custom tools
agent.add_tool(KnowledgeBaseTool(
    search_endpoint=os.getenv("SEARCH_ENDPOINT"),
    index_name="support-docs"
))

agent.add_tool(TicketSystemTool(
    api_url=os.getenv("TICKET_API"),
    api_key=os.getenv("TICKET_KEY")
))

agent.add_tool(OrderLookupTool(
    connection_string=os.getenv("DB_CONNECTION")
))

# Customize behavior
agent.configure(
    max_turns=10,
    require_ticket_for_refunds=True,
    auto_summarize_conversations=True
)

# Run the agent
response = await agent.handle_message(
    customer_id="C12345",
    message="I never received my order from last week"
)
```

## Template 2: Data Analysis Agent

```python
from azure.ai.foundry.templates import DataAnalysisAgent

class CustomDataAgent(DataAnalysisAgent):
    """Extended data analysis agent with custom capabilities."""

    def __init__(self):
        super().__init__(
            name="FabricAnalyst",
            model="gpt-4o",
            data_sources=[
                {
                    "type": "fabric_lakehouse",
                    "name": "sales_lakehouse",
                    "connection": os.getenv("FABRIC_CONNECTION")
                },
                {
                    "type": "fabric_warehouse",
                    "name": "finance_warehouse",
                    "connection": os.getenv("WAREHOUSE_CONNECTION")
                }
            ]
        )

        # Add domain knowledge
        self.add_context("""
        Our data model:
        - sales_lakehouse: Contains raw and processed sales data
          - bronze_transactions: Raw POS data
          - silver_sales: Cleaned sales records
          - gold_sales_summary: Aggregated daily sales
        - finance_warehouse: Contains financial data
          - fact_revenue: Revenue by product/region
          - dim_products: Product master data
          - dim_regions: Geographic hierarchy
        """)

    async def analyze(self, question: str) -> dict:
        """Perform analysis with auto-visualization."""

        # Get analysis result
        result = await super().analyze(question)

        # Auto-generate visualization if applicable
        if result.has_numeric_data:
            chart = await self.create_visualization(
                data=result.data,
                chart_type=self.suggest_chart_type(result)
            )
            result.visualization = chart

        return result

# Usage
agent = CustomDataAgent()

analysis = await agent.analyze(
    "Compare this quarter's revenue to last year by region"
)

print(analysis.summary)
print(analysis.sql_query)
print(analysis.data)
if analysis.visualization:
    display(analysis.visualization)
```

## Template 3: Document Processing Agent

```python
from azure.ai.foundry.templates import DocumentProcessingAgent

agent = DocumentProcessingAgent.from_template(
    name="DocProcessor",
    model="gpt-4o",
    supported_formats=["pdf", "docx", "xlsx", "images"],
    extraction_schema={
        "invoice": {
            "vendor_name": "string",
            "invoice_number": "string",
            "date": "date",
            "line_items": [{"description": "string", "amount": "number"}],
            "total": "number"
        },
        "contract": {
            "parties": ["string"],
            "effective_date": "date",
            "terms": "string",
            "obligations": ["string"]
        }
    }
)

# Process a document
result = await agent.process(
    document_url="https://storage.blob.core.windows.net/docs/invoice.pdf",
    extract_type="invoice",
    validate=True
)

print(f"Extracted data: {result.data}")
print(f"Confidence: {result.confidence}")
print(f"Validation issues: {result.validation_issues}")
```

## Template 4: Code Assistant Agent

```python
from azure.ai.foundry.templates import CodeAssistantAgent

agent = CodeAssistantAgent.from_template(
    name="DataEngineerCopilot",
    model="gpt-4o",
    languages=["python", "sql", "scala"],
    frameworks=["pyspark", "pandas", "dbt"],
    code_style={
        "python": "pep8",
        "sql": "uppercase_keywords"
    },
    repository_context={
        "type": "github",
        "repo": "org/data-platform",
        "branch": "main"
    }
)

# Add project-specific context
agent.add_context("""
Our data engineering standards:
- Use Delta Lake for all tables
- Partition by date for time-series data
- Include data quality checks in all pipelines
- Follow medallion architecture (bronze/silver/gold)
""")

# Get code assistance
response = await agent.assist(
    task="Write a PySpark job to deduplicate customer records",
    context="""
    Source table: bronze.raw_customers
    Target table: silver.customers
    Deduplication key: email
    Keep: most recent record by updated_at
    """
)

print(response.code)
print(response.explanation)
print(response.tests)
```

## Template 5: Research Agent

```python
from azure.ai.foundry.templates import ResearchAgent

agent = ResearchAgent.from_template(
    name="MarketResearcher",
    model="gpt-4o",
    search_providers=["bing", "azure_cognitive_search"],
    citation_style="apa",
    max_sources=20
)

# Configure research parameters
agent.configure(
    depth="comprehensive",  # quick, standard, comprehensive
    verify_facts=True,
    include_contradictions=True,
    synthesize_findings=True
)

# Conduct research
research = await agent.research(
    topic="Enterprise adoption of Microsoft Fabric in 2024",
    aspects=[
        "Current market penetration",
        "Comparison with competitors",
        "Customer success stories",
        "Common challenges",
        "Future roadmap"
    ],
    output_format="report"
)

print(research.executive_summary)
print(research.detailed_findings)
print(research.sources)
print(research.confidence_assessment)
```

## Creating Custom Templates

```python
from azure.ai.foundry.templates import AgentTemplate

class MyCustomTemplate(AgentTemplate):
    """Custom template for domain-specific agents."""

    template_name = "fabric_admin_agent"
    template_version = "1.0"

    default_instructions = """You are a Microsoft Fabric administrator assistant.
You help with:
- Capacity management
- Workspace administration
- Security and access control
- Performance optimization
- Cost monitoring

Always verify actions before making changes.
Explain the impact of administrative actions."""

    default_tools = [
        "fabric_admin_api",
        "capacity_metrics",
        "workspace_manager"
    ]

    @classmethod
    def from_template(cls, name: str, **kwargs) -> Agent:
        agent = Agent(
            name=name,
            model=kwargs.get("model", "gpt-4o"),
            instructions=cls.default_instructions
        )

        # Add default tools
        for tool_name in cls.default_tools:
            tool = cls.get_tool(tool_name)
            agent.add_tool(tool)

        # Apply customizations
        if "organization" in kwargs:
            agent.add_context(f"Organization: {kwargs['organization']}")

        if "admin_level" in kwargs:
            agent.set_permission_level(kwargs["admin_level"])

        return agent

# Register template
AgentTemplate.register(MyCustomTemplate)

# Use the template
admin_agent = MyCustomTemplate.from_template(
    name="FabricAdmin",
    organization="Contoso Corp",
    admin_level="read_only"
)
```

## Template Selection Guide

| Use Case | Template | Customization Needed |
|----------|----------|---------------------|
| Help desk | CustomerService | Knowledge base, ticket system |
| BI self-service | DataAnalysis | Data source connections |
| Invoice processing | DocumentProcessing | Extraction schema |
| Developer assistance | CodeAssistant | Repo context, standards |
| Competitive intel | Research | Search providers, topics |

Templates accelerate agent development by providing battle-tested patterns. Start with a template, customize for your needs, and iterate based on real usage.

## Resources

- [Agent Templates Gallery](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/templates)
- [Template Customization Guide](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/customization)
- [Best Practices](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/best-practices)
