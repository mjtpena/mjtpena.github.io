---
title: "Video Understanding with AI: Frame Analysis and Summarization"
author: Michael John Peña
draft: false
date: 2024-02-19
tags:
  - Video Analysis
  - GPT-4 Vision
  - Computer Vision
  - AI
  - Multimodal

---

I wrote "Video Understanding with AI: Frame Analysis and Summarization" to share practical, production-minded guidance on this topic.

## Frame Extraction

```python
import cv2
import os

def extract_frames(video_path: str, output_dir: str, fps: int = 1) -> list[str]:
    """Extract frames from video at specified FPS."""

    os.makedirs(output_dir, exist_ok=True)

    cap = cv2.VideoCapture(video_path)
    video_fps = cap.get(cv2.CAP_PROP_FPS)
    frame_interval = int(video_fps / fps)

    frame_paths = []
    frame_count = 0
    saved_count = 0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        if frame_count % frame_interval == 0:
            frame_path = f"{output_dir}/frame_{saved_count:04d}.jpg"
            cv2.imwrite(frame_path, frame)
            frame_paths.append(frame_path)
            saved_count += 1

        frame_count += 1

    cap.release()
    return frame_paths
```

## Video Summarization

```python
def summarize_video(video_path: str, num_frames: int = 10) -> dict:
    """Summarize video content by analyzing key frames."""

    # Extract frames
    frames = extract_frames(video_path, "/tmp/frames", fps=1)

    # Sample evenly
    indices = [int(i * len(frames) / num_frames) for i in range(num_frames)]
    selected_frames = [frames[i] for i in indices]

    # Analyze with GPT-4 Vision
    prompt = """Analyze these frames from a video in sequence.
    Describe:
    1. What the video is about
    2. Key events/actions that occur
    3. Main subjects/objects
    4. A brief summary

    Return as JSON."""

    content = [{"type": "text", "text": prompt}]
    for frame_path in selected_frames:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{encode_image(frame_path)}"}
        })

    response = client.chat.completions.create(
        model="gpt-4-vision-preview",
        messages=[{"role": "user", "content": content}],
        response_format={"type": "json_object"},
        max_tokens=2000
    )

    return json.loads(response.choices[0].message.content)
```

## Scene Detection

```python
def detect_scenes(frames: list[str]) -> list[dict]:
    """Detect scene changes in video frames."""

    prompt = """Analyze these sequential video frames.
    Identify distinct scenes and when transitions occur.

    Return JSON: {"scenes": [{"start_frame": 0, "end_frame": 5, "description": "..."}]}"""

    content = [{"type": "text", "text": prompt}]
    for frame in frames:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{encode_image(frame)}"}
        })

    response = client.chat.completions.create(
        model="gpt-4-vision-preview",
        messages=[{"role": "user", "content": content}],
        response_format={"type": "json_object"}
    )

    return json.loads(response.choices[0].message.content)
```

## Best Practices

1. **Sample strategically** - Key frames, not every frame
2. **Consider context** - Include enough frames for continuity
3. **Optimize extraction** - Balance quality and processing time
4. **Handle long videos** - Process in segments
5. **Combine with audio** - Use speech-to-text for dialogue

## Conclusion

Video understanding through frame analysis enables content summarization, scene detection, and visual search. Combine frame extraction with GPT-4 Vision for effective video AI.

