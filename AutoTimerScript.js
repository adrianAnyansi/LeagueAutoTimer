let ocrad_js, tesseract_js, ocrad_resp, tesseract_resp = null;
fetch('https://antimatter15.com/ocrad.js/ocrad.js')
    .then(resp => ocrad_resp = resp.text())
    .then(val => {ocrad_js = val; console.log('OCRAD.js has completed download')} )
// Note that I cannot eval in a promise as it vanishes into a different context 
eval(ocrad_js)


// new Blob([ocrad_js], {type: 'application/javascript'})
// new Worker(URL.createObjectURL(blob))
// new Worker('data:application/javascript,' +encodeURIComponent(ocrad_js))

// fetch('https://unpkg.com/tesseract.js@v2.1.3/dist/tesseract.min.js')
//     .then(resp => tesseract_resp = resp.text())
//     .then(val => {tesseract_js = val; eval(tesseract_js); })

// can change whitelist based on the query, or have 2 workers
/*
let t_worker = new Tesseract.createWorker({
    // logger: m => console.log(m),
});
await t_worker.load();
await t_worker.loadLanguage('eng');
await t_worker.initialize('eng');
await t_worker.setParameters({
tessedit_char_whitelist: '0123456789:',
});
*/

//Util methods
function toxFF(num) { //imagine left-padding
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
function tesseract_rect(rect) { // There are now 16 competing standards
    return {rectangle: {left: rect[0], top: rect[1], width: rect[2], height: rect[3]}}
}

let videoElms = document.querySelectorAll('video') // Should only be 1 video
if (videoElms.length > 1) console.log('Found more than 1 video frame??') 
let videoFrame = document.querySelectorAll('video')[0]
let canvas = document.createElement('canvas')
canvas.height = videoFrame.videoHeight // TODO: max this 1080p or 2K
canvas.width = videoFrame.videoWidth
let canvasctx = canvas.getContext('2d', {alpha: false})
canvasctx.fillStyle = "red"
canvasctx.strokeStyle = "red"
document.querySelectorAll('#player-theater-container')[0].after(canvas) // debug youtube

const phaseName = {
    game: "GAME",
    pause: "PAUSE",
    replay: "REPLAY",
    wait: "WAIT",
    ban: "BAN",
}

// TODO: should be a clear state function to reset
let streamState = {
    // currentTs: null, //timestamp of current canvas
    currentState: null, //phase
    accum: 0,           // tracking stuff for timer sync
    frameBuf: [],       // ts: timestamp taken, 
                        // phase: gamephase NAME, 
                        // data: from checkbox
    timer: {            // last known timer screenshot 
        countup: false, //
        ts: null,       // when time was determined
        time: null,     // time in seconds
    },
    teams: []           // Team names
}

// Determine phase
// check, format is [% of image, pixel threshold] ordered by most popular
// grab, just image of the resulting start
let streamPhase = {
    game: {
            name: phaseName.game,
            check: [{
                            rect: genLine(.265, .305, 0.025),
                            px_thres:{  0x151515: [0.27, 10],    // black bg of team name; close to true black
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
    gameend: {
        name: phaseName.game,
        debugName: "GAME END",
        check: [{   rect: genLine(.1, .9, .05),
                        px_thres: { 0xa078b7: [0.65, 50]}
        }]
    },
    wait: {
        name: phaseName.wait,
        pixelCheck: [{0xfcfefe: [.25, 10]}],
        check: [{   rect: genLine(.13, .23, .57),
                        px_thres: {0xfcfefe: [.25, 10], 0x000221 : [.25, 10]}
                    }], // assuming TL is the shortest along the check line
        grab: {    
            leftTeamName: genSquare(.15, .2, .39, .43),
            rightTeamName: genSquare(.32, .37, .39, .43),
            timer: genSquare(.13, .38, .48, .68)
        }
    },
    // Might add a wait2 for the analysis desk timer
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
                        px_thres: {0x000527: [.50, 20], 0x27eafc: [.05, 25], // checks for blue/purple
                                    0xb267b9: [.05, 25]}

                }],
        grab: {
            leftTeamName: genSquare(.42, .485, .85, .93),
            rightTeamName: genSquare(.515, .57, .85, .93),
        }
        // TODO: Check if other bottom-center UI triggers this
    },
    pause_game: { // this is in-game pause
        name: phaseName.pause,
        debugName: "IN-GAME PAUSE",
        check: [{ rect: genLine(.45, .55, .5), // checks the pause box for color
                    px_thres: {0x141a1a: [.85, 5]} // should be 100%
        }]
    },
    pause2: {
        name: phaseName.pause,
        // checks the GAME PAUSE text
        // similar UI in this position do not have white text here*
        check: [{ rect: genLine(.45, .55, .81), 
                        px_thres: {0xfaffff: [.26, 10], 0x010729: [.35, 30]} // why does this vary?
        }]
    }
}

function scr() { // grab frame & save to canvas buffer, takes about 20-35ms on my laptop with 30% CPU
    let p = performance.now()
    if (!videoFrame.parentElement) //sometimes video ref is lost
        videoFrame = videoFrame.querySelector('video')
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
    
// quality actually affects the pixel density, thus % based units
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

let phaseOrder = [ streamPhase.game, streamPhase.ban, streamPhase.wait, streamPhase.replay, 
    streamPhase.replay2, streamPhase.pause_game, streamPhase.pause2, streamPhase.gameend]

function debugDraw(rect, refresh=false) { //rect is an array of [x,y,w,h]
    if (refresh)  scr()
    canvasctx.strokeRect(...rect)
}

function debugPxCount(rect, thres=null) { // output the pixels in set for tracking
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
    return [px_set, pass]
}


let stateDiv = document.createElement('div')
document.querySelector('canvas').before(stateDiv)
stateDiv.style.color = 'snow'
stateDiv.style.fontSize = '20px'

let debugDivBuffer = []
for (let i=0; i<8; i++) {
    let debugDiv = document.createElement('div')
    document.querySelector('canvas').before(debugDiv) //youtube debug*
    debugDiv.style.color = 'snow'
    debugDiv.style.fontSize = "20px"
    debugDiv.style.whiteSpace = "pre"
    debugDivBuffer.push(debugDiv)
}

function debugverifyAllPhases() { // Debug verify all phases with on screen stuff
    // debug is mostly just parsing and putting stuff on screen
    scr()

    let phase_idx = 0
    let foundState = null
    for (let checkObj of phaseOrder) {
        let px_set = null, check_pass = null;
        let phaseTime = performance.now();
        [px_set, check_pass] = verifyStreamPhase(checkObj.check[0])
        phaseTime = (performance.now() - phaseTime)

        let px_set_str = ""
        for (let px_p in px_set) {
            px_set[px_p].num = (px_set[px_p].num*100).toFixed(2) + "%"
            let spanColorBlock = `<span style="background:#${px_set[px_p].hexstr}; display: inline-block; width: 10px; height:.7em; border: 1px solid white;"></span>`
            px_set_str += `\t ${spanColorBlock} #${px_set[px_p].hexstr.toUpperCase()} : ${px_set[px_p].num} `
        }
        debugDivBuffer[phase_idx++].innerHTML = 
            `<span style='width: 8em; display: inline-block;'>${checkObj.debugName?checkObj.debugName : checkObj.name}:</span> ` + 
            `<span style='color:${check_pass ? 'limegreen' : 'red'}'>${check_pass}</span> \t` + 
            `| ${phaseTime}ms \t| ${px_set_str}`;

        if (check_pass) {foundState = foundState ? foundState : checkObj} //take first 
    }

    // run async :(
    resolvePhase(foundState) 
    // console.log("Done with all phases")
}

async function resolvePhase (foundState) {
    // Ok lets start grabbing info and testing
    
    if (foundState == streamPhase.game) {
        streamState.frameBuf[0].phase = streamPhase.game.name
        // if new state
        let p = performance.now()
        let promisesOCR = [promiseTeamNames(streamPhase.game)]
        promisesOCR[2] = promiseText(streamPhase.game.grab.timer, true, 560, 3)
        
        // resolving both team names & timer at same time, but I'll move timer out of this soon
        Promise.all(promisesOCR).then( (arr) => {
            p = performance.now() - p
            setTimerObj(arr[3])
            stateDiv.innerHTML = `${streamState.teams[0]} vs. ${streamState.teams[1]}  ${arr[0].trim()} in ${p}ms`
        })

        // setGamePhaseData()
        // set accum, do timer sync every 20s & team sync 30s
    } else if (foundState == streamPhase.wait) {
        // ON NEW: sync timer & team names
        streamState.frameBuf[0].phase = streamPhase.wait.name
        let p = performance.now()
        let promisesOCR = []
        promisesOCR.concat( promiseTeamNames(streamPhase.wait) ) // could be 2 or less
        // this works without numeric, but doesnt affect timing
        // let timer_str = lintTimerString(recognizeText(streamPhase.wait.grab.timer, true, 175, 1)) //takes 280ms. thats wait too much
        
        let timer_str = ""
        promisesOCR[2] = new Promise(resolve => { // timer takes 100ms with scaling damn
            OCRAD(binarization(scaImg(canvasctx.getImageData(...streamPhase.wait.grab.timer), 0.3), 
                    560), {numeric:true}, resolve)
        }).then( str => timer_str = str.trim())
        // promiseText(streamPhase.wait.grab.timer, true, 560, 0.3)
        //                     .then(str => timer_str = str.trim())
        // promisesOCR[2] = promiseText(streamPhase.wait.grab.timer)
        // promisesOCR[2].then( str => {timer_str = str; setTimerObj(str)})
        
        // Resolve OCR promises
        Promise.all(promisesOCR).then( () => {
            p = performance.now() - p
            setTimerObj(timer_str)
            // trigger update event or what
            stateDiv.innerHTML = `${streamState.teams[0]} vs. ${streamState.teams[1]}  ${timer_str} in ${p}ms`
        })
        
        // console.log(`finished all task for WAIT ${performance.now() - p}ms`)
    } else if (foundState == streamPhase.pause_game) {
        streamState.frameBuf[0].phase = streamPhase.pause.name
        // freeze timer until phase changes
        streamState.timer.ts = null
        // TODO: do the timer calc server side then set the timer.time to value

        // in case of chronobreak, game/wait will force reset timer
        // for pause2, just display pause cause we will lose the timer.
    } else if (foundState == streamPhase.ban) {
        // TODO: Clear timer, set teams, do ban processing*
        streamState.timer.time = null
        streamState.timer.ts = null
        let p = performance.now()
        streamState.teams[0] = recognizeText(streamPhase.ban.grab.leftTeamName, false, 410, 1) // blue
        streamState.teams[1] = recognizeText(streamPhase.ban.grab.rightTeamName, false, 430, 1) // purple
        p = performance.now() - p
        stateDiv.innerHTML = `${streamState.teams[0]} vs. ${streamState.teams[1]} in ${p}ms`
    } else if (foundState == streamPhase.replay || foundState == streamPhase.replay2) {
        // Show replay state, Don't change timer or teams
        streamState.frameBuf[0].phase = streamPhase.replay.name
    } else if (!foundState) {
        // unknown state
        // wait 5s to confirm this before resetting timer/teams

        // set accum, wait for 15s to fade out timer. wait for 3m to fade teams
    }
}

async function promiseTeamNames(phase, force=false) {
    // check if team names are current
    let teamPromises = [], prom = null
    let teamRef = [phase.grab.leftTeamName, phase.grab.rightTeamName]
    let teamSave = streamState.teams

    for (let i=0; i<2; i++) {
        if (!streamState.teams[i] || force) {
            console.log('Getting team names')
            prom = promiseText(teamRef[i])
            prom.then(str => teamSave[i] = str.trim()) // save directly to state
            if (!teamSave[i])    teamSave[i] = prom // only save promise to complete null check
            teamPromises[i] = prom
        }
    }
    return teamPromises
}

let minTimeDrift = 70 // 70ms
// 125ms is only noticeable side-by-side, at 62 you can't tell at all

async function startSyncTimer(phase, retry=0)

async function syncTimer(phase, retry=0, countup=false, options={}) {
    let lastSyncTime = null     // Find last sync time
    for (let f of streamState.frameBuf) {
        if (f['data']['timer']) { // if this has been synced; will only be set
            lastSyncTime = f['data']['timer']
            break
        }
    }

    if (retry>2) {
        console.log(`Too many retries`)
        return
    }
    
    // if lintTimerString fails or if the timer jitters >2s,
    // we need to drop the whole sync and restart

    // I'm gonna treat this as a recursive function start, bailing out when I fail
    syncPrecision = 1000
    console.log(`Syncing for 1000ms on retry ${retry}`)
    let newestFrame = streamState.frameBuf[0]
    // set timer state so it doesnt recast loop?

    promiseText(phase.grab.timer, true, 560, 3).then( timer_str => {
        // top-level 1000ms start. no sync check or time check
        if (!lintTimerString(timer_str)) {
            console.log("Failed to sync (no timer), retrying")
            syncTimer(phase, retry++) // clear timer? cause we're not on the frametime anymore.
            // should timeout this with nearest frametime
        }
        newestFrame['data']['timer'] = {
            time: lintTimerString(timer_str), // this should be total seconds not string
            sync: syncPrecision,
            countup: countup
        }
        console.log(`synced at ${syncPrecision}ms`)
        let timeElasped = 500 - (Date.now() - streamState.frameBuf[0].ts) 

        // now this is the recurse down
        // damn this needs to be its own function I think, so it can call itself
        setTimeout( 
    })
}

let timerMaxPrecision = 63
async function recurseDown(syncPrecision, phase, retry) {

    if (syncPrecision <= timerMaxPrecision) return

    let lastSyncTime = null
    for (let f of streamState.frameBuf) {
        if (f['data']['timer']) {
            lastSyncTime = f['data']['timer']
            break
        }
    }

    // now confirm that sync is in order & valid
    if (!lastSyncTime) {
        console.log("Failed to sync timer, couldn't find the last sync")
        syncTimer(phase, retry++)
    } else {
        console.log(`Syncing for ${syncPrecision}ms`)
        if (syncPrecision < 500) scr() // Take screenshot if less than
        // Need to do Promise to get new sync time
        // Might need a special promise to work on selected frames? cause I'm basically
        // saving to the wrong frame here if I'm not careful
        promiseText(phase.grab.timer, true, 560, 3).then( timer_str => {
            let nowDate = Date.now()
            if (nowDate - streamState.frameBuf[0].ts > 70) {
                console.log("You took too long. Now your candy's gone.")
                syncTimer(retry++)
            }
            let timerdir = lastSyncTime.countup ? 1 : -1
            if (dateNow - lastSyncTime.time) // ah this is so confusing omg why is this async
            // why is it always async
        })
        // then I can ensure time is in sync, and has the proper number
    }

}

}
    if (!lastSyncTime) { // this gets run after scr so we dont need a new one
        let newFrame = streamState.frameBuf[0]
        console.log("syncing for 1000ms")
        // AAAAAAHH I need to do the special timer stuff- pretend its game only right now
        promiseText(phase.grab.timer, true, 560, 3).then( timer_str => {
            newFrame['data']['timer'] = {
                time: lintTimerString(timer_str),
                sync: 1000
            }
            console.log("synced at 1000ms")
            // timeout func for wait for the next frame
        })
    } else {        // now lets start to sync down
        let newSync = lastSyncTime['sync'] / 2
        
        // do timeout on the next captured frame without taking a screenshot
        setTimeout( (syncPrecision) => {
            if (newSync < 500) scr() // take closer screenshot

            promiseText(phase.grab.timer, true, 560, 3).then( (timer_str) => {
                let nowDate = Date.now()
                if (nowDate - streamState.frameBuf[0].ts > 70) 
                    nowDate = null // break sync, but for now pass
                    
                // ensure that last known timer is synced with this
                streamState.frameBuf[0]['data']['timer'] = {
                    time: lintTimerString(timer_str),
                    sync: syncPrecision
                }

                // if timer_str > new store, 1-sync/2 or 
            })
        } ,550, newSync);
    }
}

function recognizeText(rect, numeric=false, thres=560, scale=1, tesseract=false) {
    // use different OCR on tesseract arg
    let imageData = canvasctx.getImageData(...rect)
    if (tesseract) { // Tesseract - TODO: add numeric options if required
        // binarization and copy back to canvas with no scaling
        canvasctx.putImageData(binarization(imageData, thres, true), 0, 0)
        let t_promise = t_worker.recognize(canvas, tesseract_rect(rect))
        // Tesseract needs a promise return and I dont want to do that cause this func isnt async
        // let str = (await t_promise).data.text.trim();
        return str
    } else { // OCRAD
        // binarization and scaling with image data
        imageData = scaImg(binarization(imageData, thres), scale)
        let str = (numeric) ? OCRAD(imageData, {numeric: true}).trim() : OCRAD(imageData).trim()
        return str
    }
}

function promiseText(rect, numeric=false, thres=560, scale=1) {
    // dont wanna talk about it; OCRAD only right now
    let imageData = canvasctx.getImageData(...rect) //testing shows <4ms, just using it sync
    imageData = binarization(scaImg(imageData, scale), thres)
    return new Promise( (resolve, reject) => {
        if (numeric) 
            OCRAD(imageData, {numeric: true}, resolve)
        else {
            OCRAD(imageData, resolve)
        }
    })
}

let stateIgnore = 5 //seconds TODO: change to constant
function getLastKnownState() {
    let numIgnored = 0
    for (let f=0; f<streamState.frameBuf.length; f++) {
        if (streamState.frameBuf[f].phase) {
                return [frame.phase, f]
        } else {
            if (!(numIgnored++ > stateIgnore)) //skip N frames until unknown is returned
                continue
            return [null, f]
        }
    }
    return [null, -1] // only occurs with buffer.length < stateIgnore
}

/*
00_##
can become 0_##
during 02_00 it became 0200 - fairly common every 30s
on 02_30 - 02_35 the 2nd didgit disappeared multiple times
sometimes there's a space between 11 to 1 1
might bw 98% accurate so ditch invalid values?#
at 15_26 - 15_28 we lose a number
18_18 missed a digit 18_1
reading a 6 as a 5 in 26:30
*/

function lintTimerString(timer_str) {
    // string MUST contain 4 digits 00:00 to 99:99
    let valid_str = ""
    for (let l=0; l<timer_str.length; l++) {
        if (timer_str.charCodeAt(l) >= 48 && timer_str.charCodeAt(l) <= 57)
            valid_str += timer_str[l]
    }
    if (valid_str.length < 4) return null
    return valid_str
}

function setTimerObj(timer_str) {
    timer_str = lintTimerString(timer_str)
    if (timer_str) {
        streamState.timer.time = parseInt(timer_str.substring(0,2))*60 + 
                                            timer_str.substring(2,4)
        streamState.timer.ts = streamState.frameBuf[0].ts
    }
    return (timer_str!=null)
}

async function setGamePhaseData () {
    // console.log('IN GAME state')
    // let imageData = canvasctx.getImageData(...streamPhase.game.grab.timer)
    // imageData = upscaleImg(binarization(imageData, 255), 3)
    let p = performance.now()
    streamState.teams[0] = recognizeText(streamPhase.game.grab.leftTeamName)
    streamState.teams[1] = recognizeText(streamPhase.game.grab.rightTeamName)
    let timer_str = lintTimerString(recognizeText(streamPhase.game.grab.timer, true, 560, 3))
    p = performance.now() - p

    if (timer_str) {
        streamState.timer.time = parseInt(timer_str.substring(0,2))*60 + 
                                                    timer_str.substring(2,4)
        streamState.timer.ts = streamState.frameBuf[0].ts
        //TODO: Start to do the timer stagger to check state
    }
    stateDiv.innerHTML = `${streamState.teams[0]} vs. ${streamState.teams[1]}  ${timer_str} in ${p}ms`
    // After state* is set, push an event to update the timer over p2p
}

// Binarization to improve the OCR with a b/w image
// most UI is white on dark colours, so thats why invert true
// threshold goes to 765
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

function debugTimeThis(func) {
    let p = performance.now()
    let result = func()
    p = performance.now() - p
    console.log(`took ${p}ms`)
    return result
}

SM_I_ID = null
var SM = () => {
    if (!SM_I_ID) {
        SM_I_ID = setInterval(debugverifyAllPhases, 500);
        console.log("Starting up interval")
    } else {
        clearInterval(SM_I_ID);
        SM_I_ID = null
        console.log("Clearing interval")
    }
}
// also about 10% CPU damn

   

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