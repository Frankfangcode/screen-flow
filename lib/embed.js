'use strict';

// Turn a host-pasted link into something an iframe can show.
// Google Slides edit/publish links are rewritten to the embed URL.
// Anything other than http(s) is rejected.
function toEmbedUrl(input) {
  let url;
  try {
    url = new URL(String(input || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  if (url.hostname === 'docs.google.com') {
    const published = url.pathname.match(/\/presentation\/d\/e\/([^/]+)/);
    const edited = url.pathname.match(/\/presentation\/d\/([^/]+)/);
    if (published) {
      return `https://docs.google.com/presentation/d/e/${published[1]}/embed?start=false&loop=false&delayms=3000`;
    }
    if (edited && edited[1] !== 'e') {
      return `https://docs.google.com/presentation/d/${edited[1]}/embed?start=false&loop=false&delayms=3000`;
    }
  }

  return url.toString();
}

module.exports = { toEmbedUrl };
