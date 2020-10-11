const timerUrl = 'http://localhost:8080/timer'
const wsUrl = 'ws://localhost:8080'
var geval = eval //global eval, use with caution
debug = false

// let ocrad_js, ocrad_resp = null;
let ocradPromise = fetch('https://antimatter15.com/ocrad.js/ocrad.js')
    .then(resp => resp.text())
    .then(val => {console.log('OCRAD.js has downloaded.');  geval(val); 
        console.log('OCRAD.js:Text Recognition has loaded!')} )

console.log('OCRAD:text recognition is loading!')

// NOTE: If I eval in callback, it vanishes into a different context 
// console.log(`OCRAD has evaled ${OCRAD}`)
// new Blob([ocrad_js], {type: 'application/javascript'})
// new Worker(URL.createObjectURL(blob))
// new Worker('data:application/javascript,' +encodeURIComponent(ocrad_js))

//Util methods
function toxFF(num) { //TODO: Use leftpad, call it RGBtoHex
    return num < 16 ? '0'+num.toString('16') : num.toString('16')
}
function toxFFFFFF(num) {
    return toxFF(num>>16&0xFF)+toxFF(num>>8&0xFF)+toxFF(num&0xFF)
}
function hexToRGB(hex) {
    return [hex>>16, hex>>8&0xFF, hex&0xFF]
}
function sqrDist3D(p1, p2) {
    return Math.sqrt( (p1[0]-p2[0])**2 + (p1[1]-p2[1])**2 + (p1[2]-p2[2])**2 )
}

let videoElms = document.querySelectorAll('video') // Should only be 1 video
// TODO: Check if this is being run on Youtube/Twitch or not
// NOTE: Cant find a way were there's 2 video elements in YT or Twitch
if (videoElms.length > 1) console.warn('Found more than 1 video frame??') 
else if (videoElms.length == 0) {
    console.warn('Found no videos')
}
let videoFrame = document.querySelectorAll('video')[0]
const canvas = document.createElement('canvas')
canvas.height = 1080    // videoFrame.videoHeight // Hardcoding for max res
canvas.width = 1920     //videoFrame.videoWidth
const canvasctx = canvas.getContext('2d', {alpha: false})
// const anchorEl = window.location.origin.includes('youtube') ? document.querySelector('#player-theater-container') 
//                 : document.querySelector('.channel-root__player')
const anchorEl = window.location.origin.includes('youtube') ? document.querySelector('#info-contents.style-scope.ytd-watch-flexy')
                : document.querySelector('.channel-info-content .tw-border-t')

if (debug) {
    canvasctx.fillStyle = "red"
    canvasctx.strokeStyle = "red"
    canvas.style.width = "100%"
    anchorEl.before(canvas) // debug youtube
    // NOTE: The 'Cinema' mode in YT is a different node tree, Im not gonna try and track that
}

// quality actually affects the pixel density, thus % based units
// TODO: MVP If quality changes, everything needs to be recalced, and OCR scaling needs to be changed
function genSquare(x, x2, y, y2) {
    return [Math.round(x*videoFrame.videoWidth), Math.round(y*videoFrame.videoHeight), 
            Math.round((x2-x)*videoFrame.videoWidth), Math.round((y2-y)*videoFrame.videoHeight)]
}
function genLine(c1, c2, p1, xaxis=true) {
    // width/height gets set to 1 automatically
    let [cx, cy] = xaxis ? [[c1, (c2-c1)], [p1, 1/videoFrame.videoHeight]] : [[p1, 1/videoFrame.videoWidth], [c1, (c2-c1)]]
    return [Math.round(cx[0]*videoFrame.videoWidth), Math.round(cy[0]*videoFrame.videoHeight), 
            Math.round(cx[1]*videoFrame.videoWidth), Math.round(cy[1]*videoFrame.videoHeight)]
}
// NOTE: Using OCRAD very quickly seems to cause a memory leak, maybe caused by the hitches
// using sync OCRAD causes spikes, I can't track it that well so both are unavoidable
function recognizeText(rect, numeric=false, thres=560, scale=1) { // sync OCR
    let imageData = canvasctx.getImageData(...rect)
    // binarization and scaling with image data
    imageData = scale > 1 ? scaImg(binarization(imageData, thres), scale) : 
                            binarization(scaImg(imageData, scale), thres)
    let str = (numeric) ? OCRAD(imageData, {numeric: true}).trim() : OCRAD(imageData).trim()
    return str
}

function promiseText(rect, numeric=false, thres=560, scale=1) { // async OCR
    let imageData = canvasctx.getImageData(...rect)
    imageData = scale > 1 ? scaImg(binarization(imageData, thres), scale) : 
                            binarization(scaImg(imageData, scale), thres)
    return new Promise( (resolve) => {
        if (numeric) 
            OCRAD(imageData, {numeric: true}, resolve) // TODO: Just pass boolean?
        else {
            OCRAD(imageData, resolve)
        }
    })
    imageData = null //I'm leaking memory somehow, dunno how
}

