# PharmaGuard Gujarat by Team-Void Pointers

**AI-Powered Pharmacy Management System for Gujarat Government Hospitals**

---

## Problem Statement

Gujarat government hospitals face a chronic pharmaceutical waste crisis documented in successive CAG (Comptroller and Auditor General) audit reports:

- **Expired drug write-offs** worth crores annually due to inadequate stock rotation
- **FEFO non-compliance** — batches consumed out-of-order, causing preventable expiry losses
- **Manual, paper-based tracking** that cannot flag near-expiry stock in real time
- **No demand forecasting**, leading to simultaneous overstocking of some drugs and stockouts of others
- **Zero waste quantification** — hospitals cannot measure or report the cost of preventable waste

PharmaGuard Gujarat addresses all of these with a web-based system that enforces FEFO at dispense time, surfaces ML-driven reorder suggestions, and gives hospital administrators a real-time window into inventory health.

---

## Solution Overview

PharmaGuard Gujarat is a role-based pharmacy management platform that provides:

- **FEFO-enforced dispensing** — automatically selects the earliest-expiring batch when a pharmacist processes a dispense
- **ML demand forecasting** — a Python/scikit-learn backend fits linear regression on 6 months of dispense history and projects 4-week ahead demand per drug, complete with R², MAE, SMAPE, and reorder suggestions
- **Real-time expiry alerts** — low stock, near-expiry (≤30 days), and expired drug alerts generated from live Firestore data
- **Expiry heatmap** — a calendar view where each day is color-coded by expiry urgency, letting managers see risk at a glance
- **Waste calculator** — quantifies expired-drug value at risk, units rescued via FEFO, CO₂ savings, and stockouts prevented
- **PDF reporting** — one-click comprehensive inventory and dispense report for hospital administrators

---

## Tech Stack

### Frontend

| Technology | Version | Purpose |
|---|---|---|
| React | 19.2.4 | UI framework |
| TypeScript | 5.9.3 | Type safety |
| Vite | 8.0.1 | Build tool and dev server |
| Tailwind CSS | 4.2.2 | Utility-first styling |
| React Router DOM | 7.13.1 | Client-side routing |
| Firebase SDK | 12.11.0 | Firestore + Authentication |
| Chart.js | 4.5.1 | Bar, line, doughnut charts |
| react-chartjs-2 | 5.3.1 | React wrapper for Chart.js |
| jsPDF | 4.2.1 | PDF report generation |
| Lucide React | 0.577.0 | Icon library |
| date-fns | 4.1.0 | Date formatting utilities |

### Backend

| Technology | Purpose |
|---|---|
| Python / Flask | REST API web framework |
| flask-cors | Cross-origin request handling |
| scikit-learn | LinearRegression demand forecasting |
| NumPy | Numerical computation |
| Gunicorn | Production WSGI server |

### Infrastructure

| Service | Purpose |
|---|---|
| Firebase Authentication | Email/password auth with role-based access |
| Cloud Firestore | Real-time NoSQL document database |
| Render (optional) | Flask ML backend deployment |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (React SPA)                     │
│                                                             │
│  LoginPage  │  Dashboard  │  Inventory  │  Dispense        │
│  Alerts     │  Forecast   │  Heatmap    │  WasteCalc       │
│  Report                                                     │
│                                                             │
│  AuthContext (Firebase Auth)  │  ThemeContext (Dark/Light)  │
└────────────┬──────────────────────────────┬────────────────┘
             │                              │
             │ Firestore SDK (onSnapshot)   │ fetch (REST)
             │ Real-time listeners          │ POST /api/predict-all
             ▼                              ▼
