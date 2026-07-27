---
title: Designing Video Encoding Workflows in Azure
author: Michael John Pena
draft: false
date: 2021-09-25
tags:
  - Azure
  - Media Services
  - Video Encoding
  - Media Processing
  - Cloud Computing

---

I wrote "2021-09-25-azure-encoding-workflows" to share practical, production-minded guidance on this topic.

## Encoding Presets

Azure offers several built-in presets:

| Preset | Description | Use Case |
|--------|-------------|----------|
| AdaptiveStreaming | Multiple bitrate H.264 | General streaming |
| ContentAwareEncoding | AI-optimized encoding | Quality-focused |
| H264SingleBitrate1080p | Single 1080p output | Simple playback |
| H264MultipleBitrate1080p | Fixed bitrate ladder | Predictable delivery |
| CopyAllBitrateNonInterleaved | Pass-through | Format conversion |

## Adaptive Bitrate Encoding

```python
from azure.mgmt.media.models import (
    Transform,
    TransformOutput,
    StandardEncoderPreset,
    H264Video,
    H264Layer,
    H264Complexity,
    AacAudio,
    Mp4Format,
    OutputFile
)

def create_adaptive_encoding_preset() -> StandardEncoderPreset:
    """Create an adaptive bitrate encoding preset."""

    # Define the bitrate ladder
    video_layers = [
        # 1080p
        H264Layer(
            bitrate=6000000,
            max_bitrate=6000000,
            width="1920",
            height="1080",
            buffer_window="PT5S",
            b_frames=3,
            reference_frames=3,
            entropy_mode="Cabac",
            label="1080p"
        ),
        # 720p
        H264Layer(
            bitrate=3400000,
            max_bitrate=3400000,
            width="1280",
            height="720",
            buffer_window="PT5S",
            label="720p"
        ),
        # 540p
        H264Layer(
            bitrate=1800000,
            max_bitrate=1800000,
            width="960",
            height="540",
            label="540p"
        ),
        # 360p
        H264Layer(
            bitrate=800000,
            max_bitrate=800000,
            width="640",
            height="360",
            label="360p"
        ),
        # 240p
        H264Layer(
            bitrate=400000,
            max_bitrate=400000,
            width="426",
            height="240",
            label="240p"
        )
    ]

    video = H264Video(
        key_frame_interval="PT2S",
        complexity=H264Complexity.BALANCED,
        layers=video_layers
    )

    # Audio at multiple bitrates
    audio_128 = AacAudio(
        channels=2,
        sampling_rate=48000,
        bitrate=128000,
        profile="AacLc",
        label="audio-128k"
    )

    audio_64 = AacAudio(
        channels=2,
        sampling_rate=48000,
        bitrate=64000,
        profile="AacLc",
        label="audio-64k"
    )

    # Output format
    mp4_format = Mp4Format(
        filename_pattern="{Basename}-{Label}-{Bitrate}{Extension}",
        output_files=[OutputFile(labels=["1080p", "720p", "540p", "360p", "240p"])]
    )

    return StandardEncoderPreset(
        codecs=[video, audio_128, audio_64],
        formats=[mp4_format]
    )
```

## Content-Aware Encoding

```python
from azure.mgmt.media.models import (
    BuiltInStandardEncoderPreset,
    PresetConfigurations,
    InterleaveOutput,
    EncoderNamedPreset
)

def create_content_aware_transform(media_client, transform_name: str):
    """Create a transform using content-aware encoding."""

    # Content-aware preset with custom configuration
    preset = BuiltInStandardEncoderPreset(
        preset_name=EncoderNamedPreset.CONTENT_AWARE_ENCODING,
        configurations=PresetConfigurations(
            interleave_output=InterleaveOutput.NON_INTERLEAVED_OUTPUT,
            key_frame_interval_in_seconds=2,
            max_bitrate_bps=6000000,
            max_height=1080,
            max_layers=6,
            min_bitrate_bps=200000,
            min_height=180
        )
    )

    outputs = [TransformOutput(preset=preset)]
    transform = Transform(outputs=outputs)

    return media_client.client.transforms.create_or_update(
        media_client.resource_group,
        media_client.account_name,
        transform_name,
        transform
    )
```

## Thumbnail and Sprite Generation

```python
from azure.mgmt.media.models import (
    StandardEncoderPreset,
    JpgImage,
    JpgLayer,
    JpgFormat,
    PngImage,
    PngLayer,
    PngFormat
)

def create_thumbnail_preset() -> StandardEncoderPreset:
    """Create a preset for generating thumbnails."""

    # Single thumbnail at specific time
    thumbnail_single = JpgImage(
        start="00:00:05",  # 5 seconds in
        step="00:00:00",   # No stepping
        range="00:00:01",  # Single frame
        layers=[
            JpgLayer(
                width="1280",
                height="720",
                quality=90,
                label="thumbnail"
            )
        ]
    )

    # Thumbnail sprite (multiple thumbnails)
    thumbnail_sprite = JpgImage(
        start="0%",
        step="5%",        # Every 5% of duration
        range="100%",
        sprite_column=10,  # 10 thumbnails per row
        layers=[
            JpgLayer(
                width="160",
                height="90",
                quality=70,
                label="sprite"
            )
        ]
    )

    # Timeline thumbnails
    thumbnail_timeline = PngImage(
        start="0%",
        step="2%",
        range="100%",
        layers=[
            PngLayer(
                width="320",
                height="180",
                label="timeline"
            )
        ]
    )

    return StandardEncoderPreset(
        codecs=[thumbnail_single, thumbnail_sprite, thumbnail_timeline],
        formats=[
            JpgFormat(filename_pattern="thumb-{Index}{Extension}"),
            JpgFormat(filename_pattern="sprite{Extension}"),
            PngFormat(filename_pattern="timeline-{Index}{Extension}")
        ]
    )
```

