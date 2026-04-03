import { PyMuPDF } from "@bentopdf/pymupdf-wasm";

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
        console.log(1);
        // if (!WasmProvider.isConfigured("pymupdf")) {
        //     throw new Error(
        //         "PyMuPDF is not configured. Please configure it in Advanced Settings.",
        //     );
        // }
        // if (!WasmProvider.isConfigured("ghostscript")) {
        //     throw new Error(
        //         "Ghostscript is not configured. PyMuPDF requires Ghostscript for some operations. Please configure both in Advanced Settings.",
        //     );
        // }

        // const pymupdfUrl = WasmProvider.getUrl("pymupdf")!;
        // const gsUrl = WasmProvider.getUrl("ghostscript")!;
        // const normalizedPymupdf = pymupdfUrl.endsWith("/")
        //     ? pymupdfUrl
        //     : `${pymupdfUrl}/`;

        try {
            // const wrapperUrl = `${normalizedPymupdf}dist/index.js`;
            // const module = await import(/* @vite-ignore */ wrapperUrl);

            // if (typeof module.PyMuPDF !== "function") {
            //     throw new Error("PyMuPDF module did not export expected PyMuPDF class.");
            // }
            const url = await new Promise((resolve) => {
                const callback = (event: Event) => {
                    console.log(event, event.detail);
                    resolve(event.detail);
                };
                const listener = window.addEventListener("ans_archive_load", callback);
                window.dispatchEvent(new CustomEvent("ans_archive_start"));
                window.removeEventListener("ans_archive_load", callback);
            });
            cachedPyMuPDF = new PyMuPDF({
                assetPath: url,
            });

            await cachedPyMuPDF.load();

            console.log("[PyMuPDF Loader] Successfully loaded from CDN");
            return cachedPyMuPDF;
        } catch (error: unknown) {
            loadPromise = null;
            const msg = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to load PyMuPDF from CDN: ${msg}`, {
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
