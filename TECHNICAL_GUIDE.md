# PharmaGuard Gujarat — Technical Foundations Guide
### For Hackathon Evaluation Preparation
### All 4 team members read this entirely. Role-specific sections are marked.

---

> **Legend:**
> 🔴 **ALL MUST KNOW** — Every team member must be able to answer this cold
> 🔵 **FRONTEND** — Frontend developers focus here
> 🟡 **BACKEND** — Backend developers focus here
> 💡 **Analogy** — Mental model to explain the concept quickly

---

# SECTION A: TECH STACK DEEP DIVE

---

## A1. React 19 + TypeScript

### What is React?

React is a JavaScript **library** (not framework) for building user interfaces. The core idea is this: instead of manually finding DOM elements and updating them (`document.getElementById('stock').innerText = newValue`), you describe **what the UI should look like for a given state**, and React figures out the minimum DOM changes needed to get there.

React works with a **component model** — every piece of UI is a function that takes inputs (called props) and returns JSX (HTML-like syntax that compiles to JavaScript). Components can hold local state (`useState`), respond to lifecycle events (`useEffect`), and compose together like LEGO bricks.

💡 *Analogy:* React is like a smart spreadsheet. You define the formulas (components + state), and when any input changes, only the affected cells (DOM nodes) recalculate automatically. You never manually update the spreadsheet.

### What is a Single-Page Application (SPA)?

Traditional websites load a new HTML file from the server every time you click a link. An SPA loads **one HTML file once**, then swaps out page content using JavaScript. Navigation feels instant because nothing is fetched from the server for page transitions — the browser already has all the code.

In this project, `index.html` has a single `<div id="root">`. React mounts inside it and takes over all rendering. When you navigate from Dashboard to Inventory, React Router swaps the component inside `<AppLayout>` — no server round-trip, no page flash.

The tradeoff: the initial load is heavier (the whole JavaScript bundle downloads upfront), but subsequent navigation is milliseconds.

### What does "concurrent features enabled" mean?

React 19 uses the **concurrent renderer** by default. The old React renderer was synchronous — once it started re-rendering, nothing could interrupt it. The concurrent renderer can **pause, abort, and restart renders**. This enables:
- `Suspense` — show a fallback while data loads
- `useTransition` — mark state updates as non-urgent so the UI stays responsive
- `startTransition` — same concept, imperative form

In this project, the React 19 upgrade means these APIs are available even though not all are used explicitly. The benefit is the UI never freezes during heavy renders (like the Forecast page loading predictions for 20 drugs).

### Why TypeScript over JavaScript?

TypeScript adds a **type system on top of JavaScript**. Types are erased at runtime — the browser only runs JavaScript. TypeScript's value is **during development**: it catches errors before the code runs.

In this project, TypeScript catches things like:
- Passing `drug.currentStock` (a `number`) to a function expecting a `string`
- Accessing `user.role` when `user` might be `null`
- Spelling `dispensedBy` wrong in a Firestore write

The `types/index.ts` file defines `Drug`, `Batch`, `DispenseLog`, `Alert`, `UserProfile` — these are contracts. Every component that touches these objects gets compile-time guarantees about their shape.

### What does strict mode do?

In `tsconfig.app.json`, `"strict": true` enables a collection of compiler flags. The critical ones:
- **`strictNullChecks`** — `null` and `undefined` are not assignable to other types. You can't do `const name: string = user.name` if `user` might be null. You must write `user?.name ?? ''`.
- **`noImplicitAny`** — Variables must have an explicit or inferred type. No silent `any`.
- **`noUnusedLocals` / `noUnusedParameters`** — Compiler errors for dead code.

`StrictMode` in React (`<StrictMode>` in `main.tsx`) is a different thing — it's a **runtime** tool that double-invokes render functions and effects in development to surface side-effect bugs. It has zero impact on production.

### What does ES2023 target mean?

The `"target": "ES2023"` in `tsconfig.app.json` tells TypeScript what JavaScript version to compile down to. ES2023 supports modern features like `Array.prototype.findLast()`, `Object.hasOwn()`, top-level `await`, etc. Since the app targets modern browsers only (no IE11), there's no need to compile down to ES5 — the output stays readable and smaller.

🔴 **Judge question:** *What is a SPA and what's the tradeoff vs traditional websites?*
**Strong answer:** "A SPA loads one HTML file once and uses JavaScript to swap content for navigation. Advantage: navigation is instant since no server round-trips. Tradeoff: larger initial JavaScript bundle, and you need a special rewrite rule on the hosting server — if someone goes directly to `/forecast` in their browser, the server must return `index.html` instead of a 404, because `/forecast` doesn't exist as a real file."