## Audio-Only Encoding

```python
from azure.mgmt.media.models import (
    StandardEncoderPreset,
    AacAudio,
    Mp4Format
)

def create_audio_encoding_preset() -> StandardEncoderPreset:
    """Create a preset for audio-only encoding."""

    audio_high = AacAudio(
        channels=2,
        sampling_rate=48000,
        bitrate=192000,
        profile="AacLc",
        label="audio-high"
    )

    audio_medium = AacAudio(
        channels=2,
        sampling_rate=44100,
        bitrate=128000,
        profile="AacLc",
        label="audio-medium"
    )

    audio_low = AacAudio(
        channels=2,
        sampling_rate=44100,
        bitrate=64000,
        profile="HeAacV1",  # HE-AAC for low bitrates
        label="audio-low"
    )

    return StandardEncoderPreset(
        codecs=[audio_high, audio_medium, audio_low],
        formats=[
            Mp4Format(filename_pattern="{Basename}-{Label}{Extension}")
        ]
    )
```

## Multi-Output Encoding

```python
from azure.mgmt.media.models import (
    Transform,
    TransformOutput,
    StandardEncoderPreset,
    BuiltInStandardEncoderPreset,
    EncoderNamedPreset
)

def create_multi_output_transform(media_client, transform_name: str):
    """Create transform with multiple output types."""

    outputs = [
        # Adaptive streaming output
        TransformOutput(
            preset=BuiltInStandardEncoderPreset(
                preset_name=EncoderNamedPreset.ADAPTIVE_STREAMING
            ),
            relative_priority="High"
        ),
        # Thumbnail output
        TransformOutput(
            preset=create_thumbnail_preset(),
            relative_priority="Low"
        ),
        # Audio-only output
        TransformOutput(
            preset=create_audio_encoding_preset(),
            relative_priority="Normal"
        )
    ]

    transform = Transform(outputs=outputs)

    return media_client.client.transforms.create_or_update(
        media_client.resource_group,
        media_client.account_name,
        transform_name,
        transform
    )
```

## Queue-Based Encoding Pipeline

```python
from azure.storage.queue import QueueClient
from azure.mgmt.media import AzureMediaServices
import json
import time

class EncodingPipeline:
    def __init__(self, media_client: AzureMediaServices,
                 queue_connection: str, queue_name: str):
        self.media_client = media_client
        self.queue_client = QueueClient.from_connection_string(
            queue_connection, queue_name
        )

    def submit_encoding_request(self, input_asset: str,
                               transform_name: str,
                               priority: str = "normal"):
        """Submit an encoding request to the queue."""

        message = {
            "input_asset": input_asset,
            "transform_name": transform_name,
            "priority": priority,
            "submitted_at": time.time()
        }

        self.queue_client.send_message(json.dumps(message))

    def process_queue(self, resource_group: str, account_name: str):
        """Process encoding requests from the queue."""

        while True:
            messages = self.queue_client.receive_messages(max_messages=5)

            for message in messages:
                try:
                    request = json.loads(message.content)

                    # Create output asset
                    output_asset_name = f"output-{request['input_asset']}-{int(time.time())}"
                    self.media_client.assets.create_or_update(
                        resource_group,
                        account_name,
                        output_asset_name,
                        {}
                    )

                    # Submit job
                    job_name = f"job-{int(time.time())}"
                    self.media_client.jobs.create(
                        resource_group,
                        account_name,
                        request['transform_name'],
                        job_name,
                        {
                            "input": {"asset_name": request['input_asset']},
                            "outputs": [{"asset_name": output_asset_name}],
                            "priority": request['priority']
                        }
                    )

                    # Delete message from queue
                    self.queue_client.delete_message(message)

                    print(f"Submitted job: {job_name}")

                except Exception as e:
                    print(f"Error processing message: {e}")

            time.sleep(5)  # Poll interval
```

## Encoding Cost Optimization

```python
def estimate_encoding_cost(duration_minutes: float,
                          resolution: str,
                          preset: str) -> float:
    """Estimate encoding cost based on parameters."""

    # Simplified pricing model (actual pricing varies)
    base_cost_per_minute = {
        "1080p": 0.015,
        "720p": 0.010,
        "480p": 0.005
    }

    preset_multiplier = {
        "AdaptiveStreaming": 1.5,  # Multiple outputs
        "ContentAwareEncoding": 2.0,  # AI processing
        "H264SingleBitrate1080p": 1.0
    }

    base = base_cost_per_minute.get(resolution, 0.01)
    multiplier = preset_multiplier.get(preset, 1.0)

    return duration_minutes * base * multiplier

# Example cost estimation
duration = 60  # minutes
cost = estimate_encoding_cost(duration, "1080p", "AdaptiveStreaming")
print(f"Estimated cost for {duration} min video: ${cost:.2f}")
```

## Best Practices

1. **Match Quality to Content**: Use content-aware for variable complexity
2. **Bitrate Ladders**: Include enough steps for smooth ABR switching
3. **Keyframe Alignment**: Use consistent GOP sizes (2-4 seconds)
4. **Audio Encoding**: Include multiple audio bitrates for bandwidth adaptation
5. **Thumbnail Strategy**: Generate sprites for timeline scrubbing
6. **Job Prioritization**: Use priorities for urgent vs. batch encoding

Proper encoding workflow design ensures optimal video quality, efficient delivery, and cost-effective processing for your media applications.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
