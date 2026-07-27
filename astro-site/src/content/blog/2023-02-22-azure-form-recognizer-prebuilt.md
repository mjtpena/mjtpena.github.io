---
title: "Azure Form Recognizer Prebuilt Models: Quick Document Processing"
author: Michael John Peña
draft: false
date: 2023-02-22
tags:
  - Azure
  - Form Recognizer
  - Document Intelligence
  - Prebuilt Models
  - AI

---

I wrote "Azure Form Recognizer Prebuilt Models: Quick Document Processing" to share practical, production-minded guidance on this topic.

## Available Prebuilt Models

```python
PREBUILT_MODELS = {
    "prebuilt-read": {
        "description": "OCR - extract text and layout from any document",
        "use_cases": ["General text extraction", "Scanned documents"]
    },
    "prebuilt-layout": {
        "description": "Extract text, tables, and structure",
        "use_cases": ["Table extraction", "Document structure analysis"]
    },
    "prebuilt-document": {
        "description": "General document with key-value pairs",
        "use_cases": ["Forms", "Questionnaires"]
    },
    "prebuilt-invoice": {
        "description": "Extract invoice fields",
        "use_cases": ["Accounts payable", "Invoice processing"]
    },
    "prebuilt-receipt": {
        "description": "Extract receipt data",
        "use_cases": ["Expense management", "Retail"]
    },
    "prebuilt-idDocument": {
        "description": "Extract ID document fields",
        "use_cases": ["Identity verification", "KYC"]
    },
    "prebuilt-businessCard": {
        "description": "Extract business card info",
        "use_cases": ["Contact management", "CRM"]
    },
    "prebuilt-healthInsuranceCard.us": {
        "description": "US health insurance cards",
        "use_cases": ["Healthcare intake", "Insurance verification"]
    },
    "prebuilt-tax.us.w2": {
        "description": "US W-2 tax forms",
        "use_cases": ["Tax processing", "Payroll"]
    }
}
```

## Invoice Processing

```python
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential

client = DocumentAnalysisClient(
    endpoint="https://your-resource.cognitiveservices.azure.com/",
    credential=AzureKeyCredential("your-key")
)

def process_invoice(file_path: str) -> dict:
    """Extract data from an invoice."""

    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-invoice", f)
    result = poller.result()

    invoice = {}

    for doc in result.documents:
        # Vendor info
        invoice["vendor"] = {
            "name": get_field_value(doc.fields, "VendorName"),
            "address": get_field_value(doc.fields, "VendorAddress"),
            "tax_id": get_field_value(doc.fields, "VendorTaxId")
        }

        # Customer info
        invoice["customer"] = {
            "name": get_field_value(doc.fields, "CustomerName"),
            "address": get_field_value(doc.fields, "CustomerAddress"),
            "id": get_field_value(doc.fields, "CustomerId")
        }

        # Invoice details
        invoice["details"] = {
            "invoice_id": get_field_value(doc.fields, "InvoiceId"),
            "invoice_date": get_field_value(doc.fields, "InvoiceDate"),
            "due_date": get_field_value(doc.fields, "DueDate"),
            "purchase_order": get_field_value(doc.fields, "PurchaseOrder")
        }

        # Amounts
        invoice["amounts"] = {
            "subtotal": get_field_value(doc.fields, "SubTotal"),
            "tax": get_field_value(doc.fields, "TotalTax"),
            "total": get_field_value(doc.fields, "InvoiceTotal"),
            "amount_due": get_field_value(doc.fields, "AmountDue"),
            "previous_balance": get_field_value(doc.fields, "PreviousUnpaidBalance")
        }

        # Line items
        invoice["items"] = []
        items_field = doc.fields.get("Items")
        if items_field and items_field.value:
            for item in items_field.value:
                invoice["items"].append({
                    "description": get_field_value(item.value, "Description"),
                    "quantity": get_field_value(item.value, "Quantity"),
                    "unit": get_field_value(item.value, "Unit"),
                    "unit_price": get_field_value(item.value, "UnitPrice"),
                    "amount": get_field_value(item.value, "Amount"),
                    "product_code": get_field_value(item.value, "ProductCode")
                })

    return invoice

def get_field_value(fields: dict, name: str):
    """Safely get field value."""
    field = fields.get(name)
    return field.value if field else None

# Usage
invoice_data = process_invoice("invoice.pdf")
print(f"Invoice: {invoice_data['details']['invoice_id']}")
print(f"Total: {invoice_data['amounts']['total']}")
```

## Receipt Processing

```python
def process_receipt(file_path: str) -> dict:
    """Extract data from a receipt."""

    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-receipt", f)
    result = poller.result()

    receipt = {}

    for doc in result.documents:
        receipt = {
            "merchant": {
                "name": get_field_value(doc.fields, "MerchantName"),
                "address": get_field_value(doc.fields, "MerchantAddress"),
                "phone": get_field_value(doc.fields, "MerchantPhoneNumber")
            },
            "transaction": {
                "date": get_field_value(doc.fields, "TransactionDate"),
                "time": get_field_value(doc.fields, "TransactionTime")
            },
            "totals": {
                "subtotal": get_field_value(doc.fields, "Subtotal"),
                "tax": get_field_value(doc.fields, "TotalTax"),
                "tip": get_field_value(doc.fields, "Tip"),
                "total": get_field_value(doc.fields, "Total")
            },
            "items": []
        }

        items = doc.fields.get("Items")
        if items and items.value:
            for item in items.value:
                receipt["items"].append({
                    "name": get_field_value(item.value, "Name"),
                    "quantity": get_field_value(item.value, "Quantity"),
                    "price": get_field_value(item.value, "TotalPrice")
                })

    return receipt
```

