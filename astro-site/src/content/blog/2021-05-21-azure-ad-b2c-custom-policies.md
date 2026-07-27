---
title: "Azure AD B2C Custom Policies: Advanced Identity Flows"
author: Michael John Peña
draft: false
date: 2021-05-21
tags:
  - Azure
  - Identity
  - Azure AD B2C
  - Authentication
  - Security

---

I wrote "Azure AD B2C Custom Policies: Advanced Identity Flows" to share practical, production-minded guidance on this topic.

## User Flows vs Custom Policies

**User Flows**: Pre-built, configurable through portal
- Sign-up/sign-in
- Password reset
- Profile editing

**Custom Policies**: XML-based, fully customizable
- Custom claims
- External API integration
- Complex branching logic
- Custom validation

## Custom Policy Structure

Custom policies use XML with these components:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<TrustFrameworkPolicy
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns="http://schemas.microsoft.com/online/cpim/schemas/2013/06"
  PolicySchemaVersion="0.3.0.0"
  TenantId="yourtenant.onmicrosoft.com"
  PolicyId="B2C_1A_SignUpSignIn"
  PublicPolicyUri="http://yourtenant.onmicrosoft.com/B2C_1A_SignUpSignIn">

  <BasePolicy>
    <TenantId>yourtenant.onmicrosoft.com</TenantId>
    <PolicyId>B2C_1A_TrustFrameworkExtensions</PolicyId>
  </BasePolicy>

  <!-- BuildingBlocks, ClaimsProviders, UserJourneys, RelyingParty -->

</TrustFrameworkPolicy>
```

## Claims Schema

Define the claims your policy uses:

```xml
<BuildingBlocks>
  <ClaimsSchema>
    <!-- Built-in claims -->
    <ClaimType Id="email">
      <DisplayName>Email Address</DisplayName>
      <DataType>string</DataType>
      <UserInputType>TextBox</UserInputType>
      <Restriction>
        <Pattern RegularExpression="^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$" />
      </Restriction>
    </ClaimType>

    <!-- Custom claims -->
    <ClaimType Id="loyaltyNumber">
      <DisplayName>Loyalty Number</DisplayName>
      <DataType>string</DataType>
      <UserHelpText>Your loyalty program member number</UserHelpText>
      <UserInputType>TextBox</UserInputType>
    </ClaimType>

    <ClaimType Id="accountTier">
      <DisplayName>Account Tier</DisplayName>
      <DataType>string</DataType>
      <UserInputType>Readonly</UserInputType>
    </ClaimType>

    <ClaimType Id="riskScore">
      <DisplayName>Risk Score</DisplayName>
      <DataType>int</DataType>
    </ClaimType>
  </ClaimsSchema>
</BuildingBlocks>
```

## Claims Providers

Define how claims are collected or validated:

### Self-Asserted Claims Provider

```xml
<ClaimsProvider>
  <DisplayName>Local Account SignIn</DisplayName>
  <TechnicalProfiles>
    <TechnicalProfile Id="SelfAsserted-LocalAccountSignin">
      <DisplayName>Local Account Signin</DisplayName>
      <Protocol Name="Proprietary" Handler="Web.TPEngine.Providers.SelfAssertedAttributeProvider" />
      <Metadata>
        <Item Key="SignUpTarget">SignUpWithLogonEmailExchange</Item>
        <Item Key="setting.operatingMode">Email</Item>
        <Item Key="ContentDefinitionReferenceId">api.localaccountsignin</Item>
      </Metadata>
      <InputClaims>
        <InputClaim ClaimTypeReferenceId="signInName" />
      </InputClaims>
      <OutputClaims>
        <OutputClaim ClaimTypeReferenceId="signInName" Required="true" />
        <OutputClaim ClaimTypeReferenceId="password" Required="true" />
        <OutputClaim ClaimTypeReferenceId="objectId" />
        <OutputClaim ClaimTypeReferenceId="authenticationSource" />
      </OutputClaims>
      <ValidationTechnicalProfiles>
        <ValidationTechnicalProfile ReferenceId="login-NonInteractive" />
      </ValidationTechnicalProfiles>
    </TechnicalProfile>
  </TechnicalProfiles>
