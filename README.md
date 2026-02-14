# SkyAlert

A Chrome extension that shows aircraft near a location you choose. You enter latitude, longitude and a search radius. The extension fetches live flight data on a fixed interval and displays nearby planes in the popup. The toolbar icon shows how many aircraft are in range. Tracking can stay on after you close the popup.

**Search interval:** The extension checks for nearby aircraft every **30 seconds** when tracking is on.

## How to use

1. Load the extension in Chrome (Extensions, Developer mode, Load unpacked, select this folder).
2. Open the extension popup and enter your **latitude**, **longitude** and **radius in kilometres**.
3. Turn **Tracking** on. The badge on the icon shows the count of nearby aircraft; open the popup to see the list and details.
4. Tracking continues in the background when the popup is closed. Turn Tracking off in the popup when you are done.

Data is stored locally so your last position and the latest aircraft list are restored when you reopen the popup.

## API and usage

This extension uses the **OpenSky Network** API. It is a free, anonymous service with no signup. There are no visible “credits,” but the service still has limits and may block or throttle abusive use.

**Reduce load and risk of blocking:**

- Use the **smallest radius** that fits your needs (e.g. 10–50 km instead of 100+ km). Smaller areas mean less data and fewer requests.
- Avoid leaving tracking on 24/7 unless you need it. Turn it off when you are not using it.
- Do not run many tabs or instances of the extension at once.

**Abuse:** Heavy or automated abuse can lead to your access being blocked by the API. Use the extension in a normal, personal way and keep the radius as small as possible.

## Permissions

- **Storage:** To remember your coordinates, radius, tracking state and last aircraft list.
- **Alarms:** To run the 30 second check in the background when the popup is closed.
- **Host access** to OpenSky Network: To fetch live flight data and aircraft metadata.

## Tech

JavaScript, HTML, CSS. Chrome Extension Manifest V3. Flight data and metadata from OpenSky Network.

## License

This project is free to use for any purpose. No warranty.
