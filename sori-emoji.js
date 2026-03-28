/**
 * ============================================================
 *  SORI · 소리  —  sori-emoji.js  v1
 * ============================================================
 *
 *  PURPOSE
 *  ──────────────────────────────────────────────────────────
 *  Automatically resolves the emotion keyword written into
 *  #journal-card-emotion by sori-voice.js and injects a
 *  matching iOS emoji into the journal card layout.
 *
 *  HOW IT WORKS
 *  ──────────────────────────────────────────────────────────
 *  1. MutationObserver watches #journal-card-emotion for any
 *     text content change (sori-voice.js sets .textContent).
 *  2. The keyword is normalised (lowercase, trimmed, hyphens
 *     stripped) and looked up in EMOTION_EMOJI_MAP.
 *  3. A .journal-card__emoji <span> is created (or updated
 *     if it already exists) and inserted immediately BEFORE
 *     the #journal-card-emotion <h2>.
 *  4. The element fades in with a CSS animation defined in
 *     sori-journal-redesign.css (or the inline <style> patch).
 *
 *  LOADING ORDER
 *  ──────────────────────────────────────────────────────────
 *  Add this script to index.html AFTER sori-voice.js and
 *  BEFORE sori-flow.js:
 *
 *    <script src="sori-voice.js"></script>
 *    <script src="sori-emoji.js"></script>   ← add here
 *    <script src="sori-archive.js"></script>
 *    <script src="sori-flow.js"></script>
 *
 *  NO OTHER FILES NEED CHANGING — this module is self-contained.
 * ============================================================
 */

