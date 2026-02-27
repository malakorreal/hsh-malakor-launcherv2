const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'settings.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Could not connect to database', err);
    } else {
        console.log('Connected to database');
    }
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        value TEXT
    )`);

    // Insert default settings if they don't exist
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('game_path', '')`);
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('server_address', '')`);
});

module.exports = {
    getSetting: (key) => {
        return new Promise((resolve, reject) => {
            db.get(`SELECT value FROM settings WHERE key = ?`, [key], (err, row) => {
                if (err) reject(err);
                resolve(row ? row.value : null);
            });
        });
    },
    setSetting: (key, value) => {
        return new Promise((resolve, reject) => {
            db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value], (err) => {
                if (err) reject(err);
                resolve();
            });
        });
    },
    close: () => {
        db.close();
    }
};
