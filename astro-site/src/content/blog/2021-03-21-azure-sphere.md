---
title: Azure Sphere for Secured IoT Device Development
author: Michael John Pena
draft: false
date: 2021-03-21
url: /blog/azure-sphere/
tags:
  - Azure
  - IoT
  - Security
  - Embedded Systems
  - Azure Sphere
---

## The Three Components of Azure Sphere

1. **Azure Sphere MCU**: Secured silicon with hardware-based security
2. **Azure Sphere OS**: Linux-based secured operating system
3. **Azure Sphere Security Service**: Cloud service for device authentication and updates

## Setting Up Development Environment

```bash
# Install Azure Sphere SDK (Windows)
# Download from https://aka.ms/azurespheresdk

# Install on Linux (Ubuntu)
wget https://aka.ms/AzureSphereSDKInstall/Linux -O install.sh
chmod +x install.sh
sudo ./install.sh

# Verify installation
azsphere --version

# Login to Azure Sphere
azsphere login

# Create a tenant (first time only)
azsphere tenant create --name "MyCompanyTenant"

# Claim your device
azsphere device claim
```

## Hardware Configuration

```bash
# Enable development mode on device
azsphere device enable-development

# List attached devices
azsphere device list-attached

# Get device capabilities
azsphere device show-attached

# Set Wi-Fi configuration
azsphere device wifi add --ssid "MyNetwork" --psk "MyPassword"

# Show network status
azsphere device wifi show-status
```

## Creating Your First Application

### High-Level Application (Linux-based)

```c
// main.c - Blink LED application
#include <stdbool.h>
#include <errno.h>
#include <string.h>
#include <time.h>

#include <applibs/log.h>
#include <applibs/gpio.h>

// MT3620 GPIO LED
#define LED_GPIO 9

static int ledGpioFd = -1;
static bool ledState = false;

int main(void)
{
    Log_Debug("Starting Azure Sphere Blink Application\n");

    // Open LED GPIO
    ledGpioFd = GPIO_OpenAsOutput(LED_GPIO, GPIO_OutputMode_PushPull, GPIO_Value_High);
    if (ledGpioFd < 0) {
        Log_Debug("ERROR: Could not open LED GPIO: %s (%d).\n", strerror(errno), errno);
        return -1;
    }

    // Blink forever
    const struct timespec sleepTime = {.tv_sec = 1, .tv_nsec = 0};
    while (true) {
        ledState = !ledState;
        GPIO_SetValue(ledGpioFd, ledState ? GPIO_Value_Low : GPIO_Value_High);
        nanosleep(&sleepTime, NULL);
    }

    return 0;
}
```

### Application Manifest

```json
// app_manifest.json
{
    "SchemaVersion": 1,
    "Name": "BlinkApp",
    "ComponentId": "1689d8b2-c835-2e27-27ad-e894d6d15fa9",
    "EntryPoint": "/bin/app",
    "CmdArgs": [],
    "Capabilities": {
        "Gpio": [ 9 ],
        "AllowedConnections": [],
        "AllowedApplicationConnections": []
    },
    "ApplicationType": "Default"
}
```

### CMakeLists.txt

```cmake
cmake_minimum_required(VERSION 3.10)
project(BlinkApp C)

add_executable(${PROJECT_NAME} main.c)
target_link_libraries(${PROJECT_NAME} applibs pthread gcc_s c)

azsphere_target_hardware_definition(${PROJECT_NAME} TARGET_DIRECTORY "HardwareDefinitions/mt3620_rdb" TARGET_DEFINITION "template_appliance.json")
azsphere_target_add_image_package(${PROJECT_NAME})
```

## Connecting to IoT Hub

```c
// iot_hub.c - IoT Hub connection
#include <iothub_device_client_ll.h>
#include <iothub_client_options.h>
#include <iothubtransportmqtt.h>
#include <azure_sphere_provisioning.h>
#include <applibs/log.h>

static IOTHUB_DEVICE_CLIENT_LL_HANDLE iothubClientHandle = NULL;
static const char *scopeId = "<your-dps-scope-id>";

// Callback for connection status
static void ConnectionStatusCallback(
    IOTHUB_CLIENT_CONNECTION_STATUS result,
    IOTHUB_CLIENT_CONNECTION_STATUS_REASON reason,
    void *userContextCallback)
{
    Log_Debug("IoT Hub connection status: %s\n",
        result == IOTHUB_CLIENT_CONNECTION_AUTHENTICATED ? "Connected" : "Disconnected");
    Log_Debug("Reason: %d\n", reason);
}

// Callback for message confirmation
static void MessageConfirmationCallback(
    IOTHUB_CLIENT_CONFIRMATION_RESULT result,
    void *userContextCallback)
{
    Log_Debug("Message confirmation: %s\n",
        result == IOTHUB_CLIENT_CONFIRMATION_OK ? "OK" : "Failed");
}

bool SetupIoTHub(void)
{
    // Initialize DPS
    if (IoTHub_Init() != 0) {
        Log_Debug("ERROR: IoTHub_Init failed\n");
        return false;
    }

    // Set up authentication using Azure Sphere device certificate
    IOTHUB_DEVICE_CLIENT_LL_HANDLE handle;
    AZURE_SPHERE_PROV_RETURN_VALUE result = IoTHubDeviceClient_LL_CreateWithAzureSphereDeviceAuthProvisioning(
        scopeId, 10000, &handle);

    if (result.result != AZURE_SPHERE_PROV_RESULT_OK) {
        Log_Debug("ERROR: DPS provisioning failed: %d\n", result.result);
        return false;
    }

    iothubClientHandle = handle;

    // Set connection status callback
    IoTHubDeviceClient_LL_SetConnectionStatusCallback(
        iothubClientHandle, ConnectionStatusCallback, NULL);

    return true;
}

bool SendTelemetry(const char *jsonMessage)
{
    IOTHUB_MESSAGE_HANDLE messageHandle = IoTHubMessage_CreateFromString(jsonMessage);
    if (messageHandle == NULL) {
        Log_Debug("ERROR: Could not create message\n");
        return false;
    }

    // Set content type
    IoTHubMessage_SetContentTypeSystemProperty(messageHandle, "application%2fjson");
    IoTHubMessage_SetContentEncodingSystemProperty(messageHandle, "utf-8");

    // Send message
    IOTHUB_CLIENT_RESULT sendResult = IoTHubDeviceClient_LL_SendEventAsync(
        iothubClientHandle, messageHandle, MessageConfirmationCallback, NULL);

    IoTHubMessage_Destroy(messageHandle);

    if (sendResult != IOTHUB_CLIENT_OK) {
        Log_Debug("ERROR: Failed to send message: %d\n", sendResult);
        return false;
    }

    return true;
}

void DoWork(void)
{
    // Process IoT Hub messages
    IoTHubDeviceClient_LL_DoWork(iothubClientHandle);
}
```

