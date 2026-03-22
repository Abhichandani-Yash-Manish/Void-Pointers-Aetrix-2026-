# PharmaGuard Gujarat — Step-by-Step Study Breakdown
### How Each Team Member Learns, Owns, and Presents Their Domain
### Generated from TECHNICAL_GUIDE.md

---

> This file is the **action plan**. TECHNICAL_GUIDE.md is the **reference**.
> Use this file to know WHAT to study, in WHAT ORDER, and HOW to explain it.

---

# WHO OWNS WHAT

| Person | Role | Primary Ownership | Must Also Know |
|---|---|---|---|
| Frontend Dev 1 | React, Routing, Auth | A1, A3, A10, B6 | B1, B3, D1 |
| Frontend Dev 2 | UI, Charts, Deploy | A2, A4, A5, A6, C1, C3 | B4, D2, D3 |
| Backend Dev 1 | Flask API, ML Model | A9 (backend side), B1, B5 | C2, C5, D4 |
| Backend Dev 2 | Data Model, Firestore | D1–D6, B3, B4 | B2, B6 |

---

# FRONTEND DEV 1 — React, Routing, Auth Flow

## Step 1 — Understand what React actually does (10 min)

Open `src/main.tsx`. It has 6 lines. Read them:

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

What this does, in plain English:
1. Find the `<div id="root">` in `index.html`
2. Tell React: "Take over this div, make it your canvas"
3. Render the `<App />` component inside it
4. Wrap it in `StrictMode` for dev-time debugging (double-renders effects — no prod impact)

**How to explain it in 30 seconds:**
> "React turns a blank `<div>` into a full application. Instead of the server sending new HTML pages, React's JavaScript swaps out components inside that one div. The entire app lives in one HTML file."

## Step 2 — Trace the routing (15 min)

Open `src/App.tsx`. Find the `<Routes>` block. Read each `<Route>`. Notice the pattern:

```tsx
<Route path="/forecast" element={
  <ProtectedRoute allowedRoles={['manager', 'admin']}>
    <AppLayout>
      <ForecastPage />
    </AppLayout>
  </ProtectedRoute>
} />
```

The nesting means: "To render ForecastPage, the user must pass ProtectedRoute's checks, and the page gets wrapped in AppLayout (sidebar + header)."

**Three things to know about every route:**
1. The path (`/forecast`)
2. The role restriction (`allowedRoles`)
3. What component renders (`ForecastPage`)

**Practice:** Cover the code and verbally say all 8 routes, their paths, and who can access them. Use the role matrix in TECHNICAL_GUIDE.md B6.

## Step 3 — Trace the auth flow end to end (20 min)

Open `src/contexts/AuthContext.tsx`. Find `onAuthStateChanged`. Trace what happens:

```
User clicks "Login"
    ↓
signIn() → signInWithEmailAndPassword(auth, email, password)
    ↓
Firebase validates credentials → emits auth state change
    ↓
onAuthStateChanged fires with Firebase user object
    ↓
getDoc(doc(db, 'users', uid)) → fetches role from Firestore
    ↓
setUser(firebaseUser) + setProfile({uid, name, email, role})
    ↓
loading = false → ProtectedRoute re-evaluates → page renders
```

**How to explain it in 30 seconds:**
> "Firebase Auth handles password validation and issues a JWT token. Our `AuthContext` listens to auth state changes, fetches the user's role from a Firestore document, and makes everything available app-wide through React Context. Any component calls `useAuth()` and gets the user and their role instantly."

## Step 4 — Understand ProtectedRoute (10 min)

Open `src/components/Layout/ProtectedRoute.tsx`. The logic is 4 lines:

```
1. If loading → show spinner (auth hasn't resolved yet)
2. If no user → redirect to /login
3. If allowedRoles specified AND user's role not in it → show Access Denied
4. Otherwise → render children
```

**Critical point for judges:** The sidebar filtering (which hides nav items by role) is a **UX layer**. `ProtectedRoute` is the **actual enforcement**. Someone who manually types `/report` in the URL bar still hits `ProtectedRoute`.

