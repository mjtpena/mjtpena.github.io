---
title: "Form Recognizer Invoices in Production: Confidence Gates and Review"
description: "How to put Form Recognizer's preview invoice model behind confidence thresholds, business-rule checks and a human review queue before data reaches the ERP."
author: Michael John Pena
draft: false
date: 2021-01-18
url: /blog/azure-form-recognizer-document-processing/
tags:
  - Form Recognizer
  - Cognitive Services
  - Document Processing
  - Azure Functions
  - Python
---

An accounts payable team I worked with last quarter was processing about 4,000 invoices a month by hand: open the PDF, retype the fields into the ERP, repeat. The cost wasn't the data entry; it was the errors. Form Recognizer is a good fit for that kind of workload, but the extraction model is the easy part. The hard part is deciding which results you trust enough to post automatically and which ones a person has to look at.

I've covered the basics of the service before, in [Extracting Data from Documents with Azure Form Recognizer](/blog/2020-08-17-azure-form-recognizer/) and the [follow-up on what changed in late 2020](/blog/2020-10-28-azure-form-recognizer/). This post is narrower: how to wrap the invoice model in a pipeline that routes low-confidence results to a reviewer instead of straight into your finance system.

## What you're actually building on (January 2021)

Be clear-eyed about release status before you design anything, because it changes what you can promise the business.

| Capability | API version | Status today |
|---|---|---|
| Layout (text, tables) | v2.0 | Generally available |
| Prebuilt receipts | v2.0 | Generally available |
| Custom models (with and without labels) | v2.0 | Generally available |
| Prebuilt invoices | v2.1-preview.2 | Public preview |
| Prebuilt business cards | v2.1-preview.2 | Public preview |
| Selection marks, composed custom models | v2.1-preview.2 | Public preview |

