# Deployment Instructions

## Durable Object Worker (Server)
To deploy the server-side logic (Durable Objects), run:
```bash
npx wrangler deploy -c wrangler-do.toml
```

## Web Application (Client)
To build and deploy the client-side application (Cloudflare Pages), run:
```bash
npm run deploy
```
