const interval = 30000;
let intervalFunctionId;

chrome.runtime.onMessage.addListener(handleMessage)

async function fetchData(){
    try{
        const response = await fetch("https://opensky-network.org/api/states/all?lamin=51.3&lamax=51.7&lomin=-0.5&lomax=0.3");
        if(!response.ok){
            throw new Error("could not fetch resource");
            
        }
        const data = await response.json();
        console.log(data);
    }
    catch(error){
        console.error(error);
    }
    console.log(intervalFunctionId)
}
function startTracking(){
    fetchData()
    intervalFunctionId = setInterval(fetchData,interval);
    
}
function stopTracking(){
    clearInterval(intervalFunctionId)

}
function handleMessage(message){
    if(message.checked===true){
        startTracking()
    }else{
        stopTracking()
    }
}