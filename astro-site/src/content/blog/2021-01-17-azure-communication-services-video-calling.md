---
title: "ACS Video Calling in Preview: Tokens, Calls and Rendering"
description: "A 1:1 video call on the Azure Communication Services preview SDKs: a token service, a refreshing credential, and rendering remote video correctly."
author: Michael John Pena
draft: false
date: 2021-01-17
url: /blog/azure-communication-services-video-calling/
tags:
  - Azure
  - Communication Services
  - Video Calling
  - WebRTC
  - JavaScript
---

Azure Communication Services (ACS) has been in public preview since Ignite in September 2020. The pitch is the same media stack that runs Microsoft Teams, exposed as APIs you can put inside your own app. The quickstarts get you a call in about twenty minutes, then skip the parts that decide whether it holds up with real users: how identities map to your users, how tokens get refreshed, and how remote video turns up and goes away again.

If you want the broader tour of what ACS covers (chat, SMS, phone numbers), I wrote that up in [Azure Communication Services: Voice, Video, Chat, SMS](/blog/2020-12-20-azure-communication-services/). This one stays on video.

## What you are working with in January 2021

Be clear about the state of the platform before you commit a project to it:

| Piece | Package / status (17 Jan 2021) |
|---|---|
| Service | Public preview, no SLA |
| Identity and tokens (server) | `@azure/communication-administration` 1.0.0-beta.3 |
| Credential types | `@azure/communication-common` 1.0.0-beta.3 |
| Calling (browser) | `@azure/communication-calling` 1.0.0-beta.3 |
| Voice/video price | $0.004 per participant per minute |

Three things follow from that table.

