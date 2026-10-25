function hexToRgb(hex) {
  let c = hex.substring(1);
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r, g, b) {
  return '#' +
      ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b))
          .toString(16)
          .slice(1);
}

function interpolateColor(color1, color2, factor) {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  const r = rgb1[0] + factor * (rgb2[0] - rgb1[0]);
  const g = rgb1[1] + factor * (rgb2[1] - rgb1[1]);
  const b = rgb1[2] + factor * (rgb2[2] - rgb1[2]);
  return rgbToHex(r, g, b);
}

function computeChoroplethBreaks(choropleth) {
  if (!choropleth || !choropleth.data || choropleth.computedBreaks) return;
  const sortedVals = Object.values(choropleth.data)
                         .filter(v => v != null && !isNaN(v))
                         .sort((a, b) => a - b);
  if (sortedVals.length > 0) {
    const numBuckets =
        Math.min(8, Math.max(3, Math.floor(sortedVals.length / 2)));
    choropleth.computedColors =
        getDiscretePalette(choropleth.colorPalette, numBuckets);
    choropleth.computedBreaks = getQuantileBreaks(sortedVals, numBuckets);
    choropleth.sortedVals = sortedVals;
  }
}

function getDiscretePalette(paletteHexList, numColors = 8) {
  if (!paletteHexList || !Array.isArray(paletteHexList) || paletteHexList.length === 0)
    paletteHexList = ['#f7fbff', '#08306b'];
  if (paletteHexList.length === 1)
    paletteHexList = ['#ffffff', paletteHexList[0]];
  if (paletteHexList.length === numColors) return paletteHexList;

  const res = [];
  for (let i = 0; i < numColors; i++) {
    const ratio = i / (numColors - 1 || 1);
    const numIntervals = paletteHexList.length - 1;
    const scaled = ratio * numIntervals;
    const idx = Math.min(numIntervals - 1, Math.floor(scaled));
    const localFactor = scaled - idx;
    res.push(interpolateColor(
        paletteHexList[idx], paletteHexList[idx + 1], localFactor));
  }
  return res;
}

function getQuantileBreaks(sortedVals, numBuckets) {
  if (sortedVals.length === 0) return [];
  if (sortedVals.length <= numBuckets) return sortedVals;
  const breaks = [];
  for (let i = 1; i < numBuckets; i++) {
    const pos = (i / numBuckets) * (sortedVals.length - 1);
    const idx = Math.floor(pos);
    const frac = pos - idx;
    breaks.push(
        sortedVals[idx] + frac * (sortedVals[idx + 1] - sortedVals[idx]));
  }
  breaks.push(sortedVals[sortedVals.length - 1]);
  return breaks;
}

function getColorForQuantile(val, breaks, discreteColors) {
  if (val == null || isNaN(val)) return '#cccccc';
  for (let i = 0; i < breaks.length; i++) {
    if (val <= breaks[i]) return discreteColors[i];
  }
  return discreteColors[discreteColors.length - 1];
}

function normalizeStr(s) {
  if (!s) return '';
  return String(s)
      .toLowerCase()
      .replace('st.', 'st')
      .replace('saint', 'st')
      .replace(/[^a-z0-9]/g, '');
}

function getMatchingGeoKey(feature, dataDict) {
  const keys = Object.keys(dataDict);
  // Safely extract FIPS from standard US Census GEO_ID string if present
  let censusGeoId = feature.getProperty('GEO_ID');
  if (typeof censusGeoId === 'string' && censusGeoId.startsWith('0500000US')) {
    censusGeoId = censusGeoId.substring(9);
  }

  const possibleProps = [
    feature.getProperty('shapeISO'), feature.getProperty('GEOID'), censusGeoId,
    feature.getProperty('shapeName'), feature.getProperty('shapeID'),
    feature.getProperty('NAME'), feature.getProperty('name'),
    feature.getProperty('neighborhoods_analysis_boundaries'),
    feature.getProperty('nhood'), feature.getProperty('neighborhood'),
    feature.getProperty('INCIDENT'), feature.getProperty('IncidentName'), feature.getProperty('poly_IncidentName')
  ];

  for (const prop of possibleProps) {
    if (prop != null && String(prop).trim() !== '') {
      const normProp = normalizeStr(prop);
      if (normProp) {
        const matchedKey = keys.find(k => {
          const normK = normalizeStr(k);
          if (!normK) return false;
          if (normK === normProp) return true;

          const globalSuffixes = [
            'county', 'parish', 'district', 'city', 'prefecture', 'province',
            'canton', 'state', 'region', 'department', 'municipality',
            'borough', 'commune', 'fire', 'complex'
          ];
          for (const sfx of globalSuffixes) {
            if (normK + sfx === normProp || normProp + sfx === normK)
              return true;
          }
          return false;
        });
        if (matchedKey) return matchedKey;
      }
    }
  }
  return null;
}

function create_choropleth_legend(
    spec, map_div, sortedVals, breaks, discreteColors) {
  if (!spec || !spec.choropleth || !spec.choropleth.data || !sortedVals ||
      sortedVals.length === 0)
    return;

  const legend = document.createElement('div');
  legend.className = 'map-legend';

  const title = document.createElement('div');
  title.className = 'legend-title';
  const unit = spec.choropleth.unit || '';
  
  let labelText = spec.choropleth.metricName || 'Metric';
  if (unit) {
    let trimmedLabel = labelText.trim();
    if (trimmedLabel.endsWith(')')) {
      labelText = trimmedLabel.slice(0, -1) + `, ${unit})`;
    } else {
      labelText = labelText + ` (${unit})`;
    }
  }
  title.textContent = labelText;
  
  legend.appendChild(title);

  const bar = document.createElement('div');
  bar.className = 'discrete-legend-bar';
  const formatVal = v => typeof v === 'number' ? v.toLocaleString() : v;

  let prevVal =
      sortedVals[0] !== undefined ? formatVal(Math.round(sortedVals[0])) : 0;

  for (let i = 0; i < discreteColors.length; i++) {
    const bucket = document.createElement('div');
    bucket.className = 'discrete-bucket';
    bucket.style.backgroundColor = discreteColors[i];

    const nextValNum =
        breaks[i] !== undefined ? Math.round(breaks[i]) : prevVal;
    const nextValStr = formatVal(nextValNum);
    bucket.title = `${prevVal} - ${nextValStr}` + (unit ? ` ${unit}` : '') +
        ` (Equal frequency bucket)`;

    bar.appendChild(bucket);
    prevVal = nextValStr;
  }
  legend.appendChild(bar);

  const minStr = spec.choropleth.legend?.minLabel ||
      (sortedVals[0] !== undefined ? `${formatVal(Math.round(sortedVals[0]))}` :
                                     '');
  const maxStr = spec.choropleth.legend?.maxLabel ||
      (sortedVals[sortedVals.length - 1] !== undefined ?
           `${formatVal(Math.round(sortedVals[sortedVals.length - 1]))}` :
           '');
  const medianVal = sortedVals[Math.floor(sortedVals.length / 2)];
  const medianStr =
      (!spec.choropleth.legend?.minLabel && medianVal !== undefined) ?
      `${formatVal(Math.round(medianVal))}` :
      '';

  const ticks = document.createElement('div');
  ticks.className = 'legend-ticks';
  ticks.innerHTML =
      `<span>${minStr}</span><span>${medianStr}</span><span>${maxStr}</span>`;
  legend.appendChild(ticks);

  map_div.appendChild(legend);
}

