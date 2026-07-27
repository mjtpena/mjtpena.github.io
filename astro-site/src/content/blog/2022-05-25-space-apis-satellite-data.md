---
title: "Space APIs: Working with Satellite Data on Azure"
author: Michael John Peña
draft: false
date: 2022-05-25
tags:
  - azure
  - space
  - satellite
  - geospatial

---

I wrote "Space APIs: Working with Satellite Data on Azure" to share practical, production-minded guidance on this topic.

## Azure Space Data APIs

Microsoft's partnership with space industry providers enables access to various satellite data:

```csharp
// Configure satellite data client
public class SpaceDataClient
{
    private readonly HttpClient _httpClient;
    private readonly string _apiKey;

    public SpaceDataClient(string apiKey)
    {
        _apiKey = apiKey;
        _httpClient = new HttpClient
        {
            BaseAddress = new Uri("https://api.spacedata.azure.com/v1/")
        };
        _httpClient.DefaultRequestHeaders.Add("X-API-Key", apiKey);
    }

    public async Task<SatelliteImageCatalog> SearchImagesAsync(
        GeoPolygon areaOfInterest,
        DateTime startDate,
        DateTime endDate,
        double maxCloudCover = 20)
    {
        var request = new ImageSearchRequest
        {
            Geometry = areaOfInterest,
            DateRange = new DateRange(startDate, endDate),
            MaxCloudCover = maxCloudCover,
            Providers = new[] { "Sentinel-2", "Landsat-8" }
        };

        var response = await _httpClient.PostAsJsonAsync("images/search", request);
        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<SatelliteImageCatalog>();
    }

    public async Task<Stream> DownloadImageAsync(
        string imageId,
        string[] bands = null)
    {
        var url = $"images/{imageId}/download";
        if (bands != null && bands.Length > 0)
        {
            url += $"?bands={string.Join(",", bands)}";
        }

        return await _httpClient.GetStreamAsync(url);
    }
}

public record ImageSearchRequest
{
    public GeoPolygon Geometry { get; init; }
    public DateRange DateRange { get; init; }
    public double MaxCloudCover { get; init; }
    public string[] Providers { get; init; }
}

public record GeoPolygon
{
    public string Type => "Polygon";
    public double[][][] Coordinates { get; init; }
}

public record DateRange(DateTime Start, DateTime End);

public record SatelliteImageCatalog
{
    public List<SatelliteImage> Images { get; init; }
    public int TotalCount { get; init; }
}

public record SatelliteImage
{
    public string Id { get; init; }
    public string Provider { get; init; }
    public DateTime AcquisitionDate { get; init; }
    public double CloudCover { get; init; }
    public GeoPolygon Footprint { get; init; }
    public string[] AvailableBands { get; init; }
    public double Resolution { get; init; }
}
```

## Processing Satellite Imagery

Use Azure Functions for image processing:

```python
# Azure Function for satellite image analysis
import azure.functions as func
import rasterio
import numpy as np
from rasterio.io import MemoryFile
from azure.storage.blob import BlobServiceClient

def main(blob: func.InputStream) -> str:
    """Process satellite imagery for vegetation analysis."""

    # Read the image from blob storage
    with MemoryFile(blob.read()) as memfile:
        with memfile.open() as dataset:
            # Read bands (assuming Sentinel-2 ordering)
            red = dataset.read(4).astype(float)   # Band 4 - Red
            nir = dataset.read(8).astype(float)   # Band 8 - NIR

            # Calculate NDVI (Normalized Difference Vegetation Index)
            ndvi = calculate_ndvi(red, nir)

            # Calculate vegetation statistics
            stats = calculate_vegetation_stats(ndvi)

            # Save processed NDVI image
            save_ndvi_image(ndvi, dataset.profile, blob.name)

            return json.dumps(stats)


def calculate_ndvi(red: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """Calculate NDVI from red and NIR bands."""
    # Avoid division by zero
    denominator = nir + red
    denominator[denominator == 0] = 1

    ndvi = (nir - red) / denominator

    # Clip to valid NDVI range
    ndvi = np.clip(ndvi, -1, 1)

    return ndvi


def calculate_vegetation_stats(ndvi: np.ndarray) -> dict:
    """Calculate vegetation statistics from NDVI."""
    # Classify vegetation
    bare_soil = np.sum((ndvi >= -1) & (ndvi < 0.1))
    sparse_vegetation = np.sum((ndvi >= 0.1) & (ndvi < 0.3))
    moderate_vegetation = np.sum((ndvi >= 0.3) & (ndvi < 0.5))
    dense_vegetation = np.sum((ndvi >= 0.5) & (ndvi <= 1))

    total_pixels = ndvi.size

    return {
        "mean_ndvi": float(np.nanmean(ndvi)),
        "max_ndvi": float(np.nanmax(ndvi)),
        "min_ndvi": float(np.nanmin(ndvi)),
        "bare_soil_percent": float(bare_soil / total_pixels * 100),
        "sparse_vegetation_percent": float(sparse_vegetation / total_pixels * 100),
        "moderate_vegetation_percent": float(moderate_vegetation / total_pixels * 100),
        "dense_vegetation_percent": float(dense_vegetation / total_pixels * 100)
    }


def save_ndvi_image(ndvi: np.ndarray, profile: dict, original_name: str):
    """Save NDVI as a GeoTIFF."""
    # Update profile for single-band output
    profile.update(
        dtype=rasterio.float32,
        count=1,
        compress='lzw'
    )

    output_name = original_name.replace('.tif', '_ndvi.tif')

    blob_service = BlobServiceClient.from_connection_string(
        os.environ['STORAGE_CONNECTION_STRING']
    )
    container = blob_service.get_container_client('processed-imagery')

    with MemoryFile() as memfile:
        with memfile.open(**profile) as dst:
            dst.write(ndvi.astype(rasterio.float32), 1)

        memfile.seek(0)
        container.upload_blob(output_name, memfile, overwrite=True)
```

