import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Flashlight,
  ImageUp,
  RefreshCw,
  ScanLine,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

export interface ScanFeedbackState {
  status: 'success' | 'error';
  code: string;
  message: string;
  timestamp: number;
}

type CameraPermissionState = 'checking' | 'granted' | 'prompt' | 'denied' | 'unsupported';

interface BarcodeScannerModalProps {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => boolean;
  soundEnabled: boolean;
  onToggleSound: () => void;
  lastScan: ScanFeedbackState | null;
  cartItemCount: number;
}

const SUPPORTED_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
];

function createBarcodeReader(): BrowserMultiFormatReader {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS);
  hints.set(DecodeHintType.TRY_HARDER, true);

  return new BrowserMultiFormatReader(hints, {
    delayBetweenScanAttempts: 160,
    delayBetweenScanSuccess: 600,
  });
}

export function BarcodeScannerModal({
  open,
  onClose,
  onDetected,
  soundEnabled,
  onToggleSound,
  lastScan,
  cartItemCount,
}: BarcodeScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const activeTrackRef = useRef<MediaStreamTrack | null>(null);

  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [requestedDeviceId, setRequestedDeviceId] = useState<string>('');
  const [activeDeviceId, setActiveDeviceId] = useState<string>('');
  const [continuousMode, setContinuousMode] = useState(true);
  const continuousRef = useRef(continuousMode);
  continuousRef.current = continuousMode;

  const [permissionState, setPermissionState] = useState<CameraPermissionState>('checking');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [retryCounter, setRetryCounter] = useState(0);

  const [manualFallback, setManualFallback] = useState('');
  const [imageError, setImageError] = useState<string | null>(null);

  const lastTriggerRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  // Monitor browser camera permission state while modal is open
  useEffect(() => {
    if (!open) return;
    let active = true;
    let permStatus: PermissionStatus | null = null;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setPermissionState('unsupported');
      return;
    }

    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      navigator.permissions
        .query({ name: 'camera' as PermissionName })
        .then((status) => {
          if (!active) return;
          permStatus = status;
          setPermissionState(status.state as CameraPermissionState);
          status.onchange = () => {
            if (active) {
              setPermissionState(status.state as CameraPermissionState);
            }
          };
        })
        .catch(() => {
          if (active) setPermissionState('prompt');
        });
    } else {
      setPermissionState('prompt');
    }

    return () => {
      active = false;
      if (permStatus) {
        permStatus.onchange = null;
      }
    };
  }, [open, retryCounter]);

  useEffect(() => {
    const stopCurrentStream = () => {
      try {
        controlsRef.current?.stop();
      } catch {
        // Ignore cleanup errors
      }
      controlsRef.current = null;
      activeTrackRef.current = null;
      setTorchSupported(false);
      setTorchEnabled(false);

      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    };

    if (!open) {
      stopCurrentStream();
      return;
    }

    let cancelled = false;
    setCameraError(null);
    setImageError(null);
    setInitializing(true);

    const startScanner = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setPermissionState('unsupported');
        setCameraError(
          'Camera access is unavailable in this browser context. Use a USB/Bluetooth scanner, upload a barcode photo, or enter codes manually.'
        );
        setInitializing(false);
        return;
      }

      try {
        const reader = createBarcodeReader();
        const videoEl = videoRef.current;
        if (!videoEl) {
          setInitializing(false);
          return;
        }

        const handleDecode = (rawText: string) => {
          const code = rawText.trim();
          if (!code) return;
          const now = Date.now();
          if (
            lastTriggerRef.current.code === code &&
            now - lastTriggerRef.current.at < 1500
          ) {
            return;
          }
          lastTriggerRef.current = { code, at: now };

          const added = onDetectedRef.current(code);
          if (added && !continuousRef.current) {
            stopCurrentStream();
            onCloseRef.current();
          }
        };

        const constraints: MediaStreamConstraints = {
          audio: false,
          video: requestedDeviceId
            ? {
                deviceId: { exact: requestedDeviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              }
            : {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
        };

        const controls = await reader.decodeFromConstraints(
          constraints,
          videoEl,
          (result) => {
            if (result) {
              handleDecode(result.getText());
            }
          }
        );

        if (cancelled) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
        setPermissionState('granted');

        // Inspect active track capabilities (deviceId + torch support) without restarting effect
        const stream = videoEl.srcObject as MediaStream | null;
        const track = stream?.getVideoTracks()[0] || null;
        activeTrackRef.current = track;
        if (track) {
          const settings = track.getSettings();
          if (settings.deviceId) {
            setActiveDeviceId(settings.deviceId);
          }
          const caps =
            typeof track.getCapabilities === 'function'
              ? (track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean })
              : null;
          setTorchSupported(Boolean(caps?.torch));
        }

        // Enumerate devices after permission is granted so human-readable labels appear
        try {
          const videoDevices = await BrowserMultiFormatReader.listVideoInputDevices();
          if (!cancelled) {
            setDevices(videoDevices);
          }
        } catch {
          // Ignore enumeration failure when stream itself succeeded
        }
      } catch (err) {
        if (cancelled) return;
        const errName = err instanceof DOMException ? err.name : '';
        const msg = err instanceof Error ? err.message : String(err);

        if (errName === 'NotAllowedError' || /Permission|NotAllowed|denied/i.test(msg)) {
          setPermissionState('denied');
          setCameraError(
            'Camera permission was denied. Allow camera access in your browser site settings and click Retry Camera.'
          );
        } else if (
          errName === 'NotFoundError' ||
          errName === 'DevicesNotFoundError' ||
          /NotFound|Requested device not found/i.test(msg)
        ) {
          setCameraError(
            'No camera hardware was detected on this terminal. Use a USB/Bluetooth scanner, scan an image, or enter SKU/EAN below.'
          );
        } else if (errName === 'NotReadableError' || /NotReadable|in use/i.test(msg)) {
          setCameraError(
            'Camera is currently in use by another application or tab. Close the other camera stream and click Retry Camera.'
          );
        } else {
          setCameraError(
            `Unable to start camera (${msg}). You can upload a barcode photo or enter SKU/EAN codes manually.`
          );
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    };

    void startScanner();

    return () => {
      cancelled = true;
      stopCurrentStream();
    };
  }, [open, requestedDeviceId, retryCounter]);

  if (!open) return null;

  const handleToggleTorch = async () => {
    const track = activeTrackRef.current;
    if (!track || !torchSupported) return;
    const nextTorch = !torchEnabled;
    try {
      await track.applyConstraints({
        advanced: [{ torch: nextTorch } as unknown as MediaTrackConstraintSet],
      });
      setTorchEnabled(nextTorch);
    } catch {
      setTorchSupported(false);
    }
  };

  const handleScanImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImageError(null);
    const objectUrl = URL.createObjectURL(file);
    try {
      const reader = createBarcodeReader();
      const result = await reader.decodeFromImageUrl(objectUrl);
      const code = result.getText().trim();
      if (code) {
        const added = onDetectedRef.current(code);
        if (added && !continuousMode) {
          onCloseRef.current();
        }
      }
    } catch {
      setImageError('No readable EAN, UPC, Code 128, or QR barcode detected in that image.');
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualFallback.trim();
    if (!trimmed) return;
    const ok = onDetectedRef.current(trimmed);
    if (ok) {
      setManualFallback('');
      if (!continuousMode) {
        onCloseRef.current();
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Camera Barcode Scanner</h3>
              <p className="text-[11px] text-slate-500 tabular-nums">
                EAN-13, EAN-8, UPC, Code 128 SKU &amp; QR · Cart: {cartItemCount} item(s)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {torchSupported && !cameraError && (
              <button
                type="button"
                onClick={() => void handleToggleTorch()}
                className={`p-2 rounded-lg border transition-colors ${
                  torchEnabled
                    ? 'bg-amber-50 border-amber-300 text-amber-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
                title={torchEnabled ? 'Turn off flashlight' : 'Turn on flashlight'}
                aria-label="Toggle camera flashlight"
              >
                <Flashlight className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onToggleSound}
              className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
              title={soundEnabled ? 'Mute scanner beep' : 'Enable scanner beep'}
              aria-label={soundEnabled ? 'Mute scanner beep' : 'Enable scanner beep'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => onCloseRef.current()}
              className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
              aria-label="Close scanner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Camera Viewport */}
        <div className="p-4 space-y-3">
          <div className="relative aspect-[4/3] w-full rounded-xl bg-slate-950 overflow-hidden flex items-center justify-center">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              muted
              playsInline
              autoPlay
            />

            {/* Reticle Overlay */}
            {!cameraError && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="w-3/4 h-2/5 border-2 border-emerald-400/90 rounded-lg shadow-[0_0_0_9999px_rgba(15,23,42,0.35)] flex items-center justify-center">
                  <div className="w-full h-0.5 bg-emerald-400/80" />
                </div>
              </div>
            )}

            {initializing && !cameraError && (
              <div className="absolute inset-0 bg-slate-950/75 flex flex-col items-center justify-center text-white gap-2 px-4 text-center">
                <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
                <span className="text-xs font-medium">
                  {permissionState === 'prompt'
                    ? 'Waiting for camera permission prompt...'
                    : 'Starting camera feed...'}
                </span>
              </div>
            )}

            {cameraError && (
              <div className="absolute inset-0 bg-slate-900 p-6 flex flex-col items-center justify-center text-center gap-3">
                <AlertCircle className="w-7 h-7 text-amber-400" />
                <p className="text-xs text-slate-200 leading-relaxed max-w-sm">{cameraError}</p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setRetryCounter((c) => c + 1)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry Camera
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-medium"
                  >
                    <ImageUp className="w-3.5 h-3.5" />
                    Scan Image
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <label className="inline-flex items-center gap-2 text-slate-700 font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={continuousMode}
                onChange={(e) => setContinuousMode(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600"
              />
              <span>Continuous multi-item scan</span>
            </label>

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => void handleScanImageFile(e)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
                title="Decode a barcode from an image file"
              >
                <ImageUp className="w-3.5 h-3.5" />
                Scan Image
              </button>

              {devices.length > 1 && (
                <select
                  value={requestedDeviceId || activeDeviceId}
                  onChange={(e) => setRequestedDeviceId(e.target.value)}
                  aria-label="Select camera device"
                  className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white text-xs text-slate-700 max-w-[180px]"
                >
                  {devices.map((d, idx) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${idx + 1}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {imageError && (
            <div className="rounded-lg px-3 py-2 border border-amber-200 bg-amber-50 text-xs text-amber-900 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{imageError}</span>
            </div>
          )}

          {/* Live Last Scan Status */}
          {lastScan && (
            <div
              className={`rounded-lg px-3 py-2 border text-xs flex items-center gap-2 ${
                lastScan.status === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              {lastScan.status === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <div className="min-w-0 flex-1 truncate">
                <span className="font-mono font-semibold mr-1.5">[{lastScan.code}]</span>
                <span>{lastScan.message}</span>
              </div>
            </div>
          )}

          {/* Fallback manual SKU / EAN entry inside modal */}
          <form onSubmit={handleManualSubmit} className="flex items-center gap-2 pt-1">
            <div className="relative flex-1">
              <ScanLine className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={manualFallback}
                onChange={(e) => setManualFallback(e.target.value)}
                placeholder="Type EAN, SKU, or 3*code..."
                className="w-full pl-9 pr-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
              />
            </div>
            <button
              type="submit"
              className="px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => onCloseRef.current()}
              className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Done
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