---

## A2. Vite 8

### What is Vite?

Vite is a **build tool and development server**. During development, it serves your source files directly to the browser using native **ES modules** — no bundling step. The browser imports files one by one via HTTP. This is why Vite starts in milliseconds regardless of project size.

For production, Vite uses **Rollup** under the hood to bundle everything into optimized static files in `dist/`.

### What is HMR and why does 200ms matter?

**Hot Module Replacement** is the ability to replace a module in the browser **without a full page reload**. When you save a React component, Vite:
1. Detects the file change
2. Sends only the changed module to the browser via WebSocket
3. React's Fast Refresh replaces just that component in memory
4. State is preserved — no reset

The 200ms figure represents how fast Vite's HMR is. Webpack-based setups (like Create React App) could take 3-8 seconds for the same operation because they re-bundle everything first. At 200ms, feedback is perceived as instant — this directly impacts developer productivity over 8+ hours of a hackathon.

### How is Vite different from Webpack?

| Aspect | Webpack | Vite |
|---|---|---|
| Dev server | Bundles everything first, then serves | Serves native ESM directly, no bundle |
| Dev startup | Slow (seconds to minutes on large apps) | Instant (milliseconds) |
| HMR | Re-bundles affected chunks | Replaces individual modules |
| Production build | Webpack bundler | Rollup bundler |
| Config complexity | Notoriously complex | Minimal (ours is 8 lines) |

### What does `npm run build` do?

Looking at `package.json`: `"build": "tsc -b && vite build"`

It runs **two sequential commands**:
1. `tsc -b` — TypeScript compiler checks all types. If any type error exists, the build **fails here**. This is intentional — you cannot deploy broken code.
2. `vite build` — Rollup bundles the application: transpiles TypeScript/JSX → JavaScript, tree-shakes unused code, minifies, splits code into chunks, and writes output to `dist/`.

### What goes into the `dist/` folder?

```
dist/
├── index.html                     ← The single HTML file (3KB)
├── assets/
│   ├── index-Xk3p9a2m.js         ← Main JavaScript bundle (~500KB minified)
│   ├── vendor-Ab7cQz1p.js        ← Third-party libraries chunk
│   └── index-Qr8mN2xL.css       ← All CSS (Tailwind utilities)
```

The cryptic hash in filenames (`Xk3p9a2m`) changes whenever the file content changes. This enables **cache busting** — browsers cache aggressively, but a new hash means the browser downloads the new file instead of using its stale cache.

🔴 **Judge question:** *Why can't you just use `npm run dev` output for production?*
**Strong answer:** "The dev server serves unoptimized, unbundled files meant for debugging — they're 10x larger, have source maps exposed, and the server itself (Vite's dev server) is not production-grade. `npm run build` produces optimized, minified, hashed static files that any static host (Firebase Hosting) can serve at scale."

---

## A3. React Router 7

### What is client-side routing?

In a traditional website, clicking a link causes the browser to make a new HTTP request to the server, which responds with a new HTML page. Everything resets — JavaScript state, scroll position, loading spinners.

In React Router, clicking a link **never leaves the page**. `<Link to="/inventory">` intercepts the click, updates the browser URL bar using the History API (`window.history.pushState`), and React Router renders the matching component. The server is never involved.

### How does it differ from server-side routing?

| | Server-side (traditional) | Client-side (React Router) |
|---|---|---|
| URL change | New HTTP request | JS updates URL via History API |
| Page load | Full HTML reload | Component swap in memory |
| State | Resets | Preserved |
| Server needed | Yes, for every navigation | No, only for initial load |
| SEO | Good (pages exist on server) | Needs extra work (SSR/prerender) |

### What is a SPA rewrite rule and why does Firebase Hosting need it?

When you type `https://pharmaguard.web.app/forecast` in your browser bar and hit Enter, the browser makes an HTTP `GET` request to the server for the path `/forecast`. Firebase Hosting would look for a file called `forecast` in the `dist/` folder. That file doesn't exist — only `index.html` exists. Without a rewrite rule, you'd get a **404 error**.

The `firebase.json` rewrite rule:
```json
{ "source": "**", "destination": "/index.html" }
```
tells Firebase: "For any URL that doesn't match a real file, return `index.html`." Then React Router reads the URL in the browser and renders the correct page component.

🔴 **Judge question:** *What happens when someone types `/forecast` directly into the URL bar on the deployed app?*
**Strong answer:** "The browser makes a GET request to Firebase Hosting for `/forecast`. Firebase sees there's no file at that path, checks its rewrite rules, and responds with `index.html` — the SPA shell. React Router parses the URL, sees `/forecast`, and renders the `ForecastPage` component. Without that rewrite rule in `firebase.json`, the user would get a 404."

