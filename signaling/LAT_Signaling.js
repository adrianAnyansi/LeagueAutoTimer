const http = require('http')
const ws = require('ws')
const url = require('url')
const fs = require('fs').promises

// WebSocket server for LeagueAutoTimer to perform WebRTC Signalling

// For secure wss I need a local cert/key file
// Requires Auth on upgrade and a state

let monitorMap = {}
let timerMap = {}
let wsConnects = 0

const httpServer = http.createServer( (req, res) => {
    const parseReq = new URL(req.url, `http://${req.headers.host}`)
    const url = parseReq.pathname

    if (url == "/about") {
        res.write("This is the LeagueAutoTimer signalling server.\n")
        res.end()
    } else if (url == "/conn") {
        res.write(`${wsConnects} ws connects have been created\n`)
        res.write(JSON.stringify(monitorMap) + '\n')
        res.write(JSON.stringify(timerMap) + '\n')
        res.end()
    } if (parseReq.hostname == "localhost") {
        // This is for testing only
        if (url == "/js") {
            fs.readFile(__dirname + "/../AutoTimerScript.js").then( file => { 
                console.log(`Serving js at ${Date.now()}`)
                res.setHeader("Content-Type", "application/javascript")
                res.setHeader("Access-Control-Allow-Origin", "*")
                res.writeHead(200)
                res.end(file) // Apparently this loads per request, which is great cause that means free reload
            }).catch(err => {
                res.writeHead(500)
                res.end(err)
                return
            })
        } else if (url == "/timer") {
            fs.readFile(__dirname + "/../AutoTimerUI.html").then( file => { 
                console.log(`Serving timer at ${Date.now()}`) 
                res.setHeader("Content-Type", "text/html")
                res.writeHead(200)
                res.end(file) // Apparently this loads per request, which is great cause that means free reload
            }).catch(err => {
                res.writeHead(500)
                res.end(err)
                return
            })
        }
    }
    
})

const wsServer = new ws.Server({ server:httpServer }) // Use noserver:true & ws.handleUpgradeRequest later on
const wsPair = [[monitorMap, 'monitor', timerMap], [timerMap, 'timer', monitorMap]]

wsServer.on('connection', function (ws) {
    console.log("Opening ws connection...")
    wsConnects++

    let registerProp = null
    let sMap = null
    let tMap = null
    let type = null
    let passcode = null
    // TODO: Add variables to the ws to be persistent
    ws.on('message', (wsMsg) => {
        try {
            let msg = JSON.parse(wsMsg)
            // console.log(msg)
            if (msg['register'] && !sMap) {
                if (msg['monitor'])
                    [sMap, type, tMap] = wsPair[0]
                else if (msg['timer'])
                    [sMap, type, tMap] = wsPair[1]
                else {
                    console.log("ws message wasn't tagged")
                    ws.close(1003, 'JSON object was untagged') // Reject
                    return   
                }
                passcode = msg[type]
                if (sMap[passcode] && sMap[passcode] != ws) {
                    ws.close(1013, 'Collision occurred')
                    return    
                }
                
                console.log(`${type} ${passcode} registered`)
                sMap[passcode] = ws
                if (tMap[passcode] && sMap[passcode]) { // Successful pair
                    console.log(`Paired success for ${passcode}`)
                    let pairedText = JSON.stringify({ register:true, paired: true })
                    tMap[passcode].send(pairedText)
                    sMap[passcode].send(pairedText)
                }
                return
            }

            if (passcode) {
                console.log(`Caught msg from ${type} ${passcode}`)
                if (tMap[passcode]) {
                    tMap[passcode].send(wsMsg)
                    // console.log(`sent to other ${passcode}`)
                }
            }


            // [sMap, type, tMap] = msg['monitor'] ? wsPair[0] : (msg['timer'] ? wsPair[1] : null)
            // // console.log(`${oName} ${sMap} ${tMap}`)
            // if (!sMap) {
            // } else if (sMap[msg[oName]] && sMap[msg[oName]] != ws) {  // Reject on collision cause 
            //     ws.close(1013, 'Collision occurred')
            //     return
            // }
            // let pass = msg[oName]
            // sMap[pass] = ws 

            // if (pass) { // if msg is tagged monitor/timer
            //     console.log(`Caught msg from ${oName} ${pass}`)
            //     registerProp = [sMap, pass, oName]
            //     if (tMap[pass]) {
            //         tMap[pass].send(wsMsg)
            //         console.log(`sent to other ${pass}`)
            //     }
            // }
        } catch (e) {
            console.log(`An error occurred ${e}`)
        }
    })

    let wsTimeout = setTimeout( ()=> {
        console.log(`Times up ${type} ${passcode}`)
        ws.close(1008, 'Took too long to signal')
    }, 30000) // You have 10s

    ws.on('close', (code, reason) => {
        clearInterval(wsTimeout)
        console.log(`ws closed code: ${code}, ${reason}`)
        if (passcode && sMap) {
            sMap[passcode] = null
            delete sMap[passcode]
        }
    })
})

let port = 8080
httpServer.listen(port)
console.log(`http|ws Server is listening at ${port}`)