const express = require('express');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());

const mongoURI = process.env.MONGO_URI;
const adminKey = process.env.ADMIN_KEY || "meric123";

let dbStatus = "Bağlanıyor...";
mongoose.connect(mongoURI)
    .then(() => { dbStatus = "SİSTEM ÇEVRİMİÇİ"; })
    .catch(err => { dbStatus = "BAĞLANTI HATASI"; });

const LogSchema = new mongoose.Schema({
    serverName: String,
    type: String, 
    user: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
});
const Log = mongoose.model('Log', LogSchema);

// MODERN PANEL TASARIMI
app.get('/', async (req, res) => {
    const key = req.query.key;
    
    // ERİŞİM REDDEDİLDİ EKRANI (MODERN)
    if (key !== adminKey) {
        return res.send(`
            <body style="background:#0a0a0c; color:#ff4444; font-family:'Courier New', monospace; display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; margin:0;">
                <div style="border: 2px solid #ff4444; padding: 30px; box-shadow: 0 0 20px #ff4444; border-radius: 10px; text-align:center;">
                    <h1 style="margin:0;">⚠️ ERİŞİM ENGELLENDİ</h1>
                    <p style="color:#888; margin-top:10px;">Geçersiz veya eksik Admin Key.</p>
                </div>
            </body>
        `);
    }

    const selectedServer = req.query.server || "Hepsi";
    let query = {};
    if (selectedServer !== "Hepsi") query = { serverName: selectedServer };

    const logs = await Log.find(query).sort({ timestamp: -1 }).limit(100);
    const servers = await Log.distinct("serverName");

    let logHtml = logs.map(log => {
        let shadow = "0 0 5px ";
        let color = "#fff";
        if(log.type === "Chat") { color = "#00f2ff"; }
        if(log.type === "Error") { color = "#ff0055"; }
        if(log.type === "Join") { color = "#adff2f"; }

        return `
            <div style="background: rgba(255,255,255,0.03); margin-bottom: 5px; padding: 10px; border-radius: 5px; border-left: 3px solid ${color};">
                <span style="color:#666; font-size:12px;">[${log.timestamp.toLocaleTimeString()}]</span>
                <span style="color:#aaa; font-weight:bold;">[${log.serverName}]</span>
                <b style="color:${color}; text-shadow: ${shadow}${color};">${log.user}:</b> 
                <span style="color:#eee;">${log.content}</span>
            </div>`;
    }).join("");

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>OxygenForge Terminal</title>
            <style>
                body { background: #0f111a; color: #a9b1d6; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin:0; padding:20px; }
                .container { max-width: 1000px; margin: auto; }
                .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1a1b26; padding-bottom: 10px; margin-bottom:20px; }
                .status-dot { height: 10px; width: 10px; background-color: #73daca; border-radius: 50%; display: inline-block; margin-right: 5px; box-shadow: 0 0 10px #73daca; }
                .server-btn { text-decoration: none; color: #565f89; background: #1a1b26; padding: 5px 15px; border-radius: 20px; font-size: 14px; transition: 0.3s; margin-right: 5px; border: 1px solid #24283b; }
                .server-btn:hover, .active-btn { background: #414868; color: #fff; border-color: #7aa2f7; }
                .terminal { background: rgba(0,0,0,0.4); border: 1px solid #24283b; border-radius: 10px; padding: 20px; height: 75vh; overflow-y: auto; box-shadow: inset 0 0 20px rgba(0,0,0,0.5); }
                ::-webkit-scrollbar { width: 5px; }
                ::-webkit-scrollbar-thumb { background: #24283b; border-radius: 10px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div>
                        <h1 style="margin:0; color:#7aa2f7; letter-spacing: 2px;">OXYGEN<span style="color:#fff;">FORGE</span></h1>
                        <div style="font-size:12px; margin-top:5px;"><span class="status-dot"></span> ${dbStatus}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:12px; color:#565f89;">CANLI KONSOL</div>
                        <div style="font-weight:bold; color:#f7768e;">v2.0 Premium</div>
                    </div>
                </div>

                <div style="margin-bottom:20px; white-space: nowrap; overflow-x: auto; padding-bottom:10px;">
                    <a href="?key=${key}" class="server-btn ${selectedServer === "Hepsi" ? "active-btn" : ""}">TÜMÜ</a>
                    ${servers.map(s => `
                        <a href="?key=${key}&server=${s}" class="server-btn ${selectedServer === s ? "active-btn" : ""}">${s.toUpperCase()}</a>
                    `).join("")}
                </div>

                <div class="terminal">
                    ${logHtml || "<div style='text-align:center; color:#565f89; margin-top:100px;'>Veri bekleniyor...</div>"}
                </div>
            </div>
            <script>setTimeout(() => { location.reload(); }, 5000);</script>
        </body>
        </html>
    `);
});

app.post('/log', async (req, res) => {
    try {
        const { serverName, type, user, content } = req.body;
        const newLog = new Log({ serverName, type, user, content });
        await newLog.save();
        res.status(200).send({ success: true });
    } catch (error) { res.status(500).send({ success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log("Modern Terminal Aktif!"));
