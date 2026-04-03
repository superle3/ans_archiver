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
    firefoxProfile: "dev",
    keepProfileChanges: true,
};
export default {
    run,
    build,
};
