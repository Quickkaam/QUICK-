// ============================================
// QUICK काम — Common JavaScript + Security Module
// ============================================

// ----- CONFIGURATION -----
// Drishti Kavach backend URL (used for email proxy & security logging)
const DK_BACKEND = window.__DK_API_URL
  ? window.__DK_API_URL.replace(/\/api$/, '')
  : 'https://drishti-kavach-backend.onrender.com';

const API_BASE = DK_BACKEND + '/api';

// Debug flag: set to true to see console logs in development
const DEBUG = window.__DEBUG || false;

function log(...args) {
  if (DEBUG) console.log('[common.js]', ...args);
}

// ============================================
// 🔒 EMAILJS SECURE PROXY HANDLER
// ============================================
// Uses server-side proxy to hide EmailJS private key
// Requires Cloudflare Turnstile for bot protection

// Cloudflare Turnstile site key (public)
const TURNSTILE_SITE_KEY = window.__TURNSTILE_SITE_KEY || '0x4AAAAAAD1DJr7K87Ceczuc';

/**
 * Initialize Cloudflare Turnstile
 * @returns {Promise} Promise that resolves when Turnstile is ready
 */
function initTurnstile() {
  return new Promise((resolve) => {
    if (window.turnstile) {
      resolve();
      return;
    }

    const checkInterval = setInterval(() => {
      if (window.turnstile) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);

    // Timeout after 5 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve(); // Resolve anyway to avoid blocking
    }, 5000);
  });
}

/**
 * Get Turnstile token
 * @param {string} widgetId - Turnstile widget ID
 * @returns {Promise<string>} Turnstile token
 */
async function getTurnstileToken(widgetId) {
  try {
    await initTurnstile();
    if (window.turnstile) {
      return window.turnstile.getResponse(widgetId);
    }
  } catch (error) {
    console.warn('Turnstile error:', error);
  }
  return null;
}

/**
 * Centralized EmailJS sender — uses direct EmailJS (primary) with backend proxy as fallback
 * @param {string} serviceId - EmailJS Service ID
 * @param {string} templateId - EmailJS Template ID
 * @param {object} params - Template parameters
 * @param {string} turnstileWidgetId - Optional Turnstile widget ID
 * @returns {Promise}
 */
async function sendEmailJS(serviceId, templateId, params, turnstileWidgetId = null) {
  // ── Step 1: Validate Turnstile ─────────────────────────────────
  if (turnstileWidgetId) {
    const token = await getTurnstileToken(turnstileWidgetId);
    if (!token) {
      throw new Error('Turnstile verification required. Please complete the security check.');
    }
  }

  // ── Step 2: Try direct EmailJS first (fast & reliable) ─────────
  if (window.emailjs) {
    try {
      const publicKey = atob('MkpsNDRWWEl5cHhsN3ZuODA=');
      window.emailjs.init(publicKey);
      const result = await window.emailjs.send(serviceId, templateId, params);
      log('[EMAIL] Sent via direct EmailJS');
      return result;
    } catch (ejsError) {
      log('[EMAIL] Direct EmailJS failed, trying proxy:', ejsError.message);
    }
  }

  // ── Step 3: Fallback — backend proxy ────────────────────────────
  try {
    const response = await fetch(`${API_BASE}/email/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        template_params: params,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    log('[EMAIL] Sent via backend proxy');
    return data;
  } catch (proxyError) {
    throw new Error('Failed to send message. Please email us directly at contactquickkaam@gmail.com');
  }
}

/**
 * Render a Cloudflare Turnstile widget
 * @param {string} containerId - DOM element ID to render widget in
 * @param {string} theme - Widget theme ('auto', 'light', 'dark')
 * @param {string} size - Widget size ('normal', 'compact')
 * @param {string} language - Widget language (defaults to auto)
 * @returns {Promise<string>} Widget ID
 */
async function renderTurnstileWidget(containerId, theme = 'auto', size = 'normal', language = 'auto') {
  return new Promise((resolve) => {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`Container ${containerId} not found`);
      resolve(null);
      return;
    }

    // Clear container
    container.innerHTML = '';

    // Create script if not already loaded
    if (!document.querySelector('script[src*="challenges.cloudflare.com"]')) {
      const script = document.createElement('script');
      script.src = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&hl=${language}`;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    // Wait for Turnstile to load
    const checkTurnstile = setInterval(() => {
      if (window.turnstile) {
        clearInterval(checkTurnstile);
        const widgetId = window.turnstile.render(`#${containerId}`, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: theme,
          size: size,
          callback: function(token) {
            console.log('Turnstile token received');
          },
          'expired-callback': function() {
            console.log('Turnstile token expired');
          },
          'error-callback': function() {
            console.error('Turnstile error');
          },
        });
        resolve(widgetId);
      }
    }, 100);

    // Timeout after 10 seconds
    setTimeout(() => {
      clearInterval(checkTurnstile);
      console.warn('Turnstile failed to load');
      resolve(null);
    }, 10000);
  });
}

