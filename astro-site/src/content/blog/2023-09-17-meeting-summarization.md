---
title: "Meeting Summarization with Azure AI"
author: Michael John Peña
draft: false
date: 2023-09-17
description: "Build intelligent meeting summarization solutions using Azure AI Speech and OpenAI services."
tags:
  - Azure
  - Meeting Summarization
  - AI
  - Speech
  - OpenAI

---

I wrote "Meeting Summarization with Azure AI" to share practical, production-minded guidance on this topic.

## Introduction

Meeting summarization combines speech recognition, speaker diarization, and language understanding to transform lengthy meetings into actionable summaries. Azure AI provides the building blocks to create comprehensive meeting intelligence solutions.

## Meeting Summarization Pipeline

### Architecture Overview

```python
from dataclasses import dataclass, field
from typing import List, Optional, Dict
from datetime import datetime, timedelta
from enum import Enum

class MeetingSegmentType(Enum):
    DISCUSSION = "discussion"
    DECISION = "decision"
    ACTION_ITEM = "action_item"
    QUESTION = "question"
    PRESENTATION = "presentation"

@dataclass
class Speaker:
    id: str
    name: Optional[str] = None
    role: Optional[str] = None

@dataclass
class TranscriptSegment:
    speaker: Speaker
    text: str
    start_time: float
    end_time: float
    segment_type: Optional[MeetingSegmentType] = None

@dataclass
class ActionItem:
    description: str
    assignee: Optional[str]
    due_date: Optional[str]
    priority: str = "medium"

@dataclass
class Decision:
    description: str
    made_by: List[str]
    timestamp: float

@dataclass
class MeetingSummary:
    title: str
    date: datetime
    duration_minutes: float
    participants: List[Speaker]
    executive_summary: str
    key_topics: List[str]
    decisions: List[Decision]
    action_items: List[ActionItem]
    transcript_segments: List[TranscriptSegment]
    questions_raised: List[str]
    next_steps: List[str]
```

### Speech-to-Text with Diarization

```python
import os
import azure.cognitiveservices.speech as speechsdk
import time

class MeetingTranscriber:
    def __init__(self):
        self.speech_config = speechsdk.SpeechConfig(
            subscription=os.getenv("AZURE_SPEECH_KEY"),
            region=os.getenv("AZURE_SPEECH_REGION")
        )
        self.speech_config.speech_recognition_language = "en-US"
        self.speech_config.set_property(
            speechsdk.PropertyId.SpeechServiceResponse_DiarizeIntermediateResults,
            "true"
        )

    def transcribe_meeting(
        self,
        audio_file: str,
        expected_speakers: int = 2
    ) -> List[TranscriptSegment]:
        """Transcribe meeting with speaker diarization"""
        audio_config = speechsdk.AudioConfig(filename=audio_file)

        conversation_transcriber = speechsdk.transcription.ConversationTranscriber(
            speech_config=self.speech_config,
            audio_config=audio_config
        )

        segments = []
        done = False

        def handle_transcribed(evt):
            if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
                segment = TranscriptSegment(
                    speaker=Speaker(id=evt.result.speaker_id),
                    text=evt.result.text,
                    start_time=evt.result.offset / 10_000_000,  # Convert to seconds
                    end_time=(evt.result.offset + evt.result.duration) / 10_000_000
                )
                segments.append(segment)
                print(f"[{segment.speaker.id}] {segment.text[:50]}...")

        def handle_canceled(evt):
            nonlocal done
            done = True

        def handle_stopped(evt):
            nonlocal done
            done = True

        conversation_transcriber.transcribed.connect(handle_transcribed)
        conversation_transcriber.canceled.connect(handle_canceled)
        conversation_transcriber.session_stopped.connect(handle_stopped)

        conversation_transcriber.start_transcribing_async()

        while not done:
            time.sleep(0.5)

        conversation_transcriber.stop_transcribing_async()

        return segments

    def identify_speakers(
        self,
        segments: List[TranscriptSegment],
        speaker_names: Dict[str, str] = None
    ) -> List[TranscriptSegment]:
        """Map speaker IDs to names if provided"""
        if not speaker_names:
            # Generate default names
            unique_speakers = set(seg.speaker.id for seg in segments)
            speaker_names = {
                sid: f"Speaker {i+1}"
                for i, sid in enumerate(sorted(unique_speakers))
            }

        for segment in segments:
            if segment.speaker.id in speaker_names:
                segment.speaker.name = speaker_names[segment.speaker.id]

        return segments

# Usage
transcriber = MeetingTranscriber()
segments = transcriber.transcribe_meeting("meeting_recording.wav")
segments = transcriber.identify_speakers(segments, {
    "Guest-1": "John Smith",
    "Guest-2": "Jane Doe"
})
```

### AI-Powered Summary Generation

