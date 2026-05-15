# SkyAlert

A Chrome extension that shows aircraft near a location you choose. You enter latitude, longitude and a search radius. The extension fetches live flight data on a fixed interval and displays nearby planes in the popup. The toolbar icon shows how many aircraft are in range. Tracking can stay on after you close the popup.

**Search interval:** The extension checks for nearby aircraft every **2 minutes** when tracking is on.

## How to use

1. Load the extension in Chrome (Extensions, Developer mode, Load unpacked, select this folder).
2. Open the extension popup and enter your **latitude**, **longitude** and **radius in kilometres** (max 150 km).
3. Turn **Tracking** on. The badge on the icon shows the count of nearby aircraft; open the popup to see the list and details.
4. Tracking continues in the background when the popup is closed. Turn Tracking off in the popup when you are done.

Data is stored locally so your last position and the latest aircraft list are restored when you reopen the popup.

## API credits and limits

This extension uses the **OpenSky Network** REST API (`/states/all`) with no authentication.

Anonymous users get **400 API credits per day** on the states endpoint. Each request costs 1 to 4 credits depending on the bounding box size:

1. Up to 25 sq degrees: **1 credit**
2. 25 to 100 sq degrees: **2 credits**
3. 100 to 400 sq degrees: **3 credits**
4. Over 400 sq degrees: **4 credits**

With a 2 minute interval and a small radius (under ~55 km), each request costs 1 credit and a full day of tracking uses about **720 credits**. That exceeds the 400 budget, so continuous 24/7 tracking will hit the limit after roughly 13 hours. Turn tracking off when you do not need it.

**How to reduce credit usage:**

1. Use the **smallest radius** that works for you (10 to 50 km is ideal). Smaller area = fewer credits per request.
2. Do not leave tracking on all day unless necessary.
3. Do not run multiple copies of the extension at once.

When credits run out the API returns HTTP 429 and the extension **automatically pauses** tracking until the retry period expires. You will see a message in the popup.

## OpenSky vs FlightRadar24

SkyAlert uses OpenSky, not FlightRadar24. OpenSky relies on volunteer ADS-B receivers. Coverage varies by region. Some aircraft visible on FR24 may not appear here because OpenSky does not have a nearby receiver reporting that aircraft.

## Permissions

1. **Storage:** Coordinates, radius, tracking state, last aircraft list, and aircraft model cache.
2. **Alarms:** Background scanning every 2 minutes when the popup is closed.
3. **Host access** to opensky-network.org: Flight data and aircraft metadata.

## Tech

JavaScript, HTML, CSS. Chrome Extension Manifest V3. Flight data and metadata from OpenSky Network.

## License

This project is free to use for any purpose. No warranty.
