// Small Thai pages the LINE callback shows instead of plain-text errors, so a
// team member who lands here on a phone always has a button to carry on.

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

function getLoginPagePath(app) {
  return app === 'jdk' ? '/JDK.html' : '/index.html';
}

function renderAuthPage({ title, text, actionLabel, actionHref, note }) {
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} - Hi Solar</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box;
    background: #f8fafc; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Tahoma, sans-serif; }
  main { width: 100%; max-width: 420px; background: #fff; border: 1px solid rgba(15,23,42,.08); border-radius: 22px;
    padding: 28px 24px; box-shadow: 0 18px 50px rgba(15,23,42,.08); box-sizing: border-box; }
  h1 { font-size: 1.3rem; margin: 0 0 10px; }
  p { color: #475569; line-height: 1.6; margin: 0 0 20px; }
  a.btn { display: block; text-align: center; text-decoration: none; background: #06c755; color: #fff;
    font-weight: 600; padding: 14px 16px; border-radius: 14px; }
  .note { font-size: .88rem; color: #64748b; margin: 16px 0 0; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(text)}</p>
  <a class="btn" href="${escapeHtml(actionHref)}">${escapeHtml(actionLabel)}</a>
  ${note ? `<p class="note">${escapeHtml(note)}</p>` : ''}
</main>
</body>
</html>`;
}

function writeAuthPage(res, statusCode, options) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.end(renderAuthPage(options));
}

module.exports = {
  escapeHtml,
  getLoginPagePath,
  renderAuthPage,
  writeAuthPage,
};
