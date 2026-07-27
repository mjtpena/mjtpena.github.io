---
title: "Debug Sessions for Cognitive Search Skillsets"
author: "Michael John Peña"
draft: false
date: 2022-08-29
tags: ["Azure", "Cognitive Search", "Debug Sessions", "Skillsets", "Development"]

---

I wrote "Debug Sessions for Cognitive Search Skillsets" to share practical, production-minded guidance on this topic.

## Understanding Debug Sessions

Debug sessions provide:
- Real-time skillset execution testing
- Step-through debugging of individual skills
- Input/output inspection at each stage
- Immediate feedback on changes

## Creating a Debug Session

```python
import requests
import json

def create_debug_session(endpoint, api_key, indexer_name, document_key=None):
    """Create a debug session for skillset testing"""

    url = f"{endpoint}/debugSessions?api-version=2021-04-30-Preview"
    headers = {
        "api-key": api_key,
        "Content-Type": "application/json"
    }

    body = {
        "name": f"debug-{indexer_name}",
        "indexerName": indexer_name,
        "storageConnectionString": storage_connection_string,  # For session data
    }

    if document_key:
        body["documentKey"] = document_key  # Debug specific document

    response = requests.post(url, headers=headers, json=body)
    return response.json()

# Create session
session = create_debug_session(endpoint, api_key, "my-indexer", "doc-123")
session_id = session["sessionId"]
print(f"Debug session created: {session_id}")
```

## Running Debug Session

```python
def run_debug_session(endpoint, api_key, session_id):
    """Execute the debug session"""

    url = f"{endpoint}/debugSessions/{session_id}/run?api-version=2021-04-30-Preview"
    headers = {"api-key": api_key}

    response = requests.post(url, headers=headers)
    return response.json()

def get_session_status(endpoint, api_key, session_id):
    """Get debug session status and results"""

    url = f"{endpoint}/debugSessions/{session_id}?api-version=2021-04-30-Preview"
    headers = {"api-key": api_key}

    response = requests.get(url, headers=headers)
    return response.json()

# Run and get results
run_debug_session(endpoint, api_key, session_id)

# Poll for completion
import time
while True:
    status = get_session_status(endpoint, api_key, session_id)
    if status["status"] in ["completed", "failed"]:
        break
    time.sleep(5)

print(f"Session status: {status['status']}")
```

## Inspecting Skill Execution

```python
def get_skill_execution_details(endpoint, api_key, session_id):
    """Get detailed execution info for each skill"""

    url = f"{endpoint}/debugSessions/{session_id}/executionInfo?api-version=2021-04-30-Preview"
    headers = {"api-key": api_key}

    response = requests.get(url, headers=headers)
    return response.json()

def analyze_skill_results(execution_info):
    """Analyze skill execution results"""

    for skill_result in execution_info.get("skillExecutionInfo", []):
        skill_name = skill_result.get("skillName")
        status = skill_result.get("status")
        duration = skill_result.get("durationMs")

        print(f"\nSkill: {skill_name}")
        print(f"  Status: {status}")
        print(f"  Duration: {duration}ms")

        # Check inputs
        inputs = skill_result.get("inputs", {})
        for input_name, input_value in inputs.items():
            value_preview = str(input_value)[:100] + "..." if len(str(input_value)) > 100 else str(input_value)
            print(f"  Input '{input_name}': {value_preview}")

        # Check outputs
        outputs = skill_result.get("outputs", {})
        for output_name, output_value in outputs.items():
            value_preview = str(output_value)[:100] + "..." if len(str(output_value)) > 100 else str(output_value)
            print(f"  Output '{output_name}': {value_preview}")

        # Check errors
        errors = skill_result.get("errors", [])
        for error in errors:
            print(f"  ERROR: {error.get('message')}")

# Analyze
execution_info = get_skill_execution_details(endpoint, api_key, session_id)
analyze_skill_results(execution_info)
```

## Testing Skill Changes

