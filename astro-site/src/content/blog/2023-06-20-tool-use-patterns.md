---
title: "Tool Use Patterns for AI Agents: Effective Function Design"
description: "The most consequential design decision in a function-calling agent isn't the model you choose — it's how you write the tool definitions. The model selects…"
author: Michael John Peña
draft: false
date: 2023-06-20
tags:
  - AI Agents
  - Tool Use
  - Function Calling
  - Azure OpenAI
  - Design Patterns
---

The most consequential design decision in a function-calling agent isn't the model you choose — it's how you write the tool definitions. The model selects which function to call based primarily on the `description` field: if that description is vague or ambiguous, the model will make poor choices, call the wrong tool, or fail to call any tool when it should. I've been experimenting with the new 0613 model versions and the patterns that work reliably are consistently the same: descriptions that specify *when* to use a tool (not just what it does), parameter schemas that are as tightly typed as the JSON Schema spec allows, and error messages that include enough context for the model to decide whether to retry or escalate. The nested object limitation in early function calling specs is real — keep schemas flat where possible.

## Tool Design Principles

```python
tool_design_principles = {
    "single_responsibility": {
        "description": "Each tool does one thing well",
        "good": "search_documents(query) -> returns documents",
        "bad": "search_and_summarize_documents(query) -> searches AND summarizes"
    },
    "clear_descriptions": {
        "description": "LLM must understand when to use the tool",
        "good": "Search the product catalog by name, category, or price range",
        "bad": "Search products"
    },
    "explicit_parameters": {
        "description": "All inputs clearly defined with types and constraints",
        "good": {"type": "integer", "minimum": 1, "maximum": 100},
        "bad": {"type": "number"}
    },
    "predictable_outputs": {
        "description": "Consistent return structure",
        "good": {"success": True, "data": [...], "total": 10},
        "bad": "Sometimes returns list, sometimes object"
    }
}
```

## Tool Categories

```python
# Different categories of tools for agents

tool_categories = {
    "information_retrieval": {
        "examples": ["search_web", "query_database", "read_file"],
        "pattern": "Input query -> Return relevant data",
        "error_handling": "Return empty results, not errors"
    },
    "data_transformation": {
        "examples": ["format_date", "convert_currency", "calculate_statistics"],
        "pattern": "Input data -> Return transformed data",
        "error_handling": "Validate inputs, return validation errors"
    },
    "external_actions": {
        "examples": ["send_email", "create_ticket", "make_purchase"],
        "pattern": "Input parameters -> Perform action -> Confirm result",
        "error_handling": "Return success/failure with details"
    },
    "system_queries": {
        "examples": ["get_current_time", "check_permissions", "get_config"],
        "pattern": "No/minimal input -> Return system state",
        "error_handling": "Should rarely fail"
    }
}
```

## Well-Designed Tool Examples

```python
# Example 1: Search tool with good design
search_tool = {
    "name": "search_products",
    "description": """Search the product catalog. Use this when:
- User asks about products, items, or merchandise
- User wants to find something to buy
- User asks about availability or pricing

Do NOT use this for:
- Order status (use get_order_status instead)
- Account information (use get_account_info instead)""",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search terms (product name, description keywords)"
            },
            "category": {
                "type": "string",
                "description": "Filter by category",
                "enum": ["electronics", "clothing", "home", "sports", "all"]
            },
            "price_min": {
                "type": "number",
                "description": "Minimum price filter",
                "minimum": 0
            },
            "price_max": {
                "type": "number",
                "description": "Maximum price filter"
            },
            "in_stock_only": {
                "type": "boolean",
                "description": "Only return items currently in stock",
                "default": True
            },
            "sort_by": {
                "type": "string",
                "enum": ["relevance", "price_low", "price_high", "rating", "newest"],
                "default": "relevance"
            },
            "limit": {
                "type": "integer",
                "description": "Maximum results to return",
                "default": 10,
                "minimum": 1,
                "maximum": 50
            }
        },
        "required": ["query"]
    }
}

def search_products_handler(
    query: str,
    category: str = "all",
    price_min: float = None,
    price_max: float = None,
    in_stock_only: bool = True,
    sort_by: str = "relevance",
    limit: int = 10
) -> dict:
    """Handler for search_products tool"""

    # Build search query
    search_params = {
        "q": query,
        "limit": limit,
        "sort": sort_by
    }

    if category != "all":
        search_params["category"] = category
    if price_min is not None:
        search_params["price_gte"] = price_min
    if price_max is not None:
        search_params["price_lte"] = price_max
    if in_stock_only:
        search_params["in_stock"] = True

    # Execute search
    try:
        results = product_service.search(**search_params)

        return {
            "success": True,
            "total_results": results.total,
            "returned": len(results.items),
            "products": [
                {
                    "id": p.id,
                    "name": p.name,
                    "price": f"${p.price:.2f}",
                    "category": p.category,
                    "rating": f"{p.rating}/5",
                    "in_stock": p.in_stock,
                    "description": p.description[:100] + "..."
                }
                for p in results.items
            ],
            "filters_applied": {
                "category": category,
                "price_range": f"${price_min or 0} - ${price_max or 'any'}",
                "in_stock_only": in_stock_only
            }
        }

    except SearchException as e:
        return {
            "success": False,
            "error": "Search failed",
            "message": str(e),
            "suggestion": "Try a different search query"
        }
```

