// D108: loaded only when STOCK opens the camera, so the page itself stays small.
import { BarcodeDetector as ZXingDetector, prepareZXingModule } from 'barcode-detector/ponyfill';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

// the reader's .wasm comes from our own server (a Vite asset), never from a CDN
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
});

/** The barcodes on an Apple box label: the serial and the IMEI are Code 128; the others are filtered out by the caller. */
const FORMATS = ['code_128', 'code_39', 'data_matrix'] as const;

export interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

type NativeDetector = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
};

/** The browser's own reader where it has one for Code 128 (Chrome on Android), else the zxing-wasm one (Safari on iPhone). */
export async function makeDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetector }).BarcodeDetector;
  if (Native) {
    try {
      const supported = await Native.getSupportedFormats();
      if (supported.includes('code_128')) return new Native({ formats: FORMATS.filter((f) => supported.includes(f)) });
    } catch {
      // fall back to zxing-wasm
    }
  }
  return new ZXingDetector({ formats: [...FORMATS] });
}
