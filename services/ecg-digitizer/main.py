"""
ECG Digitizer microservice — Project Docpad
==========================================
FastAPI endpoint that accepts a photograph of a 12-lead ECG and returns
the extracted rhythm strip (Lead II) as clinical data points.
"""

from __future__ import annotations

import io
from typing import List, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from scipy.signal import savgol_filter, medfilt

app = FastAPI(title="ECG Digitizer", version="0.4.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["*"],
)

# ─── Tuning constants ─────────────────────────────────────────────────────────
OUTER_CROP_FRAC = 0.05

PINK_HSV_LOW_A  = np.array([0,   20, 80],  dtype=np.uint8)
PINK_HSV_HIGH_A = np.array([15,  255, 255], dtype=np.uint8)
PINK_HSV_LOW_B  = np.array([155, 20, 80],  dtype=np.uint8)
PINK_HSV_HIGH_B = np.array([179, 255, 255], dtype=np.uint8)
PINK_CLOSE_KERNEL  = 25
PINK_MIN_AREA_FRAC = 0.10

LEAD_II_SEARCH_TOP_FRAC       = 0.60
LEAD_II_FALLBACK_TOP_FRAC     = 0.66
LEAD_II_FALLBACK_BOT_FRAC     = 0.78
LEAD_II_FOOTER_EXCLUSION_FRAC = 0.84   # Squeeze: Move up to clear 'Device:' text
LEAD_II_INK_ROW_BRIGHTNESS    = 210
LEAD_II_MIN_HEIGHT_FRAC       = 0.05
LEAD_II_MAX_HEIGHT_FRAC       = 0.32

LEAD_II_LEFT_LABEL_FRAC = 0.08
SAVGOL_WINDOW = 15
SAVGOL_POLY   = 3

# ─── Geometry & Orientation ──────────────────────────────────────────────────
def _pink_mask(hsv: np.ndarray) -> np.ndarray:
    return cv2.bitwise_or(
        cv2.inRange(hsv, PINK_HSV_LOW_A, PINK_HSV_HIGH_A),
        cv2.inRange(hsv, PINK_HSV_LOW_B, PINK_HSV_HIGH_B),
    )

def orient_landscape(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    return cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE) if h > w else img

def crop_outer_margin(img: np.ndarray, frac: float = OUTER_CROP_FRAC) -> np.ndarray:
    h, w = img.shape[:2]
    dx, dy = int(w * frac), int(h * frac)
    return img[dy : h - dy, dx : w - dx]

def detect_paper_and_warp(img_bgr: np.ndarray) -> np.ndarray:
    h_img, w_img = img_bgr.shape[:2]
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    pink = _pink_mask(hsv)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (PINK_CLOSE_KERNEL, PINK_CLOSE_KERNEL))
    pink = cv2.morphologyEx(pink, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(pink, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours: return img_bgr
    largest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest) < h_img * w_img * PINK_MIN_AREA_FRAC: return img_bgr
    x, y, w, h = cv2.boundingRect(largest)
    return img_bgr[y : y + h, x : x + w]

def correct_orientation(img_bgr: np.ndarray) -> np.ndarray:
    return cv2.rotate(img_bgr, cv2.ROTATE_180)

# ─── Lead II Localisation ────────────────────────────────────────────────────
def find_lead_ii_bounds(paper_bgr: np.ndarray) -> Tuple[int, int]:
    h, w = paper_bgr.shape[:2]
    fb_y0 = int(h * LEAD_II_FALLBACK_TOP_FRAC)
    fb_y1 = int(h * LEAD_II_FALLBACK_BOT_FRAC)
    footer_limit = int(h * LEAD_II_FOOTER_EXCLUSION_FRAC)
    
    gray = cv2.cvtColor(paper_bgr, cv2.COLOR_BGR2GRAY)
    cx0, cx1 = int(w * 0.10), int(w * 0.90)
    row_mean = gray[:, cx0:cx1].mean(axis=1)
    
    is_inked = row_mean < LEAD_II_INK_ROW_BRIGHTNESS
    search_top = int(h * LEAD_II_SEARCH_TOP_FRAC)
    search_bot = footer_limit - 1
    
    y = search_bot
    while y > search_top and not is_inked[y]:
        y -= 1
    if y <= search_top: return fb_y0, fb_y1
    
    bottom, top = y, y
    while y > search_top:
        if is_inked[y]: 
            y -= 1
            top = y
            continue
        break
        
    strip_h = bottom - top
    if strip_h < int(h * LEAD_II_MIN_HEIGHT_FRAC) or strip_h > int(h * LEAD_II_MAX_HEIGHT_FRAC):
        return fb_y0, fb_y1
    return top, bottom + 1

def crop_lead_label(strip_roi: np.ndarray) -> Tuple[np.ndarray, int]:
    margin = int(strip_roi.shape[1] * LEAD_II_LEFT_LABEL_FRAC)
    return strip_roi[:, margin:], margin

# ─── Signal Extraction ────────────────────────────────────────────────────────
def isolate_ink(img_bgr: np.ndarray) -> np.ndarray:
    green = img_bgr[:, :, 1]
    green = cv2.equalizeHist(green)
    binary = cv2.adaptiveThreshold(
        green, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 41, 12
    )
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    binary[_pink_mask(hsv) > 0] = 0
    
    # Blob Filter: Remove noise specks smaller than 10 pixels
    num, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    for i in range(1, num):
        if stats[i, cv2.CC_STAT_AREA] < 10:
            binary[labels == i] = 0
    
    return cv2.morphologyEx(binary, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 2)))