</ClaimsProvider>
```

### REST API Claims Provider

```xml
<ClaimsProvider>
  <DisplayName>REST API Claims Provider</DisplayName>
  <TechnicalProfiles>
    <TechnicalProfile Id="REST-ValidateLoyaltyNumber">
      <DisplayName>Validate Loyalty Number</DisplayName>
      <Protocol Name="Proprietary" Handler="Web.TPEngine.Providers.RestfulProvider" />
      <Metadata>
        <Item Key="ServiceUrl">https://api.yourservice.com/validate-loyalty</Item>
        <Item Key="AuthenticationType">Bearer</Item>
        <Item Key="SendClaimsIn">Body</Item>
        <Item Key="AllowInsecureAuthInProduction">false</Item>
      </Metadata>
      <CryptographicKeys>
        <Key Id="BearerAuthenticationToken" StorageReferenceId="B2C_1A_RestApiToken" />
      </CryptographicKeys>
      <InputClaims>
        <InputClaim ClaimTypeReferenceId="loyaltyNumber" />
        <InputClaim ClaimTypeReferenceId="email" />
      </InputClaims>
      <OutputClaims>
        <OutputClaim ClaimTypeReferenceId="accountTier" />
        <OutputClaim ClaimTypeReferenceId="loyaltyPoints" />
      </OutputClaims>
      <UseTechnicalProfileForSessionManagement ReferenceId="SM-Noop" />
    </TechnicalProfile>
  </TechnicalProfiles>
</ClaimsProvider>
```

## User Journeys

Define the flow of steps:

```xml
<UserJourneys>
  <UserJourney Id="SignUpOrSignInWithLoyalty">
    <OrchestrationSteps>
      <!-- Step 1: Sign-in or sign-up -->
      <OrchestrationStep Order="1" Type="CombinedSignInAndSignUp" ContentDefinitionReferenceId="api.signuporsignin">
        <ClaimsProviderSelections>
          <ClaimsProviderSelection ValidationClaimsExchangeId="LocalAccountSigninEmailExchange" />
          <ClaimsProviderSelection TargetClaimsExchangeId="GoogleExchange" />
        </ClaimsProviderSelections>
        <ClaimsExchanges>
          <ClaimsExchange Id="LocalAccountSigninEmailExchange" TechnicalProfileReferenceId="SelfAsserted-LocalAccountSignin" />
        </ClaimsExchanges>
      </OrchestrationStep>

      <!-- Step 2: Social IDP -->
      <OrchestrationStep Order="2" Type="ClaimsExchange">
        <Preconditions>
          <Precondition Type="ClaimsExist" ExecuteActionsIf="true">
            <Value>objectId</Value>
            <Action>SkipThisOrchestrationStep</Action>
          </Precondition>
        </Preconditions>
        <ClaimsExchanges>
          <ClaimsExchange Id="GoogleExchange" TechnicalProfileReferenceId="Google-OAuth2" />
          <ClaimsExchange Id="SignUpWithLogonEmailExchange" TechnicalProfileReferenceId="LocalAccountSignUpWithLogonEmail" />
        </ClaimsExchanges>
      </OrchestrationStep>

      <!-- Step 3: Collect loyalty number for new users -->
      <OrchestrationStep Order="3" Type="ClaimsExchange">
        <Preconditions>
          <Precondition Type="ClaimsExist" ExecuteActionsIf="true">
            <Value>loyaltyNumber</Value>
            <Action>SkipThisOrchestrationStep</Action>
          </Precondition>
        </Preconditions>
        <ClaimsExchanges>
          <ClaimsExchange Id="CollectLoyaltyNumber" TechnicalProfileReferenceId="SelfAsserted-CollectLoyalty" />
        </ClaimsExchanges>
      </OrchestrationStep>

      <!-- Step 4: Validate loyalty with API -->
      <OrchestrationStep Order="4" Type="ClaimsExchange">
        <ClaimsExchanges>
          <ClaimsExchange Id="ValidateLoyalty" TechnicalProfileReferenceId="REST-ValidateLoyaltyNumber" />
        </ClaimsExchanges>
      </OrchestrationStep>

      <!-- Step 5: Read user from directory -->
      <OrchestrationStep Order="5" Type="ClaimsExchange">
        <ClaimsExchanges>
          <ClaimsExchange Id="AADUserReadWithObjectId" TechnicalProfileReferenceId="AAD-UserReadUsingObjectId" />
        </ClaimsExchanges>
      </OrchestrationStep>

      <!-- Step 6: Issue token -->
      <OrchestrationStep Order="6" Type="SendClaims" CpimIssuerTechnicalProfileReferenceId="JwtIssuer" />
    </OrchestrationSteps>
  </UserJourney>
