# Frontend

React app powered by Vite.

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.

The app uses React Router for client-side navigation. The landing, sign-in, and sign-up pages
are public; settings, dashboard, practice, and results routes use the sidebar layout and require
the demo session state. Submitting either auth form sets that state for the browser tab, and
signing out clears it. This frontend-only flow is for prototyping and does not provide real
authentication or protect backend data.
