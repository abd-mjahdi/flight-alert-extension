const TRACKING_ALARM = 'tracking';
const BACKOFF_ALARM = 'backoff';
const interval = 120000;
const FETCH_BOX_MARGIN = 1.05;
const DISTANCE_TOLERANCE_KM = 0.2;
const MAX_NEW_METADATA_PER_TICK = 3;
const MAX_RADIUS_KM = 150;
let currentArea = null;
let userLat = null;
let userLon = null;
let searchRadiusKm = null;
let tickInProgress = false;
let lastTickTime = 0;
let rateLimitRemaining = null;
let aircraftModelCache = {};

const DEFAULT_AREA = {
    lamin: 24.8,
    lamax: 25.4,
    lomin: 55.0,
    lomax: 55.8
};

chrome.runtime.onMessage.addListener(handleMessage);
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === TRACKING_ALARM) processTrackingTick();
    if (alarm.name === BACKOFF_ALARM) resumeAfterBackoff();
});

function isValidLocation(lat, lon, radius) {
    if (typeof lat !== 'number' || typeof lon !== 'number' || typeof radius !== 'number') return false;
    if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(radius)) return false;
    if (lat < -90 || lat > 90) return false;
    if (lon < -180 || lon > 180) return false;
    if (radius <= 0 || radius > MAX_RADIUS_KM) return false;
    return true;
}

function handleMessage(message) {
    if (!message || !message.type) return;

    if (message.type === 'updateLocation') {
        const { lat, lon, radius } = message;
        if (!isValidLocation(lat, lon, radius)) return;
        setAreaFromLatLonRadius(lat, lon, radius);
        return;
    }

    if (message.type === 'startTracking') {
        const { lat, lon, radius } = message;
        if (!isValidLocation(lat, lon, radius)) return;
        setAreaFromLatLonRadius(lat, lon, radius);
        startTracking();
        return;
    }

    if (message.type === 'checkboxStatus' && message.checked === false) {
        stopTracking();
    }
}

async function fetchStatesInArea() {
    const area = currentArea || DEFAULT_AREA;
    const url = `https://opensky-network.org/api/states/all?lamin=${area.lamin}&lamax=${area.lamax}&lomin=${area.lomin}&lomax=${area.lomax}`;
    try {
        const response = await fetch(url);

        const remaining = response.headers.get('X-Rate-Limit-Remaining');
        if (remaining != null) rateLimitRemaining = parseInt(remaining, 10);

        if (!response.ok) {
            if (response.status === 429) {
                const retryAfter = response.headers.get('X-Rate-Limit-Retry-After-Seconds');
                const waitSec = retryAfter ? parseInt(retryAfter, 10) : 300;
                scheduleBackoff(waitSec);
                return { error: 'Rate limited. Pausing for ' + Math.ceil(waitSec / 60) + ' min.' };
            }
            return { error: 'Could not fetch flight data. The API may be unavailable.' };
        }

        if (rateLimitRemaining != null && rateLimitRemaining <= 10) {
            scheduleBackoff(600);
            const data = await response.json();
            data._lowCredits = true;
            return data;
        }

        return await response.json();
    } catch (error) {
        console.error(error);
        return { error: 'Network error. Check your connection and try again.' };
    }
}

function scheduleBackoff(waitSeconds) {
    chrome.alarms.clear(TRACKING_ALARM);
    chrome.alarms.create(BACKOFF_ALARM, { delayInMinutes: Math.max(waitSeconds / 60, 1) });
}

function resumeAfterBackoff() {
    chrome.alarms.clear(BACKOFF_ALARM);
    chrome.storage.local.get(['checked'], (result) => {
        if (result.checked === true) {
            startTracking();
        }
    });
}

async function processTrackingTick() {
    if (tickInProgress) return;
    tickInProgress = true;
    lastTickTime = Date.now();
    try {
        const data = await fetchStatesInArea();
        if (data && data.error) {
            sendAircraftsData({ aircrafts: [], numberOfPlanesNearby: 0, error: data.error });
            return;
        }
        if (!data || !data.states || data.states.length === 0) {
            sendAircraftsData({ aircrafts: [], numberOfPlanesNearby: 0 });
            return;
        }

        const area = currentArea || DEFAULT_AREA;
        const centerLat = userLat ?? (area.lamin + area.lamax) / 2;
        const centerLon = userLon ?? (area.lomin + area.lomax) / 2;
        const radiusKm = searchRadiusKm;

        const preparedObjects = await prepareData(data, centerLat, centerLon, radiusKm);
        const finalData = {
            aircrafts: preparedObjects,
            numberOfPlanesNearby: preparedObjects.length
        };

        if (data._lowCredits) {
            finalData.error = 'API credits low. Tracking paused to avoid a block.';
        }

        sendAircraftsData(finalData);
    } finally {
        tickInProgress = false;
    }
}