// Binarization to improve the OCR with a b/w image, max threshold = 765, 3D dist of 255
// most UI is white on dark colours, so thats why invert true.
function binarization(imagedata, threshold=175, invert=true) {
    let bw = invert ? [0, 0xFF] : [0xFF, 0]
    let binImage = new ImageData(imagedata.width, imagedata.height)
    for (let i=0; i < imagedata.data.length; i += 4) {
        px_sum = imagedata.data[i] + imagedata.data[i+1] + imagedata.data[i+2]
        bin = (px_sum > threshold) ? bw[0] : bw[1]
        binImage.data[i] = binImage.data[i+1] = binImage.data[i+2] = bin
        binImage.data[i+3] = 255
    }
    return binImage
}

// thanks to LinusU cause I was doing src -> dist
// TODO: Need to test OCR at different resolutions
// TODO: Move the scaling/thresholds out of hardcoded values
// TODO: pixelheight is just srcHeight/pxHeight = scale, just need to do more OCR testing
function scaImg(srcImg, scale=1, pixelheight=0) {
    if (scale == 1) return srcImg // Dont do this thanks
    let scaImg = new ImageData(srcImg.width*scale, srcImg.height*scale)
    for (let y=0; y < scaImg.height; y++) {
        for (let x=0; x < scaImg.width; x++) {
            let srcX = Math.round(x * srcImg.width / scaImg.width)
            let srcY = Math.round(y * srcImg.height / scaImg.height)
            let srcIdx = (srcX + srcY * srcImg.width) * 4

            for (let rgb=0; rgb<3; rgb++)
                scaImg.data[(x + y * scaImg.width)*4+rgb] = srcImg.data[srcIdx+rgb]
            scaImg.data[(x + y * scaImg.width)*4+3] = srcImg.data[srcIdx+3] // alpha
        }
    }
    return scaImg
}

const phaseName = {
    game: "GAME",
    pause: "PAUSE",
    replay: "REPLAY",
    wait: "WAIT",
    ban: "BAN",
}

// Primary state object for monitor script
let streamState = {
    // currentState: null, // phase - NOTE: Grab this off recent frameBuf when sending to timer P2P
    accum: 0,           // tracking stuff for timer sync
    frameBuf: [],       // ts: timestamp taken, 
                        // phase: gamephase NAME, 
                        // data: from checkbox
    timer: {            // last known timer screenshot 
        countup: false, // counting up or down, pretty S.E
        ts: null,       // when time was determined
        seconds: null,     // TODO: change to seconds
    },
    teams: [],           // Team names
}
streamState.clean = () => { // Clean the state and let phase/timer/teams get resynced
    streamState.frameBuf = [];
    streamState.timer.ts = null;
    streamState.timer.seconds = null;
    streamState.teams = [];
    streamState.accum = 0
}
const frameTime = 500 // 500ms = 1/2s
const frameToSeconds = 1000/frameTime

// Phase information & tracking variable
let phase = {
    // check, format is [% of image, pixel threshold] ordered by most popular
    // grab, just rectangle of the thing
    game: {
            name: phaseName.game,
            check: [{
                            rect: genLine(.265, .305, 0.025),
                            px_thres:{  0x151515: [0.225, 10],    // black bg of team name; close to true black
                                        0xFFFFFF: [0.07, 20]   // team names // TL is making me low-ball this
                                        // 0x82692e: [0.03, 40],   // gold colour of gold/towers
                                        // 0x3893d9: [0.03, 40],   // blue side colour
                                        // 0xfd3956: [0.03, 40]   // red ...
                            }
                        }],
            grab: {
                leftTeamName: genSquare(.265, .305, 0, .05), // left team name
                rightTeamName: genSquare(.695, .725, 0, .05), // right team name
                timer: genSquare(.485, .515, .05, .08) // timer
            },
        },
    // TODO: Gotta pick something else, they changed the game end BG from purple to blue >:(
    gameend: {
        name: phaseName.game,
        debugName: "GAME END",
        check: [{   rect: genLine(.1, .9, .05),
                        px_thres: { 0xa078b7: [0.65, 40]} 
        }]
    },
    wait: { //TODO: Calibrate for 12:13
        name: phaseName.wait,
        pixelCheck: [{0xfcfefe: [.25, 10]}],
        check: [{   rect: genLine(.13, .23, .57),
                        px_thres: {0xfcfefe: [.225, 10], 0x000221 : [.225, 10]}
                    }], // assuming TL is the shortest along the check line
        grab: {    
            leftTeamName: genSquare(.15, .2, .39, .43),
            rightTeamName: genSquare(.32, .37, .39, .43),
            timer: genSquare(.13, .38, .48, .68)
        }
    },
    // Might add a wait2 for the analysis desk timer during first game
    replay: {
        name: phaseName.replay,
        check: [{   rect: genLine(.11, .2, .17),
                        px_thres: { 0x001037: [.40, 30], 0xffffff: [.30, 32]}
                }]
    },
    replay2: {
        /* why is there a replay 2? Funny you should AXE
        the AXE Replay (or whatever its called) covers the regular Replay UI in
        orange black colours. Its slightly easier to check for 2 separate phases and alias them
        than doing set logic with multiple rectangles
        */
        name: phaseName.replay,
        debugName: "AXE REPLAY",
        check: [{   rect: genLine(.11, .2, .17),
                        px_thres: {0xeb5c2a: [.35, 15], 0x160000: [.25, 30]}
        }]
    },
    ban: {
        name: phaseName.ban,
        check: [
                // {   rect: genLine(.8, .87, .504, false),
                //         px_thres: {0x00092b: [.65, 10], 0xf5ffff: [.15, 20]}
                // }, 
                // checks lower at the team names
                {       rect: genLine(.43, .58, .905),
                        px_thres: {0x000527: [.50, 20], 0x27eafc: [.045, 30], // checks for blue/purple
                                    0xb267b9: [.045, 30]} //G2 clocks an impressive 4.8 without the arrow

                }],
        grab: {
            leftTeamName: genSquare(.42, .485, .85, .93),
            rightTeamName: genSquare(.515, .57, .85, .93),
        }
    },
    pause_game: { // this is in-game pause
        name: phaseName.pause,
        debugName: "IN-GAME PAUSE",
        check: [{ rect: genLine(.45, .55, .5), // checks the pause box for color
                    px_thres: {0x141a1a: [.82, 5]} // should be 100%
        }]
    },
    pause2: {
        name: phaseName.pause,
        // Middle analysis desk YAMATOCANNON triggers this
        check: [{ rect: genLine(.45, .55, .81), 
                        px_thres: {0xfaffff: [.26, 10], 0x010729: [.35, 30]} // why does this vary?
        }]
    }
}

