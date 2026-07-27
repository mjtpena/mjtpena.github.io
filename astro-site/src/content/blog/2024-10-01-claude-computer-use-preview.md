---
title: "Claude Computer Use Preview: AI That Can Control Your Desktop"
author: "Michael John Peña"
draft: false
date: 2024-10-01
tags: ["Anthropic", "Claude", "Computer Use", "AI Agents", "Automation"]

---

I wrote "Claude Computer Use Preview: AI That Can Control Your Desktop" to share practical, production-minded guidance on this topic.

## What is Computer Use?

Computer Use allows Claude to interact with graphical user interfaces through:
- **Screen capture**: Claude can see what's on screen
- **Mouse control**: Move, click, drag, and scroll
- **Keyboard input**: Type text and use keyboard shortcuts
- **Application interaction**: Work with any desktop application

```python
import anthropic

client = anthropic.Anthropic()

# Computer Use requires specific tool definitions
tools = [
    {
        "type": "computer_20241022",
        "name": "computer",
        "display_width_px": 1920,
        "display_height_px": 1080,
        "display_number": 0
    },
    {
        "type": "text_editor_20241022",
        "name": "str_replace_editor"
    },
    {
        "type": "bash_20241022",
        "name": "bash"
    }
]

response = client.beta.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=4096,
    tools=tools,
    messages=[
        {
            "role": "user",
            "content": "Open Firefox and search for 'Anthropic Claude' on Google"
        }
    ],
    betas=["computer-use-2024-10-22"]
)
```

## The Tool Definitions

```python
# Computer tool for GUI interaction
computer_tool = {
    "type": "computer_20241022",
    "name": "computer",
    "display_width_px": 1920,
    "display_height_px": 1080,
    "display_number": 0  # For multi-monitor setups
}

# Actions available:
# - mouse_move(x, y)
# - left_click()
# - right_click()
# - double_click()
# - drag(start_x, start_y, end_x, end_y)
# - type(text)
# - key(key_name)  # e.g., "Return", "Control+c"
# - screenshot()
# - scroll(direction)  # "up" or "down"

# Text editor tool for file editing
text_editor_tool = {
    "type": "text_editor_20241022",
    "name": "str_replace_editor"
}

# Bash tool for command execution
bash_tool = {
    "type": "bash_20241022",
    "name": "bash"
}
```

## Handling Computer Use Responses

```python
def handle_computer_use(response) -> dict:
    """Process Claude's computer use response"""

    result = {
        "actions": [],
        "needs_screenshot": False,
        "complete": False
    }

    for block in response.content:
        if block.type == "tool_use":
            if block.name == "computer":
                action = block.input.get("action")
                result["actions"].append({
                    "tool": "computer",
                    "action": action,
                    "params": block.input
                })

                # Computer actions usually need a screenshot after
                if action != "screenshot":
                    result["needs_screenshot"] = True

            elif block.name == "str_replace_editor":
                result["actions"].append({
                    "tool": "editor",
                    "command": block.input.get("command"),
                    "params": block.input
                })

            elif block.name == "bash":
                result["actions"].append({
                    "tool": "bash",
                    "command": block.input.get("command")
                })

        elif block.type == "text":
            if "completed" in block.text.lower() or "done" in block.text.lower():
                result["complete"] = True

    return result
```

## Building a Computer Use Loop

```python
import base64
from PIL import ImageGrab

def capture_screenshot() -> str:
    """Capture and encode screenshot"""
    screenshot = ImageGrab.grab()
    # Save to bytes
    import io
    buffer = io.BytesIO()
    screenshot.save(buffer, format="PNG")
    return base64.standard_b64encode(buffer.getvalue()).decode()

def execute_computer_action(action: dict):
    """Execute a computer action"""
    import pyautogui

    if action["action"] == "mouse_move":
        pyautogui.moveTo(action["coordinate"][0], action["coordinate"][1])

    elif action["action"] == "left_click":
        if "coordinate" in action:
            pyautogui.click(action["coordinate"][0], action["coordinate"][1])
        else:
            pyautogui.click()

    elif action["action"] == "type":
        pyautogui.write(action["text"])

    elif action["action"] == "key":
        pyautogui.hotkey(*action["text"].split("+"))

    elif action["action"] == "screenshot":
        return capture_screenshot()

    elif action["action"] == "scroll":
        direction = 1 if action["coordinate"][1] < 0 else -1
        pyautogui.scroll(direction * 3)

def computer_use_loop(task: str, max_iterations: int = 20):
    """Run computer use loop until task complete"""

    messages = [
        {"role": "user", "content": task}
    ]

    for iteration in range(max_iterations):
        # Get initial screenshot
        screenshot = capture_screenshot()

        # Add screenshot to messages
        messages.append({
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": screenshot
                    }
                }
            ]
        })

        # Get Claude's response
        response = client.beta.messages.create(
            model="claude-3-5-sonnet-20241022",
            max_tokens=4096,
            tools=tools,
            messages=messages,
            betas=["computer-use-2024-10-22"]
        )

        # Process response
        result = handle_computer_use(response)

        if result["complete"]:
            print(f"Task completed in {iteration + 1} iterations")
            return True

        # Execute actions
        for action in result["actions"]:
            if action["tool"] == "computer":
                execute_computer_action(action)

        # Add assistant response to conversation
        messages.append({"role": "assistant", "content": response.content})

    print("Max iterations reached")
    return False
```

## Safety Considerations

```python
class ComputerUseSafety:
    """Safety controls for computer use"""

    BLOCKED_ACTIONS = [
        "format",
        "delete system",
        "rm -rf",
        "shutdown",
        "reboot"
    ]

    SENSITIVE_AREAS = [
        {"name": "system_preferences", "x_range": (0, 100), "y_range": (0, 50)},
        {"name": "dock", "x_range": (0, 1920), "y_range": (1030, 1080)}
    ]

    @classmethod
    def check_action_safe(cls, action: dict) -> tuple[bool, str]:
        """Check if an action is safe to execute"""

        # Check for blocked commands
        if action.get("tool") == "bash":
            command = action.get("command", "").lower()
            for blocked in cls.BLOCKED_ACTIONS:
                if blocked in command:
                    return False, f"Blocked command: {blocked}"

        # Check for sensitive screen areas
        if action.get("tool") == "computer":
            coord = action.get("coordinate", [0, 0])
            for area in cls.SENSITIVE_AREAS:
                if (area["x_range"][0] <= coord[0] <= area["x_range"][1] and
                    area["y_range"][0] <= coord[1] <= area["y_range"][1]):
                    return False, f"Blocked area: {area['name']}"

        return True, "Action allowed"

    @classmethod
    def review_before_execute(cls, actions: list) -> list:
        """Filter actions for safety"""
        safe_actions = []
        for action in actions:
            is_safe, reason = cls.check_action_safe(action)
            if is_safe:
                safe_actions.append(action)
            else:
                print(f"Blocked action: {reason}")
        return safe_actions
```

## Use Cases

Computer Use opens up exciting possibilities:

1. **UI Testing**: Automate testing of any application
2. **Data Entry**: Fill forms across multiple applications
3. **Legacy Integration**: Interact with systems that lack APIs
4. **Process Automation**: Complete multi-step workflows
5. **Training Data Collection**: Record human-like interactions

Computer Use is a significant step toward truly autonomous AI agents. Use it responsibly with appropriate safety controls.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
