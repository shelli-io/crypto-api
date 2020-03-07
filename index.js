const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors');

const low = require('lowdb')
const FileAsync = require('lowdb/adapters/FileAsync')
const fetch = require('node-fetch');

const { PROVIDER, URL, APP_PORT } = require('./config.json');

const CronJob = require('cron').CronJob;

const Mam = require('@iota/mam');
const randomstring = require('randomstring');

const { asciiToTrytes } = require('@iota/converter')
const generateSeed = () => {
    
    const length = 81;
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ9';

    return randomstring.generate({
        length: length,
        charset: charset
      });
}

let mamState;

const PORT = APP_PORT || 3000

// Create server
const app = express()
app.use(cors());
app.use(bodyParser.json())

// Create database instance and start server
const adapter = new FileAsync('db.json')
low(adapter)
    .then(db => {
        // Routes
        // GET /snapshots/:id
        app.get('/snapshots/:id', (req, res) => {
            const post = db.get('snapshots')
                .find({ id: req.params.id })
                .value()

            res.send(post)
        })

        // GET /snapshots
        app.get('/snapshots', (req, res) => {
            const posts = db.get('snapshots')
                .value()
            res.send(posts)
        })


        // GET /root
        app.get('/', (req, res) => {
            const root = db.get('config.root')
                .value()
            res.send(root)
        })


        // POST /snapshots
        app.post('/snapshots', async (req, res) => {

            publishSnapshot().then(snapshot => {
                db.get('snapshots')
                    .push(snapshot)
                    .last()
                    .assign({ id: Date.now().toString() })
                    .write()
                    .then(post => res.send(post))
            })


        })

        // Initialise MAM State
        let seed = db.get('config.seed').value()
        if (seed) {
            console.log("seed da")
            mamState = Mam.init(PROVIDER, seed)
            
            let old_state = db.get('config.state').value()
            if(old_state) {
                updateMamState(old_state);
            }
            
            
        } else {
            seed = generateSeed()
            db.set('config.seed', seed)
                .write()

            mamState = Mam.init(PROVIDER, seed)

            db.set('config.root', Mam.getRoot(mamState))
                .write()
        }


        new CronJob('0 */1 * * * *', async function () {
            console.log("Publishing data...")
            publishSnapshot().then((response) => {
                db.set('config.state', response.state)
                    .write()

                db.get('snapshots')
                    .push(response.snapshot)
                    .last()
                    .assign({ id: Date.now().toString() })
                    .write()
            })

        }, null, true, 'America/Los_Angeles');
        // Set db default values
        return db.defaults({ snapshots: [], config: {} }).write()
    })
    .then(() => {
        app.listen(PORT, () => console.log('Server listening on port ' + PORT))
    })

const fetchData = async () => {

    /*
    // on trading pairs (ex. tBTCUSD)

    [
        BID, 
        BID_SIZE, 
        ASK, 
        ASK_SIZE, 
        DAILY_CHANGE, 
        DAILY_CHANGE_RELATIVE, 
        LAST_PRICE, 
        VOLUME, 
        HIGH, 
        LOW
    ]

    Example: [
        0.23118,
        189988.47544158992,
        0.23179,
        155659.38508286,
        -0.00081,
        -0.0035,
        0.23118,
        685691.44215451,
        0.2341,
        0.22812
    ]
    
    */

    let exchanges = [
        {
            name: 'Bitfinex',
            url: 'https://www.bitfinex.com',
            api_url: 'https://api-pub.bitfinex.com/v2/ticker/tIOTUSD'
        }
    ]
    let response = await fetch(exchanges[0].api_url);
    let json = await response.json();
    return json
}

const updateMamState = newMamState => (mamState = newMamState);

// Publish to tangle
const publishToMAM = async data => {

    // Create MAM Payload - STRING OF TRYTES
    const trytes = asciiToTrytes(JSON.stringify(data))

    const message = Mam.create(mamState, trytes)

    // Save new mamState
    updateMamState(message.state);

    // Attach the payload
    let x = await Mam.attach(message.payload, message.address, 3, 9)

    return message
}

const publishSnapshot = async () => {

    let data = await fetchData()

    let mam_message = {
        timestamp: Date.now(),
        data: data
    }
    let mam = await publishToMAM(mam_message)
    let snapshot = {
        ...mam_message,
        root: mam.root
    }

    return { snapshot: snapshot, state: mam.state }
}