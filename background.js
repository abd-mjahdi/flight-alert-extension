const interval = 30000;
let intervalFunctionId;

chrome.runtime.onMessage.addListener(handleMessage)

async function fetchStatesInArea(){
    try{
        const response = await fetch("https://opensky-network.org/api/states/all?lamin=24.8&lamax=25.4&lomin=55.0&lomax=55.8");
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
        return;
    }

    const numberOfPlanes = getNumberOfPlanes(data)
    const icao24s = getIcao24s(data);
    const aircraftsData = await fetchAircraftInfosByIcao24s(icao24s);
    console.log(aircraftsData);
    
}

function sendAircraftsData(aircraftsData){
    chrome.runtime.sendMessage({data : aircraftsData})
}

function handleMessage(message){
    if(message.checked===true){
        startTracking()
    }else{
        stopTracking()
    }
}

function getIcao24s(data) {
  return data.states.map(state => state[0]);
}

function getNumberOfPlanes(data){
    return data.states.length
}

async function fetchAircraftInfosByIcao24s(icao24s){
    let aircraftsData = await Promise.all(icao24s.map(icao24 => fetchAircraftInfo(icao24)))
    return aircraftsData;
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

async function startTracking(){
    processTrackingTick()
    intervalFunctionId = setInterval(processTrackingTick, interval)
}

function stopTracking(){
    clearInterval(intervalFunctionId)

}

function prepareData(data){
    const states = data.states
    const preparedObjects = states.map(state => new Aircraft(state[1],state[0],state[7],null,null,state[9]))
    return preparedObjects
}

class Aircraft{
    constructor(callSign , icao24 , altitude , distance , direction , velocity){
        this.callSign = callSign
        this.icao24 = icao24
        this.altitude = altitude
        this.distance = distance
        this.direction = direction
        this.velocity = velocity
    }

}
