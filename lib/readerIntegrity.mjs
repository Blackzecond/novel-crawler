export function isReaderTargetCurrent(active, target) {
  return active.requestId === target.requestId && active.url === target.url && (active.projectId ?? null) === (target.projectId ?? null);
}
export function mergeReadingHistory(...collections) {
  const latest = new Map();
  for (const collection of collections) for (const item of collection ?? []) {
    if (!item || typeof item.url !== 'string' || !item.url) continue;
    const key = (item.projectId ?? 'standalone') + ':' + item.url;
    const previous = latest.get(key);
    if (!previous || Number(item.readAt) >= Number(previous.readAt)) latest.set(key, item);
  }
  return [...latest.values()].sort((a, b) => Number(b.readAt) - Number(a.readAt)).slice(0, 20);
}
export function escapeReaderText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
export function isCloudflareChallengeMarkup({ url = '', html = '', body = '' } = {}) {
  const value = String(html).toLowerCase(); const location = String(url).toLowerCase();
  return location.includes('/cdn-cgi/challenge-platform/') || ['__cf_chl_', 'cf-browser-verification', 'id="challenge-form"', "id='challenge-form'", '#challenge-running'].some((marker) => value.includes(marker))
    || ['正在验证浏览器', '检查您是否为机器人', '检查您不是机器人', 'ตรวจสอบว่าคุณไม่ใช่บอต', 'กำลังตรวจสอบว่าคุณไม่ใช่บอต'].some((marker) => (String(body) + ' ' + String(html)).includes(marker));
}
export function isChapterTitle(title) { return /第\s*[0-9０-９零一二三四五六七八九十百千千万亿两]+\s*[章节回卷]|序章|楔子|番外|尾声|终章|^chapter\s*\d+|^(?:บทที่|ตอนที่)\s*\d+/i.test(String(title ?? '').trim()); }
export function isLikelyChapterGroup(items) {
  if (!Array.isArray(items) || items.length === 0) return false;
  const ratio = items.filter((item) => isChapterTitle(item.title)).length / items.length;
  return items.length === 1 ? ratio === 1 : items.length >= 6 || ratio >= 0.5;
}

export function withStableReplacementOrder(items, baseTime = Date.now()) {
  return items.map((item, index) => ({ ...item, created_at: new Date(baseTime + index).toISOString() }));
}

export function resolveChapterStatus(current, requested, clearsTranslation = false) {
  const next = requested ?? current;
  if (clearsTranslation) return next;
  const rank = (status) => status === 'translated' ? 2 : status === 'fetched' ? 1 : 0;
  return rank(next) > rank(current) ? next : current;
}

export function isArticleTargetCurrent(article, projectId, url) {
  return Boolean(article && article.sourceUrl === url && (article.projectId ?? null) === (projectId ?? null));
}


// Return the newest history entry that still resolves to a chapter in the current shelf.
// Collection order is the stable tie-breaker: local history is passed before cloud history.
export function selectLatestReadableChapter(projects, historyCollections = []) {
  const projectsById = new Map((Array.isArray(projects) ? projects : []).map((project) => [project.id, project]));
  let latest = null;
  let inputOrder = 0;
  for (const collection of historyCollections) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      const order = inputOrder++;
      if (!item || typeof item.url !== 'string' || !item.url.trim()
        || typeof item.projectId !== 'string' || !item.projectId.trim()
        || typeof item.readAt !== 'number' || !Number.isFinite(item.readAt) || item.readAt <= 0) continue;
      const project = projectsById.get(item.projectId);
      if (!project || !Array.isArray(project.chapters)) continue;
      const chapter = project.chapters.find((entry) => entry.url === item.url);
      if (!chapter) continue;
      if (!latest || item.readAt > latest.readAt || (item.readAt === latest.readAt && order < latest.inputOrder)) {
        latest = { project, chapter, readAt: item.readAt, inputOrder: order };
      }
    }
  }
  return latest ? { project: latest.project, chapter: latest.chapter, readAt: latest.readAt } : null;
}


export function isAccountRequestCurrent(activeVersion, requestVersion, activeScope, requestScope) {
  return activeVersion === requestVersion && activeScope === requestScope;
}

export function resolveShelfHistoryRefresh(localHistory, previousCloudHistory, cloudHistory, succeeded) {
  const nextCloudHistory = succeeded
    ? (Array.isArray(cloudHistory) ? cloudHistory : [])
    : (Array.isArray(previousCloudHistory) ? previousCloudHistory : []);
  const nextLocalHistory = Array.isArray(localHistory) ? localHistory : [];
  return { cloudHistory: nextCloudHistory, combinedHistory: [...nextLocalHistory, ...nextCloudHistory] };
}
