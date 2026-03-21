# PharmaGuard Gujarat — From Scratch Deployment Guide
## Frontend → Firebase Hosting | Backend → Render.com
## Follow every step in order. Do not skip anything.

---

# PHASE 1: CODE CHANGES (Do all of these before touching any deployment platform)

---

## Step 1: Create the API config file

Create a new file in your frontend project:

**File to create:** `src/config/api.ts`

```typescript
export const API_BASE = import.meta.env.VITE_API_URL || '';
```

That's it. One line. This file gives you a single variable that points to your ML backend.

---

## Step 2: Create environment files

In your **frontend project root** (same folder as `package.json`), create TWO files:

**File to create:** `.env`
```
VITE_API_URL=http://localhost:5000
```

**File to create:** `.env.production`
```
VITE_API_URL=https://PLACEHOLDER.onrender.com
```

> We'll replace PLACEHOLDER with your real Render URL later. Don't worry about it now.

**How this works:** When you run `npm run dev`, Vite reads `.env`. When you run `npm run build`, Vite reads `.env.production`. Same code, different URLs.

---

## Step 3: Update your Forecast page to use the API config

Open `src/pages/Forecast/index.tsx`.

**At the top of the file, add this import:**
```typescript
import { API_BASE } from '../config/api';
```

**Now find every fetch call that hits localhost:5000. There are likely 3:**

Find and replace #1 — Health check:
```typescript
// FIND something like:
fetch('http://localhost:5000/api/health')

// REPLACE with:
fetch(`${API_BASE}/api/health`)
```

Find and replace #2 — Single predict:
```typescript
// FIND something like:
fetch('http://localhost:5000/api/predict', {

// REPLACE with:
fetch(`${API_BASE}/api/predict`, {
```

Find and replace #3 — Predict all:
```typescript
// FIND something like:
fetch('http://localhost:5000/api/predict-all', {

// REPLACE with:
fetch(`${API_BASE}/api/predict-all`, {
```

**Tip:** Use your editor's search (Ctrl+F / Cmd+F) and search for `localhost:5000`. Replace every instance. There should be no `localhost:5000` left anywhere in your frontend code after this step.

---

## Step 4: Update your .gitignore

