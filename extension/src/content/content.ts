import { PrintPdfSend } from "../browser/print";

// import browser from "webextension-polyfill";
const browser = chrome;
export type WasmAssetEvent = CustomEvent<string>;
window.addEventListener("ans_archive_start", (event) => {
    const urls = browser.runtime.getURL("node_modules/@bentopdf/pymupdf-wasm/assets/");
    window.dispatchEvent(
        new CustomEvent("ans_archive_load", {
            detail: urls,
        }),
    );
});

const print_callback = (event: CustomEvent<PrintPdfSend>) => {
    const detail = event.detail;
    browser.runtime
        .sendMessage({ detail: detail.text, type: "print_pdf" })
        .then((value) => {
            const send_detail = value.error ? { error: value.error } : { val: value.val };
            send_detail.id = detail.id;
            window.dispatchEvent(
                new CustomEvent("ans_archive_print_load", {
                    detail: send_detail,
                }),
            );
        });
};
window.addEventListener("ans_archive_print_start", print_callback as EventListener);
