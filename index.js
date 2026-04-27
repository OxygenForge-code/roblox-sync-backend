const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const app = express();

// 1. AYARLAR VE GÜVENLİK
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Oturum (Session) Ayarları
app.use(session({
    secret: 'oxygenforge-super-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 Saatlik Oturum
}));

// Çevresel Değişkenler
const mongoURI = process.env.MONGO_URI;
const ADMIN_KEY = process.env.ADMIN_KEY || "meric123";
const AUTHORIZED_USERS = ["Meric", "gorkem", "batu"]; // Sadece bu isimler girebilir

// 2. VERİTABANI BAĞLANTISI (Çökmeye Karşı Korumalı)
let dbStatus = "🔴 BAĞLANTI BEKLENİYOR...";
let isConnected = false;

if (mongoURI) {
    mongoose.connect(mongoURI, {
        serverSelectionTimeoutMS: 5000 // 5 saniye içinde bağlanamazsa bekleme, devam et
    }).then(() => {
        dbStatus = "🟢 SİSTEM ÇEVRİMİÇİ";
        isConnected = true;
        console.log("✅ MongoDB Bağlantısı Başarılı!");
    }).catch(err => {
        dbStatus = "🔴 BAĞLANTI HATASI";
        console.error("❌ MongoDB Hatası:", err.message);
    });
} else {
    dbStatus = "🔴 MONGO_URI EKSİK";
}

// Veritabanı Şeması
const LogSchema = new mongoose.Schema({
    serverName: String,
    type: String,
    user: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
});
const Log = mongoose.model('Log', LogSchema);


// 3. SAYFALAR VE YÖNLENDİRMELER (ROUTES)

