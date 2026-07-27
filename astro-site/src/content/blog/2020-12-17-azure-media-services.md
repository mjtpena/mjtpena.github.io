---
title: "Azure Media Services: Video Streaming Platform"
author: Michael John Peña
draft: false
date: 2020-12-17
tags:
  - Azure
  - Media Services
  - Video
  - Streaming

---

I wrote "Azure Media Services: Video Streaming Platform" to share practical, production-minded guidance on this topic.

## Creating Media Services

```bash
# Create storage account first
az storage account create \
    --name mediastorage \
    --resource-group myRG \
    --sku Standard_LRS

# Create Media Services account
az ams account create \
    --name my-media-services \
    --resource-group myRG \
    --storage-account mediastorage
```

## Upload and Encode Video

```python
from azure.mgmt.media import AzureMediaServices
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
client = AzureMediaServices(credential, subscription_id, resource_group)

# Create input asset
input_asset = client.assets.create_or_update(
    resource_group,
    media_services_name,
    "input-asset",
    {"description": "Input video"}
)

# Upload video to asset's container
# Use Azure Storage SDK to upload to asset's container URL

# Create transform (encoding preset)
transform = client.transforms.create_or_update(
    resource_group,
    media_services_name,
    "H264MultipleQuality",
    {
        "outputs": [
            {
                "preset": {
                    "@odata.type": "#Microsoft.Media.BuiltInStandardEncoderPreset",
                    "presetName": "AdaptiveStreaming"
                }
            }
        ]
    }
)

# Create output asset
output_asset = client.assets.create_or_update(
    resource_group,
    media_services_name,
    "output-asset",
    {"description": "Encoded output"}
)

# Create encoding job
job = client.jobs.create(
    resource_group,
    media_services_name,
    "H264MultipleQuality",
    "encoding-job-001",
    {
        "input": {
            "@odata.type": "#Microsoft.Media.JobInputAsset",
            "assetName": "input-asset"
        },
        "outputs": [
            {
                "@odata.type": "#Microsoft.Media.JobOutputAsset",
                "assetName": "output-asset"
            }
        ]
    }
)
```

## Streaming Locator

```python
# Create streaming locator
locator = client.streaming_locators.create(
    resource_group,
    media_services_name,
    "stream-locator-001",
    {
        "assetName": "output-asset",
        "streamingPolicyName": "Predefined_ClearStreamingOnly"
    }
)

# Get streaming URLs
paths = client.streaming_locators.list_paths(
    resource_group,
    media_services_name,
    "stream-locator-001"
)

for path in paths.streaming_paths:
    print(f"{path.streaming_protocol}: {path.paths[0]}")
```

## Live Streaming

```python
# Create live event
live_event = client.live_events.create(
    resource_group,
    media_services_name,
    "my-live-event",
    {
        "input": {
            "streamingProtocol": "RTMP"
        },
        "encoding": {
            "encodingType": "Standard",
            "presetName": "Default720p"
        }
    }
)

# Start live event
client.live_events.start(resource_group, media_services_name, "my-live-event")

# Get ingest URL
print(f"Ingest URL: {live_event.input.endpoints[0].url}")

# Create live output (recording)
live_output = client.live_outputs.create(
    resource_group,
    media_services_name,
    "my-live-event",
    "my-live-output",
    {
        "assetName": "live-archive-asset",
        "manifestName": "output",
        "archiveWindowLength": "PT1H"  # 1 hour DVR window
    }
)
```

## Content Protection (DRM)

```python
# Create content key policy
policy = client.content_key_policies.create_or_update(
    resource_group,
    media_services_name,
    "drm-policy",
    {
        "options": [
            {
                "name": "widevine-option",
                "configuration": {
                    "@odata.type": "#Microsoft.Media.ContentKeyPolicyWidevineConfiguration",
                    "widevineTemplate": "{}"
                },
                "restriction": {
                    "@odata.type": "#Microsoft.Media.ContentKeyPolicyTokenRestriction",
                    "issuer": "https://token-issuer.com",
                    "audience": "urn:audience",
                    "primaryVerificationKey": {
                        "@odata.type": "#Microsoft.Media.ContentKeyPolicySymmetricTokenKey",
                        "keyValue": "base64-encoded-key"
                    },
                    "restrictionTokenType": "Jwt"
                }
            }
        ]
    }
)
```

## Video Player (Azure Media Player)

```html
<link href="//amp.azure.net/libs/amp/latest/skins/amp-default/azuremediaplayer.min.css" rel="stylesheet">
<script src="//amp.azure.net/libs/amp/latest/azuremediaplayer.min.js"></script>

<video id="azuremediaplayer" class="azuremediaplayer amp-default-skin" autoplay controls>
    <source src="//streaming-endpoint.streaming.media.azure.net/.../manifest(format=m3u8-aapl)"
            type="application/vnd.ms-sstr+xml" />
</video>

<script>
    var myPlayer = amp('azuremediaplayer', {
        nativeControlsForTouch: false,
        autoplay: true,
        controls: true,
        width: "640",
        height: "400"
    });
</script>
```

Azure Media Services: broadcast-quality video for everyone.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
