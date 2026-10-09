---
title: Content Protection and DRM with Azure Media Services
description: "Content protection with DRM ensures your premium content remains secure while providing a seamless viewing experience across all platforms."
author: Michael John Pena
draft: false
date: 2021-09-27
tags:
  - Azure
  - Media Services
  - DRM
  - Content Protection
  - Security
---

## DRM Options

| DRM System | Platforms | License Server |
|------------|-----------|----------------|
| PlayReady | Windows, Xbox, Smart TVs | Microsoft |
| Widevine | Chrome, Android, Chromecast | Google |
| FairPlay | Safari, iOS, Apple TV | Apple |
| AES-128 | All (clear key) | Azure |

## Creating Content Key Policies

```python
from azure.mgmt.media import AzureMediaServices
from azure.mgmt.media.models import (
    ContentKeyPolicy,
    ContentKeyPolicyOption,
    ContentKeyPolicyTokenRestriction,
    ContentKeyPolicySymmetricTokenKey,
    ContentKeyPolicyRestrictionTokenType,
    ContentKeyPolicyPlayReadyConfiguration,
    ContentKeyPolicyPlayReadyLicense,
    ContentKeyPolicyPlayReadyContentEncryptionKeyFromHeader,
    ContentKeyPolicyPlayReadyContentType,
    ContentKeyPolicyWidevineConfiguration,
    ContentKeyPolicyFairPlayConfiguration,
    ContentKeyPolicyClearKeyConfiguration
)
from azure.identity import DefaultAzureCredential
import base64
import secrets

class ContentProtectionManager:
    def __init__(self, subscription_id: str, resource_group: str, account_name: str):
        self.credential = DefaultAzureCredential()
        self.client = AzureMediaServices(self.credential, subscription_id)
        self.resource_group = resource_group
        self.account_name = account_name

    def create_multi_drm_policy(self, policy_name: str,
                                token_key: str,
                                issuer: str,
                                audience: str) -> ContentKeyPolicy:
        """Create a content key policy with multiple DRM options."""

        # Token verification key
        primary_key = ContentKeyPolicySymmetricTokenKey(
            key_value=base64.b64decode(token_key)
        )

        # Token restriction
        token_restriction = ContentKeyPolicyTokenRestriction(
            issuer=issuer,
            audience=audience,
            primary_verification_key=primary_key,
            restriction_token_type=ContentKeyPolicyRestrictionTokenType.JWT
        )

        options = []

        # PlayReady option
        playready_config = ContentKeyPolicyPlayReadyConfiguration(
            licenses=[
                ContentKeyPolicyPlayReadyLicense(
                    allow_test_devices=True,
                    content_key_location=ContentKeyPolicyPlayReadyContentEncryptionKeyFromHeader(),
                    content_type=ContentKeyPolicyPlayReadyContentType.UNSPECIFIED,
                    license_type="NonPersistent"
                )
            ]
        )
        options.append(ContentKeyPolicyOption(
            name="PlayReady",
            configuration=playready_config,
            restriction=token_restriction
        ))

        # Widevine option
        widevine_config = ContentKeyPolicyWidevineConfiguration(
            widevine_template="""{
                "allowed_track_types": "SD_HD",
                "content_key_specs": [{
                    "track_type": "SD",
                    "security_level": 1,
                    "required_output_protection": {"hdcp": "HDCP_NONE"}
                }],
                "policy_overrides": {
                    "can_play": true,
                    "can_persist": false,
                    "can_renew": false
                }
            }"""
        )
        options.append(ContentKeyPolicyOption(
            name="Widevine",
            configuration=widevine_config,
            restriction=token_restriction
        ))

        # FairPlay option (requires Apple certificate)
        # fairplay_config = ContentKeyPolicyFairPlayConfiguration(
        #     ask=fairplay_ask,
        #     fairplay_pfx=fairplay_pfx,
        #     fairplay_pfx_password=fairplay_password,
        #     rental_and_lease_key_type="PersistentUnlimited",
        #     rental_duration=0
        # )

        # Clear key option (AES-128)
        clear_key_config = ContentKeyPolicyClearKeyConfiguration()
        options.append(ContentKeyPolicyOption(
            name="ClearKey",
            configuration=clear_key_config,
            restriction=token_restriction
        ))

        policy = ContentKeyPolicy(options=options)

        return self.client.content_key_policies.create_or_update(
            self.resource_group,
            self.account_name,
            policy_name,
            policy
        )
```