let phaseOrder = [phase.pause_game, phase.game, phase.ban, phase.wait, phase.replay, 
    phase.replay2, phase.pause2, phase.gameend]

function scr() { // grab frame & save to canvas buffer, takes about 20-35ms on my laptop 
    // let p = performance.now()
    if (!videoFrame.parentElement) //sometimes video ref is lost
        videoFrame = document.querySelector('video')
    canvasctx.drawImage(videoFrame, 0, 0, videoFrame.videoWidth, videoFrame.videoHeight)
    // console.log(`Took ${performance.now()-p}ms to get video frame`)
    streamState.frameBuf.unshift({
        ts: Date.now(),
        phase: null, //determined phase
        data: {} // any data revelant to that phase
    })
    while(streamState.frameBuf.length > 30) { //clean buffer, per .5s = 15s
        streamState.frameBuf.pop()
    }
}

function debugDraw(rect, refresh=false) { //rect is an array of [x,y,w,h]
    if (refresh)  scr()
    canvasctx.strokeRect(...rect)
}

// outputs all pixels + percentage in a set for tracking
function debugPxCount(rect, thres=null) { 
    let px_count = {}
    let checkImg = canvasctx.getImageData(...rect)
    for (let i=0; i<checkImg.data.length; i+=4) {
        let px16 = `0x${toxFF(checkImg.data[i])}${toxFF(checkImg.data[i+1])}${toxFF(checkImg.data[i+2])}`
        if (!px_count[px16]) px_count[px16] = 0
        px_count[px16]++
    }
    for (let px in px_count) {
        px_count[px] = (px_count[px] * 100) / (rect[3] * rect[2]) // value percentage
    }
    return px_count
}

// Sorts pixel values by %, then orders them to cluster
// Think pxA is 30%, pxB is 10%, 10pixels away culminative to 40%, etc
function debugPxClusterCount(px_set, start=0, end=10) {
    px_arr = Object.entries(px_set)
    px_arr.sort((x,y) => x[1] < y[1]) //sort decreasing percentage
    for (let i=start; i<end; i++) {   // Don't want more than 5 pixel checks so
        let px = hexToRGB(parseInt(px_arr[i][0]))
        let r = []
        for (let j=i+1; j<px_arr.length; j++) {
            let pxj = hexToRGB(parseInt(px_arr[j][0]))
            r.push([px_arr[j][0], sqrDist3D(px, pxj), j]) // label, val, index
        }

        r.sort((x,y) => x[1] > y[1]) // sort by increasing dist 
        r.reduce( (acum, val) => { // area graph
            acum += px_arr[val[2]] [1]; // replace index with accum percentage
            val[2] = acum;
            return acum;
        }, initialValue=px_arr[i][1] );

        console.log(`${px_arr[i][0]} @ ${px_arr[i][1]}`)
        console.log(r)
    }
}

// Does pixel percentage checks to verify phase, returns [set(px, % of rect), pass_fail_boolean]
function verifyStreamPhase(checkObj) { // pass fail this time, add values for debug
    let px_set = {}
    for (let key in checkObj.px_thres) {
        px_set[key] = { num: 0, val: hexToRGB(key), hexstr: toxFFFFFF(key) } // hex: key,
    }
    
    let checkImg = canvasctx.getImageData(...checkObj.rect)
    for (let i=0; i<checkImg.data.length; i+=4 ) {
        let pxval = [checkImg.data[i], checkImg.data[i+1], checkImg.data[i+2]]
        for (let key in px_set) { // optimization: cache dist in hashmap as pixel:dist to avoid sqrdist
            if (sqrDist3D(pxval, px_set[key].val) < checkObj.px_thres[key][1]) { 
                px_set[key].num++
                break // early out
    }   }   }

    let pass = true // check if we passed all variables
    for (let key in px_set) {
        px_set[key].num /= checkImg.width*checkImg.height
        if (px_set[key].num < checkObj.px_thres[key][0])
            pass = false
    }
    return [px_set, pass] // returning the pixel set for 
}

let upperDiv = document.createElement('div')
let stateDiv = document.createElement('span')
anchorEl.before(upperDiv)
stateDiv.textContent = "League Auto Timer intialized-"
const divStyle = `color: black; font-size: 20px; padding: 0 1em`
stateDiv.style.cssText = divStyle
upperDiv.style.cssText = `border: 2px black solid;   display: inline-block;   padding: 0.3em 1em; background-color: #eae6ea`

