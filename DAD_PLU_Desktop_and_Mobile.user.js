// ==UserScript==
// @name         DAD PLU (Desktop & Mobile) GA + HotKey
// @namespace    https://dad.mohajiho.com/
// @author       Mohsen Hajihosseinnejad * alias: MOHAJIHO * email: mohajiho@gmail.com
// @version      1.1
// @description  Find ASINs & product info, generate QR in a popup, send GA4 events, and trigger scan with a configurable keyboard shortcut.
// @match        *://*.amazon.com/*
// @match        *://*.amazon.*/*
// @match        *://*.a2z.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      https://www.google-analytics.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js
// @downloadURL  https://raw.githubusercontent.com/MohsenUSA/product_lookup/main/DAD_PLU_Desktop_and_Mobile.user.js
// @updateURL    https://raw.githubusercontent.com/MohsenUSA/product_lookup/main/DAD_PLU_Desktop_and_Mobile.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* ----------------- USER‑EDITABLE HOTKEY ----------------- */
  const HOTKEY = { key:'L', shift:true, ctrl:false, alt:false, meta:false };

  /* -------------- Load Material Icons font -------------- */
  const iconLink = document.createElement('link');
  iconLink.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
  iconLink.rel = 'stylesheet';
  document.head.appendChild(iconLink);

  /* ------------------------- CONFIG ------------------------ */
  const CONFIG = {
    asinContainers: ['.a-size-base.prodDetAttrValue'],
    pageTextRegex:  /\bB[A-Z0-9]{9}\b/g,
    unitSelectors: [
      '#corePrice_desktop','#corePrice_desktop_feature_div','#corePrice_feature_div',
      '#pickupPrice_feature_div','#corePriceDisplay_desktop_feature_div',
      '#corePrice_mobile_feature_div','#corePriceDisplay_mobile_feature_div'
    ],
    unitRegex: /\(\s*\$([\d,.]+)(?:\s*\$[\d,.]+)?\s*\/\s*([^)]+)\)/,
    availabilitySelectors: [
      '#availability .a-size-medium','#availability .a-color-success',
      '#availability .a-color-state','#availability span',
      '#availability-string .a-color-price','#availability-string .a-text-bold',
      '#availability-string .a-size-medium.a-color-success',
      '#almOutOfStockAvailability_feature_div .a-color-state',
      '#almAvailability_feature_div .a-text-bold',
      '.a-section.a-spacing-medium .a-color-price'
    ],
    discountSelector:         '.savingPriceOverride, .a-color-price.savingPriceOverride',
    promoPriceSelector:       '.priceToPay .a-offscreen',
    regularPriceSelector:     '.basisPrice .a-offscreen',
    fallbackPriceSelector:    '#priceblock_ourprice',
    primeContainerSelectors:  [
      '[id^="corePriceDisplay_desktop_feature_div"]',
      '[id^="corePriceDisplay_mobile_feature_div"]'
    ],
    snapTextRegex:            /\bSNAP EBT eligible\b/i,
    savingsMessageSelector:   '[id^="promoMessage"]',
    savingsLabelSelector:     "label[for^='checkbox']"
  };

  /* ------------------ scrape current page ------------------ */
  function findPatternInPage() {
    /* Title */
    let productTitle = '';
    const titleEl =
      document.getElementById('productTitle') ||
      document.querySelector('[data-csa-c-content-id="title"]') ||
      document.querySelector('#title');
    if (titleEl) productTitle = titleEl.textContent.trim();

    /* ASINs */
    let codes = [];
    document.querySelectorAll(CONFIG.asinContainers.join(',')).forEach(el => {
      const m = el.textContent.match(CONFIG.pageTextRegex);
      if (m) codes.push(m[0]);
    });
    if (!codes.length) {
      const all = document.body.innerText.match(CONFIG.pageTextRegex) || [];
      codes = [...new Set(all)];
    }

    /* Availability */
    let availability = '';
    const availEl = document.querySelector(CONFIG.availabilitySelectors.join(','));
    if (availEl) {
      const t = availEl.textContent.trim();
      if (/low stock\s*[–-]\s*order soon/i.test(t)) availability = 'Low Stock';
      else if (/in stock/i.test(t)) availability = 'In Stock';
      else if (/currently unavailable|out of stock/i.test(t)) availability = 'Out of Stock';
      else availability = t;
    }

    /* Prices */
    let discount = '', promoPrice = '', regularPrice = '';
    const dEl = document.querySelector(CONFIG.discountSelector);
    const pEl = document.querySelector(CONFIG.promoPriceSelector);
    const rEl = document.querySelector(CONFIG.regularPriceSelector);
    const fb = document.querySelector(CONFIG.fallbackPriceSelector);
    if (dEl) discount = dEl.textContent.trim();
    if (pEl) promoPrice = pEl.textContent.trim();
    if (rEl) regularPrice = rEl.textContent.trim();
    if (!promoPrice && fb) promoPrice = fb.textContent.trim();

    /* Prime exclusive / typical */
    let primeExclusivePrice = '', typicalPrice = '';
    document.querySelectorAll(CONFIG.primeContainerSelectors.join(','))
      .forEach(coreEl => {
        if (!primeExclusivePrice) {
          const pep = coreEl.querySelector('.priceToPay [aria-hidden="true"]');
          if (pep) primeExclusivePrice = pep.textContent.trim();
        }
        if (!typicalPrice) {
          const tp = coreEl.querySelector('.basisPrice .a-text-price .a-offscreen');
          if (tp) typicalPrice = tp.textContent.trim();
        }
      });

    /* Unit price */
    let unitPrice = '';
    for (const sel of CONFIG.unitSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      const m = el.innerText.replace(/\s+/g, ' ').match(CONFIG.unitRegex);
      if (m) { unitPrice = `($${m[1]} / ${m[2].trim()})`; break; }
    }

    /* SNAP EBT */
    const snapEbtStatus = CONFIG.snapTextRegex.test(document.body.innerText)
      ? 'SNAP EBT eligible'
      : 'NOT SNAP EBT eligible';

    /* Savings promo */
    let savingsText = '', savingsLink = '';
    try {
      const promoMsg = document.querySelector(CONFIG.savingsMessageSelector);
      const label = document.querySelector(CONFIG.savingsLabelSelector);
      if ((label && label.textContent.trim() === 'Savings') ||
          (!label && /Savings/i.test(promoMsg?.textContent || ''))) {
        if (promoMsg) {
          savingsText = Array.from(promoMsg.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .join(' ');
          const a = promoMsg.querySelector('a');
          if (a) savingsLink = a.href;
        }
      }
    } catch {/* ignore */}

    return {
      codes,
      productTitle,
      availability,
      discount,
      promoPrice,
      regularPrice,
      primeExclusivePrice,
      typicalPrice,
      unitPrice,
      snapEbtStatus,
      savingsText,
      savingsLink
    };
  }

  /* ------------------ build popup HTML ------------------ */
  function buildInnerHTML(data) {
    let html = `<div id="gm-asin-panel">
      <h3>Found ${data.codes.length} ASIN${data.codes.length > 1 ? 's':''}</h3>`;

    data.codes.forEach(code => {
      html += `<div class="qr-item">`;
      if (data.codes.length === 1 && data.productTitle) {
        html += `<div class="product-title">${data.productTitle}</div>`;
      }
      html += `
        <div class="qr-code-container" id="qr-${code}"></div>
        <p class="code-text">ASIN: ${code}</p>`;

      if (data.codes.length === 1) {
        /* single‑ASIN extras */
        if (data.availability) {
          const cls =
            data.availability === 'Low Stock'
              ? 'low-stock'
              : /in stock/i.test(data.availability)
              ? 'in-stock'
              : 'out-of-stock';
          html += `<p class="availability ${cls}">${data.availability}</p>`;
        }
        if (data.promoPrice) {
          html += `<p class="promo-price">Promo Price: ${data.promoPrice}</p>`;
        } else if (data.primeExclusivePrice) {
          html += `<p class="promo-price">Exclusive Prime: ${data.primeExclusivePrice}</p>`;
        }
        if (data.unitPrice) {
          html += `<p class="unit-price">${data.unitPrice}</p>`;
        }
        if (data.typicalPrice) {
          html += `<p class="regular-price">Typical Price: ${data.typicalPrice}</p>`;
        }
        if (data.regularPrice && data.regularPrice !== data.typicalPrice) {
          html += `<p class="regular-price">Regular Price: ${data.regularPrice}</p>`;
        }
        if (data.discount) {
          html += `<p class="discount-percentage">Discount: ${data.discount}</p>`;
        }
        const snapClass = data.snapEbtStatus.startsWith('SNAP')
                         ? 'snap-eligible' : 'snap-not-eligible';
        html += `<p class="${snapClass}">${data.snapEbtStatus}</p>`;
        if (data.savingsText) {
          html += `<p class="savings-message">Savings: "${data.savingsText}"<br>
              <a href="${data.savingsLink}" target="_blank">Shop deal</a></p>`;
        }
      }
      html += `</div>`;
    });

    /* footer buttons */
    html += `<div class="footer">
      <button id="support-btn"   class="btn support-btn"   title="Support Info"><i class="material-icons">contact_support</i><span class="tooltiptext"></span></button>
      <button id="copy-img-btn"  class="btn copy-img-btn"  title="Copy QR Code Image"><i class="material-icons">qr_code</i><span class="tooltiptext"></span></button>
      <button id="copy-btn"      class="btn copy-btn"      title="Copy All Product Info"><i class="material-icons">content_copy</i><span class="tooltiptext"></span></button>
      <button id="copy-asin-btn" class="btn copy-asin-btn" title="Copy ASIN"><i class="material-icons">spellcheck</i><span class="tooltiptext"></span></button>
      <button id="copy-all-btn"  class="btn copy-all-btn"  title="Copy All ASINs" style="display:none;"><i class="material-icons">spellcheck</i><span class="tooltiptext"></span></button>
      <button id="close-btn-bottom" class="btn close-btn-bottom" title="Close"><i class="material-icons">close</i></button>
    </div>
  </div>`;
    return html;
  }

  /* ----------- Google Analytics via Measurement Protocol ----------- */
  const measurementId = 'G-MLS2KFS6R9';
  const apiSecret = 'M4MfavQ3QSuVH7Bz_b6MBA';

  function getClientId() {
    let cid = localStorage.getItem('ga4_client_id');
    if (!cid) {
      cid = Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('ga4_client_id', cid);
    }
    return cid;
  }
  function sendMPEvent(name='script_loaded') {
    GM_xmlhttpRequest({
      method: 'POST',
      url: `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
      headers: { 'Content-Type': 'application/json' },
      anonymous: true,
      data: JSON.stringify({
        client_id: getClientId(),
        events: [{
          name,
          params: {
            debug_mode: true,
            engagement_time_msec: 1,
            page_location: location.href,
            page_title: document.title,
            script_name: 'DAD PLU v1.1'
          }
        }]
      })
    });
  }
  sendMPEvent();

  /* ----------------- main: open popup tab ----------------- */
  function scanPage() {
    const data = findPatternInPage();
    if (!data.codes.length) { alert('No ASINs found!'); return; }

const desktopWidth = Math.min(window.innerWidth || 400, 460);
const initialHeight = 120;

const win = window.open(
  'about:blank',
  '_blank',
  `width=${desktopWidth},height=${initialHeight},resizable=yes,scrollbars=yes`
);
    const doc = win.document;
    const json = JSON.stringify(data).replace(/</g,'\\u003c').replace(/-->/g,'\\u002d\\u002d>');

    /* ---------------- popup CSS ---------------- */
    const popupCSS = `
      body { margin:0; }
      #gm-asin-panel {
        position:fixed; top:0; left:0; right:0; bottom:0;
        overflow-y:auto; background:#f0f2f5; padding:20px;
        box-sizing:border-box; font-family:Arial,Helvetica,sans-serif;
      }
      #gm-asin-panel h3 {
        text-align:center; margin:0 0 15px; font-size:18px; color:#111;
      }
      .support-box {
        background:#fff; border:1px solid #ccc; border-radius:8px;
        padding:10px; margin-bottom:15px;
      }
      .support-box p { margin:5px 0; }
      .support-box a { color:#0066c0; }
      #close-support-btn {
        margin-top:8px; padding:4px 8px; border:none;
        border-radius:4px; background:#d9534f; color:#fff; cursor:pointer;
      }
      .qr-item {
        background:#fff; border:1px solid #ccc; border-radius:8px;
        padding:15px; margin-bottom:15px;
        box-shadow:0 1px 3px rgba(0,0,0,0.1); text-align:center;
      }
      .product-title { font-weight:bold; color:#0066c0; margin-bottom:12px; }
      .qr-code-container { display:flex; justify-content:center; margin:0 auto 10px; }
      .code-text { font-weight:bold; margin-bottom:10px; }
      .availability {
        font-size:18px; font-weight:bold; width:90%; padding:5px; color:#fff; margin:auto;
      }
      .in-stock{background:#4caf50;} .low-stock{background:#ffa500;} .out-of-stock{background:#d9534f;}
      .promo-price{color:rgb(50,112,246);font-weight:bold;margin-bottom:6px;}
      .regular-price{color:#555;margin-bottom:6px;}
      .discount-percentage{color:#cc0c39;font-weight:bold;margin-bottom:6px;}
      .unit-price{color:rgb(75,140,245);margin-bottom:6px;}
      .snap-eligible{color:#4caf50;margin-bottom:6px;}
      .snap-not-eligible{color:#d9534f;margin-bottom:6px;}
      .savings-message{background:#ccf1cd;padding:5px;border-radius:4px;margin-bottom:10px;}
      .savings-message a{font-weight:bold;}
      .footer{
        position:fixed;bottom:0;left:0;right:0;background:#fff;padding:10px;
        border-top:1px solid #ccc;display:flex;justify-content:center;gap:clamp(6px,2vw,12px);
      }
      .btn{
        width:clamp(34px,10vw,45px);height:clamp(34px,10vw,45px);
        border:none;border-radius:50%;display:flex;align-items:center;justify-content:center;
        cursor:pointer;position:relative;transition:transform .1s;
      }
      .btn:active{transform:scale(.95);}
      .btn .tooltiptext{
        position:absolute;bottom:110%;left:50%;transform:translateX(-50%);
        background:rgba(0,0,0,.8);color:#fff;padding:4px 6px;border-radius:4px;font-size:12px;
        white-space:nowrap;visibility:hidden;opacity:0;transition:opacity .2s;
      }
      .support-btn{background:#4285f4;color:#fff;}
      .copy-img-btn{background:#f0c14b;color:#111;}
      .copy-btn{background:#0066c0;color:#fff;}
      .copy-asin-btn,
      .copy-all-btn{background:#4caf50;color:#fff;}
      .close-btn-bottom{background:#d9534f;color:#fff;}
      .material-icons{font-size:clamp(18px,5vw,22px);}
    `;

    /* ---------------- GA4 gtag (debug) ---------------- */
    const gaTag = `
      <script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>
      <script>
        window.dataLayer = window.dataLayer || [];
        function gtag(){ dataLayer.push(arguments); }
        gtag('js', new Date());
        gtag('config', '${measurementId}', { debug_mode:true, send_page_view:false });
        gtag('event','page_view',{
          debug_mode:true,
          page_location:'https://dad.mohajiho.com/popup',
          page_title:'ASIN Finder Popup'
        });
      <\/script>
    `;

    /* --------- write popup --------- */
    doc.write(`<!doctype html><html><head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>ASIN Finder</title>
      ${gaTag}
      <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
      <style>${popupCSS}</style>
    </head><body>
      ${buildInnerHTML(data)}
      <script>
        const data = ${json};

    /* ---------- grow‑only auto‑height (panel‑based) ---------- */
    (function () {
      const panel = document.getElementById('gm-asin-panel');
      let last = 0, start = Date.now();

    function grow() {
      try {
      const footer = document.querySelector('.footer');
      const footerH = footer ? footer.offsetHeight : 0;

    // Panel’s content + footer + a little safety margin
      const wanted = panel.scrollHeight + footerH + 20;
      const max    = screen.availHeight;        // don’t exceed screen

        if (wanted > last && wanted <= max) {
          window.resizeTo(window.outerWidth, wanted);   // only GROW
          last = wanted;
        }
      } catch { /* ignore */ }

      // keep trying for about 4 s
      if (Date.now() - start < 4000) requestAnimationFrame(grow);
    }

      window.addEventListener('load', () => {
        grow();              // first pass
        setTimeout(grow, 150); // after QR images render
      });

      // Enlarge later if user opens support box or more QR codes appear
      new ResizeObserver(grow).observe(panel);
    })();

        /* ---------- analytics helper ---------- */
        function track(btn){
          if(window.gtag){
            gtag('event', btn, {
              debug_mode:true,
              page_location:'https://dad.mohajiho.com/popup',
              script_name:'DAD PLU v1.1'
            });
          }
        }

        /* hide Copy‑QR on mobile */
        if(/Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile/i.test(navigator.userAgent)){
          const b=document.querySelector('.copy-img-btn'); if(b) b.style.display='none';
        }

        /* build QR codes */
        const qrSize = Math.max(160, Math.min(window.innerWidth*0.4, 200));
        data.codes.forEach(c =>
          new QRCode(document.getElementById('qr-'+c), {text:c,width:qrSize,height:qrSize})
        );

        /* show Copy All ASINs if multi */
        if(data.codes.length>1)
          document.getElementById('copy-all-btn').style.display='inline-flex';

        /* support box */
        document.getElementById('support-btn').onclick = () => {
          track('support_opened');
          if(document.querySelector('.support-box')) return;
          const box=document.createElement('div');
          box.className='support-box';
          box.innerHTML='<p>I hope you enjoy using this!</p>'+
            '<p>Email: <a href="mailto:mohajiho@gmail.com">mohajiho@gmail.com</a></p>'+
            '<p><a href="https://www.linkedin.com/in/mohajiho" target="_blank">LinkedIn</a></p>'+
            '<button id="close-support-btn">Close</button>';
          document.getElementById('gm-asin-panel')
            .insertBefore(box, document.getElementById('gm-asin-panel').children[1]);
          document.getElementById('close-support-btn').onclick = () => box.remove();
          showTooltip(document.getElementById('support-btn'),'Opened');
        };

        /* copy handlers */
        ['copy-img-btn','copy-btn','copy-asin-btn','copy-all-btn'].forEach(id=>{
          const btn=document.getElementById(id); if(!btn) return;
          btn.onclick=async()=>{ try{
            if(id==='copy-img-btn'){
              const img=document.querySelector('.qr-code-container img'); if(!img) return;
              const canvas=document.createElement('canvas');
              canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
              canvas.getContext('2d').drawImage(img,0,0);
              await new Promise(res=>{
                canvas.toBlob(blob=>{
                  navigator.clipboard.write([new ClipboardItem({'image/png':blob})])
                    .then(res).catch(()=>res(false));
                });
              });
              track('copy_qr_img');
            }else if(id==='copy-btn'){
              const txt=data.productTitle
                ? data.productTitle + ' – ASIN ' + data.codes[0]
                : 'ASIN ' + data.codes[0];
              await navigator.clipboard.writeText(txt);
              track('copy_info');
            }else if(id==='copy-asin-btn'){
              await navigator.clipboard.writeText(data.codes[0]);
              track('copy_asin');
            }else{
              await navigator.clipboard.writeText(data.codes.join('\\n'));
              track('copy_all_asins');
            }
            showTooltip(btn,'Copied!');
          }catch(e){ alert('Clipboard error: '+e.message); }};
        });

        document.getElementById('close-btn-bottom').onclick = () => window.close();

        function showTooltip(btn,msg){
          const tip=btn.querySelector('.tooltiptext');
          tip.textContent=msg; tip.style.visibility='visible'; tip.style.opacity='1';
          setTimeout(()=>{tip.style.opacity='0';tip.style.visibility='hidden';},1500);
        }
      <\/script>
    </body></html>`);
    doc.close();
  }

  /* ---------------- Tampermonkey menu ---------------- */
  GM_registerMenuCommand('Scan ASINs', scanPage);

    /* -------- floating scan button & hotkey -------- */
  if(!window.opener && !/about:blank/i.test(location.href)){
    const host=document.createElement('div');
    Object.assign(host.style,{all:'initial',position:'fixed',top:0,left:0,width:0,height:0,zIndex:2147483647});
    document.documentElement.appendChild(host);

    const shadow=host.attachShadow({mode:'closed'});
    shadow.innerHTML=`
      <style>
        #gm-asin-btn{
          position:fixed;bottom:20px;right:20px;width:48px;height:48px;border-radius:50%;
          background:#4caf50;color:#fff;border:none;font-family:'Material Icons';font-size:28px;
          cursor:pointer;display:flex;align-items:center;justify-content:center;
          animation:gm-flash 3s linear infinite;
        }
        #gm-asin-btn:active{transform:scale(.95);}
        @keyframes gm-flash{
          0%,49%  {background:#4caf50;color:#fff;}
          50%,100%{background:#05A0D1;color:#fff;}
        }
      </style>
      <button id="gm-asin-btn" title="Start Scan">search</button>
    `;
    shadow.getElementById('gm-asin-btn').addEventListener('click',scanPage);

    /* survive SPA nav */
    const fire=()=>window.dispatchEvent(new Event('locationchange'));
    const _ps=history.pushState; history.pushState=function(){_ps.apply(this,arguments);fire();};
    const _rs=history.replaceState; history.replaceState=function(){_rs.apply(this,arguments);fire();};
    window.addEventListener('popstate',fire);

    /* hotkey */
    function hotkeyMatches(e){
      return e.key.toLowerCase()===HOTKEY.key.toLowerCase() &&
             e.shiftKey===HOTKEY.shift && e.ctrlKey===HOTKEY.ctrl &&
             e.altKey===HOTKEY.alt && e.metaKey===HOTKEY.meta;
    }
    window.addEventListener('keydown',e=>{
      if(!hotkeyMatches(e)) return;
      const tgt=e.target, tag=(tgt.tagName||'').toUpperCase();
      if(tgt.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(tag)) return;
      e.preventDefault(); scanPage();
    });
  }
})();
