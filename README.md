# B&L Dashboard Backend

Express server that proxies Dialpad API calls for the B&L operations dashboard.

## Deploy

1. Fork or clone this repo to your GitHub account
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. Select this repo
4. In Railway → Variables tab, add: `DIALPAD_API_KEY=your_key_here`
5. Railway auto-builds and gives you a public URL

## Endpoints

- `GET /` — health check
- `GET /dialpad/calls?limit=50` — recent calls with AI data
- `GET /dialpad/calls/:id` — single call detail
- `GET /dialpad/stats` — today's aggregate stats

## Local dev

```
npm install
DIALPAD_API_KEY=your_key npm start
```
