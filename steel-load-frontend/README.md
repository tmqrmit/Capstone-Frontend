# Steel Load — Energy Intelligence Frontend

A frontend for your `rf_model.py` Flask API: a **Dashboard** (batch predictions +
charts, like the notebook's EDA/eval plots) and a **Predict** page (single-record
form → predicted `Usage_kWh`).

## 1. Backend

Copy `backend/rf_model.py` and `backend/requirements.txt` into the **same folder**
as your existing `random_forest_model.pkl` and `random_forest_model_features.pkl`
(this replaces your current `rf_model.py` — it adds CORS support and a `/ranges`
endpoint the frontend uses; the `/dashboard` logic is untouched).

```bash
pip install -r requirements.txt
python rf_model.py
```

This serves the API at `http://localhost:3000`.

## 2. Frontend

No build step — plain HTML/CSS/JS. Just open `frontend/index.html` in a browser
(double-click it, or serve it with any static server, e.g. `python -m http.server`
from inside the `frontend` folder and visit `http://localhost:8000`).

The header shows a green "API connected" dot once it can reach the Flask server.

## What's on each page

**Dashboard**
- "Generate sample batch" creates 40 synthetic shift readings within the training
  data's real ranges and sends them to `/dashboard` — instant demo with no file needed.
- "Upload CSV" accepts a CSV with columns matching the model's inputs
  (`Lagging_Current_Reactive.Power_kVarh`, `Leading_Current_Reactive_Power_kVarh`,
  `CO2(tCO2)`, `Lagging_Current_Power_Factor`, `Leading_Current_Power_Factor`,
  `NSM`, `Load_Type`, `Day_of_week`).
- Metric cards (avg/max/min/std of predictions), a prediction-by-record line chart,
  load-type mix, feature importance, a prediction distribution histogram, and the
  full results table.

**Predict**
- Sliders + number inputs for every model feature, dropdowns for `Load_Type` and
  `Day_of_week`, an NSM → clock-time readout.
- Submits one record to `/dashboard` and shows the predicted `Usage_kWh` on a gauge,
  compared against the training-data average, plus the top features driving the
  model overall.

## Notes
- `API_BASE` is set to `http://localhost:3000` at the top of `frontend/app.js` —
  change it there if you run the API elsewhere.
- The `/ranges` endpoint has the training data's real min/max/mean baked in
  (from `Steel_industry_data.csv`), so sliders and the sample generator match
  realistic values without needing the CSV on the frontend.
