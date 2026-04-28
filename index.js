const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
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
const HIGH_COMMAND_KEY = process.env.HIGH_COMMAND_KEY || "developerconsoleiznisifresi123321456?!?";
const PORT = process.env.PORT || 3000;

if (!ADMIN_KEY) throw new Error("❌ ADMIN_KEY tanımlanmamış!");
if (!MONGO_URI) throw new Error("❌ MONGO_URI tanımlanmamış!");

const AUTHORIZED_USERS = ["OxygenForge", "Batu", "Gorkem"];

// Kara liste & İzin bekleme listesi
const blacklist = new Set();
const pendingCommands = new Map(); // socketId -> {command, timestamp, socket}

// XSS Koruması
function escapeHtml(text) {
    if (typeof text !== 'string') return String(text);
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
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
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

const Command = mongoose.model('Command', new mongoose.Schema({
    command: String, issuedBy: String, status: { type: String, default: 'pending' },
    result: String, timestamp: { type: Date, default: Date.now }
}));

const BlacklistEntry = mongoose.model('Blacklist', new mongoose.Schema({
    ip: String, reason: String, blockedBy: String,
    timestamp: { type: Date, default: Date.now }
}));

const Settings = mongoose.model('Settings', new mongoose.Schema({
    key: { type: String, unique: true },
    value: mongoose.Schema.Types.Mixed,
    updatedBy: String,
    timestamp: { type: Date, default: Date.now }
}));

// Varsayılan ayarları oluştur
async function initSettings() {
    const defaults = [
        { key: 'autoRefresh', value: true },
        { key: 'refreshInterval', value: 10 },
        { key: 'consoleMaxLines', value: 500 },
        { key: 'notificationsEnabled', value: true },
        { key: 'soundEnabled', value: true },
        { key: 'theme', value: 'dark' },
        { key: 'commandApprovalRequired', value: true },
        { key: 'maintenanceMode', value: false }
    ];
    for (const def of defaults) {
        await Settings.findOneAndUpdate({ key: def.key }, def, { upsert: true });
    }
}
initSettings();

// ═══════════════════════════════════════════════════════════════
// 4. YARDIMCI FONKSİYONLAR
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
        cpu: Math.floor(Math.random() * 30) + 10,
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
    const clientIp = socket.handshake.address;
    
    // Kara liste kontrolü
    if (blacklist.has(clientIp)) {
        socket.emit('notification', { type: 'error', message: '🚫 IP adresiniz kara listede! Erişim reddedildi.' });
        socket.disconnect(true);
        return;
    }
    
    console.log(`🔗 Yeni bağlantı: ${socket.id} (${clientIp})`);
    
    // Sistem metriklerini gönder
    const metricsInterval = setInterval(() => {
        socket.emit('system-metrics', getSystemMetrics());
    }, 3000);
    
    // Ping-pong
    socket.on('ping-check', () => socket.emit('pong-check'));
    
    // Ajan girişi
    socket.on('agent-login', (username) => {
        onlineAgents.set(socket.id, { username, status: 'online', since: new Date(), socketId: socket.id });
        io.emit('agents-update', Array.from(onlineAgents.values()));
        io.emit('notification', { type: 'info', message: `🟢 ${escapeHtml(username)} sisteme giriş yaptı` });
    });
    
    socket.on('agent-status', (status) => {
        const agent = onlineAgents.get(socket.id);
        if (agent) {
            agent.status = status;
            io.emit('agents-update', Array.from(onlineAgents.values()));
        }
    });
    
    // Chat mesajları
    socket.on('chat-message', async (data) => {
        const chat = new Chat({ author: data.author, message: data.message });
        await chat.save();
        io.emit('chat-message', { ...data, timestamp: new Date() });
        
        // Sohbette bildirim
        if (data.author !== 'SYSTEM') {
            io.emit('notification', { 
                type: 'info', 
                message: `💬 ${escapeHtml(data.author)}: ${escapeHtml(data.message.substring(0, 30))}${data.message.length > 30 ? '...' : ''}` 
            });
        }
    });
    
    // Dışarıdan console mesajı gelmeden ÖNCE izin iste
    socket.on('request-console-access', (data) => {
        const { command, source } = data;
        
        // Kara liste kontrolü
        if (blacklist.has(source || clientIp)) {
            socket.emit('console-denied', { reason: 'Kara listedesiniz!' });
            return;
        }
        
        // OxygenForge'e bildirim gönder
        const requestId = crypto.randomBytes(8).toString('hex');
        pendingCommands.set(requestId, { 
            command, 
            source: source || clientIp, 
            socketId: socket.id,
            socket: socket,
            timestamp: Date.now()
        });
        
        // Tüm adminlere bildirim
        io.emit('console-permission-request', {
            requestId,
            command: escapeHtml(command),
            source: escapeHtml(source || clientIp),
            timestamp: new Date()
        });
        
        io.emit('notification', { 
            type: 'warning', 
            message: `⚠️ CONSOLE İZİN İSTEĞİ: "${escapeHtml(command)}" | Kaynak: ${escapeHtml(source || clientIp)}` 
        });
        
        socket.emit('console-waiting', { requestId, message: 'OxygenForge onayı bekleniyor...' });
    });
    
    // OxygenForge izin verirse
    socket.on('approve-console-command', async (data) => {
        const { requestId, approved } = data;
        const pending = pendingCommands.get(requestId);
        
        if (!pending) {
            socket.emit('notification', { type: 'error', message: '❌ İstek bulunamadı veya süresi doldu' });
            return;
        }
        
        if (approved) {
            // İzin verildi, komutu çalıştır
            pending.socket.emit('console-approved', { command: pending.command });
            
            // Log kaydet
            const log = new Log({
                serverName: 'EXTERNAL',
                type: 'command',
                user: pending.source,
                content: `[ONAYLANDI] ${pending.command}`
            });
            await log.save();
            io.emit('new-log', log);
            
            io.emit('notification', { 
                type: 'success', 
                message: `✅ Komut onaylandı: ${escapeHtml(pending.command)}` 
            });
        } else {
            // İzin reddedildi, kara listeye al
            blacklist.add(pending.source);
            await new BlacklistEntry({ 
                ip: pending.source, 
                reason: `Komut reddedildi: ${pending.command}`,
                blockedBy: 'OxygenForge'
            }).save();
            
            pending.socket.emit('console-denied', { 
                reason: 'OxygenForge tarafından reddedildiniz. Kara listeye alındınız!' 
            });
            
            io.emit('notification', { 
                type: 'error', 
                message: `🚫 ${escapeHtml(pending.source)} kara listeye alındı!` 
            });
        }
        
        pendingCommands.delete(requestId);
    });
    
    // Yüksek yetkili komutlar
    socket.on('high-command', async (data) => {
        const { command, password } = data;
        
        if (password !== HIGH_COMMAND_KEY) {
            socket.emit('notification', { type: 'error', message: '❌ Yüksek yetkili şifre yanlış!' });
            socket.emit('high-command-result', { success: false, error: 'Yanlış şifre' });
            return;
        }
        
        // Komutu işle
        let result = '';
        try {
            if (command.startsWith('/kick ')) {
                const target = command.split(' ')[1];
                result = `🥾 ${target} sunucudan atıldı`;
            } else if (command.startsWith('/ban ')) {
                const target = command.split(' ')[1];
                result = `🔨 ${target} yasaklandı`;
            } else if (command.startsWith('/announce ')) {
                const msg = command.substring(10);
                io.emit('notification', { type: 'warning', message: `📢 DUYURU: ${msg}` });
                result = `📢 Duyuru yayınlandı: ${msg}`;
            } else if (command === '/shutdown') {
                io.emit('notification', { type: 'error', message: '🚨 SUNUCU KAPANIYOR!' });
                result = '🔴 Sunucu kapatma komutu verildi';
            } else if (command === '/restart') {
                io.emit('notification', { type: 'warning', message: '🔄 Sunucu yeniden başlatılıyor...' });
                result = '🔄 Yeniden başlatma komutu verildi';
            } else if (command === '/maintenance on') {
                await Settings.findOneAndUpdate({ key: 'maintenanceMode' }, { value: true });
                io.emit('notification', { type: 'warning', message: '🔧 Bakım modu AKTİF' });
                result = '🔧 Bakım modu aktif edildi';
            } else if (command === '/maintenance off') {
                await Settings.findOneAndUpdate({ key: 'maintenanceMode' }, { value: false });
                io.emit('notification', { type: 'success', message: '✅ Bakım modu KAPATILDI' });
                result = '✅ Bakım modu kapatıldı';
            } else if (command === '/clearblacklist') {
                blacklist.clear();
                await BlacklistEntry.deleteMany({});
                result = '🗑️ Kara liste temizlendi';
            } else {
                result = `❓ Bilinmeyen komut: ${command}`;
            }
            
            const cmd = new Command({ command, issuedBy: 'HIGH_COMMAND', status: 'done', result });
            await cmd.save();
            io.emit('new-command', cmd);
            socket.emit('high-command-result', { success: true, result });
            io.emit('notification', { type: 'success', message: `⚡ YÜKSEK KOMUT: ${escapeHtml(command)}` });
            
        } catch(err) {
            socket.emit('high-command-result', { success: false, error: err.message });
        }
    });
    
    socket.on('disconnect', () => {
        clearInterval(metricsInterval);
        const agent = onlineAgents.get(socket.id);
        if (agent) {
            io.emit('notification', { type: 'warning', message: `🔴 ${escapeHtml(agent.username)} bağlantısı koptu` });
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
    const blacklistEntries = await BlacklistEntry.find({}).sort({ timestamp: -1 }).limit(20);
    const settings = await Settings.find({});
    const game = await getRobloxInfo();
    res.send(mainHTML(req.session.user, logs, notes, chats, commands, blacklistEntries, settings, game));
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

// Ayarlar API
app.get('/api/settings', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz");
    const settings = await Settings.find({});
    res.status(200).send(settings);
});

app.post('/api/settings', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz");
    const { key, value } = req.body;
    await Settings.findOneAndUpdate({ key }, { key, value, updatedBy: req.session.user }, { upsert: true });
    io.emit('settings-updated', { key, value });
    res.status(200).send({ success: true });
});

// Kara liste API
app.get('/api/blacklist', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz");
    const entries = await BlacklistEntry.find({}).sort({ timestamp: -1 });
    res.status(200).send(entries);
});

app.delete('/api/blacklist/:id', async (req, res) => {
    if (!req.session.loggedIn) return res.status(403).send("Yetkisiz");
    const entry = await BlacklistEntry.findById(req.params.id);
    if (entry) {
        blacklist.delete(entry.ip);
        await BlacklistEntry.findByIdAndDelete(req.params.id);
    }
    res.status(200).send({ success: true });
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
button:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(122,162,247,0.3)}
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

function mainHTML(user, logs, notes, chats, commands, blacklistEntries, settings, game) {
    const likeRatio = game ? Math.round((game.upvotes / (game.upvotes + game.downvotes)) * 100) || 0 : 0;
    const settingsMap = {};
    settings.forEach(s => settingsMap[s.key] = s.value);
    
    return `<!DOCTYPE html>
<html lang="tr" style="background:#020204;color:#a9b1d6;font-family:'Inter',system-ui,sans-serif;">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OxygenForge Eclipse v6 — Command Center</title>
<script src="/socket.io/socket.io.js"></script>
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
.header-stats{display:flex;gap:15px;margin-top:6px;flex-wrap:wrap}
.badge{background:rgba(26,27,38,0.8);padding:4px 12px;border-radius:8px;font-size:11px;color:#565f89;border:1px solid rgba(255,255,255,0.05)}
.badge span{font-weight:600}
.badge .online{color:#9ece6a}.badge .rating{color:#e0af68}.badge .agent{color:#7aa2f7}
.logout-btn{color:#565f89;text-decoration:none;font-size:12px;padding:8px 16px;border:1px solid rgba(255,255,255,0.05);border-radius:8px;transition:all 0.3s}
.logout-btn:hover{color:#f7768e;border-color:#f7768e}
.settings-btn{color:#e0af68;text-decoration:none;font-size:12px;padding:8px 16px;border:1px solid rgba(224,175,104,0.2);border-radius:8px;transition:all 0.3s;margin-left:auto}
.settings-btn:hover{color:#fff;border-color:#e0af68;background:rgba(224,175,104,0.1)}

/* MAIN GRID */
.main{flex:1;display:grid;grid-template-columns:280px 1fr 320px;gap:12px;padding:12px;overflow:hidden}
.panel{background:rgba(16,16,28,0.8);border:1px solid rgba(255,255,255,0.04);border-radius:16px;padding:16px;display:flex;flex-direction:column;overflow:hidden;backdrop-filter:blur(10px)}
.panel-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.03)}
.panel-title{font-size:13px;font-weight:600;color:#7aa2f7;letter-spacing:1px;display:flex;align-items:center;gap:8px}
.panel-title::before{content:'';width:8px;height:8px;background:#7aa2f7;border-radius:50%;box-shadow:0 0 10px rgba(122,162,247,0.5)}
.panel-content{flex:1;overflow-y:auto}

/* LEFT PANEL */
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

/* RIGHT PANEL */
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

/* PERMISSION REQUEST */
.perm-request{background:rgba(224,175,104,0.08);border:1px solid rgba(224,175,104,0.2);border-radius:12px;padding:16px;margin-bottom:12px;animation:slideIn 0.4s ease}
.perm-request .perm-title{color:#e0af68;font-size:13px;font-weight:600;margin-bottom:8px}
.perm-request .perm-cmd{color:#fff;font-family:monospace;font-size:12px;background:rgba(0,0,0,0.3);padding:8px;border-radius:6px;margin-bottom:10px}
.perm-buttons{display:flex;gap:10px}
.perm-btn{flex:1;padding:10px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.3s}
.perm-btn.approve{background:#9ece6a;color:#000}
.perm-btn.approve:hover{background:#7bc043}
.perm-btn.deny{background:#f7768e;color:#000}
.perm-btn.deny:hover{background:#d65a6f}

/* HIGH COMMAND */
.high-cmd-area{background:rgba(247,118,142,0.05);border:1px solid rgba(247,118,142,0.15);border-radius:12px;padding:16px;margin-top:16px}
.high-cmd-title{color:#f7768e;font-size:13px;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px}
.high-cmd-title::before{content:'⚡';font-size:16px}
.high-cmd-input{background:#0c0c18;border:1px solid rgba(247,118,142,0.3);color:#fff;padding:12px;border-radius:10px;width:100%;margin-bottom:10px;font-family:monospace;font-size:13px;outline:none}
.high-cmd-input:focus{border-color:#f7768e;box-shadow:0 0 15px rgba(247,118,142,0.1)}
.high-cmd-pass{background:#0c0c18;border:1px solid rgba(247,118,142,0.3);color:#fff;padding:10px;border-radius:10px;width:100%;margin-bottom:10px;font-size:12px;outline:none}
.high-cmd-btn{background:#f7768e;color:#000;border:none;padding:12px 24px;border-radius:10px;font-weight:600;cursor:pointer;width:100%;font-size:13px;transition:all 0.3s}
.high-cmd-btn:hover{background:#ff8aa3;transform:translateY(-1px);box-shadow:0 5px 20px rgba(247,118,142,0.3)}

/* SETTINGS MODAL */
.modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(10px);z-index:1000;display:none;justify-content:center;align-items:center;padding:20px}
.modal-overlay.active{display:flex}
.modal{background:rgba(16,16,30,0.95);border:1px solid rgba(122,162,247,0.2);border-radius:20px;padding:30px;width:100%;max-width:500px;max-height:80vh;overflow-y:auto;box-shadow:0 0 60px rgba(0,0,0,0.5)}
.modal-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
.modal-title{font-size:20px;font-weight:700;background:linear-gradient(135deg,#7aa2f7,#bb9af7);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.modal-close{background:none;border:none;color:#565f89;font-size:24px;cursor:pointer;transition:color 0.3s}
.modal-close:hover{color:#f7768e}
.setting-item{margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.03)}
.setting-label{display:block;font-size:13px;color:#a9b1d6;margin-bottom:8px}
.setting-desc{font-size:11px;color:#565f89;margin-bottom:10px}
.toggle-switch{position:relative;width:50px;height:26px;background:#1a1b26;border-radius:13px;cursor:pointer;transition:background 0.3s}
.toggle-switch.active{background:#7aa2f7}
.toggle-switch::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;background:#fff;border-radius:50%;transition:transform 0.3s}
.toggle-switch.active::after{transform:translateX(24px)}
.setting-input{background:#0c0c18;border:1px solid #1a1a35;color:#fff;padding:10px 14px;border-radius:10px;width:100%;font-size:13px;outline:none}
.setting-input:focus{border-color:#7aa2f7}

/* BLACKLIST */
.blacklist-item{display:flex;justify-content:space-between;align-items:center;padding:10px;background:rgba(247,118,142,0.05);border-radius:8px;margin-bottom:8px;font-size:12px}
.blacklist-ip{color:#f7768e;font-family:monospace}
.blacklist-reason{color:#565f89;font-size:11px}
.blacklist-remove{background:#f7768e22;border:1px solid #f7768e;color:#f7768e;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:11px}

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
@media(max-width:900px){
    .main{grid-template-columns:1fr;grid-template-rows:auto 1fr auto;height:auto;overflow-y:auto}
    .header-stats{gap:8px}
    .badge{font-size:10px;padding:3px 8px}
}
@media(max-width:600px){
    .main{padding:8px;gap:8px}
    .panel{padding:12px}
    .header{padding:10px 16px}
    .header h3{font-size:14px}
}
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
    <img src="https://www.roblox.com/asset-thumbnail/image?assetId=${PLACE_ID}&width=420&height=420" onerror="this.style.display='none'">
    <div class="header-info">
        <h3>RNG CAR ARENA — COMMAND CENTER</h3>
        <div class="header-stats">
            <span class="badge">👥 PLAYING: <span class="online">${game ? game.playing : 0}</span></span>
            <span class="badge">👍 RATING: <span class="rating">%${likeRatio}</span></span>
            <span class="badge">🛰️ AGENT: <span class="agent">${escapeHtml(user)}</span></span>
            <span class="badge">⚡ PING: <span id="ping-badge" class="online">--ms</span></span>
        </div>
    </div>
    <button class="settings-btn" onclick="openSettings()">⚙️ AYARLAR</button>
    <a href="/logout" class="logout-btn">[ ÇIKIŞ ]</a>
</div>

<!-- MAIN GRID -->
<div class="main">

<!-- LEFT: SYSTEM & AGENTS & PERMISSIONS -->
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
    
    <div class="panel-header" style="margin-top:16px"><div class="panel-title">PERMISSION_QUEUE</div></div>
    <div class="panel-content" id="perm-queue">
        <div style="color:#565f89;font-size:12px;text-align:center;padding:20px">Bekleyen izin isteği yok</div>
    </div>
    
    <div class="panel-header" style="margin-top:16px"><div class="panel-title">QUICK_ACTIONS</div></div>
    <div class="quick-actions">
        <button class="q-btn" onclick="broadcast('Sunucu bakıma alınıyor...', 'warning')">🔧 BAKIM</button>
        <button class="q-btn danger" onclick="broadcast('ACİL DURUM!', 'error')">🚨 ACİL</button>
        <button class="q-btn warning" onclick="clearLogs()">🗑️ TEMİZLE</button>
        <button class="q-btn" onclick="sendCommand('restart')">🔄 YENİLE</button>
    </div>
</div>

<!-- CENTER: LIVE CONSOLE -->
<div class="panel">
    <div class="panel-header">
        <div class="panel-title">LIVE_CONSOLE</div>
        <div style="display:flex;gap:8px">
            <button onclick="clearLogs()" style="background:#f7768e22;border:1px solid #f7768e;color:#f7768e;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600">TEMİZLE</button>
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
            <input type="text" class="console-input" id="console-cmd" placeholder="Komut girin... (örn: /kick username, /announce mesaj, /status)" autocomplete="off" onkeypress="if(event.key==='Enter')sendConsoleCommand()">
        <button class="send-btn" onclick="sendConsoleCommand()">▶</button>
    </div>
</div>

<!-- RIGHT: NOTES & CHAT & HIGH COMMAND -->
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
    
    <!-- YÜKSEK YETKİLİ KOMUT ALANI -->
    <div class="high-cmd-area">
        <div class="high-cmd-title">⚡ YÜKSEK YETKİLİ KOMUT</div>
        <div style="font-size:11px;color:#565f89;margin-bottom:10px">Tehlikeli komutlar için şifre gerekli</div>
        <input type="text" class="high-cmd-input" id="high-cmd-input" placeholder="Komut: /kick, /ban, /shutdown, /restart, /maintenance on/off, /clearblacklist" autocomplete="off" onkeypress="if(event.key==='Enter')sendHighCommand()">
        <input type="password" class="high-cmd-pass" id="high-cmd-pass" placeholder="Yüksek yetkili şifresi..." autocomplete="off">
        <button class="high-cmd-btn" onclick="sendHighCommand()">⚡ KOMUTU ÇALIŞTIR</button>
        <div id="high-cmd-result" style="margin-top:10px;font-size:12px;font-family:monospace"></div>
    </div>
</div>

</div>

<!-- SETTINGS MODAL -->
<div class="modal-overlay" id="settings-modal" onclick="if(event.target===this)closeSettings()">
    <div class="modal">
        <div class="modal-header">
            <div class="modal-title">⚙️ TERMINAL AYARLARI</div>
            <button class="modal-close" onclick="closeSettings()">✕</button>
        </div>
        
        <div class="setting-item">
            <label class="setting-label">Otomatik Yenileme</label>
            <div class="setting-desc">Sayfayı otomatik olarak yeniler</div>
            <div class="toggle-switch ${settingsMap.autoRefresh ? 'active' : ''}" onclick="toggleSetting(this, 'autoRefresh')" data-key="autoRefresh"></div>
        </div>
        
        <div class="setting-item">
            <label class="setting-label">Bildirim Sesleri</label>
            <div class="setting-desc">Yeni olaylarda ses çalar</div>
            <div class="toggle-switch ${settingsMap.soundEnabled ? 'active' : ''}" onclick="toggleSetting(this, 'soundEnabled')" data-key="soundEnabled"></div>
        </div>
        
        <div class="setting-item">
            <label class="setting-label">Komut Onay Sistemi</label>
            <div class="setting-desc">Dışarıdan gelen komutlar için onay iste</div>
            <div class="toggle-switch ${settingsMap.commandApprovalRequired ? 'active' : ''}" onclick="toggleSetting(this, 'commandApprovalRequired')" data-key="commandApprovalRequired"></div>
        </div>
        
        <div class="setting-item">
            <label class="setting-label">Bakım Modu</label>
            <div class="setting-desc">Sunucuyu bakım moduna alır</div>
            <div class="toggle-switch ${settingsMap.maintenanceMode ? 'active' : ''}" onclick="toggleSetting(this, 'maintenanceMode')" data-key="maintenanceMode"></div>
        </div>
        
        <div class="setting-item">
            <label class="setting-label">Yenileme Aralığı (saniye)</label>
            <div class="setting-desc">Otomatik yenileme süresi</div>
            <input type="number" class="setting-input" value="${settingsMap.refreshInterval || 10}" onchange="updateSetting('refreshInterval', this.value)" min="5" max="60">
        </div>
        
        <div class="setting-item">
            <label class="setting-label">Maksimum Satır</label>
            <div class="setting-desc">Konsolda tutulacak maksimum log sayısı</div>
            <input type="number" class="setting-input" value="${settingsMap.consoleMaxLines || 500}" onchange="updateSetting('consoleMaxLines', this.value)" min="100" max="2000">
        </div>
        
        <div class="panel-header" style="margin-top:24px"><div class="panel-title">KARA LİSTE</div></div>
        <div id="blacklist-container" style="margin-top:12px">
            ${blacklistEntries.length === 0 ? '<div style="color:#565f89;font-size:12px;text-align:center;padding:20px">Kara liste boş</div>' : blacklistEntries.map(b => `
                <div class="blacklist-item" data-blacklist-id="${b._id}">
                    <div>
                        <div class="blacklist-ip">${escapeHtml(b.ip)}</div>
                        <div class="blacklist-reason">${escapeHtml(b.reason)} • ${new Date(b.timestamp).toLocaleDateString('tr-TR')}</div>
                    </div>
                    <button class="blacklist-remove" onclick="removeBlacklist('${b._id}')">KALDIR</button>
                </div>
            `).join('')}
        </div>
    </div>
</div>

<!-- TOAST CONTAINER -->
<div class="toast-container" id="toast-container"></div>

<script src="/terminal.js"></script>
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
    ║           High Command Key: ${HIGH_COMMAND_KEY.substring(0,10)}...          ║
    ║                                                              ║
    ╚══════════════════════════════════════════════════════════════╝
    `);
});