let timerDiv = document.createElement('span')
timerDiv.textContent = '00:00'
timerDiv.style.cssText = divStyle
timerDiv.style.color = "#0a2dda"
let timerInterval = setInterval ( ()=> { // attempt to trigger getTimerText on the sync
    timerDiv.textContent = getTimerText()
    if (streamState.timer.seconds) {
        let timeToTick = 1000 - (Date.now() - streamState.timer.ts) % 1000
        // setTimeout( ()=> timerDiv.textContent = getTimerText()) // I forgot to set the timer
    }
    // TODO: its pretty bad but I'm gonna brute force right now until timer sync is solid
}, 20)
upperDiv.append(stateDiv, timerDiv)

let btnDiv = document.createElement('div')
btnDiv.style.paddingLeft = "20px"
upperDiv.after(btnDiv)

let clearStateBtn = document.createElement('button')
clearStateBtn.textContent = 'RESET'
clearStateBtn.addEventListener('click', event => {
    streamState.clean()
})

let openTimerBtn = document.createElement('button')
openTimerBtn.textContent = 'OPEN TIMER PAGE'
openTimerBtn.addEventListener('click', event => {
    // console.log('Opening WS');
    connectToSignalingServer()
    randomPass = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2)
    window.open(timerUrl + `?rgpfp=${randomPass}`, '_blank')
})
clearStateBtn.style.cssText = `margin: 0.5em; font-size: 1.6em; padding: 0.2em 0.5em;` +
                                `cursor: pointer; font-weight: bold; background-color: #eae6ea`
openTimerBtn.style.cssText = `margin: 0.5em; font-size: 1.6em; padding: 0.2em 0.5em;` +
                                `cursor: pointer; font-weight: bold; background-color: #eae6ea`

let connStateImg = document.createElement('span')
connStateImg.style.cssText = `background-color: red; width: 1em; height: 1em; display: inline-block`

btnDiv.append(clearStateBtn, openTimerBtn, connStateImg)

let debugDivBuffer = null
if (debug) { // debug buffer
    debugDivBuffer = []
    for (let i=0; i<phaseOrder.length; i++) {
        let debugDiv = document.createElement('div')
        btnDiv.after(debugDiv) //youtube debug*
        debugDiv.style.color = 'snow'
        debugDiv.style.fontSize = "20px"
        debugDiv.style.whiteSpace = "pre"
        debugDivBuffer.push(debugDiv)
    }
}

function debugverifyAllPhases() { // Debug verify all phases with on screen stuff
    // debug is mostly just parsing and putting stuff on screen
    // This writes to debug buffer instead of NOT doing that
    scr()

    let phase_idx = 0
    let foundState = null
    for (let phaseObj of phaseOrder) {
        let px_set = null, check_pass = null;
        let phaseTime = performance.now();
        [px_set, check_pass] = verifyStreamPhase(phaseObj.check[0])
        phaseTime = (performance.now() - phaseTime)

        let px_set_str = ""
        for (let px_p in px_set) {
            px_set[px_p].num = (px_set[px_p].num*100).toFixed(2) + "%"
            let spanColorBlock = `<span style="background:#${px_set[px_p].hexstr};` 
                + `display: inline-block; width: 10px; height:.7em; border: 1px solid white;"></span>`
            px_set_str += `\t ${spanColorBlock} #${px_set[px_p].hexstr.toUpperCase()} : ${px_set[px_p].num} `
        }
        debugDivBuffer[phase_idx++].innerHTML = 
            `<span style='width: 8em; display: inline-block;'>${phaseObj.debugName ? phaseObj.debugName : phaseObj.name}:</span> ` + 
            `<span style='color:${check_pass ? 'limegreen' : 'red'}'>${check_pass}</span> \t` + 
            `| ${phaseTime.toFixed(3)}ms \t| ${px_set_str}`;

        if (check_pass) {foundState = foundState ? foundState : phaseObj} // take first only
    }

    resolvePhase(foundState) 
    // console.log("Done with all phases")
}

// basically debugverifyAllPhases, but with an early out + no crazy debug strings
// TODO: combine with debugVerifyAllPhases maybe
function determineCurrentPhase() {
    scr()

    let foundState = null
    let phaseTime = performance.now();
    for (let phaseObj of phaseOrder) {
        let px_set = null, check_pass = null;
        [px_set, check_pass] = verifyStreamPhase(phaseObj.check[0])
        if (check_pass) {
            foundState = phaseObj
            break //early
        }
    }
    resolvePhase(foundState)
    phaseTime = (performance.now() - phaseTime)
}

// If true, call a resync if no one else does it on the next available frame
let resyncNextFrame = [false, null, 0] // bool, phase, retry

