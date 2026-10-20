import dns from "node:dns";
import net from "node:net";

let applied = false;

/**
 * Some networks advertise IPv6 (AAAA) records but have no working IPv6 route,
 * which makes undici/Node hang until its connect timeout. Prefer IPv4 and
 * disable Happy-Eyeballs family racing so outbound calls fail fast and land on
 * a family that actually works.
 */
export function preferIpv4Preferred() {
  if (applied) return;
  applied = true;
  try {
    dns.setDefaultResultOrder("ipv4first");
    const setAuto = (
      net as unknown as {
        setDefaultAutoSelectFamily?: (value: boolean) => void;
      }
    ).setDefaultAutoSelectFamily;
    if (typeof setAuto === "function") setAuto(false);
  } catch {
    // best effort — only relevant on the Node server runtime
  }
}

preferIpv4Preferred();
