# Connector Hub v2

Dashboard integrata FattureInCloud + Float.

## Setup

```bash
npm install
npm run dev
```

Poi apri `http://localhost:3000`.

## Configurazione

Crea un file `.config.json` nella root del progetto:

```json
{
  "fic": {
    "accessToken": "YOUR_FIC_TOKEN",
    "companyId": "YOUR_COMPANY_ID"
  },
  "float": {
    "apiKey": "YOUR_FLOAT_API_KEY"
  }
}
```

## Bug fix in questa versione

1. **FIC fatturato**: l'adapter ora testa più endpoint e pagina tutti i documenti (non solo la prima pagina).
2. **Float time-off 404**: corretta l'URL da `/time-off` a `/timeoffs` (endpoint corretto Float v3). Se anche questo fallisce, le ferie vengono saltate silenziosamente (campo opzionale).

## Struttura

```
app/
  api/
    dashboard/   ← FIC + Float aggregati
    planning/    ← Float nativo (planning)
    commissions/ ← mappings + dismissed
    targets/     ← obiettivi
  dashboard/     ← main page
components/
  dashboard/
    PlanningDashboard.tsx
lib/
  adapters/
    fic-adapter.ts          ← FattureInCloud
    float-adapter.ts        ← Float (ore, assegnazioni)
    float-planning-adapter.ts ← Float (planning nativo)
  planning/
    planning-logic.ts
    types.ts
  commissions/
    commission-logic.ts
  dashboard/
    types.ts
```
