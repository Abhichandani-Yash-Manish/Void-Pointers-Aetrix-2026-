# PharmaGuard Gujarat — ML Backend

Flask API that provides demand forecasting using `scikit-learn` LinearRegression.
The frontend aggregates Firestore dispense logs into weekly data points and posts
them here; the backend returns 4-week predictions, quality metrics, and a
reorder suggestion.

## Setup

```bash
cd backend
pip install -r requirements.txt
python app.py
```

Server runs at **http://localhost:5000**

---

## Endpoints

### `GET /api/health`
Liveness check. Returns:
```json
{ "status": "ok", "model": "linear_regression", "version": "1.0" }
```

---

### `POST /api/predict`
Single-drug demand forecast.

**Request body**
```json
{
  "drugId":       "drug_01",
  "drugName":     "Paracetamol 500mg",
  "currentStock": 500,
  "reorderLevel": 200,
  "history": [
    { "date": "2025-10-15", "quantity": 42 },
    { "date": "2025-10-22", "quantity": 38 }
  ]
}
```

**Response**
```json
{
  "drugId":   "drug_01",
  "drugName": "Paracetamol 500mg",
  "predictions": [
    { "date": "2026-04-01", "predicted_quantity": 35.2 },
    { "date": "2026-04-08", "predicted_quantity": 36.1 },
    { "date": "2026-04-15", "predicted_quantity": 37.0 },
    { "date": "2026-04-22", "predicted_quantity": 37.9 }
  ],
  "metrics": {
    "r2_score":  0.82,
    "mape":      7.8,
    "trend":     "increasing",
    "slope":     0.5,
    "intercept": 20.3
  },
  "reorder_suggestion": {
    "should_reorder":      true,
    "suggested_quantity":  500,
    "days_until_stockout": 18,
    "reason": "Stock will deplete in ~18 days based on current trend."
  }
}
```

Returns HTTP 422 with `{ "drugId": "...", "error": "..." }` if fewer than 4 data points are provided.

---

### `POST /api/predict-all`
Batch forecast for multiple drugs in one round-trip.

**Request body**
```json
{
  "drugs": [
    { "drugId": "drug_01", "drugName": "...", "currentStock": 500, "reorderLevel": 200, "history": [...] },
    { "drugId": "drug_02", "drugName": "...", "currentStock": 120, "reorderLevel": 100, "history": [...] }
  ]
}
```

**Response** — array of results (same shape as `/api/predict`).
Drugs with insufficient history return `{ "drugId": "...", "error": "Insufficient data" }`.

---

## Model details

| Parameter | Value |
|---|---|
| Algorithm | `sklearn.linear_model.LinearRegression` |
| Feature | Days since first dispense event (numeric) |
| Target | Weekly dispensed quantity |
| Min data points | 4 weeks |
| Forecast horizon | 4 weeks (28 days) |
| Reorder horizon | 30 days |
| Safety buffer | 20% over predicted 30-day demand |
| Trend threshold | slope > ±0.5 units/day |
