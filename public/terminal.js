// ═══════════════════════════════════════════════════════════════
// OXYGENFORGE ECLIPSE v6.0 — TERMINAL CLIENT
// Real-time Command Center Frontend
// ═══════════════════════════════════════════════════════════════

const socket = io();
const currentUser = document.querySelector('.agent')?.textContent?.trim() || 'AGENT';
let autoScroll = true;
let isInputFocused = false;

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
        const badge = document.getElementById('ping-badge');
        if (badge) badge.textContent = (Date.now() - start) + 'ms';
    });
}, 5000);

// Bağlantı durumu
socket.on('connect', () => {
    showToast('🟢 Sunucuya bağlanıldı', 'success');
});

socket.on('disconnect', () => {
    showToast('🔴 Bağlantı koptu! Yeniden bağlanılıyor...', 'error');
});

// ═══════════════════════════════════════════════════════════════
// SİSTEM METRİKLERİ
// ═══════════════════════════════════════════════════════════════
socket.on('system-metrics', (data) => {
    const cpuEl = document.getElementById('cpu-metric');
    const memEl = document.getElementById('mem-metric');
    const connEl = document.getElementById('conn-metric');
    const uptimeEl = document.getElementById('uptime-metric');
    
    if (cpuEl) {
        cpuEl.textContent = data.cpu + '%';
        cpuEl.className = 'metric-value' + (data.cpu > 80 ? ' danger' : data.cpu > 50 ? ' warning' : '');
    }
    if (memEl) memEl.textContent = data.memory + 'MB';
    if (connEl) connEl.textContent = data.connections;
    
    if (uptimeEl) {
        const hours = Math.floor(data.uptime / 3600);
        const mins = Math.floor((data.uptime % 3600) / 60);
        uptimeEl.textContent = hours + 'h ' + mins + 'm';
    }
});

// ═══════════════════════════════════════════════════════════════
// AJAN LİSTESİ
// ═══════════════════════════════════════════════════════════════
socket.on('agents-update', (agents) => {
    const list = document.getElementById('agent-list');
    if (!list) return;
    
    if (agents.length === 0) {
        list.innerHTML = '<div style="color:#565f89;font-size:12px;text-align:center;padding:20px">Bağlı ajan yok</div>';
        return;
    }
    
    list.innerHTML = agents.map(a => `
        <div class="agent-item">
            <div class="agent-dot ${a.status === 'away' ? 'away' : ''}"></div>
            <div>
                <div class="agent-name">${escapeHtml(a.username)}</div>
                <div class="agent-status">${a.status === 'away' ? 'Away' : 'Online'} • ${new Date(a.since).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</div>
            </div>
        </div>
    `).join('');
});

// ═══════════════════════════════════════════════════════════════
// İZİN SİSTEMİ — CONSOLE PERMISSION
// ═══════════════════════════════════════════════════════════════
socket.on('console-permission-request', (data) => {
    const queue = document.getElementById('perm-queue');
    if (!queue) return;
    
    // "Bekleyen izin isteği yok" mesajını kaldır
    const emptyMsg = queue.querySelector('[style*="Bekleyen izin isteği yok"]');
    if (emptyMsg) emptyMsg.remove();
    
    const div = document.createElement('div');
    div.className = 'perm-request';
    div.setAttribute('data-request-id', data.requestId);
    div.innerHTML = `
        <div class="perm-title">⚠️ İZİN İSTEĞİ</div>
        <div class="perm-cmd">${escapeHtml(data.command)}</div>
        <div style="font-size:11px;color:#565f89;margin-bottom:10px">Kaynak: ${escapeHtml(data.source)} • ${new Date(data.timestamp).toLocaleTimeString('tr-TR')}</div>
        <div class="perm-buttons">
            <button class="perm-btn approve" onclick="approveCommand('${data.requestId}', true)">✅ ONAYLA</button>
            <button class="perm-btn deny" onclick="approveCommand('${data.requestId}', false)">❌ REDDET</button>
        </div>
    `;
    queue.appendChild(div);
    
    showToast('⚠️ Yeni izin isteği!', 'warning');
});

