---
title: "Tracing and Debugging LLM Applications"
author: Michael John Peña
draft: false
date: 2023-10-07
description: "Advanced techniques for tracing and debugging complex LLM applications in production."
tags:
  - LLM Debugging
  - Tracing
  - Observability
  - Production
  - AI
---

## Introduction

Debugging LLM applications presents unique challenges due to their non-deterministic nature and complex chain of operations. This post covers advanced tracing and debugging techniques for production LLM systems.

## Comprehensive Tracing Strategy

### Multi-Level Tracing

```python
import logging
import json
from datetime import datetime
from typing import Any, Dict, Optional
from dataclasses import dataclass, asdict
from contextlib import contextmanager
import uuid

@dataclass
class TraceSpan:
    trace_id: str
    span_id: str
    parent_id: Optional[str]
    name: str
    start_time: datetime
    end_time: Optional[datetime] = None
    status: str = "running"
    inputs: Optional[Dict] = None
    outputs: Optional[Dict] = None
    error: Optional[str] = None
    metadata: Optional[Dict] = None

class LLMTracer:
    """Comprehensive tracer for LLM applications"""

    def __init__(self):
        self.spans: Dict[str, TraceSpan] = {}
        self.current_trace_id: Optional[str] = None
        self.span_stack: list = []
        self.logger = logging.getLogger(__name__)

    @contextmanager
    def trace(self, name: str, inputs: Dict = None, metadata: Dict = None):
        """Context manager for tracing operations"""
        # Create or continue trace
        if not self.current_trace_id:
            self.current_trace_id = str(uuid.uuid4())

        # Create span
        span = TraceSpan(
            trace_id=self.current_trace_id,
            span_id=str(uuid.uuid4()),
            parent_id=self.span_stack[-1] if self.span_stack else None,
            name=name,
            start_time=datetime.now(),
            inputs=inputs,
            metadata=metadata
        )

        self.spans[span.span_id] = span
        self.span_stack.append(span.span_id)

        self.logger.info(f"[TRACE] Started: {name} (span={span.span_id[:8]})")

        try:
            yield span
            span.status = "success"
        except Exception as e:
            span.status = "error"
            span.error = str(e)
            self.logger.error(f"[TRACE] Error in {name}: {e}")
            raise
        finally:
            span.end_time = datetime.now()
            self.span_stack.pop()

            duration_ms = (span.end_time - span.start_time).total_seconds() * 1000
            self.logger.info(f"[TRACE] Completed: {name} ({duration_ms:.0f}ms) - {span.status}")

            if not self.span_stack:
                self.current_trace_id = None

    def set_output(self, span: TraceSpan, outputs: Dict):
        """Set outputs for a span"""
        span.outputs = outputs

    def get_trace(self, trace_id: str) -> list:
        """Get all spans for a trace"""
        return [s for s in self.spans.values() if s.trace_id == trace_id]

    def export_trace(self, trace_id: str) -> str:
        """Export trace as JSON"""
        spans = self.get_trace(trace_id)
        return json.dumps([asdict(s) for s in spans], default=str, indent=2)

# Usage
tracer = LLMTracer()

def process_query(query: str) -> str:
    with tracer.trace("process_query", inputs={"query": query}) as span:
        # Step 1: Retrieve context
        with tracer.trace("retrieve_context") as retrieve_span:
            context = retrieve_documents(query)
            tracer.set_output(retrieve_span, {"doc_count": len(context)})

        # Step 2: Generate response
        with tracer.trace("generate_response") as gen_span:
            response = generate_with_context(query, context)
            tracer.set_output(gen_span, {"response_length": len(response)})

        tracer.set_output(span, {"response": response[:100]})
        return response
```

### Distributed Tracing

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

# Set up OpenTelemetry
provider = TracerProvider()
processor = BatchSpanProcessor(OTLPSpanExporter(endpoint="http://localhost:4317"))
provider.add_span_processor(processor)
trace.set_tracer_provider(provider)

tracer = trace.get_tracer(__name__)

