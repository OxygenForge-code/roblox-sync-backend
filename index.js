const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const app = express();

// 1. ÇEKİRDEK AYARLAR
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
const AUTHORIZED_USERS = ["OxygenForge", "Batu", "Gorkem"]; 

let isConnected = false;
mongoose.connect(mongoURI)
    .then(() => { isConnected = true; console.log("✅ Veritabanı Aktif."); })
    .catch(err => console.error("❌ DB Hatası:", err));

// VERİ MODELLERİ
const Log = mongoose.model('Log', new mongoose.Schema({
    serverName: String, type: String, user: String, content: String, timestamp: { type: Date, default: Date.now }
}));

const Note = mongoose.model('Note', new mongoose.Schema({
    author: String, content: String, color: String, timestamp: { type: Date, default: Date.now }
}));

// 2. YOLLAR (ROUTES)
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

app.post('/add-note', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz!");
    try {
        const colors = ['#7aa2f7', '#bb9af7', '#9ece6a', '#f7768e', '#e0af68'];
        const newNote = new Note({ 
            author: req.session.user, 
            content: req.body.note, 
            color: colors[Math.floor(Math.random() * colors.length)] 
        });
        await newNote.save(); 
        res.redirect('/'); 
    } catch (e) { res.redirect('/?error=note'); }
});

app.get('/', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/login');
    const logs = await Log.find({}).sort({ timestamp: 1 }).limit(100);
    const notes = await Note.find({}).sort({ timestamp: -1 }).limit(20);
    const totalLogs = await Log.countDocuments();
    res.send(mainHTML(req.session.user, logs, notes, totalLogs));
});

app.post('/log', async (req, res) => {
    try {
        const newLog = new Log(req.body);
        await newLog.save();
        res.status(200).send({ success: true });
    } catch (e) { res.status(500).send(e.message); }
});

// 3. MEGA TASARIM (HTML/CSS/JS)
function loginHTML(err) {
    return `<body style="background:#0a0a0c; color:#7aa2f7; font-family:monospace; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
        <div style="border:2px double #7aa2f7; padding:50px; text-align:center; background:rgba(122,162,247,0.05);">
            <h1 style="text-shadow:0 0 10px #7aa2f7;">OXYGENFORGE_OS</h1>
            <form action="/login" method="POST">
                <input type="text" name="username" placeholder="AGENT_ID" style="background:#000; border:1px solid #333; color:#fff; padding:12px; margin-bottom:10px; width:100%;"><br>
                <input type="password" name="key" placeholder="SECURE_KEY" style="background:#000; border:1px solid #333; color:#fff; padding:12px; margin-bottom:20px; width:100%;"><br>
                <button type="submit" style="background:#7aa2f7; color:#000; border:none; padding:12px 50px; cursor:pointer; font-weight:bold; width:100%;">ACCESS_GRANTED</button>
            </form>
        </div>
    </body>`;
}

