---
title: "Azure Maps: Location Intelligence Platform"
description: "Most location features I've shipped lived on Google Maps for one reason: nobody knew Azure had a maps service. Azure Maps is competitive now—routing…"
author: Michael John Peña
draft: false
date: 2020-11-24
tags:
  - Azure
  - Maps
  - Location
  - Geospatial
---

Most location features I've shipped lived on Google Maps for one reason: nobody knew Azure had a maps service. Azure Maps is competitive now—routing, geocoding, traffic, weather, isochrones, and a clean REST/JS SDK. The pitch I make to clients is simple: if your data already lives in Azure and you care about Microsoft EA pricing and Azure AD auth, Azure Maps deserves a serious look before you reach for the default.

## Creating Azure Maps Account

```bash
az maps account create \
    --name mymaps \
    --resource-group myRG \
    --sku S1 \
    --kind Gen2
```

## Map SDK (JavaScript)

```html
<link rel="stylesheet" href="https://atlas.microsoft.com/sdk/javascript/mapcontrol/2/atlas.min.css" />
<script src="https://atlas.microsoft.com/sdk/javascript/mapcontrol/2/atlas.min.js"></script>

<div id="map" style="width: 100%; height: 500px;"></div>

<script>
    var map = new atlas.Map('map', {
        center: [-122.33, 47.6],
        zoom: 12,
        language: 'en-US',
        authOptions: {
            authType: 'subscriptionKey',
            subscriptionKey: '<your-subscription-key>'
        }
    });

    // Add controls
    map.controls.add([
        new atlas.control.ZoomControl(),
        new atlas.control.CompassControl(),
        new atlas.control.StyleControl()
    ], { position: 'top-right' });

    // Add marker
    map.events.add('ready', function() {
        var marker = new atlas.HtmlMarker({
            position: [-122.33, 47.6],
            color: '#007FFF'
        });
        map.markers.add(marker);
    });
</script>
```

## Geocoding (Address to Coordinates)

```python
import requests

subscription_key = "<your-key>"

# Search address
response = requests.get(
    "https://atlas.microsoft.com/search/address/json",
    params={
        "api-version": "1.0",
        "subscription-key": subscription_key,
        "query": "1 Microsoft Way, Redmond, WA"
    }
)

result = response.json()
position = result["results"][0]["position"]
print(f"Lat: {position['lat']}, Lon: {position['lon']}")
```

## Reverse Geocoding

```python
# Coordinates to address
response = requests.get(
    "https://atlas.microsoft.com/search/address/reverse/json",
    params={
        "api-version": "1.0",
        "subscription-key": subscription_key,
        "query": "47.6062,-122.3321"
    }
)

address = response.json()["addresses"][0]["address"]["freeformAddress"]
```

## Routing

```python
# Get route between points
response = requests.get(
    "https://atlas.microsoft.com/route/directions/json",
    params={
        "api-version": "1.0",
        "subscription-key": subscription_key,
        "query": "47.6062,-122.3321:47.6205,-122.3493",
        "travelMode": "car",
        "traffic": "true"
    }
)

route = response.json()["routes"][0]
print(f"Distance: {route['summary']['lengthInMeters']/1000:.1f} km")
print(f"Duration: {route['summary']['travelTimeInSeconds']/60:.0f} min")
```

## Drawing Routes on Map

```javascript
map.events.add('ready', function() {
    var dataSource = new atlas.source.DataSource();
    map.sources.add(dataSource);

    // Add route line
    map.layers.add(new atlas.layer.LineLayer(dataSource, null, {
        strokeColor: '#007FFF',
        strokeWidth: 5
    }));

    // Fetch route
    fetch(`https://atlas.microsoft.com/route/directions/json?api-version=1.0&subscription-key=${key}&query=${start}:${end}`)
        .then(response => response.json())
        .then(data => {
            var route = data.routes[0];
            var coordinates = route.legs[0].points.map(p => [p.longitude, p.latitude]);
            dataSource.add(new atlas.data.LineString(coordinates));
        });
});
```

## Geofencing

```python
# Create geofence
geofence = {
    "type": "FeatureCollection",
    "features": [{
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [-122.13, 47.63],
                [-122.13, 47.64],
                [-122.12, 47.64],
                [-122.12, 47.63],
                [-122.13, 47.63]
            ]]
        },
        "properties": {
            "geometryId": "warehouse-1"
        }
    }]
}

# Upload geofence
response = requests.post(
    "https://atlas.microsoft.com/mapData/upload",
    params={"api-version": "1.0", "subscription-key": key, "dataFormat": "geojson"},
    json=geofence
)

# Check if point is inside
response = requests.get(
    "https://atlas.microsoft.com/spatial/geofence/json",
    params={
        "api-version": "1.0",
        "subscription-key": key,
        "deviceId": "device1",
        "udId": upload_id,
        "lat": 47.635,
        "lon": -122.125
    }
)
```

## Weather API

```python
# Get current conditions
response = requests.get(
    "https://atlas.microsoft.com/weather/currentConditions/json",
    params={
        "api-version": "1.0",
        "subscription-key": key,
        "query": "47.6062,-122.3321"
    }
)

weather = response.json()["results"][0]
print(f"Temperature: {weather['temperature']['value']}°{weather['temperature']['unit']}")
print(f"Conditions: {weather['phrase']}")
```

Azure Maps: location services at your fingertips.
