const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'oxygenforge-ultra-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const mongoURI = process.env.MONGO_URI;
const ADMIN_KEY = process.env.ADMIN_KEY || "meric123";
// YENİ AJAN LİSTESİ BURADA
const AUTHORIZED_USERS = ["OxygenForge", "Batu", "Gorkem"]; 

let isConnected = false;
mongoose.connect(mongoURI)
    .then(() => { isConnected = true; console.log("✅ Veritabanı Bağlantısı Aktif."); })
    .catch(err => console.error("❌ DB Hatası:", err));

const Log = mongoose.model('Log', new mongoose.Schema({
    serverName: String, type: String, user: String, content: String, timestamp: { type: Date, default: Date.now }
}));

const Note = mongoose.model('Note', new mongoose.Schema({
    author: String, content: String, color: String, timestamp: { type: Date, default: Date.now }
}));

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
    } else {
        res.redirect('/login?error=1');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.post('/add-note', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz!");
    try {
        const colors = ['#7aa2f7', '#bb9af7', '#9ece6a', '#f7768e', '#e0af68'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        const newNote = new Note({ author: req.session.user, content: req.body.note, color: randomColor });
        await newNote.save(); 
        res.redirect('/'); 
    } catch (e) { res.redirect('/?error=note'); }
});

app.get('/', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/login');
    const logs = await Log.find({}).sort({ timestamp: -1 }).limit(30);
    const notes = await Note.find({}).sort({ timestamp: -1 }).limit(15);
    const totalLogs = await Log.countDocuments();
    res.send(mainHTML(req.session.user, logs, notes, totalLogs));
});

// ROBLOX VERİ ALMA KAPISI
app.post('/log', async (req, res) => {
    try {
        const newLog = new Log(req.body);
        await newLog.save();
        res.status(200).send({ success: true });
    } catch (e) { res.status(500).send(e.message); }
});

function loginHTML(err) {
    return `
    <body style="background:#0a0a0c; color:#7aa2f7; font-family:monospace; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
        <div style="border:1px solid #7aa2f7; padding:40px; text-align:center; box-shadow:0 0 20px rgba(122,162,247,0.2);">
            <h2>OXYGENFORGE_LOGIN</h2>
            <form action="/login" method="POST">
                <input type="text" name="username" placeholder="USER_ID" style="background:#000; border:1px solid #333; color:#fff; padding:10px; width:200px; margin-bottom:10px;" required><br>
                <input type="password" name="key" placeholder="PASS_KEY" style="background:#000; border:1px solid #333; color:#fff; padding:10px; width:200px; margin-bottom:20px;" required><br>
                <button type="submit" style="background:#7aa2f7; color:#000; border:none; padding:10px 40px; cursor:pointer; font-weight:bold;">ENTER_CORE</button>
            </form>
            ${err ? '<p style="color:#f7768e;">!! INVALID_CREDENTIALS !!</p>' : ''}
        </div>
    </body>`;
}

function mainHTML(user, logs, notes, total) {
    return `
    <!DOCTYPE html>
    <html style="background:#0a0a0c; color:#a9b1d6; font-family:'Courier New', monospace;">
    <head>
        <title>OxygenForge Terminal</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            .panel { background:#161b22; border:1px solid #24283b; border-radius:5px; padding:15px; margin-bottom:10px; height: 60vh; overflow-y: auto; }
            .note-card { background:rgba(255,255,255,0.03); padding:10px; margin-bottom:10px; border-left:4px solid; border-radius:3px; }
            input { background:#0d1117; border:1px solid #30363d; color:#fff; padding:12px; width:100%; box-sizing:border-box; margin-top:5px; outline:none; font-size:16px; }
            ::-webkit-scrollbar { width: 5px; }
            ::-webkit-scrollbar-thumb { background: #30363d; }
        </style>
    </head>
    <body style="margin:0; padding:15px; display:flex; flex-direction:column; height:100vh; box-sizing:border-box;">
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid #1a1b26; padding-bottom:10px; margin-bottom:15px; font-size:14px;">
            <div>🛰️ SYSTEM: <span style="color:#7aa2f7">ONLINE</span> | 👤 AGENT: <span style="color:#fff">${user}</span></div>
            <a href="/logout" style="color:#f7768e; text-decoration:none;">[EXIT]</a>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:15px; flex:1; overflow:hidden;">
            <div style="display:flex; flex-direction:column; overflow:hidden;">
                <h3 style="margin:0 0 10px 0;">>_ LIVE_STREAM (${total})</h3>
                <div class="panel" style="flex:1;">
                    ${logs.length > 0 ? logs.map(l => `
                        <div style="margin-bottom:8px; font-size:13px; border-bottom:1px solid rgba(255,255,255,0.02); padding-bottom:5px;">
                            <span style="color:#565f89">[${new Date(l.timestamp).toLocaleTimeString()}]</span>
                            <span style="color:#bb9af7">${l.serverName}</span>
                            <b style="color:#7aa2f7">${l.user}:</b> ${l.content}
                        </div>
                    `).join('') : '<span style="color:#565f89">Veri bekleniyor...</span>'}
                </div>
            </div>

            <div style="display:flex; flex-direction:column; overflow:hidden;">
                <h3 style="margin:0 0 10px 0;">📝 AGENT_NOTES</h3>
                <div class="panel" style="flex:1;">
                    <div id="notes-list">
                        ${notes.map(n => `
                            <div class="note-card" style="border-color:${n.color}">
                                <div style="font-size:10px; color:#565f89; margin-bottom:4px;">${n.author} | ${new Date(n.timestamp).toLocaleTimeString()}</div>
                                <div style="color:#fff; font-size:14px;">${n.content}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <form action="/add-note" method="POST" style="margin:0;">
                    <input type="text" id="note-input" name="note" placeholder="Not yaz..." required autocomplete="off">
                </form>
            </div>
        </div>

        <script>
            // KLAVYE KAPANMA SORUNU ÇÖZÜMÜ:
            // Sadece yazı yazılmıyorsa (input aktif değilse) sayfayı yenile.
            setInterval(() => {
                const noteInput = document.getElementById('note-input');
                if (document.activeElement !== noteInput) {
                    location.reload();
                }
            }, 8000);
        </script>
    </body>
    </html>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => { console.log(`SYSTEM ACTIVE ON PORT ${PORT}`); });
