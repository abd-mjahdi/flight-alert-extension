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
    const preparedObjects = await prepareData(data)
    const finalData = {
        aircrafts : preparedObjects,
        numberOfPlanesNearby : numberOfPlanes
    }

    sendAircraftsData(finalData)

    //console.log(preparedObjects)

}

function sendAircraftsData(finalData){
    chrome.runtime.sendMessage({data : finalData})
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

async function startTracking(){
    processTrackingTick()
    intervalFunctionId = setInterval(processTrackingTick, interval)
}

function stopTracking(){
    clearInterval(intervalFunctionId)

}

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
