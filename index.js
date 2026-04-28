const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const app = express();

// 1. TEMEL AYARLAR VE GÜVENLİK
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'oxygenforge-ultra-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 saatlik oturum
}));

// Bağlantı ve Yetki Bilgileri
const mongoURI = process.env.MONGO_URI;
const ADMIN_KEY = process.env.ADMIN_KEY || "meric123";
const AUTHORIZED_USERS = ["Meric", "WoodsKitty98637", "Fatal Log"];

// 2. VERİTABANI BAĞLANTISI VE MODELLER
let isConnected = false;
mongoose.connect(mongoURI)
    .then(() => { isConnected = true; console.log("✅ Veritabanı Bağlantısı Aktif."); })
    .catch(err => console.error("❌ DB Hatası:", err));

// Log Şeması (Roblox için)
const Log = mongoose.model('Log', new mongoose.Schema({
    serverName: String, type: String, user: String, content: String, timestamp: { type: Date, default: Date.now }
}));

// NOT ŞEMASI (Senin istediğin senkronize not sistemi için)
const Note = mongoose.model('Note', new mongoose.Schema({
    author: String,
    content: String,
    color: String,
    timestamp: { type: Date, default: Date.now }
}));

// 3. SAYFA YÖNLENDİRMELERİ (ROUTES)

// GİRİŞ SAYFASI
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

// --- KRİTİK: NOT EKLEME KAPISI ---
app.post('/add-note', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz!");
    
    try {
        const colors = ['#7aa2f7', '#bb9af7', '#9ece6a', '#f7768e', '#e0af68'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        
        const newNote = new Note({
            author: req.session.user, // Giriş yapanın adını otomatik alır
            content: req.body.note,
            color: randomColor
        });
        
        await newNote.save(); // MongoDB'ye kalıcı olarak kaydeder
        res.redirect('/'); // Sayfayı yeniler, not listede görünür
    } catch (e) {
        res.redirect('/?error=note');
    }
});

// ANA TERMİNAL SAYFASI
app.get('/', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/login');

    // Veritabanından logları ve notları çek
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

// 4. TASARIM (HTML/CSS)

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
        <style>
            .panel { background:#161b22; border:1px solid #24283b; border-radius:5px; padding:15px; margin:10px; height: 75vh; overflow-y: auto; }
            .note-card { background:rgba(255,255,255,0.03); padding:10px; margin-bottom:10px; border-left:4px solid; border-radius:3px; }
            input { background:#0d1117; border:1px solid #30363d; color:#fff; padding:10px; width:100%; box-sizing:border-box; margin-top:10px; outline:none; }
            ::-webkit-scrollbar { width: 5px; }
            ::-webkit-scrollbar-thumb { background: #30363d; }
        </style>
    </head>
    <body style="margin:0; padding:20px;">
        <div style="display:flex; justify-content:space-between; border-bottom:1px solid #1a1b26; padding-bottom:10px; margin-bottom:20px;">
            <div>🛰️ SYSTEM: <span style="color:#7aa2f7">ONLINE</span> | 👤 AGENT: <span style="color:#fff">${user}</span></div>
            <a href="/logout" style="color:#f7768e; text-decoration:none;">[EXIT_SESSION]</a>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 350px; gap:20px;">
            <div>
                <h3 style="margin:0 0 10px 10px;">>_ LIVE_DATA_STREAM (${total})</h3>
                <div class="panel">
                    ${logs.map(l => `
                        <div style="margin-bottom:8px; font-size:13px; border-bottom:1px solid rgba(255,255,255,0.02); padding-bottom:5px;">
                            <span style="color:#565f89">[${new Date(l.timestamp).toLocaleTimeString()}]</span>
                            <b style="color:#7aa2f7">${l.user}:</b> ${l.content}
                        </div>
                    `).join('')}
                </div>
            </div>

            <div>
                <h3 style="margin:0 0 10px 10px;">📝 AGENT_NOTES</h3>
                <div class="panel" style="height:60vh;">
                    <div id="notes-list">
                        ${notes.map(n => `
                            <div class="note-card" style="border-color:${n.color}">
                                <div style="font-size:10px; color:#565f89; margin-bottom:4px;">${n.author} | ${new Date(n.timestamp).toLocaleDateString()}</div>
                                <div style="color:#fff; font-size:14px;">${n.content}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <form action="/add-note" method="POST">
                    <input type="text" name="note" placeholder="Not yaz ve Enter'a bas..." required autocomplete="off">
                </form>
            </div>
        </div>

        <script>
            // 8 saniyede bir otomatik yenile
            setTimeout(() => { location.reload(); }, 8000);
        </script>
    </body>
    </html>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`SYSTEM ACTIVE ON PORT ${PORT}`);
});