┌────────────────────────┐    ┌─────────────────────────────┐
│    Cloud Firestore     │    │   Flask ML Backend          │
│                        │    │   (Python / scikit-learn)   │
│  /drugs                │    │                             │
│    /{drugId}           │    │  POST /api/predict          │
│      /batches          │    │  POST /api/predict-all      │
│  /dispenseLogs         │    │  GET  /api/health           │
│  /alerts               │    │                             │
│  /users                │    │  LinearRegression on        │
│                        │    │  weekly dispense history    │
└────────────────────────┘    └─────────────────────────────┘
```

---

## Features

### Authentication & Roles (`/login`)

Three roles control page access throughout the app:

| Role | Access |
|---|---|
| `pharmacist` | Dashboard, Inventory, Dispense, Alerts, Heatmap |
| `manager` | Dashboard, Inventory, Alerts, Forecast, Heatmap, Waste Calc |
| `admin` | All pages including Reports |

The login page has a sign-in tab and a registration tab. Demo account quick-fill buttons populate credentials for all three test roles. Firebase email/password authentication is used; user profiles and roles are stored in the `/users` Firestore collection.

---

### Dashboard (`/`)

Summary cards showing:
- Total drugs in stock
- Low or out-of-stock drug count
- Near-expiry batches (within 30 days)
- Total units dispensed in the last 7 days
- Unread alert count

Charts:
- Weekly dispense bar chart (last 7 days)
- Top 5 most dispensed drugs doughnut chart

Recent activity table (last 5 dispense logs).

Admin-only: a "Seed Database" button that populates Firestore with 20 realistic drugs, batch histories, 6 months of dispense logs, and alerts. Checks for existing data to avoid duplicate seeding.

---

### Inventory Management (`/inventory`)

Full drug and batch management:

- Drug list table with search, filter by stock status (all / low / out of stock), and multi-column sorting (name, category, unit, stock, reorder level)
- Inline batch expansion per drug showing all batches in FEFO order with expiry badges
- Add / edit drug form (name, category, unit, reorder level)
- Per-drug batch management: add new batches (batch number, quantity, expiry date, received date, cost per unit), delete batches
- Live Firestore `onSnapshot` listeners for real-time stock updates
- Stock status badge (In Stock / Low Stock / Out of Stock) driven by comparison to reorder level

---

### Dispense (`/dispense`) — pharmacist, admin only

FEFO-enforced medication dispensing:

- Drug selection with current stock display
- Automatic FEFO batch selection: sorts available non-expired batches by earliest expiry date
- Multi-batch splitting: if a requested quantity spans multiple batches, the algorithm distributes across batches automatically
- Batch detail preview (expiry date, days remaining, cost per unit)
- Dispense form with quantity input and confirmation
- On submit: decrements batch quantities in Firestore, creates a dispense log entry, shows toast notification

---

### Alerts (`/alerts`)

Real-time alert feed with:

- Filter tabs: All, Critical, Warning, Low Stock, Near Expiry, Unread, Read
- Sort order toggle (newest / oldest first)
- Search by drug name
- Summary cards: critical count, warning count, total count
- Per-alert actions: mark as read, delete (read-only alerts)
- Bulk actions: mark all as read, delete all read alerts
- Alert type color coding: low_stock (orange), near_expiry (yellow), expired (red)
- Severity indicators: warning (amber), critical (red)

---

### Demand Forecast (`/forecast`) — manager, admin only

ML-powered 4-week demand forecasting:

- On page load, aggregates last 6 months of dispense logs from Firestore, grouped by drug and calendar week
- Sends weekly history arrays to Flask backend via `POST /api/predict-all`
- Displays per-drug forecast cards showing:
  - 4-week ahead predicted quantities
  - Model quality metrics: R², MAE, SMAPE, MAPE
  - Trend classification (increasing / decreasing / stable)
  - Reorder suggestion with days-until-stockout and recommended order quantity
  - Line chart overlaying historical weekly demand vs model predictions
- Backend timeout is handled gracefully with a visible error state

---

### Expiry Heatmap (`/heatmap`)

Calendar-based expiry urgency visualization:

- Month navigation (previous / next month)
- Each calendar day cell is colored by the urgency of batches expiring on that date:
  - Red: expired or expiring today
  - Orange: < 7 days remaining
  - Yellow: < 30 days remaining
  - Green: < 90 days remaining
  - Sky blue: > 90 days remaining
- Color intensity increases with the number of batches expiring on that day
- Click a day to open a detail panel listing all batches, quantities, and value at risk (quantity × cost per unit)
- Filter by urgency level (all / expired / critical / warning / safe)
- Legend and monthly statistics summary

---

### Waste Calculator (`/waste`) — manager, admin only

Comprehensive FEFO savings quantification:

Summary metrics:
- Expired batch count and total value at risk (₹)
- Units rescued (dispensed within 30 days of expiry) and rescued value (₹)
- Stockouts prevented
- Total value saved (₹)
- CO₂ saved (kg) — calculated at 0.002 kg per unit rescued

Charts:
- Monthly waste prevention bar chart comparing potential waste (baseline 60% loss) vs FEFO-prevented waste
- Category breakdown doughnut chart of expired stock
- Top 10 wasted drugs table
- Top 10 rescued drugs table

---

### Reports (`/report`) — admin only

One-click PDF report generation:

- Editable hospital name and pharmacist/officer name fields
- Preview mode renders report contents in-browser
- Download generates a PDF via jsPDF with:
  - Header with hospital name and report date range
  - Summary statistics: total drugs, inventory value, expired batches, expired value
  - Top 10 dispensed drugs table
  - Top 10 near-expiry batches table
  - Footer with officer name
- Uses "Rs." in place of "₹" for jsPDF standard font compatibility

---

## Project Structure

```
pharmaguard-gujarat/
├── index.html                    # Root HTML, mounts React to <div id="root">
├── package.json                  # npm dependencies and scripts
├── vite.config.ts                # Vite config: React plugin + Tailwind plugin
├── tsconfig.json                 # TypeScript project references config
├── tsconfig.app.json             # App TypeScript config (ES2023, strict)
├── tsconfig.node.json            # Node TypeScript config (for vite.config)
├── eslint.config.js              # ESLint with TypeScript + React hooks rules
├── .env.production               # VITE_API_URL placeholder for ML backend
│
├── backend/
│   ├── app.py                    # Flask app: /api/predict, /api/predict-all, /api/health
│   └── requirements.txt          # flask, flask-cors, scikit-learn, numpy, gunicorn
│
└── src/
    ├── main.tsx                  # React entry point, renders <App> in StrictMode
    ├── App.tsx                   # Root router: all routes, ProtectedRoute wrappers, layout
    │
    ├── config/
    │   ├── firebase.ts           # Firebase app, Firestore db, Auth instance exports
    │   └── api.ts                # API_BASE constant from VITE_API_URL env var
    │
    ├── types/
    │   └── index.ts              # TypeScript interfaces: UserRole, UserProfile, Drug,
    │                             #   Batch, DispenseLog, Alert
    │
    ├── contexts/
    │   ├── AuthContext.tsx        # Firebase Auth state, signIn/signUp/signOut,
    │                             #   role-aware profile creation, useAuth hook
    │   └── ThemeContext.tsx       # Light/dark theme toggle, localStorage persistence,
    │                             #   useTheme hook
    │
    ├── hooks/
    │   └── useAuth.ts            # Re-exports useAuthContext from AuthContext
    │
    ├── components/
    │   └── Layout/
    │       ├── Sidebar.tsx       # Responsive sidebar with role-filtered nav items,
    │       │                     #   user profile, theme toggle, logout
    │       └── ProtectedRoute.tsx # Auth guard + optional role-based access control
    │
    ├── pages/
    │   ├── Login/
    │   │   └── index.tsx         # Sign-in / register tabs, demo account quick-fill buttons
    │   ├── Dashboard/
    │   │   └── index.tsx         # KPI cards, weekly chart, top drugs chart, seed button
    │   ├── Inventory/
    │   │   └── index.tsx         # Drug table, batch management, FEFO display, add/edit forms
    │   ├── Dispense/
    │   │   └── index.tsx         # FEFO batch selection, multi-batch splitting, dispense form
    │   ├── Alerts/
    │   │   └── index.tsx         # Real-time alert feed, filters, mark-read, bulk delete
    │   ├── Forecast/
    │   │   └── index.tsx         # ML forecast cards, metrics, line charts, reorder flags
    │   ├── Heatmap/
    │   │   └── index.tsx         # Calendar expiry heatmap, day detail panel, urgency filter
    │   ├── WasteCalc/
    │   │   └── index.tsx         # Waste metrics, rescue stats, CO₂ savings, comparison charts
    │   └── Report/
    │       └── index.tsx         # PDF report preview and download via jsPDF
    │
    └── utils/
        └── seedData.ts           # Generates 20 drugs, batches (with expired/near-expiry mix),
                                  #   6 months dispense logs, alerts; writes to Firestore
