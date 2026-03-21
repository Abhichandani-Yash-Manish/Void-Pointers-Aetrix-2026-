"""
PharmaGuard Gujarat — ML Forecasting Backend
Flask API using scikit-learn LinearRegression for drug demand prediction.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score
import numpy as np
from datetime import datetime, timedelta

# ── App setup ──────────────────────────────────────────────────────────────────

app = Flask(__name__)

# Allow requests from both Vite dev server ports
CORS(app, origins=["http://localhost:5173", "http://localhost:5174"])


# ── Constants ──────────────────────────────────────────────────────────────────

MIN_DATA_POINTS = 4          # Minimum history entries required for a meaningful fit
PREDICTION_WEEKS = 4         # Number of weekly forecast points to return
REORDER_HORIZON_DAYS = 30    # Flag for reorder if stockout expected within this window
BUFFER_FACTOR = 1.2          # 20 % safety buffer on suggested reorder quantity
TREND_SLOPE_THRESHOLD = 0.5  # |slope| > this → increasing/decreasing, else stable


# ── Core prediction logic ──────────────────────────────────────────────────────

def run_prediction(drug_id: str, drug_name: str, current_stock: float,
                   reorder_level: float, history: list) -> dict:
    """
    Fit a LinearRegression on weekly dispense history and return
    predictions, quality metrics, and a reorder suggestion.

    Parameters
    ----------
    drug_id        : Firestore document ID of the drug
    drug_name      : Human-readable drug name
    current_stock  : Current on-hand quantity
    reorder_level  : Configured reorder threshold
    history        : List of {"date": "YYYY-MM-DD", "quantity": <float>} dicts

    Returns
    -------
    dict with keys: drugId, drugName, predictions, metrics, reorder_suggestion
    Raises ValueError for edge-case inputs (handled by callers).
    """

    # ── 1. Validate and parse history ──────────────────────────────────────────
    if not history or len(history) < MIN_DATA_POINTS:
        raise ValueError(
            f"Insufficient data: need at least {MIN_DATA_POINTS} data points, "
            f"got {len(history) if history else 0}."
        )

    # Sort chronologically so day-numbering is always ascending
    history_sorted = sorted(history, key=lambda x: x["date"])

    # Parse dates; skip entries with unparseable dates
    parsed = []
    for entry in history_sorted:
        try:
            dt  = datetime.strptime(entry["date"], "%Y-%m-%d")
            qty = float(entry["quantity"])
            parsed.append((dt, qty))
        except (ValueError, KeyError):
            continue  # silently skip malformed rows

    if len(parsed) < MIN_DATA_POINTS:
        raise ValueError(
            f"Insufficient valid data points after parsing ({len(parsed)} valid)."
        )

    # ── 2. Build feature matrix ─────────────────────────────────────────────
    # X = days since the first data point (numeric time index)
    # y = weekly quantity dispensed
    origin = parsed[0][0]
    X_raw  = np.array([(dt - origin).days for dt, _ in parsed], dtype=float)
    y      = np.array([qty for _, qty in parsed], dtype=float)

    # Guard: if every quantity is zero the model is trivially useless
    if y.sum() == 0:
        raise ValueError("All dispensed quantities are zero — cannot build a meaningful forecast.")

    X = X_raw.reshape(-1, 1)

    # ── 3. Fit LinearRegression ────────────────────────────────────────────────
    model = LinearRegression()
    model.fit(X, y)

    slope     = float(model.coef_[0])
    intercept = float(model.intercept_)

    # ── 4. Quality metrics ─────────────────────────────────────────────────────
    y_pred_train = model.predict(X)

    # R² — how well the line fits historical data (1.0 = perfect)
    r2 = float(r2_score(y, y_pred_train))

    # MAPE — mean absolute percentage error (lower = better)
    # Use max(actual, 1) to avoid division-by-zero on zero-quantity weeks
    abs_pct_errors = np.abs(y - y_pred_train) / np.maximum(y, 1)
    mape = float(np.mean(abs_pct_errors) * 100)

    # Trend classification
    if slope > TREND_SLOPE_THRESHOLD:
        trend = "increasing"
    elif slope < -TREND_SLOPE_THRESHOLD:
        trend = "decreasing"
    else:
        trend = "stable"

    # ── 5. Future predictions (4 weekly points) ────────────────────────────────
    # Start from the day after the last historical entry
    last_date    = parsed[-1][0]
    last_day_num = float((last_date - origin).days)

    predictions = []
    for week in range(1, PREDICTION_WEEKS + 1):
        future_day  = last_day_num + (week * 7)
        future_date = last_date + timedelta(days=week * 7)
        pred_qty    = float(model.predict(np.array([[future_day]]))[0])
        # Demand cannot be negative
        pred_qty = max(pred_qty, 0.0)
        predictions.append({
            "date":               future_date.strftime("%Y-%m-%d"),
            "predicted_quantity": round(pred_qty, 2),
        })

    # ── 6. Reorder suggestion ──────────────────────────────────────────────────
    # Average weekly demand from history (use only positive values)
    avg_weekly_demand = float(np.mean(y[y > 0])) if (y > 0).any() else 0.0
    avg_daily_demand  = avg_weekly_demand / 7.0

    if avg_daily_demand > 0:
        days_until_stockout = int(round(current_stock / avg_daily_demand))
    else:
        days_until_stockout = 9999  # effectively infinite

    should_reorder = (
        days_until_stockout < REORDER_HORIZON_DAYS
        or current_stock <= reorder_level
    )

    # Predicted 30-day demand = sum of the 4 weekly predictions
    predicted_30day = sum(p["predicted_quantity"] for p in predictions)
    suggested_qty   = int(round(predicted_30day * BUFFER_FACTOR))

    if days_until_stockout >= 9999:
        reason = "No demand detected — stock sufficient indefinitely."
    elif should_reorder:
        reason = (
            f"Stock will deplete in ~{days_until_stockout} day"
            f"{'s' if days_until_stockout != 1 else ''} based on current trend."
        )
    else:
        reason = (
            f"Stock sufficient for ~{days_until_stockout} days. "
            "Monitor if trend is increasing."
        )

    # ── 7. Build response ──────────────────────────────────────────────────────
    return {
        "drugId":   drug_id,
        "drugName": drug_name,
        "predictions": predictions,
        "metrics": {
            "r2_score":  round(r2,    4),
            "mape":      round(mape,  2),
            "trend":     trend,
            "slope":     round(slope, 4),
            "intercept": round(intercept, 4),
        },
        "reorder_suggestion": {
            "should_reorder":      should_reorder,
            "suggested_quantity":  suggested_qty,
            "days_until_stockout": days_until_stockout,
            "reason":              reason,
        },
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    """Quick liveness check used by the frontend to confirm the ML server is up."""
    return jsonify({
        "status":  "ok",
        "model":   "linear_regression",
        "version": "1.0",
    })


@app.post("/api/predict")
def predict():
    """
    Single-drug demand forecast.

    Expected request body
    ---------------------
    {
        "drugId":       "drug_01",
        "drugName":     "Paracetamol 500mg",
        "currentStock": 500,
        "reorderLevel": 200,
        "history": [
            { "date": "2025-10-15", "quantity": 42 },
            ...
        ]
    }
    """
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "Request body must be valid JSON."}), 400

    # Extract required fields
    drug_id       = body.get("drugId",       "")
    drug_name     = body.get("drugName",     "Unknown")
    current_stock = float(body.get("currentStock", 0))
    reorder_level = float(body.get("reorderLevel", 0))
    history       = body.get("history",      [])

    if not drug_id:
        return jsonify({"error": "Missing required field: drugId"}), 400

    try:
        result = run_prediction(
            drug_id, drug_name, current_stock, reorder_level, history
        )
        return jsonify(result)
    except ValueError as e:
        return jsonify({"drugId": drug_id, "error": str(e)}), 422
    except Exception as e:
        return jsonify({"drugId": drug_id, "error": f"Internal error: {str(e)}"}), 500


@app.post("/api/predict-all")
def predict_all():
    """
    Batch forecast for multiple drugs in one request.

    Expected request body
    ---------------------
    {
        "drugs": [
            {
                "drugId":       "drug_01",
                "drugName":     "Paracetamol 500mg",
                "currentStock": 500,
                "reorderLevel": 200,
                "history":      [ { "date": "...", "quantity": 42 }, ... ]
            },
            ...
        ]
    }

    Returns an array — each element is either a full prediction result
    or an error object: { "drugId": "...", "error": "<reason>" }.
    """
    body = request.get_json(silent=True)
    if not body or "drugs" not in body:
        return jsonify({"error": "Request body must contain a 'drugs' array."}), 400

    drugs = body["drugs"]
    if not isinstance(drugs, list):
        return jsonify({"error": "'drugs' must be an array."}), 400

    results = []
    for drug in drugs:
        drug_id       = drug.get("drugId",       "")
        drug_name     = drug.get("drugName",     "Unknown")
        current_stock = float(drug.get("currentStock", 0))
        reorder_level = float(drug.get("reorderLevel", 0))
        history       = drug.get("history",      [])

        try:
            result = run_prediction(
                drug_id, drug_name, current_stock, reorder_level, history
            )
            results.append(result)
        except ValueError as e:
            results.append({"drugId": drug_id, "error": str(e)})
        except Exception as e:
            results.append({"drugId": drug_id, "error": f"Internal error: {str(e)}"})

    return jsonify(results)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("PharmaGuard Gujarat — ML Backend")
    print("Model : LinearRegression (scikit-learn)")
    print("Server: http://localhost:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