## Step 5 — What to say when asked about Context (5 min)

Practice this answer cold:
> "We have two Contexts: `AuthContext` and `ThemeContext`. Auth holds the current user and their role — it's populated by Firebase's `onAuthStateChanged` listener and a Firestore read. Theme holds the dark mode state — it's a boolean that adds/removes a CSS class on `<html>` and persists to `localStorage`. We didn't use Redux or Zustand because we only have two pieces of global state. Everything else — drugs, batches, alerts — is local state inside each page component."

---

# FRONTEND DEV 2 — UI, Charts, Build, Deploy

## Step 1 — Understand Tailwind's dark mode (10 min)

Open `src/index.css`. It has 2 lines:

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
```

Line 2 means: "The `dark:` prefix activates for any element that IS `.dark` or whose ANCESTOR is `.dark`."

Open `src/contexts/ThemeContext.tsx`. Find where `dark` is toggled:
```typescript
document.documentElement.classList.toggle('dark', isDark);
```

`document.documentElement` = the `<html>` tag. Every element in the page is a descendant. So toggling `dark` on `<html>` activates every `dark:` utility on every element simultaneously.

**How to explain it in 20 seconds:**
> "Toggle adds/removes the `dark` CSS class on the HTML root element. Tailwind's custom variant makes all `dark:` prefixed classes activate for any element descended from a `.dark` ancestor. Since every element descends from `<html>`, the whole app switches at once."

## Step 2 — Understand the build pipeline (15 min)

Run this mentally, step by step:

```
npm run build
    ↓
tsc -b          ← TypeScript checks all types. One error = build stops.
    ↓
vite build      ← Rollup takes over:
    ↓
1. Follows all imports from src/main.tsx → dependency graph
2. Removes unused exports (tree-shaking)
3. TypeScript/JSX → JavaScript
4. Splits vendor code (React, Firebase) into separate chunk
5. Minifies (isAuthenticated → a)
6. Hashes filenames (index.js → index-Xk3p9a2m.js)
7. Writes to dist/
```

Open the `dist/` folder after running a build. You'll see exactly:
- `index.html` — tiny, just loads the JS/CSS
- `assets/` — hashed JS and CSS files

**How to explain cache busting in 15 seconds:**
> "Every file gets a hash in its name based on its content. When we deploy a new version, the hash changes, the filename changes, and the browser can't use its stale cache — it must download the new file. Files that didn't change keep the same hash and are served from cache."

## Step 3 — Understand the Chart.js wrapper (10 min)

Open `src/pages/Forecast/index.tsx`. Find `<Line>` component. Look at the props: `data`, `options`, `key`.

The `key={selectedId}` is the key insight. When `selectedId` changes:
- React sees a different `key` value
- React **destroys** the old `<Line>` component and creates a new one
- This resets Chart.js with fresh data

Without `key`, Chart.js would try to animate from the old drug's data structure to the new drug's data structure — sometimes producing glitchy transitions when the number of data points changes.

**How to explain in 20 seconds:**
> "`react-chartjs-2` wraps Chart.js to be React-compatible — you pass data and options as props instead of calling imperative methods. The `key` prop on the chart forces a full remount when switching drugs, preventing glitchy transitions between differently-structured datasets."

## Step 4 — Understand Firebase Hosting deployment (10 min)

Know these 4 commands and what each does:

```bash
npm run build                    # Creates dist/ folder with optimized app
firebase login                   # Authenticate with Google
firebase init hosting            # Links project, creates firebase.json
firebase deploy --only hosting   # Uploads dist/ to Firebase CDN
```

Know what `firebase.json` does — 3 keys:
- `"public": "dist"` → only upload the dist folder
- `"ignore"` → never upload these files
- `"rewrites"` → the SPA rule — any unknown URL → return index.html

**How to explain deployment in 30 seconds:**
> "We run `npm run build` which TypeScript-checks and Rollup-bundles everything into a `dist/` folder. Then `firebase deploy` uploads that folder to Firebase's global CDN. Firebase serves it from edge nodes worldwide. The rewrite rule in `firebase.json` makes all URL paths return `index.html` so React Router can handle navigation client-side."

## Step 5 — Know the environment variable flow (5 min)

```
.env            → read by npm run dev    → VITE_API_URL = localhost:5000
.env.production → read by npm run build → VITE_API_URL = onrender.com URL
```

Vite bakes the value into the JavaScript bundle at build time. After `npm run build`, open `dist/assets/index-[hash].js` and search for `pharmguard-ml.onrender.com` — you'll find it hardcoded as a string literal.

**Key point:** Changing `.env.production` AFTER running build does nothing. You must rebuild.

---

# BACKEND DEV 1 — Flask API, ML Model

## Step 1 — Understand the Flask route structure (10 min)

Open `backend/app.py`. Find the 4 routes:

```python
GET  /                   → {"service": "pharmaguard-ml", "status": "running"}
GET  /api/health         → {"status": "ok", "model": "linear_regression"}
POST /api/predict        → single drug forecast
POST /api/predict-all    → batch forecast (used by frontend)
```

The frontend only calls `/api/predict-all` and `/api/health`. The single `/api/predict` is available for testing individual drugs (curl, Postman).

**Why `@app.route` instead of `@app.post`:**
`@app.post` is Flask 2.0+ shorthand. `@app.route("/path", methods=["POST"])` is the traditional syntax compatible with all Flask versions — safer for a Render.com deployment where you don't control the exact Flask version.

## Step 2 — Trace the ML pipeline for one drug (20 min)

Open `run_prediction()` in `app.py`. Walk through it step by step with this example input:

```
Drug: Paracetamol 500mg
Current stock: 500 tablets
History: 8 weeks of data → [42, 38, 45, 51, 47, 53, 49, 55]
```

**Step 1 — Validation:**
```python
if len(history) < 4:
    raise ValueError("Need at least 4 data points")