</UserJourneys>
```

## REST API Integration (Backend)

```python
from flask import Flask, request, jsonify
from functools import wraps
import jwt

app = Flask(__name__)

def validate_b2c_token(f):
    """Validate B2C service-to-service token"""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        if not token:
            return jsonify({'error': 'No token provided'}), 401

        try:
            # Validate token (simplified - use proper validation in production)
            decoded = jwt.decode(token, options={"verify_signature": False})
            request.claims = decoded
        except Exception as e:
            return jsonify({'error': 'Invalid token'}), 401

        return f(*args, **kwargs)
    return decorated

@app.route('/validate-loyalty', methods=['POST'])
@validate_b2c_token
def validate_loyalty():
    """Validate loyalty number and return account tier"""
    data = request.json
    loyalty_number = data.get('loyaltyNumber')
    email = data.get('email')

    # Lookup loyalty information
    loyalty_info = lookup_loyalty(loyalty_number, email)

    if loyalty_info:
        return jsonify({
            'accountTier': loyalty_info['tier'],
            'loyaltyPoints': loyalty_info['points']
        })
    else:
        # Return error to B2C
        return jsonify({
            'version': '1.0.0',
            'status': 400,
            'userMessage': 'Invalid loyalty number. Please check and try again.'
        }), 400

@app.route('/risk-assessment', methods=['POST'])
@validate_b2c_token
def risk_assessment():
    """Assess sign-in risk"""
    data = request.json

    risk_score = calculate_risk(
        ip_address=request.remote_addr,
        user_agent=request.headers.get('User-Agent'),
        email=data.get('email')
    )

    response = {
        'riskScore': risk_score,
        'requireMfa': risk_score > 50
    }

    if risk_score > 80:
        # Block high-risk sign-ins
        return jsonify({
            'version': '1.0.0',
            'status': 400,
            'userMessage': 'Sign-in blocked due to suspicious activity.'
        }), 400

    return jsonify(response)

def lookup_loyalty(number, email):
    # Database lookup
    pass

def calculate_risk(ip_address, user_agent, email):
    # Risk calculation logic
    return 25
```

## Custom UI

Define content definitions for custom branding:

```xml
<BuildingBlocks>
  <ContentDefinitions>
    <ContentDefinition Id="api.signuporsignin">
      <LoadUri>https://yourbrand.blob.core.windows.net/b2c-ui/signin.html</LoadUri>
      <RecoveryUri>~/common/default_page_error.html</RecoveryUri>
      <DataUri>urn:com:microsoft:aad:b2c:elements:contract:unifiedssp:2.1.0</DataUri>
    </ContentDefinition>
  </ContentDefinitions>
</BuildingBlocks>
```

Custom HTML template:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Sign In - Your Brand</title>
    <link href="https://yourbrand.com/styles/b2c.css" rel="stylesheet">
</head>
<body>
    <div class="container">
        <header>
            <img src="https://yourbrand.com/logo.png" alt="Logo">
        </header>

        <main>
            <div id="api">
                <!-- B2C will inject content here -->
            </div>
        </main>

        <footer>
            <p>&copy; 2021 Your Brand</p>
        </footer>
    </div>
</body>
</html>
```

## Deploying Policies

```bash
# Upload policy files in order
az rest --method put \
    --url "https://graph.microsoft.com/beta/trustFramework/policies/B2C_1A_TrustFrameworkBase/\$value" \
    --headers "Content-Type=application/xml" \
    --body @TrustFrameworkBase.xml

az rest --method put \
    --url "https://graph.microsoft.com/beta/trustFramework/policies/B2C_1A_TrustFrameworkExtensions/\$value" \
    --headers "Content-Type=application/xml" \
    --body @TrustFrameworkExtensions.xml

az rest --method put \
    --url "https://graph.microsoft.com/beta/trustFramework/policies/B2C_1A_SignUpSignIn/\$value" \
    --headers "Content-Type=application/xml" \
    --body @SignUpSignIn.xml
```

## Resources

- [Custom Policy Documentation](https://docs.microsoft.com/en-us/azure/active-directory-b2c/custom-policy-overview)
- [Starter Pack](https://github.com/Azure-Samples/active-directory-b2c-custom-policy-starterpack)
- [Community Samples](https://github.com/azure-ad-b2c/samples)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
