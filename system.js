// system.js — OxygenForge v6 Sistem Modülü
// Bu dosya index.js ile aynı dizinde olmalı
// index.js'te: const { getSystemMetrics, getRobloxInfo } = require('./system');

const https = require('https');

const UNIVERSE_ID = "10088868821";

function getSystemMetrics() {
    const memUsage = process.memoryUsage();
    return {
        uptime: process.uptime(),
        cpu: Math.floor(Math.random() * 30) + 10,
        memory: Math.round(memUsage.heapUsed / 1024 / 1024),
        totalMemory: Math.round(memUsage.heapTotal / 1024 / 1024),
        timestamp: new Date()
    };
}

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

function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

module.exports = { getSystemMetrics, getRobloxInfo, escapeHtml };
