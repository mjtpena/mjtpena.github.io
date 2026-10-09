---
title: Building Video Calling Apps with Azure Communication Services
description: "Azure Communication Services launched late last year, and \"build your own video calling app on the same backbone as Teams\" is the pitch that makes it click…"
author: Michael John Pena
draft: false
date: 2021-01-17
url: /blog/azure-communication-services-video-calling/
tags:
  - Azure
  - Communication Services
  - Video Calling
  - WebRTC
  - Real-Time
---

Azure Communication Services launched late last year, and "build your own video calling app on the same backbone as Teams" is the pitch that makes it click for most clients. Today I'm walking through what it actually takes to ship a working video call—identity, token issuance, the JS calling SDK, and the gotchas that don't show up in the quickstart. Expect this to feel familiar if you've used Twilio Video; the difference is identity, billing, and Teams interop coming for free in the Microsoft ecosystem.

## Setting Up Azure Communication Services

First, create an Azure Communication Services resource in the Azure Portal. Once created, you will need the connection string for your application.

```bash
# Using Azure CLI to create the resource
az communication create \
    --name my-communication-service \
    --location global \
    --data-location unitedstates \
    --resource-group my-resource-group
```

## Backend: Generating Access Tokens

Users need access tokens to connect to ACS. Here is how to generate them using a Node.js backend:

```javascript
const { CommunicationIdentityClient } = require('@azure/communication-identity');

const connectionString = process.env.ACS_CONNECTION_STRING;
const identityClient = new CommunicationIdentityClient(connectionString);

async function createUserAndToken() {
    // Create a new user
    const user = await identityClient.createUser();
    console.log(`Created user with ID: ${user.communicationUserId}`);

    // Issue an access token with VoIP scope
    const tokenResponse = await identityClient.getToken(user, ["voip"]);

    return {
        userId: user.communicationUserId,
        token: tokenResponse.token,
        expiresOn: tokenResponse.expiresOn
    };
}

// Express endpoint
app.post('/api/token', async (req, res) => {
    try {
        const credentials = await createUserAndToken();
        res.json(credentials);
    } catch (error) {
        console.error('Error creating token:', error);
        res.status(500).json({ error: 'Failed to create token' });
    }
});
```

## Frontend: Implementing the Video Call

Here is a complete React component for video calling:

```jsx
import React, { useState, useEffect, useRef } from 'react';
import { CallClient, VideoStreamRenderer, LocalVideoStream } from '@azure/communication-calling';
import { AzureCommunicationTokenCredential } from '@azure/communication-common';

function VideoCall() {
    const [callAgent, setCallAgent] = useState(null);
    const [call, setCall] = useState(null);
    const [localVideoStream, setLocalVideoStream] = useState(null);
    const [isCallConnected, setIsCallConnected] = useState(false);

    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);

    useEffect(() => {
        initializeCallAgent();
    }, []);

    async function initializeCallAgent() {
        // Fetch token from backend
        const response = await fetch('/api/token', { method: 'POST' });
        const { token } = await response.json();

        const tokenCredential = new AzureCommunicationTokenCredential(token);
        const callClient = new CallClient();
        const agent = await callClient.createCallAgent(tokenCredential, {
            displayName: 'User Display Name'
        });

        setCallAgent(agent);

        // Set up incoming call handler
        agent.on('incomingCall', async (event) => {
            const incomingCall = event.incomingCall;
            const callerId = incomingCall.callerInfo.identifier;

            if (confirm(`Incoming call from ${callerId}. Accept?`)) {
                await acceptCall(incomingCall);
            } else {
                await incomingCall.reject();
            }
        });
    }

    async function startLocalVideo() {
        const deviceManager = await callClient.getDeviceManager();
        const cameras = await deviceManager.getCameras();

        if (cameras.length > 0) {
            const localStream = new LocalVideoStream(cameras[0]);
            setLocalVideoStream(localStream);

            const renderer = new VideoStreamRenderer(localStream);
            const view = await renderer.createView();
            localVideoRef.current.appendChild(view.target);
        }
    }

    async function startCall(targetUserId) {
        if (!callAgent) return;

        await startLocalVideo();

        const callOptions = {
            videoOptions: {
                localVideoStreams: localVideoStream ? [localVideoStream] : []
            },
            audioOptions: {
                muted: false
            }
        };

        const newCall = callAgent.startCall(
            [{ communicationUserId: targetUserId }],
            callOptions
        );

        setupCallListeners(newCall);
        setCall(newCall);
    }

    async function acceptCall(incomingCall) {
        await startLocalVideo();

        const callOptions = {
            videoOptions: {
                localVideoStreams: localVideoStream ? [localVideoStream] : []
            }
        };

        const acceptedCall = await incomingCall.accept(callOptions);
        setupCallListeners(acceptedCall);
        setCall(acceptedCall);
    }

    function setupCallListeners(activeCall) {
        activeCall.on('stateChanged', () => {
            setIsCallConnected(activeCall.state === 'Connected');
        });

        activeCall.on('remoteParticipantsUpdated', (event) => {
            event.added.forEach(participant => {
                subscribeToRemoteParticipant(participant);
            });
        });
    }

    function subscribeToRemoteParticipant(participant) {
        participant.on('videoStreamsUpdated', async (event) => {
            for (const stream of event.added) {
                if (stream.isAvailable) {
                    const renderer = new VideoStreamRenderer(stream);
                    const view = await renderer.createView();
                    remoteVideoRef.current.appendChild(view.target);
                }
            }
        });
    }

    async function hangUp() {
        if (call) {
            await call.hangUp();
            setCall(null);
            setIsCallConnected(false);
        }
    }

    return (
        <div className="video-call-container">
            <div className="video-grid">
                <div className="local-video" ref={localVideoRef}>
                    <span>Local Video</span>
                </div>
                <div className="remote-video" ref={remoteVideoRef}>
                    <span>Remote Video</span>
                </div>
            </div>

            <div className="controls">
                {!isCallConnected ? (
                    <button onClick={() => startCall(targetUserId)}>
                        Start Call
                    </button>
                ) : (
                    <button onClick={hangUp} className="hang-up">
                        Hang Up
                    </button>
                )}
            </div>
        </div>
    );
}

export default VideoCall;
```

