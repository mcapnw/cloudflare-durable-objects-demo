# Durable Objects Architecture

This project utilizes Cloudflare Durable Objects (DO) to manage the real-time state of the game world. Specifically, the `GameRoomDurableObject` acts as the authoritative server for a game instance.

## 1. Hibernation & Lifecycle
The Durable Object is designed for **cost efficiency** using the **WebSocket Hibernation API**.

- **Hibernation:** Instead of staying resident in memory and charging for active duration while waiting for messages, the DO uses `this.state.acceptWebSocket(server)`. This allows Cloudflare to evict the DO from memory when it is idle.
- **Persistence during Hibernation:** Player-specific metadata (like ID, position, and gender) is attached to the WebSocket using `serializeAttachment`. When a message arrives or a player reconnects, Cloudflare wakes up the DO and restores this attachment, allowing the DO to resume processing without losing context.
- **Activation:** The DO "wakes up" whenever a `webSocketMessage` is received or when the game loop is running.

## 2. Information Processing

### In-Memory State (Transient)
The following data is held in memory for high-performance access during the game loop:
- **Active Bullets:** An array of projecticles moving through the world, checked for collisions at 10Hz.
- **Pickups:** Active item drops (coins, weapons) currently on the ground.
- **Sheep AI:** The position, rotation, and "mood" (roaming vs. fleeing) of the sheep.
- **WebSocket Attachments:** Real-time coordinates and animation states of all connected players.

### Persisted State (Storage)
The DO uses `this.state.storage` to ensure the world remains consistent even if all players leave or the server restarts:
- **Dragon State:** Current health, death status, and the **Damage Map** (who has attacked it and how much damage they've dealt).
- **Farm Plots:** The growth stage, watering status, and timestamps for the 3x3 farm grid.
- **Player Locations:** When a player disconnects, their last known position and appearance settings are saved so they return to the same spot.

## 3. The Game Loop
The DO maintains a **10Hz heart-beat** (every 100ms) when at least one player is connected.

1. **AI Processing:** Calculates Dragon movement, target selection, and attack charging. Updates Sheep roaming or fleeing logic based on player proximity.
2. **Physics & Collisions:** Moves bullets and checks for hits against players (death) or the Dragon (damage).
3. **World Progression:** Advances the growth of crops in the farm plots based on real-time timestamps.
4. **Broadcast:** Aggregates all changes into a single `world_update` message sent to every connected client to ensure visual synchronization.

## 4. Authoritative Logic
The Durable Object is the "Source of Truth."
- It validates player actions (e.g., checking if a player has enough coins in the D1 Database before allowing a shop purchase).
- It determines "Last Hit" and loot distribution (e.g., ensuring all players in the damage map receive credit for a dragon kill).
- It communicates with the **D1 Database** for permanent account-level changes like total kills, coin balances, and inventory upgrades.
