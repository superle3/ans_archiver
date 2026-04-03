import esbuild from "esbuild";

const prod = process.argv[2] === "production";

/** @type {import('esbuild').BuildOptions} */
const build_ctx = {
    target: "ES2022",
    format: "cjs",
    bundle: true,
    outdir: "./dist",
    entryPoints: ["src/background.ts", "src/content.ts", "src/world.ts"],
    logLevel: "info",
    treeShaking: true,
};

if (!prod) {
    const ctx = await esbuild.context({
        target: "ES2022",
        format: "cjs",
        bundle: true,
        outdir: "./dist",
        sourcemap: "inline",
        entryPoints: ["src/background.ts", "src/content.ts", "src/world.ts"],
        logLevel: "info",
        treeShaking: true,
    });
    ctx.watch().catch(() => process.exit(1));
} else {
    esbuild.build(build_ctx).catch(() => process.exit(1));
}