## Error Handling Patterns

```python
class ToolResult:
    """Standard result format for tools"""

    @staticmethod
    def success(data: any, message: str = None) -> dict:
        return {
            "success": True,
            "data": data,
            "message": message
        }

    @staticmethod
    def error(error_type: str, message: str, suggestion: str = None) -> dict:
        return {
            "success": False,
            "error_type": error_type,
            "message": message,
            "suggestion": suggestion
        }

    @staticmethod
    def not_found(item_type: str, identifier: str) -> dict:
        return ToolResult.error(
            "not_found",
            f"{item_type} '{identifier}' not found",
            f"Check the {item_type} identifier and try again"
        )

    @staticmethod
    def validation_error(field: str, issue: str) -> dict:
        return ToolResult.error(
            "validation",
            f"Invalid {field}: {issue}",
            f"Please provide a valid {field}"
        )

    @staticmethod
    def permission_denied(action: str, resource: str) -> dict:
        return ToolResult.error(
            "permission_denied",
            f"Not authorized to {action} {resource}",
            "Contact administrator if you need access"
        )

# Usage in tool handler
def get_order_status(order_id: str) -> dict:
    # Validate input
    if not order_id or not order_id.startswith("ORD-"):
        return ToolResult.validation_error("order_id", "must start with 'ORD-'")

    # Check permissions
    if not current_user.can_view_order(order_id):
        return ToolResult.permission_denied("view", f"order {order_id}")

    # Retrieve order
    order = order_service.get(order_id)
    if not order:
        return ToolResult.not_found("Order", order_id)

    # Return success
    return ToolResult.success({
        "order_id": order.id,
        "status": order.status,
        "items": len(order.items),
        "total": f"${order.total:.2f}",
        "estimated_delivery": order.estimated_delivery.isoformat()
    })
```

## Tool Composition

```python
# Composing multiple tools for complex operations

class CompositeToolHandler:
    """Handle tools that need to call other tools"""

    def __init__(self, tools: dict):
        self.tools = tools

    def create_order_with_notification(
        self,
        customer_id: str,
        items: list,
        notify: bool = True
    ) -> dict:
        """Composite tool that creates order and optionally notifies"""

        # Step 1: Validate customer
        customer_result = self.tools["get_customer"](customer_id)
        if not customer_result["success"]:
            return customer_result

        # Step 2: Check inventory
        for item in items:
            inventory = self.tools["check_inventory"](item["product_id"])
            if not inventory["success"] or inventory["data"]["available"] < item["quantity"]:
                return ToolResult.error(
                    "insufficient_inventory",
                    f"Not enough stock for {item['product_id']}",
                    "Reduce quantity or choose different product"
                )

        # Step 3: Create order
        order_result = self.tools["create_order"](customer_id, items)
        if not order_result["success"]:
            return order_result

        # Step 4: Send notification if requested
        if notify:
            self.tools["send_notification"](
                customer_id,
                f"Order {order_result['data']['order_id']} created"
            )

        return order_result
```

## Tool Documentation

```python
# Generate tool documentation for LLM

def generate_tool_documentation(tools: list) -> str:
    """Generate human and LLM readable tool documentation"""

    doc = "# Available Tools\n\n"

    for tool in tools:
        doc += f"## {tool['name']}\n\n"
        doc += f"{tool['description']}\n\n"
        doc += "### Parameters\n\n"

        params = tool.get("parameters", {}).get("properties", {})
        required = tool.get("parameters", {}).get("required", [])

        for name, spec in params.items():
            req = "(required)" if name in required else "(optional)"
            doc += f"- **{name}** {req}: {spec.get('description', 'No description')}\n"
            doc += f"  - Type: {spec.get('type', 'any')}\n"
            if "enum" in spec:
                doc += f"  - Allowed values: {', '.join(spec['enum'])}\n"
            if "default" in spec:
                doc += f"  - Default: {spec['default']}\n"

        doc += "\n### Example Usage\n\n"
        # Add example if available
        doc += "\n---\n\n"

    return doc
```

Well-designed tools enable reliable AI agent behavior. Tomorrow, I will cover multi-turn conversation patterns.

## Resources

- [Function Calling Best Practices](https://platform.openai.com/docs/guides/function-calling)
- [OpenAPI Specification](https://swagger.io/specification/)
- [JSON Schema](https://json-schema.org/)