---

## A4. Tailwind CSS 4

### What is utility-first CSS?

Traditional CSS: you write a class name like `.card`, then go to a CSS file and write properties for it.
Tailwind: you apply pre-built single-purpose classes directly in HTML/JSX: `className="p-4 bg-white rounded-xl border-2 shadow-sm hover:shadow-md"`.

Each class does exactly one thing. `p-4` = `padding: 1rem`. `rounded-xl` = `border-radius: 0.75rem`. The stylesheet ships with thousands of such utilities, and Tailwind's build process removes all classes you don't use (called **purging**).

### What is `@custom-variant` and how does dark mode work?

In `src/index.css`:
```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
```

This is Tailwind CSS v4 syntax. It defines a custom variant called `dark` that activates when the element **or any of its ancestors** has the CSS class `dark`.

In `ThemeContext.tsx`, toggling dark mode adds/removes the `dark` class on `document.documentElement` (the `<html>` element). Since every element in the page is a descendant of `<html>`, they all match `dark *`, and all Tailwind `dark:` classes activate.

### Class-based vs media-query dark mode

**Media-query dark mode**: `@media (prefers-color-scheme: dark)` — the browser automatically detects OS dark mode. The user can't override it from within the app.

**Class-based dark mode** (what this project uses): The app explicitly adds a `dark` class to `<html>`. Full control — the user can toggle dark mode regardless of their OS setting. Preference stored in `localStorage`.

🔵 **Judge question:** *How does clicking the dark mode toggle in the sidebar actually change the UI?*
**Strong answer:** "The toggle calls `toggleTheme()` from `ThemeContext`. This flips the `isDark` state, saves it to `localStorage` as `pharmaguard-theme`, and adds or removes the `dark` class on `document.documentElement`. Because our Tailwind `@custom-variant` activates all `dark:` prefixed classes whenever an ancestor has the `dark` class, every component in the app reacts instantly — no reload needed."

---

## A5. Chart.js + react-chartjs-2

### Why a wrapper library?

Chart.js is a vanilla JavaScript library that draws charts on HTML `<canvas>` elements. It's not React-aware — it manages the canvas DOM imperatively.

`react-chartjs-2` is a thin React wrapper that creates a `<canvas>` element using a `ref`, instantiates a Chart.js chart on mount, calls `chart.update()` when props change, and calls `chart.destroy()` on unmount. The wrapper makes Chart.js behave like a React component: pass `data` and `options` as props, and the chart re-renders automatically.

### What does `responsive: true` and `maintainAspectRatio: false` do?

`responsive: true` — The chart resizes when its container resizes via `ResizeObserver`.

`maintainAspectRatio: false` — Disables the default 2:1 width-to-height ratio. The chart fills 100% of its container's height. With `className="h-72"` on the container, the chart fills exactly 288px.

🔵 **Judge question:** *Why do we use `key={selectedId}` on the hero chart in the Forecast page?*
**Strong answer:** "When the user selects a different drug, the chart's data structure changes completely. Adding `key={selectedId}` forces React to unmount the old chart component and mount a fresh one when the selected drug changes. It's a deliberate 'reset' to avoid Chart.js rendering glitches when the data structure changes significantly."

---

## A6. jsPDF

### What is coordinate-based PDF generation?

PDFs use a coordinate system where (0, 0) is the top-left corner, measured in millimeters:
```javascript
doc.text('PharmaGuard Report', 10, 20)  // text at x=10mm, y=20mm
doc.line(10, 25, 200, 25)               // horizontal line
doc.rect(10, 30, 190, 10)               // rectangle
```

### How is it different from alternatives?

| Approach | How it works | Pros | Cons |
|---|---|---|---|
| `jsPDF` (this project) | JS draws PDF primitives | Fast, no server, full control | Must code every layout manually |
| `html2pdf` | Screenshots HTML as image in PDF | Easy | Poor quality, huge file size |
| Server-side (Puppeteer) | Server renders HTML to PDF | Perfect fidelity | Requires server infrastructure |

### Why is client-side PDF generation an advantage?

No server needed, works offline, instantaneous, zero cost. The PDF is generated entirely in the browser.

🔵 **Judge question:** *Why doesn't the PDF show the ₹ symbol?*
**Strong answer:** "The standard fonts bundled with jsPDF don't include the ₹ Unicode character. Rather than embedding a custom font (which increases bundle size), we substitute `Rs.` which renders correctly with the default font. The UI uses ₹ throughout — only the PDF uses Rs. because of a font limitation."

