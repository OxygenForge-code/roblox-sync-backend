const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const app = express();

// 1. AYARLAR
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'oxygenforge-mega-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const mongoURI = process.env.MONGO_URI;
const ADMIN_KEY = process.env.ADMIN_KEY || "meric123";
const AUTHORIZED_USERS = ["OxygenForge", "Batu", "GORKEMHAHANEYMAR"];

// 2. VERİTABANI MODELLERİ
let isConnected = false;
mongoose.connect(mongoURI).then(() => isConnected = true).catch(e => console.error(e));

// Log Modeli
const Log = mongoose.model('Log', new mongoose.Schema({
    serverName: String, type: String, user: String, content: String, timestamp: { type: Date, default: Date.now }
}));

// YENİ: Senkronize Not Modeli
const Note = mongoose.model('Note', new mongoose.Schema({
    author: String, content: String, color: String, timestamp: { type: Date, default: Date.now }
}));

// 3. YOLLAR (ROUTES)

app.get('/login', (req, res) => {
    if (req.session.loggedIn) return res.redirect('/');
    res.send(loginPage(req.query.error));
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

// NOT EKLEME API
app.post('/add-note', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz");
    const colors = ['#7aa2f7', '#bb9af7', '#9ece6a', '#f7768e', '#e0af68'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const newNote = new Note({
        author: req.session.user,
        content: req.body.note,
        color: randomColor
    });
    await newNote.save();
    res.redirect('/');
});

// ANA SAYFA
app.get('/', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/login');

    const logs = await Log.find({}).sort({ timestamp: -1 }).limit(50);
    const notes = await Note.find({}).sort({ timestamp: -1 }).limit(10);
    const totalLogs = await Log.countDocuments();
    
    res.send(mainPage(req.session.user, logs, notes, totalLogs));
});

// 4. GÖRSEL TASARIMLAR (HTML/CSS)

function loginPage(error) {
    return `
    <body style="background:#0a0a0c; color:#7aa2f7; font-family:monospace; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
        <div style="text-align:center; border:1px solid #7aa2f7; padding:50px; border-radius:2px; box-shadow:0 0 20px rgba(122,162,247,0.2);">
            <h1 style="letter-spacing:5px;">OXYGENFORGE</h1>
            <p style="color:#565f89;">CORE ACCESS REQUIRED</p>
            <form action="/login" method="POST">
                <input type="text" name="username" placeholder="AGENT_NAME" style="background:transparent; border:1px solid #30363d; color:#fff; padding:10px; margin-bottom:10px; width:100%;" required><br>
                <input type="password" name="key" placeholder="ACCESS_KEY" style="background:transparent; border:1px solid #30363d; color:#fff; padding:10px; margin-bottom:20px; width:100%;" required><br>
                <button type="submit" style="background:#7aa2f7; color:#000; border:none; padding:10px 30px; cursor:pointer; width:100%; font-weight:bold;">INITIALIZE</button>
            </form>
            ${error ? '<p style="color:#f7768e;">! ACCESS DENIED !</p>' : ''}
        </div>
    </body>`;
}

function mainPage(user, logs, notes, totalLogs) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>OxygenForge OS</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            :root { --bg: #0a0a0c; --panel: #161b22; --accent: #7aa2f7; --text: #a9b1d6; }
            body { background: var(--bg); color: var(--text); font-family: 'Courier New', monospace; margin: 0; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
            
            /* Üst Bar */
            .top-bar { display: flex; justify-content: space-between; background: #000; padding: 10px 20px; border-bottom: 1px solid #1a1b26; font-size: 12px; }
            .neon-text { color: var(--accent); text-shadow: 0 0 5px var(--accent); }

            /* Ana Layout */
            .main-grid { display: grid; grid-template-columns: 1fr 350px; gap: 10px; padding: 10px; flex: 1; overflow: hidden; }
            
            /* Log Paneli */
            .panel { background: var(--panel); border: 1px solid #24283b; border-radius: 4px; display: flex; flex-direction: column; overflow: hidden; }
            .panel-header { background: #1a1b26; padding: 10px; font-weight: bold; border-bottom: 1px solid #24283b; display: flex; justify-content: space-between; }
            .log-container { flex: 1; overflow-y: auto; padding: 15px; font-size: 13px; scroll-behavior: smooth; }
            
            /* Not Sistemi */
            .notes-container { padding: 10px; overflow-y: auto; flex: 1; }
            .note-card { background: rgba(255,255,255,0.03); border-left: 3px solid var(--accent); padding: 10px; margin-bottom: 10px; border-radius: 4px; }
            .note-input { width: 100%; background: #0d1117; border: 1px solid #30363d; color: #fff; padding: 10px; box-sizing: border-box; margin-top: 10px; outline: none; }
            
            /* Gereksiz ama Havalı Efektler */
            .scanline { width: 100%; height: 2px; background: rgba(122,162,247,0.1); position: fixed; top: 0; z-index: 10; pointer-events: none; animation: scan 4s linear infinite; }
            @keyframes scan { from { top: 0; } to { top: 100%; } }
            .stat-bar { height: 4px; background: #30363d; border-radius: 2px; margin-top: 5px; position: relative; overflow: hidden; }
            .stat-fill { position: absolute; height: 100%; background: var(--accent); animation: pulse 2s infinite; }
            @keyframes pulse { 0% { width: 10%; } 50% { width: 80%; } 100% { width: 10%; } }

            ::-webkit-scrollbar { width: 5px; }
            ::-webkit-scrollbar-thumb { background: #30363d; }
        </style>
    </head>
    <body>
        <div class="scanline"></div>
        
        <div class="top-bar">
            <div>🛰️ SYSTEM: <span class="neon-text">OXYGENFORGE_OS_V4</span> | 👤 AGENT: <span style="color:#fff">${user}</span></div>
            <div id="clock">00:00:00</div>
            <div><a href="/logout" style="color:#f7768e; text-decoration:none;">[ TERMINATE_SESSION ]</a></div>
        </div>

        <div class="main-grid">
            <div class="panel">
                <div class="panel-header">
                    <span>>_ LIVE_TERMINAL_FEED</span>
                    <span style="font-size:10px;">TOTAL_LOGS: ${totalLogs}</span>
                </div>
                <div class="log-container" id="logs">
                    ${logs.map(log => `
                        <div style="margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.02); padding-bottom:5px;">
                            <span style="color:#565f89">[${new Date(log.timestamp).toLocaleTimeString()}]</span>
                            <span style="color:#bb9af7">${log.serverName}</span>
                            <b style="color:#7aa2f7">${log.user}:</b>
                            <span style="color:#e0e0e0">${log.content}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:10px;">
                <div class="panel" style="height:150px; padding:15px;">
                    <div style="font-size:11px; margin-bottom:10px;">CORE_LOAD</div>
                    <div class="stat-bar"><div class="stat-fill"></div></div>
                    <div style="font-size:11px; margin-top:15px;">DATABASE_SYNC</div>
                    <div style="color:#9ece6a; font-size:14px;">● ENCRYPTED_STABLE</div>
                    <div style="font-size:10px; margin-top:10px; color:#565f89;">Uptime: 99.9% | Node: v20.x</div>
                </div>

                <div class="panel" style="flex:1;">
                    <div class="panel-header">📝 AGENT_NOTES</div>
                    <div class="notes-container">
                        ${notes.map(n => `
                            <div class="note-card" style="border-color:${n.color}">
                                <div style="font-size:10px; color:#565f89; margin-bottom:5px;">${n.author} - ${new Date(n.timestamp).toLocaleDateString()}</div>
                                <div style="color:#fff; font-size:13px;">${n.content}</div>
                            </div>
                        `).join('')}
                    </div>
                    <div style="padding:10px; border-top:1px solid #24283b;">
                        <form action="/add-note" method="POST">
                            <input type="text" name="note" class="note-input" placeholder="Notunu buraya bırak..." required autocomplete="off">
                            <button type="submit" style="display:none;"></button>
                        </form>
                    </div>
                </div>
            </div>
        </div>

        <script>
            // Canlı Saat
            setInterval(() => {
                document.getElementById('clock').innerText = new Date().toLocaleTimeString();
            }, 1000);

            // 10 saniyede bir otomatik yenile
            setTimeout(() => { location.reload(); }, 10000);
            
            // Logları en aşağı kaydır
            const container = document.getElementById('logs');
            container.scrollTop = 0;
        </script>
    </body>
    </html>`;
}

// 5. BAŞLAT
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`OXYGENFORGE V4 ONLINE ON PORT ${PORT}`);
});
