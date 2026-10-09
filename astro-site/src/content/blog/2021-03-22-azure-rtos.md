---
title: Azure RTOS for Real-Time IoT Applications
author: Michael John Pena
draft: false
date: 2021-03-22
url: /blog/azure-rtos/
tags:
  - Azure
  - RTOS
  - IoT
  - Embedded Systems
  - ThreadX
---

## Azure RTOS Components

- **ThreadX**: RTOS kernel with preemptive scheduling
- **NetX Duo**: TCP/IP network stack (IPv4 and IPv6)
- **FileX**: FAT-compatible embedded file system
- **GUIX**: Graphics UI framework
- **USBX**: USB host and device stack
- **LevelX**: NAND/NOR flash wear leveling

## Getting Started with ThreadX

### Thread Creation

```c
#include "tx_api.h"

#define THREAD_STACK_SIZE   1024
#define THREAD_PRIORITY     4

static TX_THREAD sensor_thread;
static TX_THREAD network_thread;
static UCHAR sensor_thread_stack[THREAD_STACK_SIZE];
static UCHAR network_thread_stack[THREAD_STACK_SIZE];

// Sensor reading thread
void sensor_thread_entry(ULONG thread_input)
{
    while (1)
    {
        // Read sensor data
        float temperature = read_temperature_sensor();
        float humidity = read_humidity_sensor();

        // Store in shared buffer (with mutex protection)
        store_sensor_data(temperature, humidity);

        // Sleep for 1 second (100 ticks at 100Hz)
        tx_thread_sleep(100);
    }
}

// Network communication thread
void network_thread_entry(ULONG thread_input)
{
    while (1)
    {
        // Wait for data to send
        tx_semaphore_get(&data_ready_semaphore, TX_WAIT_FOREVER);

        // Send to Azure IoT Hub
        send_telemetry_to_azure();
    }
}

int main(void)
{
    // Enter ThreadX kernel
    tx_kernel_enter();
    return 0;
}

void tx_application_define(void *first_unused_memory)
{
    // Create sensor thread
    tx_thread_create(
        &sensor_thread,
        "Sensor Thread",
        sensor_thread_entry,
        0,
        sensor_thread_stack,
        THREAD_STACK_SIZE,
        THREAD_PRIORITY,
        THREAD_PRIORITY,
        TX_NO_TIME_SLICE,
        TX_AUTO_START
    );

    // Create network thread (lower priority)
    tx_thread_create(
        &network_thread,
        "Network Thread",
        network_thread_entry,
        0,
        network_thread_stack,
        THREAD_STACK_SIZE,
        THREAD_PRIORITY + 1,
        THREAD_PRIORITY + 1,
        TX_NO_TIME_SLICE,
        TX_AUTO_START
    );
}
```

### Synchronization Primitives

```c
#include "tx_api.h"

static TX_MUTEX data_mutex;
static TX_SEMAPHORE data_ready_semaphore;
static TX_EVENT_FLAGS_GROUP event_flags;
static TX_QUEUE message_queue;

// Shared data
typedef struct {
    float temperature;
    float humidity;
    ULONG timestamp;
} sensor_data_t;

static sensor_data_t shared_data;
static UCHAR queue_memory[sizeof(sensor_data_t) * 10];

void initialize_sync_objects(void)
{
    // Create mutex for data protection
    tx_mutex_create(&data_mutex, "Data Mutex", TX_NO_INHERIT);

    // Create semaphore for signaling
    tx_semaphore_create(&data_ready_semaphore, "Data Ready", 0);

    // Create event flags
    tx_event_flags_create(&event_flags, "Sensor Events");

    // Create message queue
    tx_queue_create(
        &message_queue,
        "Sensor Queue",
        sizeof(sensor_data_t) / sizeof(ULONG),
        queue_memory,
        sizeof(queue_memory)
    );
}

void store_sensor_data(float temp, float humidity)
{
    sensor_data_t data;
    data.temperature = temp;
    data.humidity = humidity;
    data.timestamp = tx_time_get();

    // Protect shared data with mutex
    tx_mutex_get(&data_mutex, TX_WAIT_FOREVER);
    shared_data = data;
    tx_mutex_put(&data_mutex);

    // Signal data ready
    tx_semaphore_put(&data_ready_semaphore);

    // Set event flag
    tx_event_flags_set(&event_flags, 0x01, TX_OR);

    // Send to queue
    tx_queue_send(&message_queue, &data, TX_NO_WAIT);
}
```

## NetX Duo for Azure Connectivity