function create_categorical_legend(spec, map_div) {
  if (!spec || (!spec.polygons && !spec.lines)) return;

  const legend = document.createElement('div');
  legend.className = 'map-legend';

  const title = document.createElement('div');
  title.className = 'legend-title';
  title.textContent = spec.title || 'Legend';
  legend.appendChild(title);

  const list = document.createElement('div');
  list.className = 'categorical-legend-list';

  const uniqueColors = new Set();

  const addSwatchItem = (color, title) => {
    const item = document.createElement('div');
    item.className = 'categorical-item';

    const swatch = document.createElement('span');
    swatch.className = 'categorical-swatch';
    swatch.style.backgroundColor = color;
    item.appendChild(swatch);

    const label = document.createElement('span');
    label.className = 'categorical-label';
    label.textContent = title;
    item.appendChild(label);

    list.appendChild(item);
  };

  if (spec.polygons) {
    spec.polygons.forEach(poly => {
      if (poly.color && poly.title && !uniqueColors.has(poly.color)) {
        uniqueColors.add(poly.color);
        addSwatchItem(poly.color, poly.title);
      }
    });
  }

  if (spec.lines) {
    spec.lines.forEach(line => {
      if (line.color && line.title && !uniqueColors.has(line.color)) {
        uniqueColors.add(line.color);
        addSwatchItem(line.color, line.title);
      }
    });
  }

  legend.appendChild(list);
  map_div.appendChild(legend);
}

