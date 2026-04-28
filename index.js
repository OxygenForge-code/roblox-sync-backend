const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { createServer } = require('http');

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ═══════════════════════════════════════════════════════════════
// 1. KONFİGÜRASYON & GÜVENLİK
// ═══════════════════════════════════════════════════════════════
const UNIVERSE_ID = "10088868821";
const PLACE_ID = "80208428110836";
const ADMIN_KEY = process.env.ADMIN_KEY;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 3000;

if (!ADMIN_KEY) throw new Error("❌ ADMIN_KEY tanımlanmamış!");
if (!MONGO_URI) throw new Error("❌ MONGO_URI tanımlanmamış!");

const AUTHORIZED_USERS = ["OxygenForge", "Batu", "Gorkem"];

// XSS Koruması
function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ═══════════════════════════════════════════════════════════════
// 2. MIDDLEWARE
// ═══════════════════════════════════════════════════════════════
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    store: MongoStore.create({ mongoUrl: MONGO_URI }),
    secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000, secure: false }
}));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 100 });
app.use('/api/', limiter);

// ═══════════════════════════════════════════════════════════════
// 3. MONGODB ŞEMALAR
// ═══════════════════════════════════════════════════════════════
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Nebula Veritabanına Bağlanıldı."))
    .catch(err => { console.error("❌ MongoDB Hatası:", err); process.exit(1); });

const Log = mongoose.model('Log', new mongoose.Schema({
    serverName: String, type: String, user: String, content: String, 
    timestamp: { type: Date, default: Date.now }
}));

const Note = mongoose.model('Note', new mongoose.Schema({
    author: String, content: String, color: String, 
    timestamp: { type: Date, default: Date.now }
}));

const Chat = mongoose.model('Chat', new mongoose.Schema({
    author: String, message: String, 
    timestamp: { type: Date, default: Date.now }
}));

const Metric = mongoose.model('Metric', new mongoose.Schema({
    type: String, value: Number, 
    timestamp: { type: Date, default: Date.now }
}));

const Command = mongoose.model('Command', new mongoose.Schema({
    command: String, issuedBy: String, status: { type: String, default: 'pending' },
    result: String, timestamp: { type: Date, default: Date.now }
}));