function approveCommand(requestId, approved) {
    socket.emit('approve-console-command', { requestId, approved });
    const el = document.querySelector('[data-request-id="' + requestId + '"]');
    if (el) el.remove();
}

// ═══════════════════════════════════════════════════════════════
// KONSOL — GERÇEK ZAMANLI
// ═══════════════════════════════════════════════════════════════
const consoleBox = document.getElementById('console');

function addLogToConsole(log) {
    if (!consoleBox) return;
    
    // "Konsol boş" mesajını kaldır
    const emptyMsg = consoleBox.querySelector('[style*="Konsol hazır"]');
    if (emptyMsg) emptyMsg.remove();
    
    const entry = document.createElement('div');
    entry.className = 'log-entry log-type-' + (log.type || 'info');
    entry.style.animation = 'fadeIn 0.3s ease';
    entry.innerHTML = `
        <span class="log-time">${new Date(log.timestamp).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
        <span class="log-user">${escapeHtml(log.user || 'SYSTEM')}</span>
        <span class="log-content">${escapeHtml(log.content)}</span>
    `;
    consoleBox.appendChild(entry);
    
    if (autoScroll && !isInputFocused) {
        consoleBox.scrollTop = consoleBox.scrollHeight;
    }
    
    // Max 500 log tut
    while (consoleBox.children.length > 500) {
        consoleBox.removeChild(consoleBox.firstChild);
    }
}

socket.on('new-log', (log) => {
    addLogToConsole(log);
});

socket.on('clear-logs', () => {
    if (consoleBox) {
        consoleBox.innerHTML = '<div style="color:#565f89;text-align:center;padding:40px;font-size:14px">🗑️ Konsol temizlendi</div>';
    }
    showToast('Konsol temizlendi', 'success');
});

function sendConsoleCommand() {
    const input = document.getElementById('console-cmd');
    if (!input || !input.value.trim()) return;
    
    const cmd = input.value.trim();
    
    // Normal komutları direkt işle
    if (cmd.startsWith('/announce ')) {
        const msg = cmd.substring(10);
        socket.emit('chat-message', { author: 'SYSTEM', message: '[DUYURU] ' + msg });
        showToast('Duyuru yayınlandı', 'success');
    } else if (cmd === '/status') {
        addLogToConsole({ 
            type: 'system', 
            user: 'SYSTEM', 
            content: 'Sistem durumu: NORMAL | Bağlı ajan: ' + document.querySelectorAll('.agent-item').length, 
            timestamp: new Date() 
        });
    } else if (cmd === '/help') {
        addLogToConsole({ 
            type: 'system', 
            user: 'SYSTEM', 
            content: 'Komutlar: /announce, /status, /help, /clear | Yüksek yetkili: /kick, /ban, /shutdown, /restart', 
            timestamp: new Date() 
        });
    } else if (cmd === '/clear') {
        clearLogs();
    } else {
        // Bilinmeyen komut - log olarak kaydet
        addLogToConsole({ 
            type: 'warning', 
            user: currentUser, 
            content: 'Komut çalıştırıldı: ' + cmd, 
            timestamp: new Date() 
        });
    }
    
    input.value = '';
}

function toggleAutoScroll() {
    autoScroll = !autoScroll;
    const btn = document.getElementById('autoscroll-btn');
    if (btn) {
        btn.textContent = 'AUTO: ' + (autoScroll ? 'ON' : 'OFF');
        btn.style.borderColor = autoScroll ? '#9ece6a' : '#565f89';
        btn.style.color = autoScroll ? '#9ece6a' : '#565f89';
    }
}

// ═══════════════════════════════════════════════════════════════
// YÜKSEK YETKİLİ KOMUTLAR
// ═══════════════════════════════════════════════════════════════
function sendHighCommand() {
    const cmdInput = document.getElementById('high-cmd-input');
    const passInput = document.getElementById('high-cmd-pass');
    const resultDiv = document.getElementById('high-cmd-result');
    
    if (!cmdInput || !passInput) return;
    
    const command = cmdInput.value.trim();
    const password = passInput.value;
    
    if (!command) {
        if (resultDiv) resultDiv.innerHTML = '<span style="color:#f7768e">❌ Komut girin!</span>';
        return;
    }
    if (!password) {
        if (resultDiv) resultDiv.innerHTML = '<span style="color:#f7768e">❌ Şifre gerekli!</span>';
        return;
    }
    
    socket.emit('high-command', { command, password });
    
    if (resultDiv) resultDiv.innerHTML = '<span style="color:#e0af68">⏳ İşleniyor...</span>';
}

