---
title: "Receipt Analysis with AI: Expense Management Automation"
author: Michael John Peña
draft: false
date: 2024-02-17
tags:
  - Receipt Analysis
  - Expense Management
  - Azure AI
  - Document Intelligence
  - Automation
---

## Receipt Extraction

```python
from azure.ai.documentintelligence import DocumentIntelligenceClient

def extract_receipt(image_path: str) -> dict:
    """Extract receipt data."""

    with open(image_path, "rb") as f:
        poller = doc_client.begin_analyze_document("prebuilt-receipt", f)
        result = poller.result()

    receipt = result.documents[0]
    fields = receipt.fields

    items = []
    if "Items" in fields:
        for item in fields["Items"].value:
            items.append({
                "description": item.value.get("Description", {}).get("value"),
                "quantity": item.value.get("Quantity", {}).get("value"),
                "price": item.value.get("Price", {}).get("value"),
                "total": item.value.get("TotalPrice", {}).get("value")
            })

    return {
        "merchant_name": fields.get("MerchantName", {}).get("value"),
        "merchant_address": fields.get("MerchantAddress", {}).get("value"),
        "transaction_date": str(fields.get("TransactionDate", {}).get("value")),
        "transaction_time": str(fields.get("TransactionTime", {}).get("value")),
        "subtotal": fields.get("Subtotal", {}).get("value"),
        "tax": fields.get("TotalTax", {}).get("value"),
        "total": fields.get("Total", {}).get("value"),
        "items": items,
        "confidence": receipt.confidence
    }
```

## Category Classification with GPT-4

```python
def classify_expense(receipt_data: dict) -> dict:
    """Classify expense category using GPT-4."""

    categories = ["Meals", "Transportation", "Office Supplies", "Travel", "Entertainment", "Other"]

    prompt = f"""Classify this expense receipt into one of these categories: {categories}

Merchant: {receipt_data['merchant_name']}
Items: {receipt_data['items']}
Total: ${receipt_data['total']}

Return JSON with: {{"category": "...", "confidence": 0.0-1.0, "reasoning": "..."}}"""

    response = openai_client.chat.completions.create(
        model="gpt-4-turbo",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"}
    )

    return json.loads(response.choices[0].message.content)
```

## Policy Validation

```python
class ExpensePolicy:
    def __init__(self, rules: dict):
        self.rules = rules

    def validate(self, receipt: dict, category: str) -> dict:
        """Validate against expense policy."""

        issues = []

        # Check amount limits
        limit = self.rules.get("limits", {}).get(category, 100)
        if receipt["total"] > limit:
            issues.append(f"Exceeds {category} limit of ${limit}")

        # Check required fields
        if not receipt.get("merchant_name"):
            issues.append("Missing merchant name")

        # Check date (within 30 days)
        receipt_date = datetime.strptime(receipt["transaction_date"], "%Y-%m-%d")
        if (datetime.now() - receipt_date).days > 30:
            issues.append("Receipt older than 30 days")

        return {
            "compliant": len(issues) == 0,
            "issues": issues
        }
```

## Best Practices

1. **Handle image quality** - Validate before processing
2. **Classify automatically** - Use LLM for categorization
3. **Validate against policy** - Automate compliance checks
4. **Support multiple formats** - Photos, PDFs, scans
5. **Enable corrections** - Allow user to fix errors

## Conclusion

AI-powered receipt analysis reduces manual data entry and improves compliance. Combine extraction with classification and validation for complete expense automation.