function resolvePhase (foundState) {
    // With phase determined, set the relevant state & etc
    
    // GAME PHASE
    if (foundState == phase.game) {
        let p = performance.now()
        if (getLastKnownState()[0] != phase.game.name) { // if new state
            streamState.accum = 0
            streamState.teams[0] = recognizeText(phase.game.grab.leftTeamName)
            streamState.teams[1] = recognizeText(phase.game.grab.rightTeamName)

            streamState.timer.countup = true
            syncTimer(phase.game, 0) // this is super async
            resyncNextFrame[0] = false
            sendStateOverWebRTC(foundState.name)
        
        }

        streamState.frameBuf[0].phase = phase.game.name
        streamState.accum++
        if (streamState.accum >= (15 * frameToSeconds) && streamState.accum % (15 * frameToSeconds) == 0) { // timer resync every 20s
            console.debug(`GAME Timer Resync`)
            // TODO: pull this resync into a function?
            let estTimerText = getTimerText()
            promiseText(phase.game.grab.timer, true, 560, 3).then(timer_str => {
                timer_arr = lintTimerString(timer_str)
                if (!timer_arr || timer_arr && `${timer_arr[0]}:${timer_arr[1]}` != estTimerText) {
                    console.warn(`check mismatch actual: ${timer_arr[0]}:${timer_arr[1]} est: ${estTimerText}`)
                    resyncNextFrame = [true, foundState, 0]
                }
            })
        }
        if (streamState.accum >= 60 * frameToSeconds) {     // every 60s //TODO: Remove hard code
            console.debug('GAME Accum Team Resync')
            streamState.accum = 0
            streamState.teams[0] = recognizeText(phase.game.grab.leftTeamName)
            streamState.teams[1] = recognizeText(phase.game.grab.rightTeamName)
            sendStateOverWebRTC(foundState.name)
        }
        
        p = performance.now() - p
        stateDiv.textContent = `${foundState.name}: ${streamState.teams[0]} vs. ${streamState.teams[1]} ${debug ? `in ${p.toFixed(3)}ms`: ''}`

    // WAIT PHASE
    } else if (foundState == phase.wait) {
        let p = performance.now()
        if (getLastKnownState()[0] != phase.wait.name) { // ON NEW: sync timer & team names
            streamState.accum = 0
            streamState.timer.countup = false
            syncTimer(phase.wait, 0) // this is async basically
            resyncNextFrame[0] = false
            
            streamState.teams[0] = recognizeText(foundState.grab.leftTeamName)
            streamState.teams[1] = recognizeText(foundState.grab.rightTeamName)
            sendStateOverWebRTC(foundState.name)
        }
        
        
        streamState.frameBuf[0].phase = phase.wait.name
        streamState.accum++
        if (streamState.accum >= (15 * frameToSeconds) && streamState.accum % (15 * frameToSeconds) == 0) { // timer resync every 20s
            console.debug(`WAIT Timer resync`)
            let estTimerText = getTimerText()
            promiseText(phase.wait.grab.timer, true, 560, 0.3).then(timer_str => {
                timer_arr = lintTimerString(timer_str)
                if (!timer_arr || timer_arr && `${timer_arr[0]}:${timer_arr[1]}` != estTimerText) {
                    console.warn(`check mismatch actual: ${timer_arr[0]}:${timer_arr[1]} est: ${estTimerText}`)
                    resyncNextFrame = [true, foundState, 0] // cause a resync next frame
                }
            })
        }
        if (streamState.accum >= 60 * frameToSeconds) {     // every 60s //TODO: Remove hard code
            console.debug('WAIT Accum Team Resync')
            streamState.accum = 0
            // TODO: Wrap in func that returns true only if a change occurred?
            // Might not be useful since 1st state change cant reuse it?
            streamState.teams[0] = recognizeText(foundState.grab.leftTeamName)
            streamState.teams[1] = recognizeText(foundState.grab.rightTeamName)
            sendStateOverWebRTC(foundState.name)
        }
        
        p = performance.now() - p
        stateDiv.textContent = `${foundState.name}: ${streamState.teams[0]} vs. ${streamState.teams[1]}  ${debug ? `in ${p.toFixed(3)}ms`: ''}`

    // PAUSE PHASE
    } else if (foundState == phase.pause_game || foundState == phase.pause2) {
        streamState.frameBuf[0].phase = phase.pause_game.name
        // freeze timer until phase changes
        if (streamState.frameBuf[1].phase == phase.game.name) {
            // NOTE: Trusting our timing method to be accurate instead of doing OCR here
            if (streamState.timer.seconds && streamState.timer.ts) {
                streamState.timer.seconds = (streamState.frameBuf[0].ts - streamState.timer.ts) / 1000 + streamState.timer.seconds
                streamState.timer.ts = null
            }
            // If just seconds or just ts, do nothing
            console.log("Got first PAUSE frame after GAME")
            sendStateOverWebRTC(foundState.name)
        }
        streamState.timer.ts = null
        stateDiv.textContent = `${foundState.name}: ${getTimerText()}`

        // in case of chronobreak, game/wait will force reset timer
        // for pause2, just set phase, we can't retrieve timer to ensure its accurate

    // BAN PHASE
    } else if (foundState == phase.ban) {
        streamState.timer.seconds = null // the ban timer is inconsistent and useless for seconds
        streamState.timer.ts = null

        let p = performance.now()
        if (getLastKnownState()[0] != phase.ban.name) {
            // console.log("Retrieving team names for state BAN")
            streamState.teams[0] = recognizeText(phase.ban.grab.leftTeamName, false, 410, 1) // blue
            streamState.teams[1] = recognizeText(phase.ban.grab.rightTeamName, false, 430, 1) // purple
            sendStateOverWebRTC(foundState.name)
        }
        p = performance.now() - p
        
        stateDiv.textContent = `${foundState.name}: ${streamState.teams[0]} vs. ${streamState.teams[1]}`
        streamState.frameBuf[0].phase = phase.ban.name
        // TODO: Do ban processing*
    } else if (foundState == phase.replay || foundState == phase.replay2) {
        // Show replay state, Don't change timer or teams
        
        if (getLastKnownState()[0] != phase.replay.name) {
            sendStateOverWebRTC(foundState.name)
        }
        
        streamState.frameBuf[0].phase = phase.replay.name // update frame phase at the end
        stateDiv.textContent = `${foundState.name}: ${streamState.teams[0]} vs. ${streamState.teams[1]}`
    } else if (foundState == phase.gameend) {
        // Change phase and freeze timer
        // TODO: Capture only the win/loss scoreboard, freeze timer, send win/loss data
        // TODO: Until I fix this it wont trigger, so do the state sending later
        streamState.frameBuf[0].phase = phase.gameend.name
        streamState.timer.ts = null

    } else if (!foundState) {   // unknown state
        let [framePhase, idx] = getLastKnownState() // wait 5s before entering UNKNOWN
        if (framePhase != null) {  // within boundaries, skip
            
            // streamState.frameBuf[0].phase = framePhase // if not null, pretend its fine
            streamState.accum = 0
            stateDiv.textContent = `UNKNOWN/${framePhase} F${idx}: ${streamState.teams[0]} vs. ${streamState.teams[1]}`
        } else { // Now its null/UNKNOWN
            streamState.accum++
            streamState.frameBuf[0].phase = null // be explicit?
            if (streamState.accum == 0)
                sendStateOverWebRTC(null)   // Let timer know we're in UNKNOWN state

            if (streamState.timer.seconds && streamState.accum > frameToSeconds*15) {    // After 15s delete timer.
                streamState.timer.seconds = null
                streamState.timer.ts = null
                sendStateOverWebRTC(null)
            }
            if (streamState.teams && streamState.accum > frameToSeconds*60*10) { // after 10 minutes delete teams
                streamState.teams = []
                sendStateOverWebRTC(null)
            }
            stateDiv.textContent = `UNKNOWN: ${streamState.teams[0]} vs. ${streamState.teams[1]}`
            // emit a phase change
        }
    }

    // Someone has scheduled a resync
    if (resyncNextFrame[0]) {
        syncTimer(resyncNextFrame[1], resyncNextFrame[2])
        resyncNextFrame[0] = false
    }
}

