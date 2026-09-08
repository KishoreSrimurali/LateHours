# Late Hours — Vercel-ready

## Deploy
1. Upload this folder to a GitHub repository.
2. Import the repository into Vercel.
3. Vercel will use `npm run build` and the `dist` output automatically.
4. In Vercel → Project Settings → Environment Variables, add:
   - `ANTHROPIC_API_KEY` = your Anthropic API key
5. Redeploy.

The browser calls `/api/listener`, so the Anthropic API key stays server-side.

## Local
```bash
npm install
npm run dev
```

## Important
This package makes the existing UI deployable. The human listener/matching backend is still not implemented in the supplied app: `REAL_LISTENERS` is intentionally empty. Authentication, accounts, sessions, moods, and other state are also currently held in React state and are not persistent across reloads.
