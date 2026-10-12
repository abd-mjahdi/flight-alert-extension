# SkyAlert

SkyAlert is a Chrome extension that shows aircraft near a location you choose. You enter latitude, longitude, and a search radius. While tracking is on, it checks OpenSky Network in the background, shows a count on the toolbar icon, and lists nearby aircraft in the popup.

You do **not** log in. It uses OpenSky as an **anonymous** user.

This is a hobby tracker, not an official air-traffic tool. Coverage depends on volunteer ADS-B receivers. Some planes you see on FlightRadar24 or similar sites will not appear here.

## Install

1. Open Chrome (or another Chromium browser such as Edge).
2. Go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this project folder.
5. Pin SkyAlert on the toolbar if you want the badge always visible.

After you change the code, click **Reload** on the extension card. Then close and reopen the popup.

## How to use

1. Click the SkyAlert icon.
2. Open **Location** at the bottom of the popup.
3. Enter:
   - **Latitude** between -90 and 90
   - **Longitude** between -180 and 180
   - **Radius** in kilometres, greater than 0 and at most **150 km**
4. Turn **Tracking** on.

The popup shows how many aircraft are in range. Each card shows callsign, aircraft type (when known), distance, altitude, and speed. The toolbar badge shows the same count (capped at `99+`).

Tracking keeps running after you close the popup. Turn **Tracking** off when you are done.

To change the search area later, edit the fields and click the refresh button (↻). If a scan just ran, the button waits until the next allowed scan so extra API credits are not spent. Your new location is still saved; the next scan uses it.

## What you will see

- **Tracking off:** no scans, empty badge.
- **Tracking on, planes nearby:** badge count and a list of cards.
- **Tracking on, none nearby:** “No planes nearby”.
- **Error / pause:** a status message (network problem, timeout, or API credits paused).

The last list and your location are stored on this computer, so they come back when you reopen the popup.

Aircraft **type** is looked up separately and cached. New types may show as “—” until a later scan. A plane with no published metadata stays as “—”.

## Update frequency

Anonymous OpenSky data is only about **10 seconds** fresh. Scanning faster than that does not get newer positions.

SkyAlert therefore scans slowly on purpose so the **400 anonymous credits per day** last:

- Typical radius (most locations): about **every 4 minutes**
- A larger box (high latitude or a large radius) costs more credits per scan, so the wait becomes about **8, 12, or 16 minutes**

The first scan after you turn tracking on happens immediately if enough time has passed since the last scan. After that, scans follow the interval above even if the popup is closed.

Chrome may delay background alarms slightly when the computer is asleep or under heavy load.

## OpenSky credits (important)

Anonymous access is **400 credits per day**, counted **per IP address**. On shared networks (home NAT, school, VPN, mobile carrier) other people may already have used some or all of that budget.

Each location scan costs **1–4 credits** based on the bounding box size, not on how many planes are returned.

When credits are low or gone, OpenSky returns an error and SkyAlert **pauses tracking** until credits should be available again (often until the daily reset, or the wait OpenSky sends). The popup explains the pause. Tracking resumes by itself if it was still on.

**To last a full day:**

- Use the **smallest radius** you need (10–50 km is usually enough)
- Do not leave tracking on overnight unless you need it
- Do not run several copies of the extension on the same network
- Do not spam the refresh button; the cooldown exists to protect credits

This extension does **not** log in with an OpenSky account. A registered account would allow more credits, but credentials must never be hardcoded in the extension.

## Coverage and accuracy

SkyAlert uses [OpenSky Network](https://opensky-network.org/), not FlightRadar24.

- Coverage is best where volunteers run ADS-B receivers (often Europe and parts of North America).
- Remote areas, oceans, and some countries have little or no data.
- Military, blocked, or non-ADS-B traffic may be missing.
- Positions can be a few seconds to tens of seconds old.
- Distance is calculated from the coordinates you entered, not from GPS unless you typed your GPS position yourself.
- Near the poles or the 180° meridian the search box is clamped so one request cannot become a worldwide query. A few aircraft at the edge of the radius might be missed there.

## Permissions

Chrome will show these permissions:

| Permission | Why |
| --- | --- |
| **Storage** | Saves location, tracking on/off, last aircraft list, and a cache of aircraft types |
| **Alarms** | Runs scans in the background while the popup is closed |
| **opensky-network.org** | Fetches live positions and aircraft type metadata |

Nothing is sent to a SkyAlert server. There is no SkyAlert account. Data stays in Chrome’s local extension storage on your machine.

## Troubleshooting

**“Please enter valid numbers…”**  
Use decimal degrees (for example `51.5074` and `-0.1278`), not N/W letters. Radius must be 1–150.

**No planes, but another app shows some**  
That is usually OpenSky coverage, not a bug. Try a slightly larger radius, or a location known to have ADS-B.

**Badge does not update**  
Confirm Tracking is on, reload the extension, and wait for the next scan (about 4 minutes).

**“Rate limited” or “API credits low”**  
The daily anonymous budget is used up (or shared on your IP). Leave tracking on and wait for the pause to end, or turn it off until tomorrow. Using a smaller radius next time helps.

**“Network error” or “timed out”**  
Check your internet connection. OpenSky may also be down. SkyAlert waits for the next scheduled scan instead of retrying immediately.

**Popup shows old planes**  
The last successful result is kept until the next scan. After a pause or error, wait for tracking to resume.

**I changed the files and nothing happened**  
Reload the extension on `chrome://extensions`, then close and reopen the popup.

## Privacy and safety

- You choose the coordinates. The extension does not read your device GPS.
- Do not publish a live feed of a sensitive location if that would be a problem for you.
- Do not put OpenSky passwords or API secrets in the source code.

## For developers

Plain JavaScript, HTML, and CSS. Manifest V3 service worker in `background.js`, UI in `popup.html` / `popup.js` / `popup.css`.

Poll interval is `ANONYMOUS_MS_PER_CREDIT` in `background.js` (currently 4 minutes per credit). Change that one constant to retune anonymous polling.

Flight positions: `GET https://opensky-network.org/api/states/all` with a bounding box.  
Aircraft type: `GET https://opensky-network.org/api/metadata/aircraft/icao/{icao24}` (cached; not polled on a timer).

## License

Free to use for any purpose. No warranty. Flight data belongs to [OpenSky Network](https://opensky-network.org/) and is subject to their terms.
