---
title: "Turning Call Recordings into Data with Azure AI Speech and GPT-4o"
description: "A batch pipeline for call and meeting audio: Azure AI Speech transcription with diarization, then GPT-4o structured outputs into rows you can query."
author: Michael John Peña
draft: false
date: 2025-01-30
tags:
  - Azure AI Speech
  - Speech Recognition
  - Azure OpenAI
  - Audio
  - Python
---

Most organisations are sitting on thousands of hours of recorded calls and meetings that nobody will ever listen to again. The audio is kept for compliance, but nobody can query it, so questions like "why are customers calling about billing this month?" get answered by gut feel. Speech-to-text and large language models are now cheap and accurate enough to change that, but only if you treat audio as a data engineering problem rather than a demo.

This post is about that pipeline: getting recordings out of storage and into tables you can report on. If you want live captions or a voice assistant, that's a different design, and I've covered the real-time side in [real-time transcription with Azure AI Speech](/blog/2023-09-16-real-time-transcription/) and [voice applications with Azure OpenAI](/blog/2024-05-03-gpt4o-realtime-voice/).

## Pick the transcription mode before you write any code

Azure AI Speech (the service formerly sold as Cognitive Services Speech) gives you three ways to turn audio into text, and the choice shapes everything downstream. As of January 2025 all three are generally available.

| Mode | How it works | Use it for | Don't use it for |
|---|---|---|---|
| Real-time (Speech SDK) | Streams audio, returns results as people speak | Live captions, agent assist, voice UIs | Backfilling an archive of recordings |
| Fast transcription (REST) | Synchronous call, returns the full transcript faster than the audio's duration | One file you need now, such as a voicemail or a just-finished meeting | Thousands of files on a schedule |
| Batch transcription (REST) | Asynchronous job over files in Blob Storage; results are written back as JSON | Nightly loads, archive backfills, analytics | Anything a user is waiting on |