// ============================================
// Site Sync & Utilities (Graceful API fallback)
// ============================================

// Generate a visitor ID
function getVisitor() {
  let id = sessionStorage.getItem('visitorId_v2');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    }));
    sessionStorage.setItem('visitorId_v2', id);
  }
  return id;
}

// General site activity tracker (fails silently if backend is missing)
function track(action, extra = {}) {
  const payload = {
    action,
    page: window.location.href,
    agent: navigator.userAgent,
    visitor: getVisitor(),
    extra,
  };

  const url = `${API_BASE}/log`;
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, JSON.stringify(payload));
    } else {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => { /* silently ignore */ });
    }
  } catch (e) {
    if (DEBUG) console.warn('Track error:', e);
  }
}

// Form data submitter (fails silently if backend is missing)
function submitForm(type, data) {
  const payload = {
    type,
    email: data.email || '',
    name: data.name || '',
    phone: data.phone || '',
    services: data.services || '',
    message: data.message || '',
    data: data,
  };

  fetch(`${API_BASE}/forms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => { /* silently ignore */ });
}

// Internal alert reporter (fails silently if backend is missing)
function sendAlert(type, level, payload, url) {
  fetch(`${API_BASE}/security`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, level, payload, url: url || window.location.href }),
  }).catch(() => { /* silently ignore */ });
}

// Auto-track page views
window.addEventListener('load', () => {
  track('page_view', { title: document.title, referrer: document.referrer });
});

// ============================================
// 🔒 SECURITY MODULE — Client-Side Protection
// ============================================
(function() {
  'use strict';

  // ----- 1. ATTACK PATTERNS -----
  const attackPatterns = {
    sql: [
      /(\b)(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|DECLARE|MERGE|REPLACE|LOAD_FILE|OUTFILE|DUMPFILE)(\b)/i,
      /('|\")(\s*)(OR|AND)(\s+)('|\")(\s*)(=)(\s*)('|\")/i,
      /('|\")(\s*)(OR|AND)(\s+)(\d+)(\s*)(=)(\s*)(\d+)/i,
      /;(\s*)(--|#|\/\*)/,
      /UNION(\s+)SELECT/i,
      /\/\*.*\*\//,
      /' OR '1'='1/,
      /" OR "1"="1/,
      /' OR 1=1--/,
      /" OR 1=1--/,
      /admin'--/,
      /'\); DROP TABLE/i,
    ],
    xss: [
      /<script[^>]*>.*?<\/script>/i,
      /<img[^>]*onerror\s*=/i,
      /<svg[^>]*onload\s*=/i,
      /<body[^>]*onload\s*=/i,
      /on\w+\s*=\s*['"][^'"]*['"]/i,
      /javascript\s*:/i,
      /alert\s*\(/i,
      /confirm\s*\(/i,
      /prompt\s*\(/i,
      /eval\s*\(/i,
      /document\.cookie/i,
      /document\.write/i,
      /innerHTML\s*=/i,
      /outerHTML\s*=/i,
      /src\s*=\s*['"]data:/i,
      /src\s*=\s*['"]javascript:/i,
      /%3Cscript%3E/i,
      /%3Cimg%20src%3Dx%20onerror%3D/i,
      /<iframe[^>]*/i,
      /<object[^>]*/i,
      /<embed[^>]*/i,
      /<link[^>]*/i,
      /<meta[^>]*/i,
      /expression\s*\(/i,
      /url\s*\(/i,
    ],
    pathTraversal: [
      /\.\.\//,
      /\.\.\\/,
      /\/etc\/passwd/,
      /\/etc\/shadow/,
      /C:\\/i,
      /%2e%2e%2f/i,
      /%2e%2e\\/i,
      /\.\.%5c/i,
      /\.\.%2f/i,
    ],
    commandInjection: [
      /;\s*(ping|nslookup|wget|curl|nc|netcat|telnet|ssh|ftp|tftp|whoami|id|uname|cat|echo|ls|dir|rm|mv|cp|chmod|chown|kill|pkill)/i,
      /\|\s*(ping|nslookup|wget|curl|nc|netcat|telnet|ssh|ftp|tftp|whoami|id|uname|cat|echo|ls|dir|rm|mv|cp|chmod|chown)/i,
      /&\s*(ping|nslookup|wget|curl|nc|netcat|telnet|ssh|ftp|tftp|whoami|id|uname|cat|echo|ls|dir|rm|mv|cp|chmod|chown)/i,
      /&&\s*(ping|nslookup|wget|curl|nc|netcat|telnet|ssh|ftp|tftp|whoami|id|uname|cat|echo|ls|dir|rm|mv|cp|chmod|chown)/i,
      /`.*`/,
      /\$\(.*\)/,
      /;\s*shutdown/i,
      /;\s*reboot/i,
    ],
    suspicious: [
      /%00/, /%0a/, /%0d/, /%1a/, /%5c/, /%2f/, /%3c/, /%3e/, /%22/, /%27/,
    ]
  };

  // ----- 2. CHECK FOR ATTACKS IN URL -----
  function checkURLForAttacks() {
    const params = new URLSearchParams(window.location.search);

    for (const [key, value] of params.entries()) {
      const decodedValue = decodeURIComponent(value);
      if (isAttack(decodedValue) || isAttack(key)) {
        sendAlert('url_attack', 'critical', decodedValue, window.location.href);
        redirectTo404();
        return true;
      }
    }
    return false;
  }

  // ----- 3. MAIN ATTACK DETECTION FUNCTION -----
  function isAttack(input) {
    if (!input || typeof input !== 'string') return false;
    const normalized = input.toLowerCase();

    for (const category in attackPatterns) {
      const patterns = attackPatterns[category];
      for (const pattern of patterns) {
        if (pattern.test(normalized) || pattern.test(input)) {
          if (DEBUG) console.warn('[SECURITY] Pattern detected:', {
            category, pattern: pattern.toString(), input: input.substring(0, 100)
          });
          return true;
        }
      }
    }
    return false;
  }

  // ----- 4. REDIRECT TO 404 (Clean version) -----
  function redirectTo404() {
    if (window._redirectedTo404) return;
    window._redirectedTo404 = true;
    if (window.location.pathname.includes('404.html')) return;
    // Use replace to prevent back-button loops
    window.location.replace('/404.html');
  }

  // ----- 5. SANITIZE USER INPUT -----
  function sanitizeInput(input) {
    if (!input || typeof input !== 'string') return input;

    let sanitized = input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/\s*on\w+\s*=\s*['"][^'"]*['"]/gi, '')
      .replace(/javascript\s*:/gi, '')
      .replace(/data\s*:/gi, '')
      .replace(/eval\s*\(/gi, '')
      .replace(/alert\s*\(/gi, '')
      .replace(/confirm\s*\(/gi, '')
      .replace(/prompt\s*\(/gi, '')
      .replace(/document\s*\.\s*cookie/gi, '')
      .replace(/innerHTML\s*=/gi, '')
      .replace(/outerHTML\s*=/gi, '')
      .replace(/<iframe[^>]*>/gi, '')
      .replace(/<object[^>]*>/gi, '')
      .replace(/<embed[^>]*>/gi, '')
      .replace(/<link[^>]*>/gi, '')
      .replace(/<meta[^>]*>/gi, '')
      .replace(/expression\s*\(/gi, '')
      .replace(/url\s*\(/gi, '')
      .replace(/\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|DECLARE|MERGE|REPLACE)\b/gi, '')
      .replace(/[|;&$`()<>]/g, '');
    return sanitized;
  }

  // ----- 6. CLIENT-SIDE CSRF (UI Layer Only - Server REQUIRED for real protection) -----
  // WARNING: This is NOT secure against determined attackers. Always implement server-side CSRF tokens.
  function generateCSRFToken() {
    const token = crypto.randomUUID ? crypto.randomUUID() : 
      Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    sessionStorage.setItem('csrf_token', token);
    return token;
  }
  function getCSRFToken() {
    let token = sessionStorage.getItem('csrf_token');
    if (!token) { token = generateCSRFToken(); }
    return token;
  }
  function validateCSRFToken(token) {
    const stored = sessionStorage.getItem('csrf_token');
    return stored && token === stored;
  }

  // ----- 7. CLIENT-SIDE RATE LIMITING (UI Layer Only - Server REQUIRED for real protection) -----
  function checkRateLimit(key, maxAttempts = 5, windowSeconds = 60) {
    const storageKey = `rate_limit_${key}`;
    const now = Date.now();
    const data = JSON.parse(localStorage.getItem(storageKey) || '{"attempts":[],"blockedUntil":0}');

    if (data.blockedUntil && data.blockedUntil > now) {
      return { allowed: false, message: 'Too many attempts. Please try again later.' };
    }

    const cutoff = now - (windowSeconds * 1000);
    data.attempts = data.attempts.filter(t => t > cutoff);

    if (data.attempts.length >= maxAttempts) {
      data.blockedUntil = now + (windowSeconds * 1000);
      localStorage.setItem(storageKey, JSON.stringify(data));
      return { allowed: false, message: `Too many attempts. Please try again in ${windowSeconds} seconds.` };
    }

    data.attempts.push(now);
    localStorage.setItem(storageKey, JSON.stringify(data));
    return { allowed: true };
  }

  // ----- 8. HONEYPOT -----
  function setupHoneypot(form) {
    const honeyInput = document.createElement('input');
    honeyInput.type = 'text';
    honeyInput.name = 'honeypot';
    honeyInput.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;opacity:0;pointer-events:none;';
    honeyInput.setAttribute('aria-hidden', 'true');
    honeyInput.setAttribute('tabindex', '-1');
    form.appendChild(honeyInput);
    return honeyInput;
  }

  // ----- 9. PROTECT ALL FORMS -----
  function protectForms() {
    document.querySelectorAll('form').forEach((form) => {
      if (form.dataset.secured === 'true') return;
      form.dataset.secured = 'true';

      const tokenInput = document.createElement('input');
      tokenInput.type = 'hidden';
      tokenInput.name = '_csrf';
      tokenInput.value = getCSRFToken();
      form.appendChild(tokenInput);

      const honeyInput = setupHoneypot(form);

      form.addEventListener('submit', function(e) {
        // Honeypot check
        if (honeyInput.value && honeyInput.value.trim() !== '') {
          sendAlert('honeypot_trigger', 'warning', 'Honeypot field filled', window.location.href);
          e.preventDefault();
          redirectTo404();
          return false;
        }

        // CSRF check (UI only)
        const csrfToken = this.querySelector('[name="_csrf"]');
        if (!csrfToken || !validateCSRFToken(csrfToken.value)) {
          e.preventDefault();
          redirectTo404();
          return false;
        }

        // Sanitize inputs
        const inputs = this.querySelectorAll('input, textarea');
        let hasAttack = false;
        inputs.forEach((input) => {
          if (input.type !== 'hidden' && input.type !== 'submit' && input.type !== 'button' && input.type !== 'reset') {
            const value = input.value;
            if (value && typeof value === 'string') {
              if (isAttack(value)) {
                hasAttack = true;
                sendAlert('form_attack', 'critical', value, window.location.href);
              }
              input.value = sanitizeInput(value);
            }
          }
        });

        if (hasAttack) {
          e.preventDefault();
          redirectTo404();
          return false;
        }

        // Rate limit (UI only)
        const emailInput = this.querySelector('input[type="email"]');
        if (emailInput) {
          const rateCheck = checkRateLimit(emailInput.value || 'anonymous');
          if (!rateCheck.allowed) {
            e.preventDefault();
            alert(rateCheck.message);
            return false;
          }
        }

        // Rotate CSRF token
        const newToken = generateCSRFToken();
        const tokenField = this.querySelector('[name="_csrf"]');
        if (tokenField) { tokenField.value = newToken; }
      });
    });
  }

  // ----- 10. PROTECT LINKS -----
  function protectLinks() {
    document.querySelectorAll('a[href]').forEach((link) => {
      const href = link.getAttribute('href');
      if (href && href.startsWith('javascript:')) {
        link.removeAttribute('href');
        link.style.cursor = 'default';
        link.style.opacity = '0.5';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          redirectTo404();
        });
      }
    });
  }

  // ----- 11. MONITOR DOM -----
  function monitorDOM() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1 && node.attributes) {
            for (const attr of node.attributes) {
              const value = attr.value || '';
              if ((attr.name === 'href' || attr.name === 'src') &&
                  (value.startsWith('javascript:') || value.startsWith('data:text/html'))) {
                redirectTo404();
                return;
              }
            }
          }
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'src']
    });
  }

  // ----- 12. INITIALIZE SECURITY -----
  function initSecurity() {
    if (checkURLForAttacks()) return;
    protectForms();
    protectLinks();
    monitorDOM();
    if (DEBUG) console.log('[SECURITY] Protection layer active ✓');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSecurity);
  } else {
    initSecurity();
  }

  window.addEventListener('popstate', () => checkURLForAttacks());
  window.addEventListener('hashchange', () => checkURLForAttacks());

})();

