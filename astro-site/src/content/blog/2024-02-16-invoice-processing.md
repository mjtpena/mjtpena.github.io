---
title: "AI-Powered Invoice Processing: End-to-End Implementation"
author: Michael John Peña
draft: false
date: 2024-02-16
tags:
  - Invoice Processing
  - Azure Document Intelligence
  - Automation
  - AI
  - Enterprise

---

I wrote "AI-Powered Invoice Processing: End-to-End Implementation" to share practical, production-minded guidance on this topic.

## Invoice Extraction Pipeline

```python
from azure.ai.documentintelligence import DocumentIntelligenceClient
from dataclasses import dataclass

@dataclass
class InvoiceData:
    vendor_name: str
    invoice_number: str
    invoice_date: str
    due_date: str
    total_amount: float
    currency: str
    line_items: list[dict]
    confidence: float

def extract_invoice(document_path: str) -> InvoiceData:
    """Extract invoice data using Azure Document Intelligence."""

    with open(document_path, "rb") as f:
        poller = doc_client.begin_analyze_document("prebuilt-invoice", f)
        result = poller.result()

    invoice = result.documents[0]
    fields = invoice.fields

    line_items = []
    if "Items" in fields:
        for item in fields["Items"].value:
            line_items.append({
                "description": item.value.get("Description", {}).get("value"),
                "quantity": item.value.get("Quantity", {}).get("value"),
                "unit_price": item.value.get("UnitPrice", {}).get("value"),
                "amount": item.value.get("Amount", {}).get("value")
            })

    return InvoiceData(
        vendor_name=fields.get("VendorName", {}).get("value"),
        invoice_number=fields.get("InvoiceId", {}).get("value"),
        invoice_date=str(fields.get("InvoiceDate", {}).get("value")),
        due_date=str(fields.get("DueDate", {}).get("value")),
        total_amount=fields.get("InvoiceTotal", {}).get("value"),
        currency=fields.get("InvoiceTotal", {}).get("currency", "USD"),
        line_items=line_items,
        confidence=invoice.confidence
    )
```

## Validation Logic

```python
class InvoiceValidator:
    def validate(self, invoice: InvoiceData) -> dict:
        """Validate extracted invoice data."""

        issues = []

        # Required fields
        if not invoice.vendor_name:
            issues.append("Missing vendor name")
        if not invoice.invoice_number:
            issues.append("Missing invoice number")
        if not invoice.total_amount:
            issues.append("Missing total amount")

        # Line item sum check
        if invoice.line_items:
            calculated_total = sum(
                item.get("amount", 0) or 0
                for item in invoice.line_items
            )
            if abs(calculated_total - invoice.total_amount) > 0.01:
                issues.append(f"Line items ({calculated_total}) don't match total ({invoice.total_amount})")

        # Confidence check
        if invoice.confidence < 0.8:
            issues.append(f"Low confidence extraction: {invoice.confidence:.2%}")

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "confidence": invoice.confidence
        }
```

## Three-Way Match

```python
def three_way_match(invoice: InvoiceData, po_data: dict, receipt_data: dict) -> dict:
    """Perform three-way matching."""

    matches = {
        "vendor_match": invoice.vendor_name == po_data.get("vendor"),
        "amount_match": abs(invoice.total_amount - po_data.get("amount", 0)) < 0.01,
        "quantity_match": True,  # Compare line items
        "receipt_match": receipt_data.get("received", False)
    }

    all_match = all(matches.values())

    return {
        "approved": all_match,
        "matches": matches,
        "requires_review": not all_match
    }
```

## Best Practices

1. **Use prebuilt-invoice** - Optimized for invoice extraction
2. **Validate extractions** - Check confidence and totals
3. **Implement three-way match** - PO, invoice, receipt
4. **Handle exceptions** - Human review for low confidence
5. **Audit trail** - Log all processing steps

## Conclusion

AI-powered invoice processing reduces manual effort while improving accuracy. Combine extraction with validation and matching for end-to-end automation.

