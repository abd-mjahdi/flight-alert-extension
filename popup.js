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
const interval = 120000
let timeBetweenActivations;
let lastActivationTime

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

    inputCheckBox.addEventListener("change", handleChange);
    locationToggle.addEventListener("click", toggleLocationFields);
    locationUpdateBtn.addEventListener("click", applyLocationUpdate);

    await persistState();
    await loadLocationPanelState();
    loadLocationInputs();
    await loadLastData();
    await syncTrackingIfChecked();
    lastActivationTime = await readLastActivationTime();
    refreshLocationUpdateButton();
});

chrome.runtime.onMessage.addListener(handleBackgroundMessage)

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
        lastActivationTime = await readLastActivationTime()
        if(lastActivationTime!==undefined){
            timeBetweenActivations = Date.now() - lastActivationTime
            if(timeBetweenActivations<interval){
                await sleep(interval-timeBetweenActivations)
            }
        }

        chrome.runtime.sendMessage({
            type: 'startTracking',
            lat: lat,
            lon: lon,
            radius: radius
        })
        lastActivationTime = Date.now()
        await chrome.storage.local.set({lastActivationTime})
        refreshLocationUpdateButton()
    }else{
        await chrome.storage.local.set({checked: false})
        chrome.runtime.sendMessage({
            type : "checkboxStatus",
            checked:false})
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

function getLocationUpdateCooldownMs() {
    if (lastActivationTime === undefined) return 0
    const elapsed = Date.now() - lastActivationTime
    return elapsed >= interval ? 0 : interval - elapsed
}

function refreshLocationUpdateButton() {
    if (!locationUpdateBtn) return
    const waitMs = getLocationUpdateCooldownMs()
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

    const cooldownMs = getLocationUpdateCooldownMs()
    if (cooldownMs > 0) {
        chrome.runtime.sendMessage({
            type: 'updateLocation',
            lat: lat,
            lon: lon,
            radius: radius
        })
        alert('Location saved. Next scan in about ' + Math.ceil(cooldownMs / 1000) + ' seconds.')
        refreshLocationUpdateButton()
        return
    }

    chrome.runtime.sendMessage({
        type: 'startTracking',
        lat: lat,
        lon: lon,
        radius: radius
    })
    lastActivationTime = Date.now()
    await chrome.storage.local.set({ lastActivationTime: lastActivationTime })
    refreshLocationUpdateButton()
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

function sleep(ms){
    return new Promise(resolve => setTimeout(resolve,ms))
}

async function readLastActivationTime(){
    let timeObject = await chrome.storage.local.get(['lastActivationTime'])
    return timeObject.lastActivationTime;
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
