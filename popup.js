let inputCheckBox;
let cardsContainer;
let planeCountSpan;
let statusMessage;
let locationToggle;
let locationUpdateBtn;
let locationFields;
let latInput;
let lonInput;
let radiusInput;
let nextUpdateTimer;
let nextUpdateIntervalId;
const DEFAULT_POLL_INTERVAL_MS = 4 * 60 * 1000;

document.addEventListener("DOMContentLoaded", async () => {
    inputCheckBox = document.querySelector('#checkbox-input')
    cardsContainer = document.querySelector('#cards-container')
    planeCountSpan = document.querySelector('#plane-count-value')
    statusMessage = document.querySelector('#status-message')
    locationToggle = document.querySelector('#location-toggle')
    locationUpdateBtn = document.querySelector('#location-update')
    locationFields = document.querySelector('#location-fields')
    latInput = document.querySelector('#lat-input')
    lonInput = document.querySelector('#lon-input')
    radiusInput = document.querySelector('#radius-input')
    nextUpdateTimer = document.querySelector('#next-update-timer')

    inputCheckBox.addEventListener("change", handleChange);
    locationToggle.addEventListener("click", toggleLocationFields);
    locationUpdateBtn.addEventListener("click", applyLocationUpdate);

    await persistState();
    await loadLocationPanelState();
    loadLocationInputs();
    await loadLastData();
    await syncTrackingIfChecked();
    await refreshLocationUpdateButton();
    startNextUpdateTimer();
});

chrome.runtime.onMessage.addListener(handleBackgroundMessage)
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes.lastTickTime || changes.pollingIntervalMs || changes.creditsResetAt || changes.checked || changes.nextScanAt) {
        refreshLocationUpdateButton()
        updateNextUpdateTimer()
    }
})

function validateLocation(lat, lon, radius) {
    if (isNaN(lat) || isNaN(lon) || isNaN(radius)) {
        return { ok: false, message: 'Please enter valid numbers for latitude, longitude and radius.' }
    }
    if (lat < -90 || lat > 90) {
        return { ok: false, message: 'Latitude must be between -90 and 90.' }
    }
    if (lon < -180 || lon > 180) {
        return { ok: false, message: 'Longitude must be between -180 and 180.' }
    }
    if (radius <= 0) {
        return { ok: false, message: 'Radius must be greater than 0 km.' }
    }
    if (radius > 150) {
        return { ok: false, message: 'Radius must be 150 km or less to stay within API limits.' }
    }
    return { ok: true }
}

async function handleChange(){
    if(inputCheckBox.checked===true){
        const lat = parseFloat(latInput.value)
        const lon = parseFloat(lonInput.value)
        const radius = parseFloat(radiusInput.value)

        const validation = validateLocation(lat, lon, radius)
        if (!validation.ok) {
            showLocationFields(true)
            alert(validation.message)
            inputCheckBox.checked = false
            await chrome.storage.local.set({checked: false})
            return
        }

        await chrome.storage.local.set({checked: true, lat: lat, lon: lon, radius: radius})
        chrome.runtime.sendMessage({
            type: 'startTracking',
            lat: lat,
            lon: lon,
            radius: radius
        })
        await refreshLocationUpdateButton()
        updateNextUpdateTimer()
    }else{
        await chrome.storage.local.set({checked: false})
        chrome.runtime.sendMessage({
            type : "checkboxStatus",
            checked:false})
        updateNextUpdateTimer()
    }
}

async function persistState(){
    let state = await chrome.storage.local.get(['checked'])
    inputCheckBox.checked=state.checked || false
}

async function syncTrackingIfChecked() {
    const state = await chrome.storage.local.get(['checked', 'lat', 'lon', 'radius'])
    if (state.checked !== true) return

    const lat = typeof state.lat === 'number' ? state.lat : parseFloat(state.lat)
    const lon = typeof state.lon === 'number' ? state.lon : parseFloat(state.lon)
    const radius = typeof state.radius === 'number' ? state.radius : parseFloat(state.radius)

    const validation = validateLocation(lat, lon, radius)
    if (!validation.ok) return

    chrome.runtime.sendMessage({
        type: 'updateLocation',
        lat: lat,
        lon: lon,
        radius: radius
    })
}

function showLocationFields(open) {
    if (!locationFields || !locationToggle) return
    locationFields.hidden = !open
    locationToggle.setAttribute('aria-expanded', open ? 'true' : 'false')
    chrome.storage.local.set({ locationPanelOpen: open })
}

