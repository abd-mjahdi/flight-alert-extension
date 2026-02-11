let inputCheckBox;
const interval = 30000
let timeBetweenActivations;
let lastActivationTime

document.addEventListener("DOMContentLoaded", async () => {
    inputCheckBox = document.querySelector('#input');
    inputCheckBox.addEventListener("change", handleChange);
    persistState();
    lastActivationTime = await readLastActivationTime();
}); 



async function handleChange(){
    if(inputCheckBox.checked===true){

        await chrome.storage.local.set({checked: true})
        lastActivationTime = await readLastActivationTime()
        if(lastActivationTime===undefined){
        }else{
            timeBetweenActivations = Date.now() - lastActivationTime
            if(timeBetweenActivations<interval){
                await sleep(interval-timeBetweenActivations)
            }
        }
        chrome.runtime.sendMessage({checked:true})
        lastActivationTime = Date.now()
        await chrome.storage.local.set({lastActivationTime})


        

        
    }else{
        await chrome.storage.local.set({checked: false})
        chrome.runtime.sendMessage({checked:false})
        await chrome.storage.local.remove(['lastActivationTime'])
        lastActivationTime = undefined
    }
}

async function persistState(){
    let state = await chrome.storage.local.get(['checked'])
    inputCheckBox.checked=state.checked || false
    console.log(state)
}

function sleep(ms){
    return new Promise(resolve => setTimeout(resolve,ms))
}

async function readLastActivationTime(){
    let timeObject = await chrome.storage.local.get(['lastActivationTime'])
    return timeObject.lastActivationTime;
}