class DistributedLLMTracer:
    """Distributed tracing for microservices architecture"""

    def __init__(self):
        self.tracer = trace.get_tracer(__name__)

    def trace_llm_call(self, func):
        """Decorator for tracing LLM calls"""
        def wrapper(*args, **kwargs):
            with self.tracer.start_as_current_span(
                func.__name__,
                attributes={
                    "llm.model": kwargs.get("model", "unknown"),
                    "llm.provider": "openai"
                }
            ) as span:
                try:
                    result = func(*args, **kwargs)
                    span.set_attribute("llm.token_count", len(str(result)) // 4)
                    return result
                except Exception as e:
                    span.record_exception(e)
                    span.set_status(trace.Status(trace.StatusCode.ERROR, str(e)))
                    raise
        return wrapper

# Usage
distributed_tracer = DistributedLLMTracer()

@distributed_tracer.trace_llm_call
def call_openai(prompt: str, model: str = "gpt-4"):
    # LLM call implementation
    pass
```

## Debugging Techniques

### Input/Output Logging

```python
from functools import wraps
import hashlib

class DebugLogger:
    """Detailed debug logging for LLM operations"""

    def __init__(self, log_dir: str = "./debug_logs"):
        self.log_dir = log_dir
        self.logger = logging.getLogger("llm_debug")
        os.makedirs(log_dir, exist_ok=True)

    def log_io(self, name: str):
        """Decorator to log inputs and outputs"""
        def decorator(func):
            @wraps(func)
            def wrapper(*args, **kwargs):
                # Generate unique call ID
                call_id = hashlib.md5(
                    f"{name}{args}{kwargs}{datetime.now()}".encode()
                ).hexdigest()[:8]

                # Log inputs
                input_log = {
                    "call_id": call_id,
                    "function": name,
                    "timestamp": datetime.now().isoformat(),
                    "args": str(args)[:1000],
                    "kwargs": {k: str(v)[:500] for k, v in kwargs.items()}
                }
                self.logger.debug(f"INPUT [{call_id}]: {json.dumps(input_log)}")

                try:
                    result = func(*args, **kwargs)

                    # Log outputs
                    output_log = {
                        "call_id": call_id,
                        "status": "success",
                        "output_preview": str(result)[:1000],
                        "output_type": type(result).__name__
                    }
                    self.logger.debug(f"OUTPUT [{call_id}]: {json.dumps(output_log)}")

                    return result

                except Exception as e:
                    error_log = {
                        "call_id": call_id,
                        "status": "error",
                        "error_type": type(e).__name__,
                        "error_message": str(e)
                    }
                    self.logger.error(f"ERROR [{call_id}]: {json.dumps(error_log)}")
                    raise

            return wrapper
        return decorator

    def save_debug_snapshot(self, name: str, data: dict):
        """Save debug snapshot to file"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{self.log_dir}/{name}_{timestamp}.json"
        with open(filename, "w") as f:
            json.dump(data, f, indent=2, default=str)
        return filename

# Usage
debug_logger = DebugLogger()

@debug_logger.log_io("generate_response")
def generate_response(prompt: str, context: str) -> str:
    # Implementation
    pass
```

### Prompt Debugging

```python
class PromptDebugger:
    """Debug and analyze prompts"""

    def __init__(self):
        self.prompt_history = []

    def debug_prompt(self, template: str, variables: dict) -> dict:
        """Analyze a prompt before sending"""
        # Render the prompt
        rendered = template.format(**variables)

        # Analyze
        analysis = {
            "template_length": len(template),
            "rendered_length": len(rendered),
            "variable_count": len(variables),
            "variables": list(variables.keys()),
            "estimated_tokens": len(rendered) // 4,
            "contains_examples": "example" in rendered.lower(),
            "has_instructions": any(
                word in rendered.lower()
                for word in ["you are", "you must", "always", "never"]
            ),
            "rendered_preview": rendered[:500] + "..." if len(rendered) > 500 else rendered
        }

        self.prompt_history.append({
            "timestamp": datetime.now().isoformat(),
            "analysis": analysis
        })

        return analysis

    def compare_prompts(self, prompt1: str, prompt2: str) -> dict:
        """Compare two prompts"""
        words1 = set(prompt1.lower().split())
        words2 = set(prompt2.lower().split())

        return {
            "length_diff": len(prompt2) - len(prompt1),
            "word_count_diff": len(words2) - len(words1),
            "common_words": len(words1 & words2),
            "unique_to_prompt1": list(words1 - words2)[:20],
            "unique_to_prompt2": list(words2 - words1)[:20],
            "similarity": len(words1 & words2) / len(words1 | words2)
        }

    def suggest_improvements(self, prompt: str) -> list:
        """Suggest prompt improvements"""
        suggestions = []

        if len(prompt) > 4000:
            suggestions.append("Prompt is long. Consider summarizing or chunking.")

        if "you are" not in prompt.lower():
            suggestions.append("Consider adding a role/persona (e.g., 'You are an expert...')")

        if prompt.count("example") == 0:
            suggestions.append("Consider adding few-shot examples")

        if prompt.count("\n") < 3:
            suggestions.append("Consider using more structure with line breaks")

        return suggestions

# Usage
debugger = PromptDebugger()
analysis = debugger.debug_prompt(
    "You are {role}. Answer this question: {question}",
    {"role": "an expert", "question": "What is AI?"}
)
```

### Response Validation

```python
from typing import Callable, List

class ResponseValidator:
    """Validate LLM responses"""

    def __init__(self):
        self.validators: List[Callable] = []
        self.validation_history = []

    def add_validator(self, validator: Callable, name: str):
        """Add a validation function"""
        self.validators.append({"func": validator, "name": name})

    def validate(self, response: str, context: dict = None) -> dict:
        """Run all validators on response"""
        results = {
            "valid": True,
            "checks": [],
            "response_length": len(response)
        }

        for validator in self.validators:
            try:
                passed = validator["func"](response, context or {})
                results["checks"].append({
                    "name": validator["name"],
                    "passed": passed
                })
                if not passed:
                    results["valid"] = False
            except Exception as e:
                results["checks"].append({
                    "name": validator["name"],
                    "passed": False,
                    "error": str(e)
                })
                results["valid"] = False

        self.validation_history.append({
            "timestamp": datetime.now().isoformat(),
            "results": results
        })

        return results

# Define validators
def not_empty(response: str, context: dict) -> bool:
    return len(response.strip()) > 0

def no_hallucination_markers(response: str, context: dict) -> bool:
    hallucination_phrases = [
        "I don't have access to",
        "I cannot verify",
        "As an AI"
    ]
    return not any(phrase in response for phrase in hallucination_phrases)

def contains_expected_format(response: str, context: dict) -> bool:
    if context.get("expected_format") == "json":
        try:
            json.loads(response)
            return True
        except:
            return False
    return True

# Usage
validator = ResponseValidator()
validator.add_validator(not_empty, "not_empty")
validator.add_validator(no_hallucination_markers, "no_hallucination")
validator.add_validator(contains_expected_format, "format_check")

result = validator.validate(
    response="Here is the answer...",
    context={"expected_format": "text"}
)
```

## Production Debugging Tools

### Live Debug Mode

```python
class LiveDebugger:
    """Enable live debugging in production"""

    def __init__(self):
        self.debug_enabled = False
        self.debug_requests = set()

    def enable_for_request(self, request_id: str):
        """Enable debugging for specific request"""
        self.debug_requests.add(request_id)

    def should_debug(self, request_id: str) -> bool:
        """Check if debugging is enabled"""
        return self.debug_enabled or request_id in self.debug_requests

    def debug_wrapper(self, func):
        """Wrapper that enables detailed debugging"""
        @wraps(func)
        def wrapper(request_id: str, *args, **kwargs):
            if self.should_debug(request_id):
                # Enable detailed logging
                logging.getLogger().setLevel(logging.DEBUG)

                # Capture all intermediate results
                debug_data = {"steps": []}

                # Wrap internal calls
                original_invoke = chain.invoke
                def traced_invoke(*a, **kw):
                    result = original_invoke(*a, **kw)
                    debug_data["steps"].append({
                        "input": str(a)[:500],
                        "output": str(result)[:500]
                    })
                    return result

                chain.invoke = traced_invoke

                try:
                    result = func(request_id, *args, **kwargs)
                    debug_data["final_result"] = str(result)[:1000]
                    return result, debug_data
                finally:
                    chain.invoke = original_invoke
            else:
                return func(request_id, *args, **kwargs)
        return wrapper

# Usage
live_debugger = LiveDebugger()

# Enable debugging for specific problematic request
live_debugger.enable_for_request("problem-request-123")
```

## Conclusion

Effective tracing and debugging of LLM applications requires a multi-layered approach: comprehensive tracing infrastructure, detailed logging, prompt analysis, response validation, and production debugging tools. By implementing these techniques, you can quickly identify and resolve issues in complex LLM systems.
