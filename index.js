// index.js Güncel Hali
const express = require('express');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());

const mongoURI = process.env.MONGO_URI; 

mongoose.connect(mongoURI).catch(err => console.error("❌ Veritabanı Hatası:", err));

const LogSchema = new mongoose.Schema({
    serverName: String, // Hangi sunucudan geldi? (Sunucu 1, Sunucu 2 vb.)
    type: String, 
    user: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
});

const Log = mongoose.model('Log', LogSchema);

// Canlı Konsol ve Sunucu Seçici (Web Sayfası)
app.get('/', async (req, res) => {
    const selectedServer = req.query.server || "Hepsi";
    let query = {};
    if(selectedServer !== "Hepsi") query = { serverName: selectedServer };

    const logs = await Log.find(query).sort({ timestamp: -1 }).limit(50);
    const servers = await Log.distinct("serverName"); // Mevcut sunucu listesini al

    let html = `<h1>🚀 OxygenForge Canlı Konsol</h1>`;
    html += `<p>Filtrele: <a href="/">[Hepsi]</a> `;
    servers.forEach(s => { html += `<a href="/?server=${s}">[${s}]</a> `; });
    html += `</p><hr>`;

    logs.forEach(log => {
        html += `<p>[${log.timestamp.toLocaleTimeString()}] [<b>${log.serverName}</b>] <b>${log.user}</b>: ${log.content}</p>`;
    });
    res.send(html);
});

// Roblox'tan veri alma
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
app.listen(PORT, () => console.log(`Sunucu aktif!`));
