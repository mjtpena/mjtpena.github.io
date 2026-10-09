---
title: "Video Analysis with Azure AI: Frame-by-Frame Intelligence"
author: Michael John Peña
draft: false
date: 2023-09-11
description: "Learn how to analyze video content using Azure AI services for object detection, activity recognition, and content understanding."
tags:
  - Azure
  - Video Analysis
  - Computer Vision
  - AI
  - Video Intelligence
---

## Introduction

Video analysis presents unique challenges compared to static image analysis. Azure AI provides powerful tools for extracting insights from video content, including object tracking, activity recognition, and content summarization. This post explores practical approaches to video analysis using Azure services.

## Video Analysis Architecture

### Video Processing Pipeline

```python
import os
import cv2
import tempfile
from typing import List, Generator, Optional
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor
import numpy as np

@dataclass
class VideoFrame:
    index: int
    timestamp: float
    image: np.ndarray

@dataclass
class FrameAnalysis:
    frame_index: int
    timestamp: float
    objects: List[dict]
    caption: Optional[str]
    tags: List[str]

class VideoProcessor:
    def __init__(self, sample_rate: int = 1):
        """Initialize video processor

        Args:
            sample_rate: Analyze every Nth frame
        """
        self.sample_rate = sample_rate

    def extract_frames(self, video_path: str) -> Generator[VideoFrame, None, None]:
        """Extract frames from video"""
        cap = cv2.VideoCapture(video_path)

        if not cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_count % self.sample_rate == 0:
                timestamp = frame_count / fps
                # Convert BGR to RGB
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                yield VideoFrame(
                    index=frame_count,
                    timestamp=timestamp,
                    image=frame_rgb
                )

            frame_count += 1

        cap.release()

    def get_video_info(self, video_path: str) -> dict:
        """Get video metadata"""
        cap = cv2.VideoCapture(video_path)

        info = {
            "fps": cap.get(cv2.CAP_PROP_FPS),
            "frame_count": int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
            "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            "duration": cap.get(cv2.CAP_PROP_FRAME_COUNT) / cap.get(cv2.CAP_PROP_FPS)
        }

        cap.release()
        return info

    def frame_to_bytes(self, frame: VideoFrame, format: str = ".jpg") -> bytes:
        """Convert frame to bytes for API submission"""
        # Convert RGB back to BGR for cv2
        frame_bgr = cv2.cvtColor(frame.image, cv2.COLOR_RGB2BGR)
        _, buffer = cv2.imencode(format, frame_bgr)
        return buffer.tobytes()

# Usage
processor = VideoProcessor(sample_rate=30)  # Every 30th frame (1fps for 30fps video)
video_info = processor.get_video_info("video.mp4")
print(f"Duration: {video_info['duration']:.1f}s, Frames: {video_info['frame_count']}")
```

### Azure AI Video Analysis

```python
from azure.ai.vision.imageanalysis import ImageAnalysisClient
from azure.ai.vision.imageanalysis.models import VisualFeatures
from azure.core.credentials import AzureKeyCredential

class VideoAnalyzer:
    def __init__(self, processor: VideoProcessor):
        self.processor = processor
        self.vision_client = ImageAnalysisClient(
            endpoint=os.getenv("AZURE_VISION_ENDPOINT"),
            credential=AzureKeyCredential(os.getenv("AZURE_VISION_KEY"))
        )

    def analyze_frame(self, frame: VideoFrame) -> FrameAnalysis:
        """Analyze a single video frame"""
        image_bytes = self.processor.frame_to_bytes(frame)

        result = self.vision_client.analyze(
            image_data=image_bytes,
            visual_features=[
                VisualFeatures.CAPTION,
                VisualFeatures.OBJECTS,
                VisualFeatures.TAGS
            ]
        )

        objects = []
        if result.objects:
            for obj in result.objects.list:
                objects.append({
                    "name": obj.tags[0].name if obj.tags else "unknown",
                    "confidence": obj.tags[0].confidence if obj.tags else 0,
                    "box": {
                        "x": obj.bounding_box.x,
                        "y": obj.bounding_box.y,
                        "width": obj.bounding_box.width,
                        "height": obj.bounding_box.height
                    }
                })

        tags = []
        if result.tags:
            tags = [{"name": t.name, "confidence": t.confidence} for t in result.tags.list]

        caption = result.caption.text if result.caption else None

        return FrameAnalysis(
            frame_index=frame.index,
            timestamp=frame.timestamp,
            objects=objects,
            caption=caption,
            tags=tags
        )

    def analyze_video(
        self,
        video_path: str,
        max_workers: int = 4,
        progress_callback=None
    ) -> List[FrameAnalysis]:
        """Analyze entire video"""
        frames = list(self.processor.extract_frames(video_path))
        total_frames = len(frames)
        results = []

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(self.analyze_frame, f): f for f in frames}

            for i, future in enumerate(futures):
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    print(f"Error analyzing frame: {e}")

                if progress_callback:
                    progress_callback(i + 1, total_frames)

        # Sort by frame index
        results.sort(key=lambda x: x.frame_index)
        return results

# Usage
analyzer = VideoAnalyzer(processor)

def progress(current, total):
    print(f"Progress: {current}/{total} frames")

results = analyzer.analyze_video("video.mp4", progress_callback=progress)
```