The SDKs track this split. The stable Python package, `azure-ai-formrecognizer` 3.0.0, only talks to the v2.0 API and has no invoice method. The invoice and business card methods arrived in the [3.1.0b1 beta in November 2020](https://github.com/Azure/azure-sdk-for-python/blob/azure-ai-formrecognizer_3.1.0b2/sdk/formrecognizer/azure-ai-formrecognizer/CHANGELOG.md), and [3.1.0b2](https://pypi.org/project/azure-ai-formrecognizer/3.1.0b2/) shipped on 12 January with a dependency fix. The .NET equivalent is `Azure.AI.FormRecognizer` 3.1.0-beta.1.

Two practical consequences. First, the [preview invoice model](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/concept-invoice?view=doc-intel-2.1.0) returns header-level fields: vendor and customer names and addresses, invoice ID, invoice date, due date and invoice total. It does not return line items, so if your ERP posting needs line-level detail you still need either table output from another model or a person. Second, preview means no SLA and the response shape can change between preview versions. I'm comfortable running a pilot on it; I would not hard-wire a month-end close process to it without a fallback path.

## Create the resource

A single-service Form Recognizer resource is what you want here, not a multi-service Cognitive Services key, so that billing and key rotation stay scoped to this workload.

```bash
az cognitiveservices account create \
    --name <your-form-recognizer-name> \
    --resource-group <your-resource-group> \
    --kind FormRecognizer \
    --sku S0 \
    --location <your-region>
```

The free F0 tier only analyses the first two pages of a PDF or TIFF (see the [input requirements](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/overview?view=doc-intel-2.1.0)), which is fine for poking at the API and misleading for anything else. Test on S0 with real multi-page invoices. On S0 you pay per page analysed, so a ten-page invoice with nine pages of terms and conditions costs ten times a single-page one; check the [pricing page](https://azure.microsoft.com/en-us/pricing/details/form-recognizer/) for your region before you estimate a monthly run rate.

## The design: three outcomes, not two

Most first attempts treat extraction as pass/fail. I'd push for three outcomes per document:

1. **Auto-post.** Every required field is present, every field clears its confidence threshold, and the business rules pass.
2. **Review.** The document was read, but something is uncertain. A person confirms or corrects specific fields. The result records the page number and bounding box of each flagged field, so the review screen can highlight it and they don't have to hunt.
3. **Reject.** The file isn't an invoice, is unreadable, or the service call failed. It goes to an exception queue, not to a reviewer who will waste time on it.

The middle bucket is where the value is. A reviewer confirming two flagged fields on a pre-filled screen is much faster than keying a whole invoice, and that's the realistic win in the first few months, not "zero touch".

The review screen doesn't need to be elaborate. A simple Power Apps canvas app or a small web form that lists JSON files in the `review` container, shows the source PDF next to the extracted values, and writes the corrected result to `approved` is enough for a pilot. Capture what the reviewer changed, because those corrections are the data you'll tune thresholds with later.

### Thresholds per field, not one global number

A single global threshold of 0.8 is the default everyone reaches for, and it's wrong in both directions. A low-confidence vendor address costs you almost nothing; a wrong invoice total costs real money. Set the bar by the cost of an error:

- **Invoice total, invoice ID, due date:** strict. These drive payment amount, duplicate detection and payment timing.
- **Vendor name:** moderate, because you will match it against the vendor master anyway.
- **Addresses and customer details:** loose or informational only.

Start conservative, log every field's confidence alongside what the reviewer eventually accepted, and lower thresholds only when the data says a field is reliably right above a given score. Treat the confidence score as a relative signal to tune against your own documents rather than a calibrated probability: a 0.9 on one field doesn't mean nine out of ten of those values are right.

### Business rules catch what confidence can't

A field can be extracted with high confidence and still be wrong for your process. A correctly read invoice ID that already exists in the ERP is a duplicate. A due date earlier than the invoice date is a misread or a vendor error. These checks are cheap, deterministic and catch a category of problem the model will never flag.

## The pipeline in code

A minimal shape for this is a blob-triggered Azure Function: invoices land in an `invoices` container, the function calls Form Recognizer, and writes a JSON result into an `approved`, `review` or `rejected` container that downstream systems pick up. This uses the Python Functions programming model with a `function.json` binding file and the 3.1.0b2 SDK.

The invoices and results live in their own storage account, referenced by an `INVOICE_STORAGE` app setting, not in the account behind `AzureWebJobsStorage`. The host account holds the Functions runtime's leases, logs and trigger receipts; keeping business documents out of it means you can lock down, retain and audit the invoice data on its own terms, and rotating one doesn't break the other. Create the four containers up front:

```bash
for c in invoices approved review rejected; do
    az storage container create \
        --name "$c" \
        --connection-string "<your-invoice-storage-connection-string>"
done
```

The function also creates the output containers at startup if they're missing, so a fresh environment doesn't fail its first write with `ResourceNotFoundError`.

`requirements.txt`:

```text
azure-functions
azure-ai-formrecognizer==3.1.0b2
azure-storage-blob==12.7.0
```

`ProcessInvoice/function.json`:

```json
{
  "scriptFile": "__init__.py",
  "bindings": [
    {
      "name": "invoice",
      "type": "blobTrigger",
      "direction": "in",
      "path": "invoices/{name}",
      "connection": "INVOICE_STORAGE"
    }
  ]
}
```

`ProcessInvoice/__init__.py`:

```python
import json
import logging
import os

import azure.functions as func
from azure.ai.formrecognizer import FormRecognizerClient
from azure.core.credentials import AzureKeyCredential
from azure.core.exceptions import HttpResponseError, ResourceExistsError
from azure.storage.blob import BlobServiceClient

# Minimum confidence per field; tune these against your own documents.
THRESHOLDS = {
    "InvoiceId": 0.90,
    "InvoiceTotal": 0.90,
    "DueDate": 0.85,
    "InvoiceDate": 0.80,
    "VendorName": 0.75,
}

fr_client = FormRecognizerClient(
    endpoint=os.environ["FORM_RECOGNIZER_ENDPOINT"],
    credential=AzureKeyCredential(os.environ["FORM_RECOGNIZER_KEY"]),
)
blob_service = BlobServiceClient.from_connection_string(os.environ["INVOICE_STORAGE"])

for name in ("approved", "review", "rejected"):
    try:
        blob_service.get_container_client(name).create_container()
    except ResourceExistsError:
        pass


def evaluate(invoice):
    """Return (values, review reasons, locations of flagged fields)."""
    values, reasons, locations = {}, [], {}
    for name, minimum in THRESHOLDS.items():
        field = invoice.fields.get(name)
        if field is None or field.value is None:
            reasons.append(f"{name}: missing")
            continue
        values[name] = field.value
        if field.confidence < minimum:
            page, box = None, None
            if field.value_data:
                page = field.value_data.page_number
                box = [(p.x, p.y) for p in field.value_data.bounding_box or []]
            locations[name] = {"page": page, "bounding_box": box}
            reasons.append(f"{name}: confidence {field.confidence:.2f} on page {page}")

    # Business rules the model cannot know about.
    invoice_date, due_date = values.get("InvoiceDate"), values.get("DueDate")
    if invoice_date and due_date and due_date < invoice_date:
        reasons.append("DueDate is earlier than InvoiceDate")
    total = values.get("InvoiceTotal")
    if isinstance(total, (int, float)) and total <= 0:
        reasons.append("InvoiceTotal is not positive")

    return values, reasons, locations


def write_result(container, blob_name, payload):
    blob = blob_service.get_blob_client(container=container, blob=blob_name)
    blob.upload_blob(json.dumps(payload, indent=2, default=str), overwrite=True)


def main(invoice: func.InputStream):
    source = invoice.name.split("/", 1)[-1]
    result_name = os.path.splitext(source)[0] + ".json"

    try:
        poller = fr_client.begin_recognize_invoices(invoice.read(), locale="en-US")
        forms = poller.result()
    except HttpResponseError as err:
        logging.error("Form Recognizer failed for %s: %s", source, err.message)
        write_result("rejected", result_name, {"source": source, "error": err.message})
        return

    if not forms:
        write_result("rejected", result_name, {"source": source, "error": "no invoice found"})
        return

    for index, form in enumerate(forms):
        values, reasons, locations = evaluate(form)
        container = "review" if reasons else "approved"
        payload = {
            "source": source,
            "pages": [
                form.page_range.first_page_number,
                form.page_range.last_page_number,
            ],
            "fields": values,
            "review_reasons": reasons,
            "flagged_locations": locations,
        }
        write_result(container, f"{index}-{result_name}", payload)
        logging.info("%s -> %s (%d reasons)", source, container, len(reasons))
```

A few decisions in there are worth calling out.

- **The duplicate-invoice check isn't in the function.** It belongs wherever you can query the ERP or a ledger of processed invoice IDs, usually the downstream integration. Don't let a stateless function pretend to own it.
- **Review reasons are specific.** "InvoiceTotal: confidence 0.62 on page 2", plus the bounding box in `flagged_locations`, tells a reviewer exactly where to look. A boolean `needs_review` flag throws that away.
- **Failures go to `rejected`, not `review`.** A reviewer can't fix a 400 from the service or a file that isn't an invoice.
- **The key comes from app settings.** In a real deployment I'd reference it from Key Vault in the Function App configuration rather than pasting it into settings.

The service has hard input limits worth validating before you pay for a call: files must be PDF, JPEG, PNG or TIFF (BMP is accepted for layout and prebuilt models in the v2.1 preview), under 50 MB, and between 50 × 50 and 10,000 × 10,000 pixels. Scanned invoices from multifunction printers at low DPI are the usual source of poor confidence, so if a vendor's results are consistently weak, check the scan settings before blaming the model. Validating page count up front also controls cost, since every page of a multi-page invoice is billed whether or not the fields you need are on it. The [v2.1 overview and input requirements](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/overview?view=doc-intel-2.1.0) list the details.

## When the prebuilt invoice model is the wrong choice

The preview invoice model is a generalist, and that's both its strength and its limit. I'd reach for something else when:

- **You need line items today.** Use the Layout API (or an unlabelled custom model on v2.0), which returns tables per page, and map the line-item table to your ERP schema yourself; labelled v2.0 models extract key-value fields, not repeating rows. Expect to write per-vendor mapping logic, because column headers and table shapes vary.
- **A handful of vendors make up most of your volume.** A custom model per high-volume vendor, combined with the preview composed-model feature so one model ID routes to the right sub-model, often beats the generalist on accuracy for those vendors.
- **Your documents aren't English-language invoices.** The preview model targets English invoices. Don't assume it degrades gracefully on other languages; test it.
- **Data can't leave your environment.** Look at the [Form Recognizer container](/blog/2020-12-04-azure-cognitive-services-containers/) instead of the cloud endpoint, and check which models the container supports first.

And sometimes you don't need machine learning at all. If 90% of your invoices arrive as structured e-invoices or EDI from a supplier portal, integrate that feed first and use Form Recognizer for the long tail of PDFs.

## Where I'd start

Run the prebuilt invoice model over a few hundred of your real invoices before writing any pipeline code, and look at the confidence distribution per field. That single exercise tells you which fields can auto-post, which will always need review, and whether you need a custom model at all. Then build the three-way routing, ship it with conservative thresholds, and let reviewer corrections tell you where to relax them. The goal for the first release isn't to remove people from accounts payable; it's to turn their day from data entry into exception handling, on a preview API you've deliberately kept a fallback for.
