# Lead Finder

Search Google Maps for business leads by zip code. Built with React + Firebase + Google Places API (New).

## Setup

### 1. Firebase Project
- Create a project at [Firebase Console](https://console.firebase.google.com)
- Enable **Authentication** → Email/Password sign-in
- Go to Project Settings → copy your web app config values

### 2. Google Places API
- In [Google Cloud Console](https://console.cloud.google.com), enable **Places API (New)**
- Create an API key and restrict it to Places API

### 3. Configure Environment

```bash
# Copy and fill in your Firebase config
cp frontend/.env.example frontend/.env
```

For the Cloud Function, set the Places API key:
```bash
firebase functions:config:set places.apikey="YOUR_GOOGLE_PLACES_API_KEY"
```

Or for local emulator testing, set it as an env var:
```bash
export GOOGLE_PLACES_API_KEY="YOUR_KEY"
```

### 4. Run Locally

```bash
# Terminal 1: Frontend
cd frontend && npm run dev

# Terminal 2: Firebase emulators (functions)
firebase emulators:start --only functions
```

Update `VITE_FUNCTIONS_URL` in `.env` to match your emulator URL (shown in emulator output).

### 5. Deploy

```bash
cd frontend && npm run build
firebase deploy
```

## Cost Estimate
Google Places Text Search Pro: $32/1,000 requests. Google gives $200/month free credit.
At light usage (a few hundred searches/month), you'll stay within the free tier.