---

## A7. date-fns

### What is `parseISO`?

`parseISO('2026-03-21')` converts an ISO 8601 string into a JavaScript `Date` object consistently. `new Date('2026-03-21')` is parsed as UTC midnight, so in IST (UTC+5:30) it displays as March 20, 11:30 PM — the wrong day.

### Why are timestamps stored as ISO strings instead of Firestore Timestamp objects?

1. **Simplicity** — Strings work with every JavaScript date utility directly.
2. **Serialization** — ISO strings survive JSON serialization unchanged.
3. **ML Backend compatibility** — The Flask backend does `datetime.strptime(entry["date"], "%Y-%m-%d")`. Firestore Timestamps would need conversion first.

🔵 **Judge question:** *If I call `new Date()` on an ISO date string from Firestore, what could go wrong?*
**Strong answer:** "Timezone issues. `new Date('2025-10-15')` treats the date as UTC midnight, so in IST it becomes October 14 at 6:30 PM — a different day. date-fns's `parseISO` handles this consistently."

---

## A8. Lucide React

### What is tree-shaking and why does it matter?

Tree-shaking removes unused code from the final bundle. Lucide React exports each icon as an individual named export:
```typescript
import { Package, AlertTriangle, TrendingUp } from 'lucide-react';
```
Only those 3 icons' code ends up in the bundle. Lucide has 1000+ icons — named imports mean the final bundle includes ~8KB of icon code instead of 800KB+.

🔵 **Judge question:** *Why do we import `{ Package }` from lucide-react instead of the whole library?*
**Strong answer:** "Named imports enable tree-shaking. The production build only includes the icon code we actually import. If we imported everything, the bundle would be massively bloated."

---

## A9. Firebase SDK v12 (Modular)

### What does "modular" mean?

Firebase SDK v9+ uses a **modular (functional) API** instead of the old namespace-based API:
```javascript
// Old "compat" API
firebase.firestore().collection('drugs').get()

// New modular API (tree-shakeable)
import { getFirestore, collection, getDocs } from 'firebase/firestore';
getDocs(collection(getFirestore(), 'drugs'))
```

With the modular API, only the functions you import end up in the bundle. A project using only Firestore and Auth doesn't pay the bundle cost of Firebase Storage, Remote Config, Analytics, etc.

🔴 **Judge question:** *Why is the Firebase config object (with the API key) safe to put in frontend code?*
**Strong answer:** "The Firebase API key is not a secret like an AWS access key. It's a public identifier that tells Firebase which project to connect to. Security is enforced by Firestore Security Rules on the server side — Rules determine what authenticated or unauthenticated users can read and write. The API key alone cannot bypass Security Rules. Every Firebase app exposes its config in the browser; that's by design."

---

## A10. State Management: useState + Context

### Why no Redux or Zustand?

This project has exactly **two pieces of global state**: the current user's profile (auth), and the dark mode toggle (theme). Both are handled with React Context:
- `AuthContext` — provides `user`, `profile`, `signIn`, `signOut`
- `ThemeContext` — provides `isDark`, `toggleTheme`

Everything else is **local state** in each page component, loaded from Firestore on mount.

### What is React Context?

Context passes data through the component tree **without prop drilling**. A `Provider` wraps the component tree and makes a value available. Any descendant calls `useContext()` to access it.

```
App
├── AuthProvider (provides user, profile, signIn, signOut)
│   └── ThemeProvider (provides isDark, toggleTheme)
│       └── BrowserRouter
│           └── Routes
│               └── DashboardPage (calls useAuth(), useTheme())
```

🔴 **Judge question:** *How does `useAuth()` work? Trace from the import to where the data comes from.*
**Strong answer:** "The `hooks/useAuth.ts` file re-exports `useAuthContext` from `AuthContext.tsx`. `AuthContext.tsx` creates a React Context with `createContext()`. The `AuthProvider` wraps the entire app, runs `onAuthStateChanged()` in a `useEffect`, and updates its local state (`user`, `profile`). It passes all of this as the Context value. Any component that calls `useAuth()` reads from the same single source of truth."

---

# SECTION B: ARCHITECTURE DEEP DIVE

---

## B1. The Three-Process Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ PROCESS 1: React Frontend (Browser)                         │
│ Vite dev server :5173 (dev) / Firebase Hosting (prod)      │
└───────────────────────┬─────────────────────────────────────┘
                        │
           ┌────────────┴────────────┐
           ▼                         ▼