const minTimeSync = 70 // 70ms
// 125ms is only noticeable side-by-side, at 62 you can't tell at all

// Make this async, return a value when the timer is synced to use as promise
async function syncTimer(iphase, retry=0) {
    // New plan. First, promiseText to get the current timer.
    if (!iphase) {
        console.error('Stop calling this with no phase!!')
        return
    }
    if (retry > 2) {
        console.warn(`Thats retry no. ${retry}, stopping`)
        return
    }
    // TODO: Resolve promiseTimer with an event?
    let breakSync = false   // Break sync timeout/promise if this is true* and resync
    let startTs = streamState.frameBuf[0].ts
    let p = performance.now()

    // 1st. determine the timer at startTs
    let scale = (iphase == phase.wait) ? 0.3 : 3 // TODO: Remove hardcoded binarization/scaling 
    let promiseTimer = promiseText(iphase.grab.timer, true, 560, scale).then(timer_str => {
        timer_arr = lintTimerString(timer_str) // get timer_str at current frame time
        if (timer_arr) {
            streamState.timer.seconds = parseInt(timer_arr[0])*60 + parseInt(timer_arr[1])
            console.log(`At time ${startTs} timer was ${timer_arr}`)
        } else {    // else reject timer, and resync later
            console.warn(`Got invalid timer: ${timer_str} : ${timer_arr}. resyncing next frame`)
            // console.log(`scale value ${scale} iphase.name ${iphase} ${phase}. resyncing next frame`)
            breakSync = true
            resyncNextFrame = [true, iphase, ++retry]
            new Error(`Invalid timer value ${timer_str}`)
        }
    }).catch( error => {
        // Do nothing, this error is triggered from above
    })

    // 2nd. Brute force imageData every 70ms to find where timer changed
    // checking pixels is faster than OCR and less error prone
    // TODO: I can actually target JUST the right-most digit, but not rn
    let baseTimerImg = null 
    // the syncInt(ernal)Timer can get called 100-600ms after frame is saved, just start imageData anew
    console.debug(`Start syncTimer at ${Date.now()%10000}`)
    let timeElasped = 0
    let tsPromiseResolve, tsPromiseReject;
    let tsPromise = new Promise((resolve, reject) => {
        tsPromiseResolve = resolve
        tsPromiseReject = reject
    })
    let syncIntTimer = () => {  // Timing on my computer shows around 20-45ms per tick
        if (breakSync) {
            console.warn("Break sync chain") // invalid timer_str invalidated sync, restart
            tsPromiseReject()
            return
        }
        if (!videoFrame.parentElement) 
            videoFrame = document.querySelector('video')
        canvasctx.drawImage(videoFrame, ...iphase.grab.timer, ...iphase.grab.timer) //only draw timer
        let currTimerTs = Date.now()
        let p = performance.now()
        // console.log(`Sync start @ ${timeElasped}`)
        let currTimerImg = binarization(canvasctx.getImageData(...iphase.grab.timer), 560) //get image
        if (!baseTimerImg) baseTimerImg = currTimerImg

        let pixelComparison = 0     // compare images
        for (let i=0; i<currTimerImg.data.length; i+=4) {
            pixelComparison += Math.abs(currTimerImg.data[i]-baseTimerImg.data[i]) + 
                                Math.abs(currTimerImg.data[i+1]-baseTimerImg.data[i+1]) + 
                                Math.abs(currTimerImg.data[i+2]-baseTimerImg.data[i+2])
        }
        pixelComparison /= (currTimerImg.data.length * 3/4)// convert to average px change; 3/4 is accounting for alpha
        if (pixelComparison > 5) {    // timer synced so quit; 5 is experiment data
            let finalTs = currTimerTs - minTimeSync/2   // Averaging between the interval
            while (finalTs > startTs)   // Go back to before the timerSync was changed, in the same interval
                finalTs -= 1000
            streamState.timer.ts = finalTs 
            streamState.timer.ts += (iphase == phase.wait) ? 1000 : 0 // Probably need to add 1 due to countup but Im too tired to do math
            console.debug(`Synced to ${finalTs%10000} from ${startTs%10000} to ${currTimerTs%10000} - ${minTimeSync/2}`)
            console.debug(`Took ${(performance.now()-p).toFixed(1)}ms to finish ` + 
                        `sync @ ${pixelComparison.toFixed(2)}, found at ${timeElasped}/${currTimerTs}`)
            tsPromiseResolve()
            // TODO: Resolve a promise for ts change? I dunno how to do this
        } else {
            if (timeElasped > 1000) {
                console.warn("You took too long. Now your candy's gone.")
                tsPromiseReject()
                resyncNextFrame = [true, iphase, ++retry]
                return
            }
            baseTimerImg = currTimerImg // NOTE: Might not need this, but it covers smaller flucutations
            console.debug(`Sync ${pixelComparison.toFixed(3)} at ${timeElasped}ms/`
                + `${Date.now()%10000}`
                +` took ${(performance.now()-p).toFixed(2)}ms`)
            timeElasped += minTimeSync
            setTimeout(syncIntTimer, minTimeSync) // same timeout, try again next time
        }
    }

    setTimeout(syncIntTimer, minTimeSync)    // Start it off
    await Promise.all([tsPromise, promiseTimer]).then( () => {
        // Both timer ts & seconds has resolved successfully, so send an update call-
        console.log("Timer Sync was successful")
        sendStateOverWebRTC(streamState.frameBuf[0].phase)
    }).catch( err => {
        console.debug("This is probably the timeout Error. Ignoring-")
    })
    // console.log(`Took ${performance.now()-p} to resolve begin sync`)
}

