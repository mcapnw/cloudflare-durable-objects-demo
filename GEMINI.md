# Antigravity Project 1

## Project Overview
**Antigravity Project 1** is a full-stack, real-time multiplayer 3D game built on the **Cloudflare** ecosystem. It features a persistent world where players can explore, interact, and battle in real-time.

### Core Stack
- **Framework:** HonoX (TypeScript) for full-stack logic.
- **Frontend:** React (UI) + Three.js (3D Rendering).
- **Backend:** Cloudflare Workers & Durable Objects (Game State & WebSocket Server).
- **Database:** Cloudflare D1 (User Data, Inventory, Leaderboards).
- **Authentication:** Google OAuth.

### Key Architecture
- **Durable Objects:** The `GameRoomDurableObject` acts as the authoritative server, handling:
    - Real-time player movement and state (via WebSockets).
    - Game loop (10Hz) for AI (Sheep, Dragon), physics (bullets), and world events.
    - WebSocket Hibernation for cost efficiency.
- **D1 Database:** Stores persistent user data (ID, name, inventory, coins).
- **Optimization:** Uses delta compression, binary encoding (planned/suggested), and client-side prediction to minimize bandwidth and latency.

## Directory Structure
- **`app/`**: Application source code.
    - **`durable_objects/`**: Contains `GameRoom.ts` (Game Logic).
    - **`routes/`**: HonoX file-based routing (API & UI).
    - **`islands/`**: Interactive client-side components (React).
    - **`client.ts`**: Client entry point.
    - **`server.ts`**: Server entry point.
- **`public/static/`**: Assets (3D models, textures, icons).
- **`wrangler.toml`**: Configuration for the main Pages application.
- **`wrangler-do.toml`**: Configuration for the Durable Object worker.

## Development & Deployment

### Prerequisites
- Node.js & npm
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare Account (for D1 & Durable Objects)

### Scripts
| Command | Description |
| :--- | :--- |
| `npm run dev` | Start local development server (Vite). |
| `npm run build` | Build the client and server for production. |
| `npm run deploy` | Build and deploy the main Pages application. |
| `npm run preview` | Preview the production build locally. |

### Deployment
This project consists of two parts that must be deployed separately:

1.  **Durable Object Worker (Server Logic):**
    ```bash
    npx wrangler deploy -c wrangler-do.toml
    ```

2.  **Web Application (Client & Routing):**
    ```bash
    npm run deploy
    ```

## Development Conventions
- **State Management:** Use Durable Objects for *active* game state (positions, health) and D1 for *persistent* player data (account info, inventory).
- **Real-time:** Use WebSockets for game communication. Adhere to the "Golden Rule" of minimizing messages (delta updates, interest management).
- **Styling:** CSS is located in `app/style.css`.
- **Typing:** Strict TypeScript usage is enforced.
