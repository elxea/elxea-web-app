// elxea Variable Exporter — Export Figma variables to W3C DTCG JSON (clipboard)
// Run: Plugins > Development > Import plugin from manifest...

(async () => {
  // ─── Config ───
  const ELXEA_NAMES = new Set([
    'color', 'typography', 'spacing', 'shape', 'layout',
    'media', 'motion', 'elevation', 'component'
  ]);

  // ─── Phase 1: Collect variables from elxea collections ───
  const collections = figma.variables.getLocalVariableCollections();
  const allVars = figma.variables.getLocalVariables();

  // Filter to elxea collections only
  const elxeaCollections = collections.filter(
    c => ELXEA_NAMES.has(c.name.toLowerCase())
  );

  if (elxeaCollections.length === 0) {
    figma.notify('No elxea collections found (expected: ' + [...ELXEA_NAMES].join(', ') + ')');
    figma.closePlugin();
    return;
  }

  // Build set of elxea collection IDs for fast lookup
  const elxeaCollectionIds = new Set(elxeaCollections.map(c => c.id));

  // Map collection ID -> collection for mode lookup
  const collectionById = new Map(collections.map(c => [c.id, c]));

  // ─── Phase 2: Build DTCG JSON ───
  const output = {};
  let varCount = 0;

  for (const variable of allVars) {
    if (!elxeaCollectionIds.has(variable.variableCollectionId)) continue;

    const collection = collectionById.get(variable.variableCollectionId);
    if (!collection) continue;

    // Use default mode (first mode)
    const defaultModeId = collection.modes[0].modeId;
    const rawValue = variable.valuesByMode[defaultModeId];

    // Skip if no value for default mode
    if (rawValue === undefined || rawValue === null) continue;

    // Build path: collectionName / variable.name (already slash-separated)
    const collectionName = collection.name.toLowerCase();
    const fullPath = collectionName + '/' + variable.name;
    const segments = fullPath.split('/');

    // Determine $type and $value
    const resolved = resolveValue(variable, rawValue);
    if (!resolved) continue;

    // Insert into nested structure
    setNestedValue(output, segments, resolved);
    varCount++;
  }

  // ─── Phase 3: Copy to clipboard via UI ───
  const jsonStr = JSON.stringify(output, null, 2);

  // Figma plugin sandbox cannot access navigator.clipboard directly.
  // Use figma.showUI with a hidden iframe to copy to clipboard.
  const html = `
    <textarea id="t" style="position:absolute;left:-9999px">${escapeHtml(jsonStr)}</textarea>
    <script>
      const ta = document.getElementById('t');
      ta.select();
      document.execCommand('copy');
      parent.postMessage({ pluginMessage: 'copied' }, '*');
    </script>
  `;
  figma.showUI(html, { visible: false, width: 0, height: 0 });

  figma.ui.onmessage = (msg) => {
    if (msg === 'copied') {
      figma.notify(
        'Exported ' + varCount + ' variables from ' + elxeaCollections.length +
        ' collections to clipboard (W3C DTCG JSON)'
      );
      figma.closePlugin();
    }
  };

  // Fallback: close after 3 seconds even if message not received
  setTimeout(() => {
    figma.notify(
      'Exported ' + varCount + ' variables from ' + elxeaCollections.length +
      ' collections (clipboard copy may have failed — check console for JSON)'
    );
    console.log(jsonStr);
    figma.closePlugin();
  }, 3000);

  // ─── Helpers ───

  function resolveValue(variable, rawValue) {
    const type = variable.resolvedType;

    if (type === 'COLOR') {
      // rawValue is { r, g, b, a } in 0-1 range — convert to OKLCH
      const oklch = srgbToOklch(rawValue.r, rawValue.g, rawValue.b);
      const alpha = rawValue.a !== undefined ? rawValue.a : 1;
      let str;
      if (alpha < 1) {
        str = 'oklch(' + round(oklch.L, 3) + ' ' + round(oklch.C, 3) + ' ' + round(oklch.H, 3) + ' / ' + round(alpha, 2) + ')';
      } else {
        str = 'oklch(' + round(oklch.L, 3) + ' ' + round(oklch.C, 3) + ' ' + round(oklch.H, 3) + ')';
      }
      return { $type: 'color', $value: str };
    }

    if (type === 'FLOAT') {
      return { $type: 'number', $value: rawValue };
    }

    if (type === 'STRING') {
      return { $type: 'string', $value: rawValue };
    }

    if (type === 'BOOLEAN') {
      return { $type: 'boolean', $value: rawValue };
    }

    // Unknown type — skip
    return null;
  }

  function setNestedValue(obj, segments, leaf) {
    let current = obj;
    for (let i = 0; i < segments.length - 1; i++) {
      const key = segments[i];
      if (!(key in current) || typeof current[key] !== 'object' || current[key].$value !== undefined) {
        current[key] = {};
      }
      current = current[key];
    }
    const leafKey = segments[segments.length - 1];
    current[leafKey] = leaf;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function round(n, digits) {
    const f = Math.pow(10, digits);
    return Math.round(n * f) / f;
  }

  // ─── sRGB to OKLCH conversion ───
  // Based on Bjorn Ottosson's OKLab: https://bottosson.github.io/posts/oklab/

  function srgbToOklch(r, g, b) {
    // sRGB to linear
    const lr = srgbToLinear(r);
    const lg = srgbToLinear(g);
    const lb = srgbToLinear(b);

    // Linear sRGB to OKLab
    const l_ = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    const m_ = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    const s_ = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

    const l_cbrt = Math.cbrt(l_);
    const m_cbrt = Math.cbrt(m_);
    const s_cbrt = Math.cbrt(s_);

    const L = 0.2104542553 * l_cbrt + 0.7936177850 * m_cbrt - 0.0040720468 * s_cbrt;
    const a = 1.9779984951 * l_cbrt - 2.4285922050 * m_cbrt + 0.4505937099 * s_cbrt;
    const bOklab = 0.0259040371 * l_cbrt + 0.7827717662 * m_cbrt - 0.8086757660 * s_cbrt;

    // OKLab to OKLCH
    const C = Math.sqrt(a * a + bOklab * bOklab);
    let H = Math.atan2(bOklab, a) * (180 / Math.PI);
    if (H < 0) H += 360;

    // If chroma is near zero, hue is meaningless
    if (C < 0.001) H = 0;

    return { L, C, H };
  }

  function srgbToLinear(c) {
    if (c <= 0.04045) return c / 12.92;
    return Math.pow((c + 0.055) / 1.055, 2.4);
  }
})();