┌──────────────────┐    ┌────────────────────────────────────┐
│ PROCESS 2:       │    │ PROCESS 3:                         │
│ Firebase         │    │ Flask ML Backend                   │
│ (Google's Cloud) │    │ localhost:5000 (dev)               │
│ Firestore + Auth │    │ pharmguard-ml.onrender.com (prod)  │
└──────────────────┘    └────────────────────────────────────┘
```

**Data flow — READ:** `onSnapshot` → Firebase SDK opens WebSocket → Firestore sends snapshot → React state updates → re-render

**Data flow — WRITE:** `writeBatch.commit()` → Firestore applies atomically → `onSnapshot` listener receives diff → UI updates

**Data flow — PREDICTION:** `getDocs` fetches history → `fetch()` POST to Flask → `LinearRegression.fit()` → JSON predictions → charts rendered

🔴 **Judge question:** *Why split ML into a separate backend instead of TensorFlow.js in the browser?*
**Strong answer:** "scikit-learn is Python-only — it doesn't run in the browser. More importantly, keeping ML server-side means we can swap algorithms (LinearRegression → Prophet → ARIMA) without touching the frontend. The API contract stays the same — the frontend just calls `/api/predict-all` and doesn't care what model runs inside."

---

## B2. Serverless Pattern

The traditional architecture is Browser → backend server → database. Firebase enables Browser → Firebase (which IS the server + database). No custom backend between frontend and database.

Security is enforced through **Firestore Security Rules** — server-side rules running on Firebase's infrastructure that check auth state, user role, and data validity.

| Aspect | Serverless (Firebase) | Traditional (custom backend) |
|---|---|---|
| Dev speed | Very fast | Slower (build API endpoints) |
| Infrastructure | Zero | Need to deploy and maintain |
| Business logic | Runs in browser (visible) | Hidden in server code |
| Scaling | Automatic | Manual configuration |
| Vendor lock-in | High | Low |

🔴 **Judge question:** *What's the security risk of having the Firebase config in the frontend code?*
**Strong answer:** "The config is public by design — it just identifies the Firebase project. Security enforcement is in Firestore Security Rules on Firebase's servers. Even with the config, you can only read/write data that the Security Rules allow for your authentication state."

---

## B3. Real-time Data Flow

### `onSnapshot()` vs `getDocs()`

`onSnapshot()` — establishes a **persistent WebSocket connection** to Firestore. Fires immediately with current data, then fires again on every change. Returns an unsubscribe function that MUST be called on component unmount.

`getDocs()` — **one-time read**. Fetches data once and closes.

Firestore sends **diffs** (deltas), not full re-downloads. The SDK maintains a local cache and merges incoming diffs.

```typescript
useEffect(() => {
  const unsub = onSnapshot(collection(db, 'drugs'), ...);
  return () => unsub(); // Critical: prevents memory leaks
}, []);
```

### Where `onSnapshot` is used

| Page | Collection | Why real-time? |
|---|---|---|
| Dashboard | `drugs`, `dispenseLogs`, `alerts` | Live stats, recent activity |
| Inventory | `drugs` | Stock changes visible instantly |
| Alerts | `alerts` | New alerts appear without refresh |
| Dispense | `drugs` | Available stock stays current |

🔴 **Judge question:** *What's the difference between `getDocs` and `onSnapshot`, and when do you use each?*
**Strong answer:** "`getDocs` is a one-time read — fetch once, done. `onSnapshot` is a subscription — fires immediately with current data, then fires again every time matching data changes. Use `getDocs` for batch computations (Forecast reads history once for ML). Use `onSnapshot` when UI must stay current with live activity (Dashboard, Alerts)."

---

## B4. The Hybrid Data Fetching Strategy

| Page | Strategy | Why |
|---|---|---|
| Dashboard | `onSnapshot` everywhere | Live stats must update instantly |
| Inventory | `onSnapshot` for drugs, `getDocs` for batches | Drugs need live stock; batches loaded on-demand |
| Dispense | `getDocs` for both | Transactional workflow needs stable data |
| Forecast | `getDocs` then `fetch()` | Batch ML computation, not real-time |
| Alerts | `onSnapshot` | New alerts must appear automatically |

🔴 **Judge question:** *Why does the Forecast page use `getDocs` instead of `onSnapshot`?*
**Strong answer:** "Forecast is a batch computation. If we used `onSnapshot`, every new dispense event would trigger a new ML prediction request — wasteful and could overwhelm the Flask backend. `getDocs` gives a stable snapshot of 6 months of historical data to compute against."

---

## B5. Atomic Operations

### `writeBatch()`

Groups multiple Firestore writes into one atomic unit — either ALL succeed or ALL fail.

```typescript
const batch = writeBatch(db);
batch.update(batchRef, { quantity: increment(-quantityDispensed) });
batch.set(logRef, dispenseLogData);
await batch.commit(); // Both writes happen together
```

### `increment()` and the race condition it prevents

**Without `increment()`:**
- Pharmacist A reads stock = 200, dispenses 50, writes 150
- Pharmacist B reads stock = 200, dispenses 30, writes 170 — OVERWRITES A's write
- Result: 170 (wrong, should be 120)

**With `increment(-50)`:**
- Firestore applies A's delta server-side → 150
- Firestore applies B's delta server-side → 120
- Result: 120 (correct)

The computation happens on Firestore's server, not in the browser. Operations serialize correctly regardless of concurrency.

🔴 **Judge question:** *What would happen without `increment()`?*
**Strong answer:** "Race condition. Two concurrent dispenses both read the same stock value, both write their own reduced value, and whichever writes last wins — erasing the other's operation. This creates phantom inventory: drugs dispensed but not properly deducted. In a pharmacy, this could mean dispensing more medication than physically exists."

---

## B6. Role-Based Access Control

**Authentication** = proving who you are | **Authorization** = what you're allowed to do

### The Full Flow

1. **Login** → Firebase Auth issues JWT, stored in IndexedDB
2. **Auth state** → `onAuthStateChanged()` fires → `getDoc(users/{uid})` fetches role
3. **Route protection** → `ProtectedRoute` checks `allowedRoles` → renders Access Denied if no match
4. **Sidebar filtering** → nav items filtered by `profile.role` (UI layer only)

**Role matrix:**

| Feature | pharmacist | manager | admin |
|---|---|---|---|
| Dashboard, Inventory, Alerts, Heatmap | ✅ | ✅ | ✅ |
| Dispense | ✅ | ❌ | ✅ |
| Forecast, Waste Calc | ❌ | ✅ | ✅ |
| Report | ❌ | ❌ | ✅ |

🔴 **Judge question:** *If a pharmacist types `/report` directly in the URL bar, what happens?*
**Strong answer:** "Firebase Hosting returns `index.html` (SPA rewrite). React Router renders the route. `ProtectedRoute` checks `allowedRoles: ['admin']`. The pharmacist's role doesn't match. `ProtectedRoute` renders an access denied screen — `ReportPage` never mounts, no Firestore reads happen."

---

# SECTION C: DEPLOYMENT DEEP DIVE

---

## C1. Firebase Hosting

Static hosting serves files exactly as they are — no server-side computation per request. Firebase Hosting puts `dist/` files on CDN nodes worldwide. A user in Mumbai gets files from a nearby CDN node.

**`firebase.json`:**
```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
}
```

- `"public": "dist"` → upload only the `dist/` folder
- `"rewrites"` → the SPA rule: any URL without a matching file → return `index.html`

🔴 **Judge question:** *What's the difference between `.firebaserc` and `firebase.json`?*
**Strong answer:** "`.firebaserc` links the project to Firebase project ID `void-pointers-aetrix-2026` — it says WHERE to deploy. `firebase.json` is the hosting configuration — it says HOW: what to serve, what to ignore, and the SPA routing rules."

---

## C2. Render.com

**Web service** (Flask backend) vs **static site** (Firebase Hosting): a web service executes code per request; a static site just serves files.

**Gunicorn** is the production-grade WSGI server. Flask's built-in server handles one request at a time — not production-ready. Gunicorn starts multiple worker processes for concurrent requests.

```
gunicorn app:app --bind 0.0.0.0:$PORT
```
= "Import `app` from `app.py`, serve on all interfaces at Render's assigned port."

**PORT env var:** Render dynamically assigns ports. `os.environ.get('PORT', 5000)` reads it.

**Cold starts:** Free tier spins down after 15 minutes of inactivity. Restart takes 30-60 seconds. Wake up `/api/health` before demos.

🟡 **Judge question:** *What happens if `gunicorn` isn't in `requirements.txt`?*
**Strong answer:** "`pip install` succeeds but then Render runs `gunicorn app:app` and gets 'command not found'. Service fails to start, deployment marked failed, frontend shows backend offline. Gunicorn must be in `requirements.txt` even though it's infrastructure, not application code."

---

## C3. Environment Variables

| File | Used when | Value |
|---|---|---|
| `.env` | `npm run dev` | `VITE_API_URL=http://localhost:5000` |
| `.env.production` | `npm run build` | `VITE_API_URL=https://pharmguard-ml.onrender.com` |

