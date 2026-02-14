const TRACKING_ALARM = 'tracking';
const interval = 30000;
let currentArea = null;

const DEFAULT_AREA = {
    lamin: 24.8,
    lamax: 25.4,
    lomin: 55.0,
    lomax: 55.8
};

chrome.runtime.onMessage.addListener(handleCheckboxStatus)
chrome.runtime.onMessage.addListener(handleUserLocation)
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === TRACKING_ALARM) processTrackingTick()
})

async function fetchStatesInArea(){
    const area = currentArea || DEFAULT_AREA;
    //console.log(area)
    const url = `https://opensky-network.org/api/states/all?lamin=${area.lamin}&lamax=${area.lamax}&lomin=${area.lomin}&lomax=${area.lomax}`;
    try{
        const response = await fetch(url);
        if(!response.ok){
            throw new Error("could not fetch resource");
        }
        const data = await response.json();
        //console.log(data);
        return data;
    }
    catch(error){
        console.error(error);
        return null;
    }
}

async function processTrackingTick(){
    const data = await fetchStatesInArea();
    if(!data || !data.states){
        sendAircraftsData({ aircrafts: [], numberOfPlanesNearby: 0 });
        return;
    }

    const numberOfPlanes = getNumberOfPlanes(data)
    const preparedObjects = await prepareData(data)
    const finalData = {
        aircrafts : preparedObjects,
        numberOfPlanesNearby : numberOfPlanes
    }

    sendAircraftsData(finalData)

    //console.log(preparedObjects)

}

function sendAircraftsData(finalData){
    const count = finalData?.numberOfPlanesNearby ?? 0
    try {
        if (count > 0) {
            chrome.action.setBadgeText({ text: count > 99 ? '99+' : String(count) })
            chrome.action.setBadgeBackgroundColor({ color: '#58a6ff' })
        } else {
            chrome.action.setBadgeText({ text: '' })
        }
    } catch (e) {
        console.warn('Badge update failed', e)
    }
    // Persist so popup shows latest data when opened (popup may be closed when we send)
    chrome.storage.local.set({ lastData: finalData })
    chrome.runtime.sendMessage({ type: "data", data: finalData }).catch(() => {})
}

function handleCheckboxStatus(message){
    if(message.type!=="checkboxStatus"){
        return
    }
    if(message.checked===true){
        startTracking()
    }else{
        stopTracking()
    }
    
}

function handleUserLocation(message){
    if(!message || message.type !== "position") return;
    const { lat, lon, radius } = message;
    setAreaFromLatLonRadius(lat, lon, radius);
}



function getIcao24s(data) {
  return data.states.map(state => state[0]);
}

function getNumberOfPlanes(data){
    return data?.states?.length || 0
}

async function fetchAircraftInfo(icao24){
    try{
        const response = await fetch(`https://opensky-network.org/api/metadata/aircraft/icao/${icao24}`)
        if(!response.ok){
            return null;
        }
        const data = await response.json()
        const necessaryData = data.model
        return necessaryData
        
    }catch{
        return null
    }
}

function startTracking(){
    processTrackingTick()
    chrome.alarms.create(TRACKING_ALARM, { periodInMinutes: interval / 60000 })
}

function stopTracking(){
    chrome.alarms.clear(TRACKING_ALARM)
    try { chrome.action.setBadgeText({ text: '' }) } catch (_) {}
}

function setAreaFromLatLonRadius(lat, lon, radius) {
    const latDelta = radius / 111
    const lonDelta = radius / (111 * Math.abs(Math.cos(lat * Math.PI / 180)))
    currentArea = {
        lamin: lat - latDelta,
        lamax: lat + latDelta,
        lomin: lon - lonDelta,
        lomax: lon + lonDelta
    }
}

function restoreTrackingIfNeeded() {
    chrome.storage.local.get(['checked', 'lat', 'lon', 'radius'], (result) => {
        if (result.checked !== true) return
        const lat = result.lat
        const lon = result.lon
        const radius = result.radius
        if (typeof lat !== 'number' || typeof lon !== 'number' || typeof radius !== 'number') return
        setAreaFromLatLonRadius(lat, lon, radius)
        startTracking()
    })
}

restoreTrackingIfNeeded()

async function prepareData(data) {
  const states = data.states;
  
  if (!states || !Array.isArray(states)) {
    return [];
  }

  const preparedObjects = await Promise.all(
    states.map(async state => {
      const aircraftInfo = await fetchAircraftInfo(state[0]);
      return new Aircraft(state[1], aircraftInfo, state[7], null, null, state[9]);
    })
  );

  return preparedObjects;
}


class Aircraft{
    constructor(callSign , type , altitude , distance , direction , velocity){
        this.callSign = callSign
        this.type = type
        this.altitude = altitude
        this.distance = distance
        this.direction = direction
        this.velocity = velocity
    }

}
