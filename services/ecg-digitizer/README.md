# ECG Digitizer

FastAPI microservice that converts a photograph of a 12-lead ECG into plottable waveform coordinates.

## Setup

```bash
cd services/ecg-digitizer
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## Usage

```bash
curl -X POST http://localhost:8000/digitize \
  -F "file=@ecg_photo.jpg"
```

Response:

```json
{
  "lead_II": [
    { "x": 0, "y": 142.31 },
    { "x": 1, "y": 140.88 },
    ...
  ]
}
```

### Visual debugging

When tuning a new ECG template, hit the `/debug-ecg` endpoint instead — it
returns a single PNG stacking the cropped input, the binary ink mask, and the
cropped input with the extracted waveform drawn in bright green:

```bash
curl -X POST http://localhost:8000/debug-ecg \
  -F "file=@ecg_photo.jpg" \
  --output debug.png
open debug.png
```

Use it to verify that panel 2 cleanly isolates the traces (no grid bleed,
no shadow false-positives) and that panel 3's green line hugs the Lead II
rhythm strip.

## Pipeline

1. **Orient** — rotate 90° CW if portrait
2. **Crop** — remove outer 5% (fingers, table)
3. **Ink isolation** — HSV mask (V ≤ 120) keeps only dark ink; drops paper + pink grid
4. **Adaptive threshold** — handles shadows and paper creases via local gaussian
5. **Extract** — column-wise median Y of ink pixels; NaN gaps linearly interpolated
6. **Smooth** — Savitzky-Golay (window 31, order 3)
7. **Slice** — bottom 20% of the page is treated as the Lead II rhythm strip
8. **Flip** — Y is inverted so higher voltages plot upward in the chart

## Tuning knobs (top of `main.py`)

| Constant | Purpose |
|---|---|
| `INK_HSV_UPPER` | Raise V (e.g. 140) if ink is faded; lower if grid pollutes mask |
| `ADAPTIVE_BLOCK_SIZE` | Increase on very shadow-heavy photos |
| `SAVGOL_WINDOW` | Larger = smoother (loses sharp QRS peaks); smaller = noisier |
| `RHYTHM_STRIP_BOTTOM_FRAC` | Adjust if Lead II sits higher on a different ECG template |
