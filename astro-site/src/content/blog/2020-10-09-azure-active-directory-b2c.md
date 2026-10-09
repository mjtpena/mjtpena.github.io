---
title: "Azure AD B2C: Customer Identity Management"
description: "B2C handles the complexity of customer identity so you can focus on your application."
author: Michael John Peña
draft: false
date: 2020-10-09
tags:
  - Azure
  - Identity
  - Authentication
  - B2C
---

## Key Features

- Social identity providers (Google, Facebook, Apple)
- Local accounts (email + password)
- Custom policies for complex flows
- Self-service password reset
- MFA support
- Custom UI branding

## Setting Up

1. Create Azure AD B2C tenant
2. Register your application
3. Create user flows or custom policies
4. Integrate with your app

## User Flows

Built-in flows for common scenarios:
- Sign up and sign in
- Password reset
- Profile editing

## Custom Policy Example

```xml
<TrustFrameworkPolicy>
  <UserJourneys>
    <UserJourney Id="SignUpOrSignIn">
      <OrchestrationSteps>
        <OrchestrationStep Order="1" Type="CombinedSignInAndSignUp">
          <ClaimsProviderSelections>
            <ClaimsProviderSelection ValidationClaimsExchangeId="LocalAccountSigninEmailExchange"/>
            <ClaimsProviderSelection TargetClaimsExchangeId="GoogleExchange"/>
          </ClaimsProviderSelections>
        </OrchestrationStep>
      </OrchestrationSteps>
    </UserJourney>
  </UserJourneys>
</TrustFrameworkPolicy>
```

## React Integration

```javascript
import { PublicClientApplication } from "@azure/msal-browser";

const msalConfig = {
  auth: {
    clientId: "your-client-id",
    authority: "https://yourtenant.b2clogin.com/yourtenant.onmicrosoft.com/B2C_1_signupsignin",
    knownAuthorities: ["yourtenant.b2clogin.com"]
  }
};

const pca = new PublicClientApplication(msalConfig);

// Login
pca.loginPopup({ scopes: ["openid", "profile"] });

// Get token
const token = await pca.acquireTokenSilent({ scopes: ["api://your-api/access"] });
```

## Pricing

- First 50,000 MAU (Monthly Active Users) free
- $0.00325 per additional MAU
- MFA: $0.03 per authentication

B2C handles the complexity of customer identity so you can focus on your application.