[Fast transcription reached GA in November 2024](https://learn.microsoft.com/azure/ai-services/speech-service/fast-transcription-create) with speech to text REST API version `2024-11-15`, which is also the current GA version for batch. Real-time diarization in the Speech SDK has been GA since April 2024. Fast transcription has firm limits: each file must be under 2 hours and under 200 MB. It does support diarization (set `maxSpeakers`), but anything longer or larger has to go through batch, which accepts files up to 1 GB.

My default for analytics is batch. Batch is billed at a lower rate per audio hour than real-time transcription (see the [Speech pricing page](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/)), it reads straight from a storage container, and nobody is waiting on it. The trade-off is latency you don't control: jobs are scheduled best-effort and can sit in the queue at peak times. If a business process needs a transcript within minutes of a call ending, use fast transcription for that path and keep batch for the bulk.

One trap I see in a lot of sample code: calling `recognize_once()` on a file with the Speech SDK. It returns a single utterance, ending at the first silence or after at most 15 seconds of audio. It's fine for a voice command and wrong for a 20-minute call.

## Know your audio before you choose diarization

Diarization (working out who spoke when) is what turns a wall of text into a conversation you can analyse. How you get it depends on how the audio was recorded.

- **Stereo call recordings** from most contact centre platforms put the agent on one channel and the customer on the other. You don't need diarization at all: batch transcribes channels `0` and `1` separately by default, and the channel number tells you who spoke. This is more reliable than any model's guess.
- **Mono recordings** of meetings or calls need diarization. In batch, set `diarizationEnabled` to `true` for two speakers, and add the `diarization` property with a minimum and maximum speaker count when you expect three or more. Diarized files are limited to 240 minutes each. The [batch transcription property reference](https://learn.microsoft.com/azure/ai-services/speech-service/batch-transcription-create) covers both properties and the channel defaults.

Speaker labels from diarization are anonymous (`1`, `2`, and so on). Mapping "speaker 1" to "the agent" is your job, usually with a heuristic such as "whoever speaks first" or by letting the LLM infer roles in the next step. Be honest in your reports about which method you used.

## Submit and collect a batch job

The batch API needs your audio in Blob Storage and a SAS URL (or a managed identity on the Speech resource) so the service can read it. The script below submits a whole container, waits for the job, saves each raw result file locally, and flattens it into one row per phrase. It uses `requests` against REST API version `2024-11-15`, and retries on HTTP 429 because status and file-list calls are throttled when the service is busy.

```python
import os
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

REGION = os.environ["SPEECH_REGION"]  # for example "australiaeast"
HEADERS = {"Ocp-Apim-Subscription-Key": os.environ["SPEECH_KEY"]}
BASE_URL = f"https://{REGION}.api.cognitive.microsoft.com/speechtotext"
API_VERSION = "2024-11-15"
RAW_DIR = Path(os.environ.get("RAW_TRANSCRIPT_DIR", "raw-transcripts"))


def get_with_retry(url: str, headers: dict | None = None, timeout: int = 30, attempts: int = 6) -> requests.Response:
    """GET that backs off on HTTP 429, honouring Retry-After when the service sends it."""
    for attempt in range(attempts):
        resp = requests.get(url, headers=headers, timeout=timeout)
        if resp.status_code != 429:
            resp.raise_for_status()
            return resp
        retry_after = resp.headers.get("Retry-After", "")
        time.sleep(int(retry_after) if retry_after.isdigit() else 2 ** attempt * 5)
    resp.raise_for_status()
    return resp


def submit_batch(container_sas_url: str, locale: str = "en-AU") -> str:
    """Submit every audio file in a container and return the job URL."""
    body = {
        "displayName": "call-recordings-nightly",
        "locale": locale,
        "contentContainerUrl": container_sas_url,
        "properties": {
            "diarizationEnabled": True,  # mono, two-speaker recordings
            "punctuationMode": "DictatedAndAutomatic",
            "timeToLiveHours": 48,  # required in 2024-11-15
        },
    }
    resp = requests.post(
        f"{BASE_URL}/transcriptions:submit",
        params={"api-version": API_VERSION},
        headers=HEADERS,
        json=body,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["self"]


def wait_for_job(job_url: str, poll_seconds: int = 60, max_hours: int = 24) -> dict:
    deadline = time.monotonic() + max_hours * 3600
    while time.monotonic() < deadline:
        job = get_with_retry(job_url, headers=HEADERS).json()
        if job["status"] == "Succeeded":
            return job
        if job["status"] == "Failed":
            raise RuntimeError(f"Transcription failed: {job.get('properties', {}).get('error')}")
        time.sleep(poll_seconds)
    raise TimeoutError(f"Job did not finish within {max_hours} hours: {job_url}")


def result_file_urls(job: dict) -> list[str]:
    """Follow paging and return the contentUrl of every transcription file."""
    urls, next_url = [], job["links"]["files"]
    while next_url:
        page = get_with_retry(next_url, headers=HEADERS).json()
        urls += [f["links"]["contentUrl"] for f in page["values"] if f["kind"] == "Transcription"]
        next_url = page.get("@nextLink")
    return urls


def phrases(result_url: str) -> list[dict]:
    """Save the raw result file, then flatten it into one row per recognised phrase."""
    resp = get_with_retry(result_url, timeout=60)  # contentUrl is pre-signed
    result = resp.json()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    audio_name = Path(urlparse(result["source"]).path).name  # keyed on the recording
    (RAW_DIR / f"{audio_name}.json").write_bytes(resp.content)
    return [
        {
            "source": result["source"],
            "channel": p["channel"],
            "speaker": p.get("speaker"),  # present only when diarization is on
            "start_seconds": p["offsetInTicks"] / 10_000_000,
            "text": p["nBest"][0]["display"],
        }
        for p in result["recognizedPhrases"]
        if p.get("recognitionStatus") == "Success"
    ]


if __name__ == "__main__":
    job = wait_for_job(submit_batch(os.environ["AUDIO_CONTAINER_SAS_URL"]))
    for url in result_file_urls(job):
        rows = phrases(url)
        print(rows[0]["source"] if rows else url, len(rows), "phrases")
```

A few design notes that matter more than the code:

- **Land the raw JSON first.** `phrases()` writes each result file as-is before flattening it; in production, point that write at your lake (Blob Storage or OneLake) rather than a local folder. The result format includes word timings, confidence scores and n-best alternatives you'll want later, and re-transcribing costs money.
- **Use `timeToLiveHours`.** Version `2024-11-15` requires it (it is in the same property reference), and it stops completed jobs piling up in the service. Pair it with a `destinationContainerUrl` if you'd rather the results land straight in your own storage.
- **Don't poll faster than you need to.** Jobs routinely take minutes to hours. A Durable Function or a pipeline wait activity on a one-minute timer is plenty.
- **Accuracy is a domain problem.** Product names, suburbs and acronyms are where base models stumble. [Custom speech](https://learn.microsoft.com/azure/ai-services/speech-service/custom-speech-overview) models can be passed to batch via the `model` property; measure word error rate on a sample of your own audio before deciding you need one.

## From transcript to rows with structured outputs

A transcript is still unstructured text. The step that makes it useful for analytics is extracting the same fields from every call: reason for the call, outcome, sentiment, follow-ups. This is where an LLM earns its place, and where most sample code goes wrong by asking for "JSON" in the prompt and hoping.

Azure OpenAI's [structured outputs](https://learn.microsoft.com/azure/ai-services/openai/how-to/structured-outputs) constrain the model to a JSON schema you supply. It works with `gpt-4o` version `2024-08-06` and later, and it's in the `2024-10-21` GA API version. With the `openai` Python library (1.x) you can pass a Pydantic model directly:

```python
import os
from typing import Literal

from openai import AzureOpenAI
from pydantic import BaseModel


class CallRecord(BaseModel):
    reason_for_call: str
    outcome: Literal["resolved", "escalated", "follow_up_required", "unclear"]
    customer_sentiment: Literal["positive", "neutral", "negative"]
    products_mentioned: list[str]
    follow_up_actions: list[str]
    summary: str


client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2024-10-21",
)

SYSTEM_PROMPT = (
    "You extract facts from customer service call transcripts. "
    "Use only what is said in the transcript. If something isn't stated, "
    "use 'unclear' or an empty list rather than guessing."
)


def to_transcript(rows: list[dict]) -> str:
    """Render flattened phrases as 'Speaker 1 [mm:ss]: text' lines."""
    lines = []
    for r in sorted(rows, key=lambda r: r["start_seconds"]):
        who = f"Speaker {r['speaker']}" if r["speaker"] is not None else f"Channel {r['channel']}"
        minutes, seconds = divmod(int(r["start_seconds"]), 60)
        lines.append(f"{who} [{minutes:02d}:{seconds:02d}]: {r['text']}")
    return "\n".join(lines)


def extract_call_record(transcript: str) -> CallRecord:
    completion = client.beta.chat.completions.parse(
        model="<your-gpt-4o-deployment>",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": transcript},
        ],
        response_format=CallRecord,
        temperature=0,
    )
    message = completion.choices[0].message
    if message.refusal:
        raise ValueError(f"Model refused: {message.refusal}")
    return message.parsed
```

`to_transcript` takes the rows from `phrases()` above, so the two scripts chain together. Each `CallRecord` becomes one row keyed by the recording's source path, next to the phrase-level table. That gives you two grains: phrase rows for search and drill-through, call rows for dashboards.

Why I push structured outputs over prompt-only JSON: enums like `outcome` stay within the values your report expects, so a Power BI slicer doesn't suddenly show "Resolved (partially)". Schema changes become code changes you can review. And when the model refuses, you get an explicit `refusal` instead of a parse error in a scheduled run.

What I'd avoid is asking the model for a numeric "agent quality score". It will happily produce one, it won't be consistent between runs or model versions, and someone will eventually use it in a performance review. Extract observable facts (was the issue resolved, was a follow-up promised) and let people make the judgement.

## Where newer options fit

Two things announced recently are worth knowing about, but neither changes my default yet.

- **Azure AI Content Understanding**, announced at Ignite in November 2024, is in public preview. It wraps transcription and LLM field extraction for audio (along with documents, images and video) into one analyser with a schema. It's a promising shortcut for exactly this pipeline, but I wouldn't put a preview service under a production reporting feed.
- **`gpt-4o-audio-preview`** became available in Azure OpenAI this month, also in preview, and takes audio directly in chat completions. That removes a hop, but you lose the separate, timestamped, speaker-labelled transcript, which is the part auditors and analysts actually ask for.

The Whisper model is also an option: it's GA for batch transcription in Azure AI Speech and available in Azure OpenAI. I'd test it on audio with heavy accents or mixed languages, but note that it's display-only: you lose the lexical form, and you need `displayFormWordLevelTimestampsEnabled` rather than `wordLevelTimestampsEnabled` for word timings.

## When this is worth building

Build the batch pipeline when you have a steady volume of recordings and a question the business will keep asking: call drivers, complaint themes, compliance phrases, follow-up commitments. Start with transcription and land the raw JSON; that alone makes recordings searchable. Add LLM extraction for a small, fixed schema once you've read enough transcripts to know which fields matter.

Don't build it when the audio was recorded without the consent and notices your privacy obligations require. Transcripts of personal conversations are personal information, and turning them into searchable text widens who can see them. And don't build it to replace a QA team's listening. Use it to point them at the small share of calls worth hearing.
