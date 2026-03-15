// ═══════════════════════════════════════════════════════════════
//  CHAMPIONS FIELD — CLIENT.JS
//  WebRTC client — connects to host's DataChannel.
//  Connection is initiated from the LOBBY and reused in game.html.
// ═══════════════════════════════════════════════════════════════

const RTC_CONFIG={
    iceServers:[
        {urls:"stun:stun.l.google.com:19302"},
        {urls:"stun:stun1.l.google.com:19302"},
    ]
}

let _pc=null, _dc=null, _hostId=null, _myId=null

// Called from lobby.js when host info is known
async function clientConnect(hostId, sigSocket, myId){
    _hostId=hostId; _myId=myId

    if(_pc){ try{_pc.close()}catch{} }
    _pc=new RTCPeerConnection(RTC_CONFIG)

    // Host creates the DataChannel — we receive it via ondatachannel
    _pc.ondatachannel=e=>{
        _dc=e.channel
        _dc.onopen=()=>{
            console.log("[client] DataChannel open to host")
            // Start sending input
            setInterval(()=>{
                if(_dc.readyState==="open" && typeof getInput==="function")
                    clientSendInput(getInput())
            },1000/60)
        }
        _dc.onmessage=e=>{ try{ onHostMessage(JSON.parse(e.data)) }catch{} }
        _dc.onclose=()=>{
            console.warn("[client] DataChannel closed")
            if(typeof onGameEvent==="function") onGameEvent({type:"hostDisconnected"})
        }
    }

    _pc.onicecandidate=e=>{
        if(e.candidate) sigSocket.emit("rtc:ice",{to:hostId,candidate:e.candidate})
    }
}

async function onRtcOffer(from, offer){
    if(from!==_hostId||!_pc) return
    await _pc.setRemoteDescription(new RTCSessionDescription(offer))
    const answer=await _pc.createAnswer()
    await _pc.setLocalDescription(answer)
    // We need the sigSocket here — stored globally in lobby/game bootstrap
    if(typeof _sigSocket!=="undefined") _sigSocket.emit("rtc:answer",{to:_hostId,answer})
}

function onRtcIce(from, candidate){
    if(from!==_hostId||!_pc) return
    _pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(()=>{})
}

function clientSendInput(inp){
    if(!_dc||_dc.readyState!=="open") return
    _clientSeq=(_clientSeq||0)+1
    _dc.send(JSON.stringify({type:"input",input:inp,seq:_clientSeq}))
}
let _clientSeq=0

// For prediction reconciliation
const _inputBuf=[]
function clientBufferInput(inp,seq){
    _inputBuf.push({seq,inp,dt:1/60})
    if(_inputBuf.length>120) _inputBuf.shift()
}
function clientGetInputBuf(){ return _inputBuf }

function onHostMessage(msg){
    switch(msg.type){
        case "init":
            if(typeof onGameInit==="function") onGameInit(msg)
            break
        case "state":
            if(typeof onStateUpdate==="function") onStateUpdate(msg)
            break
        case "goal":
        case "kickoff":
        case "gameOver":
        case "hostDisconnected":
            if(typeof onGameEvent==="function") onGameEvent(msg)
            break
    }
}

// Expose sigSocket reference so onRtcOffer can use it
let _sigSocket=null
function clientSetSigSocket(s){ _sigSocket=s }
