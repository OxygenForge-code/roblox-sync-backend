const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const https = require('https'); // Roblox API için gerekli
const app = express();

// 1. AYARLAR
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'oxygenforge-sentinel-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const mongoURI = process.env.MONGO_URI;
const ADMIN_KEY = process.env.ADMIN_KEY || "meric123";
const AUTHORIZED_USERS = ["OxygenForge", "Batu", "Gorkem"]; 
// BURAYA OYUNUNUN UNIVERSE ID'SİNİ YAZ (Roblox Dashboard -> RNG Car Arena -> Universe ID)
const UNIVERSE_ID = "10088868821"; 

let isConnected = false;
mongoose.connect(mongoURI).then(() => { isConnected = true; }).catch(err => console.log(err));

// MODELLER
const Log = mongoose.model('Log', new mongoose.Schema({
    serverName: String, type: String, user: String, content: String, timestamp: { type: Date, default: Date.now }
}));
const Note = mongoose.model('Note', new mongoose.Schema({
    author: String, content: String, color: String, timestamp: { type: Date, default: Date.now }
}));

// 2. ROBLOX VERİ ÇEKİCİ (YARDIMCI FONKSİYON)
async function getRobloxData(id) {
    return new Promise((resolve) => {
        https.get(`https://games.roblox.com/v1/games?universeIds=${id}`, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                try { resolve(JSON.parse(data).data[0]); } catch(e) { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

// 3. YOLLAR
app.get('/login', (req, res) => {
    if (req.session.loggedIn) return res.redirect('/');
    res.send(loginHTML(req.query.error));
});

app.post('/login', (req, res) => {
    const { username, key } = req.body;
    if (AUTHORIZED_USERS.includes(username) && key === ADMIN_KEY) {
        req.session.loggedIn = true;
        req.session.user = username;
        res.redirect('/');
    } else { res.redirect('/login?error=1'); }
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

app.get('/', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/login');
    
    const logs = await Log.find({}).sort({ timestamp: 1 }).limit(100);
    const notes = await Note.find({}).sort({ timestamp: -1 }).limit(20);
    const gameInfo = await getRobloxData(UNIVERSE_ID); // Canlı veriyi çek
    
    res.send(mainHTML(req.session.user, logs, notes, gameInfo));
});

app.post('/add-note', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz!");
    const colors = ['#7aa2f7', '#bb9af7', '#9ece6a', '#f7768e', '#e0af68'];
    const newNote = new Note({ author: req.session.user, content: req.body.note, color: colors[Math.floor(Math.random() * colors.length)] });
    await newNote.save(); res.redirect('/');
});

app.post('/log', async (req, res) => {
    try { const newLog = new Log(req.body); await newLog.save(); res.status(200).send({ success: true }); } 
    catch (e) { res.status(500).send(e.message); }
});

// 4. TASARIM (GÜNCELLENDİ)
function loginHTML(err) {
    return `<body style="background:#0a0a0c; color:#7aa2f7; font-family:monospace; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
        <div style="border:2px solid #7aa2f7; padding:40px; text-align:center;">
            <h1>OXYGENFORGE_OS</h1>
            <form action="/login" method="POST">
                <input type="text" name="username" placeholder="AGENT_ID" style="background:#000; border:1px solid #333; color:#fff; padding:10px; width:100%;"><br><br>
                <input type="password" name="key" placeholder="SECURE_KEY" style="background:#000; border:1px solid #333; color:#fff; padding:10px; width:100%;"><br><br>
                <button type="submit" style="background:#7aa2f7; color:#000; border:none; padding:10px 40px; cursor:pointer; width:100%;">ACCESS</button>
            </form>
        </div>
    </body>`;
}

function mainHTML(user, logs, notes, game) {
    const likeRatio = game ? Math.round((game.upvotes / (game.upvotes + game.downvotes)) * 100) : 0;
    
    return `
    <!DOCTYPE html>
    <html style="background:#08080a; color:#c0caf5; font-family:monospace;">
    <head>
        <title>OxygenForge Sentinel</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            :root { --accent: #7aa2f7; --bg: #161b22; }
            body { margin: 0; padding: 10px; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
            .panel { background: var(--bg); border: 1px solid #24283b; border-radius: 4px; padding: 10px; overflow-y: auto; }
            .glow { text-shadow: 0 0 10px var(--accent); color: var(--accent); }
            
            /* OYUN DURUM KARTI */
            .game-header { display: flex; align-items: center; gap: 20px; background: #1a1b26; padding: 15px; border-radius: 8px; margin-bottom: 15px; border-left: 5px solid var(--accent); }
            .game-icon { width: 80px; height: 80px; border-radius: 12px; background: #000; }
            .stat-badge { background: #24283b; padding: 5px 12px; border-radius: 20px; font-size: 12px; }
            
            .log-container { display: grid; grid-template-columns: 1fr 350px; gap: 15px; flex: 1; overflow: hidden; }
            .note-card { background: rgba(255,255,255,0.02); padding: 8px; margin-bottom: 8px; border-left: 3px solid; border-radius: 2px; }
            input { background:#0d1117; border:1px solid #30363d; color:#fff; padding:12px; width:100%; box-sizing:border-box; outline:none; }
        </style>
    </head>
    <body>
        <div class="game-header">
            <img class="game-icon" src="https://www.roblox.com/asset-thumbnail/image?assetId=123456&width=420&height=420" alt="Icon">
            <div style="flex:1">
                <h2 style="margin:0" class="glow">${game ? game.name : 'RNG Car Arena'}</h2>
                <div style="display:flex; gap:10px; margin-top:8px;">
                    <span class="stat-badge">👥 OYUNCULAR: <span style="color:#9ece6a">${game ? game.playing : 0}</span></span>
                    <span class="stat-badge">👍 BEĞENİ: <span style="color:#e0af68">%${likeRatio}</span></span>
                    <span class="stat-badge">🛰️ SUNUCU: <span style="color:#bb9af7">AKTİF</span></span>
                </div>
            </div>
            <div style="text-align:right">
                <div style="font-size:12px; color:#565f89">AGENT: ${user}</div>
                <a href="/logout" style="color:#f7768e; text-decoration:none; font-size:12px;">[SİSTEMİ KAPAT]</a>
            </div>
        </div>

        <div class="log-container">
            <div style="display:flex; flex-direction:column; overflow:hidden;">
                <div class="panel" id="log-panel" style="flex:1;">
                    ${logs.map(l => `
                        <div style="font-size:13px; margin-bottom:4px;">
                            <span style="color:#565f89">[${new Date(l.timestamp).toLocaleTimeString()}]</span>
                            <b style="color:var(--accent)">${l.user}:</b> ${l.content}
                        </div>
                    `).join('')}
                </div>
            </div>

            <div style="display:flex; flex-direction:column; overflow:hidden;">
                <div class="panel" style="flex:1;">
                    <h4 style="margin:0 0 10px 0" class="glow">EKİP NOTLARI</h4>
                    ${notes.map(n => `
                        <div class="note-card" style="border-color:${n.color}">
                            <div style="font-size:10px; color:#565f89">${n.author}</div>
                            <div style="font-size:14px; color:#fff">${n.content}</div>
                        </div>
                    `).join('')}
                </div>
                <form action="/add-note" method="POST" style="margin-top:10px;">
                    <input type="text" id="note-input" name="note" placeholder="Mesaj bırak..." required autocomplete="off">
                </form>
            </div>
        </div>

        <script>
            const logPanel = document.getElementById('log-panel');
            logPanel.scrollTop = logPanel.scrollHeight;
            setInterval(() => {
                if (document.activeElement.tagName !== 'INPUT') location.reload();
            }, 10000);
        </script>
    </body>
    </html>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => { console.log("SENTINEL V4.4 ACTIVE"); });
