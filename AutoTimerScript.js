let ocrad_js, tesseract_js, ocrad_resp, tesseract_resp = null;
fetch('https://antimatter15.com/ocrad.js/ocrad.js')
    .then(resp => ocrad_resp = resp.text())
    .then(val => {ocrad_js = val; eval(ocrad_js)} )
// fetch('https://unpkg.com/tesseract.js@v2.1.3/dist/tesseract.min.js')
//     .then(resp => tesseract_resp = resp.text())
//     .then(val => {tesseract_js = val; eval(tesseract_js); })

// can change whitelist based on the query, or change the 
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
canvas.height = videoFrame.videoHeight
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

let streamState = {
    currentTs: null, //timestamp of current canvas
    currentState: null, //phase
    accum: 0, // tracking stuff for timer sync
    frameBuf: [], // ts: timestamp taken, phase: gamephase, data: from checkbox
    timerState: { // last known timer screenshot
        ts: null, // when time was determined
        time: null // time in seconds
    },
    teams: [] // Team names
    // should be a dump state function, or auto?
}

function scr() {
    // grab frame & save to canvas buffer, takes about 20-35ms on my laptop with 30% CPU
    let p = performance.now()
    if (!videoFrame.parentElement) //sometimes video ref is lost
        videoFrame = videoFrame.querySelector('video')
    canvasctx.drawImage(videoFrame, 0, 0, videoFrame.videoWidth, videoFrame.videoHeight)
    // console.log(`Took ${performance.now()-p}ms to get video frame`)
    streamState.currentTs = Date.now()
    streamState.frameBuf.unshift({
        ts: streamState.currentTs,
        phase: null, //determined phase
        data: null // any data revelant to that phase
    })
    while(streamState.frameBuf.length > 30) { //clean buffer
        streamState.frameBuf.pop()
    } // at .5s this is a 15s buffer
}
    