async function fetchGeoJSONWithFallback(geojsonUrl, signal = null) {
  const tryParseGeoJSON = (text) => {
    if (!text || text.trim().length === 0) return null;
    const obj = JSON.parse(text);
    if (obj &&
        (obj.type === 'FeatureCollection' || obj.type === 'Feature' ||
         obj.type === 'GeometryCollection')) {
      return obj;
    }
    return null;
  };

  const fetchWithTimeout = async (url) => {
    const response = await fetch(url, {signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const geojson = tryParseGeoJSON(text);
    if (!geojson) throw new Error('Invalid GeoJSON format');
    return geojson;
  };

  // Try direct fetch
  try {
    return await fetchWithTimeout(geojsonUrl);
  } catch (err) {
    console.warn(`Direct GeoJSON fetch failed for ${geojsonUrl}:`, err);
  }

  // Try CodeTabs proxy
  try {
    const codetabsUrl = `https://api.codetabs.com/v1/proxy/?quest=${
        encodeURIComponent(geojsonUrl)}`;
    return await fetchWithTimeout(codetabsUrl);
  } catch (err) {
    console.warn(`CodeTabs proxy GeoJSON fetch failed for ${geojsonUrl}:`, err);
  }

  // Try CORS proxy
  try {
    const corsproxyUrl =
        `https://corsproxy.io/?${encodeURIComponent(geojsonUrl)}`;
    return await fetchWithTimeout(corsproxyUrl);
  } catch (err) {
    console.warn(`CORS proxy GeoJSON fetch failed for ${geojsonUrl}:`, err);
    throw new Error(`Failed to fetch GeoJSON via all options: ${err.message}`);
  }
}

function create_legend_if_needed(spec, div) {
  if (spec.choropleth && spec.choropleth.computedBreaks) {
    create_choropleth_legend(
        spec, div, spec.choropleth.sortedVals, spec.choropleth.computedBreaks,
        spec.choropleth.computedColors);
  } else if (
      (spec.polygons && spec.polygons.length > 0 &&
       spec.polygons.some(p => p.color)) ||
      (spec.lines && spec.lines.length > 0 && spec.lines.some(l => l.color))) {
    create_categorical_legend(spec, div);
  }
}

function processGeometry(geometry, callback, thisArg) {
  if (!geometry) return;
  const type = geometry.getType();
  if (type === 'Point') {
    callback.call(thisArg, geometry.get());
  } else if (type === 'MultiPoint' || type === 'LineString') {
    geometry.getArray().forEach(latLng => callback.call(thisArg, latLng));
  } else if (type === 'MultiLineString' || type === 'Polygon') {
    geometry.getArray().forEach(lineOrRing => {
      lineOrRing.getArray().forEach(latLng => callback.call(thisArg, latLng));
    });
  } else if (type === 'MultiPolygon') {
    geometry.getArray().forEach(polygon => {
      polygon.getArray().forEach(ring => {
        ring.getArray().forEach(latLng => callback.call(thisArg, latLng));
      });
    });
  } else if (type === 'GeometryCollection') {
    geometry.getArray().forEach(g => processGeometry(g, callback, thisArg));
  }
}

function apply_geoboundaries_style_and_bounds(spec, map) {
  const geoStyle = spec.geoboundaries.style || {};
  const isChoropleth = spec.choropleth && spec.choropleth.data;

  let filter = spec.geoboundaries.filter;
  if (filter) {
    const normFilter = normalizeStr(filter);
    const commonKeys = [
      'nhood',
      'neighborhood',
      'neighborhoodsanalysisboundaries',
      'neighborhoods_analysis_boundaries',
      'name',
      'shapename',
      'shape_name',
      'shapeid',
      'shape_id',
      'geoid',
      'geo_id',
      'id',
      'iso',
      'shapeiso',
      'shape_iso',
      'isocode',
      'iso_code',
      'adm',
      'admlevel',
      'adm_level'
    ];
    if (commonKeys.includes(normFilter)) {
      filter = null;
    }
  }

  if (isChoropleth) {
    computeChoroplethBreaks(spec.choropleth);
  }

  const passesFilter = (feature, filterStr) => {
    if (isChoropleth &&
        getMatchingGeoKey(feature, spec.choropleth.data) !== null) {
      return true;
    }
    if (!filterStr) return true;

    // Remove the bad logic that returns true for all USA ADM2 shapes when a filter is actually present
    
    // Parse filterStr into an array of normalized parts
    let filterParts = [];
    if (Array.isArray(filterStr)) {
      filterParts = filterStr.map(s => normalizeStr(s));
    } else if (typeof filterStr === 'string') {
      filterParts = filterStr.split(/[,:;]/).map(s => normalizeStr(s)).filter(s => s);
    }
    if (filterParts.length === 0) return true;

    const iso = normalizeStr(feature.getProperty('shapeISO'));
    const group = normalizeStr(feature.getProperty('shapeGroup'));
    const name = normalizeStr(feature.getProperty('shapeName'));

    const usStateFips = {
      'alabama': '01',
      'alaska': '02',
      'arizona': '04',
      'arkansas': '05',
      'california': '06',
      'colorado': '08',
      'connecticut': '09',
      'delaware': '10',
      'florida': '12',
      'georgia': '13',
      'hawaii': '15',
      'idaho': '16',
      'illinois': '17',
      'indiana': '18',
      'iowa': '19',
      'kansas': '20',
      'kentucky': '21',
      'louisiana': '22',
      'maine': '23',
      'maryland': '24',
      'massachusetts': '25',
      'michigan': '26',
      'minnesota': '27',
      'mississippi': '28',
      'missouri': '29',
      'montana': '30',
      'nebraska': '31',
      'nevada': '32',
      'newhampshire': '33',
      'newjersey': '34',
      'newmexico': '35',
      'newyork': '36',
      'northcarolina': '37',
      'northdakota': '38',
      'ohio': '39',
      'oklahoma': '40',
      'oregon': '41',
      'pennsylvania': '42',
      'rhodeisland': '44',
      'southcarolina': '45',
      'southdakota': '46',
      'tennessee': '47',
      'texas': '48',
      'utah': '49',
      'vermont': '50',
      'virginia': '51',
      'washington': '53',
      'westvirginia': '54',
      'wisconsin': '55',
      'wyoming': '56'
    };
    
    // Check FIPS matches
    const stateFips = feature.getProperty('STATE');
    if (stateFips) {
      for (const part of filterParts) {
         if (usStateFips[part] === stateFips) return true;
      }
    }

    const checkMatch = (val) => {
      if (!val) return false;
      for (const part of filterParts) {
        if (val === part || val.includes(part) || part.includes(val)) return true;
      }
      return false;
    };

    if (checkMatch(iso)) return true;
    if (checkMatch(name)) return true;
    if (checkMatch(group)) return true;

    for (const key
             of ['STATE', 'STATE_NAME', 'state', 'state_name', 'STUSPS',
                 'PROVINCE', 'shapeGroup']) {
      const val = normalizeStr(feature.getProperty(key));
      if (checkMatch(val)) return true;
    }

    return false;
  };

  const is_match = (feature, filter) => {
    // is_match is purely used to highlight boundaries (orange outline) if they pass the filter
    // and aren't choropleths.
    // We already have complex passesFilter logic, just use it.
    if (!filter) return true;
    return passesFilter(feature, filter);
  };

  map.data.setStyle(function(feature) {
    if (!passesFilter(feature, filter)) {
      return {visible: false};
    }

    // Spatial safeguard: ESRI often returns nationwide duplicates for historical features.
    // If we have pins, ensure the polygon is within ~250 miles (~4 deg) of at least one pin.
    if (spec.pins && spec.pins.length > 0) {
      const b = new google.maps.LatLngBounds();
      processGeometry(feature.getGeometry(), latLng => b.extend(latLng));
      if (!b.isEmpty()) {
        const c = b.getCenter();
        const nearAny = spec.pins.some(p => Math.abs(c.lat() - p.lat) <= 4 && Math.abs(c.lng() - p.lng) <= 4);
        if (!nearAny) {
          return {visible: false};
        }
      }
    }

    const fName =
        feature.getProperty('shapeName') || feature.getProperty('NAME');
    const isParentContainer =
        filter && fName && (normalizeStr(fName) === normalizeStr(filter));

    if (isChoropleth && !isParentContainer) {
      const matchedKey = getMatchingGeoKey(feature, spec.choropleth.data);
      if (matchedKey !== null) {
        const val = spec.choropleth.data[matchedKey];
        const fillHex = getColorForQuantile(
            val, spec.choropleth.computedBreaks,
            spec.choropleth.computedColors);
        return {
          fillColor: fillHex,
          fillOpacity: 0.8,
          strokeWeight: 1,
          strokeColor: '#ffffff',
          visible: true,
          clickable: true
        };
      } else {
        // Render missing choropleth regions as neutral, no-data shapes so the
        // full map footprint remains visible
        return {
          fillColor: '#e0e0e0',
          fillOpacity: 0.15,
          strokeWeight: 1,
          strokeColor: '#cccccc',
          visible: true,
          clickable: true
        };
      }
    } else if (is_match(feature, filter)) {
      return {
        fillColor: geoStyle.fillColor || '#FF0000',
        fillOpacity:
            geoStyle.hasOwnProperty('fillOpacity') ? geoStyle.fillOpacity : 0.0,
        strokeWeight: geoStyle.strokeWeight || 2,
        strokeColor: geoStyle.strokeColor || '#fa7b17',
        visible: true,
        clickable: false
      };
    } else {
      return {visible: false};
    }
  });

  // Calculate bounds for matched features
  const bounds = new google.maps.LatLngBounds();
  let vertexCount = 0;
  map.data.forEach(function(feature) {
    if (is_match(feature, filter)) {
      processGeometry(feature.getGeometry(), latLng => {
        bounds.extend(latLng);
        vertexCount++;
      }, bounds);
    }
  });

  if (isChoropleth && spec.center && spec.zoom &&
      (spec.center.lat !== 0 || spec.center.lng !== 0)) {
    map.setCenter(spec.center);
    map.setZoom(spec.zoom);
  } else if (!bounds.isEmpty() && vertexCount > 0) {
    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();
    let lngSpan = Math.abs(ne.lng() - sw.lng());
    if (lngSpan > 180) lngSpan = 360 - lngSpan;

    if (lngSpan > 90 && spec.center && spec.zoom &&
        (spec.center.lat !== 0 || spec.center.lng !== 0)) {
      map.setCenter(spec.center);
      map.setZoom(spec.zoom);
    } else {
      map.fitBounds(bounds);
    }
  }

  let tooltip = document.getElementById('polygon-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'polygon-tooltip';
    tooltip.className = 'polygon-tooltip';
    document.body.appendChild(tooltip);
  }

  map.data.addListener('mouseover', (e) => {
    window.isPolyHovered = true;
    if (window.hidePolyTooltipTimeout) clearTimeout(window.hidePolyTooltipTimeout);
    if (window.isPinHovered) return;
    
    const pinHTML = e.feature.getProperty('pinTooltipHTML');
    if (pinHTML) {
      tooltip.innerHTML = pinHTML;
      tooltip.classList.add('visible');
      return;
    }

    if (isChoropleth) {
      const matchedKey = getMatchingGeoKey(e.feature, spec.choropleth.data);
      if (matchedKey !== null) {
        const name = e.feature.getProperty('shapeName') ||
            e.feature.getProperty('NAME') || matchedKey;
        const val = spec.choropleth.data[matchedKey];
        const unit = spec.choropleth.unit || '';
        const metricName = spec.choropleth.metricName || 'Value';
        let formattedVal = val;
        if (typeof val === 'number') {
          formattedVal = val.toLocaleString();
        }
        tooltip.innerHTML = `<div class="tooltip-header">${
            name}</div><div class="tooltip-body">${metricName}: ${
            formattedVal}${unit ? ' ' + unit : ''}</div>`;
        tooltip.classList.add('visible');
      }
    }
  });

  map.data.addListener('mousemove', (e) => {
    if (window.isPinHovered) return;
    
    window.isPolyHovered = true;
    if (window.hidePolyTooltipTimeout) {
        clearTimeout(window.hidePolyTooltipTimeout);
    }
    
    // Recovery for polygon hover if tooltip disappeared
    if (!tooltip.classList.contains('visible')) {
      const pinHTML = e.feature.getProperty('pinTooltipHTML');
      if (pinHTML) {
        tooltip.innerHTML = pinHTML;
        tooltip.classList.add('visible');
      } else {
        const isChoropleth = spec.choropleth && spec.choropleth.data;
        if (isChoropleth) {
          const matchedKey = getMatchingGeoKey(e.feature, spec.choropleth.data);
          if (matchedKey !== null) {
            const name = e.feature.getProperty('shapeName') ||
                e.feature.getProperty('NAME') || matchedKey;
            const val = spec.choropleth.data[matchedKey];
            const unit = spec.choropleth.unit || '';
            const metricName = spec.choropleth.metricName || 'Value';
            let formattedVal = val;
            if (typeof val === 'number') {
              formattedVal = val.toLocaleString();
            }
            tooltip.innerHTML = `<div class="tooltip-header">${
                name}</div><div class="tooltip-body">${metricName}: ${
                formattedVal}${unit ? ' ' + unit : ''}</div>`;
            tooltip.classList.add('visible');
          }
        }
      }
    }

    if (tooltip.classList.contains('visible')) {
      tooltip.style.left = (e.domEvent.pageX + 10) + 'px';
      tooltip.style.top = (e.domEvent.pageY + 10) + 'px';
    }
  });

  map.data.addListener('mouseout', () => {
    window.isPolyHovered = false;
    window.hidePolyTooltipTimeout = setTimeout(() => {
        if (!window.isPinHovered && !window.isPolyHovered) {
             tooltip.classList.remove('visible');
        }
    }, 30);
  });
}

async function draw_spec_on_map(
    spec, map, widget = null, map_div = null, container = null) {
  if (spec.choropleth && spec.choropleth.data) {
    computeChoroplethBreaks(spec.choropleth);
  }

  if (spec.polygons) {
    const bounds = new google.maps.LatLngBounds();
    // Only fit bounds to filled polygons if they exist, to avoid zooming out
    // too much on large area borders.
    const filledPolygons = spec.polygons.filter(
        p => p.hasOwnProperty('fillOpacity') && p.fillOpacity > 0);
    const polygonsToFit =
        filledPolygons.length > 0 ? filledPolygons : spec.polygons;

    let tooltip = document.getElementById('polygon-tooltip');
    if (!tooltip &&
        spec.polygons.some(
            p => !(p.hasOwnProperty('fillOpacity') && p.fillOpacity === 0))) {
      tooltip = document.createElement('div');
      tooltip.id = 'polygon-tooltip';
      tooltip.className = 'polygon-tooltip';
      document.body.appendChild(tooltip);
    }

    spec.polygons.forEach(poly => {
      let fillColor = poly.color || '#FF0000';
      let fillOpacity =
          poly.hasOwnProperty('fillOpacity') ? poly.fillOpacity : 0.65;
      let polyName = poly.title || poly.label || 'Area';
      let tooltipHTML = `<div class="tooltip-header">${polyName}</div>`;
      if (poly.tooltip) {
         tooltipHTML += `<div class="tooltip-body">${poly.tooltip}</div>`;
      }

      if (spec.choropleth && spec.choropleth.data &&
          spec.choropleth.computedBreaks) {
        const matchedKey = getMatchingGeoKey(
            {getProperty: p => p === 'shapeName' ? polyName : null},
            spec.choropleth.data);
        if (matchedKey !== null) {
          const val = spec.choropleth.data[matchedKey];
          fillColor = getColorForQuantile(
              val, spec.choropleth.computedBreaks,
              spec.choropleth.computedColors);
          fillOpacity = 0.8;
          const unit = spec.choropleth.unit || '';
          const metricName = spec.choropleth.metricName || 'Value';
          const formatVal = v => typeof v === 'number' ? v.toLocaleString() : v;
          tooltipHTML = `<div class="tooltip-header">${
              polyName}</div><div class="tooltip-body">${metricName}: ${
              formatVal(val)}${unit ? ' ' + unit : ''}</div>`;
          if (!poly.title) poly.title = matchedKey;
          if (!poly.label) poly.label = matchedKey;
        }
      }

      let paths = [];
      if (poly.vertices) {
        paths = poly.vertices.map(v => new google.maps.LatLng(v.lat, v.lng));
      } else if (poly.coordinates) {
        let coords = poly.coordinates;
        // flatten array if it's nested [[[lng, lat]]] -> [[lng, lat]]
        while (coords.length > 0 && Array.isArray(coords[0]) && Array.isArray(coords[0][0]) && typeof coords[0][0][0] !== 'number') {
            coords = coords[0];
        }
        if (coords.length > 0 && Array.isArray(coords[0]) && typeof coords[0][0] === 'number') {
            paths = coords.map(c => new google.maps.LatLng(c[1], c[0]));
        } else if (coords.length > 0 && Array.isArray(coords[0]) && Array.isArray(coords[0][0])) {
            paths = coords[0].map(c => new google.maps.LatLng(c[1], c[0]));
        }
      } else if (poly.geometry && typeof poly.geometry === 'string' && poly.geometry.startsWith('POLYGON')) {
        const match = poly.geometry.match(/\(\((.*?)\)\)/);
        if (match && match[1]) {
           paths = match[1].split(',').map(pair => {
              const [lng, lat] = pair.trim().split(/\s+/).map(Number);
              if (!isNaN(lat) && !isNaN(lng)) {
                return new google.maps.LatLng(lat, lng);
              }
           }).filter(p => p !== undefined);
        }
      }

      paths.forEach(latLng => {
        if (polygonsToFit.includes(poly)) {
          bounds.extend(latLng);
        }
      });

      const isAreaOfInterest =
          poly.hasOwnProperty('fillOpacity') && poly.fillOpacity === 0;

      const polygon = new google.maps.Polygon({
        paths: paths,
        fillColor: fillColor,
        fillOpacity: fillOpacity,
        strokeColor: poly.strokeColor || poly.color || '#FF0000',
        strokeWeight: poly.strokeWeight || 2,
        strokeOpacity: poly.strokeWeight ? 1.0 : 1.0,
        map: map,
        clickable: !isAreaOfInterest
      });

      if (!isAreaOfInterest) {
        polygon.addListener('mouseover', (e) => {
          if (window.isPinHovered) return;
          tooltip.innerHTML = tooltipHTML;
          tooltip.classList.add('visible');
        });

        polygon.addListener('mousemove', (e) => {
          if (window.isPinHovered) {
            tooltip.classList.remove('visible');
            return;
          }
          tooltip.classList.add('visible');
          tooltip.style.left = (e.domEvent.pageX + 10) + 'px';
          tooltip.style.top = (e.domEvent.pageY + 10) + 'px';
        });

        polygon.addListener('mouseout', () => {
          tooltip.classList.remove('visible');
        });
      }
    });
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds);
    }
  }

  if (spec.lines) {
    const bounds = new google.maps.LatLngBounds();
    let tooltip = document.getElementById('polygon-tooltip');
    if (!tooltip && spec.lines.some(l => l.title)) {
      tooltip = document.createElement('div');
      tooltip.id = 'polygon-tooltip';
      tooltip.className = 'polygon-tooltip';
      document.body.appendChild(tooltip);
    }

    spec.lines.forEach(line => {
      const path = line.coordinates.map(c => {
        const latLng = new google.maps.LatLng(c.lat, c.lng);
        bounds.extend(latLng);
        return latLng;
      });

      const polyline = new google.maps.Polyline({
        path: path,
        strokeColor: line.color || '#FF0000',
        strokeOpacity:
            line.hasOwnProperty('strokeOpacity') ? line.strokeOpacity : 1.0,
        strokeWeight: line.strokeWeight || 2,
        map: map
      });

      if (line.title) {
        polyline.addListener('mouseover', (e) => {
          if (window.isPinHovered) return;
          tooltip.innerHTML = `<div class="tooltip-header">${line.title}</div>`;
          tooltip.classList.add('visible');
        });

        polyline.addListener('mousemove', (e) => {
          if (window.isPinHovered) {
            tooltip.classList.remove('visible');
            return;
          }
          tooltip.classList.add('visible');
          tooltip.style.left = (e.domEvent.pageX + 10) + 'px';
          tooltip.style.top = (e.domEvent.pageY + 10) + 'px';
        });

        polyline.addListener('mouseout', () => {
          tooltip.classList.remove('visible');
        });
      }
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds);
    }
  }

  if (spec.geoboundaries &&
      (spec.geoboundaries.geojsonUrl ||
       (spec.geoboundaries.iso && spec.geoboundaries.adm))) {
    if (spec.geoboundaries.geojson) {
      // Use cached GeoJSON!
      map.data.addGeoJson(spec.geoboundaries.geojson);
      apply_geoboundaries_style_and_bounds(spec, map);
    } else {
      let progress_div = null;
      let summary = null;
      let details = null;
      let step_result_div = null;

      if (container) {
        step_result_div = container;
        summary = container.querySelector('.zippy-header');
      } else if (map_div) {
        step_result_div = map_div.parentNode;
        summary = step_result_div.querySelector('.zippy-header');
      }

      try {
        if (summary) {
          // Hide pseudo-arrow while Step 4 is in progress

          summary.classList.remove('completed');
          summary.classList.add('running');

          const col2 = summary.querySelector('.col-2');
          if (col2) col2.textContent = widget_spec.step4_progress;

          const col4 = summary.querySelector('.col-4');
          if (col4)
            col4.innerHTML =
                `<span class="blink">${widget_spec.progress_blink}</span>`;

        } else if (widget && map_div && !container) {
          progress_div = document.createElement('div');
          progress_div.className = 'step-result running';
          progress_div.innerHTML = `<span class="spinner"></span>${
              widget_spec.step4_progress}<span class="blink">${
              widget_spec.progress_blink}</span>`;
          map_div.parentNode.insertBefore(progress_div, map_div);
        } else if (widget && !container) {
          progress_div = document.createElement('div');
          progress_div.className = 'step-result running';
          progress_div.innerHTML = `<span class="spinner"></span>${
              widget_spec.step4_progress}<span class="blink">${
              widget_spec.progress_blink}</span>`;
          widget.output.appendChild(progress_div);
        }

        if (spec.geoboundaries.geojsonUrl) {
          try {
            let geojsonUrl = spec.geoboundaries.geojsonUrl;
            if (geojsonUrl.includes('github.com') &&
                geojsonUrl.includes('/raw/')) {
              geojsonUrl =
                  geojsonUrl
                      .replace(
                          'github.com', 'media.githubusercontent.com/media')
                      .replace('/raw/', '/');
            }

            // Automatically resolve Socrata map visualization URLs to their
            // underlying dataset shapefiles
            const socrataMatch = geojsonUrl.match(
                /https?:\/\/([^\/]+)\/api\/geospatial\/([a-z0-9]{4}-[a-z0-9]{4})/i);
            if (socrataMatch) {
              const domain = socrataMatch[1];
              const id = socrataMatch[2];
              try {
                const metaUrl = `https://${domain}/api/views/${id}.json`;
                let metaResponse = await fetch(
                    metaUrl, {signal: widget?.abort_controller?.signal});
                if (!metaResponse || !metaResponse.ok) {
                  metaResponse = await fetch(
                      `https://api.codetabs.com/v1/proxy/?quest=${
                          encodeURIComponent(metaUrl)}`,
                      {signal: widget?.abort_controller?.signal});
                }
                if (metaResponse && metaResponse.ok) {
                  const meta = await metaResponse.json();
                  if ((meta.assetType === 'map' ||
                       meta.displayType === 'visualization_canvas_map') &&
                      meta.modifyingViewUid) {
                    console.log(`Resolving Socrata map visualization ${
                        id} to underlying dataset ${meta.modifyingViewUid}`);
                    geojsonUrl = geojsonUrl.replace(id, meta.modifyingViewUid);
                  }
                }
              } catch (err) {
                console.warn(
                    'Failed to preprocess Socrata view metadata:', err);
              }
            }

            let geojson = null;
            try {
              geojson = await fetchGeoJSONWithFallback(
                  geojsonUrl, widget?.abort_controller?.signal);
            } catch (error) {
              console.error('Custom GeoJSON loading failed:', error);
              throw new Error(
                  'The custom boundary URL did not return a valid GeoJSON document. Please verify that the URL is active and serves valid GeoJSON.');
            }

            map.data.addGeoJson(geojson);
            spec.geoboundaries.geojson = geojson;  // Cache it
            apply_geoboundaries_style_and_bounds(spec, map);
          } catch (error) {
            console.error('Failed to load custom GeoJSON URL:', error);
            throw error;
          }
        } else {
          let isos = [];
          if (typeof spec.geoboundaries.iso === 'string') {
            isos = spec.geoboundaries.iso.split(',').map(s => s.trim());
          } else if (Array.isArray(spec.geoboundaries.iso)) {
            isos = spec.geoboundaries.iso;
          } else {
            isos = [spec.geoboundaries.iso];
          }
          const adm = spec.geoboundaries.adm;
          let success_count = 0;
          let last_error = null;

          for (const iso of isos) {
            try {
              const directApiUrl =
                  `https://www.geoboundaries.org/api/current/gbOpen/${iso}/${
                      adm}/`;
              let response;
              try {
                response = await fetch(
                    directApiUrl, {signal: widget?.abort_controller?.signal});
              } catch (error) {
                console.warn(`Direct fetch failed for ${iso}:`, error);
              }

              if (!response || !response.ok) {
                const codetabsUrl = `https://api.codetabs.com/v1/proxy/?quest=${
                    encodeURIComponent(directApiUrl)}`;
                try {
                  response = await fetch(
                      codetabsUrl, {signal: widget?.abort_controller?.signal});
                } catch (error) {
                  console.warn(`CodeTabs proxy failed for ${iso}:`, error);
                }
              }

              if (!response || !response.ok) {
                const corsproxyUrl =
                    `https://corsproxy.io/?${encodeURIComponent(directApiUrl)}`;
                try {
                  response = await fetch(
                      corsproxyUrl, {signal: widget?.abort_controller?.signal});
                } catch (error) {
                  throw new Error(`Failed to fetch API for ${
                      iso}. Fallback error: ${error.message}`);
                }
                if (!response.ok)
                  throw new Error(`Failed to fetch API for ${iso}.`);
              }

              const contentType = response.headers.get('content-type');
              if (!contentType || !contentType.includes('application/json')) {
                const text = await response.text();
                if (text.trim().startsWith('<!DOCTYPE') ||
                    text.includes('404 Not Found')) {
                  throw new Error(`The boundary data for ${
                      iso} could not be found (API returned 404).`);
                }
                throw new Error(`Expected JSON from API for ${iso} but got: ${
                    text.substring(0, 100)}`);
              }

              const data = await response.json();
              let geojsonUrl =
                  data.simplifiedGeometryGeoJSON || data.gjDownloadURL;

              if (geojsonUrl) {
                if (geojsonUrl.includes('github.com') &&
                    geojsonUrl.includes('/raw/')) {
                  geojsonUrl =
                      geojsonUrl
                          .replace(
                              'github.com', 'media.githubusercontent.com/media')
                          .replace('/raw/', '/');
                }

                const geojson = await fetchGeoJSONWithFallback(
                    geojsonUrl, widget?.abort_controller?.signal);
                map.data.addGeoJson(geojson);

                if (isos.length === 1) {
                  spec.geoboundaries.geojson = geojson;  // Cache it!
                }
                success_count++;
              }
            } catch (error) {
              console.error(`Failed to load geoBoundaries for ${iso}:`, error);
              last_error = error;
            }
          }

          if (success_count === 0 && isos.length > 0) {
            throw last_error ||
                new Error(
                    'Failed to load geoBoundaries for all requested regions.');
          }

          apply_geoboundaries_style_and_bounds(spec, map);
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          return;
        }
        console.error('Failed to load geoBoundaries:', error);

        const is_404 = error.message.includes('404');
        const msg = is_404 ?
            'Boundary data not available for this region, showing pins only.' :
            'Failed to load geoBoundaries: ' + error.message;

        if (widget && map_div) {
          const err_div = document.createElement('div');
          err_div.className =
              is_404 ? 'step-result warning' : 'step-result error';
          err_div.textContent = msg;
          widget.output.appendChild(err_div);
        } else if (widget) {
          show_error(widget, msg);
        }
      } finally {
        if (progress_div) {
          progress_div.remove();
        }

        if (summary) {
          summary.classList.remove('running');
          summary.classList.add('completed');

          const col2 = summary.querySelector('.col-2');
          if (col2) col2.textContent = widget_spec.step3_summary;

          const col4 = summary.querySelector('.col-4');
          if (col4) col4.innerHTML = '';
        }
      }
    }
  }

  if (spec.pins) {
    const {AdvancedMarkerElement} = await google.maps.importLibrary('marker');
    const isChoropleth = spec.choropleth && spec.choropleth.data &&
        spec.choropleth.computedBreaks;

    spec.pins.forEach((pin) => {
      if (pin.lat === undefined && pin.latitude !== undefined) pin.lat = pin.latitude;
      if (pin.lng === undefined && pin.longitude !== undefined) pin.lng = pin.longitude;
      if (typeof pin.lat === 'string') pin.lat = parseFloat(pin.lat);
      if (typeof pin.lng === 'string') pin.lng = parseFloat(pin.lng);

      const markerContent = document.createElement('div');
      markerContent.className = 'pin-tooltip';

      const pinElement = document.createElement('div');
      pinElement.className = 'pin-dot';

      if (pin.color) {
        pinElement.style.backgroundColor = pin.color;
        pinElement.style.borderColor = '#ffffff';
      }

      let tooltipLabel = pin.label;
      let matchedChoropleth = false;
      let matchedKey = null;
      
      if (isChoropleth) {
        const keys = Object.keys(spec.choropleth.data);
        matchedKey = keys.find(k => {
          const normK = normalizeStr(k);
          const normL = normalizeStr(pin.label);
          return normK && normL &&
              (normK === normL || normL.includes(normK) ||
               normK.includes(normL));
        });
        if (matchedKey) {
          matchedChoropleth = true;
          const val = spec.choropleth.data[matchedKey];
          if (!pin.color) {
            const fillHex = getColorForQuantile(
                val, spec.choropleth.computedBreaks,
                spec.choropleth.computedColors);
            pinElement.style.backgroundColor = fillHex;
            pinElement.style.borderColor = '#ffffff';
          }

          if (!pin.tooltip) {
            const unit = spec.choropleth.unit || '';
            const metricName = spec.choropleth.metricName || 'Value';
            const formatVal = v => typeof v === 'number' ? v.toLocaleString() : v;
            tooltipLabel = `<div class="tooltip-header">${
                pin.label}</div><div class="tooltip-body">${metricName}: ${
                formatVal(val)}${unit ? ' ' + unit : ''}</div>`;
          }
        }
      }
      
      if (pin.tooltip && (!matchedChoropleth || pin.tooltip)) {
        tooltipLabel = `<div class="tooltip-header">${pin.label}</div><div class="tooltip-body">${pin.tooltip}</div>`;
      } else if (!matchedChoropleth && tooltipLabel === pin.label) {
        tooltipLabel = `<div class="tooltip-header">${pin.label}</div>`;
      }

      markerContent.appendChild(pinElement);

      // CSS tooltip removed

      let pinPos = {lat: pin.lat, lng: pin.lng};
      let fallbackCircle = null;

      if (map.data) {
        const mockDataDict = {};
        mockDataDict[pin.label] = true;
        let matchedFeature = null;
        let minDistance = Infinity;
        map.data.forEach((feature) => {
           if (getMatchingGeoKey(feature, mockDataDict) !== null) {
              const bounds = new google.maps.LatLngBounds();
              processGeometry(feature.getGeometry(), latLng => bounds.extend(latLng));
              if (!bounds.isEmpty()) {
                 const c = bounds.getCenter();
                 const dist = Math.abs(c.lat() - pin.lat) + Math.abs(c.lng() - pin.lng);
                 if (dist < 4 && dist < minDistance) {
                    minDistance = dist;
                    matchedFeature = feature;
                 }
              }
           }
        });
        if (matchedFeature) {
           matchedFeature.setProperty('pinTooltipHTML', tooltipLabel);
           const featureBounds = new google.maps.LatLngBounds();
           processGeometry(matchedFeature.getGeometry(), latLng => featureBounds.extend(latLng));
           if (!featureBounds.isEmpty()) {
             const center = featureBounds.getCenter();
             pinPos = {lat: center.lat(), lng: center.lng()};
           }
        } else if (isChoropleth && matchedChoropleth && spec.choropleth.unit && spec.choropleth.unit.toLowerCase().includes('acre')) {
           // We have a pin, it has acreage data, but NO polygon loaded.
           // Synthesize a fallback circle proportional to acreage.
           let valStr = String(spec.choropleth.data[matchedKey]).replace(/,/g, '');
           const val = parseFloat(valStr) || 0;
           const sqMeters = val * 4046.86;
           const radius = Math.sqrt(sqMeters / Math.PI);
           
           const fillHex = getColorForQuantile(
                val, spec.choropleth.computedBreaks,
                spec.choropleth.computedColors);

           fallbackCircle = new google.maps.Circle({
             strokeColor: '#ffffff',
             strokeOpacity: 1.0,
             strokeWeight: 1,
             fillColor: fillHex,
             fillOpacity: 0.8,
             map: map,
             center: pinPos,
             radius: radius,
             zIndex: 5
           });
           
           tooltipLabel += `<div class="tooltip-body" style="font-style: italic; opacity: 0.8; font-size: 0.9em; margin-top: 4px;">Circle reflects size but not true shape.</div>`;
        }
      }

      const marker = new AdvancedMarkerElement({
        map: map,
        position: pinPos,
        content: markerContent,
        zIndex: 10
      });

      if (fallbackCircle) {
        fallbackCircle.addListener('click', () => {
          map.fitBounds(fallbackCircle.getBounds());
          marker.zIndex = 11;
        });

        fallbackCircle.addListener('mouseover', (e) => {
           window.isPolyHovered = true;
           if (window.hidePolyTooltipTimeout) clearTimeout(window.hidePolyTooltipTimeout);
           if (window.isPinHovered) return;
           const polyTooltip = document.getElementById('polygon-tooltip');
           if (polyTooltip) {
             polyTooltip.innerHTML = tooltipLabel;
             polyTooltip.classList.add('visible');
             if (e.domEvent) {
               polyTooltip.style.left = (e.domEvent.pageX + 10) + 'px';
               polyTooltip.style.top = (e.domEvent.pageY + 10) + 'px';
             }
           }
        });

        fallbackCircle.addListener('mousemove', (e) => {
           window.isPolyHovered = true;
           if (window.hidePolyTooltipTimeout) clearTimeout(window.hidePolyTooltipTimeout);
           if (window.isPinHovered) return;
           const polyTooltip = document.getElementById('polygon-tooltip');
           if (polyTooltip) {
             if (!polyTooltip.classList.contains('visible')) {
               polyTooltip.innerHTML = tooltipLabel;
               polyTooltip.classList.add('visible');
             }
             if (e.domEvent) {
               polyTooltip.style.left = (e.domEvent.pageX + 10) + 'px';
               polyTooltip.style.top = (e.domEvent.pageY + 10) + 'px';
             }
           }
        });

        fallbackCircle.addListener('mouseout', () => {
           window.isPolyHovered = false;
           const polyTooltip = document.getElementById('polygon-tooltip');
           if (polyTooltip) {
              window.hidePolyTooltipTimeout = setTimeout(() => {
                  if (!window.isPinHovered && !window.isPolyHovered) {
                      polyTooltip.classList.remove('visible');
                  }
              }, 30);
           }
        });
      }

      markerContent.addEventListener('mouseenter', (e) => {
        if (window.hidePolyTooltipTimeout) {
            clearTimeout(window.hidePolyTooltipTimeout);
        }
        window.isPinHovered = true;
        window.isPolyHovered = false;
        marker.zIndex = 2000;
        const polyTooltip = document.getElementById('polygon-tooltip');
        if (polyTooltip) {
          polyTooltip.innerHTML = tooltipLabel;
          polyTooltip.classList.add('visible');
          polyTooltip.style.left = (e.pageX + 10) + 'px';
          polyTooltip.style.top = (e.pageY + 10) + 'px';
        }
      });
      
      markerContent.addEventListener('mousemove', (e) => {
        const polyTooltip = document.getElementById('polygon-tooltip');
        if (polyTooltip && polyTooltip.classList.contains('visible')) {
          polyTooltip.style.left = (e.pageX + 10) + 'px';
          polyTooltip.style.top = (e.pageY + 10) + 'px';
        }
      });

      markerContent.addEventListener('mouseleave', () => {
        window.isPinHovered = false;
        marker.zIndex = 1000;
        const polyTooltip = document.getElementById('polygon-tooltip');
        if (polyTooltip) {
            window.hidePolyTooltipTimeout = setTimeout(() => {
                if (!window.isPinHovered && !window.isPolyHovered) {
                    polyTooltip.classList.remove('visible');
                }
            }, 30);
        }
      });

      markerContent.addEventListener('click', async (e) => {
        e.stopPropagation();
        let boundsToFit = null;

        if (spec.polygons) {
          const matchingPoly = spec.polygons.find(
              p => normalizeStr(p.label || p.title) === normalizeStr(pin.label));
          if (matchingPoly) {
            boundsToFit = new google.maps.LatLngBounds();
            let paths = [];
            if (matchingPoly.vertices) {
              paths = matchingPoly.vertices.map(
                  v => new google.maps.LatLng(v.lat, v.lng));
            } else if (matchingPoly.coordinates) {
              let coords = matchingPoly.coordinates;
              while (coords.length > 0 && Array.isArray(coords[0]) &&
                     Array.isArray(coords[0][0]) &&
                     typeof coords[0][0][0] !== 'number') {
                coords = coords[0];
              }
              if (coords.length > 0 && Array.isArray(coords[0]) &&
                  typeof coords[0][0] === 'number') {
                paths = coords.map(c => new google.maps.LatLng(c[1], c[0]));
              }
            } else if (matchingPoly.geometry && typeof matchingPoly.geometry === 'string' && matchingPoly.geometry.startsWith('POLYGON')) {
              const match = matchingPoly.geometry.match(/\(\((.*?)\)\)/);
              if (match && match[1]) {
                paths = match[1].split(',').map(pair => {
                   const [lng, lat] = pair.trim().split(/\s+/).map(Number);
                   if (!isNaN(lat) && !isNaN(lng)) {
                     return new google.maps.LatLng(lat, lng);
                   }
                }).filter(p => p !== undefined);
              }
            }
            paths.forEach(latLng => boundsToFit.extend(latLng));
          }
        }

        if (!boundsToFit && map.data) {
          const mockDataDict = {};
          mockDataDict[pin.label] = true;
          let matchedFeature = null;
          map.data.forEach((feature) => {
             const keyMatches = getMatchingGeoKey(feature, mockDataDict);
             if (keyMatches !== null) {
                const b2 = new google.maps.LatLngBounds();
                processGeometry(feature.getGeometry(), latLng => b2.extend(latLng));
                if (!b2.isEmpty()) {
                   const c2 = b2.getCenter();
                   if (Math.abs(c2.lat() - pin.lat) <= 4 && Math.abs(c2.lng() - pin.lng) <= 4) {
                      matchedFeature = feature;
                   }
                }
             }
          });
          
          if (matchedFeature) {
             boundsToFit = new google.maps.LatLngBounds();
             processGeometry(matchedFeature.getGeometry(), latLng => boundsToFit.extend(latLng));
          } else if (fallbackCircle) {
             boundsToFit = fallbackCircle.getBounds();
          }
        }

        const isMaximized = document.getElementsByTagName('body')[0].classList.contains('popup');

        if (isMaximized) {
          if (boundsToFit && !boundsToFit.isEmpty()) {
            map.fitBounds(boundsToFit);
          } else {
            map.setCenter({lat: pin.lat, lng: pin.lng});
            map.setZoom(10);
          }
        } else {
          if (window.is_maximizing) return;
          window.is_maximizing = true;
          try {
            await maximize_map(
                spec, {lat: pin.lat, lng: pin.lng}, 10, boundsToFit);
          } finally {
            window.is_maximizing = false;
          }
        }
      });
    });
  }
}

