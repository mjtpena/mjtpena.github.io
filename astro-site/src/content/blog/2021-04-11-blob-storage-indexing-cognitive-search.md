---
title: Blob Storage Indexing with Azure Cognitive Search
author: Michael John Peña
draft: false
date: 2021-04-11
url: /blog/blob-storage-indexing-cognitive-search/
tags:
  - Azure
  - Blob Storage
  - Cognitive Search
  - Document Processing
  - Knowledge Mining

---

I wrote "2021-04-11-blob-storage-indexing-cognitive-search" to share practical, production-minded guidance on this topic.

## Understanding Blob Indexing

When indexing blobs, the indexer performs several operations:

1. **Enumerate blobs** - Find blobs matching your criteria
2. **Download content** - Retrieve blob data
3. **Document cracking** - Extract text and metadata
4. **AI enrichment** - Apply cognitive skills (optional)
5. **Index mapping** - Map fields to search index

## Setting Up Blob Data Source

### Basic Configuration

```json
{
  "name": "documents-blob-datasource",
  "type": "azureblob",
  "credentials": {
    "connectionString": "DefaultEndpointsProtocol=https;AccountName=mydocs;AccountKey=xxx;EndpointSuffix=core.windows.net"
  },
  "container": {
    "name": "documents",
    "query": null
  }
}
```

### Using Managed Identity

```json
{
  "name": "documents-blob-datasource",
  "type": "azureblob",
  "credentials": {
    "connectionString": "ResourceId=/subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.Storage/storageAccounts/mydocs;"
  },
  "container": {
    "name": "documents"
  }
}
```

### Filtering with Query

```json
{
  "container": {
    "name": "documents",
    "query": "legal/contracts/"
  }
}
```

## Supported Document Formats

Azure Cognitive Search can extract text from many formats:

```yaml
Office Documents:
  - Microsoft Word (.docx, .doc)
  - Microsoft Excel (.xlsx, .xls)
  - Microsoft PowerPoint (.pptx, .ppt)

PDF: .pdf (text-based and scanned with OCR)

Plain Text:
  - .txt
  - .csv
  - .tsv

Web:
  - .html, .htm
  - .xml
  - .json

Email: .eml, .msg

Images (with OCR): .jpg, .png, .bmp, .tiff, .gif
```

## Indexer Configuration for Blobs

### Full Configuration Example

```json
{
  "name": "documents-indexer",
  "dataSourceName": "documents-blob-datasource",
  "targetIndexName": "documents-index",
  "skillsetName": "document-skillset",
  "schedule": {
    "interval": "PT1H"
  },
  "parameters": {
    "batchSize": 10,
    "maxFailedItems": -1,
    "maxFailedItemsPerBatch": -1,
    "configuration": {
      "dataToExtract": "contentAndMetadata",
      "imageAction": "generateNormalizedImages",
      "normalizedImageMaxWidth": 2000,
      "normalizedImageMaxHeight": 2000,
      "indexStorageMetadataOnlyForOversizedDocuments": true,
      "failOnUnsupportedContentType": false,
      "failOnUnprocessableDocument": false,
      "indexedFileNameExtensions": ".pdf,.docx,.pptx,.xlsx,.txt,.html",
      "excludedFileNameExtensions": ".zip,.exe,.dll"
    }
  },
  "fieldMappings": [
    {
      "sourceFieldName": "metadata_storage_path",
      "targetFieldName": "id",
      "mappingFunction": {
        "name": "base64Encode"
      }
    },
    {
      "sourceFieldName": "metadata_storage_name",
      "targetFieldName": "fileName"
    },
    {
      "sourceFieldName": "metadata_storage_path",
      "targetFieldName": "url"
    },
    {
      "sourceFieldName": "metadata_storage_size",
      "targetFieldName": "fileSize"
    },
    {
      "sourceFieldName": "metadata_storage_last_modified",
      "targetFieldName": "lastModified"
    },
    {
      "sourceFieldName": "metadata_content_type",
      "targetFieldName": "contentType"
    }
  ]
}
```

## Handling Different Content Types

### PDF Documents

```json
{
  "parameters": {
    "configuration": {
      "dataToExtract": "contentAndMetadata",
      "pdfTextRotationAlgorithm": "detectAngles"
    }
  }
}
```