Variables must be prefixed with `VITE_` to be accessible in browser code.

At build time, Vite **statically replaces** `import.meta.env.VITE_API_URL` with the literal URL string. The value is baked into the JavaScript bundle — there's no `.env` file on Firebase Hosting at runtime.

🔴 **Judge question:** *If you change `.env.production` after `npm run build`, does the deployed app reflect the change?*
**Strong answer:** "No. The URL is hardcoded in `dist/assets/index-[hash].js` at build time. You must run `npm run build` again and `firebase deploy` to upload the new bundle."

---

## C4. The Build Process

`npm run build` = `tsc -b && vite build`

1. **`tsc -b`** — TypeScript type check. Build fails here if any type error exists.
2. **Rollup bundling:**
   - Resolution → dependency graph
   - Tree-shaking → remove dead code
   - Transpilation → TypeScript/JSX → JavaScript
   - Code-splitting → vendor chunk (React, Firebase) cached separately
   - Minification → ~70% size reduction
   - Hashing → content-based filenames for cache busting
   - Output → `dist/`

---

## C5. CORS in Production

**CORS** (Cross-Origin Resource Sharing) is a browser security mechanism. When `pharmaguard.web.app` makes a `fetch()` to `pharmguard-ml.onrender.com`, the browser checks if the server allows it. CORS is browser-only — `curl` ignores it.

