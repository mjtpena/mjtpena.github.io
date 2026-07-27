---
title: "DALL-E 2 on Azure: AI Image Generation for Enterprise"
author: Michael John Peña
draft: false
date: 2022-11-11
tags:
  - Azure
  - OpenAI
  - DALL-E
  - AI
  - Image Generation

---

I wrote "DALL-E 2 on Azure: AI Image Generation for Enterprise" to share practical, production-minded guidance on this topic.

## What is DALL-E 2?

DALL-E 2 creates realistic images from natural language descriptions. It can:

- Generate original images from text prompts
- Edit existing images based on instructions
- Create variations of uploaded images

## Getting Started

```python
import openai
import os
import requests
from PIL import Image
from io import BytesIO

openai.api_type = "azure"
openai.api_base = os.getenv("AZURE_OPENAI_ENDPOINT")
openai.api_key = os.getenv("AZURE_OPENAI_KEY")
openai.api_version = "2022-12-01"

def generate_image(prompt: str, size: str = "1024x1024") -> str:
    """Generate an image from a text prompt."""

    response = openai.Image.create(
        prompt=prompt,
        n=1,
        size=size  # 256x256, 512x512, or 1024x1024
    )

    return response['data'][0]['url']
```

## Enterprise Use Cases

### Product Mockups

```python
def generate_product_mockup(product_description: str, style: str = "professional") -> str:
    """Generate product mockup images."""

    prompt = f"""Professional product photography of {product_description}.
    Style: {style}, clean white background, studio lighting,
    high quality, 4K, commercial photography"""

    return generate_image(prompt)

# Example
mockup_url = generate_product_mockup(
    "a sleek black wireless mouse with RGB lighting",
    "minimalist tech"
)
```

### Marketing Content

```python
def generate_marketing_image(
    product: str,
    theme: str,
    target_audience: str
) -> str:
    """Generate marketing images."""

    prompt = f"""Marketing banner for {product}.
    Theme: {theme}
    Target audience: {target_audience}
    Style: modern, professional, engaging, vibrant colors"""

    return generate_image(prompt)

# Example
banner_url = generate_marketing_image(
    "cloud computing services",
    "digital transformation",
    "enterprise IT decision makers"
)
```

### Architecture Diagrams

```python
def generate_architecture_visual(description: str) -> str:
    """Generate architecture diagram concepts."""

    prompt = f"""Clean, professional cloud architecture diagram showing:
    {description}
    Style: isometric, blue and purple colors, modern tech aesthetic,
    clear icons, white background, enterprise quality"""

    return generate_image(prompt)

# Example
diagram_url = generate_architecture_visual(
    "microservices connected to Azure Service Bus, Azure Functions, and Cosmos DB"
)
```

## Image Editing

```python
def edit_image(
    image_path: str,
    mask_path: str,
    edit_prompt: str
) -> str:
    """Edit an image based on a prompt and mask."""

    with open(image_path, "rb") as image_file:
        with open(mask_path, "rb") as mask_file:
            response = openai.Image.create_edit(
                image=image_file,
                mask=mask_file,
                prompt=edit_prompt,
                n=1,
                size="1024x1024"
            )

    return response['data'][0]['url']

# Example: Remove background and add office setting
edited_url = edit_image(
    "product.png",
    "product_mask.png",
    "Professional office desk setting with modern decor"
)
```

## Creating Variations

```python
def create_variations(image_path: str, num_variations: int = 4) -> list:
    """Create variations of an existing image."""

    with open(image_path, "rb") as image_file:
        response = openai.Image.create_variation(
            image=image_file,
            n=num_variations,
            size="1024x1024"
        )

    return [item['url'] for item in response['data']]

# Generate multiple options for a marketing campaign
variations = create_variations("original_design.png", 4)
```

## Building an Image Generation Service

```python
from azure.storage.blob import BlobServiceClient
from azure.cosmos import CosmosClient
import uuid
from datetime import datetime

class ImageGenerationService:
    """Enterprise image generation service with Azure integration."""

    def __init__(
        self,
        storage_connection: str,
        cosmos_endpoint: str,
        cosmos_key: str
    ):
        self.blob_client = BlobServiceClient.from_connection_string(storage_connection)
        self.container = self.blob_client.get_container_client("generated-images")

        cosmos = CosmosClient(cosmos_endpoint, cosmos_key)
        db = cosmos.get_database_client("images")
        self.metadata_container = db.get_container_client("metadata")

    async def generate_and_store(
        self,
        prompt: str,
        user_id: str,
        project_id: str
    ) -> dict:
        """Generate image and store in Azure."""

        # Generate image
        response = openai.Image.create(
            prompt=prompt,
            n=1,
            size="1024x1024"
        )

        image_url = response['data'][0]['url']

        # Download image
        image_response = requests.get(image_url)
        image_data = image_response.content

        # Generate unique ID
        image_id = str(uuid.uuid4())
        blob_name = f"{project_id}/{image_id}.png"

        # Upload to Azure Blob Storage
        blob_client = self.container.get_blob_client(blob_name)
        blob_client.upload_blob(image_data, overwrite=True)

        # Store metadata in Cosmos DB
        metadata = {
            "id": image_id,
            "partitionKey": project_id,
            "prompt": prompt,
            "userId": user_id,
            "projectId": project_id,
            "blobPath": blob_name,
            "createdAt": datetime.utcnow().isoformat(),
            "size": len(image_data)
        }

        self.metadata_container.upsert_item(metadata)

        return {
            "imageId": image_id,
            "blobUrl": blob_client.url,
            "metadata": metadata
        }

    async def get_project_images(self, project_id: str) -> list:
        """Get all images for a project."""

        query = "SELECT * FROM c WHERE c.projectId = @projectId ORDER BY c.createdAt DESC"
        parameters = [{"name": "@projectId", "value": project_id}]

        items = list(self.metadata_container.query_items(
            query=query,
            parameters=parameters,
            enable_cross_partition_query=False
        ))

        return items
```