```c
#include "nx_api.h"
#include "nxd_mqtt_client.h"
#include "nx_azure_iot.h"
#include "nx_azure_iot_hub_client.h"

#define AZURE_IOT_HUB_HOSTNAME    "myhub.azure-devices.net"
#define AZURE_IOT_HUB_DEVICE_ID   "mydevice"

static NX_IP nx_ip;
static NX_PACKET_POOL nx_pool;
static NX_AZURE_IOT nx_azure_iot;
static NX_AZURE_IOT_HUB_CLIENT hub_client;

// Initialize network stack
UINT initialize_network(void)
{
    UINT status;

    // Create packet pool
    status = nx_packet_pool_create(
        &nx_pool,
        "Packet Pool",
        NX_PACKET_SIZE,
        packet_pool_memory,
        PACKET_POOL_SIZE
    );
    if (status != NX_SUCCESS) return status;

    // Create IP instance
    status = nx_ip_create(
        &nx_ip,
        "IP Instance",
        IP_ADDRESS(0, 0, 0, 0),  // DHCP will assign
        IP_MASK,
        &nx_pool,
        ethernet_driver,
        ip_thread_stack,
        IP_THREAD_STACK_SIZE,
        IP_THREAD_PRIORITY
    );
    if (status != NX_SUCCESS) return status;

    // Enable ARP, UDP, TCP
    nx_arp_enable(&nx_ip, arp_cache, ARP_CACHE_SIZE);
    nx_udp_enable(&nx_ip);
    nx_tcp_enable(&nx_ip);
    nx_icmp_enable(&nx_ip);

    // Start DHCP
    status = nx_dhcp_start(&dhcp_client);

    return status;
}

// Connect to Azure IoT Hub
UINT connect_to_azure_iot_hub(void)
{
    UINT status;

    // Initialize Azure IoT
    status = nx_azure_iot_create(
        &nx_azure_iot,
        (UCHAR *)"Azure IoT",
        &nx_ip,
        &nx_pool,
        &nx_dns,
        azure_iot_thread_stack,
        AZURE_IOT_THREAD_STACK_SIZE,
        AZURE_IOT_THREAD_PRIORITY,
        unix_time_get
    );
    if (status != NX_AZURE_IOT_SUCCESS) return status;

    // Initialize hub client
    status = nx_azure_iot_hub_client_initialize(
        &hub_client,
        &nx_azure_iot,
        (UCHAR *)AZURE_IOT_HUB_HOSTNAME,
        sizeof(AZURE_IOT_HUB_HOSTNAME) - 1,
        (UCHAR *)AZURE_IOT_HUB_DEVICE_ID,
        sizeof(AZURE_IOT_HUB_DEVICE_ID) - 1,
        NULL, 0,
        _nx_azure_iot_tls_supported_crypto,
        _nx_azure_iot_tls_supported_crypto_size,
        _nx_azure_iot_tls_ciphersuite_map,
        _nx_azure_iot_tls_ciphersuite_map_size,
        nx_azure_iot_tls_metadata_buffer,
        sizeof(nx_azure_iot_tls_metadata_buffer),
        &root_ca_cert
    );
    if (status != NX_AZURE_IOT_SUCCESS) return status;

    // Set device symmetric key
    status = nx_azure_iot_hub_client_symmetric_key_set(
        &hub_client,
        (UCHAR *)DEVICE_SYMMETRIC_KEY,
        sizeof(DEVICE_SYMMETRIC_KEY) - 1
    );
    if (status != NX_AZURE_IOT_SUCCESS) return status;

    // Connect
    status = nx_azure_iot_hub_client_connect(&hub_client, NX_TRUE, NX_WAIT_FOREVER);

    return status;
}

// Send telemetry
UINT send_telemetry(float temperature, float humidity)
{
    UINT status;
    NX_PACKET *packet;
    CHAR buffer[128];

    // Create telemetry message
    snprintf(buffer, sizeof(buffer),
        "{\"temperature\":%.2f,\"humidity\":%.2f}",
        temperature, humidity);

    // Allocate packet
    status = nx_azure_iot_hub_client_telemetry_message_create(
        &hub_client,
        &packet,
        NX_WAIT_FOREVER
    );
    if (status != NX_AZURE_IOT_SUCCESS) return status;

    // Add message body
    status = nx_packet_data_append(
        packet,
        buffer,
        strlen(buffer),
        &nx_pool,
        NX_WAIT_FOREVER
    );
    if (status != NX_SUCCESS) {
        nx_azure_iot_hub_client_telemetry_message_delete(packet);
        return status;
    }

    // Send
    status = nx_azure_iot_hub_client_telemetry_send(
        &hub_client,
        packet,
        NULL, 0,
        NX_WAIT_FOREVER
    );

    return status;
}
```

## Device Twin Handling

