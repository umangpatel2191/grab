// Full-resolution versions of resized image URLs.
//
// Pages usually show a resized copy (a thumbnail, a srcset step, an image-CDN transform).
// Designers want the original. These rules undo the resizing of the common platforms and
// image CDNs. The result is only a guess: the server tries it first and falls back to the
// URL the page used when the guess does not return a real image.

const SIZE_PARAMS = new Set([
  'w', 'h', 'width', 'height', 'fit', 'crop', 'q', 'quality', 'auto', 'dpr', 'fm', 'format', 'resize', 'rect',
  'ixlib', 'ixid', 'cs', 'max-w', 'max-h', 'maxwidth', 'maxheight', 'mw', 'mh', 'scale', 'sharp', 'blur', 'trim', 'tr',
]);

/** Hosts whose query string is purely an image transform. */
const PARAM_CDNS = /(^|\.)(imgix\.net|images\.ctfassets\.net|cdn\.sanity\.io|images\.unsplash\.com|plus\.unsplash\.com|images\.prismic\.io|images\.squarespace-cdn\.com|static1\.squarespace\.com|cdn\.shopify\.com|i\.shgcdn\.com|images\.pexels\.com|dato-images\.imgix\.net|res\.cloudinary\.com|cdn\.builder\.io|media\.graphassets\.com|imagedelivery\.net|framerusercontent\.com|cdn\.prod\.website-files\.com|assets-global\.website-files\.com|uploads-ssl\.webflow\.com)$/i;

function stripParams(u: URL): void {
  for (const k of [...u.searchParams.keys()]) {
    if (SIZE_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k);
  }
}

/** Best guess at the original file behind a resized image URL, or null when it already looks original. */
export function originalUrl(raw: string): string | null {
  if (!raw || raw.startsWith('data:')) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const before = u.toString();

  // Image optimizers that wrap the real URL: Next.js, Nuxt/IPX, Vercel, Netlify, Gatsby, Astro
  const wrapped = u.searchParams.get('url');
  if (/\/(_next|_vercel)\/image\/?$|\/\.netlify\/images\/?$|\/_image\/?$/.test(u.pathname) && wrapped) {
    try {
      return new URL(wrapped, u.origin).toString();
    } catch {
      return null;
    }
  }
  const ipx = u.pathname.match(/^\/_ipx\/[^/]+(\/.+)$/);
  if (ipx) return new URL(ipx[1], u.origin).toString();
  // Cloudflare Images: /cdn-cgi/image/<options>/<path>
  const cf = u.pathname.match(/^\/cdn-cgi\/image\/[^/]+\/(.+)$/);
  if (cf) return /^https?:\/\//.test(cf[1]) ? cf[1] : new URL('/' + cf[1], u.origin).toString();

  // Cloudinary: /image/upload/<transforms>/v123/id.jpg → /image/upload/v123/id.jpg
  if (/(^|\.)res\.cloudinary\.com$/i.test(u.hostname) || /\/image\/upload\//.test(u.pathname)) {
    u.pathname = u.pathname.replace(/\/(image|video)\/upload\/(?:[a-z]{1,3}_[^/]+\/)+/, '/$1/upload/');
  }
  // Wix: /media/<id>.jpg/v1/fill/w_300,.../<name>.jpg → /media/<id>.jpg
  const wix = u.pathname.match(/^(\/media\/[^/]+\.(?:jpe?g|png|webp|gif|avif))\/v1\//i);
  if (/wixstatic\.com$/i.test(u.hostname) && wix) {
    u.pathname = wix[1];
    u.search = '';
  }
  // Shopify: name_300x.jpg, name_300x400_crop_center.jpg, name_grande.jpg
  if (/(^|\.)cdn\.shopify\.com$/i.test(u.hostname) || /^\/cdn\/shop\//i.test(u.pathname)) {
    u.pathname = u.pathname.replace(/_(\d+x\d*|x\d+|pico|icon|thumb|small|compact|medium|large|grande|master)(_crop_[a-z]+)?(@\dx)?(?=\.[a-z0-9]+$)/i, '');
  }
  // Squarespace: ?format=300w → original
  if (/squarespace-cdn\.com$|squarespace\.com$/i.test(u.hostname) && u.searchParams.has('format')) {
    u.searchParams.set('format', 'original');
  }
  // WordPress and most CMSs: photo-300x200.jpg → photo.jpg, logo@2x.png stays (already the big one)
  if (/\/wp-content\/uploads\//.test(u.pathname) || /-\d{2,5}x\d{2,5}\.(jpe?g|png|webp|gif|avif)$/i.test(u.pathname)) {
    u.pathname = u.pathname.replace(/-\d{2,5}x\d{2,5}(?=\.[a-z0-9]+$)/i, '');
  }
  if (PARAM_CDNS.test(u.hostname)) stripParams(u);

  const after = u.toString();
  return after !== before ? after : null;
}
