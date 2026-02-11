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
        console.log(data);
        let callSigns = getCallSigns(data)
        fetchAircraftInfosByCallSigns(callSigns)
        
    }
    catch(error){
        console.error(error);
    }
}

function handleMessage(message){
    if(message.checked===true){
        startTracking()
    }else{
        stopTracking()
    }
}

function getCallSigns(data) {
  return data.states.map(state => state[0]);
}

async function fetchAircraftInfosByCallSigns(callSigns){
    let aircraftsData = await Promise.all(callSigns.map(callSign => fetchAircraftInfo(callSign)))
    return aircraftsData;
}

async function fetchAircraftInfo(callSign){
    try{
        const response = await fetch(`https://opensky-network.org/api/metadata/aircraft/icao/${callSign}`)
        if(!response.ok){
            throw new Error("fetching aircraft info failed")
        }
        const data = await response.json()
        console.log(data)
        return data
        
    }catch(error){
        console.error(error);
    }
}

async function startTracking(){
    fetchStatesInArea()
    intervalFunctionId = setInterval(fetchStatesInArea, interval)
}

function stopTracking(){
    clearInterval(intervalFunctionId)

}