## ID Document Processing

```python
def process_id_document(file_path: str) -> dict:
    """Extract data from ID document (license, passport, etc.)."""

    with open(file_path, "rb") as f:
        poller = client.begin_analyze_document("prebuilt-idDocument", f)
    result = poller.result()

    id_data = {}

    for doc in result.documents:
        doc_type = doc.doc_type  # e.g., "idDocument.driverLicense"

        id_data = {
            "document_type": doc_type,
            "personal": {
                "first_name": get_field_value(doc.fields, "FirstName"),
                "last_name": get_field_value(doc.fields, "LastName"),
                "date_of_birth": get_field_value(doc.fields, "DateOfBirth"),
                "sex": get_field_value(doc.fields, "Sex"),
                "address": get_field_value(doc.fields, "Address")
            },
            "document": {
                "number": get_field_value(doc.fields, "DocumentNumber"),
                "date_of_issue": get_field_value(doc.fields, "DateOfIssue"),
                "date_of_expiration": get_field_value(doc.fields, "DateOfExpiration"),
                "region": get_field_value(doc.fields, "Region"),
                "country": get_field_value(doc.fields, "CountryRegion")
            }
        }

        # Additional fields for driver's license
        if "driverLicense" in doc_type:
            id_data["license"] = {
                "class": get_field_value(doc.fields, "DocumentDiscriminator"),
                "endorsements": get_field_value(doc.fields, "Endorsements"),
                "restrictions": get_field_value(doc.fields, "Restrictions")
            }

    return id_data
```

## Batch Processing

```python
import asyncio
from concurrent.futures import ThreadPoolExecutor

class BatchProcessor:
    """Process multiple documents efficiently."""

    def __init__(self, client, model_id: str, max_workers: int = 5):
        self.client = client
        self.model_id = model_id
        self.max_workers = max_workers

    def process_single(self, file_path: str) -> dict:
        """Process a single document."""
        with open(file_path, "rb") as f:
            poller = self.client.begin_analyze_document(self.model_id, f)
        result = poller.result()

        return {
            "file": file_path,
            "documents": [
                {
                    "type": doc.doc_type,
                    "confidence": doc.confidence,
                    "fields": {
                        name: {
                            "value": field.value,
                            "confidence": field.confidence
                        }
                        for name, field in doc.fields.items()
                    }
                }
                for doc in result.documents
            ]
        }

    def process_batch(self, file_paths: list) -> list:
        """Process multiple documents in parallel."""
        results = []

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {
                executor.submit(self.process_single, path): path
                for path in file_paths
            }

            for future in futures:
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    results.append({
                        "file": futures[future],
                        "error": str(e)
                    })

        return results

# Usage
processor = BatchProcessor(client, "prebuilt-invoice")
results = processor.process_batch([
    "invoice1.pdf",
    "invoice2.pdf",
    "invoice3.pdf"
])

for result in results:
    if "error" in result:
        print(f"Error processing {result['file']}: {result['error']}")
    else:
        print(f"Processed {result['file']}: {len(result['documents'])} documents")
```

## Integration Example

```python
class DocumentProcessingPipeline:
    """Complete document processing pipeline."""

    def __init__(self, endpoint: str, key: str):
        self.client = DocumentAnalysisClient(
            endpoint=endpoint,
            credential=AzureKeyCredential(key)
        )

    def detect_and_process(self, file_path: str) -> dict:
        """Detect document type and process accordingly."""

        # First, analyze layout to detect type
        with open(file_path, "rb") as f:
            poller = self.client.begin_analyze_document("prebuilt-document", f)
        initial_result = poller.result()

        # Determine best model based on content
        model_id = self._detect_document_type(initial_result)

        # Re-process with specific model
        with open(file_path, "rb") as f:
            poller = self.client.begin_analyze_document(model_id, f)
        result = poller.result()

        return {
            "detected_model": model_id,
            "result": self._extract_fields(result)
        }

    def _detect_document_type(self, result) -> str:
        """Detect document type from content."""
        text = ""
        for page in result.pages:
            for line in page.lines:
                text += line.content.lower() + " "

        if any(kw in text for kw in ["invoice", "bill to", "invoice number"]):
            return "prebuilt-invoice"
        elif any(kw in text for kw in ["receipt", "subtotal", "thank you"]):
            return "prebuilt-receipt"
        elif any(kw in text for kw in ["driver license", "passport", "date of birth"]):
            return "prebuilt-idDocument"
        else:
            return "prebuilt-document"

    def _extract_fields(self, result) -> dict:
        """Extract fields from result."""
        fields = {}
        for doc in result.documents:
            for name, field in doc.fields.items():
                fields[name] = field.value
        return fields
```

## Best Practices

1. **Choose the right model**: Use specific models for better accuracy
2. **Handle confidence scores**: Filter low-confidence extractions
3. **Validate extracted data**: Apply business rules
4. **Process asynchronously**: For better throughput
5. **Cache results**: Avoid re-processing same documents

## Resources

- [Prebuilt Models Overview](https://learn.microsoft.com/azure/ai-services/document-intelligence/concept-model-overview)
- [Invoice Model](https://learn.microsoft.com/azure/ai-services/document-intelligence/concept-invoice)
- [Receipt Model](https://learn.microsoft.com/azure/ai-services/document-intelligence/concept-receipt)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
