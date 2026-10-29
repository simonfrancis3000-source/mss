const CACHE_NAME = "synqme-shell-v36";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/synqme-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    // Retire old shell caches and the unused Kokoro model cache.
    // This app now uses Phonic for voice output, with no browser TTS weights.
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith("synqme-shell-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      // The old Kokoro TTS model is no longer used. Remove its dedicated
      // Transformers cache (about 88 MB) for this server-driven SYNQ.ME app.
      .then(() => caches.delete("transformers-cache"))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
        return response;
      }).catch(async () => {
        return (await caches.match("/")) || Response.error();
      })
    );
    return;
  }

  if (url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".svg") || url.pathname.endsWith(".webmanifest")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fresh = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
        return cached || fresh;
      })
    );
  }
});