**Preflight:** POST requests with `Content-Type: application/json` trigger an OPTIONS request first. `flask-cors` handles this automatically.

`CORS(app, origins="*")` — any origin can call the API. Acceptable for a stateless ML inference endpoint with no sensitive data. Production would restrict to `origins=["https://pharmaguard.web.app"]`.

🟡 **Judge question:** *With `origins="*"`, can any attacker call your API?*
**Strong answer:** "Yes, but our Flask API only runs ML predictions on data you provide — no database, no auth, no sensitive output. The worst an attacker could do is send fake drug histories and get useless predictions. For a stateless ML inference endpoint, `origins='*'` is an acceptable hackathon tradeoff."

---

# SECTION D: DATA MODEL DEEP DIVE

---

## D1. Collection: `users/{uid}`

```
uid:   "abc123uid"
name:  "Dr. Mehta"
email: "mehta@hospital.guj.in"
role:  "admin"              // 'pharmacist' | 'manager' | 'admin'
```

**Read:** `getDoc(doc(db, 'users', uid))` — once per login in `AuthContext`
**Write:** `setDoc` on signup / first sign-in

**Trade-off:** Role stored in Firestore, not Firebase Auth custom claims. Requires one extra read per login session.

🔴 **Judge question:** *Could a user change their own role?*
**Strong answer:** "Yes, if Firestore Security Rules don't prevent it. A proper rule allows users to update their own document but never the role field. Without this rule, a clever user could `updateDoc` their document and promote themselves to admin."

---

## D2. Collection: `drugs/{drugId}`

```
id:           "drug_01"
name:         "Paracetamol 500mg"
category:     "Analgesic"
unit:         "tablets"
reorderLevel: 500
currentStock: 1250    // DENORMALIZED — sum of batch quantities
```

`currentStock` is denormalized for fast reads. Without it, showing stock for 20 drugs requires 60-100 batch reads. The Dispense page keeps it in sync via `increment()`.

**Read:** `onSnapshot` in Dashboard, Inventory, Dispense | `getDocs` in Forecast, Heatmap, Waste, Report
**Write:** `addDoc` (add) | `updateDoc` (edit) | `writeBatch + increment` (Dispense)

🔴 **Judge question:** *Why store `currentStock` on the drug document?*
**Strong answer:** "Performance — 20 drug documents vs 60-100 batch reads for the same Inventory page load. The tradeoff is keeping it in sync with `increment()` on every dispense."

---

## D3. Collection: `batches/{batchId}`

```
drugId:      "drug_01"
batchNumber: "BTH-2025-0001"
quantity:    250
expiryDate:  "2026-04-07"    // ISO date string
receivedDate:"2025-12-21"    // ISO date string
costPerUnit: 0.50            // INR per unit
```

**Flat collection** (not subcollection under drugs) so a single `getDocs(collection(db, 'batches'))` gets all batches across all drugs — needed by Heatmap, Waste, Report.

`costPerUnit` is per-batch because procurement cost varies between batches of the same drug.

**Read:** `getDocs` with `where('drugId', '==', id)` | `getDocs(collection)` for full reads
**Write:** `addDoc` | `updateDoc` | `writeBatch.update + increment` (Dispense)

🔴 **Judge question:** *Why is `costPerUnit` on the batch, not the drug?*
**Strong answer:** "The same drug can cost different amounts across procurement batches due to price changes. Per-batch storage gives accurate financial tracking for the Heatmap value-at-risk and Report total inventory value calculations."

