/**
 * Inline in <head> before Next bootstrap (dev only).
 *
 * Safari reload storm causes:
 * 1) Next debug-channel: if navigation transferSize===0 (bfcache/memory
 *    cache) and sessionStorage miss → location.reload() forever
 * 2) Failed HMR reconnect paths that call location.reload()
 *
 * Do NOT stub HMR WebSockets as a fake OPEN socket — that leaves the
 * webpack HMR client half-initialized and blocks React hydration (ASCII
 * frames, dialogs, etc. never mount effects).
 *
 * Keep transferSize lie + reload no-op only. Portless HTTPS may still
 * fail to upgrade /_next/webpack-hmr; without reload loops the page stays
 * interactive.
 */
export const DEV_PORTLESS_HMR_FIX_SCRIPT = `
(function () {
  if (typeof window === "undefined") return;

  // 1) Stop Next debug-channel cache-miss reload loop (Safari).
  try {
    var nativeGetEntries = Performance.prototype.getEntriesByType;
    Performance.prototype.getEntriesByType = function (type) {
      var entries = nativeGetEntries.call(this, type);
      if (type !== "navigation" || !entries || !entries.length) return entries;
      return Array.prototype.map.call(entries, function (entry) {
        try {
          return new Proxy(entry, {
            get: function (target, prop) {
              if (prop === "transferSize") {
                var size = target.transferSize;
                return size === 0 ? 1 : size;
              }
              var value = target[prop];
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        } catch (e) {
          return entry;
        }
      });
    };
  } catch (e) {}

  // 2) Block JS full reloads (manual Cmd+R still works).
  function blockReload() {}
  try { Location.prototype.reload = blockReload; } catch (e) {}
  try { window.location.reload = blockReload; } catch (e) {}
})();
`.trim();