```python
def test_skill_change(endpoint, api_key, session_id, skill_definition):
    """Test a skill modification in debug session"""

    url = f"{endpoint}/debugSessions/{session_id}/skills?api-version=2021-04-30-Preview"
    headers = {
        "api-key": api_key,
        "Content-Type": "application/json"
    }

    response = requests.put(url, headers=headers, json=skill_definition)

    if response.status_code == 200:
        # Re-run session with new skill
        run_debug_session(endpoint, api_key, session_id)
        return get_skill_execution_details(endpoint, api_key, session_id)

    return None

# Test modified entity recognition skill
modified_skill = {
    "@odata.type": "#Microsoft.Skills.Text.V3.EntityRecognitionSkill",
    "name": "entity-recognition",
    "context": "/document",
    "categories": ["Person", "Organization", "Location", "DateTime", "Quantity"],  # Added categories
    "inputs": [
        {"name": "text", "source": "/document/content"}
    ],
    "outputs": [
        {"name": "persons", "targetName": "persons"},
        {"name": "organizations", "targetName": "organizations"},
        {"name": "locations", "targetName": "locations"},
        {"name": "dateTimes", "targetName": "dateTimes"},
        {"name": "quantities", "targetName": "quantities"}
    ]
}

result = test_skill_change(endpoint, api_key, session_id, modified_skill)
```

## Debugging Common Issues

```python
class SkillsetDebugger:
    """Helper class for debugging skillset issues"""

    def __init__(self, endpoint, api_key):
        self.endpoint = endpoint
        self.api_key = api_key

    def diagnose_empty_outputs(self, session_id):
        """Diagnose why skills produce empty outputs"""
        execution_info = get_skill_execution_details(
            self.endpoint, self.api_key, session_id
        )

        issues = []
        for skill in execution_info.get("skillExecutionInfo", []):
            outputs = skill.get("outputs", {})

            for output_name, output_value in outputs.items():
                if output_value is None or output_value == [] or output_value == "":
                    issues.append({
                        "skill": skill["skillName"],
                        "output": output_name,
                        "input_received": skill.get("inputs", {}),
                        "possible_causes": self._get_empty_output_causes(skill)
                    })

        return issues

    def _get_empty_output_causes(self, skill_result):
        """Identify possible causes for empty output"""
        causes = []

        # Check if input was empty
        inputs = skill_result.get("inputs", {})
        for input_name, input_value in inputs.items():
            if not input_value:
                causes.append(f"Empty input: {input_name}")

        # Check for truncation
        skill_name = skill_result.get("skillName", "")
        if "text" in skill_name.lower():
            causes.append("Text may be too short or in unsupported language")

        # Check for errors
        if skill_result.get("errors"):
            causes.append("Skill execution errors present")

        return causes

    def validate_skill_chain(self, session_id):
        """Validate that skill inputs/outputs chain correctly"""
        execution_info = get_skill_execution_details(
            self.endpoint, self.api_key, session_id
        )

        skills = execution_info.get("skillExecutionInfo", [])

        # Build output map
        available_outputs = {"/document": True}  # Root is always available

        issues = []
        for skill in skills:
            skill_name = skill["skillName"]

            # Check inputs are available
            for input_name, source in skill.get("inputMappings", {}).items():
                if source not in available_outputs:
                    issues.append({
                        "skill": skill_name,
                        "issue": f"Input '{input_name}' references unavailable source: {source}"
                    })

            # Add outputs to available
            for output_name in skill.get("outputs", {}).keys():
                context = skill.get("context", "/document")
                output_path = f"{context}/{output_name}"
                available_outputs[output_path] = True

        return issues

# Usage
debugger = SkillsetDebugger(endpoint, api_key)

# Diagnose empty outputs
empty_issues = debugger.diagnose_empty_outputs(session_id)
for issue in empty_issues:
    print(f"Empty output in {issue['skill']}.{issue['output']}")
    print(f"  Possible causes: {issue['possible_causes']}")

# Validate skill chain
chain_issues = debugger.validate_skill_chain(session_id)
for issue in chain_issues:
    print(f"Chain issue: {issue}")
```

## Cleanup

```python
def delete_debug_session(endpoint, api_key, session_id):
    """Delete debug session when done"""

    url = f"{endpoint}/debugSessions/{session_id}?api-version=2021-04-30-Preview"
    headers = {"api-key": api_key}

    response = requests.delete(url, headers=headers)
    return response.status_code == 204

# Clean up
delete_debug_session(endpoint, api_key, session_id)
```

Debug sessions are essential for developing and troubleshooting complex AI enrichment pipelines efficiently.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
