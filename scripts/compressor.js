// ── EXTERNAL LIBRARIES ──
// We dynamically load well-tested libraries to handle Brotli and Base64URL operations safely.
let brotliInstance = null;
let base64Module = null;

async function getBrotli() {
  if (!brotliInstance) {
    try {
      const module = await import("https://unpkg.com/brotli-wasm@3.0.1/index.web.js?module");
      brotliInstance = await module.default;
    } catch (error) {
      console.error("Failed to load Brotli WASM module:", error);
      throw new Error("Brotli is not available in this environment.");
    }
  }
  return brotliInstance;
}

async function getBase64() {
  if (!base64Module) {
    try {
      // js-base64 is a robust, production-grade library for Base64 and Base64URL conversions.
      base64Module = await import("https://cdn.jsdelivr.net/npm/js-base64@3.7.5/base64.mjs");
    } catch (error) {
      console.error("Failed to load Base64 library:", error);
      throw new Error("Base64 library is not available in this environment.");
    }
  }
  return base64Module;
}

// ── ROBUST NATIVE HTML, CSS & JS MINIFICATION ──
/**
 * Uses DOMParser to clean node trees, minifies internal CSS/JS blocks, 
 * and strips redundant quotes, tags, and formatting elements.
 * @param {string} html - Raw HTML input.
 * @returns {string} Fully minified, ultra-compact HTML.
 */