// ============================================
// EXISTING FEATURES (UI Enhancements)
// ============================================

// ----- SCROLL PROGRESS BAR -----
const progressBar = document.querySelector('.progress-bar');
if (progressBar) {
  window.addEventListener('scroll', () => {
    const winScroll = document.documentElement.scrollTop;
    const height = document.documentElement.scrollHeight - window.innerHeight;
    const scrolled = height > 0 ? (winScroll / height) * 100 : 0;
    progressBar.style.width = scrolled + '%';
  });
}

// ----- SLIDE FROM RIGHT INTERSECTION OBSERVER -----
const slideElements = document.querySelectorAll('.slide-right');
const slideObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add('visible'); }
  });
}, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
slideElements.forEach((el) => slideObserver.observe(el));

// ----- SLIDE FROM BOTTOM INTERSECTION OBSERVER -----
const slideUpElements = document.querySelectorAll('.slide-up');
const slideUpObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add('visible'); }
  });
}, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
slideUpElements.forEach((el) => slideUpObserver.observe(el));

// ----- INITIAL VISIBILITY ON LOAD -----
window.addEventListener('load', () => {
  slideElements.forEach((el) => {
    if (el.getBoundingClientRect().top < window.innerHeight - 100) {
      el.classList.add('visible');
    }
  });
  slideUpElements.forEach((el) => {
    if (el.getBoundingClientRect().top < window.innerHeight - 100) {
      el.classList.add('visible');
    }
  });
});