```
Why 4? With fewer points, a straight line fit is meaningless — any line fits 3 points perfectly.

**Step 2 — Build X and y:**
```python
X = [0, 1, 2, 3, 4, 5, 6, 7]  # week indices
y = [42, 38, 45, 51, 47, 53, 49, 55]  # quantities
```
X is time (weeks), y is demand. We're fitting: `demand = slope × week + intercept`

**Step 3 — Fit LinearRegression:**
```python
model = LinearRegression()
model.fit(X, y)
# slope ≈ 1.9 (demand increases ~1.9 units per week)
# intercept ≈ 40.5
```

**Step 4 — Predict weeks 9, 10, 11, 12:**
```python
future_X = [[8], [9], [10], [11]]
predictions = model.predict(future_X)
# ≈ [55.7, 57.6, 59.5, 61.4]
```

**Step 5 — Reorder logic:**
```python
predicted_4week_demand = sum([55.7, 57.6, 59.5, 61.4]) = 234.2
daily_demand = 234.2 / 4 / 7 = 8.36 units/day
days_until_stockout = 500 / 8.36 = 59.8 days
should_reorder = (59.8 < 30) OR (500 <= reorderLevel)
# → False, stock is fine
suggested_qty = 234.2 × 1.2 = 281 (with 20% safety buffer)
```

**How to explain the ML in 30 seconds:**
> "We take 6 months of weekly dispense totals, number the weeks 0 through N, and fit a straight line using scikit-learn's LinearRegression. The line gives us slope (is demand growing or shrinking?) and lets us project 4 weeks forward. We then divide predicted demand by stock to estimate days until stockout, and flag reorder if that's under 30 days or stock is already below the reorder threshold."

## Step 3 — Know the quality metrics (10 min)

**R² (R-squared):** How well the line fits. 1.0 = perfect fit. 0 = the line is as good as a horizontal mean line. Negative = the line is worse than just predicting the average.

**MAE (Mean Absolute Error):** Average distance between predicted and actual values, in units/week. If MAE = 5, predictions are off by ±5 tablets per week on average.

**SMAPE (Symmetric MAPE):** Percentage error that handles zero-demand weeks correctly. If a drug had zero dispenses one week, regular MAPE would be undefined (division by zero). SMAPE uses `(|actual| + |predicted|)` in the denominator, so zero weeks contribute 0% error instead of infinity.

**Trend classification:**
```python
if slope > 2:   trend = "increasing"
elif slope < -2: trend = "decreasing"
else:            trend = "stable"
```
Threshold of 2 units/week = meaningful change. Below that = noise.

## Step 4 — Know what WSGI and gunicorn mean (5 min)

**WSGI** = Web Server Gateway Interface. It's a standard Python protocol. Flask implements it — Flask is a WSGI application. Any WSGI-compatible server (gunicorn, uWSGI, waitress) can run it.

Flask's built-in server (`app.run()`) is for development only — single-threaded, no process management, no graceful shutdown. **Gunicorn** is for production — spawns multiple worker processes, handles crashes, manages the process lifecycle.

**The start command on Render:**
```
gunicorn app:app --bind 0.0.0.0:$PORT
```
- `app:app` = "from file `app.py`, import the object named `app`"
- `--bind 0.0.0.0:$PORT` = "listen on all network interfaces at Render's assigned port"

## Step 5 — Know CORS cold (5 min)

CORS = browser refuses to let `pharmaguard.web.app` JavaScript read responses from `pharmguard-ml.onrender.com` unless the backend says it's OK.

```python
CORS(app, origins="*")  # Allow any origin
```

`flask-cors` adds the `Access-Control-Allow-Origin: *` header to every response. The browser sees this and allows the JavaScript to read the response.

**Preflight:** For `POST` with `Content-Type: application/json`, the browser sends `OPTIONS` first asking "can I POST?". `flask-cors` responds "yes" automatically. Then the real POST goes through.

**Security:** `origins="*"` means anyone can call the API. Our API does stateless ML inference — no database, no secrets, no side effects. Acceptable for hackathon. In production: `origins=["https://pharmaguard.web.app"]`.

---

# BACKEND DEV 2 — Data Model, Firestore

## Step 1 — Understand the 5 collections and how they connect (15 min)

Draw this on paper:

```
users/{uid}
  └── role field determines access