// GİRİŞ EKRANI GET (Sayfayı Görüntüleme)
app.get('/login', (req, res) => {
    if (req.session.loggedIn) return res.redirect('/'); // Zaten girişliyse ana sayfaya at

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>OxygenForge Giriş</title>
            <style>
                body { background: #0a0a0c; color: #7aa2f7; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .login-box { background: #161b22; padding: 40px; border-radius: 15px; border: 1px solid #24283b; box-shadow: 0 0 30px rgba(122,162,247,0.1); text-align: center; width: 300px; }
                h1 { margin-top: 0; letter-spacing: 2px; }
                input { background: #0d1117; border: 1px solid #30363d; color: #fff; padding: 15px; border-radius: 8px; width: 90%; margin-bottom: 20px; outline: none; transition: 0.3s; box-sizing: border-box; }
                input:focus { border-color: #7aa2f7; box-shadow: 0 0 10px rgba(122,162,247,0.3); }
                button { background: #7aa2f7; color: #0a0a0c; border: none; padding: 15px; border-radius: 8px; font-weight: bold; cursor: pointer; width: 100%; transition: 0.3s; font-size: 16px; }
                button:hover { background: #8db0f8; box-shadow: 0 0 15px #7aa2f7; }
                .error { color: #f7768e; margin-top: 15px; font-size: 14px; background: rgba(247,118,142,0.1); padding: 10px; border-radius: 5px; border: 1px solid #f7768e; }
            </style>
        </head>
        <body>
            <div class="login-box">
                <h1>OXYGEN<span style="color:#fff">FORGE</span></h1>
                <p style="color:#565f89; font-size:12px; margin-bottom:30px;">SİSTEME ERİŞİM SAĞLAYIN</p>
                <form action="/login" method="POST">
                    <input type="text" name="username" placeholder="Roblox Kullanıcı Adı" required autocomplete="off">
                    <input type="password" name="key" placeholder="Admin Key" required>
                    <button type="submit">SİSTEME GİRİŞ YAP</button>
                    ${req.query.error ? `<div class="error">❌ Yetkisiz Kullanıcı veya Hatalı Şifre!</div>` : ''}
                </form>
            </div>
        </body>
        </html>
    `);
});

// GİRİŞ İŞLEMİ POST (Şifre Kontrolü)
app.post('/login', (req, res) => {
    const { username, key } = req.body;
    
    // Kullanıcı adı listede var mı VE şifre doğru mu?
    if (AUTHORIZED_USERS.includes(username) && key === ADMIN_KEY) {
        req.session.loggedIn = true;
        req.session.user = username;
        res.redirect('/');
    } else {
        res.redirect('/login?error=1');
    }
});

// GÜVENLİ ÇIKIŞ İŞLEMİ
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ANA TERMİNAL SAYFASI (Sadece Giriş Yapanlar Görebilir)
app.get('/', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/login');

    let logHtml = "<div style='color:#565f89; text-align:center; margin-top:50px;'>Bağlantı bekleniyor...</div>";
    let servers = [];
    const selectedServer = req.query.server || "Hepsi";

    if (isConnected) {
        try {
            let query = selectedServer !== "Hepsi" ? { serverName: selectedServer } : {};
            const logs = await Log.find(query).sort({ timestamp: -1 }).limit(100);
            servers = await Log.distinct("serverName");

            if (logs.length > 0) {
                logHtml = logs.map(log => {
                    let color = "#a9b1d6";
                    let glow = "none";
                    if(log.type === "Chat") { color = "#00f2ff"; glow = "0 0 8px rgba(0,242,255,0.4)"; }
                    if(log.type === "Error") { color = "#f7768e"; glow = "0 0 8px rgba(247,118,142,0.4)"; }
                    if(log.type === "Join") { color = "#9ece6a"; glow = "0 0 8px rgba(158,206,106,0.4)"; }

                    return `
                        <div style="background: rgba(255,255,255,0.02); margin-bottom: 8px; padding: 12px; border-radius: 6px; border-left: 3px solid ${color}; display: flex; flex-direction: column;">
                            <div style="font-size: 11px; color: #565f89; margin-bottom: 4px;">
                                [${log.timestamp.toLocaleTimeString()}] | Sunucu: ${log.serverName} | Tür: ${log.type}
                            </div>
                            <div>
                                <b style="color:${color}; text-shadow: ${glow}; font-size: 15px;">${log.user}:</b> 
                                <span style="color:#e0e0e0; margin-left: 5px;">${log.content}</span>
                            </div>
                        </div>`;
                }).join("");
            } else {
                logHtml = "<div style='color:#565f89; text-align:center; margin-top:50px;'>Henüz kayıtlı log yok.</div>";
            }
        } catch (error) {
            logHtml = `<div style='color:#f7768e;'>Veri çekilirken hata oluştu: ${error.message}</div>`;
        }
    } else {
        logHtml = "<div style='color:#f7768e; text-align:center; margin-top:50px;'>❌ Veritabanı bağlantısı kopuk. Loglar yüklenemiyor.</div>";
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>OxygenForge Terminal</title>
            <style>
                body { background: #0f111a; color: #a9b1d6; font-family: 'Consolas', 'Courier New', monospace; margin:0; padding:20px; }
                .container { max-width: 1000px; margin: auto; }
                .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1a1b26; padding-bottom: 15px; margin-bottom:20px; }
                .btn { text-decoration: none; padding: 6px 15px; border-radius: 5px; font-size: 14px; transition: 0.3s; border: 1px solid #24283b; }
                .btn-logout { background: #1a1b26; color: #f7768e; border-color: #f7768e; }
                .btn-logout:hover { background: #f7768e; color: #000; }
                .btn-filter { background: #1a1b26; color: #7aa2f7; margin-right: 5px; }
                .btn-filter:hover, .active-filter { background: #7aa2f7; color: #000; }
                .terminal { background: #0a0a0c; border: 1px solid #24283b; border-radius: 8px; padding: 20px; height: 70vh; overflow-y: auto; box-shadow: inset 0 0 20px rgba(0,0,0,0.5); }
                ::-webkit-scrollbar { width: 8px; }
                ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 10px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div>
                        <h1 style="margin:0; color:#7aa2f7; letter-spacing: 1px;">OXYGEN<span style="color:#fff;">FORGE</span> <span style="font-size:14px; color:#565f89;">TERMINAL v3</span></h1>
                        <div style="font-size:12px; margin-top:8px;">
                            Durum: <span style="color:${isConnected ? '#9ece6a' : '#f7768e'}">${dbStatus}</span>
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <div style="margin-bottom: 10px; color:#a9b1d6;">Ajan: <b style="color:#fff;">${req.session.user}</b></div>
                        <a href="/logout" class="btn btn-logout">Sistemden Çık</a>
                    </div>
                </div>

                <div style="margin-bottom:20px; white-space: nowrap; overflow-x: auto; padding-bottom:10px;">
                    <a href="/" class="btn btn-filter ${selectedServer === "Hepsi" ? "active-filter" : ""}">TÜM VERİLER</a>
                    ${servers.map(s => `
                        <a href="/?server=${s}" class="btn btn-filter ${selectedServer === s ? "active-filter" : ""}">${s}</a>
                    `).join("")}
                </div>

                <div class="terminal">
                    ${logHtml}
                </div>
            </div>
            <script>
                // Sayfayı her 6 saniyede bir otomatik yenile
                setTimeout(() => { location.reload(); }, 6000);
            </script>
        </body>
        </html>
    `);
});

// ROBLOX'TAN VERİ ALMA (Arka Plan API)
app.post('/log', async (req, res) => {
    if (!isConnected) return res.status(500).send({ success: false, error: "DB Offline" });
    
    try {
        const { serverName, type, user, content } = req.body;
        const newLog = new Log({ serverName, type, user, content });
        await newLog.save();
        res.status(200).send({ success: true });
    } catch (error) { 
        res.status(500).send({ success: false, error: error.message }); 
    }
});

// 4. SUNUCUYU BAŞLAT
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================`);
    console.log(`🚀 OXYGENFORGE SİSTEMİ AKTİFLEŞTİRİLDİ`);
    console.log(`📡 Port: ${PORT}`);
    console.log(`======================================\n`);
});
