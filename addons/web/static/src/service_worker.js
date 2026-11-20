// @odoo-module ignore

/* eslint-disable no-restricted-globals */
const cacheName = "odoo-sw-cache";
const homepageURL = "/odoo";
const offLineURL = `${homepageURL}/offline`;

// The authenticated shell contains the encryption secret for the current user.
// Keep it only for the lifetime of the verified session in this worker.
let offlineShell;
let navigationVersion = 0;

function isBackendURL(url) {
    return url.origin === self.location.origin &&
        (url.pathname === homepageURL || url.pathname.startsWith(homepageURL + "/")) &&
        url.pathname !== offLineURL && !url.searchParams.get("debug")?.includes("assets");
}

function forgetShell() {
    navigationVersion++;
    offlineShell = undefined;
}

async function rememberShell(response, version) {
    if (!response.ok || !isBackendURL(new URL(response.url))) {
        return;
    }
    const html = await response.text();
    if (version === navigationVersion) {
        const session = html.match(/odoo\.__session_info__\s*=\s*({.*?});/s);
        offlineShell = session && JSON.parse(session[1]).browser_cache_secret
            ? new Response(html, { headers: response.headers })
            : undefined;
    }
}

self.addEventListener("install", (event) => {
    const version = navigationVersion;
    event.waitUntil(Promise.all([
        fetch(homepageURL).then((response) => response.ok && rememberShell(response, version)),
        caches.open(cacheName).then((cache) => cache.add(offLineURL)),
    ]));
});

self.addEventListener("activate", (event) => {
    // Earlier workers stored a redacted web client shell alongside the public offline page.
    event.waitUntil(caches.open(cacheName).then((cache) => cache.delete(homepageURL)));
});

const navigateOrDisplayOfflinePage = async (event) => {
    const request = event.request;
    const url = new URL(request.url);
    const backend = isBackendURL(url);
    const version = backend ? ++navigationVersion : navigationVersion;
    try {
        // Give a warmed navigation a bounded wait on a stalled connection.
        // Only a safe GET can fall back to the last authenticated shell.
        const response = backend && offlineShell && request.method === "GET"
            ? await fetch(request, { signal: AbortSignal.timeout(5000) })
            : await fetch(request);
        if (backend && version === navigationVersion) {
            if (response.ok && isBackendURL(new URL(response.url))) {
                offlineShell = undefined;
                // Start reading while the response streams to the page. A later navigation
                // or logout must win even if this older response finishes last.
                const capture = rememberShell(response.clone(), version);
                event.waitUntil(capture);
            } else {
                offlineShell = undefined;
            }
        }
        return response;
    } catch (error) {
        if (request.method !== "GET" || (!(error instanceof TypeError) && error.name !== "TimeoutError")) {
            throw error;
        }
        if (backend && offlineShell) {
            return offlineShell.clone();
        }
        const page = await (await caches.open(cacheName)).match(offLineURL);
        if (page) {
            return page;
        }
        throw error;
    }
};

const serveShareTarget = (event) => {
    // Redirect so the user can refresh the page without resending data.
    event.respondWith(Response.redirect("/odoo?share_target=trigger"));
    event.waitUntil(
        (async () => {
            // The page sends this message to tell the service worker it's ready to receive the file.
            await waitingMessage("odoo_share_target");
            const client = await self.clients.get(event.resultingClientId || event.clientId);
            const data = await event.request.formData();
            client.postMessage({
                shared_files: data.getAll("externalMedia") || [],
                action: "odoo_share_target_ack",
            });
        })()
    );
};

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (url.origin === self.location.origin && [
        "/web/login", "/web/session/logout", "/web/session/destroy", "/web/session/authenticate",
    ].includes(url.pathname)) {
        forgetShell();
        event.waitUntil(self.clients.matchAll({ type: "window" }).then((clients) => {
            for (const client of clients) {
                if (client.id !== event.clientId && isBackendURL(new URL(client.url))) {
                    client.postMessage("odoo_session_changed");
                }
            }
        }));
    }
    if (
        event.request.method === "POST" &&
        new URL(event.request.url).searchParams.has("share_target")
    ) {
        return serveShareTarget(event);
    }
    if (
        (event.request.mode === "navigate" && event.request.destination === "document") ||
        // request.mode = navigate isn't supported in all browsers => check for http header accept:text/html
        event.request.headers.get("accept")?.includes("text/html")
    ) {
        event.respondWith(navigateOrDisplayOfflinePage(event));
    }
});

/**
 * Resolvers of the pending `waitingMessage` calls, keyed by the id of the
 * client the message is expected from (`false` for any client), then by
 * awaited message.
 *
 * @type {Map<string|false, Map<string, Function[]>>}
 */
const nextMessageMap = new Map();

/**
 * Drop the resolvers waiting for `message` from `clientId`, and the client
 * entry itself once it has no awaited message left.
 *
 * @param {string|false} clientId
 * @param {string} message
 * @param {Function} [resolver] if given, only that resolver is dropped
 */
const forgetMessage = (clientId, message, resolver) => {
    const messageMap = nextMessageMap.get(clientId);
    if (!messageMap) {
        return;
    }
    const resolvers = resolver ? (messageMap.get(message) || []).filter((r) => r !== resolver) : [];
    if (resolvers.length) {
        messageMap.set(message, resolvers);
    } else {
        messageMap.delete(message);
    }
    if (!messageMap.size) {
        nextMessageMap.delete(clientId);
    }
};

/**
 * Wait for a client to post `message` to this service worker.
 *
 * @param {string} message
 * @param {string|false} [clientId] id of the client the message is expected
 *  from, `false` to resolve on the message from any client.
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] stop waiting when aborted: the
 *  returned promise rejects with the abort reason and the resolver is dropped.
 *  Pass one whenever the message may never come (e.g. the client is closed
 *  before answering), otherwise its resolver is kept for the whole lifetime of
 *  the service worker.
 * @return {Promise<void>}
 */
const waitingMessage = async (message, clientId = false, { signal } = {}) => {
    if (typeof message !== "string") {
        throw new Error("message must be a string");
    }
    if (signal?.aborted) {
        throw signal.reason;
    }
    return new Promise((resolve, reject) => {
        function settle() {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }
        function onAbort() {
            forgetMessage(clientId, message, settle);
            reject(signal.reason);
        }
        if (!nextMessageMap.has(clientId)) {
            nextMessageMap.set(clientId, new Map());
        }
        if (!nextMessageMap.get(clientId).has(message)) {
            nextMessageMap.get(clientId).set(message, []);
        }
        nextMessageMap.get(clientId).get(message).push(settle);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
};

self.addEventListener("message", (event) => {
    if (typeof event.data !== "string") {
        return;
    }
    // `source` is null for a message that does not come from a client.
    const clientId = event.source?.id;
    const messageNotifiers = [
        ...(nextMessageMap.get(false)?.get(event.data) || []),
        ...(nextMessageMap.get(clientId)?.get(event.data) || []),
    ];
    if (messageNotifiers.length) {
        for (const messageNotified of messageNotifiers) {
            messageNotified();
        }
        forgetMessage(false, event.data);
        forgetMessage(clientId, event.data);
    }
    if (event.data === "user_logout") {
        forgetShell();
    }
});