### Scanned PDFs with OCR

```json
{
  "name": "ocr-skillset",
  "skills": [
    {
      "@odata.type": "#Microsoft.Skills.Vision.OcrSkill",
      "name": "ocr",
      "description": "Extract text from images",
      "context": "/document/normalized_images/*",
      "lineEnding": "Space",
      "defaultLanguageCode": "en",
      "detectOrientation": true,
      "inputs": [
        {
          "name": "image",
          "source": "/document/normalized_images/*"
        }
      ],
      "outputs": [
        {
          "name": "text",
          "targetName": "ocrText"
        }
      ]
    },
    {
      "@odata.type": "#Microsoft.Skills.Text.MergeSkill",
      "name": "merge-text",
      "description": "Merge OCR text with content",
      "context": "/document",
      "insertPreTag": " ",
      "insertPostTag": " ",
      "inputs": [
        {
          "name": "text",
          "source": "/document/content"
        },
        {
          "name": "itemsToInsert",
          "source": "/document/normalized_images/*/ocrText"
        }
      ],
      "outputs": [
        {
          "name": "mergedText",
          "targetName": "mergedContent"
        }
      ]
    }
  ]
}
```

### Office Documents

```json
{
  "fieldMappings": [
    {
      "sourceFieldName": "metadata_author",
      "targetFieldName": "author"
    },
    {
      "sourceFieldName": "metadata_title",
      "targetFieldName": "title"
    },
    {
      "sourceFieldName": "metadata_creation_date",
      "targetFieldName": "createdDate"
    }
  ]
}
```

## Index Schema for Document Search

```json
{
  "name": "documents-index",
  "fields": [
    {
      "name": "id",
      "type": "Edm.String",
      "key": true,
      "searchable": false
    },
    {
      "name": "fileName",
      "type": "Edm.String",
      "searchable": true,
      "filterable": true,
      "sortable": true
    },
    {
      "name": "content",
      "type": "Edm.String",
      "searchable": true,
      "analyzer": "en.microsoft"
    },
    {
      "name": "url",
      "type": "Edm.String",
      "searchable": false,
      "retrievable": true
    },
    {
      "name": "contentType",
      "type": "Edm.String",
      "filterable": true,
      "facetable": true
    },
    {
      "name": "fileSize",
      "type": "Edm.Int64",
      "filterable": true,
      "sortable": true
    },
    {
      "name": "lastModified",
      "type": "Edm.DateTimeOffset",
      "filterable": true,
      "sortable": true
    },
    {
      "name": "author",
      "type": "Edm.String",
      "searchable": true,
      "filterable": true,
      "facetable": true
    },
    {
      "name": "keyPhrases",
      "type": "Collection(Edm.String)",
      "searchable": true,
      "filterable": true,
      "facetable": true
    },
    {
      "name": "organizations",
      "type": "Collection(Edm.String)",
      "searchable": true,
      "filterable": true,
      "facetable": true
    }
  ],
  "suggesters": [
    {
      "name": "suggester",
      "searchMode": "analyzingInfixMatching",
      "sourceFields": ["fileName", "keyPhrases"]
    }
  ]
}
```

## Change Detection with Blob Storage

### Using Blob Metadata

```python
from azure.storage.blob import BlobServiceClient
import hashlib

def update_blob_metadata_for_change_detection(container_name, blob_name):
    blob_service = BlobServiceClient.from_connection_string(connection_string)
    blob_client = blob_service.get_blob_client(container_name, blob_name)

    # Download and hash content
    content = blob_client.download_blob().readall()
    content_hash = hashlib.md5(content).hexdigest()

    # Update metadata
    blob_client.set_blob_metadata({
        'contenthash': content_hash,
        'indexdate': datetime.utcnow().isoformat()
    })
```

### Native Soft Delete for Deletion Detection

```json
{
  "dataDeletionDetectionPolicy": {
    "@odata.type": "#Microsoft.Azure.Search.NativeBlobSoftDeleteDeletionDetectionPolicy"
  }
}
```

Enable soft delete on storage account:

```bash
az storage account blob-service-properties update \
    --account-name mystorageaccount \
    --enable-delete-retention true \
    --delete-retention-days 7
```

