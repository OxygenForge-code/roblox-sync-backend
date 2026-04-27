const express = require('express');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());

const mongoURI = process.env.MONGO_URI;
const adminKey = process.env.ADMIN_KEY || "meric123"; // Render'dan değiştirebilirsin

let connectionStatus = "Bağlantı bekleniyor...";

mongoose.connect(mongoURI)
    .then(() => { connectionStatus = "✅ Sistem Çevrimiçi"; })
    .catch(err => { connectionStatus = "❌ Veritabanı Hatası: " + err.message; });

// Şema: Sunucu adı, kullanıcı, mesaj tipi ve içerik
const LogSchema = new mongoose.Schema({
    serverName: String,
    type: String, // Chat, Join, Error, System
    user: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
});
const Log = mongoose.model('Log', LogSchema);

// ANA PANEL (Görsel Arayüz)
app.get('/', async (req, res) => {
    const key = req.query.key;
    if (key !== adminKey) {
        return res.send("<body style='background:#000;color:red;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;'><h1>Erişim Reddedildi. Geçersiz Key.</h1></body>");
    }

    const selectedServer = req.query.server || "Hepsi";
    let query = {};
    if (selectedServer !== "Hepsi") query = { serverName: selectedServer };

    const logs = await Log.find(query).sort({ timestamp: -1 }).limit(100);
    const servers = await Log.distinct("serverName");

    let logHtml = logs.map(log => {
        let color = "#fff";
        if(log.type === "Chat") color = "#00ffcc";
        if(log.type === "Error") color = "#ff4444";
        if(log.type === "Join") color = "#ffee00";

        return `<div style="border-bottom:1px solid #333;padding:8px;color:${color}">
                    [${log.timestamp.toLocaleTimeString()}] [${log.serverName}] <b>${log.user}:</b> ${log.content}
                </div>`;
    }).join("");

    res.send(`
        <body style="background:#121212;color:#e0e0e0;font-family:monospace;padding:20px;">
            <h1 style="color:#58a6ff">🚀 OxygenForge Admin Terminal</h1>
            <p>Durum: ${connectionStatus} | Aktif Sunucular: ${servers.length}</p>
            <div style="margin-bottom:20px;">
                Filtre: <a href="?key=${adminKey}" style="color:#aaa">[Hepsi]</a> 
                ${servers.map(s => `<a href="?key=${adminKey}&server=${s}" style="color:#58a6ff">[${s}]</a>`).join(" ")}
            </div>
            <div style="background:#000;padding:15px;border-radius:8px;height:70vh;overflow-y:scroll;border:1px solid #30363d">
                ${logHtml || "Henüz kayıt yok..."}
            </div>
            <script>setTimeout(() => { location.reload(); }, 10000);</script>
        </body>
    `);
});

// ROBLOX'TAN GELEN VERİLER
app.post('/log', async (req, res) => {
    try {
        const { serverName, type, user, content } = req.body;
        const newLog = new Log({ serverName, type, user, content });
        await newLog.save();
        res.status(200).send({ success: true });
    } catch (error) {
        res.status(500).send({ success: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log("Sunucu Yayında!"));
