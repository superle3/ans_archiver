import { PdfFileInfo } from "../submissions";
/**
 * Converts CDP Base64 PDF data to a Blob
 * @param {string} base64Data - The result.data from Page.printToPDF
 * @returns {Blob}
 */
function base64ToBlob(base64Data: string) {
    // 1. Decode the base64 string into a binary string
    const byteCharacters = atob(base64Data);

    // 2. Create an array of byte values
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }

    // 3. Convert to a Typed Array
    const byteArray = new Uint8Array(byteNumbers);

    // 4. Create the Blob with the correct MIME type
    return new Blob([byteArray], { type: "application/pdf" });
}
export type PrintPdfSend = {
    text: string;
    id: number;
};
export type PrintPdfReceive =
    | {
          val: string;
          id: number;
      }
    | {
          error: string;
          id: number;
      };

async function chrome_print(text: string): Promise<PdfFileInfo> {
    const random_id = Math.random();
    return new Promise((resolve, reject) => {
        const callback = (event: CustomEvent<PrintPdfReceive>) => {
            if (event.detail.id !== random_id) return;
            if ("error" in event.detail) {
                reject(new Error(event.detail.error));
                return;
            }
            console.log("received pdf", event.detail);
            const detail = event.detail.val;
            const content = base64ToBlob(detail);
            resolve({ filename: "page.pdf", content, directory: "" });
            window.removeEventListener(
                "ans_archive_print_load",
                callback as EventListener,
            );
        };
        window.addEventListener("ans_archive_print_load", callback as EventListener);
        const detail: PrintPdfSend = { text, id: random_id };
        window.dispatchEvent(new CustomEvent("ans_archive_print_start", { detail }));
    });
}

function firefox_print(text: string) {
    throw new Error("Firefox not implemented");
}

export function print_document(text: string) {
    if (navigator.userAgent.includes("Chrome")) {
        return chrome_print(text);
    } else if (navigator.userAgent.includes("Firefox")) {
        return firefox_print(text);
    } else {
        throw new Error("No browser detected");
    }
}