async function create_map(spec, div, widget = null, container = null) {
  const {Map} = await google.maps.importLibrary('maps');

  if (Array.isArray(spec.center) && spec.center.length >= 2) {
    spec.center = { lat: spec.center[0], lng: spec.center[1] };
  }

  const map = new Map(div, {
    center: spec.center || { lat: 0, lng: 0 },
    zoom: spec.zoom || 3,
    mapTypeId: 'hybrid',
    disableDefaultUI: true,
    mapId: 'DEMO_MAP_ID',
  });

  await draw_spec_on_map(spec, map, widget, div, container);

  create_legend_if_needed(spec, div);

  const button = document.createElement('div');
  button.classList.add('maximize-button');
  div.appendChild(button);

  let is_maximizing = false;
  button.addEventListener('click', async function() {
    if (is_maximizing) return;
    is_maximizing = true;
    button.style.opacity = '0.5';
    button.style.cursor = 'wait';
    try {
      await maximize_map(spec, map.getCenter(), map.getZoom());
    } finally {
      is_maximizing = false;
      button.style.opacity = '';
      button.style.cursor = '';
    }
  });
}

function show_maximized_content(content) {
  var popup = document.getElementById('popup');
  content.id = 'popup-content';
  popup.appendChild(content);
  document.getElementsByTagName('body')[0].classList.add('popup');
}

