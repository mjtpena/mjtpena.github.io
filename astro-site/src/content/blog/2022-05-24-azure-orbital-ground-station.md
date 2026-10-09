---
title: "Azure Orbital: Ground Station as a Service"
author: Michael John Peña
draft: false
date: 2022-05-24
tags:
  - Azure
  - orbital
  - satellite
  - space
---

## Understanding Azure Orbital

Azure Orbital offers:
- Global ground station network
- Satellite communication management
- Data processing pipelines
- Integration with Azure services

## Setting Up a Spacecraft Contact

Configure satellite communication:

```bicep
resource orbital 'Microsoft.Orbital/spacecrafts@2022-03-01' = {
  name: 'weather-sat-1'
  location: 'global'
  properties: {
    noradId: '12345'
    titleLine: 'WEATHER-SAT-1'
    tleLine1: '1 12345U 22001A   22121.50000000  .00000000  00000-0  00000-0 0  9999'
    tleLine2: '2 12345  98.2000 120.0000 0001000  90.0000 270.0000 14.50000000000000'
    links: [
      {
        name: 'downlink'
        centerFrequencyMHz: 8200
        bandwidthMHz: 50
        direction: 'Downlink'
        polarization: 'RHCP'
      }
      {
        name: 'uplink'
        centerFrequencyMHz: 2025
        bandwidthMHz: 5
        direction: 'Uplink'
        polarization: 'LHCP'
      }
    ]
  }
}

resource contactProfile 'Microsoft.Orbital/contactProfiles@2022-03-01' = {
  name: 'weather-contact-profile'
  location: 'westus2'
  properties: {
    minimumViableContactDuration: 'PT5M'
    minimumElevationDegrees: 10
    autoTrackingConfiguration: 'Disabled'
    links: [
      {
        name: 'downlink-profile'
        polarization: 'RHCP'
        direction: 'Downlink'
        gainOverTemperature: 25
        eirpdBW: 0
        channels: [
          {
            name: 'channel1'
            centerFrequencyMHz: 8200
            bandwidthMHz: 50
            endPoint: {
              endPointName: 'data-endpoint'
              ipAddress: '10.0.0.5'
              port: '50000'
              protocol: 'UDP'
            }
            modulationConfiguration: {
              modulation: 'QPSK'
            }
            demodulationConfiguration: {
              modulation: 'QPSK'
            }
            encodingConfiguration: null
            decodingConfiguration: {
              decodingType: 'viterbidecoder'
              modulation: 'QPSK'
            }
          }
        ]
      }
    ]
  }
}
```

## Scheduling Satellite Contacts

```csharp
using Azure.ResourceManager.Orbital;
using Azure.ResourceManager.Orbital.Models;

public class SatelliteContactService
{
    private readonly ArmClient _armClient;
    private readonly string _subscriptionId;

    public SatelliteContactService(string subscriptionId)
    {
        _armClient = new ArmClient(new DefaultAzureCredential());
        _subscriptionId = subscriptionId;
    }

    public async Task<IEnumerable<AvailableContact>> GetAvailableContactsAsync(
        string spacecraftName,
        string groundStationName,
        DateTime startTime,
        DateTime endTime)
    {
        var subscription = await _armClient.GetDefaultSubscriptionAsync();
        var spacecraft = await subscription.GetSpacecrafts()
            .GetAsync(spacecraftName);

        var parameters = new ContactParameters
        {
            ContactProfile = new ResourceIdentifier(
                $"/subscriptions/{_subscriptionId}/resourceGroups/orbital-rg/providers/Microsoft.Orbital/contactProfiles/weather-contact-profile"),
            GroundStationName = groundStationName,
            StartTime = startTime,
            EndTime = endTime
        };

        var contacts = spacecraft.Value.GetAvailableContacts(parameters);
        return contacts;
    }

    public async Task<SpacecraftContactResource> ScheduleContactAsync(
        string spacecraftName,
        string contactName,
        AvailableContact availableContact)
    {
        var subscription = await _armClient.GetDefaultSubscriptionAsync();
        var spacecraft = await subscription.GetSpacecrafts()
            .GetAsync(spacecraftName);

        var contactData = new SpacecraftContactData
        {
            ContactProfile = availableContact.ContactProfile,
            GroundStationName = availableContact.GroundStationName,
            ReservationStartTime = availableContact.StartTime,
            ReservationEndTime = availableContact.EndTime
        };

        var contact = await spacecraft.Value.GetSpacecraftContacts()
            .CreateOrUpdateAsync(WaitUntil.Completed, contactName, contactData);

        return contact.Value;
    }
}
```

## Processing Satellite Data

Azure Functions for data processing:

```csharp
public class SatelliteDataProcessor
{
    private readonly BlobServiceClient _blobClient;
    private readonly ILogger<SatelliteDataProcessor> _logger;

    [FunctionName("ProcessSatelliteData")]
    public async Task Run(
        [BlobTrigger("satellite-raw/{name}", Connection = "StorageConnection")]
        Stream inputBlob,
        string name,
        [Blob("satellite-processed/{name}", FileAccess.Write)]
        Stream outputBlob)
    {
        _logger.LogInformation($"Processing satellite data: {name}");

        // Parse raw satellite telemetry
        var telemetry = await ParseTelemetryAsync(inputBlob);

        // Process and extract data
        var processedData = ProcessTelemetry(telemetry);

        // Save processed data
        await SaveProcessedDataAsync(processedData, outputBlob);

        // Send to Event Hub for real-time analysis
        await SendToEventHubAsync(processedData);
    }

    private async Task<SatelliteTelemetry> ParseTelemetryAsync(Stream stream)
    {
        using var reader = new BinaryReader(stream);

        // Parse CCSDS packet structure
        var primaryHeader = new CcsdsHeader
        {
            VersionNumber = (reader.ReadByte() >> 5) & 0x07,
            PacketType = (reader.ReadByte() >> 4) & 0x01,
            SecondaryHeaderFlag = (reader.ReadByte() >> 3) & 0x01,
            ApplicationId = reader.ReadUInt16(),
            SequenceFlags = (reader.ReadByte() >> 6) & 0x03,
            SequenceCount = reader.ReadUInt16(),
            PacketDataLength = reader.ReadUInt16()
        };

        // Read payload
        var payload = reader.ReadBytes(primaryHeader.PacketDataLength + 1);

        return new SatelliteTelemetry
        {
            Header = primaryHeader,
            Timestamp = DateTime.UtcNow,
            RawPayload = payload
        };
    }

    private ProcessedSatelliteData ProcessTelemetry(SatelliteTelemetry telemetry)
    {
        // Extract sensor readings from payload
        var temperature = ExtractTemperature(telemetry.RawPayload);
        var position = ExtractPosition(telemetry.RawPayload);
        var imageData = ExtractImageData(telemetry.RawPayload);

        return new ProcessedSatelliteData
        {
            SatelliteId = telemetry.Header.ApplicationId.ToString(),
            Timestamp = telemetry.Timestamp,
            Temperature = temperature,
            Position = position,
            ImageData = imageData
        };
    }

    private double ExtractTemperature(byte[] payload)
    {
        // Temperature at offset 0, 2 bytes, 0.01 degree resolution
        var raw = BitConverter.ToInt16(payload, 0);
        return raw * 0.01;
    }

    private GeoPosition ExtractPosition(byte[] payload)
    {
        // Position at offset 2, 12 bytes (lat: 4, lon: 4, alt: 4)
        return new GeoPosition
        {
            Latitude = BitConverter.ToSingle(payload, 2),
            Longitude = BitConverter.ToSingle(payload, 6),
            Altitude = BitConverter.ToSingle(payload, 10)
        };
    }

    private byte[] ExtractImageData(byte[] payload)
    {
        // Image data starts at offset 14
        var imageLength = payload.Length - 14;
        var imageData = new byte[imageLength];
        Array.Copy(payload, 14, imageData, 0, imageLength);
        return imageData;
    }

    private async Task SendToEventHubAsync(ProcessedSatelliteData data)
    {
        var eventHubClient = new EventHubProducerClient(
            Environment.GetEnvironmentVariable("EventHubConnection"),
            "satellite-telemetry");

        var eventData = new EventData(JsonSerializer.SerializeToUtf8Bytes(data));
        await eventHubClient.SendAsync(new[] { eventData });
    }
}

public record CcsdsHeader
{
    public int VersionNumber { get; init; }
    public int PacketType { get; init; }
    public int SecondaryHeaderFlag { get; init; }
    public ushort ApplicationId { get; init; }
    public int SequenceFlags { get; init; }
    public ushort SequenceCount { get; init; }
    public ushort PacketDataLength { get; init; }
}

public record SatelliteTelemetry
{
    public CcsdsHeader Header { get; init; }
    public DateTime Timestamp { get; init; }
    public byte[] RawPayload { get; init; }
}

public record ProcessedSatelliteData
{
    public string SatelliteId { get; init; }
    public DateTime Timestamp { get; init; }
    public double Temperature { get; init; }
    public GeoPosition Position { get; init; }
    public byte[] ImageData { get; init; }
}

public record GeoPosition
{
    public float Latitude { get; init; }
    public float Longitude { get; init; }
    public float Altitude { get; init; }
}
```

## Real-Time Visualization

Display satellite data on a map:

```typescript
// React component for satellite tracking
import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline } from 'react-leaflet';

interface SatellitePosition {
  satelliteId: string;
  latitude: number;
  longitude: number;
  altitude: number;
  timestamp: string;
}

export const SatelliteTracker: React.FC = () => {
  const [positions, setPositions] = useState<SatellitePosition[]>([]);
  const [track, setTrack] = useState<[number, number][]>([]);

  useEffect(() => {
    const ws = new WebSocket('wss://api.example.com/satellite/realtime');

    ws.onmessage = (event) => {
      const position: SatellitePosition = JSON.parse(event.data);
      setPositions(prev => [...prev.slice(-100), position]);
      setTrack(prev => [...prev.slice(-500), [position.latitude, position.longitude]]);
    };

    return () => ws.close();
  }, []);

  const latestPosition = positions[positions.length - 1];

  return (
    <div className="satellite-tracker">
      <MapContainer center={[0, 0]} zoom={2} style={{ height: '600px' }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {latestPosition && (
          <Marker position={[latestPosition.latitude, latestPosition.longitude]} />
        )}

        {track.length > 1 && (
          <Polyline positions={track} color="blue" weight={2} />
        )}
      </MapContainer>

      {latestPosition && (
        <div className="satellite-info">
          <h3>Satellite: {latestPosition.satelliteId}</h3>
          <p>Latitude: {latestPosition.latitude.toFixed(4)}</p>
          <p>Longitude: {latestPosition.longitude.toFixed(4)}</p>
          <p>Altitude: {latestPosition.altitude.toFixed(2)} km</p>
          <p>Last Update: {new Date(latestPosition.timestamp).toLocaleTimeString()}</p>
        </div>
      )}
    </div>
  );
};
```

## Summary

Azure Orbital enables:

- Global satellite communication
- Managed ground station infrastructure
- Integration with Azure data services
- Real-time data processing
- Space data democratization

Access space capabilities without massive infrastructure investment.