### Manifest for IoT Hub

```json
{
    "SchemaVersion": 1,
    "Name": "IoTHubApp",
    "ComponentId": "abc12345-1234-1234-1234-123456789abc",
    "EntryPoint": "/bin/app",
    "CmdArgs": [ "<your-dps-scope-id>" ],
    "Capabilities": {
        "AllowedConnections": [
            "global.azure-devices-provisioning.net",
            "<your-iot-hub>.azure-devices.net"
        ],
        "DeviceAuthentication": "<your-tenant-id>",
        "Gpio": [ 9 ]
    },
    "ApplicationType": "Default"
}
```

## Real-Time Core Application

```c
// RTApp main.c - Real-time capable application
#include <ctype.h>
#include <stddef.h>
#include <stdbool.h>
#include <stdint.h>
#include <errno.h>

#include "mt3620-baremetal.h"
#include "mt3620-gpio.h"
#include "mt3620-timer.h"

#define LED_GPIO 8

static const uintptr_t GPT_BASE = 0x21030000;
static volatile bool ledOn = false;

// Timer callback - runs at high frequency
static void TimerCallback(void)
{
    static uint32_t counter = 0;
    counter++;

    // Toggle LED every 500ms (assuming 1kHz timer)
    if (counter >= 500) {
        counter = 0;
        ledOn = !ledOn;
        Mt3620_Gpio_Write(LED_GPIO, ledOn);
    }
}

_Noreturn void RTCoreMain(void)
{
    // Configure GPIO
    Mt3620_Gpio_ConfigurePinForOutput(LED_GPIO);

    // Configure timer for 1ms interval
    static const uint32_t timerFrequency = 1000;
    Mt3620_Timer_Init(GPT_BASE, timerFrequency);
    Mt3620_Timer_EnableInterrupt(GPT_BASE, TimerCallback);

    // Main loop
    while (true) {
        // Low-power wait for interrupt
        __asm__("wfi");
    }
}
```

## Inter-Core Communication

```c
// High-level app sending to RT core
#include <sys/socket.h>
#include <applibs/application.h>

static int sockFd = -1;
static const char rtAppComponentId[] = "005180bc-402f-4cb3-a662-72937dbcde47";

bool SetupInterCoreComm(void)
{
    sockFd = Application_Connect(rtAppComponentId);
    if (sockFd < 0) {
        Log_Debug("ERROR: Failed to connect to RT app: %s (%d)\n",
            strerror(errno), errno);
        return false;
    }
    return true;
}

bool SendToRTCore(const uint8_t *data, size_t length)
{
    ssize_t sent = send(sockFd, data, length, 0);
    if (sent < 0) {
        Log_Debug("ERROR: Failed to send: %s (%d)\n", strerror(errno), errno);
        return false;
    }
    return true;
}
```

## Over-the-Air Updates

```bash
# Create deployment
azsphere device-group deployment create \
    --device-group "Production/Field" \
    --images "1689d8b2-c835-2e27-27ad-e894d6d15fa9" \
    --images "005180bc-402f-4cb3-a662-72937dbcde47"

# Check deployment status
azsphere device-group deployment list \
    --device-group "Production/Field"

# Create product and device groups
azsphere product create --name "SmartSensor"
azsphere device-group create --product "SmartSensor" --name "Development"
azsphere device-group create --product "SmartSensor" --name "Production"

# Move device to production
azsphere device update --device-group "SmartSensor/Production"
```

## Security Features

```c
// Attestation and certificate handling
#include <tlsutils/deviceauth_curl.h>
#include <applibs/certstore.h>

// Get device certificate for mutual TLS
void ConfigureDeviceAuth(CURL *curl)
{
    // Azure Sphere automatically provides device authentication
    if (DeviceAuth_CurlSslFunc(curl) != CURLE_OK) {
        Log_Debug("ERROR: Failed to set up device auth\n");
    }
}

// Verify server certificate
CURLcode SslVerifyCallback(CURL *curl, void *sslctx, void *userptr)
{
    // Custom certificate verification if needed
    return CURLE_OK;
}
```

## Conclusion

Azure Sphere provides comprehensive IoT security:

- **Hardware root of trust**: Secured silicon with Pluton security subsystem
- **Defense in depth**: Multiple security layers from hardware to cloud
- **Automatic updates**: Over-the-air OS and application updates
- **Certificate-based auth**: Device-level identity and authentication
- **Real-time capable**: Support for time-critical workloads

It's ideal for mission-critical IoT applications requiring the highest security standards.
