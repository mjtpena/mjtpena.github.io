---
title: Building Media Workflows with Azure Media Services
description: "Azure Media Services provides enterprise-grade media processing and delivery capabilities for building streaming platforms and video applications."
author: Michael John Pena
draft: false
date: 2021-09-24
tags:
  - Azure
  - Media Services
  - Video Streaming
  - Content Delivery
  - Encoding
---

## Media Services Capabilities

- **Encoding**: Transform media into multiple formats and qualities
- **Live Streaming**: Broadcast live events globally
- **On-Demand Streaming**: Deliver video content efficiently
- **Content Protection**: DRM and encryption support
- **Video Indexer**: AI-powered content insights

## Setting Up Media Services

```python
from azure.mgmt.media import AzureMediaServices
from azure.mgmt.media.models import (
    MediaService,
    StorageAccount,
    Transform,
    TransformOutput,
    BuiltInStandardEncoderPreset,
    Asset,
    Job,
    JobInputAsset,
    JobOutputAsset
)
from azure.identity import DefaultAzureCredential

class MediaServicesClient:
    def __init__(self, subscription_id: str, resource_group: str, account_name: str):
        self.credential = DefaultAzureCredential()
        self.client = AzureMediaServices(self.credential, subscription_id)
        self.resource_group = resource_group
        self.account_name = account_name

    def create_asset(self, asset_name: str, description: str = "") -> Asset:
        """Create a new asset for storing media."""

        asset = Asset(description=description)
        return self.client.assets.create_or_update(
            self.resource_group,
            self.account_name,
            asset_name,
            asset
        )

    def create_transform(self, transform_name: str, preset: str = "AdaptiveStreaming") -> Transform:
        """Create an encoding transform."""

        outputs = [
            TransformOutput(
                preset=BuiltInStandardEncoderPreset(preset_name=preset)
            )
        ]

        transform = Transform(outputs=outputs)
        return self.client.transforms.create_or_update(
            self.resource_group,
            self.account_name,
            transform_name,
            transform
        )

    def submit_job(self, transform_name: str, job_name: str,
                  input_asset_name: str, output_asset_name: str) -> Job:
        """Submit an encoding job."""

        job_input = JobInputAsset(asset_name=input_asset_name)
        job_outputs = [JobOutputAsset(asset_name=output_asset_name)]

        job = Job(input=job_input, outputs=job_outputs)
        return self.client.jobs.create(
            self.resource_group,
            self.account_name,
            transform_name,
            job_name,
            job
        )

# Initialize client
media_client = MediaServicesClient(
    "your-subscription-id",
    "media-rg",
    "mediasvcaccount"
)

# Create transform for adaptive streaming
media_client.create_transform("AdaptiveStreamingTransform")
```

## Uploading Content

```python
from azure.storage.blob import BlobServiceClient, generate_blob_sas, BlobSasPermissions
from datetime import datetime, timedelta

class MediaUploader:
    def __init__(self, media_client: MediaServicesClient, storage_connection: str):
        self.media_client = media_client
        self.blob_service = BlobServiceClient.from_connection_string(storage_connection)

    def upload_file(self, asset_name: str, file_path: str) -> str:
        """Upload a file to an asset's container."""

        # Create asset
        asset = self.media_client.create_asset(asset_name)

        # Get container info
        container_name = f"asset-{asset.asset_id}"
        container_client = self.blob_service.get_container_client(container_name)

        # Upload file
        blob_name = file_path.split('/')[-1]
        with open(file_path, 'rb') as data:
            container_client.upload_blob(blob_name, data)

        return asset.asset_id

    def get_upload_url(self, asset_name: str) -> str:
        """Get a SAS URL for uploading to an asset."""

        # Get asset container
        asset = self.media_client.client.assets.get(
            self.media_client.resource_group,
            self.media_client.account_name,
            asset_name
        )

        container_name = f"asset-{asset.asset_id}"

        # Generate SAS
        sas_token = generate_blob_sas(
            account_name=self.blob_service.account_name,
            container_name=container_name,
            blob_name="upload",
            account_key=self.blob_service.credential.account_key,
            permission=BlobSasPermissions(write=True),
            expiry=datetime.utcnow() + timedelta(hours=1)
        )

        return f"https://{self.blob_service.account_name}.blob.core.windows.net/{container_name}?{sas_token}"
```

## Creating Encoding Jobs