let gameImage = {
    ltmw: [.265, .305], // left-side team name
    tmh: [0, .05], // Team name size
    ngh: [.05, .07], // Number of games* might change with best of 5 format
    rtmw: [.695, .725], // right-side team name
    th: [.05, .08], // Timer in-game* height
    tw: [.485, .515], // Timer width 
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

// Determine phase
// checkRect *TBrenamed, format is [% of image, pixel threshold] ordered by most popular
let streamPhase = {
    game: {
            name: phaseName.game,
            checkRect: [{
                            rect: genLine(.265, .305, 0.025),
                            px_thres:{  0x151515: [0.27, 10],    // black bg of team name; close to true black
                                        0xFFFFFF: [0.07, 20]   // team names // TL is making me low-ball this
                                        // 0x82692e: [0.03, 40],   // gold colour of gold/towers
                                        // 0x3893d9: [0.03, 40],   // blue side colour
                                        // 0xfd3956: [0.03, 40]   // red ...
                            }
                        }],
            grabRect: {
                leftTeamName: genSquare(.265, .305, 0, .05), // left team name
                rightTeamName: genSquare(.695, .725, 0, .05), // right team name
                timer: genSquare(.485, .515, .05, .08) // timer
            },
        },
    gameend: {
        name: phaseName.gameend,
        checkRect: [{   rect: genLine(.1, .9, .05),
                        px_thres: { 0xa078b7: [0.65, 50]}
        }]
    },
    wait: {
        name: phaseName.wait,
        pixelCheck: [{0xfcfefe: [.25, 10]}],
        checkRect: [{   rect: genLine(.13, .23, .57),
                        px_thres: {0xfcfefe: [.25, 10], 0x000221 : [.25, 10]}
                    }], // assuming TL is the shortest along the check line
        grabRect: {    
            leftTeamName: genSquare(.15, .2, .39, .43),
            rightTeamName: genSquare(.32, .37, .39, .43),
            timer: genSquare(.13, .38, .48, .68)
        }
    },
    // Might add a wait2 for the analysis desk timer
    replay: {
        name: phaseName.replay,
        checkRect: [{   rect: genLine(.11, .2, .17),
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
        checkRect: [{   rect: genLine(.11, .2, .17),
                        px_thres: {0xeb5c2a: [.35, 15], 0x160000: [.25, 30]}
        }]
    },
    ban: {
        name: phaseName.ban,
        checkRect: [
                // {   rect: genLine(.8, .87, .504, false),
                //         px_thres: {0x00092b: [.65, 10], 0xf5ffff: [.15, 20]}
                // }, 
                // checks lower at the team names
                {       rect: genLine(.43, .58, .905),
                        px_thres: {0x000527: [.65, 20], 0x27eafc: [.05, 25], // checks for blue/purple
                                    0xb267b9: [.05, 25]}

                }]
        // Need to find something new cause phase UI is similar to banPhase
        // See pause during TL vs LGC- If I choose further to side, 
        // during pause it will fail on champ potraits
    },
    pause_game: { // this is in-game pause
        name: phaseName.pause,
        debugName: "IN-GAME PAUSE",
        checkRect: [{ rect: genLine(.45, .55, .5), // checks the pause box for color
                    px_thres: {0x141a1a: [.85, 5]} // should be 100%
        }]
    },
    pause2: {
        name: phaseName.pause,
        // checks the GAME PAUSE text
        // similar UI in this position do not have white text here*
        checkRect: [{ rect: genLine(.45, .55, .81), 
                        px_thres: {0xfaffff: [.35, 10], 0x010729: [.35, 30]}
        }]
    }
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
    debugDiv.style.whitespace = "pre"
    debugDivBuffer.push(debugDiv)
}

function debugverifyAllPhases() { // Debug verify all phases with on screen stuff
    scr()

    let phase_idx = 0
    let foundState = null
    for (let checkObj of phaseOrder) {
        let px_set = null, check_pass = null;
        let phaseTime = performance.now();
        [px_set, check_pass] = verifyStreamPhase(checkObj.checkRect[0])
        phaseTime = (performance.now() - phaseTime)

        let px_set_str = ""
        for (let px_p in px_set) {
            px_set[px_p].num = (px_set[px_p].num*100).toFixed(2) + "%"
            // TODO: Add a span to show the color instead of text
            px_set_str += `\t #${px_set[px_p].hexstr.toUpperCase()} : ${px_set[px_p].num} |`
        }
        debugDivBuffer[phase_idx++].innerHTML = 
            `${checkObj.dName?checkObj.dname : checkObj.name}: \t` + 
            `<span style='color:${check_pass ? 'limegreen' : 'red'}'>${check_pass}</span> \t` + 
            `| ${phaseTime}ms \t| ${px_set_str}`;

        if (check_pass) {foundState = checkObj}
    }

    // Ok lets start grabbing info and testing
    if (foundState == streamPhase.game) {
        setGamePhaseData()
    } else if (foundState == streamPhase.wait) {
        // set timer & team names
    } else if (foundState == streamPhase.pause_game) {
        // freeze timer until we enter BAN, GAME, WAIT, but game will pick up the new timer
        // in case of chronobreak

        // for pause2, if we didn't pause timer already, do so.
    } else if (foundState == streamPhase.ban) {
        // TODO: Clear timer, set teams, do ban processing*

    } else if (foundState == streamPhase.replay || foundState == streamPhase.replay2) {
        // Show replay state
        // Don't change timer or teams
    }
}

/* PHASE SHIFT
    GAME, WAIT, BAN, PAUSE, PAUSE2, REPLAY, REPLAY2, 
    GAME
        sync timer & team names every 15-30s?
        FROM PAUSE/ PAUSE2 - technically this will be from unknown
            resync timer
        FROM REPLAY/REPLAY2
            resync timer
    REPLAY/REPLAY2
        ignore timer, set timer state
    PAUSE/PAUSE2
        pause timer if not paused
    WAIT
    BAN
        sync timer & teams
*/

function recognizeText(rect, tesseract=false, options={}) {
    // use different OCR per arg
    let imageData = canvasctx.getImageData(...rect)
    if (tesseract) {
        // binarization and copy back to canvas with no scaling
        canvasctx.putImageData(binarization(imageData, 560, true))
        let t_promise = t_worker.recognize(canvas, tesseract_rect(rect))
        let str = (await t_promise).data.text.trim()
        return str
    } else {
        // binarization and scaling with image data
        imageData = upscaleImg(binarization(imageData, 560), 3)
        let str = OCRAD(imageData).trim()
        return str
    }
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

async function setGamePhaseData () {
    // check team names
    console.log('IN GAME state')
    // let imageData = canvasctx.getImageData(...streamPhase.game.grabRect.timer)
    // imageData = upscaleImg(binarization(imageData, 255), 3)
    // let timer_str = OCRAD(imageData) +' | '+ OCRAD(imageData, {numeric: true})
    let teamPromises = []
    let p = performance.now()
    let imageData = canvasctx.getImageData(...streamPhase.game.grabRect.leftTeamName)
    canvasctx.putImageData(binarization(imageData, 560, true))
    teamPromises[0] = t_worker.recognize(canvas, tesseract_rect(streamPhase.game.grabRect.leftTeamName))
    streamState.teams[0] = (await teamPromises[0]).data.text.trim()

    // let teamPromises =  [t_worker.recognize(canvas, tesseract_rect(streamPhase.game.grabRect.leftTeamName)),
    //                     t_worker.recognize(canvas, tesseract_rect(streamPhase.game.grabRect.rightTeamName))]
    let timerPromise = t_worker.recognize(canvas, tesseract_rect(streamPhase.game.grabRect.timer))
    
    teamPromises[0].then(val => console.log(`I'm walking here`))
    console.log('raw await done')
    streamState.teams[0] =  (await teamPromises[0]).data.text.trim()
    console.log('left team done')
    streamState.teams[1] =  (await teamPromises[1]).data.text.trim()
    let timer_str =         (await timerPromise).data.text.trim()
    console.log('completed awaits')
    p = performance.now() - p

    if (timer_str[2] == ':') {
        streamState.timerState.timer = parseInt(timer_str.substring(0,2))*60 + 
                                                    timer_str.substring(3,5)
        streamState.timerState.ts = streamState.currentTs
        // Start to do the timer stagger to check state
    }
    stateDiv.innerHTML = `${streamState.teams[0]} vs. ${streamState.teams[1]}  ${timer_str} in ${p}ms`
    // After state* is set, push an event to update the timer over p2p
}

// Binarization to improve the OCR with a b/w image
// most UI is white on dark colours, so thats why invert true
// threshold goes to 445
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

function upscaleImg(imagedata, scale=2, pixelheight=0) { // default scale 2
    // pixel height overrides scale
    if (pixelheight > imagedata.height)
        scale = Math.ceil(pixelheight / imagedata.height)
    if (scale == 1)
        return imagedata
    //TODO: This needs some serious debugging so im gonna be very annoyed 
    let upscImg = new ImageData(imagedata.width*scale, imagedata.height*scale)
    let w = imagedata.width
    for (let i=0; i < imagedata.data.length; i+= 4) {
        let ul = (i/4) % w, uw = parseInt(i / (w*4))
        // console.log(`from i ${i} using: ${ul},${uw}`)
        // convert i to 2d coord, then convert back using scale multipliers
        for (let h=0; h<scale; h++) {
            for (let l=0; l<scale; l++) {
                // console.log(`from ${ul},${uw} -> ${((uw*scale+h)*w*scale+(ul*scale+l))}`)
                for (let rgb=0; rgb<3; rgb++) { //pixel
                    upscImg.data[((uw*scale+h)*w*scale+(ul*scale+l))*4+rgb] = imagedata.data[i+rgb]
                }
                upscImg.data[((uw*scale+h)*w*scale+(ul*scale+l))*4+3] = 255
            }
        }

    }
    return upscImg
}

let te = setInterval(debugverifyAllPhases, 500);
clearInterval(te)
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