import dns from "node:dns";
import dnsPromises from "node:dns/promises";

// Fallback resolver with Google (8.8.8.8) and Cloudflare (1.1.1.1) DNS
// Ensures Neon Database endpoints can always be resolved even if local ISP/router DNS returns RCODE_REFUSED.
const fallbackResolver = new dnsPromises.Resolver();
try {
  fallbackResolver.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {
  // Ignore if unable to set custom DNS servers
}

const origLookup = dns.lookup;

// Intercept dns.lookup for neon.tech hostnames across Node.js (fetch, https, pg, ws, etc.)
// @ts-ignore
dns.lookup = function (hostname: string, options: any, callback: any) {
  let cb = callback;
  let opts = options;
  if (typeof opts === "function") {
    cb = opts;
    opts = {};
  }

  if (hostname && (hostname.includes("neon.tech") || hostname.includes("aws.neon"))) {
    fallbackResolver
      .resolve4(hostname)
      .then((addresses) => {
        if (!addresses || addresses.length === 0) {
          return origLookup(hostname, opts, cb);
        }
        if (opts && opts.all) {
          cb(null, addresses.map((ip) => ({ address: ip, family: 4 })));
        } else {
          cb(null, addresses[0], 4);
        }
      })
      .catch(() => {
        origLookup(hostname, opts, cb);
      });
    return;
  }

  return origLookup(hostname, opts, cb);
};