## Creating Streaming Policies

```python
from azure.mgmt.media.models import (
    StreamingPolicy,
    CommonEncryptionCenc,
    CommonEncryptionCbcs,
    EnabledProtocols,
    StreamingPolicyContentKeys,
    DefaultKey,
    TrackSelection,
    TrackPropertyCondition,
    StreamingPolicyContentKey
)

def create_drm_streaming_policy(manager, policy_name: str,
                                content_key_policy_name: str) -> StreamingPolicy:
    """Create a streaming policy with DRM protection."""

    # CENC (Common Encryption) for PlayReady and Widevine
    cenc = CommonEncryptionCenc(
        enabled_protocols=EnabledProtocols(
            dash=True,
            hls=False,  # HLS uses CBCS
            smooth_streaming=True,
            download=False
        ),
        content_keys=StreamingPolicyContentKeys(
            default_key=DefaultKey(
                label="cenc_default",
                policy_name=content_key_policy_name
            )
        ),
        drm=CommonEncryptionCencDrm(
            play_ready=StreamingPolicyPlayReadyConfiguration(
                custom_license_acquisition_url_template=None
            ),
            widevine=StreamingPolicyWidevineConfiguration(
                custom_license_acquisition_url_template=None
            )
        )
    )

    # CBCS (Common Encryption CBCS) for FairPlay
    cbcs = CommonEncryptionCbcs(
        enabled_protocols=EnabledProtocols(
            dash=False,
            hls=True,
            smooth_streaming=False,
            download=False
        ),
        content_keys=StreamingPolicyContentKeys(
            default_key=DefaultKey(
                label="cbcs_default",
                policy_name=content_key_policy_name
            )
        )
    )

    policy = StreamingPolicy(
        common_encryption_cenc=cenc,
        common_encryption_cbcs=cbcs
    )

    return manager.client.streaming_policies.create(
        manager.resource_group,
        manager.account_name,
        policy_name,
        policy
    )
```

## Generating JWT Tokens

```python
import jwt
from datetime import datetime, timedelta
import uuid

class TokenService:
    def __init__(self, token_key: str, issuer: str, audience: str):
        self.token_key = token_key
        self.issuer = issuer
        self.audience = audience

    def generate_token(self, content_key_id: str = None,
                      expiry_hours: int = 24) -> str:
        """Generate a JWT token for content access."""

        now = datetime.utcnow()
        expiry = now + timedelta(hours=expiry_hours)

        claims = {
            "iss": self.issuer,
            "aud": self.audience,
            "iat": now,
            "exp": expiry,
            "nbf": now,
            "jti": str(uuid.uuid4())
        }

        # Add content key identifier if specified
        if content_key_id:
            claims["urn:microsoft:azure:mediaservices:contentkeyidentifier"] = content_key_id

        token = jwt.encode(
            claims,
            base64.b64decode(self.token_key),
            algorithm="HS256"
        )

        return token

    def generate_persistent_token(self, user_id: str,
                                  content_id: str) -> str:
        """Generate a token for offline playback."""

        claims = {
            "iss": self.issuer,
            "aud": self.audience,
            "iat": datetime.utcnow(),
            "exp": datetime.utcnow() + timedelta(days=30),
            "sub": user_id,
            "content_id": content_id,
            "urn:microsoft:azure:mediaservices:maxuses": "unlimited"
        }

        return jwt.encode(
            claims,
            base64.b64decode(self.token_key),
            algorithm="HS256"
        )

# Usage
token_service = TokenService(
    token_key="your-base64-encoded-key",
    issuer="https://yourapp.com",
    audience="urn:youraudience"
)

# Generate playback token
token = token_service.generate_token()
print(f"Bearer {token}")
```

## Creating Protected Streaming Locators

