CREATE TABLE IF NOT EXISTS Users (
    id TEXT PRIMARY KEY,
    google_id TEXT,
    first_name TEXT,
    last_name TEXT,
    picture TEXT,
    email TEXT,
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

CREATE TABLE IF NOT EXISTS PlayerSessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    session_start INTEGER NOT NULL,
    session_end INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL,
    coins_start INTEGER DEFAULT 0,
    coins_end INTEGER DEFAULT 0,
    coins_earned INTEGER DEFAULT 0,
    plants_planted INTEGER DEFAULT 0,
    plants_watered INTEGER DEFAULT 0,
    plants_harvested INTEGER DEFAULT 0,
    dragon_kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    shots_fired INTEGER DEFAULT 0,
    items_purchased INTEGER DEFAULT 0,
    realm_joins INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES Users(id)
);

CREATE TABLE IF NOT EXISTS NewsPosts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    headline TEXT NOT NULL,
    summary TEXT,
    key_takeaways JSON,
    data_grid JSON,
    sources JSON,
    article_content TEXT,
    slug TEXT UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS PendingResearch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    interaction_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'failed'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