drugs/{drugId}
  └── currentStock: DENORMALIZED sum of batch quantities
  └── reorderLevel: threshold for low-stock alerts

batches/{batchId}
  └── drugId: FK → drugs
  └── quantity: decremented on every dispense
  └── costPerUnit: for financial calculations
  └── expiryDate: drives alerts and heatmap

dispenseLogs/{logId}
  └── drugId + drugName (denormalized)
  └── batchId + batchNumber (denormalized)
  └── timestamp: ISO string → used by Forecast page for 6-month history

alerts/{alertId}
  └── type: 'low_stock' | 'near_expiry' | 'expired'
  └── severity: 'warning' | 'critical'
  └── read: boolean (shared across all users)
```

**The data relationships are all manual** — Firestore has no foreign key enforcement. If you delete a drug document, its batches and logs don't auto-delete. The app must handle this in `writeBatch`.

## Step 2 — Understand denormalization and when to use it (10 min)

**Denormalized field** = data stored in more than one place to speed up reads.

Three examples in this project:

1. **`drugs.currentStock`** — sum of batch quantities, stored on drug document
   - Why: Inventory page loads 20 drug documents and immediately shows stock. Without it: 60-100 batch reads per page load.
   - Risk: Can drift if batches expire or are deleted without updating `currentStock`.

2. **`dispenseLogs.drugName`** — drug name stored in every log entry
   - Why: Historical logs must be accurate even if the drug is renamed.
   - Risk: None — write-once audit log, name is frozen at dispense time.

3. **`dispenseLogs.dispensedBy`** — pharmacist name stored in every log
   - Why: Same audit trail reasoning.
   - Risk: None.

**Rule of thumb:** Denormalize when you need fast reads at the cost of write complexity. Denormalize for audit logs to preserve historical accuracy.

## Step 3 — Understand flat collection vs subcollection (10 min)

**Subcollection** (NOT used for batches):
```
drugs/drug_01/batches/batch_abc   ← subcollection path
```
To get all batches for all drugs, you'd need 20 `getDocs` calls (one per drug), or a `collectionGroup('batches')` query which requires a Firestore index.

**Flat collection** (what this project uses):
```
batches/batch_abc   ← top-level, with drugId: "drug_01" field
```
A single `getDocs(collection(db, 'batches'))` gets everything. Required by Heatmap, Waste Calc, and Report pages which need all batches across all drugs in one query.

**Trade-off:** Flat collection is simpler to query across, but the `where('drugId', '==', id)` filter requires a Firestore composite index for efficient querying.

## Step 4 — Understand `onSnapshot` cleanup (10 min)

Open any page that uses `onSnapshot`. Find the `useEffect` cleanup:

```typescript
useEffect(() => {
  const unsub = onSnapshot(collection(db, 'drugs'), (snapshot) => {
    setDrugs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Drug)));
  });
  return () => unsub(); // ← This line is critical
}, []);
```

What happens without the cleanup:
1. User visits Inventory page → `onSnapshot` opens WebSocket to Firestore
2. User navigates to Dashboard → Inventory component unmounts
3. WITHOUT cleanup: the WebSocket stays open, callback still fires, calls `setDrugs` on an unmounted component → React warning, memory leak
4. User visits Inventory again → a SECOND listener opens
5. Repeat 10 times → 10 simultaneous Firestore listeners for the same collection

**How to explain in 20 seconds:**
> "Every `onSnapshot` opens a WebSocket connection to Firestore and returns an unsubscribe function. We call it in the `useEffect` cleanup (the return function) so the connection closes when the component unmounts. Without this, navigating between pages would stack up multiple listeners for the same collection."

## Step 5 — Understand `writeBatch` and `increment()` together (10 min)

In the Dispense page, one user action does THREE things atomically:

```typescript
const batch = writeBatch(db);