function minifyHTML(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Traverses and cleans DOM elements recursively
  const cleanNode = (node) => {
    const childNodes = Array.from(node.childNodes);
    for (const child of childNodes) {
      if (child.nodeType === Node.COMMENT_NODE) {
        // 1. Remove comments safely
        child.remove();
      } else if (child.nodeType === Node.TEXT_NODE) {
        const parentName = child.parentNode ? child.parentNode.nodeName.toUpperCase() : '';
        
        if (parentName === 'STYLE') {
          // 2. High-efficiency CSS Minification
          let css = child.textContent;
          css = css.replace(/\/\*[\s\S]*?\*\//g, ''); // Strip CSS comments
          css = css.replace(/\s+/g, ' ');            // Collapse whitespace
          css = css.replace(/\s*([\{\}:;,])\s*/g, '$1'); // Strip layout syntax spacing
          css = css.replace(/;}/g, '}');             // Strip trailing semicolons
          child.textContent = css.trim();
        } else if (parentName === 'SCRIPT') {
          // 3. High-efficiency JS Minification
          let js = child.textContent;
          js = js.replace(/\/\*[\s\S]*?\*\//g, '');   // Strip block comments
          // Safe line comment stripper
          js = js.split('\n').map(line => line.replace(/^(.*?)\/\/.*/, '$1')).join('\n');
          js = js.replace(/\s+/g, ' ');              // Collapse whitespace
          js = js.replace(/\s*([=\+\-\*\/\{\}\(\);,:<>\?])\s*/g, '$1'); // Space around operators
          child.textContent = js.trim();
        } else {
          // 4. Collapse general HTML layout text spaces
          child.textContent = child.textContent.replace(/\s+/g, ' ');
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        cleanNode(child);
      }
    }
  };

  cleanNode(doc);

  const isFullDoc = html.toLowerCase().includes('<html') || html.toLowerCase().includes('<!doctype');
  let serialized = isFullDoc 
    ? '<!DOCTYPE html>' + doc.documentElement.outerHTML 
    : doc.body.innerHTML;

  // ── AGGRESSIVE POST-SERIALIZATION STRING-LEVEL MINIFICATION ──
  serialized = serialized
    // Remove structural spaces between tags where safe (e.g. </div>  <div> -> </div><div>)
    .replace(/>\s+</g, '><')
    // Remove trailing self-closing slash (e.g. <img src="x" /> -> <img src="x">)
    .replace(/\s*\/>/g, '>')
    // Remove legacy type="text/javascript" attributes
    .replace(/type=["']text\/javascript["']/gi, '')
    // Remove legacy type="text/css" attributes
    .replace(/type=["']text\/css["']/gi, '')
    // Strip optional HTML5 closing tags to save bytes (Modern browsers parse these perfectly)
    .replace(/<\/(p|li|tr|td|th|tbody|thead|tfoot)>/gi, '')
    // Strip quotes from safe attributes (containing only letters, numbers, hyphens, and underscores)
    // Converts id="main-container" -> id=main-container and class="btn" -> class=btn
    .replace(/(\s[a-zA-Z0-9\-_]+)=["']([a-zA-Z0-9\-_]+)["']/g, '$1=$2')
    .trim();

  return serialized;
}

// ── SEMANTIC MULTI-BYTE TOKENIZATION ──
// We utilize single-byte control escape tags (\x01) followed by an identifier character.
// This supports a massive, highly optimized dictionary mapping for both quoted and unquoted syntax.
const ESCAPE_CHAR = '\x01';
const DICTIONARY = [
  ['<!DOCTYPE html>', 'a'],
  ['<meta charset="utf-8">', 'b'],
  ['<meta name="viewport" content="width=device-width,initial-scale=1">', 'c'],
  ['<div class="', 'd'],
  ['<div class=', 'e'],
  ['<div style="', 'f'],
  ['<div style=', 'g'],
  ['<div', 'h'],
  ['</div>', 'i'],
  ['<span class="', 'j'],
  ['<span class=', 'k'],
  ['<span', 'l'],
  ['</span>', 'm'],
  ['<a class="', 'n'],
  ['<a class=', 'o'],
  ['<a href="', 'p'],
  ['<a href=', 'q'],
  ['<a', 'r'],
  ['</a>', 's'],
  ['<p class="', 't'],
  ['<p class=', 'u'],
  ['<p>', 'v'],
  ['</p>', 'w'],
  ['class="', 'x'],
  ['class=', 'y'],
  ['style="', 'z'],
  ['style=', 'A'],
  ['href="', 'B'],
  ['href=', 'C'],
  ['src="', 'D'],
  ['src=', 'E'],
  ['xmlns="http://www.w3.org/2000/svg"', 'F'],
  ['viewBox="0 0 ', 'G'],
  ['fill="none"', 'H'],
  ['stroke="currentColor"', 'I'],
  ['stroke-width="', 'J'],
  ['stroke-width=', 'K'],
  ['fill-rule="evenodd"', 'L'],
  ['clip-rule="evenodd"', 'M'],
  ['display:flex', 'N'],
  ['justify-content:', 'O'],
  ['align-items:', 'P'],
  ['position:absolute', 'Q'],
  ['position:relative', 'R'],
  ['width:100%', 'S'],
  ['height:100%', 'T']
];

// Sort dictionary by length descending to avoid greedy partial matching bugs during tokenize
const SORTED_DICTIONARY = [...DICTIONARY].sort((a, b) => b[0].length - a[0].length);

function tokenize(text) {
  // 1. Double escape any literal occurrence of our control code to avoid parser collisions
  let tokenized = text.replaceAll(ESCAPE_CHAR, ESCAPE_CHAR + ESCAPE_CHAR);
  
  // 2. Map phrases to escapes
  for (const [rawPattern, tokenCode] of SORTED_DICTIONARY) {
    tokenized = tokenized.replaceAll(rawPattern, ESCAPE_CHAR + tokenCode);
  }
  return tokenized;
}

function detokenize(text) {
  let detokenized = text;
  
  // 1. Revert mapped escapes
  for (const [rawPattern, tokenCode] of SORTED_DICTIONARY) {
    detokenized = detokenized.replaceAll(ESCAPE_CHAR + tokenCode, rawPattern);
  }
  
  // 2. Restore literal escapes back to standard layout
  return detokenized.replaceAll(ESCAPE_CHAR + ESCAPE_CHAR, ESCAPE_CHAR);
}

// ── MAIN PIPELINE FUNCTIONS ──

/**
 * Super-compresses an HTML string using Minification, Dynamic Tokenization, Brotli (WASM), and js-base64.
 * @param {string} html - Raw HTML input.
 * @param {number} [quality=11] - Brotli compression quality (1-11).
 * @returns {Promise<string>} Ultra-compressed URL-safe Base64URL string.
 */
async function compressHTML(html, quality = 11) {
  const [brotli, base64] = await Promise.all([getBrotli(), getBase64()]);
  
  // 1. Deep Minify (DOM tree + script/style nodes + attribute/tag post-processing)
  const minified = minifyHTML(html);
  
  // 2. Tokenize using sorted multi-byte structures
  const tokenized = tokenize(minified);
  
  // 3. Compress with Brotli forced into Text/UTF-8 mode (mode: 1)
  const bytes = new TextEncoder().encode(tokenized);
  const compressedBytes = brotli.compress(bytes, { quality, mode: 1 });
  
  // 4. Encode to URL-safe Base64 without padding characters
  return base64.fromUint8Array(compressedBytes, true);
}

/**
 * Reverses the compression pipeline to restore the original minified HTML string.
 * @param {string} b64url - Compressed URL-safe Base64URL string.
 * @returns {Promise<string>} Original minified HTML string.
 */
async function decompressHTML(b64url) {
  const [brotli, base64] = await Promise.all([getBrotli(), getBase64()]);
  
  // 1. Decode URL-safe Base64 back to binary using js-base64 library
  const compressedBytes = base64.toUint8Array(b64url);
  
  // 2. Brotli decompress
  const decompressedBytes = brotli.decompress(compressedBytes);
  const tokenized = new TextDecoder().decode(decompressedBytes);
  
  // 3. Revert tokens back to HTML
  return detokenize(tokenized);
}