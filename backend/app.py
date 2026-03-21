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
    # X = sequential week index (0, 1, 2, …) — slope is units/week change per week
    # y = weekly quantity dispensed (all entries, including zeros, are valid)
    y = np.array([qty for _, qty in parsed], dtype=float)

    # Guard: if every quantity is zero the model is trivially useless
    if y.sum() == 0:
        raise ValueError("All dispensed quantities are zero — cannot build a meaningful forecast.")

    X = np.arange(len(parsed)).reshape(-1, 1)  # 0, 1, 2, 3, ...

    # ── 3. Fit LinearRegression ────────────────────────────────────────────────
    model = LinearRegression()
    model.fit(X, y)

    slope     = float(model.coef_[0])
    intercept = float(model.intercept_)

    # ── 4. Quality metrics ─────────────────────────────────────────────────────
    y_pred_train = model.predict(X)

    # R² — how well the line fits historical data (1.0 = perfect)
    r2 = float(r2_score(y, y_pred_train))

    # MAE — mean absolute error; interpretable, no division-by-zero issues
    mae = float(np.mean(np.abs(y - y_pred_train)))

    # SMAPE — symmetric, handles zero-demand weeks better than MAPE
    denominator  = np.abs(y) + np.abs(y_pred_train)
    smape_values = np.where(denominator == 0, 0, 2 * np.abs(y - y_pred_train) / denominator)
    smape        = float(np.mean(smape_values) * 100)

    # MAPE — kept for backward compatibility; zero-demand weeks contribute 0 error
    mape_values = np.where(y == 0, 0, np.abs((y - y_pred_train) / np.where(y == 0, 1, y)))
    mape        = float(np.mean(mape_values) * 100)

    # Trend classification — slope is now units/week change per week (threshold: ±2)
    avg_demand     = float(np.mean(y))
    relative_slope = (slope / avg_demand * 100) if avg_demand > 0 else 0.0  # % per week

    if slope > 2:
        trend = "increasing"
    elif slope < -2:
        trend = "decreasing"
    else:
        trend = "stable"

    # ── 5. Future predictions (4 weekly points) ────────────────────────────────
    # Use week indices beyond training range; dates advance by 7 days per week
    last_date     = parsed[-1][0]
    last_week_idx = len(parsed) - 1
    future_X      = np.array([[last_week_idx + i] for i in range(1, PREDICTION_WEEKS + 1)])
    raw_predictions = model.predict(future_X)

    predictions = []
    for i, pred in enumerate(raw_predictions, start=1):
        future_date = last_date + timedelta(weeks=i)
        pred_qty    = max(float(pred), 0.0)  # demand cannot be negative
        predictions.append({
            "date":               future_date.strftime("%Y-%m-%d"),
            "predicted_quantity": round(pred_qty, 2),
        })

    # ── 6. Reorder suggestion ──────────────────────────────────────────────────
    # Use ML-predicted demand (not historical average) for stockout calculation
    predicted_4week_demand = float(np.sum(np.maximum(raw_predictions, 0)))
    predicted_weekly_avg   = predicted_4week_demand / 4.0

    if predicted_weekly_avg > 0:
        predicted_daily_demand = predicted_weekly_avg / 7.0
        days_until_stockout    = round(current_stock / predicted_daily_demand, 1)
    else:
        days_until_stockout = 9999  # effectively infinite

    should_reorder = (
        days_until_stockout < REORDER_HORIZON_DAYS
        or current_stock <= reorder_level
    )

    suggested_qty = max(round(predicted_4week_demand * BUFFER_FACTOR), 0)

    if days_until_stockout >= 9999:
        reason = "No demand predicted — stock sufficient indefinitely."
    else:
        reason = (
            f"Based on ML predictions, stock will deplete in ~{days_until_stockout} days. "
            f"Predicted 4-week demand: {round(predicted_4week_demand)} units."
        )
        if current_stock <= reorder_level:
            reason += (
                f" Current stock ({int(current_stock)}) is at or below "
                f"reorder level ({int(reorder_level)})."
            )

    # ── 7. Build response ──────────────────────────────────────────────────────
    return {
        "drugId":   drug_id,
        "drugName": drug_name,
        "predictions": predictions,
        "metrics": {
            "r2_score":           round(r2,             3),
            "mae":                round(mae,            2),
            "smape":              round(smape,          2),
            "mape":               round(mape,           2),
            "slope":              round(slope,          4),
            "intercept":          round(intercept,      4),
            "trend":              trend,
            "relative_slope_pct": round(relative_slope, 2),
            "avg_weekly_demand":  round(avg_demand,     2),
        },
        "reorder_suggestion": {
            "should_reorder":      should_reorder,
            "suggested_quantity":  int(suggested_qty),
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