function toggleLocationFields() {
    showLocationFields(locationFields.hidden)
}

async function readNextScanAt() {
    try {
        const backoff = await chrome.alarms.get('backoff')
        if (backoff && backoff.scheduledTime) return backoff.scheduledTime
        const tracking = await chrome.alarms.get('tracking')
        if (tracking && tracking.scheduledTime) return tracking.scheduledTime
    } catch (_) {}
    const stored = await chrome.storage.local.get(['nextScanAt', 'lastTickTime', 'pollingIntervalMs', 'creditsResetAt'])
    if (Number(stored.nextScanAt) > Date.now()) return Number(stored.nextScanAt)
    if (Number(stored.creditsResetAt) > Date.now()) return Number(stored.creditsResetAt)
    const lastTickTime = Number(stored.lastTickTime) || 0
    const intervalMs = Number(stored.pollingIntervalMs)
    const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_POLL_INTERVAL_MS
    if (lastTickTime > 0) return lastTickTime + interval
    return 0
}

async function readPollTiming() {
    const stored = await chrome.storage.local.get(['lastTickTime', 'pollingIntervalMs', 'creditsResetAt', 'checked'])
    const intervalMs = Number(stored.pollingIntervalMs)
    return {
        lastTickTime: Number(stored.lastTickTime) || 0,
        intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_POLL_INTERVAL_MS,
        creditsResetAt: Number(stored.creditsResetAt) || 0,
        tracking: stored.checked === true
    }
}

function formatCountdown(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000))
    const hours = Math.floor(totalSec / 3600)
    const mins = Math.floor((totalSec % 3600) / 60)
    const secs = totalSec % 60
    const pad = (n) => String(n).padStart(2, '0')
    if (hours > 0) return hours + ':' + pad(mins) + ':' + pad(secs)
    return mins + ':' + pad(secs)
}

async function updateNextUpdateTimer() {
    if (!nextUpdateTimer) return
    const tracking = inputCheckBox ? inputCheckBox.checked : false
    if (!tracking) {
        nextUpdateTimer.textContent = 'next update —'
        return
    }
    const nextScanAt = await readNextScanAt()
    const remaining = nextScanAt > 0 ? nextScanAt - Date.now() : 0
    if (remaining <= 0) {
        nextUpdateTimer.textContent = 'next update 0:00'
        return
    }
    nextUpdateTimer.textContent = 'next update ' + formatCountdown(remaining)
}

function startNextUpdateTimer() {
    if (nextUpdateIntervalId) clearInterval(nextUpdateIntervalId)
    updateNextUpdateTimer()
    nextUpdateIntervalId = setInterval(updateNextUpdateTimer, 1000)
}

function remainingCooldownMs(lastTickTime, intervalMs) {
    if (!lastTickTime) return 0
    const elapsed = Date.now() - lastTickTime
    return elapsed >= intervalMs ? 0 : intervalMs - elapsed
}

async function refreshLocationUpdateButton() {
    if (!locationUpdateBtn) return
    const timing = await readPollTiming()
    const waitMs = remainingCooldownMs(timing.lastTickTime, timing.intervalMs)
    if (waitMs > 0) {
        locationUpdateBtn.disabled = true
        locationUpdateBtn.title = 'Wait ' + Math.ceil(waitMs / 1000) + 's before refresh'
    } else {
        locationUpdateBtn.disabled = false
        locationUpdateBtn.title = 'Apply location'
    }
}

async function applyLocationUpdate() {
    const lat = parseFloat(latInput.value)
    const lon = parseFloat(lonInput.value)
    const radius = parseFloat(radiusInput.value)

    const validation = validateLocation(lat, lon, radius)
    if (!validation.ok) {
        showLocationFields(true)
        alert(validation.message)
        return
    }

    await chrome.storage.local.set({ lat: lat, lon: lon, radius: radius })

    if (!inputCheckBox.checked) {
        return
    }

    const timing = await readPollTiming()
    const cooldownMs = remainingCooldownMs(timing.lastTickTime, timing.intervalMs)
    if (cooldownMs > 0) {
        chrome.runtime.sendMessage({
            type: 'updateLocation',
            lat: lat,
            lon: lon,
            radius: radius
        })
        alert('Location saved. Next scan in about ' + Math.ceil(cooldownMs / 1000) + ' seconds.')
        await refreshLocationUpdateButton()
        return
    }

    chrome.runtime.sendMessage({
        type: 'startTracking',
        lat: lat,
        lon: lon,
        radius: radius
    })
    await refreshLocationUpdateButton()
}

