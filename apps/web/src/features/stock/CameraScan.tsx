import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { serialFromBarcode } from './scanning';

function cameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'ไม่ได้รับอนุญาตให้ใช้กล้อง: เปิดสิทธิ์กล้องให้เว็บนี้ในการตั้งค่าเบราว์เซอร์ แล้วกดใหม่';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'ไม่พบกล้องในเครื่องนี้';
  if (name === 'NotReadableError') return 'กล้องถูกแอปอื่นใช้อยู่: ปิดแอปนั้นแล้วลองใหม่';
  return 'เปิดกล้องไม่ได้ ใช้เครื่องสแกนหรือพิมพ์ SN แทน';
}

/**
 * D108: the phone camera as a barcode scanner. Reads the box label, keeps only what can be a serial or an IMEI
 * (`serialFromBarcode`) and hands each new one to `onScan`, the same way as a scanner's Enter. A serial the order already has
 * (`skip`) is passed over, not counted. Several candidates in one frame (e.g. IMEI and IMEI2): STOCK taps the right one.
 * After each serial the camera holds until "สแกนเครื่องถัดไป": everything else it reads meanwhile belongs to the same box (an
 * iPhone's IMEI2) and is set aside for good, so it never becomes the next unit. Closes once `expect` serials are read.
 */
export function CameraScan({
  title,
  expect,
  skip,
  problem,
  accepts,
  onScan,
  onClose,
}: {
  title: string;
  /** the serials the order already has (saved or being saved) */
  skip: string[];
  /** the server's answer when it did not take the last serial of this product (e.g. the unit is in another open order) */
  problem?: string;
  /** units of this product still without a serial when the camera opened */
  expect: number;
  /** D125: only the kind of number this product carries (an iPhone's IMEI, not its serial); default: any serial or IMEI */
  accepts?: (sn: string) => boolean;
  onScan: (sn: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [choices, setChoices] = useState<string[]>([]);
  const [got, setGot] = useState<string[]>([]);
  const gotRef = useRef<string[]>([]);
  // `choosing`: several candidates on screen; `holding`: a serial was just taken, waiting for the next box
  const choosing = useRef(false);
  const holding = useRef(false);
  const [held, setHeld] = useState('');
  /** barcodes of a box already done (the other candidates of a choice, whatever was read while holding) */
  const setAside = useRef(new Set<string>());
  const latest = useRef({ onScan, onClose, expect, skip, accepts });
  useEffect(() => {
    latest.current = { onScan, onClose, expect, skip, accepts };
  });

  const accept = (sn: string) => {
    if (gotRef.current.includes(sn)) return;
    gotRef.current = [...gotRef.current, sn];
    setGot(gotRef.current);
    latest.current.onScan(sn);
    navigator.vibrate?.(60);
    if (gotRef.current.length >= latest.current.expect) {
      latest.current.onClose();
      return;
    }
    holding.current = true;
    setHeld(sn);
  };

  const nextBox = () => {
    holding.current = false;
    setHeld('');
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        const video = videoRef.current;
        if (stopped || !video) return;
        video.srcObject = stream;
        await video.play();
        const { makeDetector } = await import('./barcode');
        const detector = await makeDetector();
        if (stopped) return;
        setStarting(false);
        const tick = async () => {
          if (stopped) return;
          if (!choosing.current && video.readyState >= 2) {
            try {
              const read = await detector.detect(video);
              const fresh = [
                ...new Set(read.map((one) => serialFromBarcode(one.rawValue)).filter((sn): sn is string => Boolean(sn))),
              ].filter(
                (sn) =>
                  !gotRef.current.includes(sn) &&
                  !latest.current.skip.includes(sn) &&
                  !setAside.current.has(sn) &&
                  (latest.current.accepts?.(sn) ?? true),
              );
              if (holding.current) fresh.forEach((sn) => setAside.current.add(sn));
              else if (fresh.length === 1) accept(fresh[0]);
              else if (fresh.length > 1) {
                choosing.current = true;
                setChoices(fresh);
              }
            } catch {
              // a frame that cannot be read: try the next one
            }
          }
          if (!stopped) timer = window.setTimeout(tick, 120);
        };
        void tick();
      } catch (err: unknown) {
        if (!stopped) {
          setError(cameraError(err));
          setStarting(false);
        }
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    // the camera opens once per overlay; `accept` reads everything it needs through refs
  }, []);

  // Escape closes, like the other overlays
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') latest.current.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const left = Math.max(0, expect - got.length);
  return (
    <div className="camera-scan" role="dialog" aria-modal="true" aria-label={`สแกนด้วยกล้อง: ${title}`}>
      <video ref={videoRef} className="camera-scan-video" playsInline muted autoPlay />
      <div className="camera-scan-guide" aria-hidden="true" />
      <div className="camera-scan-top">
        <span>
          <strong>{title}</strong>
          <small>เหลือ {left} เครื่อง</small>
        </span>
        <button type="button" className="camera-scan-close" onClick={onClose} aria-label="ปิดกล้อง">
          <X size={22} />
        </button>
      </div>
      <div className="camera-scan-bottom">
        {error ? (
          <p className="camera-scan-error">{error}</p>
        ) : choices.length > 0 ? (
          <>
            <p>เจอหลายบาร์โค้ด กดตัวที่เป็น SN / IMEI ของเครื่องนี้</p>
            <div className="camera-scan-choices">
              {choices.map((sn) => (
                <button
                  type="button"
                  key={sn}
                  onClick={() => {
                    choices.filter((other) => other !== sn).forEach((other) => setAside.current.add(other));
                    setChoices([]);
                    choosing.current = false;
                    accept(sn);
                  }}
                >
                  {sn}
                </button>
              ))}
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  choices.forEach((other) => setAside.current.add(other));
                  setChoices([]);
                  choosing.current = false;
                }}
              >
                ไม่ใช่ สแกนใหม่
              </button>
            </div>
          </>
        ) : held ? (
          <>
            <p>
              สแกนได้ <strong>{held}</strong> · เล็งกล่องเครื่องถัดไปแล้วกด
            </p>
            <div className="camera-scan-choices">
              <button type="button" className="action" onClick={nextBox}>
                สแกนเครื่องถัดไป (เหลือ {left})
              </button>
              <button type="button" className="secondary" onClick={onClose}>
                เสร็จ ปิดกล้อง
              </button>
            </div>
          </>
        ) : (
          <p>{starting ? 'กำลังเปิดกล้อง…' : 'เล็งบาร์โค้ด Serial No. (Mac/iPad ขึ้นต้น S) หรือ IMEI ให้อยู่ในกรอบ'}</p>
        )}
        {problem && <p className="camera-scan-error">{problem}</p>}
        {got.length > 0 && <p className="camera-scan-got">สแกนแล้ว: {got.join(', ')}</p>}
      </div>
    </div>
  );
}