function sendStateOverWebRTC(phaseName) {
    // Check if dataConnection is open & something else? My brain is dumb
    if (peerDataChannel && peerDataChannel.readyState == "open") {
        let sendObj = {}
        sendObj.timer = streamState.timer
        sendObj.currPhase = phaseName
        sendObj.teams = streamState.teams

        peerDataChannel.send(JSON.stringify(sendObj))
        console.log(`Sent update from ${phaseName} to timer`)
    } else {
        console.log(`P2P is not open for ${phaseName}`)
    }

}

const stateIgnore = Math.round(2.5 * frameToSeconds) // 2.5s
function getLastKnownState() {
    let numIgnored = 0
    for (let f=0; f<streamState.frameBuf.length; f++) {
        if (streamState.frameBuf[f].phase) {
                return [streamState.frameBuf[f].phase, f]
        } else {
            if (!(numIgnored++ > stateIgnore)) //skip N unknown frames
                continue
            return [null, f]
        }
    }
    return [null, -1] // only occurs with buffer.length < stateIgnore
}

/*
OCRAD usually gets timer as 00_00 or 0000 or 000 (missing a number or 2)
therefore we lint and reject anything thats not 4 nums
also it can read a 5 as a 6 OR 5 as a 3 which might cause issues
*/
function lintTimerString(timer_str) {
    // string MUST contain 4 digits 00:00 to 99:99
    let valid_str = ""
    for (let l=0; l<timer_str.length; l++) {
        if (timer_str.charCodeAt(l) >= 48 && timer_str.charCodeAt(l) <= 57)
            valid_str += timer_str[l]
    }
    if (valid_str.length < 4) return null
    return [valid_str.substring(0,2), valid_str.substring(2,4)]
}

function getTimerText() { // Get timer returned as minutes:seconds from the object
    if (!streamState.timer.seconds) return '--:--'

    let secondsToNow = 0
    if (streamState.timer.ts) // if no timestamp, frozen time
        secondsToNow = (Date.now() - streamState.timer.ts)/1000
    timerSecs = streamState.timer.seconds + ((streamState.timer.countup) ? secondsToNow : -secondsToNow)
    if (timerSecs < 0) timerSecs = 0
    return `${Math.trunc(timerSecs / 60).toString().padStart(2,'0')}:${Math.trunc(timerSecs % 60).toString().padStart(2,'0')}`
}

function debugTimeThis(func) {
    let p = performance.now()
    let result = func()
    p = performance.now() - p
    console.log(`took ${p.toFixed(3)}ms`)
    return result
}

