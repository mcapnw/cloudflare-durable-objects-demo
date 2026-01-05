CREATE TABLE IF NOT EXISTS Users (
    id TEXT PRIMARY KEY,
    google_id TEXT,
    first_name TEXT,
    created_at INTEGER,
    dragon_kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    weapon TEXT DEFAULT NULL,
    face_index INTEGER DEFAULT 0,
    gender TEXT DEFAULT 'male',
    username TEXT DEFAULT NULL,
    coins INTEGER DEFAULT 0,
    inventory TEXT DEFAULT '[]',
    tutorial_complete INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS GameConfig (
    key TEXT PRIMARY KEY,
    value TEXT
);

INSERT OR IGNORE INTO GameConfig (key, value) VALUES ('version', '1.0.0');

