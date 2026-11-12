/* ===== REQ-061 · 首页流程地图和知识库页面之间的「桥」 =====
   地图是 PD / BD 上传的 HTML,放在不带 allow-same-origin 的 sandbox iframe 里跑(和平台不同源,
   读不到登录 cookie、碰不到 parent.document)。两边只能用 postMessage 说话 —— 返回地图时在末尾附上这段脚本:
   - 在每个板块标题(id="sec-A" … "sec-I")右边画「📄 文档 n」,数字由父页面发过来;点一下告诉父页面
     「跳到这个业务 × 这个板块的文档」;
   - 收到父页面「切到某个业务」就改地图的 #hash(地图自己按 hash 切标签);地图里点了别的标签也告诉父页面。
   - 新地图里没有 sec-X 这些 id:什么都不画,业务切换照常。
   父页面只认来自这个 iframe 的消息,并校验格式(KnowledgeView 里)。消息内容只有业务 / 板块的 key,不敏感。 */

const BRIDGE = `(function () {
  var SECS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
  var counts = {}, lang = 'zh', painting = false, queued = false;
  function tabs() { return document.querySelectorAll('#tabs a[href^="#"]'); }
  function biz() {
    var h = (location.hash || '').slice(1);
    if (!h) return 'overview';
    var ok = false; tabs().forEach(function (a) { if (a.getAttribute('href') === '#' + h) ok = true; });
    return ok ? h : 'overview';
  }
  function say(m) { try { parent.postMessage(m, '*'); } catch (e) {} }
  function paint() {
    queued = false; painting = true;
    try {
      var b = biz();
      SECS.forEach(function (k) {
        var el = document.getElementById('sec-' + k);
        if (!el) return;
        var btn = el.querySelector('.audax-kb-docs');
        var n = (counts[b] && counts[b][k]) || 0;
        var label = '\\uD83D\\uDCC4 ' + (lang === 'en' ? 'Docs ' : '\\u6587\\u6863 ') + n;
        if (!btn) {
          btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'audax-kb-docs'; btn.setAttribute('data-kb-sec', k);
          btn.style.cssText = 'margin-left:auto;font:600 12px/1 system-ui,sans-serif;padding:5px 10px;border-radius:999px;border:1px solid #CBD4DC;background:#fff;color:#15202B;cursor:pointer;white-space:nowrap';
          el.appendChild(btn);
        }
        if (btn.textContent !== label) btn.textContent = label;
      });
    } finally { painting = false; }
  }
  function soon() { if (!queued) { queued = true; requestAnimationFrame(paint); } }
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('.audax-kb-docs') : null;
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    say({ type: 'audax-kb:docs', biz: biz(), sec: t.getAttribute('data-kb-sec') });
  }, true);
  window.addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'audax-kb:counts' && m.counts && typeof m.counts === 'object') { counts = m.counts; lang = m.lang === 'en' ? 'en' : 'zh'; soon(); }
    if (m.type === 'audax-kb:biz' && typeof m.biz === 'string' && /^[a-z]{2,20}$/.test(m.biz)) {
      var want = m.biz === 'overview' ? 'overview' : m.biz;
      if (biz() !== want) location.hash = want;
    }
  });
  addEventListener('hashchange', function () { soon(); say({ type: 'audax-kb:biz-changed', biz: biz() }); });
  if (window.MutationObserver) new MutationObserver(function () { if (!painting) soon(); }).observe(document.documentElement, { childList: true, subtree: true });
  soon();
  say({ type: 'audax-kb:ready', biz: biz() });
})();`;

export const MAP_CSP = 'sandbox allow-scripts allow-popups';

/* 在地图 HTML 末尾(</body> 前)附上桥脚本 */
export function withBridge(html: string): string {
  const tag = `<script>${BRIDGE}</script>`;
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i >= 0 ? html.slice(0, i) + tag + html.slice(i) : html + tag;
}
