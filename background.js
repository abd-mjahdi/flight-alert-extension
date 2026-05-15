const TRACKING_ALARM = 'tracking';
const interval = 30000;
const FETCH_BOX_MARGIN = 1.2;
const DISTANCE_TOLERANCE_KM = 0.2;
let currentArea = null;
let userLat = null;
let userLon = null;
let searchRadiusKm = null;
let tickInProgress = false;
const aircraftModelCache = {};

const DEFAULT_AREA = {
    lamin: 24.8,
    lamax: 25.4,
    lomin: 55.0,
    lomax: 55.8
};

chrome.runtime.onMessage.addListener(handleMessage);
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === TRACKING_ALARM) processTrackingTick();
});

function isValidLocation(lat, lon, radius) {
    if (typeof lat !== 'number' || typeof lon !== 'number' || typeof radius !== 'number') return false;
    if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(radius)) return false;
    if (lat < -90 || lat > 90) return false;
    if (lon < -180 || lon > 180) return false;
    if (radius <= 0 || radius > 500) return false;
    return true;
}

function handleMessage(message) {
    if (!message || !message.type) return;

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
        if (!response.ok) {
            if (response.status === 429) {
                return { error: 'Too many requests. Wait a few minutes and try again.' };
            }
            return { error: 'Could not fetch flight data. The API may be unavailable.' };
        }
        return await response.json();
    } catch (error) {
        console.error(error);
        return { error: 'Network error. Check your connection and try again.' };
    }
}

async function processTrackingTick() {
    if (tickInProgress) return;
    tickInProgress = true;
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

async function getAircraftModel(icao24) {
    if (!icao24) return null;
    if (Object.prototype.hasOwnProperty.call(aircraftModelCache, icao24)) {
        return aircraftModelCache[icao24];
    }
    const model = await fetchAircraftInfo(icao24);
    aircraftModelCache[icao24] = model;
    return model;
}

async function fetchAircraftInfo(icao24) {
    try {
        const response = await fetch(`https://opensky-network.org/api/metadata/aircraft/icao/${icao24}`);
        if (!response.ok) return null;
        const data = await response.json();
        return data.model;
    } catch {
        return null;
    }
}

function startTracking() {
    chrome.alarms.clear(TRACKING_ALARM, () => {
        processTrackingTick();
        chrome.alarms.create(TRACKING_ALARM, { periodInMinutes: interval / 60000 });
    });
}

function stopTracking() {
    chrome.alarms.clear(TRACKING_ALARM);
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

function restoreTrackingIfNeeded() {
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

    const results = await Promise.all(
        states.map(async (state) => {
            const planeLat = state[6] != null ? Number(state[6]) : NaN;
            const planeLon = state[5] != null ? Number(state[5]) : NaN;
            const hasPosition = !Number.isNaN(planeLat) && !Number.isNaN(planeLon);

            let distance = null;
            if (hasPosition) {
                distance = Math.round(haversineKm(centerLat, centerLon, planeLat, planeLon) * 10) / 10;
                if (radiusKm != null && distance > radiusKm + DISTANCE_TOLERANCE_KM) {
                    return null;
                }
            } else if (radiusKm != null) {
                return null;
            }

            const aircraftInfo = await getAircraftModel(state[0]);
            return {
                callSign: state[1] != null ? String(state[1]).trim() : null,
                type: aircraftInfo,
                altitude: state[7],
                distance: distance,
                direction: state[10],
                velocity: state[9]
            };
        })
    );

    return results.filter((item) => item !== null);
}
