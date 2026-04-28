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
        const secs = Math.floor(data.uptime % 60);
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
    if (log.user !== currentUser) {
        showToast('📥 Yeni log: ' + escapeHtml(log.user || 'SYSTEM'), 'info');
    }
});

socket.on('clear-logs', () => {
    if (consoleBox) {
        consoleBox.innerHTML = '<div style="color:#565f89;text-align:center;padding:40px;font-size:14px">🗑️ Konsol temizlendi</div>';
    }
    showToast('Konsol temizlendi', 'success');
});

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
        showToast('💬 ' + escapeHtml(data.author) + ': ' + escapeHtml(data.message), 'info');
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
// KOMUTLAR
// ═══════════════════════════════════════════════════════════════
socket.on('new-command', (cmd) => {
    const list = document.getElementById('command-list');
    if (!list) return;
    
    // "Komut kuyruğu boş" mesajını kaldır
    const emptyMsg = list.querySelector('[style*="Komut kuyruğu boş"]');
    if (emptyMsg) emptyMsg.remove();
    
    const div = document.createElement('div');
    div.className = 'cmd-item';
    div.setAttribute('data-cmd-id', cmd._id || cmd.id);
    div.style.animation = 'fadeIn 0.3s ease';
    div.innerHTML = `
        <div><span style="color:#7aa2f7">$</span> ${escapeHtml(cmd.command)} <span style="color:#565f89">— ${escapeHtml(cmd.issuedBy)}</span></div>
        <span class="cmd-status pending">PENDING</span>
    `;
    list.insertBefore(div, list.firstChild);
    
    showToast('⚡ Yeni komut: ' + escapeHtml(cmd.command), 'warning');
});

socket.on('update-command', (data) => {
    const el = document.querySelector('[data-cmd-id="' + data.id + '"] .cmd-status');
    if (el) {
        el.className = 'cmd-status ' + data.status;
        el.textContent = data.status.toUpperCase();
    }
});

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

function sendCommandFromInput() {
    const input = document.getElementById('cmd-input');
    if (!input || !input.value.trim()) return;
    sendCommand(input.value.trim());
    input.value = '';
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
    toast.innerHTML = `<div class="toast-text">${message}</div>`;
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
    
    // Enter tuşu desteği
    const cmdInput = document.getElementById('cmd-input');
    if (cmdInput) {
        cmdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendCommandFromInput();
        });
    }
    
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