## Object Tracking Across Frames

```python
from collections import defaultdict
from typing import Dict, Tuple

@dataclass
class TrackedObject:
    id: str
    label: str
    appearances: List[dict]  # frame_index, timestamp, box

class ObjectTracker:
    def __init__(self, iou_threshold: float = 0.5):
        self.iou_threshold = iou_threshold
        self.tracked_objects: Dict[str, TrackedObject] = {}
        self.next_id = 0

    def _compute_iou(self, box1: dict, box2: dict) -> float:
        """Compute Intersection over Union"""
        x1 = max(box1["x"], box2["x"])
        y1 = max(box1["y"], box2["y"])
        x2 = min(box1["x"] + box1["width"], box2["x"] + box2["width"])
        y2 = min(box1["y"] + box1["height"], box2["y"] + box2["height"])

        if x2 < x1 or y2 < y1:
            return 0.0

        intersection = (x2 - x1) * (y2 - y1)
        area1 = box1["width"] * box1["height"]
        area2 = box2["width"] * box2["height"]
        union = area1 + area2 - intersection

        return intersection / union if union > 0 else 0.0

    def _get_object_id(self) -> str:
        obj_id = f"obj_{self.next_id}"
        self.next_id += 1
        return obj_id

    def track_objects(self, frame_analyses: List[FrameAnalysis]) -> Dict[str, TrackedObject]:
        """Track objects across frames"""
        self.tracked_objects = {}
        self.next_id = 0
        active_tracks: Dict[str, dict] = {}  # id -> last_box, label

        for analysis in frame_analyses:
            frame_objects = analysis.objects
            matched_ids = set()

            # Match current objects to existing tracks
            for obj in frame_objects:
                best_match_id = None
                best_iou = self.iou_threshold

                for track_id, track_info in active_tracks.items():
                    if track_info["label"] == obj["name"]:
                        iou = self._compute_iou(obj["box"], track_info["box"])
                        if iou > best_iou:
                            best_iou = iou
                            best_match_id = track_id

                if best_match_id:
                    # Update existing track
                    matched_ids.add(best_match_id)
                    self.tracked_objects[best_match_id].appearances.append({
                        "frame_index": analysis.frame_index,
                        "timestamp": analysis.timestamp,
                        "box": obj["box"]
                    })
                    active_tracks[best_match_id]["box"] = obj["box"]
                else:
                    # Create new track
                    new_id = self._get_object_id()
                    self.tracked_objects[new_id] = TrackedObject(
                        id=new_id,
                        label=obj["name"],
                        appearances=[{
                            "frame_index": analysis.frame_index,
                            "timestamp": analysis.timestamp,
                            "box": obj["box"]
                        }]
                    )
                    active_tracks[new_id] = {
                        "label": obj["name"],
                        "box": obj["box"]
                    }

            # Remove tracks that weren't matched (object left frame)
            unmatched = set(active_tracks.keys()) - matched_ids
            for track_id in unmatched:
                # Keep for potential re-identification, but could remove
                pass

        return self.tracked_objects

    def get_object_timeline(self, obj_id: str) -> List[Tuple[float, float]]:
        """Get timeline of when object was visible"""
        if obj_id not in self.tracked_objects:
            return []

        appearances = self.tracked_objects[obj_id].appearances
        if not appearances:
            return []

        timeline = []
        start_time = appearances[0]["timestamp"]
        prev_time = start_time

        for app in appearances[1:]:
            # If gap is too large, start new segment
            if app["timestamp"] - prev_time > 2.0:  # 2 second gap
                timeline.append((start_time, prev_time))
                start_time = app["timestamp"]
            prev_time = app["timestamp"]

        timeline.append((start_time, prev_time))
        return timeline

# Usage
tracker = ObjectTracker(iou_threshold=0.3)
tracked = tracker.track_objects(results)

for obj_id, obj in tracked.items():
    print(f"{obj_id}: {obj.label}, appeared in {len(obj.appearances)} frames")
    timeline = tracker.get_object_timeline(obj_id)
    for start, end in timeline:
        print(f"  Visible: {start:.1f}s - {end:.1f}s")
```

