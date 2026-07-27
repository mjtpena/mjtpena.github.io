---
title: "Azure Orbital Updates - Space Computing"
author: "Michael John Peña"
draft: false
date: 2022-10-09
tags: ["Azure", "Azure Orbital", "Satellite", "Space"]

---

I wrote "Azure Orbital Updates - Space Computing" to share practical, production-minded guidance on this topic.

## Azure Orbital Overview

### Ground Station Operations

```bash
# Create Azure Orbital ground station profile
az orbital spacecraft create \
    --name "my-satellite" \
    --resource-group "SpaceOps" \
    --location "westus2" \
    --norad-id "12345" \
    --links '[{
        "name": "downlink",
        "direction": "Downlink",
        "polarization": "RHCP",
        "centerFrequencyMHz": 8100,
        "bandwidthMHz": 15,
        "gainOverTemperature": 25
    }]' \
    --tle-line1 "1 12345U 22001A   22273.50000000  .00000000  00000-0  00000-0 0  9999" \
    --tle-line2 "2 12345  97.5000 180.0000 0001000  90.0000 270.0000 15.00000000    00"

# Create contact profile for scheduling
az orbital contact-profile create \
    --name "standard-contact" \
    --resource-group "SpaceOps" \
    --location "westus2" \
    --minimum-viable-contact-duration "PT5M" \
    --minimum-elevation-degrees 10 \
    --auto-tracking-configuration "xBand" \
    --links '[{
        "name": "downlink-channel",
        "direction": "Downlink",
        "polarization": "RHCP",
        "channels": [{
            "name": "channel1",
            "centerFrequencyMHz": 8100,
            "bandwidthMHz": 15,
            "endPoint": {
                "ipAddress": "10.0.0.1",
                "endPointName": "data-endpoint",
                "port": "5000",
                "protocol": "TCP"
            }
        }]
    }]'

# Schedule a contact
az orbital contact create \
    --name "contact-20221009" \
    --resource-group "SpaceOps" \
    --spacecraft-name "my-satellite" \
    --contact-profile-name "standard-contact" \
    --ground-station-name "Microsoft_Quincy" \
    --reservation-start-time "2022-10-09T10:00:00Z" \
    --reservation-end-time "2022-10-09T10:15:00Z"
```

### Processing Satellite Data

```csharp
using Azure.Orbital;
using Azure.Storage.Blobs;

public class SatelliteDataProcessor
{
    private readonly BlobServiceClient _blobClient;
    private readonly OrbitalClient _orbitalClient;

    public async Task ProcessContactDataAsync(string contactId)
    {
        // Get contact details
        var contact = await _orbitalClient.GetContactAsync(contactId);

        if (contact.Status != ContactStatus.Succeeded)
        {
            throw new Exception($"Contact {contactId} did not complete successfully");
        }

        // Download raw data from storage
        var rawDataPath = $"contacts/{contactId}/raw";
        var container = _blobClient.GetBlobContainerClient("satellite-data");

        await foreach (var blob in container.GetBlobsAsync(prefix: rawDataPath))
        {
            var blobClient = container.GetBlobClient(blob.Name);
            var rawData = await blobClient.DownloadContentAsync();

            // Process the satellite data
            var processedData = ProcessRawData(rawData.Value.Content.ToArray());

            // Store processed data
            var processedPath = $"contacts/{contactId}/processed/{Path.GetFileName(blob.Name)}";
            var processedBlob = container.GetBlobClient(processedPath);
            await processedBlob.UploadAsync(new BinaryData(processedData));
        }
    }

    private byte[] ProcessRawData(byte[] rawData)
    {
        // Implement satellite-specific data processing
        // - Demodulation
        // - Error correction
        // - Frame synchronization
        // - Data extraction

        return rawData; // Placeholder
    }
}
```

### Earth Observation Pipeline