SM_I_ID = null
var SM = () => {
    if (!SM_I_ID) {
        if (debug)
            SM_I_ID = setInterval(debugverifyAllPhases, 500);
        else
            SM_I_ID = setInterval(determineCurrentPhase, 500);
        console.log("Starting up interval")
    } else {
        clearInterval(SM_I_ID);
        SM_I_ID = null
        console.log("Clearing interval")
    }
}

if (!debug) {
    ocradPromise.then( () => {
        SM() // start interval
        console.log("League Auto Timer is starting up")
    })
}

var gimme = () => {
    return [streamState, stateDiv, phase, peerConnection, peerDataChannel]
}

// Begin WebRTC implementation testing

const webRTCConfig = {'iceServers': []} // No STUN Servers means only local router conn
let peerConnection = null
let signalWs = null
let peerDataChannel = null
const CLEAN_EVENT = 'STREAM_STATE_CLEAN'
let randomPass = null
let cacheICECandidate = []

function resetPeerConnection () {
    peerConnection.addEventListener('icecandidate', event => {
        if (event.candidate) {
            if (signalWs && signalWs.readyState != WebSocket.OPEN) {
                cacheICECandidate.push(event.candidate)
                console.log("Cache cand.")
            } else {
                signalWs.send(JSON.stringify({
                    monitor: randomPass,
                    'iceCandiate': event.candidate
                }))
            }
            console.log(`Resolving ${event.candidate}`)
        }
    })
    peerConnection.addEventListener('connectionstatechange', event => {
        if (peerConnection.connectionState === 'connected') {
            console.log('We did it! Start up the data channel?')
            connStateImg.style.backgroundColor = "blue"
        }
    });
    peerConnection.ondatachannel =  event => {
        peerDataChannel = event.channel;
        if (signalWs) {
            signalWs.close(1000) // close signalling server
            signalWs = null
        }
        connStateImg.style.backgroundColor = "forestgreen"
        sendStateOverWebRTC(streamState.frameBuf[0].phase)
        peerDataChannel.addEventListener('message', (event) => {
            let msg = JSON.stringify(event.data) // assume json only
            console.log(`Recieved data message from timer ${msg}`)
            
            // Only event we'll get is a state reset*
            if (msg.command == CLEAN_EVENT)
                streamState.clean()
        })
        peerDataChannel.addEventListener('close', event => {
            console.log('P2P datachannel was closed.')
            connStateImg.style.backgroundColor = "red"
            peerDataChannel = null
        })
    };
}

function connectToSignalingServer () {
    // Create new WS and start handshake with timer window
    signalWs = new WebSocket(wsUrl)

    signalWs.addEventListener('open', async () => {
        // Seems Chrome and Firefox have different standards for what triggers ICE candidates
        // Chrome will only do it when you create a data channel before the offer
        // Firefox will do it early. Needs more testing
        peerConnection = new RTCPeerConnection(webRTCConfig)
        resetPeerConnection()
        connStateImg.style.backgroundColor = "orange"
        signalWs.send(JSON.stringify({ 
            monitor: randomPass,
            register: true,
        }))
        
    })

    signalWs.addEventListener('message', async (event) => {
        let msg = JSON.parse(event.data)
        if (msg.paired) {
            // Timer must send the offer first
            console.log("Paired with timer")
            connStateImg.style.backgroundColor = "yellow"
        } else if (msg.offer) { // parse offer
            peerConnection.setRemoteDescription(new RTCSessionDescription(msg.offer))
            let answer = await peerConnection.createAnswer()
            await peerConnection.setLocalDescription(answer)
            signalWs.send(JSON.stringify({
                monitor: randomPass,
                answer: answer
            }))
            // peerDataChannel = peerConnection.createDataChannel('LeagueAutoTimer')
            console.log("Recieved offer, sent answer")
        } else if (msg.iceCandiate) {
            try {
                console.log("Recieved ice cand.")
                await peerConnection.addIceCandidate(msg.iceCandiate) //maybe doesnt need to be async?
            } catch (e) {
                console.error('uh oh spaghettos', e)
            }
        }
    })
}

/*  Game checks
GAME CHECK
*   Scoreboard is always static, minimap is always static (border)
*   scoreboard gets changed by towers plates
*   Lower half / champion info can retract/show stats on top, so useless

    Sometimes scoreboard is in replays. Will ignore since timer should reset*
    END OF GAME
        End of game is based on UI similar to pause
        Might skip game end & let timer fade out. It's not MVP or showing new info

BAN PHASE
    Hard to get info 
    Ban phase might skip 1st ban flash on Blue side
        might skip a number of bans- need to take the latest valid input
    loading bar may also crash so useless to track
    BAN TRACKING
        bans check is hard but doable with comparison over time
        hovers make it even harder
        If I track the brightness on a pixel over multiple secs, I can see action

REPLAY*
    Also has a UI element in the bot left
    pip replay covers up the minimap/ left side pip
    Pro-view replays are possible but no UI? review

    Weird 60s countdown at end of stream, needs to be checked?
        Skip cause of MVP

PAUSE
    pause occurs during game-screen, but sepia tone on game view with UI in middle
        can check that with simple UI color in center
            4:09:25 play ins day 4 SUP v. LGC
    Then UI is bottom-center with text similar to game end

WAIT
    Based on timer image on middle-left
    Grab team names
        worlds cooldown but I dont care for MVP
OTHER
    about 10s will be the timer quit/pause
    
    There's a CS Delay which is same UI as pause

*/

console.log("Thats all folks")