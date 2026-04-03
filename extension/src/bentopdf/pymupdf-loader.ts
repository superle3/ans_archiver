import { PyMuPDF } from "@bentopdf/pymupdf-wasm";
import { WasmAssetEvent } from "../content";

let cachedPyMuPDF: PyMuPDF | null = null;
let loadPromise: Promise<PyMuPDF> | null = null;

export async function loadPyMuPDF(): Promise<PyMuPDF> {
    if (cachedPyMuPDF) {
        return cachedPyMuPDF;
    }

    if (loadPromise) {
        return loadPromise;
    }

    loadPromise = (async () => {
        try {
            const url: string = await new Promise((resolve) => {
                const callback = (event: WasmAssetEvent) => {
                    console.log(event, event.detail);
                    resolve(event.detail);
                };
                const listener = window.addEventListener(
                    "ans_archive_load",
                    callback as EventListener,
                );
                window.dispatchEvent(new CustomEvent("ans_archive_start"));
                window.removeEventListener("ans_archive_load", callback as EventListener);
            });
            cachedPyMuPDF = new PyMuPDF({
                assetPath: url,
            });

            await cachedPyMuPDF.load();

            console.log("PyMuPDF Successfully loaded from CDN");
            return cachedPyMuPDF;
        } catch (error: unknown) {
            loadPromise = null;
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to load PyMuPDF from extension assets ${msg}`, {
                cause: error,
            });
        }
    })();

    return loadPromise;
}

export function clearPyMuPDFCache(): void {
    cachedPyMuPDF = null;
    loadPromise = null;
}
