const TRACKING_ALARM = 'tracking';
const BACKOFF_ALARM = 'backoff';
// Anonymous OpenSky budget: 400 credits/day. Change this one value to speed up/slow down polling.
const ANONYMOUS_MS_PER_CREDIT = 4 * 60 * 1000;
const FETCH_BOX_MARGIN = 1.05;
const DISTANCE_TOLERANCE_KM = 0.2;
const MAX_NEW_METADATA_PER_TICK = 3;
const METADATA_LOOKUP_GAP_MS = 3000;
const MAX_METADATA_CACHE_ENTRIES = 5000;
const LOW_CREDIT_THRESHOLD = 10;
const MAX_RADIUS_KM = 150;
const FETCH_TIMEOUT_MS = 15000;
const TICK_HEARTBEAT_MS = 20000;
const MIN_COS_LAT = Math.cos(85 * Math.PI / 180);
const MAX_LON_DELTA_DEG = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
let currentArea = null;
let userLat = null;
let userLon = null;
let searchRadiusKm = null;
let tickInProgress = false;
let lastTickTime = 0;
let rateLimitRemaining = null;
let creditWindowStart = 0;
let creditsResetAt = 0;
let aircraftModelCache = {};
let tickHeartbeatTimer = null;

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

function boundingBoxAreaSqDeg(area) {
    if (!area) return 0;
    const latRange = Math.abs(area.lamax - area.lamin);
    const lonRange = Math.abs(area.lomax - area.lomin);
    return latRange * lonRange;
}

function statesCreditCost(area) {
    const sq = boundingBoxAreaSqDeg(area || currentArea || DEFAULT_AREA);
    if (sq <= 25) return 1;
    if (sq <= 100) return 2;
    if (sq <= 400) return 3;
    return 4;
}

function getPollingIntervalMs() {
    return statesCreditCost(currentArea || DEFAULT_AREA) * ANONYMOUS_MS_PER_CREDIT;
}

function getPollingPeriodMinutes() {
    return Math.max(getPollingIntervalMs() / 60000, 1);
}

function msUntilUtcMidnight() {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
}

function formatPauseDuration(waitSeconds) {
    const mins = Math.max(1, Math.ceil(waitSeconds / 60));
    if (mins < 90) return mins + ' min';
    const hours = Math.round(mins / 60);
    return '~' + hours + 'h';
}

function persistPollState() {
    try {
        const payload = {
            pollingIntervalMs: getPollingIntervalMs(),
            creditWindowStart,
            creditsResetAt,
            lastRateLimitRemaining: rateLimitRemaining
        };
        if (lastTickTime > 0) {
            payload.lastTickTime = lastTickTime;
        }
        persistNextScanAt().then((nextScanAt) => {
            if (nextScanAt) payload.nextScanAt = nextScanAt;
            chrome.storage.local.set(payload);
        }).catch(() => {
            chrome.storage.local.set(payload);
        });
    } catch (_) {}
}

async function persistNextScanAt() {
    try {
        const backoff = await chrome.alarms.get(BACKOFF_ALARM);
        if (backoff && backoff.scheduledTime) return backoff.scheduledTime;
        const tracking = await chrome.alarms.get(TRACKING_ALARM);
        if (tracking && tracking.scheduledTime) return tracking.scheduledTime;
        if (creditsResetAt > Date.now()) return creditsResetAt;
        if (lastTickTime > 0) return lastTickTime + getPollingIntervalMs();
    } catch (_) {}
    return 0;
}

function startTickHeartbeat() {
    stopTickHeartbeat();
    const ping = () => {
        try { chrome.runtime.getPlatformInfo(() => {}); } catch (_) {}
    };
    ping();
    tickHeartbeatTimer = setInterval(ping, TICK_HEARTBEAT_MS);
}

function stopTickHeartbeat() {
    if (tickHeartbeatTimer) {
        clearInterval(tickHeartbeatTimer);
        tickHeartbeatTimer = null;
    }
}

async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function isTimeoutError(error) {
    return error && (error.name === 'AbortError' || error.message === 'The user aborted a request.');
}

