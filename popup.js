let inputCheckBox;
let cardsContainer;
let planeCountSpan;
let latInput;
let lonInput;
let radiusInput;
const interval = 30000
let timeBetweenActivations;
let lastActivationTime

document.addEventListener("DOMContentLoaded", async () => {
    inputCheckBox = document.querySelector('#checkbox-input')
    cardsContainer = document.querySelector('#cards-container')
    planeCountSpan = document.querySelector('#plane-count-value')
    latInput = document.querySelector('#lat-input')
    lonInput = document.querySelector('#lon-input')
    radiusInput = document.querySelector('#radius-input')
    

    inputCheckBox.addEventListener("change", handleChange);

    persistState();
    loadLocationInputs();
    await loadLastData();
    lastActivationTime = await readLastActivationTime();
}); 



chrome.runtime.onMessage.addListener(handleBackgroundMessage)


async function handleChange(){
    if(inputCheckBox.checked===true){
        const lat = parseFloat(latInput.value)
        const lon = parseFloat(lonInput.value)
        const radius = parseFloat(radiusInput.value)

        if (isNaN(lat) || isNaN(lon) || isNaN(radius)) {
            alert("Please enter valid numbers for latitude, longitude and radius.")
            inputCheckBox.checked = false
            await chrome.storage.local.set({checked: false})
            return
        }

        await chrome.storage.local.set({checked: true, lat: lat, lon: lon, radius: radius})
        lastActivationTime = await readLastActivationTime()
        if(lastActivationTime===undefined){
        }else{
            timeBetweenActivations = Date.now() - lastActivationTime
            if(timeBetweenActivations<interval){
                await sleep(interval-timeBetweenActivations)
            }
        }

        chrome.runtime.sendMessage({
            type : "position",
            lat : lat,
            lon : lon,
            radius : radius
        })
        chrome.runtime.sendMessage({
            type : "checkboxStatus",
            checked: true
        })
        lastActivationTime = Date.now()
        await chrome.storage.local.set({lastActivationTime})


        

        
    }else{
        await chrome.storage.local.set({checked: false})
        chrome.runtime.sendMessage({
            type : "checkboxStatus",
            checked:false})
        // Intentionally keep lastActivationTime so users can't bypass throttling
    }
}

async function persistState(){
    let state = await chrome.storage.local.get(['checked'])
    inputCheckBox.checked=state.checked || false
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
    // Background sends { data: finalData }; payload is message.data
    if(message.type!=="data"){
        return
    }
    const data = message?.data
    if (!data) return
    // save last data so we can show cards after popup reopen
    chrome.storage.local.set({ lastData: data })
    displayAircrafts(data)
    displayPlaneCount(data)
    




}

//will handle ui dynamically here
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

    //appending children
    topSection.appendChild(callSignSpan)
    topSection.appendChild(distanceSpan)

    planeCard.appendChild(topSection)
    planeCard.appendChild(typeSection)
    planeCard.appendChild(infoSection)
    
    return planeCard
}

function displayAircrafts(data){
    const aircrafts = data?.aircrafts
    if (!aircrafts || !Array.isArray(aircrafts)) return
    cardsContainer.replaceChildren()
    if (aircrafts.length === 0) {
        const msg = document.createElement('p')
        msg.className = 'no-planes-msg'
        msg.textContent = 'No planes nearby'
        cardsContainer.appendChild(msg)
        return
    }
    const planeCards = aircrafts.map(aircraft => createCard(aircraft))
    planeCards.forEach(card => cardsContainer.appendChild(card))
}

function displayPlaneCount(data){
    const planeCount = data?.numberOfPlanesNearby ?? 0
    if (planeCountSpan) planeCountSpan.textContent = planeCount
}