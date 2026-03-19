// elxea Variable Rebinder — Remap community file variables to elxea token collections
// Run: Plugins > Development > Import plugin from manifest…

(async () => {
  // ─── Phase 1: Catalog all variable collections ───
  const collections = figma.variables.getLocalVariableCollections();
  const allVars = figma.variables.getLocalVariables();

  // Separate source (mode, tw/*) and target (elxea) collections
  const sourceCollections = {}; // name → collection
  const targetCollections = {}; // name → collection
  const sourceVars = [];        // variables from mode/tw/*
  const targetVars = [];        // variables from elxea collections

  // elxea collection names (created by Tokens Studio export)
  const ELXEA_NAMES = new Set([
    'color', 'typography', 'spacing', 'shape', 'layout',
    'media', 'motion', 'elevation', 'component'
  ]);

  for (const col of collections) {
    const name = col.name.toLowerCase();
    if (ELXEA_NAMES.has(name)) {
      targetCollections[name] = col;
    } else {
      sourceCollections[name] = col;
    }
  }

  // Index target variables by normalized name for matching
  const targetByName = new Map(); // normalized name → variable
  const targetById = new Map();

  for (const v of allVars) {
    const col = collections.find(c => c.id === v.variableCollectionId);
    if (!col) continue;
    const colName = col.name.toLowerCase();

    if (ELXEA_NAMES.has(colName)) {
      targetById.set(v.id, v);
      // Store multiple lookup keys for fuzzy matching
      const fullName = colName + '/' + v.name;
      targetByName.set(fullName, v);
      targetByName.set(v.name, v);
      // Also store without collection prefix for cross-matching
      const parts = v.name.split('/');
      if (parts.length > 1) {
        targetByName.set(parts.slice(-1)[0], v); // leaf name
        targetByName.set(parts.slice(-2).join('/'), v); // last two segments
      }
    } else {
      sourceVars.push({ variable: v, collection: col });
    }
  }

  // ─── Phase 2: Build mapping table (source var ID → target var ID) ───
  const varMap = new Map(); // source variable ID → target variable ID

  // Explicit mapping rules: source pattern → target lookup path
  const EXPLICIT_MAP = {
    // mode collection → color/semantic/*
    'background': 'color/semantic/background',
    'foreground': 'color/semantic/foreground',
    'card': 'color/semantic/card',
    'card-foreground': 'color/semantic/card-foreground',
    'popover': 'color/semantic/popover',
    'popover-foreground': 'color/semantic/popover-foreground',
    'primary': 'color/semantic/primary',
    'primary-foreground': 'color/semantic/primary-foreground',
    'secondary': 'color/semantic/secondary',
    'secondary-foreground': 'color/semantic/secondary-foreground',
    'muted': 'color/semantic/muted',
    'muted-foreground': 'color/semantic/muted-foreground',
    'accent': 'color/semantic/accent',
    'accent-foreground': 'color/semantic/accent-foreground',
    'destructive': 'color/semantic/destructive',
    'destructive-foreground': 'color/semantic/destructive-foreground',
    'border': 'color/semantic/border',
    'input': 'color/semantic/input',
    'ring': 'color/semantic/ring',
    'chart-1': null, // no elxea equivalent
    'chart-2': null,
    'chart-3': null,
    'chart-4': null,
    'chart-5': null,
    'sidebar-background': null,
    'sidebar-foreground': null,
    'sidebar-primary': null,
    'sidebar-primary-foreground': null,
    'sidebar-accent': null,
    'sidebar-accent-foreground': null,
    'sidebar-border': null,
    'sidebar-ring': null,
  };

  // tw/* pattern matching
  const TW_PATTERNS = [
    // Border radius: tw/border-radius/* or tw/radius/* → shape/radius/*
    { match: /^(border-?radius|radius)[/-](.+)$/i, target: (m) => 'shape/radius/' + m[2] },
    // Spacing/padding/gap: tw/spacing/* or tw/padding/* → spacing/*
    { match: /^(spacing|padding|margin|gap)[/-](.+)$/i, target: (m) => 'spacing/' + m[2] },
    // Font size: tw/font-size/* or tw/text-* → typography/size/*
    { match: /^(font-?size|text)[/-](.+)$/i, target: (m) => 'typography/size/' + m[2] },
    // Font weight: tw/font-weight/* → typography/weight/*
    { match: /^font-?weight[/-](.+)$/i, target: (m) => 'typography/weight/' + m[1] },
    // Line height: tw/leading/* or tw/line-height/* → typography/lineHeight/*
    { match: /^(leading|line-?height)[/-](.+)$/i, target: (m) => 'typography/lineHeight/' + m[2] },
    // Letter spacing: tw/tracking/* → typography/letterSpacing/*
    { match: /^tracking[/-](.+)$/i, target: (m) => 'typography/letterSpacing/' + m[1] },
    // Border width: tw/border-width/* → shape/borderWidth/*
    { match: /^border-?width[/-](.+)$/i, target: (m) => 'shape/borderWidth/' + m[1] },
    // Shadow: tw/shadow/* → elevation/shadow/*
    { match: /^(shadow|box-shadow)[/-](.+)$/i, target: (m) => 'elevation/shadow/' + m[2] },
    // Opacity: tw/opacity/* → elevation/opacity/*
    { match: /^opacity[/-](.+)$/i, target: (m) => 'elevation/opacity/' + m[1] },
    // z-index: tw/z/* or tw/z-index/* → elevation/zIndex/*
    { match: /^z(-?index)?[/-](.+)$/i, target: (m) => 'elevation/zIndex/' + m[2] },
  ];

  let mapped = 0, unmapped = 0, skipped = 0;
  const unmappedList = [];

  for (const { variable: sv, collection: col } of sourceVars) {
    const colName = col.name.toLowerCase();
    const varName = sv.name;
    // Normalize: remove collection prefix if variable name includes it
    const leafName = varName.split('/').pop();

    let targetPath = null;

    // 1. Try explicit map (for mode collection)
    if (colName === 'mode') {
      if (leafName in EXPLICIT_MAP) {
        targetPath = EXPLICIT_MAP[leafName];
      } else {
        // Try full var name
        const fullLeaf = varName.replace(/\//g, '-');
        if (fullLeaf in EXPLICIT_MAP) {
          targetPath = EXPLICIT_MAP[fullLeaf];
        }
      }
    }

    // 2. Try tw/* pattern matching
    if (!targetPath && colName.startsWith('tw')) {
      // Extract the meaningful part after tw/ prefix
      let meaningful = varName;
      // Some tw collections might have sub-paths
      for (const pat of TW_PATTERNS) {
        const m = meaningful.match(pat.match);
        if (m) {
          targetPath = pat.target(m);
          break;
        }
      }
      // If no pattern matched, try direct name lookup
      if (!targetPath) {
        // Try: spacing/varName, shape/varName, typography/varName
        for (const prefix of ['spacing', 'shape/radius', 'typography/size', 'elevation/shadow']) {
          const candidate = prefix + '/' + leafName;
          if (targetByName.has(candidate)) {
            targetPath = candidate;
            break;
          }
        }
      }
    }

    // 3. Try generic name matching as last resort
    if (!targetPath) {
      // Direct leaf name match
      if (targetByName.has(varName)) {
        const tv = targetByName.get(varName);
        if (tv.resolvedType === sv.resolvedType) {
          varMap.set(sv.id, tv.id);
          mapped++;
          continue;
        }
      }
    }

    // Apply target path
    if (targetPath) {
      const tv = targetByName.get(targetPath);
      if (tv) {
        varMap.set(sv.id, tv.id);
        mapped++;
      } else {
        unmapped++;
        unmappedList.push(`${colName}/${varName} → ${targetPath} (NOT FOUND in elxea)`);
      }
    } else if (targetPath === null && colName === 'mode') {
      skipped++; // Explicitly skipped (no equivalent)
    } else {
      unmapped++;
      if (unmappedList.length < 30) {
        unmappedList.push(`${colName}/${varName} (no mapping rule)`);
      }
    }
  }

  figma.notify(`📊 Mapping: ${mapped} mapped, ${skipped} skipped, ${unmapped} unmapped`);

  // ─── Phase 3: Walk all nodes and rebind variables ───

  // Target components we care about (shadcn/ui)
  const TARGET_COMPONENTS = new Set([
    'button', 'input', 'card', 'badge', 'avatar', 'dialog', 'alert',
    'accordion', 'breadcrumb', 'checkbox', 'dropdown', 'label',
    'navigation', 'nav', 'pagination', 'popover', 'progress',
    'radio', 'select', 'separator', 'sheet', 'skeleton', 'slider',
    'switch', 'table', 'tabs', 'textarea', 'toast', 'toggle', 'tooltip',
    'calendar', 'command', 'form', 'hover-card', 'menubar', 'scroll-area',
    'sidebar', 'sonner', 'carousel', 'collapsible', 'context-menu',
    'drawer', 'resizable', 'aspect-ratio'
  ]);

  function isTargetComponent(node) {
    // Check if node or any parent is a component we care about
    const name = (node.name || '').toLowerCase();
    for (const comp of TARGET_COMPONENTS) {
      if (name.includes(comp)) return true;
    }
    return false;
  }

  let rebound = 0;
  let nodesProcessed = 0;
  let reboundDetails = {};

  function rebindNode(node) {
    nodesProcessed++;

    // Check for bound variables on common properties
    const bindableProps = [
      'fills', 'strokes', 'effects',
      'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
      'itemSpacing', 'counterAxisSpacing',
      'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
      'cornerRadius',
      'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
      'opacity',
      'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight',
      'strokeWeight',
    ];

    if (node.boundVariables) {
      for (const prop in node.boundVariables) {
        const binding = node.boundVariables[prop];

        if (Array.isArray(binding)) {
          // Array bindings (fills, strokes, effects)
          for (let i = 0; i < binding.length; i++) {
            const b = binding[i];
            if (b && b.id && varMap.has(b.id)) {
              const newVarId = varMap.get(b.id);
              const newVar = figma.variables.getVariableById(newVarId);
              if (newVar) {
                try {
                  node.setBoundVariable(prop, i, newVar);
                  rebound++;
                  const key = prop + ' → ' + newVar.name;
                  reboundDetails[key] = (reboundDetails[key] || 0) + 1;
                } catch (e) {
                  // Some properties may not support binding
                }
              }
            }
          }
        } else if (binding && binding.id && varMap.has(binding.id)) {
          // Single binding
          const newVarId = varMap.get(binding.id);
          const newVar = figma.variables.getVariableById(newVarId);
          if (newVar) {
            try {
              node.setBoundVariable(prop, newVar);
              rebound++;
              const key = prop + ' → ' + newVar.name;
              reboundDetails[key] = (reboundDetails[key] || 0) + 1;
            } catch (e) {
              // Some properties may not support binding
            }
          }
        }
      }
    }

    // Recurse into children
    if ('children' in node) {
      for (const child of node.children) {
        rebindNode(child);
      }
    }
  }

  // Process all pages
  for (const page of figma.root.children) {
    for (const node of page.children) {
      rebindNode(node);
    }
  }

  // ─── Phase 4: Report ───
  const topRebinds = Object.entries(reboundDetails)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => `  ${k}: ${v}x`)
    .join('\n');

  const report = [
    `✅ elxea Variable Rebinder — Complete`,
    ``,
    `📊 Variable Mapping:`,
    `  ${mapped} variables mapped to elxea tokens`,
    `  ${skipped} variables skipped (no elxea equivalent)`,
    `  ${unmapped} variables unmapped`,
    ``,
    `🔗 Rebinding Results:`,
    `  ${nodesProcessed} nodes scanned`,
    `  ${rebound} variable bindings updated`,
    ``,
    `Top rebinds:`,
    topRebinds,
  ].join('\n');

  if (unmappedList.length > 0) {
    console.log('Unmapped variables:', unmappedList.join('\n'));
  }

  console.log(report);
  figma.notify(`✅ Done! ${rebound} bindings rebound across ${nodesProcessed} nodes`);
  figma.closePlugin(report);
})();