function handleMessage(message) {
    if (!message || !message.type) return;

    if (message.type === 'updateLocation') {
        const { lat, lon, radius } = message;
        if (!isValidLocation(lat, lon, radius)) return;
        setAreaFromLatLonRadius(lat, lon, radius);
        syncTrackingAlarmPeriod();
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

function parseHeaderInt(value) {
    if (value == null || value === '') return null;
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
}

async function parseJsonBody(response) {
    try {
        return await response.json();
    } catch (error) {
        console.error(error);
        return { error: 'Could not read flight data from the API.' };
    }
}

function noteRateLimitRemaining(remaining) {
    const now = Date.now();
    if (rateLimitRemaining != null && remaining > rateLimitRemaining + 5) {
        creditWindowStart = now;
        creditsResetAt = 0;
    } else if (!creditWindowStart) {
        creditWindowStart = now;
    }
    rateLimitRemaining = remaining;
}

async function fetchStatesInArea() {
    const area = currentArea || DEFAULT_AREA;
    const url = `https://opensky-network.org/api/states/all?lamin=${area.lamin}&lamax=${area.lamax}&lomin=${area.lomin}&lomax=${area.lomax}`;
    try {
        const response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);

        const remaining = parseHeaderInt(response.headers.get('X-Rate-Limit-Remaining'));
        if (remaining != null) noteRateLimitRemaining(remaining);

        if (!response.ok) {
            if (response.status === 429) {
                const retryAfter = parseHeaderInt(response.headers.get('X-Rate-Limit-Retry-After-Seconds'));
                const waitSec = waitSecondsUntilCreditsAvailable(retryAfter);
                scheduleBackoff(waitSec);
                return {
                    error: 'Rate limited. Tracking paused until credits reset (' + formatPauseDuration(waitSec) + ').'
                };
            }
            return { error: 'Could not fetch flight data. The API may be unavailable.' };
        }

        const data = await parseJsonBody(response);
        if (data && data.error) return data;

        if (rateLimitRemaining != null && rateLimitRemaining <= LOW_CREDIT_THRESHOLD) {
            const waitSec = waitSecondsUntilCreditsAvailable(null);
            scheduleBackoff(waitSec);
            data._lowCredits = true;
            data._pauseLabel = formatPauseDuration(waitSec);
        }

        return data;
    } catch (error) {
        console.error(error);
        if (isTimeoutError(error)) {
            return { error: 'Flight data request timed out. Will try again on the next scan.' };
        }
        return { error: 'Network error. Check your connection and try again.' };
    }
}

function waitSecondsUntilCreditsAvailable(retryAfterSeconds) {
    const now = Date.now();
    if (retryAfterSeconds != null && retryAfterSeconds > 0) {
        return retryAfterSeconds;
    }
    if (creditsResetAt && creditsResetAt > now + 1000) {
        return Math.ceil((creditsResetAt - now) / 1000);
    }
    const rollingEnd = (creditWindowStart || lastTickTime || now) + DAY_MS;
    const utcMidnight = now + msUntilUtcMidnight();
    const resetAt = Math.min(Math.max(rollingEnd, utcMidnight), now + DAY_MS);
    return Math.max(60, Math.ceil((resetAt - now) / 1000));
}

function scheduleBackoff(waitSeconds) {
    creditsResetAt = Date.now() + waitSeconds * 1000;
    persistPollState();
    chrome.alarms.clear(TRACKING_ALARM);
    chrome.alarms.create(BACKOFF_ALARM, { delayInMinutes: Math.max(waitSeconds / 60, 1) });
}

function resumeAfterBackoff() {
    chrome.alarms.clear(BACKOFF_ALARM);
    loadPersistedTickState().then(() => {
        if (creditsResetAt && Date.now() < creditsResetAt - 1000) {
            scheduleBackoff(Math.ceil((creditsResetAt - Date.now()) / 1000));
            return;
        }
        chrome.storage.local.get(['checked'], (result) => {
            if (result.checked === true) {
                startTracking();
            }
        });
    });
}

async function processTrackingTick() {
    if (tickInProgress) return;
    tickInProgress = true;
    lastTickTime = Date.now();
    persistPollState();
    startTickHeartbeat();
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
            finalData.error = 'API credits low. Tracking paused until the daily credit reset (' + (data._pauseLabel || 'until reset') + ').';
        }

        sendAircraftsData(finalData);
    } finally {
        stopTickHeartbeat();
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

function normalizeCacheEntry(value) {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'model')) {
        return {
            model: value.model == null ? null : String(value.model),
            cachedAt: Number(value.cachedAt) || 0
        };
    }
    if (typeof value === 'string') {
        return { model: value, cachedAt: 0 };
    }
    if (value === null) {
        return { model: null, cachedAt: 0 };
    }
    return null;
}

