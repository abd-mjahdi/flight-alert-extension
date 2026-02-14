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

    const area = currentArea || DEFAULT_AREA
    const centerLat = (area.lamin + area.lamax) / 2
    const centerLon = (area.lomin + area.lomax) / 2

    const numberOfPlanes = getNumberOfPlanes(data)
    const preparedObjects = await prepareData(data, centerLat, centerLon)
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

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
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

async function prepareData(data, centerLat, centerLon) {
  const states = data.states;

  if (!states || !Array.isArray(states)) {
    return [];
  }

  const preparedObjects = await Promise.all(
    states.map(async state => {
      const aircraftInfo = await fetchAircraftInfo(state[0]);
      const planeLat = state[6] != null ? Number(state[6]) : NaN;
      const planeLon = state[5] != null ? Number(state[5]) : NaN;
      let distance = null;
      if (!Number.isNaN(planeLat) && !Number.isNaN(planeLon)) {
        distance = Math.round(haversineKm(centerLat, centerLon, planeLat, planeLon) * 10) / 10;
      }
      return {
        callSign: state[1],
        type: aircraftInfo,
        altitude: state[7],
        distance: distance,
        direction: state[10],
        velocity: state[9]
      };
    })
  );

  return preparedObjects;
}