async function loadLocationPanelState() {
    const stored = await chrome.storage.local.get(['locationPanelOpen'])
    showLocationFields(stored.locationPanelOpen === true)
}

async function loadLocationInputs(){
    let locationData = await chrome.storage.local.get(['lat', 'lon', 'radius'])
    if (latInput) {
        latInput.value = locationData.lat !== undefined ? locationData.lat : ''
    }
    if (lonInput) {
        lonInput.value = locationData.lon !== undefined ? locationData.lon : ''
    }
    if (radiusInput) {
        radiusInput.value = locationData.radius !== undefined ? locationData.radius : ''
    }
}

function handleBackgroundMessage(message){
    if(message.type!=="data"){
        return
    }
    const data = message?.data
    if (!data) return
    chrome.storage.local.set({ lastData: data })
    displayAircrafts(data)
    displayPlaneCount(data)
    updateNextUpdateTimer()
    refreshLocationUpdateButton()
}

function sanitize(val) {
    if (val == null || val === '') return ''
    const s = String(val).trim()
    return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') || ''
}
function sanitizeNum(val) {
    if (val == null || val === '') return '—'
    const n = Number(val)
    return isNaN(n) ? '—' : n
}

function showStatusError(text) {
    if (!statusMessage) return
    if (text) {
        statusMessage.textContent = text
        statusMessage.hidden = false
    } else {
        statusMessage.textContent = ''
        statusMessage.hidden = true
    }
}

async function loadLastData() {
    let stored = await chrome.storage.local.get(['lastData'])
    if (stored && stored.lastData) {
        displayAircrafts(stored.lastData)
        displayPlaneCount(stored.lastData)
    }
}

function createCard(data){
    const planeCard = document.createElement('div')
    planeCard.classList.add("plane-card")

    const topSection = document.createElement('div')
    topSection.classList.add("top")

    const callSignSpan = document.createElement('span')
    callSignSpan.classList.add("callsign")
    callSignSpan.textContent = sanitize(data?.callSign) || '—'
    
    const distanceSpan = document.createElement('span')
    distanceSpan.classList.add("distance")
    distanceSpan.textContent = (data?.distance != null ? data.distance : '—') + ' km'

    const typeSection = document.createElement('div')
    typeSection.classList.add("type")
    typeSection.textContent = sanitize(data?.type) || '—'

    const infoSection = document.createElement('div')
    infoSection.classList.add("info")
    infoSection.textContent = `${sanitizeNum(data?.altitude)} m • ${sanitizeNum(Math.round((data?.velocity ?? 0) * 3.6))} km/h`

    topSection.appendChild(callSignSpan)
    topSection.appendChild(distanceSpan)

    planeCard.appendChild(topSection)
    planeCard.appendChild(typeSection)
    planeCard.appendChild(infoSection)
    
    return planeCard
}

function setCardsExpanded(hasPlanes) {
    if (!cardsContainer) return
    if (hasPlanes) {
        cardsContainer.classList.add('has-planes')
    } else {
        cardsContainer.classList.remove('has-planes')
    }
}

function displayAircrafts(data){
    const aircrafts = data?.aircrafts
    if (!aircrafts || !Array.isArray(aircrafts)) return

    if (data.error) {
        setCardsExpanded(false)
        showStatusError(data.error)
        cardsContainer.replaceChildren()
        const msg = document.createElement('p')
        msg.className = 'no-planes-msg'
        msg.textContent = data.error
        cardsContainer.appendChild(msg)
        return
    }

    showStatusError('')
    cardsContainer.replaceChildren()
    if (aircrafts.length === 0) {
        setCardsExpanded(false)
        const msg = document.createElement('p')
        msg.className = 'no-planes-msg'
        msg.textContent = 'No planes nearby'
        cardsContainer.appendChild(msg)
        return
    }
    setCardsExpanded(true)
    const planeCards = aircrafts.map(aircraft => createCard(aircraft))
    planeCards.forEach(card => cardsContainer.appendChild(card))
}

function displayPlaneCount(data){
    const planeCount = data?.numberOfPlanesNearby ?? 0
    if (planeCountSpan) planeCountSpan.textContent = planeCount
}
