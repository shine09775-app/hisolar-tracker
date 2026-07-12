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
