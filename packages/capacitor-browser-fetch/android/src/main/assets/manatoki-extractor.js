window.__ncManatokiResult = null;
window.__ncManatokiPending = true;
(async () => {
  const fail = (error) => ({ ok: false, error });
  const toBase64Url = (bytes) => {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };
  const fromBase64Url = (value) => {
    let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4) normalized += '=';
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };
  const extractEscapedProperty = (source, name) => {
    const marker = '\\"' + name + '\\":\\"';
    const start = source.indexOf(marker);
    if (start < 0) return null;
    const valueStart = start + marker.length;
    const end = source.indexOf('\\"', valueStart);
    return end < 0 ? null : source.slice(valueStart, end);
  };
  const readCookie = (name) => {
    for (const part of document.cookie.split(';')) {
      const item = part.trim();
      const separator = item.indexOf('=');
      if (separator < 0 || item.slice(0, separator) !== name) continue;
      const value = item.slice(separator + 1);
      try { return decodeURIComponent(value); } catch (_) { return value; }
    }
    return null;
  };

  try {
    const pageUrl = new URL(location.href);
    const ids = pageUrl.pathname.match(/\/novel\/(\d+)\/(\d+)/);
    if (!ids) return fail('รูปแบบ URL ของ Manatoki ไม่ถูกต้อง');

    const pageResponse = await fetch(pageUrl.href, {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!pageResponse.ok) return fail('โหลดข้อมูลหน้าตอนไม่สำเร็จ HTTP ' + pageResponse.status);
    const pageSource = await pageResponse.text();
    const token = extractEscapedProperty(pageSource, 'token');
    const cookieName = extractEscapedProperty(pageSource, 'cookieName') || 'nv';
    if (!token) return fail('ไม่พบ Token ของตอนในข้อมูลหน้าเว็บ');

    let cookieValue = readCookie(cookieName);
    if (!cookieValue) {
      await fetch('/api/nv-issue', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store'
      });
      cookieValue = readCookie(cookieName);
    }
    if (!cookieValue) return fail('ไม่พบ Session Cookie หลังขอ Session ใหม่');

    const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
    const hmacKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(cookieValue),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const proofBytes = await crypto.subtle.sign(
      'HMAC',
      hmacKey,
      new TextEncoder().encode(token + '.' + nonce + '.' + navigator.userAgent)
    );
    const proof = toBase64Url(new Uint8Array(proofBytes));

    const apiResponse = await fetch('/api/novel-content', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'x-novel-client': 'shadow-v2'
      },
      body: JSON.stringify({
        novelId: ids[1],
        episodeId: ids[2],
        token,
        nonce,
        proof
      })
    });
    if (!apiResponse.ok) return fail('Manatoki API ตอบกลับ HTTP ' + apiResponse.status);

    const apiData = await apiResponse.json();
    if (!apiData || !apiData.ok || apiData.empty || !apiData.payload) {
      return fail('Manatoki API ไม่ส่ง Payload ของเนื้อหาตอนกลับมา');
    }

    const keySegment = cookieValue.split('.')[0] || '';
    if (!keySegment) return fail('Session Cookie ไม่มีส่วนของคีย์ถอดรหัส');
    const encrypted = fromBase64Url(apiData.payload);
    const key = fromBase64Url(keySegment);
    if (!key.length) return fail('คีย์ถอดรหัสว่างเปล่า');
    const decryptedBytes = new Uint8Array(encrypted.length);
    for (let i = 0; i < encrypted.length; i++) {
      decryptedBytes[i] = encrypted[i] ^ key[i % key.length];
    }
    const decodedText = new TextDecoder('utf-8', { fatal: true }).decode(decryptedBytes);

    let decodedData = null;
    if (decodedText.trim().startsWith('{')) {
      try { decodedData = JSON.parse(decodedText); } catch (_) { decodedData = null; }
    }

    let contentHtml = '';
    if (decodedData && decodedData.kind === 'html' && typeof decodedData.html === 'string') {
      const parsed = new DOMParser().parseFromString(decodedData.html, 'text/html');
      parsed.querySelectorAll('script,style,iframe,ins,object,embed,link,meta').forEach((node) => node.remove());
      parsed.querySelectorAll('*').forEach((element) => {
        for (const attribute of Array.from(element.attributes)) {
          const name = attribute.name.toLowerCase();
          const value = attribute.value.trim().toLowerCase();
          if (name.startsWith('on') || ((name === 'href' || name === 'src') && value.startsWith('javascript:'))) {
            element.removeAttribute(attribute.name);
          }
        }
      });
      contentHtml = parsed.body.innerHTML.trim();
    } else {
      const text = decodedData && decodedData.kind === 'text' && typeof decodedData.text === 'string'
        ? decodedData.text
        : decodedText;
      const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
      contentHtml = paragraphs.map((paragraph) => {
        const element = document.createElement('p');
        element.textContent = paragraph;
        return element.outerHTML;
      }).join('');
    }

    if (!contentHtml.trim()) return fail('ถอดรหัสสำเร็จแต่ไม่พบข้อความเนื้อหานิยาย');
    return {
      ok: true,
      url: pageUrl.href,
      title: document.title || 'Manatoki',
      html: '<!doctype html><html><head><meta charset="utf-8"></head><body><article class="reader-content">' + contentHtml + '</article></body></html>'
    };
  } catch (error) {
    return fail(error && error.message ? error.message : 'ถอดรหัสเนื้อหา Manatoki ไม่สำเร็จ');
  }
})().then((result) => {
  window.__ncManatokiResult = JSON.stringify(result);
  window.__ncManatokiPending = false;
}).catch((error) => {
  window.__ncManatokiResult = JSON.stringify({
    ok: false,
    error: error && error.message ? error.message : 'ถอดรหัสเนื้อหา Manatoki ไม่สำเร็จ'
  });
  window.__ncManatokiPending = false;
});
'__NC_MANATOKI_STARTED__';