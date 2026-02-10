let inputCheckBox;

document.addEventListener("DOMContentLoaded", () => {
    inputCheckBox = document.querySelector('#input');
    inputCheckBox.addEventListener("change", handleChange);
    persistState();
});

const interval = 30000
let timeBetweenActivations;
let start=Date.now();

async function handleChange(){
    if(inputCheckBox.checked===true){
        
        chrome.storage.local.set({checked: true})


        timeBetweenActivations = Date.now() - start
        if(timeBetweenActivations<interval){
            await sleep(interval-timeBetweenActivations)
        }


        
        chrome.runtime.sendMessage({checked:true})
        start=Date.now()

    }else{
        chrome.storage.local.set({checked: false})
        chrome.runtime.sendMessage({checked:false})
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

