---
title: "Code Signing and Notarizing your MacOS Apps"
author: MJ Peña
draft: false
date: 2022-09-18T21:52:19+00:00
image: /2022/09/macos-codesign-featured.png
url: /blog/macos-codesign/
tags:
  - macos
  - security
  - certificate
---

## Introduction

One of the biggest pain points of every developer in the Apple ecosystem is Application signing. It was never straightforward. Even after more than a decade of exposure in mobile and desktop development, it’s still a painful experience overall. On the flip side, there are reasons this is the case. From time to time, big companies like Apple have to refresh their security posture and that means developers have to follow those rules to maintain a secured and trusted platform. Code Signing and Notarization are some of them. This blog post will focus more on MacOS Desktop apps, and won’t directly apply to iOS and iPadOS.

## Code Signing

Code Signing is verifying that you (or an entity) developed and owns the application. The way it works is by creating a “signature” on to the application to mark as “final.” That signature is then recognised by a trusted third part (like Apple) to say that the application’s signature is valid. Any modification or alteration to the application will result in the app being malicious. Your operating system (MacOS) is smart enough to detect this. One advantage of working in a closed ecosystem, like Apple and Mac.

To learn more about Code Signing in Apple's ecosystem, [read this one](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Introduction/Introduction.html#:~:text=Code%20signing%20is%20a%20macOS%20security%20technology%20that,change%20is%20introduced%20accidentally%20or%20by%20malicious%20code.).

### Creating a Trusted Certificate

The first thing that we have to do is create a trusted certificate by Apple that we can use to code sign an application.

The first thing to do is go to Apple Developer portal and add a certificate: https://developer.apple.com/account/resources/certificates/add .

You have three options:

- Mac App Distribution => App Store as .APP
- Mac Installer Distribution => App Store as .PKG
- Developer ID Application => Outside of App Store (including Enterprise releases)

_Note: Make sure you have the right permissions to create these._

Follow the rest of the steps in the portal. There are useful links to follow in case you get lost.