function mainHTML(user, logs, notes, total) {
    return `
    <!DOCTYPE html>
    <html style="background:#08080a; color:#c0caf5; font-family:'Segoe UI', monospace;">
    <head>
        <title>OxygenForge | Overdrive</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            :root { --accent: #7aa2f7; --bg-dark: #1a1b26; --panel-bg: #161b22; }
            ::-webkit-scrollbar { width: 4px; }
            ::-webkit-scrollbar-thumb { background: var(--accent); }
            
            body { margin: 0; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
            .glow-text { text-shadow: 0 0 8px var(--accent); color: var(--accent); }
            .panel { background: var(--panel-bg); border: 1px solid #24283b; border-radius: 4px; padding: 15px; overflow-y: auto; position: relative; }
            
            /* Gereksiz ama havalı animasyon */
            .grid-bg { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-image: linear-gradient(rgba(122,162,247,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(122,162,247,0.05) 1px, transparent 1px); background-size: 30px 30px; z-index: -1; }
            
            .log-line { font-size: 13px; margin-bottom: 4px; padding: 4px; border-radius: 2px; transition: background 0.3s; }
            .log-line:hover { background: rgba(122,162,247,0.1); }
            
            input { background:#0d1117; border:1px solid #30363d; color:#fff; padding:12px; width:100%; box-sizing:border-box; outline:none; font-family:monospace; }
            .stat-box { display: flex; gap: 20px; font-size: 12px; background: #000; padding: 10px 20px; border-bottom: 1px solid #1a1b26; }
            
            /* Not Tasarımı */
            .note-card { background: rgba(255,255,255,0.02); border-left: 3px solid; padding: 8px; margin-bottom: 8px; font-size: 14px; }
            
            /* Arama Kutusu */
            #searchLogs { margin-bottom: 10px; border-color: var(--accent); }
        </style>
    </head>
    <body>
        <div class="grid-bg"></div>
        
        <div class="stat-box">
            <div class="glow-text">OXYGENFORGE_V4.3</div>
            <div style="color:#565f89">|</div>
            <div>📡 DB_STATUS: <span style="color:#9ece6a">STABLE</span></div>
            <div style="color:#565f89">|</div>
            <div>👥 ACTIVE_AGENT: <span style="color:#fff">${user}</span></div>
            <div style="color:#565f89">|</div>
            <div id="clock">00:00:00</div>
            <div style="margin-left:auto;"><a href="/logout" style="color:#f7768e; text-decoration:none;">[ TERMINATE_SESSION ]</a></div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 380px; gap:15px; flex:1; padding:15px; overflow:hidden;">
            
            <div style="display:flex; flex-direction:column; overflow:hidden;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h3 class="glow-text" style="margin:5px;">>_ COMMAND_CENTER</h3>
                    <input type="text" id="searchLogs" placeholder="Oyuncu veya mesaj ara..." style="width:250px; padding:5px; font-size:12px;">
                </div>
                <div class="panel" id="log-panel" style="flex:1;">
                    ${logs.map(l => `
                        <div class="log-line" data-content="${l.user} ${l.content}">
                            <span style="color:#565f89; font-size:11px;">[${new Date(l.timestamp).toLocaleTimeString()}]</span>
                            <span style="color:#bb9af7; font-weight:bold;">#${l.serverName}</span>
                            <b style="color:var(--accent)">${l.user}:</b> 
                            <span style="color:#e0af68">${l.content}</span>
                        </div>
                    `).join('')}
                </div>
                <div style="background:#000; padding:5px; font-size:11px; color:#565f89; text-align:right;">
                    TOTAL_PACKETS_RECEIVED: ${total} | BUFFER_SIZE: 100/100
                </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:15px; overflow:hidden;">
                
                <div style="display:flex; flex-direction:column; flex:1; overflow:hidden;">
                    <h3 class="glow-text" style="margin:5px;">📝 AGENT_COMMUNICATION</h3>
                    <div class="panel" style="flex:1;">
                        ${notes.map(n => `
                            <div class="note-card" style="border-color:${n.color}">
                                <div style="font-size:10px; color:#565f89; margin-bottom:3px;">${n.author} • ${new Date(n.timestamp).toLocaleTimeString()}</div>
                                <div style="color:#fff;">${n.content}</div>
                            </div>
                        `).join('')}
                    </div>
                    <form action="/add-note" method="POST" style="margin-top:10px;">
                        <input type="text" id="note-input" name="note" placeholder="Ekibe not bırak..." required autocomplete="off">
                    </form>
                </div>

                <div class="panel" style="height:120px; font-size:10px; color:#9ece6a; overflow:hidden; background:#000;">
                    <div id="matrix-text">Sistem taranıyor...<br>Kritik hata bulunmadı.<br>OXYGENFORGE şifreleme aktif.<br></div>
                </div>
            </div>
        </div>

        <script>
            // 1. OTOMATİK KAYDIRMA
            const logPanel = document.getElementById('log-panel');
            logPanel.scrollTop = logPanel.scrollHeight;

            // 2. CANLI SAAT
            setInterval(() => {
                document.getElementById('clock').innerText = new Date().toLocaleTimeString();
            }, 1000);

            // 3. ARAMA FİLTRESİ
            document.getElementById('searchLogs').addEventListener('input', function(e) {
                const term = e.target.value.toLowerCase();
                document.querySelectorAll('.log-line').forEach(line => {
                    const text = line.getAttribute('data-content').toLowerCase();
                    line.style.display = text.includes(term) ? 'block' : 'none';
                });
            });

            // 4. KLAVYE KONTROLÜ VE YENİLEME
            setInterval(() => {
                if (document.activeElement.tagName !== 'INPUT') {
                    location.reload();
                }
            }, 10000);

            // 5. HAVALI MATRIX EFEKTİ
            const matrix = document.getElementById('matrix-text');
            const lines = [
                "CORE_LOAD: 24%", "SYNCING_WITH_ROBLOX...", "ENCRYPTING_DATA...", 
                "BYPASSING_FIREWALL...", "OXYGEN_FORGE_V4_READY", "DATA_STREAM_ACTIVE"
            ];
            setInterval(() => {
                const line = lines[Math.floor(Math.random() * lines.length)];
                matrix.innerHTML += line + "<br>";
                if(matrix.innerHTML.length > 500) matrix.innerHTML = "";
            }, 2000);
        </script>
    </body>
    </html>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => { console.log("OXYGENFORGE V4.3 OVERDRIVE ONLINE"); });
