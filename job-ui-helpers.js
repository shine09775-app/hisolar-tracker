(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.JobUiHelpers = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const FALLBACK_COMMENT_AUTHOR = 'ไม่ระบุ';
  const ORGANIZATION_LABELS = {
    hisolar: 'Hi Solar',
    jdk: 'JDK',
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizePhoneValue(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/[^0-9+\s\-().]/.test(raw)) return null;

    const compact = raw.replace(/[\s\-().]/g, '');
    const plusMatches = compact.match(/\+/g) || [];
    if (plusMatches.length > 1) return null;
    if (plusMatches.length === 1 && !compact.startsWith('+')) return null;

    const digits = compact.replace(/\+/g, '');
    if (!/^\d+$/.test(digits)) return null;
    if (digits.length < 8 || digits.length > 15) return null;

    return compact.startsWith('+') ? `+${digits}` : digits;
  }

  function buildTelHref(value) {
    const normalized = normalizePhoneValue(value);
    return normalized ? `tel:${normalized}` : null;
  }

  function isAllowedGoogleMapsUrl(url) {
    const hostname = String(url.hostname || '').toLowerCase();
    const pathname = String(url.pathname || '').toLowerCase();

    if (hostname === 'maps.app.goo.gl') {
      return true;
    }

    if (/^maps\.google\./.test(hostname)) {
      return true;
    }

    if (/^(www\.)?google\./.test(hostname) && pathname.startsWith('/maps')) {
      return true;
    }

    return false;
  }

  function extractLatLngFromMapsUrl(raw) {
    // Order matters: a place link can carry both the map's pan/zoom center
    // ("/@lat,lng,17z") and the place's own stored coordinate ("!3d..!4d..").
    // The center drifts if the map was scrolled before the link was copied,
    // so the more specific !3d/!4d pin is tried first.
    const patterns = [
      /[?&]q=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,
      /[?&]query=(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,
      /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
      /\/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    ];
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      if (match) return { lat: match[1], lng: match[2] };
    }
    return null;
  }

  function sanitizeMapsUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    let url;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }

    if (url.protocol !== 'https:') {
      return null;
    }

    if (!isAllowedGoogleMapsUrl(url)) {
      return null;
    }

    // Some Google Maps link shapes (plain "?q=lat,lng" searches, "/@lat,lng,zoomz"
    // map views, or "!3d..!4d.." place links) fail to open in the native Google
    // Maps app on iOS with an "Unsupported link" error, even though they render
    // fine in a browser. The "api=1" search URL format is the one Google
    // documents as safe to deep-link from any platform, so rewrite whenever we
    // can pull real coordinates out of the link.
    if (url.hostname.toLowerCase() !== 'maps.app.goo.gl') {
      const coords = extractLatLngFromMapsUrl(raw);
      if (coords) {
        return `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;
      }
    }

    url.username = '';
    url.password = '';
    return url.toString();
  }

  function getCommentAuthorName(comment) {
    if (!comment) return FALLBACK_COMMENT_AUTHOR;
    if (comment.actor_user_id) {
      return comment.author_name_snapshot || comment.author || FALLBACK_COMMENT_AUTHOR;
    }
    return comment.author || comment.author_name_snapshot || FALLBACK_COMMENT_AUTHOR;
  }

  function getCommentAuthorPicture(comment) {
    if (!comment || !comment.actor_user_id) return '';
    return comment.author_picture_url_snapshot || '';
  }

  function getCommentOrganizationLabel(comment) {
    const key = String(comment?.organization || '').trim().toLowerCase();
    return ORGANIZATION_LABELS[key] || '';
  }

  return {
    escapeHtml,
    normalizePhoneValue,
    buildTelHref,
    sanitizeMapsUrl,
    getCommentAuthorName,
    getCommentAuthorPicture,
    getCommentOrganizationLabel,
  };
});
