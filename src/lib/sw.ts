/// <reference lib="webworker" />
const sw = self as unknown as ServiceWorkerGlobalScope;

declare const __APP_VERSION__: string;
const CACHE_PREFIX = `huji-`;
const CACHE_NAME = `${CACHE_PREFIX}v${__APP_VERSION__}`;

sw.addEventListener("install", () => {
  sw.skipWaiting();
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(
            (name) => name !== CACHE_NAME && name.startsWith(CACHE_PREFIX),
          )
          .map((name) => {
            console.log("[SW] Deleting old cache:", name);
            return caches.delete(name);
          }),
      );
      await sw.clients.claim();
    })(),
  );
});

const networkFirstFetch = async (
  _event: FetchEvent,
  req: Request,
): Promise<Response> => {
  try {
    const networkResponse = await fetch(req);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(req);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
};

const cacheFirstFetch = async (
  event: FetchEvent,
  req: Request,
): Promise<Response> => {
  const cache = await caches.open(CACHE_NAME);
  const cachedResp = await cache.match(req);

  if (!cachedResp) {
    return await networkFirstFetch(event, req);
  }

  event.waitUntil(
    (async () => {
      const networkResponse = await fetch(req);
      if (networkResponse && networkResponse.status === 200) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, networkResponse.clone());
      }
    })(),
  );

  return cachedResp;
};

const cacheFirstRE = /(\/assets\/)|(\/fonts\/)/;

sw.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") {
    return;
  }

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  const fetcher = cacheFirstRE.test(url.pathname)
    ? cacheFirstFetch
    : networkFirstFetch;

  event.respondWith(fetcher(event, req));
});