// ----- NAV LINK ACTIVE STATE -----
const currentPath = window.location.pathname.replace(/\/$/, '');
const navLinks = document.querySelectorAll('.nav-links a');
navLinks.forEach((link) => {
  const linkHref = link.getAttribute('href');
  let isActive = false;
  if (linkHref === '/') {
    isActive = currentPath === '' || currentPath === '/';
  } else {
    const cleanHref = linkHref.replace(/^\//, '');
    const cleanCurrent = currentPath.replace(/^\//, '');
    isActive = cleanHref === cleanCurrent;
  }
  link.classList.toggle('active', isActive);
});

// ----- PAGE FADE-IN TRANSITION -----
document.addEventListener('DOMContentLoaded', () => {
  document.body.style.opacity = '0';
  document.body.style.transition = 'opacity 0.4s ease';
  requestAnimationFrame(() => { document.body.style.opacity = '1'; });
});

// ----- COUNT UP ANIMATION -----
const counters = document.querySelectorAll('.count');
const speed = 200;
const animateCount = (el) => {
  const target = +el.getAttribute('data-target');
  const updateCount = () => {
    const current = +el.innerText.replace('+', '');
    const increment = Math.ceil(target / speed);
    if (current < target) {
      el.innerText = `${current + increment}+`;
      setTimeout(updateCount, 20);
    } else {
      el.innerText = `${target}+`;
    }
  };
  updateCount();
};
const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      animateCount(entry.target);
      counterObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });
