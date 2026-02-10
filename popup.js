persistState()
const inputCheckBox = document.querySelector('#input');
inputCheckBox.addEventListener("change", handleChange);


async function handleChange(){
    if(inputCheckBox.checked===true){
    
        chrome.storage.local.set({checked: true})
        chrome.runtime.sendMessage({checked:true})

    }else{
        chrome.storage.local.set({checked: false})
        chrome.runtime.sendMessage({checked:false})
    }
}

async function persistState(){
    let state = await chrome.storage.local.get(['checked'])
    inputCheckBox.checked=state.checked
}