```python
# Earth observation data processing pipeline
import rasterio
import numpy as np
from azure.storage.blob import BlobServiceClient
from azure.ai.ml import MLClient
import json

class EarthObservationPipeline:
    def __init__(self, storage_connection, ml_workspace):
        self.blob_client = BlobServiceClient.from_connection_string(storage_connection)
        self.ml_client = ml_workspace

    async def process_satellite_image(self, image_path):
        """Process satellite imagery for analysis"""

        # Download from blob storage
        container = self.blob_client.get_container_client("satellite-imagery")
        blob = container.get_blob_client(image_path)
        image_data = blob.download_blob().readall()

        # Save temporarily and open with rasterio
        with open("/tmp/satellite_image.tif", "wb") as f:
            f.write(image_data)

        with rasterio.open("/tmp/satellite_image.tif") as src:
            # Read bands
            red = src.read(4)    # Band 4 typically red
            nir = src.read(5)    # Band 5 typically NIR

            # Calculate NDVI (Normalized Difference Vegetation Index)
            ndvi = self.calculate_ndvi(red, nir)

            # Detect changes if previous image exists
            changes = await self.detect_changes(image_path, ndvi)

            # Generate report
            report = {
                "image_path": image_path,
                "timestamp": datetime.utcnow().isoformat(),
                "ndvi_stats": {
                    "mean": float(np.nanmean(ndvi)),
                    "min": float(np.nanmin(ndvi)),
                    "max": float(np.nanmax(ndvi))
                },
                "changes_detected": changes
            }

            return report

    def calculate_ndvi(self, red, nir):
        """Calculate NDVI from red and NIR bands"""
        red = red.astype(np.float32)
        nir = nir.astype(np.float32)

        # Avoid division by zero
        denominator = nir + red
        denominator[denominator == 0] = np.nan

        ndvi = (nir - red) / denominator
        return ndvi

    async def detect_changes(self, current_path, current_ndvi):
        """Detect changes compared to previous observation"""
        # Get previous observation for same location
        previous_path = self.get_previous_observation(current_path)

        if not previous_path:
            return None

        # Load previous NDVI
        container = self.blob_client.get_container_client("processed-data")
        previous_blob = container.get_blob_client(previous_path)
        previous_ndvi = np.load(BytesIO(previous_blob.download_blob().readall()))

        # Calculate change
        change = current_ndvi - previous_ndvi
        significant_change = np.abs(change) > 0.2

        return {
            "areas_changed": int(np.sum(significant_change)),
            "percentage_changed": float(np.mean(significant_change) * 100),
            "average_change": float(np.nanmean(change))
        }

    async def run_ml_analysis(self, image_path):
        """Run ML model for advanced analysis"""
        # Submit to Azure ML for analysis
        job = self.ml_client.jobs.create_or_update(
            command="python analyze.py --input " + image_path,
            compute="gpu-cluster",
            environment="satellite-analysis-env:1"
        )

        return job.name
```

### Contact Scheduling

```csharp
public class ContactScheduler
{
    private readonly OrbitalClient _client;

    public async Task<List<ScheduledContact>> ScheduleOptimalContactsAsync(
        string spacecraftId,
        DateTimeOffset startTime,
        DateTimeOffset endTime,
        int minContactMinutes = 5)
    {
        // Get available passes
        var passes = await _client.GetAvailablePassesAsync(
            spacecraftId,
            startTime,
            endTime);

        var scheduledContacts = new List<ScheduledContact>();

        foreach (var pass in passes.Where(p => p.DurationMinutes >= minContactMinutes))
        {
            // Check ground station availability
            var isAvailable = await CheckGroundStationAvailabilityAsync(
                pass.GroundStationName,
                pass.StartTime,
                pass.EndTime);

            if (isAvailable)
            {
                // Schedule the contact
                var contact = await _client.CreateContactAsync(new ContactRequest
                {
                    SpacecraftId = spacecraftId,
                    GroundStationName = pass.GroundStationName,
                    StartTime = pass.StartTime,
                    EndTime = pass.EndTime,
                    ContactProfileId = "standard-contact"
                });

                scheduledContacts.Add(new ScheduledContact
                {
                    ContactId = contact.Id,
                    StartTime = pass.StartTime,
                    EndTime = pass.EndTime,
                    GroundStation = pass.GroundStationName,
                    MaxElevation = pass.MaxElevationDegrees
                });
            }
        }

        return scheduledContacts;
    }
}
```

## Use Cases

1. **Earth observation** - Environmental monitoring and mapping
2. **Weather forecasting** - Meteorological satellite data
3. **Communications** - Satellite internet ground stations
4. **Maritime tracking** - AIS data collection
5. **Scientific research** - Space science missions

Azure Orbital brings space data directly into the Azure ecosystem for processing and analysis.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
