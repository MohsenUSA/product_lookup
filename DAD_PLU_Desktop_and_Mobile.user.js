// ==UserScript==
// @name         DAD PLU (Desktop & Mobile) GA + HotKey
// @namespace    https://dad.mohajiho.com/
// @author       Mohsen Hajihosseinnejad * alias: MOHAJIHO * email: mohajiho@gmail.com
// @version      5.0
// @description  Find ASINs & product info, generate QR or Code-128 barcode in a popup, send GA4 events, and trigger scan with a configurable keyboard shortcut.
// @match        *://*.amazon.com/*
// @match        *://*.amazon.*/*
// @match        *://*.a2z.com/*
// @match        *://*.github.io/*
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      https://www.google-analytics.com
// @require      https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js
// @downloadURL  https://raw.githubusercontent.com/MohsenUSA/product_lookup/main/DAD_PLU_Desktop_and_Mobile.user.js
// @updateURL    https://raw.githubusercontent.com/MohsenUSA/product_lookup/main/DAD_PLU_Desktop_and_Mobile.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* ----------------- USER-EDITABLE HOTKEY ----------------- */
  const HOTKEY = { key: 'L', shift: true, ctrl: false, alt: false, meta: false };

  /* -------------- Load icon fonts -------------- */
  const iconLink = document.createElement('link');
  iconLink.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
  iconLink.rel = 'stylesheet';
  document.head.appendChild(iconLink);

  const symLink = document.createElement('link');
  symLink.href = 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined';
  symLink.rel = 'stylesheet';
  document.head.appendChild(symLink);

  /* ------------------------- CONFIG ------------------------ */
  const CONFIG = {
    asinContainers: ['.a-size-base.prodDetAttrValue'],
    pageTextRegex: /\bB(?=[A-Z0-9]{9}\b)(?=[A-Z]*\d)[A-Z0-9]{9}/g,
    unitSelectors: [
      '#corePrice_desktop',
      '#corePrice_desktop_feature_div',
      '#corePrice_feature_div',
      '#pickupPrice_feature_div',
      '#corePriceDisplay_desktop_feature_div',
      '#corePrice_mobile_feature_div',
      '#corePriceDisplay_mobile_feature_div'
    ],
    unitRegex: /\$\s*([\d,.]+)(?:\s*\$[\d,.]+)?\s*\/\s*([^)]+)/,
    availabilitySelectors: [
      '#availability .a-size-medium',
      '#availability .a-color-success',
      '#availability .a-color-state',
      '#availability span',
      '#availability-string .a-color-price',
      '#availability-string .a-text-bold',
      '#availability-string .a-size-medium.a-color-success',
      '#almOutOfStockAvailability_feature_div .a-color-state',
      '#almAvailability_feature_div .a-text-bold',
      '.a-section.a-spacing-medium .a-color-price'
    ],
    discountSelector: '.savingPriceOverride, .a-color-price.savingPriceOverride',
    promoPriceSelector: '.priceToPay .a-offscreen',
    regularPriceSelector: '.basisPrice .a-offscreen',
    fallbackPriceSelector: '#priceblock_ourprice',
    primeContainerSelectors: [
      '[id^="corePriceDisplay_desktop_feature_div"]',
      '[id^="corePriceDisplay_mobile_feature_div"]'
    ],
    snapTextRegex: /\bSNAP EBT eligible\b/i,
    savingsMessageSelector: '[id^="promoMessage"]',
    savingsLabelSelector: "label[for^='checkbox']"
  };

  /* ---------- helper: value in Item-details table ---------- */
  function getDetailValue(label) {
    label = label.toLowerCase();
    const rows = document.querySelectorAll('.prodDetTable tr');
    for (const row of rows) {
      const th = row.querySelector('th');
      const td = row.querySelector('td');
      if (th && td && th.textContent.trim().toLowerCase() === label) {
        return td.textContent.trim();
      }
    }
    return '';
  }

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
    let discount = '',
        promoPrice = '',
        regularPrice = '';
    const dEl = document.querySelector(CONFIG.discountSelector);
    const pEl = document.querySelector(CONFIG.promoPriceSelector);
    const rEl = document.querySelector(CONFIG.regularPriceSelector);
    const fb = document.querySelector(CONFIG.fallbackPriceSelector);
    if (dEl) discount = dEl.textContent.trim();
    if (pEl) promoPrice = pEl.textContent.trim();
    if (rEl) regularPrice = rEl.textContent.trim();
    if (!promoPrice && fb) promoPrice = fb.textContent.trim();

    /* Prime exclusive / typical */
    let primeExclusivePrice = '',
        typicalPrice = '';
    document
      .querySelectorAll(CONFIG.primeContainerSelectors.join(','))
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
      if (m) {
        unitPrice = `($${m[1]} / ${m[2].trim()})`;
        break;
      }
    }

    /* SNAP EBT */
    const snapEbtStatus = CONFIG.snapTextRegex.test(document.body.innerText)
      ? 'SNAP EBT eligible'
      : 'NOT SNAP EBT eligible';

    /* Savings promo */
    let savingsText = '',
        savingsLink = '';
    try {
      const promoMsg = document.querySelector(CONFIG.savingsMessageSelector);
      const label = document.querySelector(CONFIG.savingsLabelSelector);
      if (
        (label && label.textContent.trim() === 'Savings') ||
        (!label && /Savings/i.test(promoMsg?.textContent || ''))
      ) {
        if (promoMsg) {
          savingsText = Array.from(promoMsg.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .join(' ');
          const a = promoMsg.querySelector('a');
          if (a) savingsLink = a.href;
        }
      }
    } catch {}

    /* --------- extra fields --------- */
    let productType = '';
    const stateEl = document.querySelector(
      'script[type="a-state"][data-a-state*="voyager-desktop-context"]'
    );
    if (stateEl && stateEl.textContent) {
      try {
        const obj = JSON.parse(stateEl.textContent.trim());
        if (obj.product_type) productType = obj.product_type;
      } catch {}
    }

    const productCategory =
      getDetailValue('Product Category') ||
      getDetailValue('Brand Name') ||
      getDetailValue('Category');

    const location = getDetailValue('Manufacturer') || getDetailValue('Location');

    let upc = getDetailValue('UPC');
    if (upc) {
      upc = upc
        .split(/\s+/)
        .filter(v => /^\d{12}$/.test(v))
        .join('\n');
    }

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
      savingsLink,
      productType,
      productCategory,
      location,
      upc
    };
  }

  /* ------------------ build popup HTML ------------------ */
  function buildInnerHTML(data) {
    let html = `<div id="gm-asin-panel">
      <h3>Found ${data.codes.length} ASIN${data.codes.length > 1 ? 's' : ''}</h3>`;

    data.codes.forEach(code => {
      html += `<div class="qr-item">`;
      if (data.codes.length === 1 && data.productTitle) {
        html += `<div class="product-title">${data.productTitle}</div>`;
      }
      html += `
        <div class="qr-code-container" id="qr-${code}"></div>
        <p class="code-text">ASIN: ${code}</p>`;

      if (data.codes.length === 1) {
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
        // ── SNAP EBT: only show when the item is NOT out of stock ──
        if (!/out of stock/i.test(data.availability || '')) {
          const snapClass = data.snapEbtStatus.startsWith('SNAP')
            ? 'snap-eligible'
            : 'snap-not-eligible';
          html += `<p class="${snapClass}">${data.snapEbtStatus}</p>`;
        }

        if (data.savingsText) {
          html += `<p class="savings-message">Savings: "${data.savingsText}"<br>
            <a href="${data.savingsLink}" target="_blank">Shop deal</a></p>`;
        }

        /* extra fields */
        const extra = [];
        if (data.productType) extra.push(`<p class="product-type">Product Type: ${data.productType}</p>`);
        if (data.productCategory) extra.push(`<p class="product-category">Product Category / Brand: ${data.productCategory}</p>`);
        if (data.location) extra.push(`<p class="location">Location / Manufacturer: ${data.location}</p>`);
        if (data.upc) {
            extra.push(
          `<p class="upc">UPC(s):<br>${data.upc.replace(/\n/g, '<br>')}</p>`
        );
        }
        if (extra.length) {
          html += `<div class="extra-info">${extra.join('')}</div>`;
        }
      }
      html += `</div>`;
    });

    /* footer */
    html += `<div class="footer">
      <div class="footer-inner">
        <button id="support-btn"   class="btn support-btn"   title="Support Info"><i class="material-icons">contact_support</i><span class="tooltiptext"></span></button>
        <button id="barcode-btn"   class="btn barcode-btn"   title="Toggle Barcode / QR"><i class="material-symbols-outlined">barcode_scanner</i><span class="tooltiptext"></span></button>
        <button id="copy-img-btn"  class="btn copy-img-btn"  title="Copy QR Code Image"><i class="material-icons">qr_code</i><span class="tooltiptext"></span></button>
        <button id="copy-btn"      class="btn copy-btn"      title="Copy All Product Info"><i class="material-icons">content_copy</i><span class="tooltiptext"></span></button>
        <button id="copy-asin-btn" class="btn copy-asin-btn" title="Copy ASIN"        style="display:none;"><i class="material-icons">spellcheck</i><span class="tooltiptext"></span></button>
        <button id="copy-all-btn"  class="btn copy-all-btn"  title="Copy All ASINs"   style="display:none;"><i class="material-icons">spellcheck</i><span class="tooltiptext"></span></button>
        <button id="close-btn-bottom" class="btn close-btn-bottom" title="Close"><i class="material-icons">close</i></button>
      </div></div>
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
  function sendMPEvent(name = 'script_loaded') {
    GM_xmlhttpRequest({
      method: 'POST',
      url: `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
      headers: { 'Content-Type': 'application/json' },
      anonymous: true,
      data: JSON.stringify({
        client_id: getClientId(),
        events: [
          {
            name,
            params: {
              debug_mode: true,
              engagement_time_msec: 1,
              page_location: location.href,
              page_title: document.title,
              script_name: 'DAD PLU v5.0'
            }
          }
        ]
      })
    });
  }
  sendMPEvent();

  /* ----------------- main: open popup tab ----------------- */
  function scanPage() {
    const data = findPatternInPage();
    if (!data.codes.length) {
      alert('No ASINs found!');
      return;
    }

    const desktopWidth = Math.min(window.innerWidth || 400, 460);
    const wantedHeight = Math.min(
      screen.availHeight,
      document.documentElement.clientHeight || 600
    );

    const win = window.open(
      'about:blank',
      '_blank',
      `width=${desktopWidth},height=${wantedHeight},resizable=yes,scrollbars=yes`
    );
    const doc = win.document;
    const json = JSON.stringify(data)
      .replace(/</g, '\\u003c')
      .replace(/-->/g, '\\u002d\\u002d>');

    /* ---------------- popup CSS ---------------- */
    const popupCSS = `
      body { margin:0; }
      #gm-asin-panel {
        background:#f0f2f5; padding:20px;
        box-sizing:border-box; font-family:Arial,Helvetica,sans-serif;
        min-height:100%;
      }
      #gm-asin-panel h3 {
        text-align:center; margin:0 0 15px; font-size:18px; color:#111;
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
      .extra-info p + p {
       margin-top: 16px;
      }
      .extra-info{
        background:#eef3ff;border-radius:8px;padding:8px 10px;margin-top:10px;
      }
      .extra-info p{margin:4px 0;color:#555;}
      .snap-eligible{color:#4caf50;margin-bottom:6px;}
      .snap-not-eligible{color:#d9534f;margin-bottom:6px;}
      .savings-message{background:#ccf1cd;padding:5px;border-radius:4px;margin-bottom:10px;}
      .savings-message a{font-weight:bold;}
      .extra-info .product-type     { color:rgb(4, 139, 184); margin-bottom:6px; }
      .extra-info .product-category { color:rgb(148, 66, 133); margin-bottom:6px; }
      .extra-info .location         { color:rgb(249, 164, 7);  margin-bottom:6px; }
      .extra-info .upc              { color:rgb(255, 55, 0); margin-bottom:6px; }
      .upc {
        margin-top: 1px;   /* spacing before the first UPC */
        line-height: 2; /* gentle space between UPCs   */
      }
      /* footer containers */
      .footer{
        position:sticky;bottom:0;padding:10px;background:transparent;
        display:flex;justify-content:center;
      }
      .footer-inner{
        background:#fff;border:1px solid #ccc;border-radius:14px;
        display:flex;gap:clamp(6px,2vw,12px);padding:8px 10px;
        box-shadow:0 2px 4px rgba(0,0,0,.1);
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
      .barcode-btn{background:#f9a825;color:#111;}
      .copy-img-btn{background:#f0c14b;color:#111;}
      .copy-btn{background:#0066c0;color:#fff;}
      .copy-asin-btn,
      .copy-all-btn{background:#4caf50;color:#fff;}
      .close-btn-bottom{background:#d9534f;color:#fff;}
      .material-icons,
      .material-symbols-outlined{
        font-size:clamp(18px,5vw,22px);
      }
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
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet"><!-- Symbols for barcode_scanner -->
      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.0/dist/barcodes/JsBarcode.ean-upc.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.0/dist/barcodes/JsBarcode.code128.min.js"></script>
      <style>${popupCSS}</style>
    </head><body>
      ${buildInnerHTML(data)}
      <script>
        const data = ${json};

        /* build QR codes */
        const qrSize = Math.max(160, Math.min(window.innerWidth*0.4, 200));
        data.codes.forEach(c =>
          new QRCode(document.getElementById('qr-'+c), {text:c,width:qrSize,height:qrSize})
        );

        /* decide which copy buttons to show */
        if(data.codes.length>1){
          document.getElementById('copy-all-btn').style.display='inline-flex';
          document.getElementById('copy-btn').style.display='none';
          const imgBtn=document.querySelector('.copy-img-btn');
          if(imgBtn) imgBtn.style.display='none';
        }else{
          document.getElementById('copy-asin-btn').style.display='inline-flex';
        }

        /* analytics helper */
        function track(btn){
          if(window.gtag){
            gtag('event', btn, {
              debug_mode:true,
              page_location:'https://dad.mohajiho.com/popup',
              script_name:'DAD PLU v5.0'
            });
          }
        }

        /* hide Copy-QR Copy on mobile */
        if(/Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile/i.test(navigator.userAgent)){
          const b=document.querySelector('.copy-img-btn'); if(b) b.style.display='none';
        }

        /* Support panel toggle */
        const supportBtn = document.getElementById('support-btn');
        supportBtn.onclick = () => {
          const existing = document.querySelector('.support-box');
          if (existing) { existing.remove(); showTooltip(supportBtn,'Closed'); return; }
          track('support_opened');
          window.scrollTo({ top: 0, behavior: 'smooth' });
          const box=document.createElement('div');
          box.className='support-box';
          box.innerHTML=
            '<p style="margin:0 0 20px 0;">I&nbsp;hope&nbsp;you&nbsp;enjoy&nbsp;using&nbsp;this&nbsp;script!</p>'+
            '<p style="margin:0 0 20px 0;">Questions&nbsp;or&nbsp;suggestions?&nbsp;Feel&nbsp;free&nbsp;to&nbsp;reach&nbsp;out:</p>'+
            '<p style="margin:0 0 20px 0;"><a href="mailto:mohajiho@gmail.com">mohajiho@gmail.com</a></p>'+
            '<p style="margin:0 0 20px 0;">I&nbsp;would&nbsp;be&nbsp;more&nbsp;than&nbsp;happy&nbsp;to&nbsp;connect&nbsp;on&nbsp;LinkedIn:</p>'+
            '<p style="margin:0 0 20px 0;"><a href="https://www.linkedin.com/in/mohajiho" target="_blank" rel="noopener noreferrer">Connect&nbsp;on&nbsp;LinkedIn</a></p>';
          document.getElementById('gm-asin-panel')
            .insertBefore(box,document.getElementById('gm-asin-panel').children[1]);
          showTooltip(supportBtn,'Opened');
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
              const txt=data.productTitle?data.productTitle+' – ASIN '+data.codes[0]:'ASIN '+data.codes[0];
              await navigator.clipboard.writeText(txt); track('copy_info');
            }else if(id==='copy-asin-btn'){
              await navigator.clipboard.writeText(data.codes[0]); track('copy_asin');
            }else{
              await navigator.clipboard.writeText(data.codes.join('\\n')); track('copy_all_asins');
            }
            showTooltip(btn,'Copied!');
          }catch(e){ alert('Clipboard error: '+e.message); }};
        });

        document.getElementById('close-btn-bottom').onclick=()=>window.close();

        /* ---------- Barcode / QR toggle ---------- */
        let barcodeMode = false;
        const barcodeBtn = document.getElementById('barcode-btn');
        barcodeBtn.onclick = () => {
          barcodeMode = !barcodeMode;
          data.codes.forEach(c => {
            const container = document.getElementById('qr-'+c);
            container.innerHTML = '';
            if (barcodeMode) {
              const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
              container.appendChild(svg);
              try {
                JsBarcode(svg, c, {format:'CODE128', displayValue:false, width: 3, height:qrSize});
              } catch(err){
                console.error('Barcode error: ', err);
              }
            } else {
              new QRCode(container, {text:c,width:qrSize,height:qrSize});
            }
          });
          showTooltip(barcodeBtn, barcodeMode ? 'Barcode' : 'QR Code');
          track('toggle_barcode');
        };

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
  GM_registerMenuCommand('Start Scan', scanPage);

  /* -------- floating scan button + hotkey -------- */
  if (!window.opener && !/about:blank/i.test(location.href)) {
function createFloatingButton() {
  if (document.getElementById('gm-asin-host')) return;
  const host = document.createElement('div');
  host.id = 'gm-asin-host';
  Object.assign(host.style, {
    all: 'initial',
    position: 'fixed',
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    zIndex: 2147483647
  });
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'closed' });

  const base64Icon = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAB2AAAAdgB+lymcgAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAqMSURBVHic3ZtpkFTVFcf/59z7upvpnoFBE8lizAKiEIOgwYqIMiYZg8FCTSAKlqkSDbGSoMFBwLVVNC4UKZWIUXGJFiimRDFBMAqWmLiCpSlAK2walUWE6czW3e/ee/Khp3teNzD2TL+xGP5f5vXUfef0+b1zt3NfEyrUhAkS6VNrRmYJY3wlxxmmQYbp675ClVGIG0ajUdTqs2zzFb1vNa8zCi9tvArrQSSV+q9U1N0bp01qq8uSutBqnOszaowCDBN8Bex7DRhF8Ln9c+76Q6NkkVX88NaZ9H6YQXVFXQYw++eZc33CVUbhBMO5QDuC7DIEGAVnFJ7OaprzyRX0dk8E2ZnKBnDL+MyQrMh8n1FnFQUCDgUCjIKzRPeJxtUfTac9PRl0UFxOo9vr05dSVtYqhzrtAGUF2gHaIvfXyXZt8Kgn+JXy6RRyekBVs048M98jj1WtzqpvapF6z1KDNvKsdmjRFtBW4OXtWLAS+TUs3vnKPBnd04Hn1WkGLJkgkV270w/6GpMNlz51OKPoaatkwQcSXf3kk2TLdVrfIPHmiD3HJ7rcKJxQkgkwTMbXmL7z93R35SF2rgMC+Eu9xNNt6aesQn0wtQ0DRmNFRtP0OUujGyv9AideY850TPN8RYNLIMBXuGXndLq6Uh+dab8AlgyVSLomvcywnGGL+3fKKr60YUV0cfEdQtN/4Z9kSc6yjOGGaYhRqDGMWqPQapi2GoXNvpKXsuStfO5u2hC8e2hSIhHnkkbRTJ/BQQiGccOOKyj5hQJ44sTWRy3jgnzg7RDe85nGTVsV2xxsmzwrc7ZRcqdR9I0uDIyv+xp/7Ptf9ddg1xl+nRlrFD/hM6pLMuHindNp4RcCYOnwlksd0T25wAsBrfU985OpL9XsLg5eqpRkPjWMKsNA12cHWme0vWTVHZF1eZsjrpUTfC0rfcZhAQhpSzhlewOtDRtA0Szwt+82HetZzFMuN8orB2iH92LpfYMHgFgbPG0Rzc0E+50dOq5t7rNng9cyQht+o67BzsjbXHcTrfWExnmFmQLQTmIseHTgXRLtUQBRp+5WDrFc8ALtKMWGx01au2/wADDrBUopR1dpC187NHlOFnsO57PBEO1FEvMXRYmc118LRiiL32knK7QTVwwByrNye12DuRdJYQBYl6TXPOMuCkyR8Jwcm85gVtgACl3g5aNbzjYsS237SG8Z8BVNOuftqsWdGQCAu8ZKdEACZmIZU+GUKemBGeKkYZpculjyFSavnqsX5dsOv97eb5guzs8OvkIzR2ng1stpZ/dDLlYhA5ST2arw5AHlsLKc4AFg2nOUKSd4AFi4MLbpsQciF2iLsZ7FnmDX8BwdFWwbz/CV2sqn+UzwLBIu6xq6FmLnyqXct5pOVRYj8/1eOXGeuOlhOirVYwu9FdrYkz2Lje1pvi2W5UeCbV65lfZqi2RwxegZmvLVpFSF9T0YANjQhblBLDdgsZNlP1pfveHzbq5Ujz0Ye78Gehg7NzTL6phl8+mT0ja6lR/SFjsDEGqrPJwb1neg9UMl4hqbdxhGbaH/K5wxalPi+bCcVKpRs+0fsoxZgQ3Usveu5fFh2Gb+tOlE5VDbMfJj58eb4i+GYTwssW8Wd8wIAs/h9DFJ0aHY1oLRqmPOhxL3j4kof2PzRWjN3Oi72sr2AITEXmBEGLZZCw1jyQ9+gLL0ShiGw5Z2WBMcDMnZYaHYZSeDFCg3HDpAID0++HVH2tAGaAEgAAggGhyKXSX0Nbj2TwzorN4ShuGwpZ1sQaFjCgAaEIpddlINJuQhZLk5FYbhsOUJGotHJukXhl2tHKKAIA+hbc+XMmEYDluclbT2gMDqvdsV7SK7StCicosfKAFqa/eGtsoKUzGheMmO0g/DrlZOmsDUL9cFBB74cAAHXTdQ1h3uFR66AKD97lC7KlaOtioHqPapUAsNDMNw2NIiA4P1BOVkn2Vzd8Qs+E9hDSCAEgplfg1b2uH4YBeIGAplumZy9GZwIaQdTg3DcJhKjhGtDZ0crCwRmVBOkVgT1rAABQiCH37W/7OaMIyHpdQRmdO1k+pCec3I9icXxEI5T+RINrGRBVvyENghxhl9dhjGwxI7Or+oxii0PDTbBBISWVwAIIA2fFlYDipVckLzAM/hvGCh1RN6PCz7DABi8DA7sXkABBmRiqZ+GpaTSiQZPUNZiQWqzZuP+LZeFZZ9BoAY+m4iR0vZSSELFGieQCJhOeqObqnPHKMdfhssuXtG7kwmyX3+3eWpUBTVYm4igQ1AOLol1nRjWI66quQY0R5hobaIBM4dPognoveH6acAgND/XQb+TJJbFrcPiDNaoqmxYTosV4dR5mbt3MnBgxbP4YXkw5QO00/RhkLQWOuI3nGEI4UAxwRHaBJxp8f9fm+F6bgzPXBqeqrPcu8+p9IK8Ilm3fhs9LawfBWdDBH67WWhSSwwgUyoJuIVrX1SJ4XltDM98oOWqWzdn0qP1PLXnsit152VmRmWv/1uKQWp3zjCfEdAIBNaLOii6mz1krCcB7V6jOhdLW1zLGFmyal02jCMUUj0RCYccE8tSM1xhKtLIMAS7jN97MzaxtrGSp3n9fdh6aN9sg9aplElp9K+I/5ZVkmjVVjeExA6LSoIUtc7QrIUgiPsFFAykUk8RKBuF1BWfqfpyxxTDYbkMsuIFJ56DkLasEy88LX4swBwz2lto3sCQqcvSRH63sBCl7AgXTQ7CI4gyIKmWNPWxqrUnM8STUPLdbgEol47qqnunwObF8YUbVPWzdAOkUJZvuNs0niOC1kWEZByoLDHhLLKSoK9xzvixx1hcEkm5LpF7ol9bEEvW8YGq2iLhU1ZVhmnXVwI/X3iQY7xPcMy2jLVtJ9AFU6ig6fSgUxodkxnZjTIkSy3TPHSFy4qzYSy62oCiTn8b4ZjmS1EfQ4AAbb92jEVri0XtylK9Q4IW42iVZYwpRSCZVD7a7cIvLOUMQrRSiGU9Z5gjhSlFfrepJ03kETmspOm4AaqqKgSqDHm/19Sc+hIdYttnqWpNfH44Pr18YuVyKySNgnlEM9Pi8oJtJUrlcWPtUVzpd2h25VVwa6Er6LnOEXnOeA0R4h3IRN2O8ZTWcKi4R8l1hCK1/bPD22eaYlu3SdbGPAVrvzlq1V3AOEMjKGUlgXitemm74ui4yxkkNFypIDiRknUEqWEaY8P7BKNfxuybw3a1W/z59k8AIS0Y6o//40+a/LtKoUQCoCe0vNDmq+wTHNLILQaReMmv95ndb7dgrrWUZboOV+hugiComtufCZ6c2c+DmoAQM9DOOgBAD0LoVcAAHoOQq8BAPQMhF4FAAgfQq8DAIQLoVcCAA64Tmh2TGeWs06wCpcln4nd1WsBABVDsJZ4ZK8GAFQIgWVxrwcAlA/h3rrMeJ/c04Gt9I6yd4MHs+rXJ27b3y6SnSxfPLKt8As0LxtZVVJorT0kMiCvA2WCUXJBWletYrRda5hmBIoqmw4pAEDnW+mSajN8onmHHACgbAi7s8oed0gCAIAXhrRO81nmWYbaB4LGbiMYf9GrVf86ZAEAwIvHtozIKplhiU4zCodZpg99xjImd8fENxM7AOD/JVLdJtpKr6gAAAAASUVORK5CYII=';

  shadow.innerHTML = `
    <style>
        /* bounce keyframes */
        @keyframes bounce {
        0%, 100%   { transform: scale(1); }
        50%        { transform: scale(1.2); }        }
      #gm-asin-btn {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 48px;
        height: 48px;
        padding: 0;
        border: none;
        border-radius: 50%;
        overflow: hidden;
        background: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: bounce 2s ease-in-out infinite;

      }
      #gm-asin-btn img {
        width: 80%;
        height: 80%;
        object-fit: contain;
        display: block;
      }
    </style>
    <button id="gm-asin-btn" title="Start Scan">
      <img src="data:image/png;base64,${base64Icon}" alt="Scan">
    </button>
  `;
  shadow.getElementById('gm-asin-btn').addEventListener('click', scanPage);
}

    if(document.readyState==='loading')window.addEventListener('DOMContentLoaded',createFloatingButton,{once:true});
    else createFloatingButton();
    new MutationObserver(createFloatingButton).observe(document.documentElement,{childList:true,subtree:true});
    const fire=()=>window.dispatchEvent(new Event('locationchange'));
    const _ps=history.pushState;history.pushState=function(){_ps.apply(this,arguments);fire();};
    const _rs=history.replaceState;history.replaceState=function(){_rs.apply(this,arguments);fire();};
    window.addEventListener('popstate',fire);
    function hotkeyMatches(e){
      return e.key.toLowerCase()===HOTKEY.key.toLowerCase()&&e.shiftKey===HOTKEY.shift&&e.ctrlKey===HOTKEY.ctrl&&e.altKey===HOTKEY.alt&&e.metaKey===HOTKEY.meta;
    }
    window.addEventListener('keydown',e=>{
      if(!hotkeyMatches(e))return;
      const tag=(e.target.tagName||'').toUpperCase();
      if(e.target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(tag))return;
      e.preventDefault();scanPage();
    });
  }
})();
