/**
 * ============================================================
 *  SORI · 소리 — Motion & Scroll Reveal Module
 *  sori-motion.js
 *
 *  Responsibilities:
 *    1. IntersectionObserver for scroll-triggered elements.
 *    2. Applies .is-visible to elements bearing .fade-in-up.
 *    
 *  Brand constraints:
 *    • Ensures animations only fire once (unobserve on intersect)
 *    • Uses a 10% threshold to ensure elements are comfortably
 *      in view before animating, allowing the user to "breathe".
 * ============================================================
 */

(function() {
  'use strict';

  // Wait for the DOM to be fully loaded
  document.addEventListener('DOMContentLoaded', () => {
    
    // Select all elements designated for scroll reveal
    const revealElements = document.querySelectorAll('.fade-in-up');

    // Configure the observer
    const observerOptions = {
      root: null, // viewport
      rootMargin: '0px',
      threshold: 0.10 // Trigger when 10% of the element is visible
    };

    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Element has entered the viewport
          entry.target.classList.add('is-visible');
          
          // Stop observing once revealed to prevent re-triggering (non-performative)
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    // Attach observer to each element
    revealElements.forEach(el => revealObserver.observe(el));

  });
})();