```

---

## Setup & Installation

### Prerequisites

- Node.js 18+
- Python 3.10+
- A Firebase project with **Firestore** and **Authentication (Email/Password)** enabled

---

### Frontend Setup

```bash
cd pharmaguard-gujarat
npm install
npm run dev
```

The app runs at `http://localhost:5173` by default.

To build for production:

```bash
npm run build
npm run preview
```

---

### Backend (ML Server) Setup

```bash
cd pharmaguard-gujarat/backend
pip install -r requirements.txt
python app.py
```

The Flask server starts on `http://localhost:5000`.

For production, run via Gunicorn:

```bash
gunicorn -w 4 app:app
```

Set the `PORT` environment variable to override the default port 5000.

---

### Firebase Configuration

The Firebase config is hardcoded in `src/config/firebase.ts` pointing to the project `void-pointers-aetrix-2026`. To use your own Firebase project:

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Authentication → Email/Password**
3. Enable **Firestore Database**
4. Replace the config object in `src/config/firebase.ts`:

```typescript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

---

### ML Backend URL Configuration

Create a `.env` file at the project root (or set in your deployment environment):

```env
VITE_API_URL=http://localhost:5000
```

In production, set this to your deployed Flask server URL (e.g., a Render instance). If `VITE_API_URL` is not set, the frontend falls back to an empty string — forecast functionality will not work without a running backend.

---

### Database Seeding

1. Log in as the admin account: `mehta@hospital.guj.in` / `password123`
2. Navigate to the **Dashboard**
3. Click the **"Seed Database"** button (visible to admin only)
4. Wait for the progress indicator — this creates 20 drugs, batches, 6 months of dispense logs, and alerts in Firestore

The seed function checks for existing data and will not duplicate records.

---

## Demo Accounts

| Name | Email | Password | Role | Access |
|---|---|---|---|---|
| Dr. Mehta | `mehta@hospital.guj.in` | `password123` | `admin` | All pages |
| Dr. Shah | `shah@hospital.guj.in` | `password123` | `manager` | Dashboard, Inventory, Alerts, Forecast, Heatmap, Waste Calc |
| Dr. Patel | `patel@hospital.guj.in` | `password123` | `pharmacist` | Dashboard, Inventory, Dispense, Alerts, Heatmap |

All accounts are pre-configured in `src/contexts/AuthContext.tsx`. Signing in for the first time creates the user profile in Firestore automatically.

---

## API Endpoints

Base URL: `VITE_API_URL` (default: `http://localhost:5000`)

