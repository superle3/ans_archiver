export class Session {
    base_url: URL;
    default_headers: HeadersInit;
    ready: Promise<void> = Promise.resolve();
    delay_ms: number = 10;
    last_request_time: number = 0;
    constructor(base_url: string | URL, default_headers: HeadersInit = {}) {
        this.base_url = typeof base_url === "string" ? new URL(base_url) : base_url;
        this.default_headers = default_headers;
    }

    async _fetch(...args: Parameters<typeof fetch>) {
        return await fetch(...args);
    }
    async get(endpoint: string | URL, options: RequestInit = {}) {
        return await this.request(endpoint, { ...options, method: "GET" });
    }

    async request(endpoint: string | URL, options: RequestInit = {}) {
        this.ready = this.ready.then(() => {
            const wait_time = Math.max(
                this.last_request_time + this.delay_ms - performance.now(),
                0,
            );
            return new Promise((resolve) => {
                setTimeout(resolve, wait_time);
            });
        });
        await this.ready;
        this.last_request_time = performance.now();
        const url = new URL(endpoint, this.base_url);
        const merge_headers = new Headers(this.default_headers);
        if (options.headers) {
            Object.entries(options.headers).forEach(([key, value]) => {
                merge_headers.set(key, value);
            });
        }
        const response = await fetch(url, { ...options, headers: merge_headers });
        return response;
    }
}