function evictMetadataCacheIfNeeded() {
    const keys = Object.keys(aircraftModelCache);
    const overflow = keys.length - MAX_METADATA_CACHE_ENTRIES;
    if (overflow <= 0) return;
    keys.sort((a, b) => (aircraftModelCache[a].cachedAt || 0) - (aircraftModelCache[b].cachedAt || 0));
    for (let i = 0; i < overflow; i++) {
        delete aircraftModelCache[keys[i]];
    }
}

function rememberAircraftModel(icao24, model) {
    aircraftModelCache[icao24] = { model: model || null, cachedAt: Date.now() };
    evictMetadataCacheIfNeeded();
}

function cachedAircraftModel(icao24) {
    const entry = aircraftModelCache[icao24];
    return entry ? entry.model : null;
}

async function loadMetadataCache() {
    try {
        const stored = await chrome.storage.local.get(['metadataCache']);
        if (!stored || !stored.metadataCache || typeof stored.metadataCache !== 'object') return;
        const next = {};
        for (const [icao24, value] of Object.entries(stored.metadataCache)) {
            const entry = normalizeCacheEntry(value);
            if (entry) next[icao24] = entry;
        }
        aircraftModelCache = next;
        evictMetadataCacheIfNeeded();
    } catch (_) {}
}

async function loadPersistedTickState() {
    try {
        const stored = await chrome.storage.local.get([
            'lastTickTime',
            'creditWindowStart',
            'creditsResetAt',
            'lastRateLimitRemaining'
        ]);
        const storedTick = Number(stored.lastTickTime);
        if (Number.isFinite(storedTick) && storedTick > lastTickTime) {
            lastTickTime = storedTick;
        }
        const storedWindow = Number(stored.creditWindowStart);
        if (Number.isFinite(storedWindow) && storedWindow > 0) {
            creditWindowStart = storedWindow;
        }
        const storedReset = Number(stored.creditsResetAt);
        if (Number.isFinite(storedReset) && storedReset > 0) {
            creditsResetAt = storedReset;
        }
        const storedRemaining = Number(stored.lastRateLimitRemaining);
        if (Number.isFinite(storedRemaining)) {
            rateLimitRemaining = storedRemaining;
        }
    } catch (_) {}
}

function saveMetadataCache() {
    try {
        chrome.storage.local.set({ metadataCache: aircraftModelCache });
    } catch (_) {}
}

async function sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const slice = Math.min(1000, end - Date.now());
        await new Promise((resolve) => setTimeout(resolve, slice));
        try {
            await chrome.runtime.getPlatformInfo();
        } catch (_) {}
    }
}

async function fetchAircraftInfo(icao24) {
    try {
        const response = await fetchWithTimeout(
            `https://opensky-network.org/api/metadata/aircraft/icao/${icao24}`,
            FETCH_TIMEOUT_MS
        );
        if (response.status === 404) {
            return { cache: true, model: null };
        }
        if (response.status === 429) {
            return { cache: false, rateLimited: true };
        }
        if (!response.ok) {
            return { cache: false };
        }
        const data = await response.json();
        return { cache: true, model: data && data.model ? data.model : null };
    } catch {
        return { cache: false };
    }
}

async function startTracking() {
    await loadPersistedTickState();
    if (creditsResetAt && Date.now() < creditsResetAt) {
        scheduleBackoff(Math.ceil((creditsResetAt - Date.now()) / 1000));
        return;
    }
    await chrome.alarms.clear(TRACKING_ALARM);
    await chrome.alarms.clear(BACKOFF_ALARM);
    const intervalMs = getPollingIntervalMs();
    const now = Date.now();
    if (now - lastTickTime >= intervalMs - 500) {
        processTrackingTick();
    }
    chrome.alarms.create(TRACKING_ALARM, { periodInMinutes: getPollingPeriodMinutes() });
    persistPollState();
}