---

### `GET /`

Health check.

**Response:**
```json
{
  "service": "pharmaguard-ml",
  "status": "running"
}
```

---

### `GET /api/health`

Liveness probe used by the frontend before loading forecasts.

**Response:**
```json
{
  "status": "ok",
  "model": "linear_regression",
  "version": "1.0"
}
```

---

### `POST /api/predict`

Predict demand for a single drug.

**Request body:**
```json
{
  "drugId": "drug_01",
  "drugName": "Paracetamol 500mg",
  "currentStock": 500,
  "reorderLevel": 200,
  "history": [
    { "date": "2025-10-06", "quantity": 42 },
    { "date": "2025-10-13", "quantity": 38 },
    { "date": "2025-10-20", "quantity": 45 }
  ]
}
```

- `history` entries are weekly aggregated dispense quantities
- Minimum 4 history entries required

**Response:**
```json
{
  "drugId": "drug_01",
  "drugName": "Paracetamol 500mg",
  "predictions": [
    { "date": "2026-03-28", "predicted_quantity": 44.2 },
    { "date": "2026-04-04", "predicted_quantity": 45.1 },
    { "date": "2026-04-11", "predicted_quantity": 45.9 },
    { "date": "2026-04-18", "predicted_quantity": 46.8 }
  ],
  "metrics": {
    "r2_score": 0.87,
    "mae": 3.21,
    "smape": 8.4,
    "mape": 7.9,
    "slope": 0.22,
    "intercept": 38.5,
    "trend": "increasing",
    "relative_slope_pct": 0.57,
    "avg_weekly_demand": 41.0
  },
  "reorder_suggestion": {
    "should_reorder": false,
    "suggested_quantity": 212,
    "days_until_stockout": 85.4,
    "reason": "Current stock sufficient for ~85 days"
  }
}
```

**Error responses:**

| Status | Condition |
|---|---|
| 400 | Invalid JSON or missing `drugId` |
| 422 | Fewer than 4 valid history entries, or total demand is zero |
| 500 | Unexpected internal error |

---

### `POST /api/predict-all`

Batch prediction for all drugs in a single request. Used by the Forecast page.

**Request body:**
```json
{
  "drugs": [
    {
      "drugId": "drug_01",
      "drugName": "Paracetamol 500mg",
      "currentStock": 500,
      "reorderLevel": 200,
      "history": [...]
    },
    {
      "drugId": "drug_02",
      "drugName": "Amoxicillin 500mg",
      "currentStock": 120,
      "reorderLevel": 50,
      "history": [...]
    }
  ]
}
```

**Response:** Array where each element is either a successful prediction (same shape as `/api/predict` response) or an error object:

```json
[
  {
    "drugId": "drug_01",
    "drugName": "Paracetamol 500mg",
    "predictions": [...],
    "metrics": {...},
    "reorder_suggestion": {...}
  },
  {
    "drugId": "drug_02",
    "error": "Insufficient data: need at least 4 data points, got 2"
  }
]
```

---

### ML Model Details

The backend uses **scikit-learn `LinearRegression`** with week index as the single feature:

- Feature: X = `[0, 1, 2, ..., n-1]` (week sequence)
- Target: y = weekly dispensed quantities
- Predictions extrapolate the fitted line 4 weeks into the future
- Reorder trigger: `days_until_stockout < 30` OR `current_stock ≤ reorder_level`
- Suggested order quantity: `(4-week predicted total) × 1.2` (20% safety buffer)
- Trend classification thresholds: slope > +0.5 → increasing, slope < −0.5 → decreasing, else stable

---

## Firestore Collections

### `/drugs/{drugId}`

| Field | Type | Description |
|---|---|---|
| `id` | string | Document ID |
| `name` | string | Drug name (e.g., "Paracetamol 500mg") |
| `category` | string | Drug category (e.g., "Analgesic") |
| `unit` | string | Dispensing unit (e.g., "tablets", "vials") |
| `reorderLevel` | number | Minimum stock threshold |
| `currentStock` | number | Current total stock across all batches |

### `/drugs/{drugId}/batches/{batchId}`

| Field | Type | Description |
|---|---|---|
| `id` | string | Document ID |
| `drugId` | string | Parent drug ID |
| `batchNumber` | string | Manufacturer batch number |
| `quantity` | number | Remaining units in this batch |
| `expiryDate` | string | ISO 8601 date (e.g., "2026-04-15") |
| `receivedDate` | string | ISO 8601 date received |
| `costPerUnit` | number | Unit cost in INR |

### `/dispenseLogs/{logId}`

| Field | Type | Description |
|---|---|---|
| `id` | string | Document ID |
| `drugId` | string | Drug dispensed |
| `drugName` | string | Drug name (denormalized) |
| `batchId` | string | Batch from which dispensed |
| `batchNumber` | string | Batch number (denormalized) |
| `quantity` | number | Units dispensed |
| `dispensedBy` | string | Pharmacist name |
| `timestamp` | string | ISO 8601 datetime |

### `/alerts/{alertId}`

| Field | Type | Description |
|---|---|---|
| `id` | string | Document ID |
| `type` | string | `"low_stock"`, `"near_expiry"`, or `"expired"` |
| `drugId` | string | Affected drug |
| `drugName` | string | Drug name (denormalized) |
| `message` | string | Human-readable alert description |
| `severity` | string | `"warning"` or `"critical"` |
| `read` | boolean | Whether the alert has been acknowledged |
| `createdAt` | string | ISO 8601 datetime |

### `/users/{uid}`

| Field | Type | Description |
|---|---|---|
| `uid` | string | Firebase Auth UID |
| `name` | string | Display name |
| `email` | string | Email address |
| `role` | string | `"pharmacist"`, `"manager"`, or `"admin"` |

---

## Seed Data

The seed utility (`src/utils/seedData.ts`) generates realistic demo data anchored to **2026-03-21**:

**20 drugs across 10 categories:**
Paracetamol 500mg, Amoxicillin 500mg, Metformin 500mg, Amlodipine 5mg, Omeprazole 20mg, Ciprofloxacin 500mg, Atorvastatin 20mg, Ceftriaxone 1g (vials), Salbutamol Inhaler, Insulin Glargine (vials), Diclofenac 50mg, Azithromycin 500mg, Losartan 50mg, Pantoprazole 40mg, Chloroquine 250mg, ORS Sachets, Ferrous Sulphate 200mg, Dexamethasone 4mg (vials), Metronidazole 400mg, Ibuprofen 400mg

**Batch mix per drug:** 3–5 batches including expired batches (for alert testing), near-expiry batches (within 30 days), and healthy future stock (90+ days)

**Dispense history:** September 2025 – February 2026, with regional seasonality factors applied per category (monsoon surge for anti-infectives, winter surge for respiratory drugs)

**Pharmacist names in logs:** Dr. Patel, Dr. Sharma, Dr. Desai, Dr. Joshi, Dr. Trivedi

---

## Team

Built by **Void Pointers** — Aetrix 2026 Hackathon

Yash Abhichandani = Fullstack dev
Dhvanit Chauhan = Backend Architect
Priyanka Nair = Frontend dev
Mahek Charan = Frontend dev

---

## License

MIT