Open `.gitignore` in your frontend project root. Make sure these lines exist (add them if they don't):

```
.env
.env.local
.env.production.local
```

**Do NOT add `.env.production` to gitignore** — it only contains a public URL, not secrets. It needs to be committed so the build can read it.

---

## Step 5: Update the Flask backend to work on Render

Open `backend/app.py`.

### 5a — Fix the startup block

Find the bottom of the file where the app starts. It probably looks like one of these:

```python
if __name__ == '__main__':
    app.run(debug=True)
```
or
```python
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
```

**Replace it with:**
```python
import os

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
```

**Why:** Render assigns a random port via the PORT environment variable. Your app must listen on it. Locally, it falls back to 5000.

### 5b — Fix the CORS origins

Find the CORS setup near the top of `app.py`. It probably looks like:

```python
CORS(app, origins=["http://localhost:5173", "http://localhost:5174"])
```

**Replace it with:**
```python
CORS(app, origins="*")
```

**Why:** For the hackathon, allowing all origins is simplest and avoids CORS headaches. You don't know your exact Firebase Hosting URL yet. In production you'd lock this down.

### 5c — Add the `import os` at the top if it's not already there

Check the top of `app.py`. If `import os` isn't already there, add it:
```python
import os
```

---

## Step 6: Create requirements.txt for the backend

**If `backend/requirements.txt` doesn't exist, create it.**
**If it does exist, replace its contents with:**

**File:** `backend/requirements.txt`
```
flask
flask-cors
scikit-learn
numpy
gunicorn
```

**Why gunicorn:** Flask's built-in server is for development only. Gunicorn is the production-grade Python web server that Render will use.

---

## Step 7: Verify your changes locally

Before deploying anything, make sure your app still works locally.

**Terminal 1 — Start the backend:**
```bash
cd backend
python app.py
```
You should see: `Running on http://0.0.0.0:5000`

**Terminal 2 — Start the frontend:**
```bash
cd your-frontend-folder
npm run dev
```

Open `http://localhost:5173`. Test:
- Login works
- Dashboard loads
- Forecast page loads (no "backend offline" banner)
- Dispense works

If everything works locally, proceed. If not, fix it before deploying.

---

# PHASE 2: DEPLOY THE BACKEND ON RENDER

---

## Step 8: Push your code to GitHub

Your code needs to be on GitHub for Render to access it.

**If you already have a GitHub repo with your code:**
```bash
git add .
git commit -m "Prepare for deployment"
git push
```

**If you DON'T have a GitHub repo yet:**

Go to https://github.com/new and create a new repository. Name it whatever you want (e.g., `pharmaguard`). Set it to Private. Don't initialize with README.

Then in your project root:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

---

## Step 9: Create a Render account

1. Go to https://render.com
2. Click **"Get Started for Free"**
3. Sign up with your **GitHub account** (this is the fastest — it automatically connects your repos)

---

## Step 10: Create a new Web Service on Render

1. Once logged in, click the **"New +"** button at the top
2. Select **"Web Service"**
3. It will show your GitHub repos. Find your repo and click **"Connect"**

If you don't see your repo:
- Click **"Configure account"** under the GitHub section
- Grant Render access to the repo
- Come back and it should appear

---

## Step 11: Configure the Render service

Fill in these fields **exactly**:

| Setting | Value |
|---------|-------|
| **Name** | `pharmaguard-ml` (or whatever you want — this becomes your URL) |
| **Region** | `Singapore (Southeast Asia)` (closest to India) |
| **Branch** | `main` |
| **Root Directory** | `backend` ← **IMPORTANT: type this if your backend is in a subfolder** |
| **Runtime** | `Python` |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `gunicorn app:app --bind 0.0.0.0:$PORT` |

Scroll down to **Instance Type** and select **"Free"**.

Click **"Create Web Service"**.

---

## Step 12: Wait for the build to finish

Render will now:
1. Clone your repo
2. Navigate to the `backend/` folder
3. Run `pip install -r requirements.txt`
4. Start the server with gunicorn

This takes **2-4 minutes** the first time. You'll see build logs streaming in real time.

**When it's done, you'll see:**
```
==> Your service is live 🎉
```

Your backend URL will be shown at the top of the page. It looks like:
```
https://pharmaguard-ml.onrender.com
```

---

## Step 13: Test your backend

Open a new browser tab and go to:
```
https://pharmaguard-ml.onrender.com/api/health
```

You should see:
```json
{"status": "ok"}
```

If you see this, your backend is live. If not, check the Render logs for errors.

---

## Step 14: Update your frontend with the real Render URL

Now go back to your frontend code. Open `.env.production` and replace the placeholder:

```
VITE_API_URL=https://pharmaguard-ml.onrender.com
```

Use your ACTUAL Render URL from Step 12.

**Commit this change:**
```bash
git add .env.production
git commit -m "Set production API URL"
git push
```

---

# PHASE 3: DEPLOY THE FRONTEND ON FIREBASE HOSTING

---

## Step 15: Install Firebase CLI

```bash
npm install -g firebase-tools
```

**Verify it installed:**
```bash
firebase --version
```

You should see a version number like `13.x.x` or higher.

**If it says "command not found":**
- Close your terminal completely and open a new one
- Try again
- If still failing, try: `npx firebase-tools --version`

---

## Step 16: Log in to Firebase

```bash
firebase login
```

This opens your browser. Log in with the **Google account that owns your Firebase project**.

After logging in, the terminal will say:
```
✓ Success! Logged in as your-email@gmail.com
```

---

## Step 17: Initialize Firebase Hosting

**Run this from your frontend project root** (the folder that contains `package.json`):

```bash
firebase init hosting
```

It will ask a series of questions. Answer EXACTLY as shown:

```
? Please select an option:
→ Use an existing project
(press Enter)

? Select a default Firebase project for this directory:
→ (use arrow keys to find your project, press Enter to select it)

? What do you want to use as your public directory?
→ dist
(type "dist" and press Enter)

? Configure as a single-page app (rewrite all urls to /index.html)?
→ y
(type "y" and press Enter)

? Set up automatic builds and deploys with GitHub?
→ N
(type "N" and press Enter)

? File dist/index.html already exists. Overwrite?
→ N
(type "N" and press Enter — IMPORTANT: do not overwrite)
```

This creates two files in your project:
- `firebase.json` — configuration
- `.firebaserc` — links to your project ID

---

## Step 18: Verify firebase.json

Open `firebase.json`. It should look like this:

```json
{
  "hosting": {
    "public": "dist",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

**If it doesn't look like this**, delete it and create it manually with the content above.

The `rewrites` rule is critical — without it, going to `your-site.web.app/forecast` directly in the browser would show a 404 instead of loading your React app.

---

## Step 19: Build your frontend

```bash
npm run build
```

This creates the `dist/` folder with your production-optimized app.

**Verify it worked:**
```bash
ls dist/
```

You should see `index.html` and an `assets/` folder.

**If the build fails:**
- Read the error message carefully
- Most common issue: TypeScript errors. Fix them and run `npm run build` again.
- Make sure you saved all the files you edited in Phase 1.

---

## Step 20: Deploy to Firebase Hosting

```bash
firebase deploy --only hosting
```

Output:
```
=== Deploying to 'your-project-id'...

✓ Deploy complete!

Hosting URL: https://your-project-id.web.app
```

**That URL is your live site.** Copy it.

---

# PHASE 4: VERIFY EVERYTHING END TO END

---

## Step 21: Wake up the Render backend

Before testing, Render's free tier may have gone to sleep. Open this in a browser tab:
```
https://pharmaguard-ml.onrender.com/api/health
```

Wait until you see `{"status": "ok"}`. This might take 30-50 seconds.

**Keep this tab open.**

---

## Step 22: Test the live app

Open your Firebase Hosting URL: `https://your-project-id.web.app`

Run through this checklist:

```
[ ] 1.  Login page loads
[ ] 2.  Log in as admin: mehta@hospital.guj.in / password123
[ ] 3.  Dashboard loads with stat cards
[ ] 4.  Charts render (7-day bar chart, stock doughnut)
[ ] 5.  Seed data if needed (Admin panel on Dashboard)
[ ] 6.  Navigate to Inventory — drugs list loads
[ ] 7.  Navigate to Alerts — alerts display
[ ] 8.  Navigate to Heatmap — calendar renders with colors
[ ] 9.  Log out
[ ] 10. Log in as pharmacist: patel@hospital.guj.in / password123
[ ] 11. Navigate to Dispense
[ ] 12. Select a drug, enter quantity, see allocation plan
[ ] 13. Click Confirm — toast appears, stock updates
[ ] 14. Log out
[ ] 15. Log in as manager: shah@hospital.guj.in / password123
[ ] 16. Navigate to Forecast — NO "backend offline" banner
[ ] 17. Drug cards load with sparklines
[ ] 18. Click a drug — detail view with chart and predictions
[ ] 19. Navigate to Waste Calc — hero metrics display
[ ] 20. Log out, log in as admin again
[ ] 21. Navigate to Report — generate preview — download PDF
[ ] 22. Test dark mode toggle
[ ] 23. Open on your phone — responsive layout works
```

---

## Step 23: Add Firebase Hosting domain to authorized domains (if login fails)

If login gives an error like "unauthorized domain":

1. Go to https://console.firebase.google.com
2. Select your project
3. Go to **Authentication** → **Settings** → **Authorized domains**
4. Click **Add domain**
5. Add: `your-project-id.web.app`
6. Also add: `your-project-id.firebaseapp.com`

Firebase usually adds these automatically when you set up hosting, but if login fails, this is the fix.

---

# PHASE 5: HOW TO MAKE CHANGES AND REDEPLOY

---

## Frontend changes (any .tsx, .css, .ts file):

```bash
# 1. Make your changes
# 2. Test locally
npm run dev

# 3. When ready, build and deploy
npm run build
firebase deploy --only hosting

# Done. Live in ~15 seconds.
```

## Backend changes (app.py):

```bash
# 1. Make your changes
# 2. Test locally
cd backend
python app.py

# 3. When ready, commit and push
git add .
git commit -m "description of change"
git push

# Render auto-detects the push and redeploys in ~2-3 minutes.
```

## Changed both?

```bash
git add .
git commit -m "description"
git push              # Backend redeploys automatically on Render
npm run build
firebase deploy --only hosting   # Frontend redeploys to Firebase
```

---

# QUICK TROUBLESHOOTING

### "firebase: command not found"
```bash
# Option 1: Close terminal, open new one, try again
# Option 2: Use npx instead
npx firebase-tools login
npx firebase-tools init hosting
npx firebase-tools deploy --only hosting
```

### "Error: No project active"
```bash
firebase use YOUR_PROJECT_ID
```
Your project ID is in `src/config/firebase.ts` — it's the `projectId` field.

### Build succeeds but site shows blank white page
Check the browser console (F12 → Console). If you see errors about `firebase` or `api`:
- Make sure `.env.production` has the correct Render URL
- Rebuild: `npm run build && firebase deploy --only hosting`

### Forecast page shows "ML Backend offline"
1. Check if Render service is awake: visit `/api/health` URL
2. Check browser console for CORS errors
3. If CORS errors: make sure `app.py` has `CORS(app, origins="*")`
4. Push the fix, wait for Render to redeploy, test again

### Render build fails
Check the build logs on Render dashboard. Common issues:
- `requirements.txt` not found → make sure Root Directory is set to `backend`
- `ModuleNotFoundError: sklearn` → the package name is `scikit-learn` not `sklearn`
- `gunicorn not found` → make sure `gunicorn` is in `requirements.txt`

### Login works locally but not on deployed site
→ Firebase Console → Authentication → Settings → Authorized domains → Add your `.web.app` domain

### "dist" folder is empty or missing
```bash
npm run build
```
If build fails, fix the errors first. The `dist` folder is created by the build process.

---

# SUMMARY — EVERY FILE YOU CREATED OR CHANGED

| File | Action | What changed |
|------|--------|-------------|
| `src/config/api.ts` | **Created** | One-line API base URL export |
| `.env` | **Created** | `VITE_API_URL=http://localhost:5000` |
| `.env.production` | **Created** | `VITE_API_URL=https://pharmaguard-ml.onrender.com` |
| `src/pages/Forecast/index.tsx` | **Edited** | Replaced `localhost:5000` with `API_BASE` |
| `backend/app.py` | **Edited** | PORT env var, CORS origins, debug=False |
| `backend/requirements.txt` | **Created/Edited** | Added gunicorn |
| `.gitignore` | **Edited** | Added .env entries |
| `firebase.json` | **Auto-created** | Hosting config from firebase init |
| `.firebaserc` | **Auto-created** | Project ID link from firebase init |

Total files changed: 5 edited + 4 created = 9 files.

---

# FOR THE DEMO DAY

2 minutes before judges arrive:
1. Open `https://pharmaguard-ml.onrender.com/api/health` in a tab (wakes up backend)
2. Open `https://your-project-id.web.app` in Chrome
3. Log in as admin
4. Verify Dashboard loads with data
5. Keep both tabs open

You're live. Go get shortlisted.