def extract_signal(binary_slice: np.ndarray) -> np.ndarray:
    h, w = binary_slice.shape
    signal = np.full(w, np.nan)
    for x in range(w):
        col = binary_slice[:, x]
        if col.any():
            signal[x] = np.median(np.where(col > 0)[0])
    
    nan_mask = np.isnan(signal)
    if nan_mask.any() and (~nan_mask).sum() >= 2:
        signal[nan_mask] = np.interp(np.flatnonzero(nan_mask), np.flatnonzero(~nan_mask), signal[~nan_mask])
    return np.nan_to_num(signal)

def smooth_signal(signal: np.ndarray) -> np.ndarray:
    med = medfilt(signal, kernel_size=9)
    win = min(SAVGOL_WINDOW, signal.size if signal.size % 2 == 1 else signal.size - 1)
    win = max(win if win % 2 == 1 else win - 1, 5)
    return savgol_filter(med, window_length=win, polyorder=SAVGOL_POLY)

def signal_to_points(signal: np.ndarray, x_offset: int = 0) -> List[dict]:
    h_ref = float(signal.max()) if signal.size else 0.0
    return [{"x": int(x) + x_offset, "y": round(h_ref - float(signal[x]), 2)} for x in range(signal.size)]

# ─── Calibration ──────────────────────────────────────────────────────────────
def detect_grid_pitch(paper_bgr: np.ndarray) -> Tuple[Optional[float], Optional[float]]:
    hsv = cv2.cvtColor(paper_bgr, cv2.COLOR_BGR2HSV)
    pink = _pink_mask(hsv)
    h, w = paper_bgr.shape[:2]
    band = pink[h//2 - 20 : h//2 + 20, :]
    if band.size == 0: return None, None
    row_slice = band.mean(axis=0).astype(np.float32)
    fft = np.abs(np.fft.rfft(row_slice - row_slice.mean()))
    fft[0] = 0
    freq_min, freq_max = max(1, int(w/40)), max(2, int(w/4))
    search = fft[freq_min:freq_max]
    if search.size == 0 or search.max() < 1.0: return None, None
    px_per_sq = w / (np.argmax(search) + freq_min)
    return (round(px_per_sq, 2), round(px_per_sq, 2)) if 4.0 <= px_per_sq <= 40.0 else (None, None)

# ─── Pipeline Execution ───────────────────────────────────────────────────────
async def _decode_upload(file: UploadFile) -> np.ndarray:
    raw = await file.read()
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None: raise HTTPException(status_code=400, detail="Invalid image")
    return img

def _run_pipeline(img_bgr: np.ndarray):
    img = crop_outer_margin(orient_landscape(img_bgr))
    paper = detect_paper_and_warp(img)
    paper = correct_orientation(paper)
    y0, y1 = find_lead_ii_bounds(paper)
    roi_clean, margin = crop_lead_label(paper[y0:y1, :])
    binary = isolate_ink(roi_clean)
    signal = smooth_signal(extract_signal(binary))
    return paper, binary, y0, y1, signal, margin

# ─── Endpoints ────────────────────────────────────────────────────────────────
@app.post("/digitize")
async def digitize_ecg(file: UploadFile = File(...)):
    img = await _decode_upload(file)
    paper, _, _, _, signal, margin = _run_pipeline(img)
    px_x, px_y = detect_grid_pitch(paper)
    cal = {"px_per_mm": px_x, "ms_per_px": round(40.0/px_x, 4), "mv_per_px": round(0.1/px_y, 6)} if px_x else None
    return {"lead_II": signal_to_points(signal, x_offset=margin), "calibration": cal}

@app.post("/debug-ecg")
async def debug_ecg(file: UploadFile = File(...)):
    img = await _decode_upload(file)
    paper, binary, y0, y1, signal, margin = _run_pipeline(img)
    
    # Generate 4-panel debug composite
    h, w = paper.shape[:2]
    p1 = paper.copy() # Crop + Orient
    
    p2 = paper.copy() # Bounds
    footer_y = int(h * LEAD_II_FOOTER_EXCLUSION_FRAC)
    cv2.line(p2, (0, footer_y), (w, footer_y), (0, 100, 255), 2)
    cv2.line(p2, (0, y0), (w, y0), (0, 255, 0), 2)
    cv2.line(p2, (0, y1), (w, y1), (0, 255, 0), 2)
    
    p3 = np.zeros((h, w, 3), dtype=np.uint8) # Mask
    bw, bh = binary.shape[1], binary.shape[0]
    p3[y0:y0+bh, margin:margin+bw] = cv2.cvtColor(binary, cv2.COLOR_GRAY2BGR)
    
    p4 = paper.copy() # Overlay
    xs = np.arange(signal.size) + margin
    ys = np.clip((signal + y0).astype(np.int32), 0, h - 1)
    cv2.polylines(p4, [np.stack([xs, ys], axis=1)], False, (0, 255, 0), 2)
    
    composite = np.vstack([p1, p2, p3, p4])
    _, encoded = cv2.imencode(".png", composite)
    return StreamingResponse(io.BytesIO(encoded.tobytes()), media_type="image/png")

@app.get("/health")
def health(): return {"status": "ok"}