function sendAircraftsData(finalData) {
    const count = finalData?.numberOfPlanesNearby ?? 0;
    try {
        if (count > 0) {
            chrome.action.setBadgeText({ text: count > 99 ? '99+' : String(count) });
            chrome.action.setBadgeBackgroundColor({ color: '#58a6ff' });
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    } catch (e) {
        console.warn('Badge update failed', e);
    }
    chrome.storage.local.set({ lastData: finalData });
    chrome.runtime.sendMessage({ type: 'data', data: finalData }).catch(() => {});
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function loadMetadataCache() {
    try {
        const stored = await chrome.storage.local.get(['metadataCache']);
        if (stored && stored.metadataCache && typeof stored.metadataCache === 'object') {
            aircraftModelCache = stored.metadataCache;
        }
    } catch (_) {}
}

function saveMetadataCache() {
    try {
        chrome.storage.local.set({ metadataCache: aircraftModelCache });
    } catch (_) {}
}

async function fetchAircraftInfo(icao24) {
    try {
        const response = await fetch(`https://opensky-network.org/api/metadata/aircraft/icao/${icao24}`);
        if (!response.ok) return null;
        const data = await response.json();
        return data.model || null;
    } catch {
        return null;
    }
}

function startTracking() {
    chrome.alarms.clear(TRACKING_ALARM, () => {
        chrome.alarms.clear(BACKOFF_ALARM, () => {
            const now = Date.now();
            if (now - lastTickTime >= interval - 500) {
                processTrackingTick();
            }
            chrome.alarms.create(TRACKING_ALARM, { periodInMinutes: interval / 60000 });
        });
    });
}

function stopTracking() {
    chrome.alarms.clear(TRACKING_ALARM);
    chrome.alarms.clear(BACKOFF_ALARM);
    try { chrome.action.setBadgeText({ text: '' }); } catch (_) {}
}

function setAreaFromLatLonRadius(lat, lon, radius) {
    searchRadiusKm = radius;
    userLat = lat;
    userLon = lon;
    const fetchRadiusKm = radius * FETCH_BOX_MARGIN;
    const latDelta = fetchRadiusKm / 111;
    const lonDelta = fetchRadiusKm / (111 * Math.abs(Math.cos(lat * Math.PI / 180)));
    currentArea = {
        lamin: lat - latDelta,
        lamax: lat + latDelta,
        lomin: lon - lonDelta,
        lomax: lon + lonDelta
    };
}

async function restoreTrackingIfNeeded() {
    await loadMetadataCache();
    chrome.storage.local.get(['checked', 'lat', 'lon', 'radius'], (result) => {
        if (result.checked !== true) return;
        const lat = result.lat;
        const lon = result.lon;
        const radius = result.radius;
        if (!isValidLocation(lat, lon, radius)) return;
        setAreaFromLatLonRadius(lat, lon, radius);
        startTracking();
    });
}

restoreTrackingIfNeeded();

async function prepareData(data, centerLat, centerLon, radiusKm) {
    const states = data.states;
    if (!states || !Array.isArray(states)) return [];

    const filtered = [];
    for (const state of states) {
        const planeLat = state[6] != null ? Number(state[6]) : NaN;
        const planeLon = state[5] != null ? Number(state[5]) : NaN;
        const hasPosition = !Number.isNaN(planeLat) && !Number.isNaN(planeLon);

        let distance = null;
        if (hasPosition) {
            distance = Math.round(haversineKm(centerLat, centerLon, planeLat, planeLon) * 10) / 10;
            if (radiusKm != null && distance > radiusKm + DISTANCE_TOLERANCE_KM) {
                continue;
            }
        } else if (radiusKm != null) {
            continue;
        }

        filtered.push({ state, distance });
    }

    let newFetches = 0;
    const results = [];
    for (const { state, distance } of filtered) {
        const icao24 = state[0];
        let model = null;
        if (icao24) {
            if (Object.prototype.hasOwnProperty.call(aircraftModelCache, icao24)) {
                model = aircraftModelCache[icao24];
            } else if (newFetches < MAX_NEW_METADATA_PER_TICK) {
                model = await fetchAircraftInfo(icao24);
                aircraftModelCache[icao24] = model;
                newFetches++;
            }
        }
        results.push({
            callSign: state[1] != null ? String(state[1]).trim() : null,
            type: model,
            altitude: state[7],
            distance: distance,
            direction: state[10],
            velocity: state[9]
        });
    }

    if (newFetches > 0) saveMetadataCache();

    return results;
}