```c
// Receive desired properties
void device_twin_desired_property_callback(
    NX_AZURE_IOT_HUB_CLIENT *hub_client_ptr,
    UCHAR *component_name,
    UINT component_name_length,
    NX_AZURE_IOT_JSON_READER *reader_ptr,
    UINT version,
    VOID *context)
{
    CHAR property_name[64];
    UINT property_name_length;

    while (nx_azure_iot_json_reader_next_property_name(
        reader_ptr, (UCHAR *)property_name, sizeof(property_name),
        &property_name_length) == NX_AZURE_IOT_SUCCESS)
    {
        if (strncmp(property_name, "telemetryInterval", property_name_length) == 0)
        {
            INT32 value;
            if (nx_azure_iot_json_reader_token_int32_get(reader_ptr, &value) ==
                NX_AZURE_IOT_SUCCESS)
            {
                // Update telemetry interval
                telemetry_interval = value;

                // Report back
                report_property("telemetryInterval", value, version);
            }
        }
    }
}

// Report properties
UINT report_property(const CHAR *name, INT32 value, UINT version)
{
    CHAR buffer[256];
    snprintf(buffer, sizeof(buffer),
        "{\"%s\":{\"value\":%d,\"ac\":200,\"av\":%u,\"ad\":\"Success\"}}",
        name, value, version);

    return nx_azure_iot_hub_client_reported_properties_send(
        &hub_client,
        (UCHAR *)buffer,
        strlen(buffer),
        NULL, NULL,
        NX_WAIT_FOREVER
    );
}

// Setup twin callbacks
void setup_device_twin(void)
{
    // Enable twin
    nx_azure_iot_hub_client_device_twin_enable(&hub_client);

    // Set callback
    nx_azure_iot_hub_client_device_twin_desired_properties_receive(
        &hub_client,
        device_twin_desired_property_callback,
        NULL
    );

    // Request current twin
    nx_azure_iot_hub_client_device_twin_properties_request(
        &hub_client,
        NX_WAIT_FOREVER
    );
}
```

## Direct Method Handling

```c
// Method callback
void direct_method_callback(
    NX_AZURE_IOT_HUB_CLIENT *hub_client_ptr,
    UCHAR *method_name,
    USHORT method_name_length,
    UCHAR *payload,
    USHORT payload_length,
    VOID *context,
    USHORT context_length)
{
    UINT status = 200;
    CHAR response[128] = "{}";

    if (strncmp((CHAR *)method_name, "reboot", method_name_length) == 0)
    {
        // Schedule reboot
        schedule_reboot();
        snprintf(response, sizeof(response),
            "{\"status\":\"Rebooting in 5 seconds\"}");
    }
    else if (strncmp((CHAR *)method_name, "setLed", method_name_length) == 0)
    {
        // Parse payload and set LED
        BOOL led_state = parse_led_state(payload, payload_length);
        set_led(led_state);
        snprintf(response, sizeof(response),
            "{\"led\":%s}", led_state ? "true" : "false");
    }
    else
    {
        status = 404;
        snprintf(response, sizeof(response),
            "{\"error\":\"Method not found\"}");
    }

    // Send response
    nx_azure_iot_hub_client_direct_method_message_response(
        hub_client_ptr,
        status,
        context,
        context_length,
        (UCHAR *)response,
        strlen(response),
        NX_WAIT_FOREVER
    );
}

// Enable direct methods
void setup_direct_methods(void)
{
    nx_azure_iot_hub_client_direct_method_enable(&hub_client);
    nx_azure_iot_hub_client_direct_method_message_callback_set(
        &hub_client,
        direct_method_callback,
        NULL, 0
    );
}
```

## Memory and Performance

```c
// Memory usage statistics
void print_memory_stats(void)
{
    TX_THREAD *thread_ptr;
    ULONG available;
    ULONG fragments;

    // Thread stack usage
    tx_thread_info_get(
        &sensor_thread,
        TX_NULL, TX_NULL, TX_NULL,
        TX_NULL, TX_NULL, TX_NULL,
        TX_NULL, TX_NULL
    );

    // Byte pool statistics
    tx_byte_pool_info_get(
        &memory_pool,
        TX_NULL,
        &available,
        &fragments,
        TX_NULL, TX_NULL, TX_NULL
    );

    printf("Available memory: %lu bytes, Fragments: %lu\n",
        available, fragments);
}

// Performance counters
void print_performance_stats(void)
{
    ULONG total_threads;
    ULONG ready_threads;
    ULONG suspended_threads;

    tx_thread_performance_system_info_get(
        TX_NULL, TX_NULL, TX_NULL,
        &total_threads, &ready_threads, &suspended_threads,
        TX_NULL, TX_NULL, TX_NULL
    );

    printf("Threads: Total=%lu, Ready=%lu, Suspended=%lu\n",
        total_threads, ready_threads, suspended_threads);
}
```

## Conclusion

Azure RTOS provides:

- **Deterministic performance**: Predictable response times for real-time requirements
- **Small footprint**: As little as 2KB ROM and 1KB RAM for the kernel
- **Safety certifications**: IEC 61508, ISO 26262, IEC 62304 pre-certified
- **Azure integration**: Native support for Azure IoT services
- **Rich ecosystem**: Network, file system, USB, and graphics components

It's ideal for resource-constrained devices requiring real-time performance and Azure connectivity.