// ═══════════════════════════════════════════════════════════════
// 4. YARDIMCI FONKSİYONLAR (system.js içindekiler)
// ═══════════════════════════════════════════════════════════════
async function getRobloxInfo() {
    return new Promise((resolve) => {
        https.get(`https://games.roblox.com/v1/games?universeIds=${UNIVERSE_ID}`, (res) => {
            let d = '';
            res.on('data', chunk => d += chunk);
            res.on('end', () => {
                try {
                    const info = JSON.parse(d).data[0];
                    https.get(`https://games.roblox.com/v1/games/votes?universeIds=${UNIVERSE_ID}`, (res2) => {
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

function getSystemMetrics() {
    const memUsage = process.memoryUsage();
    return {
        uptime: process.uptime(),
        cpu: Math.floor(Math.random() * 30) + 10, // Gerçek CPU ölçümü yerine simülasyon
        memory: Math.round(memUsage.heapUsed / 1024 / 1024),
        totalMemory: Math.round(memUsage.heapTotal / 1024 / 1024),
        connections: io.engine.clientsCount,
        timestamp: new Date()
    };
}

// ═══════════════════════════════════════════════════════════════
// 5. SOCKET.IO — GERÇEK ZAMANLI SİSTEM
// ═══════════════════════════════════════════════════════════════
const onlineAgents = new Map();

io.on('connection', (socket) => {
    console.log(`🔗 Yeni bağlantı: ${socket.id}`);
    
    // Sistem metriklerini her 3 saniyede gönder
    const metricsInterval = setInterval(() => {
        socket.emit('system-metrics', getSystemMetrics());
    }, 3000);
    
    socket.on('agent-login', (username) => {
        onlineAgents.set(socket.id, { username, status: 'online', since: new Date() });
        io.emit('agents-update', Array.from(onlineAgents.values()));
        io.emit('notification', { type: 'info', message: `🟢 ${username} sisteme giriş yaptı` });
    });
    
    socket.on('agent-status', (status) => {
        const agent = onlineAgents.get(socket.id);
        if (agent) {
            agent.status = status;
            io.emit('agents-update', Array.from(onlineAgents.values()));
        }
    });
    
    socket.on('chat-message', async (data) => {
        const chat = new Chat({ author: data.author, message: data.message });
        await chat.save();
        io.emit('chat-message', { ...data, timestamp: new Date() });
    });
    
    socket.on('disconnect', () => {
        clearInterval(metricsInterval);
        const agent = onlineAgents.get(socket.id);
        if (agent) {
            io.emit('notification', { type: 'warning', message: `🔴 ${agent.username} bağlantısı koptu` });
            onlineAgents.delete(socket.id);
            io.emit('agents-update', Array.from(onlineAgents.values()));
        }
    });
});

// ═══════════════════════════════════════════════════════════════
// 6. ROTALAR (ROUTES)
// ═══════════════════════════════════════════════════════════════

// Auth
app.get('/login', (req, res) => res.send(loginHTML(req.query.error)));
app.post('/login', (req, res) => {
    const { username, key } = req.body;
    if (AUTHORIZED_USERS.includes(username) && key === ADMIN_KEY) {
        req.session.loggedIn = true; 
        req.session.user = username; 
        res.redirect('/');
    } else res.redirect('/login?error=1');
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// Ana Panel
app.get('/', async (req, res) => {
    if (!req.session.loggedIn) return res.redirect('/login');
    const logs = await Log.find({}).sort({ timestamp: -1 }).limit(100);
    const notes = await Note.find({}).sort({ timestamp: -1 });
    const chats = await Chat.find({}).sort({ timestamp: -1 }).limit(50);
    const commands = await Command.find({}).sort({ timestamp: -1 }).limit(20);
    const game = await getRobloxInfo();
    res.send(mainHTML(req.session.user, logs, notes, chats, commands, game));
});

// API Endpoints
app.post('/api/log', async (req, res) => {
    const { serverName, type, user, content } = req.body;
    const log = new Log({ serverName, type, user, content });
    await log.save();
    io.emit('new-log', log);
    res.status(200).send({ success: true, id: log._id });
});

app.post('/api/note', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz");
    const colors = ['#7aa2f7', '#bb9af7', '#9ece6a', '#f7768e', '#e0af68', '#ff9e64'];
    const note = new Note({ 
        author: req.session.user, 
        content: escapeHtml(req.body.note), 
        color: colors[Math.floor(Math.random() * colors.length)] 
    });
    await note.save();
    io.emit('new-note', note);
    res.status(200).send({ success: true });
});

app.delete('/api/note/:id', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz");
    await Note.findByIdAndDelete(req.params.id);
    io.emit('delete-note', req.params.id);
    res.status(200).send({ success: true });
});

app.post('/api/command', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz");
    const { command } = req.body;
    const cmd = new Command({ command, issuedBy: req.session.user, status: 'pending' });
    await cmd.save();
    io.emit('new-command', cmd);
    res.status(200).send({ success: true, command: cmd });
});

app.patch('/api/command/:id', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz");
    const { status, result } = req.body;
    await Command.findByIdAndUpdate(req.params.id, { status, result });
    io.emit('update-command', { id: req.params.id, status, result });
    res.status(200).send({ success: true });
});

app.post('/api/clear-logs', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz");
    await Log.deleteMany({});
    io.emit('clear-logs');
    res.status(200).send({ success: true });
});

app.post('/api/broadcast', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz");
    const { message, type = 'info' } = req.body;
    io.emit('notification', { type, message: `📢 [${req.session.user}]: ${message}` });
    res.status(200).send({ success: true });
});

app.get('/api/metrics/history', async (req, res) => {
    const history = await Metric.find({ type: 'players' }).sort({ timestamp: -1 }).limit(50);
    res.status(200).send(history.reverse());
});

// ═══════════════════════════════════════════════════════════════
// 7. HTML TEMPLATES
// ═══════════════════════════════════════════════════════════════
function loginHTML(err) {
    return `<!DOCTYPE html>
<html style="background:#020204; color:#7aa2f7; font-family:'Inter',sans-serif; height:100%;">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>OxygenForge Eclipse v6 — AUTH</title>
<style>
*{box-sizing:border-box}body{margin:0;height:100vh;display:flex;justify-content:center;align-items:center;background:radial-gradient(ellipse at center,#0a0a1a 0%,#020204 100%)}
.login-box{background:rgba(16,16,30,0.9);border:1px solid rgba(122,162,247,0.2);padding:60px;border-radius:24px;text-align:center;backdrop-filter:blur(20px);box-shadow:0 0 60px rgba(122,162,247,0.1),inset 0 0 60px rgba(122,162,247,0.02);min-width:380px}
h2{margin:0 0 10px;letter-spacing:6px;font-size:28px;background:linear-gradient(135deg,#7aa2f7,#bb9af7);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.subtitle{color:#565f89;font-size:12px;letter-spacing:3px;margin-bottom:40px}
input{background:#0c0c18;border:1px solid #1a1a35;color:#fff;padding:16px;width:100%;border-radius:12px;margin-bottom:16px;font-size:14px;outline:none;transition:all 0.3s}
input:focus{border-color:#7aa2f7;box-shadow:0 0 20px rgba(122,162,247,0.15)}
button{background:linear-gradient(135deg,#7aa2f7,#565f89);color:#000;border:none;padding:16px 60px;border-radius:12px;font-weight:bold;cursor:pointer;font-size:14px;letter-spacing:2px;transition:all 0.3s;width:100%}
button:hover{transform:translateY(-2px);box-shadow:0 10px30px rgba(122,162,247,0.3)}
.error{color:#f7768e;font-size:12px;margin-top:15px}
.version{position:fixed;bottom:20px;right:20px;color:#1a1a35;font-size:11px;letter-spacing:2px}
</style></head>
<body>
<div class="login-box">
    <h2>OXYGENFORGE</h2>
    <div class="subtitle">ECLIPSE TERMINAL v6.0</div>
    <form action="/login" method="POST">
        <input type="text" name="username" placeholder="AGENT_ID" required autocomplete="off">
        <input type="password" name="key" placeholder="PASS_KEY" required>
        <button type="submit">AUTHENTICATE</button>
    </form>
    ${err ? '<div class="error">⚠️ Geçersiz kimlik bilgileri</div>' : ''}
</div>
<div class="version">SECURE CONNECTION // NODE.JS 18+</div>
</body></html>`;
}

function mainHTML(user, logs, notes, chats, commands, game) {
    const likeRatio = game ? Math.round((game.upvotes / (game.upvotes + game.downvotes)) * 100) || 0 : 0;
    const colors = ['#7aa2f7', '#bb9af7', '#9ece6a', '#f7768e', '#e0af68'];
    
    return `<!DOCTYPE html>
<html lang="tr" style="background:#020204;color:#a9b1d6;font-family:'Inter',system-ui,sans-serif;">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OxygenForge Eclipse v6 — Command Center</title>
<script src="/socket.io/socket.io.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#020204;color:#a9b1d6;font-family:'Inter',system-ui,sans-serif;height:100vh;overflow:hidden;display:flex;flex-direction:column}
::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-thumb{background:#24283b;border-radius:4px}

/* HEADER */
.header{background:rgba(10,10,20,0.95);border-bottom:1px solid rgba(122,162,247,0.1);padding:12px 24px;display:flex;align-items:center;gap:20px;backdrop-filter:blur(20px);z-index:100}
.header img{width:50px;height:50px;border-radius:12px;border:2px solid rgba(122,162,247,0.3)}
.header-info{flex:1}
.header h3{margin:0;font-size:18px;background:linear-gradient(135deg,#7aa2f7,#bb9af7);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.header-stats{display:flex;gap:15px;margin-top:6px}
.badge{background:rgba(26,27,38,0.8);padding:4px 12px;border-radius:8px;font-size:11px;color:#565f89;border:1px solid rgba(255,255,255,0.05)}
.badge span{font-weight:600}
.badge .online{color:#9ece6a}.badge .rating{color:#e0af68}.badge .agent{color:#7aa2f7}
.logout-btn{color:#565f89;text-decoration:none;font-size:12px;padding:8px 16px;border:1px solid rgba(255,255,255,0.05);border-radius:8px;transition:all 0.3s}
.logout-btn:hover{color:#f7768e;border-color:#f7768e}

/* MAIN GRID */
.main{flex:1;display:grid;grid-template-columns:280px 1fr 320px;gap:12px;padding:12px;overflow:hidden}
.panel{background:rgba(16,16,28,0.8);border:1px solid rgba(255,255,255,0.04);border-radius:16px;padding:16px;display:flex;flex-direction:column;overflow:hidden;backdrop-filter:blur(10px)}
.panel-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.03)}
.panel-title{font-size:13px;font-weight:600;color:#7aa2f7;letter-spacing:1px;display:flex;align-items:center;gap:8px}
.panel-title::before{content:'';width:8px;height:8px;background:#7aa2f7;border-radius:50%;box-shadow:0 0 10px rgba(122,162,247,0.5)}
.panel-content{flex:1;overflow-y:auto}

/* LEFT PANEL — SYSTEM & AGENTS */
.system-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}
.metric-box{background:rgba(10,10,20,0.6);padding:12px;border-radius:10px;text-align:center;border:1px solid rgba(255,255,255,0.03)}
.metric-value{font-size:20px;font-weight:700;color:#7aa2f7}
.metric-label{font-size:10px;color:#565f89;margin-top:4px;text-transform:uppercase;letter-spacing:1px}
.metric-value.warning{color:#e0af68}.metric-value.danger{color:#f7768e}

.agent-list{margin-top:12px}
.agent-item{display:flex;align-items:center;gap:10px;padding:8px;border-radius:8px;margin-bottom:6px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.02)}
.agent-dot{width:8px;height:8px;border-radius:50%;background:#9ece6a;box-shadow:0 0 8px rgba(158,206,106,0.4)}
.agent-dot.away{background:#e0af68;box-shadow:0 0 8px rgba(224,175,104,0.4)}
.agent-name{font-size:12px;color:#cfc9c2}
.agent-status{font-size:10px;color:#565f89}

.quick-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:auto}
.q-btn{padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.05);background:rgba(10,10,20,0.6);color:#a9b1d6;font-size:11px;cursor:pointer;transition:all 0.3s;text-align:center}
.q-btn:hover{border-color:#7aa2f7;color:#7aa2f7;transform:translateY(-1px)}
.q-btn.danger:hover{border-color:#f7768e;color:#f7768e}
.q-btn.warning:hover{border-color:#e0af68;color:#e0af68}

/* CENTER PANEL — CONSOLE */
.console-output{font-family:'JetBrains Mono','Fira Code',monospace;font-size:12px;line-height:1.6}
.log-entry{padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.02);display:flex;gap:10px;animation:fadeIn 0.3s ease}
@keyframes fadeIn{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:translateX(0)}}
.log-time{color:#565f89;font-size:11px;min-width:60px}
.log-user{color:#7aa2f7;font-weight:600;min-width:80px}
.log-content{color:#cfc9c2;flex:1}
.log-type-system .log-user{color:#bb9af7}.log-type-warning .log-user{color:#e0af68}.log-type-error .log-user{color:#f7768e}

.console-input-area{display:flex;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.05)}
.console-input{flex:1;background:#0c0c18;border:1px solid #1a1a35;color:#fff;padding:12px 16px;border-radius:10px;font-size:13px;outline:none;font-family:'JetBrains Mono',monospace}
.console-input:focus{border-color:#7aa2f7}
.send-btn{background:#7aa2f7;color:#000;border:none;padding:12px 24px;border-radius:10px;font-weight:600;cursor:pointer;font-size:12px}

/* RIGHT PANEL — NOTES & CHAT */
.note-item{background:rgba(255,255,255,0.02);padding:12px;border-radius:10px;border-left:3px solid;margin-bottom:10px;position:relative;animation:slideIn 0.3s ease}
@keyframes slideIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.note-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.note-author{font-size:11px;color:#565f89}
.note-time{font-size:10px;color:#3b3f5c}
.note-text{color:#cfc9c2;font-size:13px;line-height:1.5}
.note-delete{position:absolute;top:8px;right:8px;background:none;border:none;color:#f7768e;cursor:pointer;font-size:14px;opacity:0;transition:opacity 0.2s}
.note-item:hover .note-delete{opacity:0.6}.note-delete:hover{opacity:1!important}

.chat-box{flex:1;overflow-y:auto;margin-bottom:12px;display:flex;flex-direction:column;gap:6px}
.chat-msg{padding:8px 12px;border-radius:10px;background:rgba(122,162,247,0.08);border:1px solid rgba(122,162,247,0.1);max-width:90%}
.chat-msg.own{background:rgba(158,206,106,0.08);border-color:rgba(158,206,106,0.1);align-self:flex-end}
.chat-author{font-size:10px;color:#7aa2f7;margin-bottom:2px;font-weight:600}
.chat-text{font-size:12px;color:#cfc9c2}
.chat-time{font-size:9px;color:#3b3f5c;margin-top:4px;text-align:right}

.note-input,.chat-input{width:100%;background:#0c0c18;border:1px solid #1a1a35;color:#fff;padding:10px 14px;border-radius:10px;font-size:13px;outline:none;margin-top:8px}
.note-input:focus,.chat-input:focus{border-color:#7aa2f7}

/* NOTIFICATIONS */
.toast-container{position:fixed;top:20px;right:20px;z-index:1000;display:flex;flex-direction:column;gap:10px}
.toast{background:rgba(16,16,30,0.95);border:1px solid rgba(255,255,255,0.08);padding:14px 20px;border-radius:12px;backdrop-filter:blur(20px);display:flex;align-items:center;gap:12px;animation:toastIn 0.4s ease;max-width:350px;box-shadow:0 10px 40px rgba(0,0,0,0.3)}
@keyframes toastIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
.toast.info{border-left:3px solid #7aa2f7}.toast.success{border-left:3px solid #9ece6a}.toast.warning{border-left:3px solid #e0af68}.toast.error{border-left:3px solid #f7768e}
.toast-text{font-size:13px;color:#cfc9c2}

/* COMMANDS */
.cmd-item{padding:8px 12px;background:rgba(255,255,255,0.02);border-radius:8px;margin-bottom:6px;font-size:12px;display:flex;justify-content:space-between;align-items:center}
.cmd-status{padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600}
.cmd-status.pending{background:rgba(224,175,104,0.15);color:#e0af68}
.cmd-status.done{background:rgba(158,206,106,0.15);color:#9ece6a}

/* RESPONSIVE */
@media(max-width:1200px){.main{grid-template-columns:240px 1fr 280px}}
@media(max-width:900px){.main{grid-template-columns:1fr;grid-template-rows:auto 1fr auto;height:auto;overflow-y:auto}}
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
    <img src="https://www.roblox.com/asset-thumbnail/image?assetId=${PLACE_ID}&width=420&height=420" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2250%22 height=%2250%22><rect fill=%22%231a1b26%22 width=%2250%22 height=%2250%22/><text fill=%22%237aa2f7%22 x=%2250%%22 y=%2250%%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2220%22>🎮</text></svg>'">
    <div class="header-info">
        <h3>RNG CAR ARENA — COMMAND CENTER</h3>
        <div class="header-stats">
            <span class="badge">👥 PLAYING: <span class="online">${game ? game.playing : 0}</span></span>
            <span class="badge">👍 RATING: <span class="rating">%${likeRatio}</span></span>
            <span class="badge">🛰️ AGENT: <span class="agent">${escapeHtml(user)}</span></span>
            <span class="badge">⚡ PING: <span id="ping-badge" class="online">--ms</span></span>
        </div>
    </div>
    <a href="/logout" class="logout-btn">[ TERMINATE SESSION ]</a>
</div>

<!-- MAIN GRID -->
<div class="main">

<!-- LEFT: SYSTEM & AGENTS -->
<div class="panel">
    <div class="panel-header"><div class="panel-title">SYSTEM_METRICS</div></div>
    <div class="system-grid">
        <div class="metric-box">
            <div class="metric-value" id="cpu-metric">--%</div>
            <div class="metric-label">CPU Load</div>
        </div>
        <div class="metric-box">
            <div class="metric-value" id="mem-metric">--MB</div>
            <div class="metric-label">Memory</div>
        </div>
        <div class="metric-box">
            <div class="metric-value" id="conn-metric">--</div>
            <div class="metric-label">Connections</div>
        </div>
        <div class="metric-box">
            <div class="metric-value warning" id="uptime-metric">--</div>
            <div class="metric-label">Uptime</div>
        </div>
    </div>
    
    <div class="panel-header" style="margin-top:16px"><div class="panel-title">ACTIVE_AGENTS</div></div>
    <div class="agent-list" id="agent-list">
        <div class="agent-item"><div class="agent-dot"></div><div><div class="agent-name">${escapeHtml(user)}</div><div class="agent-status">You • Online</div></div></div>
    </div>
    
    <div class="panel-header" style="margin-top:16px"><div class="panel-title">QUICK_ACTIONS</div></div>
    <div class="quick-actions">
        <button class="q-btn" onclick="broadcast('Sunucu bakıma alınıyor...', 'warning')">🔧 MAINTENANCE</button>
        <button class="q-btn danger" onclick="broadcast('ACİL DURUM! Tüm ajanlar pozisyon alın!', 'error')">🚨 EMERGENCY</button>
        <button class="q-btn warning" onclick="clearLogs()">🗑️ CLEAR LOGS</button>
        <button class="q-btn" onclick="sendCommand('restart')">🔄 RESTART</button>
    </div>
    
    <div class="panel-header" style="margin-top:16px"><div class="panel-title">COMMAND_QUEUE</div></div>
    <div class="panel-content" id="command-list">
        ${commands.length === 0 ? '<div style="color:#565f89;font-size:12px;text-align:center;padding:20px">Komut kuyruğu boş</div>' : commands.map(c => `
            <div class="cmd-item" data-cmd-id="${c._id}">
                <div><span style="color:#7aa2f7">$</span> ${escapeHtml(c.command)} <span style="color:#565f89">— ${c.issuedBy}</span></div>
                <span class="cmd-status ${c.status}">${c.status.toUpperCase()}</span>
            </div>
        `).join('')}
    </div>
</div>

<!-- CENTER: LIVE CONSOLE -->
<div class="panel">
    <div class="panel-header">
        <div class="panel-title">LIVE_CONSOLE</div>
        <div style="display:flex;gap:8px">
            <button onclick="clearLogs()" style="background:#f7768e22;border:1px solid #f7768e;color:#f7768e;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600">CLEAR</button>
            <button onclick="toggleAutoScroll()" id="autoscroll-btn" style="background:#9ece6a22;border:1px solid #9ece6a;color:#9ece6a;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600">AUTO: ON</button>
        </div>
    </div>
    <div class="panel-content console-output" id="console">
        ${logs.length === 0 ? '<div style="color:#565f89;text-align:center;padding:40px;font-size:14px">🛰️ Konsol hazır... Veri akışı bekleniyor</div>' : logs.map(l => `
            <div class="log-entry log-type-${l.type || 'info'}">
                <span class="log-time">${new Date(l.timestamp).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
                <span class="log-user">${escapeHtml(l.user || 'SYSTEM')}</span>
                <span class="log-content">${escapeHtml(l.content)}</span>
            </div>
        `).join('')}
    </div>
    <div class="console-input-area">
        <input type="text" class="console-input" id="cmd-input" placeholder="Komut girin... (örn: /kick username, /announce mesaj)" autocomplete="off">
        <button class="send-btn" onclick="sendCommandFromInput()">EXECUTE</button>
    </div>
</div>

<!-- RIGHT: NOTES & CHAT -->
<div style="display:flex;flex-direction:column;gap:12px;overflow:hidden">
    <div class="panel" style="flex:1.2">
        <div class="panel-header"><div class="panel-title">AGENT_NOTES</div></div>
        <div class="panel-content" id="notes-container">
            ${notes.length === 0 ? '<div style="color:#565f89;font-size:12px;text-align:center;padding:20px">Henüz not yok</div>' : notes.map(n => `
                <div class="note-item" data-note-id="${n._id}" style="border-left-color:${n.color}">
                    <button class="note-delete" onclick="deleteNote('${n._id}')">✕</button>
                    <div class="note-header">
                        <span class="note-author">${escapeHtml(n.author)}</span>
                        <span class="note-time">${new Date(n.timestamp).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</span>
                    </div>
                    <div class="note-text">${escapeHtml(n.content)}</div>
                </div>
            `).join('')}
        </div>
        <form onsubmit="addNote(event)">
            <input type="text" class="note-input" id="note-input" placeholder="Not ekle... (Enter)" autocomplete="off">
        </form>
    </div>
    
    <div class="panel" style="flex:1">
        <div class="panel-header"><div class="panel-title">AGENT_CHAT</div></div>
        <div class="panel-content chat-box" id="chat-box">
            ${chats.length === 0 ? '<div style="color:#565f89;font-size:12px;text-align:center;padding:20px">Sohbet başlatın...</div>' : chats.map(c => `
                <div class="chat-msg ${c.author === user ? 'own' : ''}">
                    <div class="chat-author">${escapeHtml(c.author)}</div>
                    <div class="chat-text">${escapeHtml(c.message)}</div>
                    <div class="chat-time">${new Date(c.timestamp).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</div>
                </div>
            `).join('')}
        </div>
        <form onsubmit="sendChat(event)">
            <input type="text" class="chat-input" id="chat-input" placeholder="Mesaj yaz..." autocomplete="off">
        </form>
    </div>
</div>

</div>

<!-- TOAST CONTAINER -->
<div class="toast-container" id="toast-container"></div>

<script>
const socket = io();
const currentUser = "${escapeHtml(user)}";
let autoScroll = true;

// ═══════════════════════════════════════════════════════════════
// BAĞLANTI & KİMLİK
// ═══════════════════════════════════════════════════════════════
socket.emit('agent-login', currentUser);
socket.emit('agent-status', 'online');

// Ping ölçümü
setInterval(() => {
    const start = Date.now();
    socket.emit('ping-check');
    socket.once('pong-check', () => {
        document.getElementById('ping-badge').textContent = (Date.now() - start) + 'ms';
    });
}, 5000);

// ═══════════════════════════════════════════════════════════════
// SİSTEM METRİKLERİ
// ═══════════════════════════════════════════════════════════════
socket.on('system-metrics', (data) => {
    document.getElementById('cpu-metric').textContent = data.cpu + '%';
    document.getElementById('cpu-metric').className = 'metric-value' + (data.cpu > 80 ? ' danger' : data.cpu > 50 ? ' warning' : '');
    document.getElementById('mem-metric').textContent = data.memory + 'MB';
    document.getElementById('conn-metric').textContent = data.connections;
    const hours = Math.floor(data.uptime / 3600);
    const mins = Math.floor((data.uptime % 3600) / 60);
    document.getElementById('uptime-metric').textContent = hours + 'h ' + mins + 'm';
});

// ═══════════════════════════════════════════════════════════════
// AJAN LİSTESİ
// ═══════════════════════════════════════════════════════════════
socket.on('agents-update', (agents) => {
    const list = document.getElementById('agent-list');
    list.innerHTML = agents.map(a => \`
        <div class="agent-item">
            <div class="agent-dot \${a.status === 'away' ? 'away' : ''}"></div>
            <div>
                <div class="agent-name">\${a.username}</div>
                <div class="agent-status">\${a.status === 'away' ? 'Away' : 'Online'} • \${new Date(a.since).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</div>
            </div>
        </div>
    \`).join('');
});

// ═══════════════════════════════════════════════════════════════
// KONSOL — GERÇEK ZAMANLI
// ═══════════════════════════════════════════════════════════════
const consoleBox = document.getElementById('console');

socket.on('new-log', (log) => {
    const entry = document.createElement('div');
    entry.className = 'log-entry log-type-' + (log.type || 'info');
    entry.innerHTML = \`
        <span class="log-time">\${new Date(log.timestamp).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
        <span class="log-user">\${escapeHtml(log.user || 'SYSTEM')}</span>
        <span class="log-content">\${escapeHtml(log.content)}</span>
    \`;
    consoleBox.appendChild(entry);
    if (autoScroll) consoleBox.scrollTop = consoleBox.scrollHeight;
    showToast('Yeni log: ' + log.user, 'info');
});

socket.on('clear-logs', () => {
    consoleBox.innerHTML = '<div style="color:#565f89;text-align:center;padding:40px;font-size:14px">🗑️ Konsol temizlendi</div>';
    showToast('Konsol temizlendi', 'success');
});

function toggleAutoScroll() {
    autoScroll = !autoScroll;
    document.getElementById('autoscroll-btn').textContent = 'AUTO: ' + (autoScroll ? 'ON' : 'OFF');
    document.getElementById('autoscroll-btn').style.borderColor = autoScroll ? '#9ece6a' : '#565f89';
    document.getElementById('autoscroll-btn').style.color = autoScroll ? '#9ece6a' : '#565f89';
}

// ═══════════════════════════════════════════════════════════════
// NOTLAR — GERÇEK ZAMANLI
// ═══════════════════════════════════════════════════════════════
const notesContainer = document.getElementById('notes-container');

socket.on('new-note', (note) => {
    const colors = ['#7aa2f7', '#bb9af7', '#9ece6a', '#f7768e', '#e0af68', '#ff9e64'];
    const div = document.createElement('div');
    div.className = 'note-item';
    div.style.borderLeftColor = note.color;
    div.setAttribute('data-note-id', note._id);
    div.innerHTML = \`
        <button class="note-delete" onclick="deleteNote('\${note._id}')">✕</button>
        <div class="note-header">
            <span class="note-author">\${escapeHtml(note.author)}</span>
            <span class="note-time">\${new Date(note.timestamp).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</span>
        </div>
        <div class="note-text">\${escapeHtml(note.content)}</div>
    \`;
    notesContainer.insertBefore(div, notesContainer.firstChild);
    showToast(note.author + ' yeni not ekledi', 'success');
});

socket.on('delete-note', (id) => {
    const el = document.querySelector('[data-note-id="' + id + '"]');
    if (el) el.remove();
});

async function addNote(e) {
    e.preventDefault();
    const input = document.getElementById('note-input');
    if (!input.value.trim()) return;
    await fetch('/api/note', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({note: input.value}) });
    input.value = '';
}

async function deleteNote(id) {
    if (!confirm('Not silinsin mi?')) return;
    await fetch('/api/note/' + id, { method: 'DELETE' });
}

// ═══════════════════════════════════════════════════════════════
// CHAT — GERÇEK ZAMANLI
// ═══════════════════════════════════════════════════════════════
const chatBox = document.getElementById('chat-box');

socket.on('chat-message', (data) => {
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (data.author === currentUser ? 'own' : '');
    div.innerHTML = \`
        <div class="chat-author">\${escapeHtml(data.author)}</div>
        <div class="chat-text">\${escapeHtml(data.message)}</div>
        <div class="chat-time">\${new Date(data.timestamp).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</div>
    \`;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    if (data.author !== currentUser) showToast(data.author + ': ' + data.message, 'info');
});

function sendChat(e) {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    if (!input.value.trim()) return;
    socket.emit('chat-message', { author: currentUser, message: input.value });
    input.value = '';
}

// ═══════════════════════════════════════════════════════════════
// KOMUTLAR
// ═══════════════════════════════════════════════════════════════
socket.on('new-command', (cmd) => {
    const list = document.getElementById('command-list');
    const div = document.createElement('div');
    div.className = 'cmd-item';
    div.setAttribute('data-cmd-id', cmd._id);
    div.innerHTML = \`
        <div><span style="color:#7aa2f7">$</span> \${escapeHtml(cmd.command)} <span style="color:#565f89">— \${cmd.issuedBy}</span></div>
        <span class="cmd-status pending">PENDING</span>
    \`;
    list.insertBefore(div, list.firstChild);
    showToast('Yeni komut: ' + cmd.command, 'warning');
});

socket.on('update-command', (data) => {
    const el = document.querySelector('[data-cmd-id="' + data.id + '"] .cmd-status');
    if (el) {
        el.className = 'cmd-status ' + data.status;
        el.textContent = data.status.toUpperCase();
    }
});

function sendCommand(cmd) {
    fetch('/api/command', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({command: cmd}) });
}

function sendCommandFromInput() {
    const input = document.getElementById('cmd-input');
    if (!input.value.trim()) return;
    sendCommand(input.value);
    input.value = '';
}

// ═══════════════════════════════════════════════════════════════
// BİLDİRİMLER (TOAST)
// ═══════════════════════════════════════════════════════════════
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML = '<div class="toast-text">' + message + '</div>';
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(100%)'; setTimeout(() => toast.remove(), 400); }, 4000);
}

socket.on('notification', (data) => showToast(data.message, data.type));

async function broadcast(msg, type) {
    await fetch('/api/broadcast', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({message: msg, type}) });
}

async function clearLogs() {
    if (!confirm('Tüm logları temizle?')) return;
    await fetch('/api/clear-logs', { method: 'POST' });
}

// ═══════════════════════════════════════════════════════════════
// YARDIMCI
// ═══════════════════════════════════════════════════════════════
function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

// Başlangıç scroll
consoleBox.scrollTop = consoleBox.scrollHeight;
chatBox.scrollTop = chatBox.scrollHeight;

// Input focus'ta auto-scroll durdurma
document.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('focus', () => { autoScroll = false; toggleAutoScroll(); });
    inp.addEventListener('blur', () => { autoScroll = true; toggleAutoScroll(); });
});
</script>

</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════
// 8. SUNUCU BAŞLATMA
// ═══════════════════════════════════════════════════════════════
server.listen(PORT, () => {
    console.log(`
    ╔══════════════════════════════════════════════════════════════╗
    ║                                                              ║
    ║           🛰️  OXYGENFORGE ECLIPSE TERMINAL v6.0              ║
    ║                                                              ║
    ║           Real-time Roblox Command Center                    ║
    ║           Port: ${PORT}                                       
    ║           Mode: PRODUCTION READY                             ║
    ║                                                              ║
    ╚══════════════════════════════════════════════════════════════╝
    `);
});