## Azure Function for Image Generation

```python
import azure.functions as func
import json
import os

app = func.FunctionApp()

@app.function_name("GenerateImage")
@app.route(route="generate", methods=["POST"])
async def generate_image_function(req: func.HttpRequest) -> func.HttpResponse:
    """HTTP endpoint for image generation."""

    try:
        body = req.get_json()
        prompt = body.get("prompt")
        project_id = body.get("projectId")
        user_id = req.headers.get("X-User-Id")

        if not prompt:
            return func.HttpResponse(
                json.dumps({"error": "Prompt is required"}),
                status_code=400,
                mimetype="application/json"
            )

        # Initialize service
        service = ImageGenerationService(
            os.environ["STORAGE_CONNECTION"],
            os.environ["COSMOS_ENDPOINT"],
            os.environ["COSMOS_KEY"]
        )

        # Generate and store image
        result = await service.generate_and_store(prompt, user_id, project_id)

        return func.HttpResponse(
            json.dumps(result),
            status_code=200,
            mimetype="application/json"
        )

    except Exception as e:
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )
```

## Content Moderation

Always implement content moderation for user-generated prompts:

```python
from azure.ai.contentsafety import ContentSafetyClient
from azure.ai.contentsafety.models import AnalyzeTextOptions

def moderate_prompt(prompt: str) -> tuple[bool, str]:
    """Check if a prompt is safe to use."""

    client = ContentSafetyClient(
        os.environ["CONTENT_SAFETY_ENDPOINT"],
        AzureKeyCredential(os.environ["CONTENT_SAFETY_KEY"])
    )

    request = AnalyzeTextOptions(text=prompt)
    response = client.analyze_text(request)

    # Check for harmful categories
    categories = {
        "hate": response.hate_result,
        "selfHarm": response.self_harm_result,
        "sexual": response.sexual_result,
        "violence": response.violence_result
    }

    for category, result in categories.items():
        if result.severity > 2:  # Block if severity is medium or high
            return False, f"Content blocked due to {category} content"

    return True, "Content approved"

# Use in image generation
def safe_generate_image(prompt: str) -> dict:
    """Generate image with content moderation."""

    is_safe, message = moderate_prompt(prompt)

    if not is_safe:
        return {"error": message, "blocked": True}

    try:
        url = generate_image(prompt)
        return {"url": url, "blocked": False}
    except openai.error.InvalidRequestError as e:
        return {"error": str(e), "blocked": True}
```

## Best Practices

1. **Prompt Engineering**: Be specific about style, quality, and composition
2. **Content Moderation**: Always filter user inputs
3. **Cost Management**: Cache similar requests, limit generation frequency
4. **Storage Strategy**: Store generated images in Azure Blob Storage
5. **Audit Trail**: Keep metadata for compliance and billing

## Prompt Tips for Better Results

```python
effective_prompts = {
    "product_photo": """
        Professional product photography of [ITEM],
        studio lighting, white background,
        high resolution, commercial quality,
        sharp focus, 4K
    """,

    "infographic": """
        Clean infographic about [TOPIC],
        modern design, flat style,
        data visualization, corporate colors,
        professional, easy to read
    """,

    "hero_image": """
        Website hero image for [BUSINESS],
        modern, professional, inspiring,
        blue gradient background,
        business people, technology theme
    """,

    "icon_set": """
        Minimalist icon for [CONCEPT],
        flat design, single color,
        simple geometric shapes,
        app icon style, clean lines
    """
}
```

## Conclusion

DALL-E 2 on Azure opens up powerful image generation capabilities for enterprise applications. With proper content moderation, storage integration, and prompt engineering, you can build sophisticated image generation solutions that meet enterprise requirements.

## Resources

- [Azure OpenAI DALL-E](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/concepts/models#dall-e-models)
- [DALL-E API Reference](https://platform.openai.com/docs/api-reference/images)
- [Content Safety API](https://learn.microsoft.com/en-us/azure/cognitive-services/content-safety/)