## Scene Change Detection

```python
class SceneDetector:
    def __init__(self, similarity_threshold: float = 0.7):
        self.similarity_threshold = similarity_threshold

    def detect_scene_changes(
        self,
        frame_analyses: List[FrameAnalysis]
    ) -> List[dict]:
        """Detect scene changes based on caption and tag differences"""
        scene_changes = []
        current_scene_start = 0

        for i in range(1, len(frame_analyses)):
            prev = frame_analyses[i-1]
            curr = frame_analyses[i]

            similarity = self._compute_similarity(prev, curr)

            if similarity < self.similarity_threshold:
                scene_changes.append({
                    "scene_index": len(scene_changes),
                    "start_time": frame_analyses[current_scene_start].timestamp,
                    "end_time": prev.timestamp,
                    "start_frame": current_scene_start,
                    "end_frame": i - 1,
                    "caption": prev.caption
                })
                current_scene_start = i

        # Add final scene
        if current_scene_start < len(frame_analyses):
            scene_changes.append({
                "scene_index": len(scene_changes),
                "start_time": frame_analyses[current_scene_start].timestamp,
                "end_time": frame_analyses[-1].timestamp,
                "start_frame": current_scene_start,
                "end_frame": len(frame_analyses) - 1,
                "caption": frame_analyses[-1].caption
            })

        return scene_changes

    def _compute_similarity(self, frame1: FrameAnalysis, frame2: FrameAnalysis) -> float:
        """Compute similarity between two frames based on tags"""
        tags1 = set(t["name"] for t in frame1.tags)
        tags2 = set(t["name"] for t in frame2.tags)

        if not tags1 or not tags2:
            return 0.0

        intersection = len(tags1 & tags2)
        union = len(tags1 | tags2)

        return intersection / union if union > 0 else 0.0

# Usage
detector = SceneDetector(similarity_threshold=0.5)
scenes = detector.detect_scene_changes(results)

print(f"Detected {len(scenes)} scenes:")
for scene in scenes:
    print(f"Scene {scene['scene_index']}: {scene['start_time']:.1f}s - {scene['end_time']:.1f}s")
    print(f"  Caption: {scene['caption']}")
```

## Video Summary Generation

```python
from openai import AzureOpenAI

class VideoSummarizer:
    def __init__(self):
        self.client = AzureOpenAI(
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
            api_version="2023-09-01-preview",
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT")
        )

    def generate_summary(
        self,
        frame_analyses: List[FrameAnalysis],
        scenes: List[dict]
    ) -> str:
        """Generate natural language summary of video"""
        # Build context from analysis
        scene_descriptions = []
        for scene in scenes:
            scene_frames = [
                f for f in frame_analyses
                if scene["start_frame"] <= f.frame_index <= scene["end_frame"]
            ]

            # Get unique objects in scene
            all_objects = set()
            for frame in scene_frames:
                for obj in frame.objects:
                    all_objects.add(obj["name"])

            # Get common tags
            all_tags = []
            for frame in scene_frames:
                all_tags.extend([t["name"] for t in frame.tags])
            common_tags = [t for t in set(all_tags) if all_tags.count(t) > len(scene_frames) * 0.3]

            scene_descriptions.append({
                "time": f"{scene['start_time']:.1f}s - {scene['end_time']:.1f}s",
                "caption": scene["caption"],
                "objects": list(all_objects),
                "tags": common_tags
            })

        # Generate summary with LLM
        context = f"""Analyze this video content and provide a comprehensive summary:

Video Analysis:
{self._format_scenes(scene_descriptions)}

Please provide:
1. A brief overview of the video content
2. Key moments and scenes
3. Main subjects/objects that appear
4. Overall narrative or flow of the video"""

        response = self.client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a video content analyst."},
                {"role": "user", "content": context}
            ],
            max_tokens=1000
        )

        return response.choices[0].message.content

    def _format_scenes(self, scenes: List[dict]) -> str:
        formatted = []
        for i, scene in enumerate(scenes):
            formatted.append(f"""
Scene {i+1} ({scene['time']}):
- Caption: {scene['caption']}
- Objects: {', '.join(scene['objects'])}
- Tags: {', '.join(scene['tags'])}""")
        return "\n".join(formatted)

# Usage
summarizer = VideoSummarizer()
summary = summarizer.generate_summary(results, scenes)
print(summary)
```

## Conclusion

Video analysis with Azure AI enables powerful content understanding at scale. By combining frame extraction, object detection, tracking, and scene detection, you can build sophisticated video intelligence applications. The integration with Azure OpenAI for summarization adds natural language understanding to the visual analysis, creating comprehensive video insights.
