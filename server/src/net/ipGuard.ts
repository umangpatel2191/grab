import ipaddr from 'ipaddr.js';
import net from 'node:net';

/**
 * Only globally routable unicast addresses are allowed.
 * ipaddr.js labels everything else (private, loopback, link-local, multicast,
 * reserved, carrier-grade NAT, 6to4, teredo, NAT64, ...) with another range name.
 */
export function isBlockedIp(ip: string): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.process(ip); // converts IPv4-mapped IPv6 to IPv4
  } catch {
    return true; // unparsable: block
  }
  if (addr.kind() === 'ipv6') {
    const v6 = addr as ipaddr.IPv6;
    const range = v6.range();
    if (range !== 'unicast') return true;
    // 2001:db8::/32 documentation, ::/8 reserved block
    const parts = v6.parts;
    if (parts[0] === 0x2001 && parts[1] === 0x0db8) return true;
    if ((parts[0] & 0xff00) === 0) return true;
    return false;
  }
  return (addr as ipaddr.IPv4).range() !== 'unicast';
}

const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet', '.localdomain'];

/** Host names that must never be fetched, before any DNS lookup. */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h === 'metadata.google.internal') return true;
  if (BLOCKED_SUFFIXES.some((s) => h.endsWith(s))) return true;
  const bare = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
  if (net.isIP(bare)) return isBlockedIp(bare);
  return false;
}
