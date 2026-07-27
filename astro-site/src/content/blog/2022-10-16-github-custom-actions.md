---
title: "Creating Custom GitHub Actions"
author: "Michael John Peña"
draft: false
date: 2022-10-16
tags: ["GitHub", "GitHub Actions", "JavaScript", "DevOps"]

---

I wrote "Creating Custom GitHub Actions" to share practical, production-minded guidance on this topic.

## JavaScript Action Structure

```javascript
// src/index.js
const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');

async function run() {
  try {
    const token = core.getInput('github-token', { required: true });
    const command = core.getInput('command', { required: true });

    const octokit = github.getOctokit(token);
    const context = github.context;

    core.info(`Running command: ${command}`);

    let output = '';
    await exec.exec(command, [], {
      listeners: {
        stdout: (data) => { output += data.toString(); }
      }
    });

    core.setOutput('result', output);

    // Create comment on PR
    if (context.eventName === 'pull_request') {
      await octokit.rest.issues.createComment({
        ...context.repo,
        issue_number: context.payload.pull_request.number,
        body: `Command output:\n\`\`\`\n${output}\n\`\`\``
      });
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
```

```yaml
# action.yml
name: 'Custom Command Runner'
description: 'Run commands and report results'
inputs:
  github-token:
    description: 'GitHub token'
    required: true
  command:
    description: 'Command to run'
    required: true
outputs:
  result:
    description: 'Command output'
runs:
  using: 'node16'
  main: 'dist/index.js'
```

```json
// package.json
{
  "name": "custom-action",
  "version": "1.0.0",
  "main": "src/index.js",
  "scripts": {
    "build": "ncc build src/index.js -o dist"
  },
  "dependencies": {
    "@actions/core": "^1.10.0",
    "@actions/github": "^5.1.1",
    "@actions/exec": "^1.1.1"
  },
  "devDependencies": {
    "@vercel/ncc": "^0.36.0"
  }
}
```

Custom actions enable sophisticated automation tailored to your specific workflows.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