```python
from azure.mgmt.media.models import StreamingLocator

def create_protected_locator(manager, asset_name: str,
                            locator_name: str,
                            streaming_policy_name: str,
                            content_key_policy_name: str) -> dict:
    """Create a streaming locator with DRM protection."""

    locator = StreamingLocator(
        asset_name=asset_name,
        streaming_policy_name=streaming_policy_name,
        default_content_key_policy_name=content_key_policy_name
    )

    created_locator = manager.client.streaming_locators.create(
        manager.resource_group,
        manager.account_name,
        locator_name,
        locator
    )

    # Get streaming paths
    paths = manager.client.streaming_locators.list_paths(
        manager.resource_group,
        manager.account_name,
        locator_name
    )

    # Get content keys
    keys = manager.client.streaming_locators.list_content_keys(
        manager.resource_group,
        manager.account_name,
        locator_name
    )

    return {
        "locator_id": created_locator.streaming_locator_id,
        "streaming_paths": paths.streaming_paths,
        "content_keys": [
            {"id": k.id, "type": k.type, "label": k.label_reference_in_streaming_policy}
            for k in keys.content_keys
        ]
    }
```

## Building a License Delivery Service

```python
from flask import Flask, request, jsonify
import jwt

app = Flask(__name__)

# Configuration
TOKEN_KEY = "your-base64-encoded-key"
ISSUER = "https://yourapp.com"
AUDIENCE = "urn:youraudience"

def verify_token(token: str) -> dict:
    """Verify JWT token and return claims."""
    try:
        claims = jwt.decode(
            token,
            base64.b64decode(TOKEN_KEY),
            algorithms=["HS256"],
            audience=AUDIENCE,
            issuer=ISSUER
        )
        return claims
    except jwt.InvalidTokenError as e:
        raise ValueError(f"Invalid token: {e}")

@app.route('/api/token', methods=['POST'])
def get_playback_token():
    """Issue playback token for authenticated users."""

    # Verify user authentication
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        return jsonify({"error": "Unauthorized"}), 401

    # Generate playback token
    user_id = request.json.get('user_id')
    content_id = request.json.get('content_id')

    # Check user entitlement (simplified)
    if not check_user_entitlement(user_id, content_id):
        return jsonify({"error": "Not entitled"}), 403

    token_service = TokenService(TOKEN_KEY, ISSUER, AUDIENCE)
    token = token_service.generate_token()

    return jsonify({
        "token": token,
        "expires_in": 86400  # 24 hours
    })

def check_user_entitlement(user_id: str, content_id: str) -> bool:
    """Check if user is entitled to access content."""
    # Implement your entitlement logic
    return True

@app.route('/api/license/playready', methods=['POST'])
def playready_license():
    """Custom PlayReady license acquisition (if using custom server)."""
    # Azure Media Services handles this by default
    pass

if __name__ == '__main__':
    app.run(port=5000)
```

## Video Player Integration

```javascript
// Azure Media Player with DRM
const playerOptions = {
    autoplay: true,
    controls: true,
    width: "640",
    height: "400",
    logo: { enabled: false }
};

const player = amp("azuremediaplayer", playerOptions);

// Get token from your backend
async function getPlaybackToken(contentId) {
    const response = await fetch('/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userToken}`
        },
        body: JSON.stringify({ content_id: contentId })
    });
    return response.json();
}

// Set protected source
async function playProtectedContent(manifestUrl, contentId) {
    const { token } = await getPlaybackToken(contentId);

    player.src([{
        src: manifestUrl,
        type: "application/vnd.ms-sstr+xml",
        protectionInfo: [
            {
                type: "PlayReady",
                authenticationToken: `Bearer=${token}`
            },
            {
                type: "Widevine",
                authenticationToken: `Bearer=${token}`
            },
            {
                type: "FairPlay",
                authenticationToken: `Bearer=${token}`,
                certificateUrl: "https://yourapp.com/fairplay.cer"
            }
        ]
    }]);
}

playProtectedContent(
    "https://streaming.mediaservices.windows.net/.../manifest",
    "video-123"
);
```

## Best Practices

1. **Multi-DRM**: Support PlayReady, Widevine, and FairPlay for maximum reach
2. **Token Expiry**: Use short-lived tokens (hours, not days)
3. **HTTPS Only**: Always use HTTPS for license acquisition
4. **Secure Keys**: Store token signing keys securely
5. **Monitor Usage**: Track license requests for abuse detection
6. **Offline Support**: Consider persistent licenses for offline viewing

Content protection with DRM ensures your premium content remains secure while providing a seamless viewing experience across all platforms.