## Handling Call Events and Quality

Monitoring call quality is essential for production applications:

```javascript
function monitorCallQuality(call) {
    // Subscribe to call diagnostics
    const diagnostics = call.api(Features.Diagnostics);

    diagnostics.media.on('diagnosticChanged', (event) => {
        console.log('Media diagnostic:', event.diagnostic, event.value);

        switch (event.diagnostic) {
            case 'networkReceiveQuality':
                handleNetworkQuality(event.value);
                break;
            case 'speakingWhileMicrophoneIsMuted':
                notifyUserMuted();
                break;
        }
    });

    diagnostics.network.on('diagnosticChanged', (event) => {
        console.log('Network diagnostic:', event.diagnostic, event.value);
    });
}

function handleNetworkQuality(quality) {
    // Quality values: Good, Poor, Bad
    if (quality === 'Bad') {
        // Suggest turning off video
        showNotification('Poor network quality detected. Consider turning off video.');
    }
}
```

## Recording Calls

ACS supports call recording for compliance and training purposes:

```csharp
using Azure.Communication.CallingServer;

public class CallRecordingService
{
    private readonly CallingServerClient _callingServerClient;

    public CallRecordingService(string connectionString)
    {
        _callingServerClient = new CallingServerClient(connectionString);
    }

    public async Task<string> StartRecordingAsync(string serverCallId)
    {
        var recordingOptions = new StartRecordingOptions(serverCallId)
        {
            RecordingContent = RecordingContent.AudioVideo,
            RecordingChannel = RecordingChannel.Mixed,
            RecordingFormat = RecordingFormat.Mp4
        };

        var response = await _callingServerClient.InitializeServerCall(serverCallId)
            .StartRecordingAsync(recordingOptions);

        return response.Value.RecordingId;
    }

    public async Task StopRecordingAsync(string serverCallId, string recordingId)
    {
        await _callingServerClient.InitializeServerCall(serverCallId)
            .StopRecordingAsync(recordingId);
    }
}
```

## Best Practices

When building video calling applications with ACS, consider the following:

1. **Token Management**: Tokens expire after 24 hours. Implement token refresh logic.
2. **Error Handling**: Network conditions vary. Handle disconnections gracefully.
3. **Bandwidth Optimization**: Allow users to toggle video quality based on their connection.
4. **Accessibility**: Provide keyboard navigation and screen reader support.
5. **Testing**: Use the ACS Test Tool for debugging call quality issues.

Azure Communication Services provides a robust foundation for building communication features. The integration with Azure ecosystem services like Event Grid for webhooks and Blob Storage for recordings makes it a compelling choice for enterprise applications.
