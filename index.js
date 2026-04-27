// index.js dosyanı GitHub'da bununla güncelle
const express = require('express');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());

const mongoURI = process.env.MONGO_URI; 

mongoose.connect(mongoURI)
    .then(() => console.log("✅ MongoDB Bağlantısı Başarılı!"))
    .catch(err => console.error("❌ Bağlantı Hatası:", err));

// Mesajlar ve Loglar için Şema
const LogSchema = new mongoose.Schema({
    type: String, // "Chat" veya "Console"
    user: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
});

const Log = mongoose.model('Log', LogSchema);

// Ana sayfa - Siteden bakınca mesajları göreceğin yer
app.get('/', async (req, res) => {
    const logs = await Log.find().sort({ timestamp: -1 }).limit(50);
    let html = "<h1>🚀 OxygenForge Canlı Konsol</h1><hr>";
    logs.forEach(log => {
        html += `<p>[${log.timestamp.toLocaleTimeString()}] <b>${log.type}</b> - ${log.user}: ${log.content}</p>`;
    });
    res.send(html);
});

// Roblox'tan veri alma
app.post('/log', async (req, res) => {
    try {
        const { type, user, content } = req.body;
        const newLog = new Log({ type, user, content });
        await newLog.save();
        res.status(200).send({ success: true });
    } catch (error) {
        res.status(500).send({ success: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sunucu aktif!`));
