import { describe, expect, it } from 'vitest';
import { isBlockedHostname, isBlockedIp } from '../src/net/ipGuard';
import { isAllowedByRules, parseRobots } from '../src/net/robots';
import { sniffImage, sniffVideo } from '../src/sniff';
import { normalizeUrl, parseUrlInput, variantKey } from '../../shared/urls';

describe('IP guard (SSRF)', () => {
  const blocked = [
    '127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255', '192.0.2.1', '198.51.100.7', '203.0.113.9',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
    '::ffff:7f00:1', '2001:db8::1', '64:ff9b::7f00:1', 'not-an-ip', '',
  ];
  for (const ip of blocked) {
    it(`blocks ${ip || '(empty)'}`, () => expect(isBlockedIp(ip)).toBe(true));
  }
  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e'];
  for (const ip of allowed) {
    it(`allows ${ip}`, () => expect(isBlockedIp(ip)).toBe(false));
  }
  it('blocks local host names and suffixes', () => {
    for (const h of ['localhost', 'LOCALHOST.', 'foo.local', 'db.internal', 'x.localhost', 'metadata.google.internal', '[::1]', '127.0.0.1', '2130706433']) {
      expect(isBlockedHostname(new URL(`http://${h}/`).hostname)).toBe(true);
    }
    expect(isBlockedHostname('example.com')).toBe(false);
  });
  it('WHATWG URL turns tricky IPv4 spellings into dotted form that is blocked', () => {
    for (const raw of ['http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://[::ffff:127.0.0.1]/']) {
      expect(isBlockedHostname(new URL(raw).hostname)).toBe(true);
    }
  });
});

describe('URL input', () => {
  it('normalizes common pasted forms', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/');
    expect(normalizeUrl('  www.example.com/path#frag ')).toBe('https://www.example.com/path');
    expect(normalizeUrl('(https://example.com/a),')).toBe('https://example.com/a');
    expect(normalizeUrl('//cdn.example.com/x')).toBe('https://cdn.example.com/x');
    expect(normalizeUrl('HTTP://Example.COM')).toBe('http://example.com/');
  });
  it('rejects unsafe or invalid input', () => {
    for (const bad of ['', '   ', 'javascript:alert(1)', 'ftp://example.com', 'mailto:a@b.co', 'data:text/html,hi', 'https://user:pw@example.com', 'not a url', 'localhost', 'file:///etc/passwd']) {
      expect(normalizeUrl(bad)).toBeNull();
    }
  });
  it('splits lines, commas and spaces, merges duplicates and caps the count', () => {
    const r = parseUrlInput('a.com\nb.com, c.com  https://a.com/ junk://x', 3);
    expect(r.valid).toEqual(['https://a.com/', 'https://b.com/', 'https://c.com/']);
    expect(r.duplicates).toBe(1);
    expect(r.invalid.map((i) => i.input)).toEqual(['junk://x']);
    const many = parseUrlInput(Array.from({ length: 12 }, (_, i) => `site${i}.com`).join('\n'), 10);
    expect(many.valid).toHaveLength(10);
    expect(many.invalid.filter((i) => i.code === 'TOO_LARGE')).toHaveLength(2);
  });
  it('handles unicode domains and very long input without throwing', () => {
    expect(normalizeUrl('münchen.de')).toBe('https://xn--mnchen-3ya.de/');
    expect(() => parseUrlInput('a'.repeat(100000))).not.toThrow();
  });
});

describe('variant grouping', () => {
  it('groups the same picture at several sizes', () => {
    expect(variantKey('https://cdn.x.com/a/photo-300x200.jpg')).toBe(variantKey('https://cdn.x.com/a/photo-1200x800.jpg'));
    expect(variantKey('https://cdn.x.com/a/photo.jpg?w=300')).toBe(variantKey('https://cdn.x.com/a/photo.jpg?w=900&q=80'));
    expect(variantKey('https://cdn.x.com/a/photo@2x.png')).toBe(variantKey('https://cdn.x.com/a/photo.png'));
    expect(variantKey('https://cdn.x.com/a/one.jpg')).not.toBe(variantKey('https://cdn.x.com/a/two.jpg'));
  });
});

describe('robots.txt', () => {
  const txt = `User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*.pdf$\n\nUser-agent: grab\nDisallow: /grabbed\n`;
  it('prefers the specific group', () => {
    const rules = parseRobots(txt, ['grab']);
    expect(isAllowedByRules(rules, '/grabbed/x')).toBe(false);
    expect(isAllowedByRules(rules, '/private')).toBe(true);
  });
  it('applies longest match, wildcards and end anchors', () => {
    const rules = parseRobots(txt, ['otherbot']);
    expect(isAllowedByRules(rules, '/private/x')).toBe(false);
    expect(isAllowedByRules(rules, '/private/public/x')).toBe(true);
    expect(isAllowedByRules(rules, '/files/a.pdf')).toBe(false);
    expect(isAllowedByRules(rules, '/files/a.pdf.html')).toBe(true);
    expect(isAllowedByRules(rules, '/')).toBe(true);
  });
  it('treats an empty Disallow as allow all', () => {
    expect(isAllowedByRules(parseRobots('User-agent: *\nDisallow:', ['grab']), '/anything')).toBe(true);
  });
});

describe('content sniffing', () => {
  it('detects real image types by bytes', () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('GIF89a....'))).toBe('image/gif');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('image/svg+xml');
    expect(sniffImage(Buffer.from('\0\0\0\x1cftypavif'))).toBe('image/avif');
  });
  it('rejects HTML and text pretending to be images', () => {
    expect(sniffImage(Buffer.from('<!DOCTYPE html><html><body>nope</body></html>'))).toBeNull();
    expect(sniffImage(Buffer.from('hello world'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
  it('detects direct video containers', () => {
    expect(sniffVideo(Buffer.from('\0\0\0\x18ftypmp42'))).toBe('video/mp4');
    expect(sniffVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]))).toBe('video/webm');
    expect(sniffVideo(Buffer.from('<html>'))).toBeNull();
  });
});