socket.on('high-command-result', (data) => {
    const resultDiv = document.getElementById('high-cmd-result');
    if (!resultDiv) return;
    
    if (data.success) {
        resultDiv.innerHTML = '<span style="color:#9ece6a">✅ ' + escapeHtml(data.result) + '</span>';
        document.getElementById('high-cmd-input').value = '';
        document.getElementById('high-cmd-pass').value = '';
    } else {
        resultDiv.innerHTML = '<span style="color:#f7768e">❌ ' + escapeHtml(data.error) + '</span>';
    }
    
    setTimeout(() => { resultDiv.innerHTML = ''; }, 5000);
});

// ═══════════════════════════════════════════════════════════════
// NOTLAR — GERÇEK ZAMANLI
// ═══════════════════════════════════════════════════════════════
const notesContainer = document.getElementById('notes-container');

function createNoteElement(note) {
    const div = document.createElement('div');
    div.className = 'note-item';
    div.style.borderLeftColor = note.color || '#7aa2f7';
    div.setAttribute('data-note-id', note._id || note.id);
    div.style.animation = 'slideIn 0.3s ease';
    div.innerHTML = `
        <button class="note-delete" onclick="deleteNote('${note._id || note.id}')">✕</button>
        <div class="note-header">
            <span class="note-author">${escapeHtml(note.author)}</span>
            <span class="note-time">${new Date(note.timestamp).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</span>
        </div>
        <div class="note-text">${escapeHtml(note.content)}</div>
    `;
    return div;
}

socket.on('new-note', (note) => {
    if (!notesContainer) return;
    
    // "Henüz not yok" mesajını kaldır
    const emptyMsg = notesContainer.querySelector('[style*="Henüz not yok"]');
    if (emptyMsg) emptyMsg.remove();
    
    notesContainer.insertBefore(createNoteElement(note), notesContainer.firstChild);
    
    if (note.author !== currentUser) {
        showToast('📝 ' + escapeHtml(note.author) + ' yeni not ekledi', 'success');
    }
});

socket.on('delete-note', (id) => {
    const el = document.querySelector('[data-note-id="' + id + '"]');
    if (el) {
        el.style.opacity = '0';
        el.style.transform = 'translateX(20px)';
        setTimeout(() => el.remove(), 300);
    }
});

async function addNote(e) {
    e.preventDefault();
    const input = document.getElementById('note-input');
    if (!input || !input.value.trim()) return;
    
    try {
        const res = await fetch('/api/note', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({note: input.value.trim()})
        });
        if (res.ok) {
            input.value = '';
        } else {
            showToast('❌ Not eklenemedi', 'error');
        }
    } catch(err) {
        showToast('❌ Bağlantı hatası', 'error');
    }
}