---

## D4. Collection: `dispenseLogs/{logId}`

```
drugId:      "drug_01"
drugName:    "Paracetamol 500mg"   // DENORMALIZED
batchId:     "batch_abc"
batchNumber: "BTH-2025-0001"       // DENORMALIZED
quantity:    45
dispensedBy: "Dr. Patel"           // DENORMALIZED
timestamp:   "2025-10-15T14:30:00Z"
```

`drugName`, `batchNumber`, `dispensedBy` are denormalized so logs are self-contained audit records. If a drug is renamed or deleted, historical logs remain accurate. Logs are **append-only** — never updated or deleted.

**Read:** `getDocs` in Forecast (6 months for ML), Dashboard, Waste, Report | `onSnapshot` in Dashboard (recent activity)
**Write:** `addDoc` inside `writeBatch.commit()` in Dispense page

🔴 **Judge question:** *Why store `drugName` in every log instead of just the drugId?*
**Strong answer:** "Audit trail integrity. If a drug is renamed, historical logs would show the new name — losing the record of what was actually dispensed. Denormalizing at write time preserves exactly what existed when the dispense happened. Standard practice for audit logs."

---

## D5. Collection: `alerts/{alertId}`

```
type:      "near_expiry"         // 'low_stock' | 'near_expiry' | 'expired'
drugId:    "drug_01"
drugName:  "Paracetamol 500mg"   // DENORMALIZED
message:   "Batch expires in 7 days (2026-03-28)"
severity:  "critical"            // 'warning' | 'critical'
read:      false
createdAt: "2026-03-21T10:00:00Z"
```

Alerts are created by `seedData.ts` for the demo. In production, Firebase Cloud Functions would auto-generate them on batch writes or stock drops.

**Read:** `onSnapshot` in Alerts page | `getDocs` in Dashboard (unread count)
**Write:** Seed data | `updateDoc` (mark read) | `writeBatch.delete`

🔴 **Judge question:** *If a pharmacist marks an alert as read, is it read for all users?*
**Strong answer:** "Yes — `read` is a single boolean on the document. Any user marking it read updates the same document. Production would use per-user read tracking as a subcollection `alerts/{id}/readBy/{userId}`. Shared read status is a justified hackathon simplification."

---

## D6. Document: `config/seeded`

```
config/seeded/
  value: true
```

Prevents the seed function running twice. Dashboard checks this on load — if absent, runs full seed then writes `{ value: true }`.

**Demo day:** If data needs resetting, delete this document in Firebase Console, then reload Dashboard.

---

# QUICK REFERENCE: DEMO DAY CHEAT SHEET

## Accounts

| Email | Password | Role | Can Access |
|---|---|---|---|
| mehta@hospital.guj.in | password123 | admin | Everything |
| shah@hospital.guj.in | password123 | manager | No Dispense, No Report |
| patel@hospital.guj.in | password123 | pharmacist | Dashboard, Inventory, Dispense, Alerts, Heatmap |

## 10-Second Answers

| Question | Answer |
|---|---|
| "What database?" | "Cloud Firestore — Google's serverless NoSQL document database. No schema, real-time listeners, scales automatically." |
| "How does ML work?" | "scikit-learn LinearRegression on 6 months of weekly dispense history. Plot demand vs time, fit a line, project 4 weeks forward. R² and MAPE show confidence." |
| "Why Firebase?" | "Serverless auth + real-time database + hosting in one platform. No backend to manage, scales automatically." |
| "Dark mode?" | "Add `dark` CSS class to `<html>`. Tailwind `dark:` utilities activate for all descendants. Preference in localStorage." |
| "Architecture?" | "Three tiers: React SPA on Firebase Hosting, Firestore + Auth for data, Flask ML on Render.com." |
| "Race conditions?" | "Firestore `increment()` — delta operations apply server-side, concurrent dispenses serialize correctly." |
| "Forecast slow?" | "Render free tier cold starts — 30-60 seconds to spin up after 15 minutes of inactivity. We wake it before demos." |
| "Two users dispense simultaneously?" | "Server-side `increment()` serializes both deltas correctly. No phantom inventory." |
| "Authentication?" | "Firebase Auth issues JWT. `onAuthStateChanged` listener fetches role from Firestore. React Context provides it app-wide." |
| "Security model?" | "Three layers: Firebase Auth, Firestore Security Rules, client-side ProtectedRoute guards." |

---

*Know the judge questions cold. The strong answers show understanding of WHY, not just WHAT.*
