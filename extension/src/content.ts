import browser from "webextension-polyfill";
window.addEventListener("ans_archive_start", (event) => {
    const urls = browser.runtime.getURL("node_modules/@bentopdf/pymupdf-wasm/assets/");
    window.dispatchEvent(
        new CustomEvent("ans_archive_load", {
            detail: urls,
        }),
    );
});