## Time-Series Analysis

Analyze vegetation changes over time:

```python
# Synapse notebook for time-series satellite analysis
from pyspark.sql import SparkSession
from pyspark.sql.functions import *
from pyspark.sql.window import Window

# Read NDVI time series data
ndvi_df = spark.read.parquet(
    "abfss://satellite-data@datalake.dfs.core.windows.net/ndvi/"
)

# Calculate seasonal trends
seasonal_trend = ndvi_df \
    .withColumn("year", year("acquisition_date")) \
    .withColumn("month", month("acquisition_date")) \
    .withColumn("week", weekofyear("acquisition_date")) \
    .groupBy("region_id", "year", "month") \
    .agg(
        avg("mean_ndvi").alias("monthly_avg_ndvi"),
        stddev("mean_ndvi").alias("ndvi_stddev"),
        count("*").alias("observation_count")
    )

# Detect anomalies using rolling statistics
window_spec = Window \
    .partitionBy("region_id") \
    .orderBy("year", "month") \
    .rowsBetween(-12, 0)  # 12-month rolling window

anomaly_detection = seasonal_trend \
    .withColumn("rolling_avg", avg("monthly_avg_ndvi").over(window_spec)) \
    .withColumn("rolling_std", stddev("monthly_avg_ndvi").over(window_spec)) \
    .withColumn("z_score", (col("monthly_avg_ndvi") - col("rolling_avg")) / col("rolling_std")) \
    .withColumn("is_anomaly", abs(col("z_score")) > 2)

# Identify regions with significant vegetation decline
declining_regions = anomaly_detection \
    .filter(col("is_anomaly") == True) \
    .filter(col("z_score") < -2) \
    .select("region_id", "year", "month", "monthly_avg_ndvi", "z_score") \
    .orderBy("z_score")

# Save results
declining_regions.write.format("delta").mode("overwrite").save(
    "abfss://satellite-data@datalake.dfs.core.windows.net/vegetation_alerts/"
)

display(declining_regions)
```

## Integration with Weather Data

Correlate satellite imagery with weather:

```python
# Combine satellite and weather data
weather_df = spark.read.parquet(
    "abfss://weather-data@datalake.dfs.core.windows.net/daily/"
)

# Join datasets
combined_df = ndvi_df.alias("sat") \
    .join(
        weather_df.alias("weather"),
        (col("sat.region_id") == col("weather.region_id")) &
        (col("sat.acquisition_date") == col("weather.date")),
        "left"
    ) \
    .select(
        "sat.region_id",
        "sat.acquisition_date",
        "sat.mean_ndvi",
        "weather.temperature_avg",
        "weather.precipitation",
        "weather.humidity"
    )

# Analyze correlation between weather and vegetation
from pyspark.ml.stat import Correlation
from pyspark.ml.feature import VectorAssembler

# Create feature vector
assembler = VectorAssembler(
    inputCols=["temperature_avg", "precipitation", "humidity"],
    outputCol="weather_features"
)

features_df = assembler.transform(combined_df.dropna())

# Calculate correlation matrix
correlation_matrix = Correlation.corr(features_df, "weather_features")
print("Weather-Vegetation Correlation Matrix:")
print(correlation_matrix.collect()[0][0].toArray())
```

## Real-Time Monitoring Dashboard

Power BI integration for visualization:

```kql
// KQL query for satellite monitoring dashboard
SatelliteObservations
| where Timestamp > ago(30d)
| summarize
    AvgNDVI = avg(MeanNDVI),
    MinNDVI = min(MeanNDVI),
    MaxNDVI = max(MeanNDVI),
    ObservationCount = count()
    by RegionId, bin(Timestamp, 1d)
| join kind=inner (
    Regions | project RegionId, RegionName, CropType
) on RegionId
| project
    Timestamp,
    RegionName,
    CropType,
    AvgNDVI,
    HealthStatus = case(
        AvgNDVI >= 0.6, "Healthy",
        AvgNDVI >= 0.4, "Moderate",
        AvgNDVI >= 0.2, "Stressed",
        "Critical"
    )
| render timechart
```

## Summary

Space APIs and satellite data enable:

- Agricultural monitoring at scale
- Climate change analysis
- Urban development tracking
- Disaster response support
- Environmental compliance

Azure provides the infrastructure to process petabytes of satellite imagery.