- [Create a Certificate Signing Request (CSR)](https://help.apple.com/developer-account/#/devbfa00fef7)
- Download the Certificate.
- Install the certificate by double clicking on the downloaded file. It will prompt you to add it to Keychain.

Once downloaded, you will now have the certificate ready for use.
![img](/2022/09/macos-codesign-01.png)

Open the now added certificate and navigate all the way to the bottom where you’ll see the SHA-1 thumbprint. We’ll use this value to point the code sign tooling to use this specific certificate.

_Note: Copy the SHA-1 thumbprint and remove all the spaces. i.e. from below: B49F1B...0BF2_

![img](/2022/09/macos-codesign-08.png)

### Entitlements.plist

As part of the code signing experience in Apple, you need to declare what the app is entitled to perform. This is through a file called `entitlements.plist`. Below is a common list of entitlements that a Mac app has that uses an isolated storage like SQLite. As a general rule, the more entitlements you place, the less secure your app may be, so make sure you only add what you need.

```xml
<?xml version="1.0" encoding="UTF-8"?>

<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">

<plist version="1.0">
	<dict>
		<key>com.apple.security.cs.allow-jit</key>
		<true/>

		<key>com.apple.security.cs.allow-unsigned-executable-memory</key>
		<true/>

		<key>com.apple.security.cs.disable-executable-page-protection</key>
		<true/>

		<key>com.apple.security.cs.disable-library-validation</key>
		<true/>

		<key>com.apple.security.cs.allow-dyld-environment-variables</key>
		<true/>
	</dict>
</plist>
```

Links of the following entitlements:

- [com.apple.security.cs.allow-jit](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_cs_allow-jit)
- [com.apple.security.cs.allow-unsigned-executable-memory](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_cs_allow-unsigned-executable-memory)
- [com.apple.security.cs.disable-executable-page-protection](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_cs_disable-executable-page-protection)
- [com.apple.security.cs.disable-library-validation](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_cs_disable-library-validation)
- [com.apple.security.cs.allow-dyld-environment-variables](https://developer.apple.com/documentation/bundleresources/entitlements/com_apple_security_cs_allow-dyld-environment-variables)

Create this file and save it next to the .app that you want to code sign.

### Codesign your application

Before code signing your app, you can inspect its code signature by using the following command:

```shell
spctl -vvv --assess --type exec MyApplication.app
```

![img](/2022/09/macos-codesign-02.png)

Now once you have both the certificate thumbprint and the entitlements.plist, it's now time to code sign your app. Run the following command.

```bash
codesign --force --verbose --timestamp --sign "MY-CERTIFICATE-THUMBPRINT" --options=runtime --entitlements entitlements.plist ./MyApplication.app
```

Some details of the command:

- --force to enforce the code signing operation even with warnings
- --verbose just so you can see the errors in case it doesn't work
- --timestamp means that you want to use Apple's timestamp server to set the date and time of the signature
- --sign followed by the certificate thumbprint determines which certificate to use to sign the application
- --options=runtime in order to honour the runtime (like x64 and ARM64)
- --entitlements followed by the entitlements.plist file that you created previously
- ./MyApplication.app is the path of your application

Now, inspect the code signature again. You now see that the Application is signed under the origin of your Developer ID Application.

![img](/2022/09/macos-codesign-03.png)

Technically, at this point, the app is code signed; but this is not yet "done" as it's not yet recognized by Apple for distribution. It doesn't have that "seal of approval" yet, and that's where notarization comes in.

## Create an App Specific Password

In order to notarize your application, you need to use an account that can communicate to the Apple Developer Portal. To do this, you need to generate an App Specific Password. An App Specific Password is a password to use in order to perform app operations. This way this password will only work on the capabilities that you set, and can’t be used for personal things such as buying the new iPhone or an expensive app in the App Store.

To do this, go to: https://appleid.apple.com/account/manage and sign in. Click on App Specific Passwords. Create a new one. Copy the password and store it to a secured location (such as password managers) as we'll use it for later.

_Note: In most CI/CD scenarios, use a service account (not your personal one) with an app specific password for this._

## Notarizing

Now that you have your App Specific Password, it's now time to submit your app to the App Store for them to recognise it. Note that this process is somewhat automagic, and doesn't require manual testing and verification on Apple's end - unlike the iOS App Store.

The first thing you have to do is to zip your Application Bundle (.app). To do this, you can either right click => compress or type the following command:

```shell
ditto -c --sequesterRsrc -k -V ./MyApplication.app MyApplication.zip
```

![img](/2022/09/macos-codesign-04.png)

Now, it's time to submit the .zip file on to Apple. Type the following command:

```bash
xcrun notarytool submit MyApplication.zip --wait --apple-id "michael@datachain.consulting" --password "YOUR-APP-SPECIFIC-PASSWORD" --team-id "TEAMID" --output-format json
```

In case you don’t have the --team-id, that should be the characters enclosed in parentheses in your Certificate Name i.e. (CZ77AAA1AA).

This might take a couple of minutes, depending on how big your application is.
If the message returns like the following, then the notarization was successful.

```json
{
  "id": "89b66f02-37f3-4d69-98b2-0d8291c2a91f",
  "status": "Accepted",
  "message": "Processing complete"
}
```

In case of failure, you can use the id to view the full logs with the following command. It will save it to a log.json file in the current directory.

```bash
xcrun notarytool log 89b66f02-37f3-4d69-98b2-0d8291c2a91f --apple-id "michael@datachain.consulting" --password "YOUR-APP-SPECIFIC-PASSWORD" --team-id "TEAMID" log.json
```

The last thing to do is to staple your application. When you do this, it bundles everything together to notarize it, and marking it as final (just like the act of stapling a bunch of papers).

```shell
xcrun stapler staple -v MyApplication.app
```

If you do another code signing inspection, you will see it's now all good!

```shell
spctl -vvv --assess --type exec MyApplication.app
```

![img](/2022/09/macos-codesign-05.png)

🎉 Congratulations! This will now allow you to redistribute your app to other Mac devices, and Apple will recognise it as a valid application from a trusted developer.

## Summary

- Distributing apps to other devices requires code signing and notarization.
- We want to code sign and notarize applications so that Apple can trust your app for re-distribution.

---

References:

- [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [Entitlements](https://developer.apple.com/documentation/bundleresources/entitlements)
