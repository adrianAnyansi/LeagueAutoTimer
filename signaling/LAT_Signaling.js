const http = require('http')
const ws = require('ws')
const url = require('url')

// WebSocket server for LeagueAutoTimer to perform WebRTC Signalling

// For secure wss I need a local cert/key file
// Requires Auth on upgrade and a state

let monitorMap = {}
let timerMap = {}
let wsConnects = 0

const httpServer = http.createServer( (req, res) => {
    const url = req.url;

    if (url == "/about") {
        res.write("This is the LeagueAutoTimer signalling server.\n")
        res.end()
    } else if (url == "/conn") {
        res.write(`${wsConnects} ws connects have been created\n`)
        res.write(JSON.stringify(monitorMap) + '\n')
        res.write(JSON.stringify(timerMap) + '\n')
        res.end()
    }
})

const wsServer = new ws.Server({ server:httpServer }) // Use noserver:true & ws.handleUpgradeRequest later on
const wsPair = [[monitorMap, 'monitor', timerMap], [timerMap, 'timer', monitorMap]]

wsServer.on('connection', function (ws) {
    console.log("Opening ws connection...")
    wsConnects++

    let registerProp = null
    // TODO: Add variables to the ws to be persistent
    ws.on('message', (wsMsg) => {
        try {
            let msg = JSON.parse(wsMsg)
            // console.log(msg)
            let [sMap, oName, tMap] = msg['monitor'] ? wsPair[0] : (msg['timer'] ? wsPair[1] : null)
            // console.log(`${oName} ${sMap} ${tMap}`)
            if (!sMap) {
                console.log("ws message wasn't tagged")
                ws.close(1003, 'JSON object was untagged') // Reject
                return
            } else if (sMap[msg[oName]] && sMap[msg[oName]] != ws) {  // Reject on collision cause 
                ws.close(1013, 'Collision occurred')
                return
            }
            let pass = msg[oName]
            sMap[pass] = ws 

            if (pass) { // if msg is tagged monitor/timer
                console.log(`Caught msg from ${oName} ${pass}`)
                registerProp = [sMap, pass, oName]
                if (tMap[pass]) {
                    tMap[pass].send(wsMsg)
                    console.log(`sent to other ${pass}`)
                }
            }
        } catch (e) {
            console.log(`An error occurred ${e}`)
        }
    })

    ws.on('close', (code, reason) => {
        clearInterval(wsTimeout)
        console.log(`ws closed code: ${code}, ${reason}`)
        if (registerProp)
            registerProp[0] = null
    })

    let wsTimeout = setTimeout( ()=> {
        console.log(`Times up ${registerProp[2]} ${registerProp[1]}`)
        registerProp[0][registerProp[1]] = null
        ws.close(1008, 'Took too long to signal')
    }, 30000) // You have 10s
})

let port = 8080
httpServer.listen(port)
console.log(`http|ws Server is listening at ${port}`)