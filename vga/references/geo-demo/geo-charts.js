// Traverses and repairs common Vega-Lite JSON schema hallucinations generated
// by the LLM
function repair_spec(spec) {
  if (!spec || typeof spec !== 'object') return spec;

  // Repair date/year outlier values (e.g. typos like 1918 instead of 2018)
  repair_year_outliers(spec);

  function repair_year_outliers(s) {
    if (!s || !s.data || !Array.isArray(s.data.values) ||
        s.data.values.length < 3) {
      return;
    }

    let timeField = null;
    if (s.encoding) {
      for (const channel in s.encoding) {
        const enc = s.encoding[channel];
        if (enc && enc.field &&
            (enc.type === 'quantitative' || enc.type === 'temporal')) {
          const fieldName = enc.field.toLowerCase();
          if (fieldName.includes('year') || fieldName.includes('date') ||
              fieldName.includes('time')) {
            timeField = enc.field;
            break;
          }
        }
      }
    }

    if (!timeField) return;

    const values = s.data.values;

    function parseVal(v) {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const parsed = Number(v);
        if (!isNaN(parsed)) return parsed;
        const parsedDate = Date.parse(v);
        if (!isNaN(parsedDate)) return parsedDate;
      }
      return null;
    }

    function formatVal(originalVal, numericVal) {
      if (typeof originalVal === 'number') {
        return Math.round(numericVal);
      }
      if (typeof originalVal === 'string') {
        const parsed = Number(originalVal);
        if (!isNaN(parsed)) {
          return String(Math.round(numericVal));
        }
        const date = new Date(numericVal);
        if (!isNaN(date.getTime())) {
          if (originalVal.length === 10) {
            return date.toISOString().split('T')[0];
          }
          return date.toISOString();
        }
      }
      return originalVal;
    }

    const numericList = [];
    for (let i = 0; i < values.length; i++) {
      const num = parseVal(values[i][timeField]);
      if (num !== null) numericList.push(num);
    }

    if (numericList.length < 3) return;

    const uniqueVals = Array.from(new Set(numericList)).sort((a, b) => a - b);
    if (uniqueVals.length < 3) return;

    const diffs = [];
    for (let i = 0; i < uniqueVals.length - 1; i++) {
      diffs.push(uniqueVals[i + 1] - uniqueVals[i]);
    }

    function getMedian(arr) {
      if (arr.length === 0) return 0;
      const sorted = arr.slice().sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 ? sorted[mid] :
                                       (sorted[mid - 1] + sorted[mid]) / 2;
    }

    const medianDiff = getMedian(diffs);
    if (medianDiff === 0) return;

    const threshold = 5;
    const outliers = new Set();
    const maxOutlierRatio = 0.15;
    const maxOutliers =
        Math.max(1, Math.floor(uniqueVals.length * maxOutlierRatio));

    let idx = 0;
    while (idx < uniqueVals.length - 1) {
      if (uniqueVals[idx + 1] - uniqueVals[idx] > threshold * medianDiff) {
        const count = idx + 1;
        if (count <= maxOutliers) {
          for (let j = 0; j <= idx; j++) {
            outliers.add(uniqueVals[j]);
          }
        }
        break;
      }
      idx++;
    }

    idx = uniqueVals.length - 1;
    while (idx > 0) {
      if (uniqueVals[idx] - uniqueVals[idx - 1] > threshold * medianDiff) {
        const count = uniqueVals.length - idx;
        if (count <= maxOutliers) {
          for (let j = idx; j < uniqueVals.length; j++) {
            outliers.add(uniqueVals[j]);
          }
        }
        break;
      }
      idx--;
    }

    if (outliers.size === 0) return;

    let categoryField = null;
    if (s.encoding && s.encoding.color && s.encoding.color.field) {
      categoryField = s.encoding.color.field;
    }

    for (let i = 0; i < values.length; i++) {
      const rawVal = values[i][timeField];
      const num = parseVal(rawVal);
      if (num !== null && outliers.has(num)) {
        const categoryVal = categoryField ? values[i][categoryField] : null;

        let prevVal = null;
        for (let j = i - 1; j >= 0; j--) {
          const pNum = parseVal(values[j][timeField]);
          if (pNum !== null && !outliers.has(pNum)) {
            if (!categoryField || values[j][categoryField] === categoryVal) {
              prevVal = pNum;
              break;
            }
          }
        }

        let nextVal = null;
        for (let j = i + 1; j < values.length; j++) {
          const nNum = parseVal(values[j][timeField]);
          if (nNum !== null && !outliers.has(nNum)) {
            if (!categoryField || values[j][categoryField] === categoryVal) {
              nextVal = nNum;
              break;
            }
          }
        }

        let replacementNum = null;
        if (prevVal !== null && nextVal !== null) {
          replacementNum = (prevVal + nextVal) / 2;
        } else if (prevVal !== null) {
          replacementNum = prevVal + medianDiff;
        } else if (nextVal !== null) {
          replacementNum = nextVal - medianDiff;
        }

        if (replacementNum !== null) {
          values[i][timeField] = formatVal(rawVal, replacementNum);
        }
      }
    }
  }

  // Define the recursive repair function
  function repair_node(node, parentNode = null) {
    if (!node || typeof node !== 'object') return;

    // 1. Recursively process child/sub-specs first
    if (node.layer && Array.isArray(node.layer)) {
      // Filter out any null/undefined/empty layers
      node.layer = node.layer.filter(
          l => l && typeof l === 'object' && Object.keys(l).length > 0);
      node.layer.forEach(l => repair_node(l, node));
    }
    if (node.concat && Array.isArray(node.concat)) {
      node.concat = node.concat.filter(c => c && typeof c === 'object');
      node.concat.forEach(c => repair_node(c, node));
    }
    if (node.hconcat && Array.isArray(node.hconcat)) {
      node.hconcat = node.hconcat.filter(c => c && typeof c === 'object');
      node.hconcat.forEach(c => repair_node(c, node));
    }
    if (node.vconcat && Array.isArray(node.vconcat)) {
      node.vconcat = node.vconcat.filter(c => c && typeof c === 'object');
      node.vconcat.forEach(c => repair_node(c, node));
    }
    if (node.spec && typeof node.spec === 'object') {
      repair_node(node.spec, node);
    }

    // 2. Repair: Remove top-level mark if layer is present to avoid signal
    // scope conflicts
    if (node.mark && node.layer && node.layer.length > 0) {
      delete node.mark;
    }

    // 3. Repair: Ensure unit spec (spec without layers/concats) has a mark if
    // it has encoding
    const isUnitSpec = !node.layer && !node.concat && !node.hconcat &&
        !node.vconcat && !node.spec;
    if (isUnitSpec && node.encoding && !node.mark) {
      node.mark = 'point';  // default mark to avoid marktype of undefined error
    }

    // 4. Repair: Convert deprecated selection to params for Vega-Lite v5
    if (node.selection && !node.params) {
      node.params = [];
      for (const name in node.selection) {
        node.params.push({name: name, select: node.selection[name]});
      }
      delete node.selection;
    }

    // 5. Repair: dx and dy as top-level encoding channels are invalid. Move
    // them to mark.
    if (node.encoding) {
      if (node.encoding.dx !== undefined) {
        let val = node.encoding.dx;
        if (val && typeof val === 'object' && val.value !== undefined)
          val = val.value;
        if (node.mark) {
          if (typeof node.mark === 'string') node.mark = {type: node.mark};
          if (typeof node.mark === 'object') node.mark.dx = val;
        }
        delete node.encoding.dx;
      }
      if (node.encoding.dy !== undefined) {
        let val = node.encoding.dy;
        if (val && typeof val === 'object' && val.value !== undefined)
          val = val.value;
        if (node.mark) {
          if (typeof node.mark === 'string') node.mark = {type: node.mark};
          if (typeof node.mark === 'object') node.mark.dy = val;
        }
        delete node.encoding.dy;
      }
    }

    // 6. Repair: If legend has invalid 'disable' property, clean it up
    if (node.encoding) {
      for (const channel in node.encoding) {
        const enc = node.encoding[channel];
        if (enc && enc.legend && typeof enc.legend === 'object') {
          if (enc.legend.disable !== undefined) {
            if (enc.legend.disable === true) {
              enc.legend = null;
            } else {
              delete enc.legend.disable;
            }
          }
        }
      }
    }

    // 7. Repair: Fix invalid formatting strings (e.g. $0.2fM -> $0.2f with
    // labelExpr datum.label + 'M')
    if (node.encoding) {
      for (const channel in node.encoding) {
        const enc = node.encoding[channel];
        if (!enc) continue;

        // Axis format
        if (enc.axis && enc.axis.format) {
          if (enc.type !== 'temporal' && !enc.axis.format.startsWith('%')) {
            const rep = repair_format_string(enc.axis.format);
            if (rep.valid) {
              enc.axis.format = rep.d3Part;
              if (!enc.axis.labelExpr) {
                enc.axis.labelExpr =
                    `datum.label + ${JSON.stringify(rep.suffix)}`;
              }
            }
          }
        }

        // Encoding-level format (e.g. for text or tooltips)
        if (enc.format) {
          if (enc.type !== 'temporal' && !enc.format.startsWith('%')) {
            const rep = repair_format_string(enc.format);
            if (rep.valid) {
              enc.format = rep.d3Part;
            }
          }
        }
      }

      // Tooltip array formats
      if (node.encoding.tooltip && Array.isArray(node.encoding.tooltip)) {
        node.encoding.tooltip.forEach(tt => {
          if (tt && tt.format) {
            if (tt.type !== 'temporal' && !tt.format.startsWith('%')) {
              const rep = repair_format_string(tt.format);
              if (rep.valid) {
                tt.format = rep.d3Part;
              }
            }
          }
        });
      }
    }

    // 8. Repair: Convert temporal years represented as integers to quantitative
    const dataValues = node.data?.values || spec.data?.values;
    if (node.encoding && dataValues && Array.isArray(dataValues) &&
        dataValues.length > 0) {
      for (const channel in node.encoding) {
        const enc = node.encoding[channel];
        if (enc && enc.type === 'temporal' && enc.timeUnit === 'year') {
          const field = enc.field;
          const first_val = dataValues[0]?.[field];
          if (typeof first_val === 'number') {
            enc.type = 'quantitative';
            delete enc.timeUnit;
            if (!enc.axis) enc.axis = {};
            enc.axis.format = 'd';

            // Fix tooltips if present
            if (node.encoding.tooltip && Array.isArray(node.encoding.tooltip)) {
              const tt =
                  node.encoding.tooltip.find(t => t && t.field === field);
              if (tt) {
                tt.type = 'quantitative';
                delete tt.timeUnit;
                tt.format = 'd';
              }
            }
          }
        }
      }
    }

    // 9. Repair: If a quantitative scale is used for a field named "Year"
    // (case-insensitive), ensure it has scale: {zero: false} to prevent
    // starting at year 0
    if (node.encoding) {
      for (const channel in node.encoding) {
        const enc = node.encoding[channel];
        if (enc && enc.field && enc.field.toLowerCase().includes('year') &&
            enc.type === 'quantitative') {
          if (!enc.scale) enc.scale = {};
          if (enc.scale.zero === undefined) {
            enc.scale.zero = false;
          }
        }
      }
    }
  }

  // Helper to parse and split invalid formatting strings
  function repair_format_string(formatStr) {
    if (typeof formatStr !== 'string') return {valid: false};

    // Regex matching d3 format specifier and capturing the invalid trailing
    // text
    const d3Regex =
        /^([^\s{}<>=^]?[<>=^])?([+\- ]?)([$#]?)(0?)(\d*)(,?)(\.\d+)?(~?)([a-zA-Z%])(.*)$/;
    const match = formatStr.match(d3Regex);

    if (match) {
      const suffix = match[10];
      if (suffix) {
        const d3Part = formatStr.slice(0, formatStr.length - suffix.length);
        return {valid: true, d3Part: d3Part, suffix: suffix};
      }
    }
    return {valid: false};
  }

  // Start recursive traversal from root
  repair_node(spec);

  // Top-level specific repairs that involve layers coordinating

  // 10. Repair: Remove unnecessary layer wrapper if only one layer is present
  if (spec.layer && spec.layer.length === 1 && !spec.mark) {
    spec.mark = spec.layer[0].mark;
    if (spec.layer[0].encoding) {
      spec.encoding = {...spec.encoding, ...spec.layer[0].encoding};
    }
    delete spec.layer;
  }

  // 11. Repair: Fix invalid domain/domainRaw referencing a param (common LLM
  // error for zoom)
  if (spec.encoding) {
    for (const channel in spec.encoding) {
      const scale = spec.encoding[channel].scale;
      if (scale) {
        let paramName = null;
        if (scale.domainRaw && scale.domainRaw.param) {
          paramName = scale.domainRaw.param;
          delete scale.domainRaw;
        } else if (scale.domain && scale.domain.param) {
          paramName = scale.domain.param;
          delete scale.domain;
        }

        if (paramName && spec.params) {
          const param = spec.params.find(p => p.name === paramName);
          if (param && param.select) {
            const type = spec.encoding[channel].type;
            if (spec.encoding[channel].timeUnit) {
              console.warn(
                  'Skipping scale binding because timeUnit is present on ' +
                  channel);
            } else if (type !== 'quantitative' && type !== 'temporal') {
              console.warn(
                  'Skipping scale binding because channel type is not continuous: ' +
                  type);
            } else {
              param.bind = 'scales';
            }
          }
        }
      }
    }
  }

  // 12. Repair: Restrict scale bindings to continuous channels only
  if (spec.params) {
    spec.params.forEach(param => {
      if (param.bind === 'scales' && spec.encoding) {
        const continuousChannels = [];
        for (const channel in spec.encoding) {
          const type = spec.encoding[channel].type;
          if ((type === 'quantitative' || type === 'temporal') &&
              !spec.encoding[channel].timeUnit) {
            continuousChannels.push(channel);
          }
        }
        if (continuousChannels.length > 0) {
          if (typeof param.select === 'string') {
            param.select = {type: param.select, encodings: continuousChannels};
          } else if (typeof param.select === 'object') {
            param.select.encodings = continuousChannels;
          }
        } else {
          delete param.bind;
        }
      }
    });
  }

  // 13. Repair: Pull up nested params from group layers to prevent
  // "Unrecognized signal name" errors in child/sibling layers
  if (spec.layer) {
    if (!spec.params) spec.params = [];

    const extractGroupParams = (layers) => {
      layers.forEach(layer => {
        if (layer.layer && layer.params && !layer.mark) {
          layer.params.forEach(p => {
            if (!spec.params.some(topP => topP.name === p.name)) {
              spec.params.push(p);
            }
          });
          delete layer.params;
        }
        if (layer.layer) {
          extractGroupParams(layer.layer);
        }
      });
    };

    extractGroupParams(spec.layer);
    if (spec.params.length === 0) delete spec.params;
  }

  // 14. Repair: Move top-level interactive scale-bound params to the first
  // layer to avoid "Duplicate signal name" scale errors in layered charts
  if (spec.layer && spec.layer.length > 1 && spec.params) {
    if (!spec.layer[0].params) spec.layer[0].params = [];
    if (!spec.layer[0].encoding) spec.layer[0].encoding = {};

    spec.params = spec.params.filter(param => {
      if (param.bind === 'scales' || (param.bind && param.bind.scale)) {
        spec.layer[0].params.push(param);

        if (spec.encoding) {
          for (const channel in spec.encoding) {
            const enc = spec.encoding[channel];
            if (enc && enc.condition && enc.condition.param === param.name) {
              spec.layer[0].encoding[channel] = enc;
              delete spec.encoding[channel];
            }
          }
        }
        return false;
      }
      return true;
    });

    if (spec.params.length === 0) delete spec.params;
  }

  // 15. Repair: Deduplicate params to avoid "Duplicate signal name" errors
  const seenParams = new Set();
  const deduplicateParams = (node) => {
    if (!node) return;
    if (node.params) {
      node.params = node.params.filter(p => {
        if (seenParams.has(p.name)) return false;
        seenParams.add(p.name);
        return true;
      });
      if (node.params.length === 0) delete node.params;
    }
    if (node.layer) {
      node.layer.forEach(l => deduplicateParams(l));
    }
  };
  deduplicateParams(spec);

  if (spec.width === 'container') delete spec.width;
  if (spec.height === 'container') delete spec.height;

  // Enforce transparent background
  spec.background = 'transparent';

  return spec;
}