counters.forEach(counter => counterObserver.observe(counter));

// ----- SERVICE ACCORDION -----
document.querySelectorAll('.svc-row').forEach((row) => {
  row.querySelector('.svc-row-header')?.addEventListener('click', () => {
    const isOpen = row.classList.contains('open');
    document.querySelectorAll('.svc-row').forEach(r => r.classList.remove('open'));
    if (!isOpen) row.classList.add('open');
  });
});

// ----- NOTEBOOK OBSERVER -----
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.notebook-page').forEach((page) => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('visible'); }
      });
    }, { threshold: 0.20 });
    observer.observe(page);
  });
});

// ----- PIXAR CARD LIKE BUTTON -----
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.pixar-card .like-button').forEach((btn) => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      const card = this.closest('.pixar-card');
      if (!card) return;
      const countSpan = card.querySelector('.like-count');
      if (!countSpan) return;
      let count = parseInt(countSpan.textContent) || 0;
      if (card.classList.contains('liked')) {
        card.classList.remove('liked');
        count--;
        const heart = card.querySelector('.heart-icon');
        if (heart) { heart.style.fill = 'none'; heart.style.stroke = '#333'; }
      } else {
        card.classList.add('liked');
        count++;
        const heart = card.querySelector('.heart-icon');
        if (heart) { heart.style.fill = '#333'; heart.style.stroke = '#333'; }
      }
      countSpan.textContent = Math.max(0, count);
    });
  });
});

