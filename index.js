const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const https = require('https');
const app = express();

// 1. AYARLAR & KİMLİKLER
const UNIVERSE_ID = "10088868821";
const PLACE_ID = "80208428110836";
const ADMIN_KEY = process.env.ADMIN_KEY || "meric123";
const AUTHORIZED_USERS = ["OxygenForge", "Batu", "Gorkem"];

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'oxygenforge-eclipse-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// MongoDB Bağlantısı
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Nebula Veritabanına Bağlanıldı."))
    .catch(err => console.log("❌ Bağlantı Hatası:", err));

// ŞEMALAR
const Log = mongoose.model('Log', new mongoose.Schema({
    serverName: String, type: String, user: String, content: String, timestamp: { type: Date, default: Date.now }
}));
const Note = mongoose.model('Note', new mongoose.Schema({
    author: String, content: String, color: String, timestamp: { type: Date, default: Date.now }
}));

// 2. YARDIMCI FONKSİYONLAR
async function getRobloxInfo(id) {
    return new Promise((resolve) => {
        https.get(`https://games.roblox.com/v1/games?universeIds=${id}`, (res) => {
            let d = '';
            res.on('data', chunk => d += chunk);
            res.on('end', () => {
                try {
                    const info = JSON.parse(d).data[0];
                    https.get(`https://games.roblox.com/v1/games/votes?universeIds=${id}`, (res2) => {
                        let d2 = '';
                        res2.on('data', c2 => d2 += c2);
                        res2.on('end', () => {
                            const votes = JSON.parse(d2).data[0];
                            resolve({ ...info, ...votes });
                        });
                    });
                } catch(e) { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

// 3. YOLLAR (ROUTES)
app.get('/login', (req, res) => res.send(loginHTML(req.query.error)));
app.post('/login', (req, res) => {
    const { username, key } = req.body;
    if (AUTHORIZED_USERS.includes(username) && key === ADMIN_KEY) {
        req.session.loggedIn = true; req.session.user = username; res.redirect('/');
    } else res.redirect('/login?error=1');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

app.get('/', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/login');
    const logs = await Log.find({}).sort({ timestamp: 1 }).limit(100);
    const notes = await Note.find({}).sort({ timestamp: -1 });
    const game = await getRobloxInfo(UNIVERSE_ID);
    res.send(mainHTML(req.session.user, logs, notes, game));
});

// Veri İşlemleri
app.post('/log', async (req, res) => {
    try { await new Log(req.body).save(); res.status(200).send({ success: true }); } 
    catch (e) { res.status(500).send(e.message); }
});

app.post('/add-note', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz");
    const colors = ['#7aa2f7', '#bb9af7', '#9ece6a', '#f7768e', '#e0af68'];
    await new Note({ author: req.session.user, content: req.body.note, color: colors[Math.floor(Math.random() * colors.length)] }).save();
    res.redirect('/');
});

// SİLME İŞLEMLERİ (YENİ!)
app.post('/delete-note/:id', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz");
    await Note.findByIdAndDelete(req.params.id);
    res.redirect('/');
});

app.post('/clear-logs', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz");
    await Log.deleteMany({});
    res.redirect('/');
});

// 4. TASARIM (HTML/CSS)
function loginHTML(err) {
    return `<body style="background:#020204; color:#7aa2f7; font-family:sans-serif; display:flex; justify-content:center; align-items:center; height:100vh; margin:0;">
        <div style="background:#0a0a0f; border:1px solid #1a1a25; padding:50px; border-radius:20px; text-align:center; box-shadow:0 0 30px rgba(122,162,247,0.1);">
            <h2 style="letter-spacing:5px; margin-bottom:30px;">OXYGENFORGE</h2>
            <form action="/login" method="POST">
                <input type="text" name="username" placeholder="AGENT_ID" style="background:#16161e; border:none; color:#fff; padding:15px; width:250px; border-radius:10px; margin-bottom:15px;" required><br>
                <input type="password" name="key" placeholder="PASS_KEY" style="background:#16161e; border:none; color:#fff; padding:15px; width:250px; border-radius:10px; margin-bottom:30px;" required><br>
                <button type="submit" style="background:#7aa2f7; color:#000; border:none; padding:15px 60px; border-radius:10px; font-weight:bold; cursor:pointer;">AUTH_LOGIN</button>
            </form>
        </div>
    </body>`;
}

function mainHTML(user, logs, notes, game) {
    const likeRatio = game ? Math.round((game.upvotes / (game.upvotes + game.downvotes)) * 100) : 0;
    return `
    <!DOCTYPE html>
    <html style="background:#020204; color:#a9b1d6; font-family:'Inter', sans-serif;">
    <head>
        <title>OxygenForge Eclipse</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { margin: 0; padding: 20px; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; gap: 20px; }
            .card { background: rgba(16, 16, 24, 0.8); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.05); border-radius: 15px; padding: 20px; }
            .glow { color: #7aa2f7; text-shadow: 0 0 10px rgba(122,162,247,0.5); }
            .panel { height: 100%; overflow-y: auto; scroll-behavior: smooth; }
            .badge { background: #1a1b26; padding: 6px 12px; border-radius: 8px; font-size: 12px; color: #565f89; }
            input { background: #16161e; border: 1px solid #24283b; color: #fff; padding: 12px; border-radius: 8px; width: 100%; box-sizing: border-box; outline: none; }
            .del-btn { background:none; border:none; color:#f7768e; cursor:pointer; font-size:12px; float:right; opacity:0.5; }
            .del-btn:hover { opacity:1; }
            .clear-btn { background:#f7768e22; border:1px solid #f7768e; color:#f7768e; padding:5px 10px; border-radius:5px; cursor:pointer; font-size:11px; font-weight:bold; }
            ::-webkit-scrollbar { width: 5px; }
            ::-webkit-scrollbar-thumb { background: #24283b; border-radius: 10px; }
        </style>
    </head>
    <body>
        <div class="card" style="display:flex; align-items:center; gap:20px; padding:15px;">
            <img src="https://www.roblox.com/asset-thumbnail/image?assetId=${PLACE_ID}&width=420&height=420" style="width:70px; height:70px; border-radius:12px; border:1px solid #333;">
            <div style="flex:1">
                <h3 style="margin:0" class="glow">RNG Car Arena</h3>
                <div style="display:flex; gap:10px; margin-top:8px;">
                    <span class="badge">👥 PLAYING: <span style="color:#9ece6a">${game ? game.playing : 0}</span></span>
                    <span class="badge">👍 RATING: <span style="color:#e0af68">%${likeRatio}</span></span>
                    <span class="badge">🛰️ AGENT: <span style="color:#fff">${user}</span></span>
                </div>
            </div>
            <a href="/logout" style="color:#565f89; text-decoration:none; font-size:12px;">[LOGOUT]</a>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 380px; gap:20px; flex:1; overflow:hidden;">
            <div class="card" style="display:flex; flex-direction:column; overflow:hidden;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h4 style="margin:0" class="glow">>_ LIVE_CONSOLE</h4>
                    <form action="/clear-logs" method="POST" style="margin:0" onsubmit="return confirm('Tüm konsolu temizle?')">
                        <button class="clear-btn">CONSOLE.CLEAR()</button>
                    </form>
                </div>
                <div class="panel" id="console">
                    ${logs.map(l => `
                        <div style="font-size:13px; margin-bottom:6px; border-bottom:1px solid rgba(255,255,255,0.02); padding-bottom:4px;">
                            <span style="color:#565f89">[${new Date(l.timestamp).toLocaleTimeString()}]</span>
                            <b style="color:#7aa2f7">${l.user}:</b> 
                            <span style="color:#cfc9c2">${l.content}</span>
                        </div>
                    `).join('')}
                    ${logs.length === 0 ? '<div style="color:#565f89; text-align:center; margin-top:20px;">Konsol boş...</div>' : ''}
                </div>
            </div>

            <div style="display:flex; flex-direction:column; gap:20px; overflow:hidden;">
                <div class="card" style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
                    <h4 class="glow" style="margin:0 0 15px 0;">📝 AGENT_NOTES</h4>
                    <div class="panel">
                        ${notes.map(n => `
                            <div style="background:rgba(255,255,255,0.02); padding:12px; border-radius:10px; border-left:4px solid ${n.color}; margin-bottom:10px;">
                                <form action="/delete-note/${n._id}" method="POST" style="display:inline">
                                    <button class="del-btn" onsubmit="return confirm('Not silinsin mi?')">✖</button>
                                </form>
                                <div style="font-size:10px; color:#565f89; margin-bottom:5px;">${n.author} • ${new Date(n.timestamp).toLocaleTimeString()}</div>
                                <div style="color:#fff; font-size:14px;">${n.content}</div>
                            </div>
                        `).join('')}
                    </div>
                    <form action="/add-note" method="POST" style="margin-top:15px;">
                        <input type="text" id="note-input" name="note" placeholder="Mesaj yaz..." required autocomplete="off">
                    </form>
                </div>
            </div>
        </div>

        <script>
            const consoleBox = document.getElementById('console');
            consoleBox.scrollTop = consoleBox.scrollHeight;
            setInterval(() => {
                if (document.activeElement.tagName !== 'INPUT') location.reload();
            }, 10000);
        </script>
    </body>
    </html>`;
}

app.listen(process.env.PORT || 3000, () => console.log("OXYGENFORGE V5 READY"));