// 1. Decrement batch quantity
batch.update(doc(db, 'batches', selectedBatch.id), {
  quantity: increment(-quantityToDispense)
});

// 2. Decrement drug's currentStock (denormalized field)
batch.update(doc(db, 'drugs', selectedDrug.id), {
  currentStock: increment(-quantityToDispense)
});

// 3. Create a dispense log
batch.set(doc(collection(db, 'dispenseLogs')), {
  drugId, drugName, batchId, batchNumber,
  quantity: quantityToDispense,
  dispensedBy: profile.name,
  timestamp: new Date().toISOString()
});

await batch.commit(); // All 3 writes happen together or none do
```

**Why atomic?** If the batch quantity decrement succeeded but the log creation failed, you'd have a stock discrepancy with no audit record. The batch ensures data integrity.

**Why `increment()` for the quantity?** Two pharmacists could dispense simultaneously. If both read the same quantity and write `quantity - X`, the second write overwrites the first. `increment(-X)` tells Firestore's server "subtract X from whatever the current value is at commit time" — concurrent operations serialize correctly.

---

# ALL TEAM MEMBERS — The 5 Questions Every Person Must Nail

## Q1: "Walk me through your architecture."

> "Three parts. First, a React SPA deployed on Firebase Hosting — it's the UI, handles all user interaction, and talks directly to Firestore using the Firebase SDK in the browser. Second, Cloud Firestore as our database — document-based, real-time WebSocket updates, no server we manage. Third, a Flask ML backend on Render.com — the frontend sends 6 months of weekly dispense history for each drug, Flask fits a LinearRegression model per drug and returns 4-week predictions. The frontend and Flask communicate over HTTP via `fetch()`."

## Q2: "What happens between clicking Login and seeing the Dashboard?"

> "User submits email and password. Firebase Auth validates credentials and emits an auth state change. Our `onAuthStateChanged` listener fires, gets the Firebase user object, reads the user document from Firestore to get their role. `loading` becomes false. `ProtectedRoute` re-checks — user exists, no role restriction on Dashboard, so it renders. Dashboard mounts, `useEffect` fires `onSnapshot` listeners on drugs, dispense logs, and alerts collections. Firestore sends initial snapshots, React sets state, the UI renders with live data."

## Q3: "How does dispensing a drug work — all the way to the database?"

> "Pharmacist selects a drug, selects a batch (ordered by soonest expiry — FIFO), enters quantity. On confirm, we create a `writeBatch` with three operations: decrement the batch's `quantity` field using `increment(-qty)`, decrement the drug's `currentStock` by the same amount using `increment(-qty)`, and create a new `dispenseLogs` document with all the details. `writeBatch.commit()` sends all three atomically. If network drops mid-write, none of them persist. The `onSnapshot` listener receives the updated batch quantity and the UI refreshes automatically."

## Q4: "How does the Forecast ML work?"

> "The Forecast page fetches all drugs and all dispense logs from Firestore using `getDocs`. It aggregates the logs into weekly totals per drug for the last 6 months. It sends all of this in one POST request to our Flask backend at `/api/predict-all`. Flask runs `scikit-learn's LinearRegression` for each drug: X is the week index (0, 1, 2...), y is weekly demand. The fitted line gives slope — is demand growing or shrinking. We project 4 weeks forward, clamp predictions to zero-minimum, and calculate days until stockout by dividing current stock by predicted daily demand. The response includes predictions, R², MAE, SMAPE, trend direction, and a reorder suggestion with 20% safety buffer."

