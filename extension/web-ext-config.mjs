/// <reference types="node"  />
/// <reference types="web-ext-option-types"  />
/** @type {import('web-ext-option-types').BuildOptions} */
const build = {
    filename: "ans_archiver.zip",
    overwriteDest: true,
    asNeeded: true,
};

/** @type {import('web-ext-option-types').RunOptions} */
const run = {
    reload: true,
    firefox: "C:/Program Files/Firefox Developer Edition/firefox.exe",
    // target: ["chromium"],
    startUrl: ["https://ans.app/"],

    chromiumBinary: "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
    chromiumProfile:
        "C:/Users/98765/AppData/Local/BraveSoftware/Brave-Browser/User Data/Profile 1",
    // chromiumProfile:
    //     "C:/Users/98765/AppData/Local/BraveSoftware/Brave-Browser/User Data/Default",
    firefoxProfile: "dev",
    keepProfileChanges: true,
};
export default {
    run,
    build,
};