function hide_maximized_content() {
  var popup = document.getElementById('popup');
  var content = document.getElementById('popup-content');
  if (content) popup.removeChild(content);
  document.getElementsByTagName('body')[0].classList.remove('popup');
}

async function maximize_map(spec, center, zoom, boundsToFit = null) {
  const {Map} = await google.maps.importLibrary('maps');
  var div = document.createElement('div');
  div.style.width = '100vw';
  div.style.height = '100vh';
  div.style.position = 'relative';

  var map = new Map(div, {
    center: center,
    zoom: zoom,
    mapTypeId: 'hybrid',
    disableDefaultUI: true,
    gestureHandling: 'greedy',
    zoomControl: true,
    mapTypeControl: true,
    mapId: 'DEMO_MAP_ID',
  });

  await draw_spec_on_map(spec, map);

  if (boundsToFit && !boundsToFit.isEmpty()) {
    map.fitBounds(boundsToFit);
  }

  create_legend_if_needed(spec, div);

  show_maximized_content(div);
}

function show_error(widget, message = 'Error') {
  const err_div = document.createElement('div');
  err_div.className = 'zippy-row step-result error';
  err_div.innerHTML = `
				<div class="col-1 error-icon"></div>
				<div class="col-2">${message}</div>
				<div class="col-3"></div>
				<div class="col-4"></div>
			`;
  widget.output.appendChild(err_div);
}

window.create_map = create_map;

// Bootstrap loader (Dynamic Library Import API)
(g => {
  var h, a, k, p = 'The Google Maps JavaScript API', c = 'google',
               l = 'importLibrary', q = '__ib__', m = document, b = window;
  b = b[c] || (b[c] = {});
  var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams,
      u = () =>
          h ||
      (h = new Promise(async (f, n) => {
            await (a = m.createElement('script'));
            e.set('libraries', [...r] + '');
            for (k in g)
              e.set(k.replace(/[A-Z]/g, t => '_' + t[0].toLowerCase()), g[k]);
            e.set('callback', c + '.maps.' + q);
            a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
            d[q] = f;
            a.onerror = () => h = n(Error(p + ' could not load.'));
            a.nonce = m.querySelector('script[nonce]')?.nonce || '';
            m.head.append(a)
          }));
  d[l] ? console.warn(p + ' only loads once. Ignoring:', g) :
         d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n))
})({
  key: 'AIzaSyBso2blH4dR4oYVIBzosWqaN-9pHCVnQ4w',
  v: 'weekly',
});