```python
from azure.mgmt.media.models import (
    StandardEncoderPreset,
    H264Layer,
    H264Video,
    AacAudio,
    Mp4Format,
    PngImage,
    PngLayer,
    PngFormat
)

def create_custom_encoding_transform(media_client: MediaServicesClient):
    """Create a custom encoding transform with specific settings."""

    # Define video encoding layers
    video = H264Video(
        layers=[
            H264Layer(
                bitrate=3600000,
                width="1920",
                height="1080",
                label="HD-3600kbps"
            ),
            H264Layer(
                bitrate=1600000,
                width="1280",
                height="720",
                label="HD-1600kbps"
            ),
            H264Layer(
                bitrate=800000,
                width="854",
                height="480",
                label="SD-800kbps"
            ),
            H264Layer(
                bitrate=400000,
                width="640",
                height="360",
                label="SD-400kbps"
            )
        ]
    )

    # Audio encoding
    audio = AacAudio(
        channels=2,
        sampling_rate=48000,
        bitrate=128000
    )

    # Thumbnail generation
    thumbnail = PngImage(
        start="25%",
        step="25%",
        range="80%",
        layers=[
            PngLayer(width="640", height="360")
        ]
    )

    # Create preset
    preset = StandardEncoderPreset(
        codecs=[video, audio, thumbnail],
        formats=[
            Mp4Format(filename_pattern="video-{Bitrate}{Extension}"),
            PngFormat(filename_pattern="thumbnail-{Index}{Extension}")
        ]
    )

    outputs = [TransformOutput(preset=preset)]
    transform = Transform(outputs=outputs)

    return media_client.client.transforms.create_or_update(
        media_client.resource_group,
        media_client.account_name,
        "CustomEncodingTransform",
        transform
    )

def monitor_job(media_client: MediaServicesClient, transform_name: str, job_name: str):
    """Monitor encoding job progress."""

    import time

    while True:
        job = media_client.client.jobs.get(
            media_client.resource_group,
            media_client.account_name,
            transform_name,
            job_name
        )

        print(f"Job state: {job.state}")

        if job.state in ['Finished', 'Error', 'Canceled']:
            if job.state == 'Finished':
                print("Encoding completed successfully!")
            elif job.state == 'Error':
                for output in job.outputs:
                    if output.error:
                        print(f"Error: {output.error.message}")
            break

        # Show progress
        for output in job.outputs:
            if hasattr(output, 'progress'):
                print(f"Progress: {output.progress}%")

        time.sleep(10)

    return job
```

## Creating Streaming Locators

```python
from azure.mgmt.media.models import (
    StreamingLocator,
    StreamingPolicy,
    ContentKeyPolicy
)

def create_streaming_locator(media_client: MediaServicesClient,
                            asset_name: str,
                            locator_name: str) -> str:
    """Create a streaming locator for an asset."""

    locator = StreamingLocator(
        asset_name=asset_name,
        streaming_policy_name="Predefined_ClearStreamingOnly"
    )

    created_locator = media_client.client.streaming_locators.create(
        media_client.resource_group,
        media_client.account_name,
        locator_name,
        locator
    )

    # Get streaming URLs
    paths = media_client.client.streaming_locators.list_paths(
        media_client.resource_group,
        media_client.account_name,
        locator_name
    )

    streaming_urls = {}
    for path in paths.streaming_paths:
        streaming_urls[path.streaming_protocol] = path.paths

    return streaming_urls

def get_streaming_endpoint(media_client: MediaServicesClient) -> str:
    """Get the default streaming endpoint hostname."""

    endpoint = media_client.client.streaming_endpoints.get(
        media_client.resource_group,
        media_client.account_name,
        "default"
    )

    return endpoint.host_name
```

## Complete Encoding Workflow

```python
def encode_and_stream(media_client: MediaServicesClient,
                     uploader: MediaUploader,
                     video_file: str) -> dict:
    """Complete workflow: upload, encode, and create streaming URLs."""

    import uuid
    job_id = str(uuid.uuid4())[:8]

    # 1. Create input asset and upload
    input_asset_name = f"input-{job_id}"
    uploader.upload_file(input_asset_name, video_file)
    print(f"Uploaded to asset: {input_asset_name}")

    # 2. Create output asset
    output_asset_name = f"output-{job_id}"
    media_client.create_asset(output_asset_name)

    # 3. Submit encoding job
    job_name = f"job-{job_id}"
    media_client.submit_job(
        "AdaptiveStreamingTransform",
        job_name,
        input_asset_name,
        output_asset_name
    )
    print(f"Encoding job submitted: {job_name}")

    # 4. Wait for completion
    job = monitor_job(media_client, "AdaptiveStreamingTransform", job_name)

    if job.state != 'Finished':
        raise Exception("Encoding failed")

    # 5. Create streaming locator
    locator_name = f"locator-{job_id}"
    streaming_urls = create_streaming_locator(
        media_client,
        output_asset_name,
        locator_name
    )

    # 6. Build complete URLs
    endpoint = get_streaming_endpoint(media_client)
    complete_urls = {}

    for protocol, paths in streaming_urls.items():
        if paths:
            complete_urls[protocol] = f"https://{endpoint}{paths[0]}"

    return {
        "asset_name": output_asset_name,
        "streaming_urls": complete_urls
    }

# Execute workflow
result = encode_and_stream(
    media_client,
    uploader,
    "/path/to/video.mp4"
)

print("Streaming URLs:")
for protocol, url in result["streaming_urls"].items():
    print(f"  {protocol}: {url}")
```

## Best Practices

1. **Use Adaptive Streaming**: Encode for multiple bitrates
2. **Thumbnail Generation**: Create thumbnails during encoding
3. **Content Protection**: Enable DRM for premium content
4. **CDN Integration**: Use Azure CDN for global delivery
5. **Monitor Jobs**: Track encoding progress and errors
6. **Clean Up**: Delete assets when no longer needed

Azure Media Services provides enterprise-grade media processing and delivery capabilities for building streaming platforms and video applications.