First, it is preview. Like every Azure preview, it comes with [no service-level agreement](https://azure.microsoft.com/support/legal/preview-supplemental-terms/), and the SDKs are betas that rename things between releases. Pin exact versions in `package.json` and expect to touch your calling code when the next beta lands.

Second, identity lives in the administration package for now. `CommunicationIdentityClient` sits in `@azure/communication-administration` beside the phone number APIs, and the method that mints a token is `issueToken`. Samples that track the SDK's main branch or nightly alpha builds may not match this API, so check the version a sample was written for; the [`@azure/communication-calling` version history on npm](https://www.npmjs.com/package/@azure/communication-calling?activeTab=versions) shows which beta is current.

Third, the pricing model is simple and per participant. A 30-minute one-to-one call is two participants for 30 minutes, so 60 participant-minutes, or about 24 cents. The [pricing scenarios page](https://learn.microsoft.com/en-us/azure/communication-services/concepts/pricing) walks through group calls the same way.

The calling SDK's type definitions already include beta types for joining Teams meetings, but Teams interoperability isn't something you can build a product on yet. Plan for ACS-to-ACS calls only.

## The identity model is the real design decision

ACS doesn't know who your users are. It gives you opaque identities (`8:acs:...` strings) and short-lived access tokens scoped to `voip`, `chat` or `pstn`. Your backend does the mapping. The [identity concepts page](https://learn.microsoft.com/en-us/azure/communication-services/concepts/identity-model) describes the model: a trusted service holds the resource's connection string, creates identities, and issues tokens to authenticated clients. User access tokens are valid for 24 hours.

The mistake I see most often in quickstart-derived code is creating a new ACS identity on every token request. It works in a demo. In production it means nobody can be called twice under the same identity, you can't revoke a specific person's access, and your "who called whom" telemetry becomes noise. My rule: one ACS identity per application user, created once, stored next to your user record, and reused for every token.

That makes the token endpoint look like this:

```javascript
// server.js — Node.js 12+, express 4, @azure/communication-administration@1.0.0-beta.3
const express = require('express');
const { CommunicationIdentityClient } = require('@azure/communication-administration');

const identityClient = new CommunicationIdentityClient(process.env.ACS_CONNECTION_STRING);
const app = express();

// Stand-in for a table that maps your app's users to ACS identities.
// Replace with your database; an in-memory Map loses every mapping on restart.
const acsIdentities = new Map();

// Stand-in for real authentication. Replace with your session or JWT middleware
// so that only signed-in users can obtain a token for their own identity.
function getAppUserId(req) {
  return req.get('x-app-user-id');
}

app.post('/api/token', async (req, res) => {
  const appUserId = getAppUserId(req);
  if (!appUserId) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  try {
    let communicationUserId = acsIdentities.get(appUserId);
    if (!communicationUserId) {
      const user = await identityClient.createUser();
      communicationUserId = user.communicationUserId;
      acsIdentities.set(appUserId, communicationUserId);
    }

    const { token, expiresOn } = await identityClient.issueToken(
      { communicationUserId },
      ['voip']
    );

    res.json({ communicationUserId, token, expiresOn });
  } catch (err) {
    console.error('Token issue failed', err);
    res.status(500).json({ error: 'Could not issue token' });
  }
});

app.listen(3000, () => console.log('Token service on http://localhost:3000'));
```

A few choices here are deliberate. The scope is `voip` only, because a client that only makes video calls has no business holding a `pstn` token. The connection string stays on the server and comes from configuration; it is a full-access key to the resource, so it never ships to a browser. And the endpoint returns the ACS identity so the client can show it or hand it to whoever needs to call this user.

If someone leaves the organisation or a device is lost, `identityClient.revokeTokens({ communicationUserId })` invalidates that identity's existing tokens. That only works because you kept one stable identity per user.

## The browser side: credential, agent, devices

The calling SDK has one entry point, `CallClient`, which creates a `CallAgent` (the thing that places and receives calls) and a `DeviceManager`. You can have only one `CallAgent` per `CallClient` in this beta; dispose the old one before creating another.

The piece people get wrong is the credential. If you pass a static token string, the call agent stops working when the token expires, and the user finds out as an obscure failure mid-session. `AzureCommunicationUserCredential` in `@azure/communication-common` takes a `tokenRefresher` callback and can refresh proactively before expiry. Point it at the same endpoint. Because the backend reuses the identity, a refreshed token belongs to the same user.

```javascript
// calling.js — bundled with webpack; @azure/communication-calling@1.0.0-beta.3,
// @azure/communication-common@1.0.0-beta.3
import { CallClient, LocalVideoStream, Renderer } from '@azure/communication-calling';
import { AzureCommunicationUserCredential } from '@azure/communication-common';

let callAgent;
let deviceManager;
let localVideoStream;
let activeCall;

async function fetchToken() {
  const res = await fetch('/api/token', {
    method: 'POST',
    headers: { 'x-app-user-id': '<signed-in-user-id>' }
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  return res.json();
}

export async function initCalling(onIncomingCall) {
  const { communicationUserId, token } = await fetchToken();

  const credential = new AzureCommunicationUserCredential({
    initialToken: token,
    tokenRefresher: async () => (await fetchToken()).token,
    refreshProactively: true
  });

  const callClient = new CallClient();
  callAgent = await callClient.createCallAgent(credential, { displayName: '<display-name>' });
  deviceManager = await callClient.getDeviceManager();

  callAgent.on('callsUpdated', ({ added }) => {
    added.filter((call) => call.isIncoming).forEach(onIncomingCall);
  });

  return communicationUserId;
}

// Call this from a user gesture (the "Join call" click handler), never on page load,
// so the browser's camera and microphone prompt appears when the user expects it.
export async function enableDevices() {
  await deviceManager.askDevicePermission(true, true);
  const cameras = deviceManager.getCameraList();
  if (cameras.length > 0) {
    localVideoStream = new LocalVideoStream(cameras[0]);
  }
}

function videoOptions() {
  return localVideoStream ? { localVideoStreams: [localVideoStream] } : undefined;
}

export function startCall(calleeId, remoteContainer) {
  activeCall = callAgent.call([{ communicationUserId: calleeId }], {
    videoOptions: videoOptions(),
    audioOptions: { muted: false }
  });
  wireUpCall(activeCall, remoteContainer);
  return activeCall;
}

export async function acceptCall(incomingCall, remoteContainer) {
  await incomingCall.accept({ videoOptions: videoOptions() });
  activeCall = incomingCall;
  wireUpCall(activeCall, remoteContainer);
}

export async function hangUp() {
  if (activeCall) {
    await activeCall.hangUp();
    activeCall = undefined;
  }
}

export async function showLocalPreview(container) {
  if (!localVideoStream) return;
  const renderer = new Renderer(localVideoStream);
  const view = await renderer.createView({ mirrored: true });
  container.appendChild(view.target);
}
```

The `x-app-user-id` header only matches the stand-in on the server. In a real app the browser sends its session cookie or bearer token and the server works out who the user is. Never let the client name its own identity.

`initCalling` can run when the page loads, because it only fetches a token and creates the agent. `enableDevices` is split out on purpose: the "Join call" or "Answer" click handler awaits it before calling `startCall` or `acceptCall`. Without camera permission the call still connects, just without local video.

Note the method names in this beta: `callAgent.call(...)` to place a call, `getCameraList()` (synchronous) to list devices, and `callsUpdated` with `isIncoming` to detect incoming calls. Check the [calling client library overview](https://learn.microsoft.com/en-us/azure/communication-services/concepts/voice-video-calling/calling-sdk-features) against the version you've pinned, because these names are the most likely to change before GA.

## Handling remote video as it comes and goes

This is the gotcha that doesn't show up in the quickstart. A remote participant's video stream exists as an object whether or not they are sending video. `isAvailable` tells you whether there are frames to render, and it flips when they turn their camera on or off. If you only render streams when `videoStreamsUpdated` fires, you miss streams that existed before you subscribed and you never clean up when someone turns their camera off.

Handle three cases: participants already in the call, participants who join later, and availability changing on a stream you already know about.

```javascript
// Continuation of calling.js
function wireUpCall(call, remoteContainer) {
  call.on('callStateChanged', () => {
    console.log(`Call state: ${call.state}`);
    if (call.state === 'Disconnected') {
      console.log('Call ended', call.callEndReason);
      remoteContainer.innerHTML = '';
    }
  });

  call.remoteParticipants.forEach((p) => subscribeToParticipant(p, remoteContainer));
  call.on('remoteParticipantsUpdated', ({ added }) => {
    added.forEach((p) => subscribeToParticipant(p, remoteContainer));
  });
}

function subscribeToParticipant(participant, remoteContainer) {
  participant.videoStreams.forEach((s) => subscribeToStream(s, remoteContainer));
  participant.on('videoStreamsUpdated', ({ added }) => {
    added.forEach((s) => subscribeToStream(s, remoteContainer));
  });
}

function subscribeToStream(stream, remoteContainer) {
  let renderer;
  let element;

  const render = async () => {
    if (stream.isAvailable && !renderer) {
      const pending = new Renderer(stream);
      renderer = pending;
      const view = await pending.createView({ scalingMode: 'Crop' });
      if (renderer !== pending) return; // disposed while createView was pending
      element = view.target;
      remoteContainer.appendChild(element);
    } else if (!stream.isAvailable && renderer) {
      renderer.dispose();
      if (element) element.remove();
      renderer = undefined;
      element = undefined;
    }
  };

  const safeRender = () => render().catch((err) => console.error('Render failed', err));
  stream.on('availabilityChanged', safeRender);
  safeRender();
}
```

Disposing the `Renderer` matters. Each one holds a video element and decoding work in the browser. A long call where someone toggles their camera a dozen times will quietly leak elements if you only ever append.

## Things I would budget time for

- **Browser coverage.** Calling in this preview targets current desktop browsers through WebRTC. Test the exact browsers your users run, especially Safari, before you promise anything. Mobile web is where most of my test time would go.
- **Permission prompts.** `askDevicePermission` shows the browser's prompt. That's why the sample keeps it in `enableDevices` and calls it from the "Join call" button, not on page load; a prompt nobody asked for gets dismissed, and you're left with a call that has no camera.
- **Your own call signalling.** ACS places a call to an identity; it doesn't tell the caller who is online or what that person's identity is. Presence, "ring this user" lookups and call history are yours to build, usually on the same backend that maps identities.
- **Version churn.** Each beta has renamed something. Put the SDK behind a thin module like the one above so the rest of your app doesn't import `@azure/communication-calling` directly.

## When I would and wouldn't use it right now

Use ACS in preview if you're building a pilot or an internal tool where a missing SLA is acceptable, and you want calls inside your own UI and identity model instead of sending people to a separate meeting app. The per-minute pricing and the absence of media servers to run make it cheap to prove the idea.

Don't use it yet for a customer-facing product that needs an uptime commitment this quarter, or if your real requirement is talking to people in Teams, since that interop isn't available to build on today. In those cases there are two generally available routes today:

- **Teams meetings**, when the people on both ends are inside your organisation. It's covered by your Microsoft 365 licences and SLA, but users leave your app for the Teams client and you get no control over the calling UI.
- **An established third-party WebRTC video API** such as Twilio Programmable Video or the Vonage Video API, when it's customer-facing. You get a GA SDK and an uptime commitment, at the cost of another vendor, another identity mapping and a bill outside Azure.

Either way, treat ACS as the thing you prototype on now and revisit it at GA.

Whichever way you go, get the identity mapping and token refresh right from the first commit. The calling code will change with each beta; a backend that issues random throwaway identities is much harder to fix later.