(function () {
  'use strict';

  console.log('[sori-emoji] ✅ sori-emoji.js v1 loaded');

  // ─────────────────────────────────────────────────────────────────────────
  //  EMOTION → EMOJI MAP
  //  ─────────────────────────────────────────────────────────────────────────
  //
  //  Keys are lowercase, hyphen-free, whitespace-trimmed versions of the
  //  emotion keyword that GPT-4o writes into #journal-card-emotion.
  //  Add or adjust entries to match your backend's vocabulary.
  //
  //  Emoji are selected for their iOS rendering:
  //    • Prefer nature/weather metaphors over face emoji — they read as
  //      empathetic and editorial rather than cartoon-like.
  //    • Face emoji are used only where no strong metaphor exists.
  //    • Each entry has a PRIMARY emoji and a FALLBACK in case the
  //      primary feels too intense for a given entry (see resolveEmoji).
  // ─────────────────────────────────────────────────────────────────────────

  var EMOTION_EMOJI_MAP = {

    // ── Core negative affect ──────────────────────────────
    'sadness':       { primary: '🌧',  fallback: '🫧'  },
    'sad':           { primary: '🌧',  fallback: '🫧'  },
    'grief':         { primary: '🕊',  fallback: '🌑'  },
    'sorrow':        { primary: '🕊',  fallback: '🌧'  },
    'melancholy':    { primary: '🌫',  fallback: '🍂'  },
    'despair':       { primary: '🌑',  fallback: '🌧'  },

    // ── Anxiety & fear ────────────────────────────────────
    'anxiety':       { primary: '🌀',  fallback: '🍃'  },
    'anxious':       { primary: '🌀',  fallback: '🍃'  },
    'fear':          { primary: '🌫',  fallback: '🌙'  },
    'scared':        { primary: '🌫',  fallback: '🌙'  },
    'worry':         { primary: '⛅',  fallback: '🌀'  },
    'worried':       { primary: '⛅',  fallback: '🌀'  },
    'dread':         { primary: '🌑',  fallback: '🌫'  },
    'panic':         { primary: '🌊',  fallback: '🌀'  },

    // ── Anger & frustration ───────────────────────────────
    'anger':         { primary: '🔥',  fallback: '🌋'  },
    'angry':         { primary: '🔥',  fallback: '🌋'  },
    'frustration':   { primary: '⛈',  fallback: '🔥'  },
    'frustrated':    { primary: '⛈',  fallback: '🔥'  },
    'irritated':     { primary: '⛈',  fallback: '🍂'  },
    'rage':          { primary: '🌋',  fallback: '🔥'  },
    'resentment':    { primary: '🌑',  fallback: '🔥'  },

    // ── Exhaustion & pressure ─────────────────────────────
    'exhaustion':    { primary: '🍂',  fallback: '🌾'  },
    'exhausted':     { primary: '🍂',  fallback: '🌾'  },
    'burnout':       { primary: '🍂',  fallback: '🌑'  },
    'burnedout':     { primary: '🍂',  fallback: '🌑'  },  // hyphen stripped
    'overwhelmed':   { primary: '🌊',  fallback: '🍂'  },
    'overwhelm':     { primary: '🌊',  fallback: '🍂'  },
    'pressure':      { primary: '🌊',  fallback: '⚖'   },
    'stress':        { primary: '⛈',  fallback: '🌀'  },
    'stressed':      { primary: '⛈',  fallback: '🌀'  },
    'tired':         { primary: '🌙',  fallback: '🍂'  },

    // ── Loneliness & disconnection ────────────────────────
    'loneliness':    { primary: '🌙',  fallback: '🫧'  },
    'lonely':        { primary: '🌙',  fallback: '🫧'  },
    'isolation':     { primary: '🌑',  fallback: '🌙'  },
    'isolated':      { primary: '🌑',  fallback: '🌙'  },
    'disconnected':  { primary: '🫧',  fallback: '🌙'  },
    'abandoned':     { primary: '🍂',  fallback: '🌧'  },

    // ── Shame & self-criticism ────────────────────────────
    'shame':         { primary: '🌑',  fallback: '🌫'  },
    'ashamed':       { primary: '🌑',  fallback: '🌫'  },
    'guilt':         { primary: '🌑',  fallback: '🫧'  },
    'guilty':        { primary: '🌑',  fallback: '🫧'  },
    'embarrassment': { primary: '🌫',  fallback: '🌑'  },
    'embarrassed':   { primary: '🌫',  fallback: '🌑'  },
    'insecurity':    { primary: '🫧',  fallback: '🌑'  },
    'insecure':      { primary: '🫧',  fallback: '🌑'  },

    // ── Numbness & emptiness ──────────────────────────────
    'numbness':      { primary: '❄',   fallback: '🌫'  },
    'numb':          { primary: '❄',   fallback: '🌫'  },
    'emptiness':     { primary: '🫧',  fallback: '❄'   },
    'empty':         { primary: '🫧',  fallback: '❄'   },
    'hollow':        { primary: '🫧',  fallback: '🌑'  },
    'detached':      { primary: '❄',   fallback: '🫧'  },
    'apathy':        { primary: '❄',   fallback: '🌫'  },

    // ── Confusion & disorientation ────────────────────────
    'confusion':     { primary: '🌀',  fallback: '🌫'  },
    'confused':      { primary: '🌀',  fallback: '🌫'  },
    'lost':          { primary: '🌫',  fallback: '🌀'  },
    'uncertain':     { primary: '🌫',  fallback: '⛅'  },
    'uncertainty':   { primary: '🌫',  fallback: '⛅'  },

    // ── Nostalgia & wistfulness ───────────────────────────
    'nostalgia':     { primary: '🌸',  fallback: '🍂'  },
    'nostalgic':     { primary: '🌸',  fallback: '🍂'  },
    'wistfulness':   { primary: '🌸',  fallback: '🌾'  },
    'wistful':       { primary: '🌸',  fallback: '🌾'  },
    'longing':       { primary: '🌙',  fallback: '🌸'  },
    'regret':        { primary: '🍂',  fallback: '🌧'  },

    // ── Positive & uplifting ──────────────────────────────
    'joy':           { primary: '🌸',  fallback: '✨'  },
    'happy':         { primary: '🌸',  fallback: '☀'   },
    'happiness':     { primary: '🌸',  fallback: '☀'   },
    'contentment':   { primary: '🍃',  fallback: '🌸'  },
    'content':       { primary: '🍃',  fallback: '🌸'  },
    'peace':         { primary: '🍃',  fallback: '🌿'  },
    'peaceful':      { primary: '🍃',  fallback: '🌿'  },
    'calm':          { primary: '🍃',  fallback: '🌾'  },
    'gratitude':     { primary: '🌻',  fallback: '🌸'  },
    'grateful':      { primary: '🌻',  fallback: '🌸'  },
    'hope':          { primary: '🌱',  fallback: '☀'   },
    'hopeful':       { primary: '🌱',  fallback: '🌸'  },
    'love':          { primary: '🌹',  fallback: '🌸'  },
    'warmth':        { primary: '🌻',  fallback: '🌸'  },
    'excitement':    { primary: '✨',  fallback: '🌸'  },
    'excited':       { primary: '✨',  fallback: '🌸'  },

    // ── Mixed / complex states ────────────────────────────
    'envy':          { primary: '🌿',  fallback: '🌧'  },
    'jealousy':      { primary: '🌿',  fallback: '🔥'  },
    'jealous':       { primary: '🌿',  fallback: '🔥'  },
    'bittersweet':   { primary: '🌸',  fallback: '🍂'  },
    'ambivalence':   { primary: '⛅',  fallback: '🌫'  },
    'ambivalent':    { primary: '⛅',  fallback: '🌫'  },

    // ── Default fallback ──────────────────────────────────
    '_default':      { primary: '🫧',  fallback: '🌿'  },
  };

  // ─────────────────────────────────────────────────────────────────────────
  //  HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * normalise(keyword)
   * Strips hyphens, extra whitespace, and lowercases a keyword so
   * "burned-out", "Burned Out", and "burnedout" all resolve the same way.
   */
  function normalise(keyword) {
    return (keyword || '')
      .toLowerCase()
      .replace(/-/g, '')      // burned-out → burnedout
      .replace(/\s+/g, '')    // burned out → burnedout
      .trim();
  }

  /**
   * resolveEmoji(keyword)
   * Returns the best emoji for a given emotion keyword.
   * Falls back to '_default' if no match is found.
   */
  function resolveEmoji(keyword) {
    var key = normalise(keyword);
    var entry = EMOTION_EMOJI_MAP[key] || EMOTION_EMOJI_MAP['_default'];
    return entry.primary;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  DOM INJECTION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * injectEmoji(emotionKeyword)
   * Creates (or updates) the .journal-card__emoji element and places
   * it directly before #journal-card-emotion inside .journal-card.
   */
  function injectEmoji(emotionKeyword) {
    var emotionEl = document.getElementById('journal-card-emotion');
    if (!emotionEl) {
      console.warn('[sori-emoji] ⚠️  #journal-card-emotion not found');
      return;
    }

    var emoji = resolveEmoji(emotionKeyword);
    console.log('[sori-emoji] 🌸 Resolved "' + emotionKeyword + '" → ' + emoji);

    // Re-use an existing element if we've already injected once this session
    var existing = document.querySelector('.journal-card__emoji');
    if (existing) {
      existing.textContent = emoji;
      // Re-trigger animation by toggling the class
      existing.classList.remove('journal-card__emoji--revealed');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          existing.classList.add('journal-card__emoji--revealed');
        });
      });
      return;
    }

    // Build the new element
    var emojiEl = document.createElement('span');
    emojiEl.className = 'journal-card__emoji';
    emojiEl.setAttribute('aria-hidden', 'true');   // decorative — screen readers skip
    emojiEl.setAttribute('role', 'presentation');
    emojiEl.textContent = emoji;

    // Insert immediately BEFORE the emotion <h2>
    emotionEl.parentNode.insertBefore(emojiEl, emotionEl);

    // Trigger the reveal animation on the next paint
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        emojiEl.classList.add('journal-card__emoji--revealed');
      });
    });

    console.log('[sori-emoji] ✅ Emoji injected before #journal-card-emotion');
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  MUTATION OBSERVER — watches #journal-card-emotion for text changes
  // ─────────────────────────────────────────────────────────────────────────
  //
  //  sori-voice.js writes to the element via:
  //    document.getElementById('journal-card-emotion').textContent = emotion;
  //  This triggers a childList mutation (text node replaced).
  // ─────────────────────────────────────────────────────────────────────────

  function _startObserver() {
    var target = document.getElementById('journal-card-emotion');
    if (!target) {
      // Step hasn't rendered yet — retry after a short delay
      setTimeout(_startObserver, 200);
      return;
    }

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var keyword = target.textContent.trim();
        if (keyword) {
          console.log('[sori-emoji] 👁  Mutation detected: "' + keyword + '"');
          injectEmoji(keyword);
          break;
        }
      }
    });

    observer.observe(target, {
      childList:    true,   // text node insertions / replacements
      subtree:      true,   // catch nested text nodes if any
      characterData: true,  // direct .data changes on existing text nodes
    });

    console.log('[sori-emoji] 👁  MutationObserver watching #journal-card-emotion');
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  SECONDARY SIGNAL — sori:emotion-selected event
  // ─────────────────────────────────────────────────────────────────────────
  //
  //  sori-flow.js dispatches this event when the user clicks an emotion card.
  //  It gives us an early preview emoji on the journal card header,
  //  which will be overridden by the more specific API result once it lands.
  // ─────────────────────────────────────────────────────────────────────────

  window.addEventListener('sori:emotion-selected', function (e) {
    var emotion = e && e.detail && e.detail.emotion;
    if (!emotion) return;
    console.log('[sori-emoji] 🃏 sori:emotion-selected → "' + emotion + '"');
    // Pre-warm: inject a best-guess emoji immediately when the card was chosen.
    // The MutationObserver will update it with the API's refined keyword.
    injectEmoji(emotion);
  });

  // ─────────────────────────────────────────────────────────────────────────
  //  INIT
  // ─────────────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _startObserver);
  } else {
    _startObserver();
  }

})();
