const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session'); // Bunu eklemelisin: npm install express-session
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'oxygen-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 saat hatırlasın
}));

const mongoURI = process.env.MONGO_URI;
const ADMIN_KEY = process.env.ADMIN_KEY || "meric123";
// BURAYA GİRİŞ YAPABİLECEK ROBLOX İSİMLERİNİ YAZ:
const AUTHORIZED_USERS = ["Meric", "WoodsKitty98637", "Fatal Log"]; 

let dbStatus = "BAĞLANIYOR...";
mongoose.connect(mongoURI).then(() => { dbStatus = "SİSTEM ÇEVRİMİÇİ"; }).catch(() => { dbStatus = "BAĞLANTI HATASI"; });

const LogSchema = new mongoose.Schema({
    serverName: String, type: String, user: String, content: String, timestamp: { type: Date, default: Date.now }
});
const Log = mongoose.model('Log', LogSchema);

// --- GİRİŞ EKRANI (GET /login) ---
app.get('/login', (req, res) => {
    res.send(`
        <body style="background:#0a0a0c; color:#7aa2f7; font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
            <form action="/login" method="POST" style="background:#161b22; padding:40px; border-radius:15px; border:1px solid #7aa2f7; box-shadow:0 0 20px rgba(122,162,247,0.2); text-align:center;">
                <h1 style="margin-bottom:20px;">OXYGEN<span style="color:#fff">FORGE</span> LOGIN</h1>
                <input type="text" name="username" placeholder="Roblox Kullanıcı Adı" required style="background:#0d1117; border:1px solid #30363d; color:#fff; padding:12px; border-radius:5px; width:250px; margin-bottom:15px;"><br>
                <input type="password" name="key" placeholder="Admin Key" required style="background:#0d1117; border:1px solid #30363d; color:#fff; padding:12px; border-radius:5px; width:250px; margin-bottom:20px;"><br>
                <button type="submit" style="background:#7aa2f7; color:#0a0a0c; border:none; padding:12px 30px; border-radius:5px; font-weight:bold; cursor:pointer; width:100%;">SİSTEME SIZ</button>
                ${req.query.error ? `<p style="color:#f7768e; margin-top:15px;">❌ Yetkisiz Kullanıcı!</p>` : ''}
            </form>
        </body>
    `);
});

// --- GİRİŞ İŞLEMİ (POST /login) ---
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

// --- ANA PANEL (Korumalı) ---
app.get('/', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/login');

    const logs = await Log.find().sort({ timestamp: -1 }).limit(100);
    // (Burada senin önceki modern terminal tasarımı kodların olacak, HTML içeriği aynı kalabilir)
    res.send(\`
        <body style="background:#0f111a; color:#a9b1d6; font-family:sans-serif; padding:20px;">
            <div style="display:flex; justify-content:space-between;">
                <h1>🚀 OxygenForge Terminal</h1>
                <p>Hoş geldin, <b>\${req.session.user}</b> | <a href="/logout" style="color:#f7768e;">Çıkış</a></p>
            </div>
            <div style="background:rgba(0,0,0,0.4); border:1px solid #24283b; padding:20px; border-radius:10px; height:70vh; overflow-y:auto;">
                \${logs.map(log => \`<div style="margin-bottom:5px; border-bottom:1px solid #1a1b26;">[\${log.timestamp.toLocaleTimeString()}] <b>\${log.user}:</b> \${log.content}</div>\`).join("")}
            </div>
            <script>setTimeout(() => { location.reload(); }, 5000);</script>
        </body>
    \`);
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- ROBLOX'TAN VERİ ALMA (Şifresiz log kanalı) ---
app.post('/log', async (req, res) => {
    try {
        const { serverName, type, user, content } = req.body;
        const newLog = new Log({ serverName, type, user, content });
        await newLog.save();
        res.status(200).send({ success: true });
    } catch (error) { res.status(500).send({ success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log("Giriş Paneli Aktif!"));
