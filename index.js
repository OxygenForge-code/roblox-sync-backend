const express = require('express');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());

const mongoURI = process.env.MONGO_URI; 

mongoose.connect(mongoURI)
    .then(() => console.log("✅ MongoDB Bağlantısı Başarılı!"))
    .catch(err => console.error("❌ Bağlantı Hatası:", err));

const noteSchema = new mongoose.Schema({
    userId: String,
    content: String,
    date: { type: Date, default: Date.now }
});

const Note = mongoose.model('Note', noteSchema);

app.post('/save-note', async (req, res) => {
    try {
        const { userId, note } = req.body;
        const newNote = await Note.findOneAndUpdate(
            { userId: userId },
            { content: note, date: Date.now() },
            { upsert: true, new: true }
        );
        res.status(200).send({ success: true });
    } catch (error) {
        res.status(500).send({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sunucu aktif!`));