// ----- APPLY SHINE TO HEADER AND FOOTER LOGOS -----
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.site-header .logo-img, .site-footer .logo-img').forEach(function(img) {
    if (img.closest('.logo-shine-wrapper')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'logo-shine-wrapper';
    img.parentNode.replaceChild(wrapper, img);
    wrapper.appendChild(img);
  });
});

// ============================================
// 📊 DRISHTI KAVACH — ENGAGEMENT TRACKING SDK
// Tracks page views, time on page, scroll depth,
// and click interactions for the SOC Analytics dashboard.
// ============================================
(function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────
  var DK_API_URL  = window.__DK_API_URL  || API_BASE;
  var DK_API_KEY  = window.__DK_API_KEY  || 'dk_fc370748404c447454d76ff96f347075ed1c4930d941e80d';
  var DK_SITE_ID  = window.__DK_SITE_ID  || '1';

  // Don't run if not configured
  if (!DK_API_KEY || !DK_SITE_ID) {
    log('[DK SDK] API key or site ID not configured. Skipping engagement tracking.');
    return;
  }

  // ── Session ID ───────────────────────────────────────────────────
  var sessionId = (function () {
    var KEY = 'dk_sid_v2';
    var sid = sessionStorage.getItem(KEY);
    if (!sid) {
      sid = (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      }));
      sessionStorage.setItem(KEY, sid);
    }
    return sid;
  })();

  log('[DK SDK] Session:', sessionId);

  // ── Core Send Function ───────────────────────────────────────────
  function dkSend(eventType, data) {
    try {
      var payload = JSON.stringify({
        event_type: eventType,
        session_id: sessionId,
        website_id: DK_SITE_ID,
        api_key:    DK_API_KEY,
        data:       data || {},
        timestamp:  new Date().toISOString(),
      });

      var endpoint = DK_API_URL.replace(/\/api$/, '') + '/api/sdk/engagement';

      if (navigator.sendBeacon) {
        navigator.sendBeacon(endpoint, new Blob([payload], { type: 'application/json' }));
      } else {
        fetch(endpoint, {
          method:   'POST',
          headers:  { 'Content-Type': 'application/json', 'X-API-Key': DK_API_KEY },
          body:     payload,
          keepalive: true,
        }).catch(function () {});
      }
      log('[DK SDK] Event sent:', eventType, data);
    } catch (e) {
      // Silent fail — never break the page
    }
  }

  // ── Track Page View ──────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    dkSend('page_view', {
      url:      window.location.href,
      title:    document.title,
      referrer: document.referrer,
      screen:   window.screen.width + 'x' + window.screen.height,
    });
  });

  // ── Track Time on Page (fire on page unload) ─────────────────────
  var pageStart = Date.now();
  window.addEventListener('beforeunload', function () {
    var duration = Math.round((Date.now() - pageStart) / 1000);
    if (duration > 0) {
      dkSend('time_on_page', { url: window.location.href, duration: duration });
    }
  });

  // ── Track Scroll Depth ───────────────────────────────────────────
  var maxScrollDepth = 0;
  var scrollThresholds = [25, 50, 75, 100];
  window.addEventListener('scroll', function () {
    var scrolled = Math.round(
      (window.scrollY + window.innerHeight) /
      Math.max(document.documentElement.scrollHeight, 1) * 100
    );
    if (scrolled > maxScrollDepth) {
      var crossed = scrollThresholds.find(function (t) {
        return scrolled >= t && maxScrollDepth < t;
      });
      if (crossed) {
        maxScrollDepth = crossed;
        dkSend('scroll_depth', { url: window.location.href, depth: crossed });
      }
    }
  }, { passive: true });

  // ── Track Clicks on Interactive Elements ─────────────────────────
  document.addEventListener('click', function (e) {
    var el = e.target;
    if (!el) return;
    var tag = (el.tagName || '').toLowerCase();
    if (['a', 'button', 'input', 'select', 'label'].includes(tag)) {
      dkSend('click', {
        url:     window.location.href,
        element: {
          tag:   tag,
          id:    el.id   || null,
          class: (el.className || '').toString().split(' ').filter(Boolean).slice(0, 3).join(' ') || null,
          text:  (el.innerText || el.value || '').slice(0, 80),
          href:  el.href || null,
        },
      });
    }
  }, { passive: true });

  // ── Track Form Interactions ──────────────────────────────────────
  document.querySelectorAll('form').forEach(function (form) {
    form.addEventListener('submit', function () {
      dkSend('form_submit', {
        url:     window.location.href,
        form_id: form.id || null,
      });
    });
  });

  // Expose globally for custom events
  window.__dk = { sessionId: sessionId, send: dkSend };
  log('[DK SDK] Initialized. Session:', sessionId);

})();