```python
from openai import AzureOpenAI
import json

class MeetingSummarizer:
    def __init__(self):
        self.client = AzureOpenAI(
            api_key=os.getenv("AZURE_OPENAI_API_KEY"),
            api_version="2023-09-01-preview",
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT")
        )

    def generate_summary(
        self,
        segments: List[TranscriptSegment],
        meeting_title: str = "Team Meeting"
    ) -> MeetingSummary:
        """Generate comprehensive meeting summary"""
        # Format transcript for LLM
        transcript_text = self._format_transcript(segments)

        # Generate summary using GPT-4
        summary_response = self._generate_executive_summary(transcript_text)
        action_items = self._extract_action_items(transcript_text)
        decisions = self._extract_decisions(transcript_text)
        topics = self._extract_key_topics(transcript_text)
        questions = self._extract_questions(transcript_text)

        # Calculate duration
        if segments:
            duration = (segments[-1].end_time - segments[0].start_time) / 60
        else:
            duration = 0

        # Get unique participants
        participants = list({seg.speaker.id: seg.speaker for seg in segments}.values())

        return MeetingSummary(
            title=meeting_title,
            date=datetime.now(),
            duration_minutes=duration,
            participants=participants,
            executive_summary=summary_response,
            key_topics=topics,
            decisions=decisions,
            action_items=action_items,
            transcript_segments=segments,
            questions_raised=questions,
            next_steps=self._extract_next_steps(transcript_text)
        )

    def _format_transcript(self, segments: List[TranscriptSegment]) -> str:
        """Format transcript for LLM processing"""
        formatted = []
        for seg in segments:
            speaker_name = seg.speaker.name or seg.speaker.id
            time_str = f"{int(seg.start_time // 60):02d}:{int(seg.start_time % 60):02d}"
            formatted.append(f"[{time_str}] {speaker_name}: {seg.text}")
        return "\n".join(formatted)

    def _generate_executive_summary(self, transcript: str) -> str:
        """Generate executive summary"""
        prompt = f"""Analyze this meeting transcript and provide a concise executive summary (2-3 paragraphs).
Focus on the main purpose, key discussions, and outcomes.

Transcript:
{transcript}

Executive Summary:"""

        response = self.client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a professional meeting analyst."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=500,
            temperature=0.3
        )

        return response.choices[0].message.content

    def _extract_action_items(self, transcript: str) -> List[ActionItem]:
        """Extract action items from transcript"""
        prompt = f"""Extract all action items from this meeting transcript.
For each action item, identify:
- Description of the task
- Person assigned (if mentioned)
- Due date (if mentioned)
- Priority (high/medium/low based on urgency discussed)

Return as JSON array with fields: description, assignee, due_date, priority

Transcript:
{transcript}

Action Items JSON:"""

        response = self.client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You extract action items from meetings. Return only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=1000,
            temperature=0.1
        )

        try:
            items_data = json.loads(response.choices[0].message.content)
            return [ActionItem(**item) for item in items_data]
        except (json.JSONDecodeError, TypeError):
            return []

    def _extract_decisions(self, transcript: str) -> List[Decision]:
        """Extract decisions made during meeting"""
        prompt = f"""Extract all decisions made during this meeting.
For each decision, identify:
- What was decided
- Who made or agreed to the decision

Return as JSON array with fields: description, made_by (array of names)

Transcript:
{transcript}

Decisions JSON:"""

        response = self.client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You extract decisions from meetings. Return only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=500,
            temperature=0.1
        )

        try:
            decisions_data = json.loads(response.choices[0].message.content)
            return [Decision(
                description=d["description"],
                made_by=d["made_by"],
                timestamp=0
            ) for d in decisions_data]
        except (json.JSONDecodeError, TypeError):
            return []

    def _extract_key_topics(self, transcript: str) -> List[str]:
        """Extract main topics discussed"""
        prompt = f"""List the main topics discussed in this meeting (5-10 bullet points).

Transcript:
{transcript}

Topics (one per line):"""

        response = self.client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
            temperature=0.3
        )

        topics = response.choices[0].message.content.strip().split("\n")
        return [t.lstrip("- •").strip() for t in topics if t.strip()]

    def _extract_questions(self, transcript: str) -> List[str]:
        """Extract questions raised during meeting"""
        prompt = f"""List any important questions raised during this meeting that may need follow-up.

Transcript:
{transcript}

Questions (one per line):"""

        response = self.client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
            temperature=0.3
        )

        questions = response.choices[0].message.content.strip().split("\n")
        return [q.lstrip("- •?").strip() for q in questions if q.strip()]

    def _extract_next_steps(self, transcript: str) -> List[str]:
        """Extract next steps and follow-ups"""
        prompt = f"""Based on this meeting, list the recommended next steps or follow-up items.

Transcript:
{transcript}

Next Steps (one per line):"""

        response = self.client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
            temperature=0.3
        )

        steps = response.choices[0].message.content.strip().split("\n")
        return [s.lstrip("- •0123456789.").strip() for s in steps if s.strip()]

# Usage
summarizer = MeetingSummarizer()
summary = summarizer.generate_summary(segments, "Weekly Team Standup")
```

### Report Generation

```python
class MeetingReportGenerator:
    """Generate formatted meeting reports"""

    def generate_markdown_report(self, summary: MeetingSummary) -> str:
        """Generate Markdown report"""
        report = f"""# {summary.title}

**Date:** {summary.date.strftime('%B %d, %Y')}
**Duration:** {summary.duration_minutes:.0f} minutes
**Participants:** {', '.join(p.name or p.id for p in summary.participants)}

## Executive Summary

{summary.executive_summary}

## Key Topics Discussed

{self._format_list(summary.key_topics)}

## Decisions Made

{self._format_decisions(summary.decisions)}

## Action Items

{self._format_action_items(summary.action_items)}

## Questions for Follow-up

{self._format_list(summary.questions_raised)}

## Next Steps

{self._format_list(summary.next_steps)}


