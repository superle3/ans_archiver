// import { HrefResponse } from "./types";
// import { get_answers } from "./submissions";
// import browser from "webextension-polyfill";

// declare global {
//     var logger: {
//         debug: (...msg: string[]) => void;
//         info: (...msg: string[]) => void;
//         verbose: (...msg: string[]) => void;
//         error: (...msg: string[]) => void;
//         warn: (...msg: string[]) => void;
//     };
//     var BASE_URL: URL;
// }
// window.logger = {
//     debug: console.debug,
//     info: console.info,
//     verbose: console.log,
//     error: console.error,
//     warn: console.warn,
// };
// window.BASE_URL = new URL("https://ans.app/");
// function isHrefLocation(obj: unknown): obj is HrefResponse {
//     if (
//         typeof obj === "object" &&
//         obj !== null &&
//         "href" in obj &&
//         typeof obj.href === "string"
//     )
//         return true;
//     return false;
// }
// browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
//     if (!isHrefLocation(request)) return true;
//     const url = new URL(request.href.toString());
//     sendResponse({ response: 200 });
//     download_answer(url, request.id);
//     return true;
//     // console.log(answers[0]);
// });
// async function download_answer(url: URL, id: number) {
//     const token = await browser.cookies.get({
//         url: url.origin + url.pathname,
//         name: "__Host-ans_session",
//     });
//     if (!token) {
//         return;
//     }
//     const answers = await get_answers(
//         new URL(url.href),
//         async (arg1: URL | RequestInfo, arg2?: RequestInit) => {
//             const headers = arg2?.headers ?? {};
//             const arg3 = {
//                 ...arg2,
//                 headers: {
//                     ...headers,
//                     Cookie: `__Host-ans_session=${token.value};`,
//                 },
//             };
//             return await fetch(arg1, arg3);
//         },
//     );
//     const text = answers[0];
//     const element = document.createElement("a");
//     element.setAttribute(
//         "href",
//         "data:text/plain;charset=utf-8, " + encodeURIComponent(text),
//     );
//     element.setAttribute("download", "test.html");
//     document.body.appendChild(element);
//     element.click();

//     document.body.removeChild(element);
// }