async function deleteNote(id) {
    if (!confirm('Not silinsin mi?')) return;
    try {
        const res = await fetch('/api/note/' + id, { method: 'DELETE' });
        if (!res.ok) showToast('❌ Silinemedi', 'error');
    } catch(err) {
        showToast('❌ Bağlantı hatası', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════
// CHAT — GERÇEK ZAMANLI
// ═══════════════════════════════════════════════════════════════
const chatBox = document.getElementById('chat-box');

function createChatElement(data) {
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (data.author === currentUser ? 'own' : '');
    div.innerHTML = `
        <div class="chat-author">${escapeHtml(data.author)}</div>
        <div class="chat-text">${escapeHtml(data.message)}</div>
        <div class="chat-time">${new Date(data.timestamp).toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'})}</div>
    `;
    return div;
}

socket.on('chat-message', (data) => {
    if (!chatBox) return;
    
    // "Sohbet başlatın" mesajını kaldır
    const emptyMsg = chatBox.querySelector('[style*="Sohbet başlatın"]');
    if (emptyMsg) emptyMsg.remove();
    
    chatBox.appendChild(createChatElement(data));
    chatBox.scrollTop = chatBox.scrollHeight;
    
    if (data.author !== currentUser) {
        showToast('💬 ' + escapeHtml(data.author) + ': ' + escapeHtml(data.message.substring(0, 30)) + (data.message.length > 30 ? '...' : ''), 'info');
    }
});

function sendChat(e) {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    if (!input || !input.value.trim()) return;
    
    socket.emit('chat-message', {
        author: currentUser,
        message: input.value.trim()
    });
    input.value = '';
}

// ═══════════════════════════════════════════════════════════════
// AYARLAR MODAL
// ═══════════════════════════════════════════════════════════════
function openSettings() {
    document.getElementById('settings-modal').classList.add('active');
}

function closeSettings() {
    document.getElementById('settings-modal').classList.remove('active');
}

function toggleSetting(el, key) {
    const isActive = el.classList.contains('active');
    el.classList.toggle('active');
    updateSetting(key, !isActive);
}

async function updateSetting(key, value) {
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({key, value})
        });
        if (res.ok) {
            showToast('✅ Ayar kaydedildi', 'success');
        } else {
            showToast('❌ Ayar kaydedilemedi', 'error');
        }
    } catch(err) {
        showToast('❌ Bağlantı hatası', 'error');
    }
}

async function removeBlacklist(id) {
    if (!confirm('Kara listeden kaldır?')) return;
    try {
        const res = await fetch('/api/blacklist/' + id, { method: 'DELETE' });
        if (res.ok) {
            const el = document.querySelector('[data-blacklist-id="' + id + '"]');
            if (el) el.remove();
            showToast('✅ Kara listeden kaldırıldı', 'success');
        } else {
            showToast('❌ İşlem başarısız', 'error');
        }
    } catch(err) {
        showToast('❌ Bağlantı hatası', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════
// BİLDİRİMLER (TOAST)
// ═══════════════════════════════════════════════════════════════
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.style.animation = 'toastIn 0.4s ease';
    toast.innerHTML = '<div class="toast-text">' + message + '</div>';
    container.appendChild(toast);
    
    // Max 5 toast tut
    while (container.children.length > 5) {
        container.removeChild(container.firstChild);
    }
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

socket.on('notification', (data) => {
    showToast(data.message, data.type || 'info');
});

// ═══════════════════════════════════════════════════════════════
// QUICK ACTIONS
// ═══════════════════════════════════════════════════════════════
async function broadcast(msg, type) {
    try {
        const res = await fetch('/api/broadcast', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({message: msg, type: type || 'info'})
        });
        if (!res.ok) showToast('❌ Bildirim gönderilemedi', 'error');
    } catch(err) {
        showToast('❌ Bağlantı hatası', 'error');
    }
}

async function clearLogs() {
    if (!confirm('Tüm logları temizle? Bu işlem geri alınamaz!')) return;
    try {
        const res = await fetch('/api/clear-logs', { method: 'POST' });
        if (!res.ok) showToast('❌ Loglar temizlenemedi', 'error');
    } catch(err) {
        showToast('❌ Bağlantı hatası', 'error');
    }
}

async function sendCommand(cmd) {
    try {
        const res = await fetch('/api/command', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({command: cmd})
        });
        if (!res.ok) showToast('❌ Komut gönderilemedi', 'error');
    } catch(err) {
        showToast('❌ Bağlantı hatası', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════
// YARDIMCI FONKSİYONLAR
// ═══════════════════════════════════════════════════════════════
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
// BAŞLANGIÇ AYARLARI
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    // Başlangıç scroll pozisyonları
    if (consoleBox) consoleBox.scrollTop = consoleBox.scrollHeight;
    if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
    
    // Input focus takibi
    document.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('focus', () => { isInputFocused = true; });
        inp.addEventListener('blur', () => { isInputFocused = false; });
    });
    
    // Başlangıç bildirimi
    setTimeout(() => {
        showToast('🛰️ OxygenForge Terminal v6.0 aktif', 'success');
    }, 500);
});

// Global hata yakalama
window.onerror = (msg, url, line) => {
    console.error('Terminal Error:', msg, url, line);
    showToast('⚠️ Bir hata oluştu, sayfayı yenileyin', 'warning');
    return false;
};