function stopTracking() {
    chrome.alarms.clear(TRACKING_ALARM);
    chrome.alarms.clear(BACKOFF_ALARM);
    try { chrome.action.setBadgeText({ text: '' }); } catch (_) {}
}

async function syncTrackingAlarmPeriod() {
    try {
        persistPollState();
        const backoff = await chrome.alarms.get(BACKOFF_ALARM);
        if (backoff) return;
        const tracking = await chrome.alarms.get(TRACKING_ALARM);
        if (!tracking) return;
        const periodInMinutes = getPollingPeriodMinutes();
        if (Math.abs((tracking.periodInMinutes || 0) - periodInMinutes) > 0.05) {
            chrome.alarms.create(TRACKING_ALARM, { periodInMinutes });
        }
    } catch (_) {}
}

function wrapLongitude(lon) {
    let x = lon;
    while (x > 180) x -= 360;
    while (x < -180) x += 360;
    return x;
}

function setAreaFromLatLonRadius(lat, lon, radius) {
    searchRadiusKm = radius;
    userLat = lat;
    userLon = lon;
    const fetchRadiusKm = radius * FETCH_BOX_MARGIN;
    const latDelta = fetchRadiusKm / 111;
    const cosLat = Math.abs(Math.cos(lat * Math.PI / 180));
    const lonDelta = Math.min(
        fetchRadiusKm / (111 * Math.max(cosLat, MIN_COS_LAT)),
        MAX_LON_DELTA_DEG
    );
    let lamin = lat - latDelta;
    let lamax = lat + latDelta;
    if (lamin < -90) lamin = -90;
    if (lamax > 90) lamax = 90;

    let lomin = lon - lonDelta;
    let lomax = lon + lonDelta;
    if (lomin < -180 || lomax > 180) {
        lomin = Math.max(-180, lomin);
        lomax = Math.min(180, lomax);
    } else {
        lomin = wrapLongitude(lomin);
        lomax = wrapLongitude(lomax);
        if (lomin > lomax) {
            lomin = Math.max(-180, lon - lonDelta);
            lomax = Math.min(180, lon + lonDelta);
        }
    }

    currentArea = { lamin, lamax, lomin, lomax };
    persistPollState();
}

async function restoreTrackingIfNeeded() {
    await loadMetadataCache();
    await loadPersistedTickState();
    const result = await chrome.storage.local.get(['checked', 'lat', 'lon', 'radius']);
    if (result.checked !== true) return;

    const lat = result.lat;
    const lon = result.lon;
    const radius = result.radius;
    if (!isValidLocation(lat, lon, radius)) return;

    setAreaFromLatLonRadius(lat, lon, radius);

    const tracking = await chrome.alarms.get(TRACKING_ALARM);
    const backoff = await chrome.alarms.get(BACKOFF_ALARM);
    if (backoff) return;
    if (creditsResetAt && Date.now() < creditsResetAt) {
        scheduleBackoff(Math.ceil((creditsResetAt - Date.now()) / 1000));
        return;
    }
    if (tracking) {
        await syncTrackingAlarmPeriod();
        return;
    }

    startTracking();
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
    let skipNewLookups = false;
    const results = [];
    for (const { state, distance } of filtered) {
        const icao24 = state[0] ? String(state[0]).trim().toLowerCase() : '';
        let model = null;
        if (icao24) {
            if (Object.prototype.hasOwnProperty.call(aircraftModelCache, icao24)) {
                model = cachedAircraftModel(icao24);
            } else if (!skipNewLookups && newFetches < MAX_NEW_METADATA_PER_TICK) {
                if (newFetches > 0) await sleep(METADATA_LOOKUP_GAP_MS);
                const lookup = await fetchAircraftInfo(icao24);
                newFetches++;
                if (lookup.rateLimited) {
                    skipNewLookups = true;
                } else if (lookup.cache) {
                    rememberAircraftModel(icao24, lookup.model);
                    model = lookup.model;
                }
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