## Handling Large Documents

### Configure Size Limits

```json
{
  "parameters": {
    "configuration": {
      "indexStorageMetadataOnlyForOversizedDocuments": true,
      "failOnUnprocessableDocument": false
    }
  }
}
```

### Chunking Large Documents

```json
{
  "skills": [
    {
      "@odata.type": "#Microsoft.Skills.Text.SplitSkill",
      "name": "split-skill",
      "description": "Split content into chunks",
      "context": "/document",
      "textSplitMode": "pages",
      "maximumPageLength": 5000,
      "pageOverlapLength": 500,
      "inputs": [
        {
          "name": "text",
          "source": "/document/content"
        }
      ],
      "outputs": [
        {
          "name": "textItems",
          "targetName": "pages"
        }
      ]
    }
  ]
}
```

## Organizing Blob Content

### Folder-Based Organization

```
documents/
├── legal/
│   ├── contracts/
│   └── compliance/
├── hr/
│   ├── policies/
│   └── training/
└── finance/
    ├── reports/
    └── invoices/
```

Create separate indexers per folder:

```python
folders = ["legal/contracts", "legal/compliance", "hr/policies", "finance/reports"]

for folder in folders:
    datasource = {
        "name": f"{folder.replace('/', '-')}-datasource",
        "type": "azureblob",
        "credentials": {"connectionString": connection_string},
        "container": {
            "name": "documents",
            "query": folder
        }
    }

    indexer = {
        "name": f"{folder.replace('/', '-')}-indexer",
        "dataSourceName": datasource["name"],
        "targetIndexName": "documents-index",
        "schedule": {"interval": "PT1H"}
    }

    # Create datasource and indexer
    search_client.create_data_source(datasource)
    search_client.create_indexer(indexer)
```

### Metadata-Based Organization

```python
from azure.storage.blob import BlobServiceClient

def upload_with_metadata(container, file_path, department, document_type):
    blob_service = BlobServiceClient.from_connection_string(connection_string)
    blob_client = blob_service.get_blob_client(container, file_path)

    with open(file_path, "rb") as data:
        blob_client.upload_blob(
            data,
            metadata={
                "department": department,
                "documentType": document_type,
                "uploadedBy": "system",
                "uploadDate": datetime.utcnow().isoformat()
            }
        )
```

Map metadata in indexer:

```json
{
  "fieldMappings": [
    {
      "sourceFieldName": "metadata_department",
      "targetFieldName": "department"
    },
    {
      "sourceFieldName": "metadata_documentType",
      "targetFieldName": "documentType"
    }
  ]
}
```

## Searching Indexed Documents

```python
from azure.search.documents import SearchClient
from azure.core.credentials import AzureKeyCredential

search_client = SearchClient(
    endpoint="https://mysearch.search.windows.net",
    index_name="documents-index",
    credential=AzureKeyCredential("api-key")
)

# Search with filters and facets
results = search_client.search(
    search_text="contract renewal",
    filter="contentType eq 'application/pdf'",
    facets=["author", "contentType"],
    highlight_fields="content",
    top=10,
    include_total_count=True
)

print(f"Total results: {results.get_count()}")

for result in results:
    print(f"File: {result['fileName']}")
    print(f"Score: {result['@search.score']}")
    if '@search.highlights' in result:
        print(f"Highlights: {result['@search.highlights']['content']}")
    print("---")

# Get facet counts
for facet in results.get_facets()['contentType']:
    print(f"{facet['value']}: {facet['count']}")
```

## Best Practices

1. **Use appropriate file extensions filter** - Only index needed file types
2. **Configure error handling** - Don't let bad documents stop indexing
3. **Enable soft delete** - Properly handle document deletions
4. **Organize content logically** - Use folders and metadata
5. **Monitor indexer health** - Check for warnings and errors
6. **Test with representative content** - Validate before production
7. **Use managed identity** - More secure than connection strings

## Conclusion

Blob storage indexing with Azure Cognitive Search enables powerful document search scenarios. By understanding the configuration options, handling different content types, and implementing proper change detection, you can build robust search solutions that keep your index synchronized with your document repository. The combination of document cracking, OCR, and AI enrichment makes it possible to search across any document type.