## Q5: "If a manager logs in, what routes are they blocked from?"

> "Manager can access Dashboard, Inventory, Alerts, Heatmap, Forecast, and Waste Calculator. They cannot access Dispense — that's pharmacist and admin only. They cannot access Report — that's admin only. The `ProtectedRoute` for `/dispense` has `allowedRoles: ['pharmacist', 'admin']`. Manager's role is `'manager'`, which isn't in that list, so `ProtectedRoute` renders an access denied screen. The sidebar also never shows Dispense or Reports links to a manager, because `Sidebar.tsx` filters nav items by role. Both layers — the route guard and the sidebar — are consistent."

---

# STUDY TIMELINE (If you have 3 hours before evaluation)

| Time | Who | What |
|---|---|---|
| Hour 1, first 20 min | All 4 | Read Demo Day cheat sheet in TECHNICAL_GUIDE.md. Memorize 10-second answers. |
| Hour 1, next 40 min | Split by role | Each person does their 5 steps from this file |
| Hour 2, first 30 min | All 4 | Each person explains their domain to the group. Others ask the judge questions from TECHNICAL_GUIDE.md. |
| Hour 2, next 30 min | All 4 | Practice the 5 ALL-TEAM questions above. Each person answers each question once. |
| Hour 3 | All 4 | Open the live app. Navigate every page. Dispense a drug. Generate a PDF. Toggle dark mode. Someone asks random judge questions, others answer cold. |

---

# COMMON MISTAKES TO AVOID

**Saying "we used Firebase" and stopping there.**
Always follow with: "...specifically Firestore for real-time database and Firebase Auth for authentication. We use the modular SDK v12 which allows tree-shaking so only the functions we actually use end up in the production bundle."

**Saying "it's a React app."**
Always add: "React 19 with TypeScript in strict mode, Vite 8 as the build tool, React Router 7 for client-side routing, and Tailwind CSS 4 for styling."

**Saying "the backend does machine learning."**
Always specify: "scikit-learn's LinearRegression model. We use it because it's interpretable — the slope directly tells us whether demand is growing or shrinking, and the R² tells us how confident we are in the fit. No black box."

**Saying "we store data in Firestore."**
Always describe the structure: "We have 5 collections: users, drugs, batches, dispenseLogs, and alerts. Batches are a flat top-level collection rather than a subcollection so we can query all batches across all drugs in one call."

**Pausing when asked about race conditions.**
Say this immediately: "Firestore's server-side `increment()` function. Instead of reading stock, subtracting, and writing back — which creates a race condition with concurrent writes — `increment(-qty)` tells Firestore's server to apply the delta atomically. Concurrent operations serialize on the server."

---

*If you know this file cold, you know the project. If you know TECHNICAL_GUIDE.md, you can handle follow-up questions.*
