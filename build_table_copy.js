"use strict";

(function () {

  /* ── Layout constants ─────────────────────────────────────────────────── */
  const PX_PER_COL  = 90;
  const PX_PER_ROW  = 22;
  const TITLE_ROWS  = 1;
  const COL_GAP     = 0;  
  const ROW_GAP     = 1;

  /*
   * ROW_GROUP_THRESHOLD
   * Tables with more than this many data rows will have their overflow rows
   * grouped and collapsed in Excel. The first N rows stay always visible.
   * The rest collapse behind a [+] button the user can click to expand.
   *
   * Why 8: matches a typical dashboard panel height — about the number of
   * rows visible in a Tableau chart pane without scrolling.
   * Change this value to tune how many rows are always visible.
   */
  const ROW_GROUP_THRESHOLD = 15;

  /* ── KPI Detection ─────────────────────────────────────────────────────── */
  function isKPICard(worksheet, summaryData) {
    if (!summaryData || !summaryData.data) return false;
    
    const rowCount = summaryData.data.length;
    const colCount = summaryData.columns?.length || 0;
    
    if (rowCount === 1 && colCount >= 2 && colCount <= 8) return true;
    
    return false;
  }

  function getExcelColumnName(colIndex) {
    let columnName = "";
    let dividend = colIndex + 1;

    while (dividend > 0) {
      let modulo = (dividend - 1) % 26;
      columnName = String.fromCharCode(65 + modulo) + columnName;
      dividend = Math.floor((dividend - modulo) / 26);
    }

    return columnName;
  }

  async function fetchAllSheetsData(sheets, concurrency = 4) {
  const results = [];
  const queue = [...sheets];
  
  async function worker() {
    while (queue.length) {
      const sheet = queue.shift();
      try {
        const data = await sheet.getSummaryDataAsync();
        results.push({ sheet, data, error: null });
      } catch (err) {
        results.push({ sheet, data: null, error: err });
      }
    }
  }
  
  const workers = Array(concurrency).fill().map(() => worker());
  await Promise.all(workers);
  return results;
}

  /* ── Range tracker ────────────────────────────────────────────────────── */
  function makeRangeTracker() {
    let minR = Infinity, minC = Infinity, maxR = 0, maxC = 0;
    return {
      update(r, c) {
        if (r < minR) minR = r;
        if (c < minC) minC = c;
        if (r > maxR) maxR = r;
        if (c > maxC) maxC = c;
      },
      toRange() {
        return {
          s: { r: minR === Infinity ? 0 : minR, c: minC === Infinity ? 0 : minC },
          e: { r: maxR, c: maxC },
        };
      },
    };
  }

  /* ── Color Helper Functions ──────────────────────────────────────────── */
  function getCategoryColor(value) {
    const palette = [
      "FFD9EAD3", "FFD0E0E3", "FFFCE5CD", "FFEAD1DC", "FFD9D2E9",
      "FFCFE2F3", "FFF4CCCC", "FFE6E6E6", "FFD9F2E6", "FFFFF2CC"
    ];

    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = ((hash << 5) - hash) + value.charCodeAt(i);
      hash |= 0;
    }

    return palette[Math.abs(hash) % palette.length];
  }

  function isNumeric(value) {
    if (value === null || value === undefined) return false;
    
    const cleaned = String(value)
      .replace(/,/g, "")
      .replace(/%/g, "")
      .trim();
    
    return cleaned !== "" && !isNaN(Number(cleaned));
  }

  // Enhanced function: Check if a column should skip conditional formatting
  function shouldSkipConditionalFormatting(columnName, value, fieldRole = null) {
    if (!columnName) return false;
    
    const lowerColName = columnName.toLowerCase();
    
    // Keywords that suggest categorical/time/geo data (not for conditional formatting)
    const categoricalKeywords = [
      'year', 'quarter', 'month', 'date', 'time', 
      'category', 'region', 'product', 'name', 'id',
      'country', 'city', 'state', 'department', 'type',
      'status', 'group', 'segment', 'class'
    ];
    
    // Geographic keywords that should NEVER have conditional formatting
    const geoKeywords = [
      'latitude', 'lat', 'latitud', 'ycoord', 'y_coord',
      'longitude', 'long', 'lon', 'longitud', 'xcoord', 'x_coord',
      'location', 'geo', 'geography', 'coordinates', 'coords',
      'postal', 'zip', 'zipcode', 'postcode', 'address'
    ];
    
    // Check for geographic fields first (highest priority)
    for (const keyword of geoKeywords) {
      if (lowerColName.includes(keyword)) {
        return true;
      }
    }
    
    // Check column name against categorical keywords
    for (const keyword of categoricalKeywords) {
      if (lowerColName.includes(keyword)) {
        return true;
      }
    }
    
    // Check for latitude/longitude patterns (e.g., values between -90 to 90 or -180 to 180)
    if (value !== undefined && value !== null) {
      const strValue = String(value).trim();
      const numValue = parseFloat(strValue);
      
      if (!isNaN(numValue)) {
        // Check for latitude range (-90 to 90)
        if (lowerColName.includes('lat') && numValue >= -90 && numValue <= 90) {
          return true;
        }
        
        // Check for longitude range (-180 to 180)
        if (lowerColName.includes('lon') && numValue >= -180 && numValue <= 180) {
          return true;
        }
        
        // Generic check: if column has "lat" or "lon" anywhere in name
        if (lowerColName.match(/lat/i) && numValue >= -90 && numValue <= 90) {
          return true;
        }
        
        if (lowerColName.match(/lon/i) && numValue >= -180 && numValue <= 180) {
          return true;
        }
      }
      
      // Check if the first few values look like years (4-digit numbers between 1900-2100)
      if (/^\d{4}$/.test(strValue)) {
        const yearNum = parseInt(strValue, 10);
        if (yearNum >= 1900 && yearNum <= 2100) {
          return true; // Skip conditional formatting for years
        }
      }
    }
    
    return false;
  }

  // Check if a value looks like a geographic coordinate (latitude/longitude)
  function isGeographicCoordinate(value, columnName) {
    if (!isNumeric(value)) return false;
    
    const lowerColName = columnName.toLowerCase();
    const numValue = parseFloat(String(value).trim());
    
    // Check by column name first
    if (lowerColName.includes('latitude') || lowerColName.includes('lat')) {
      return numValue >= -90 && numValue <= 90;
    }
    
    if (lowerColName.includes('longitude') || lowerColName.includes('lon')) {
      return numValue >= -180 && numValue <= 180;
    }
    
    // Check by value range (less reliable, but helpful)
    if (numValue >= -90 && numValue <= 90 && (lowerColName.includes('coord') || lowerColName.includes('geo'))) {
      return true;
    }
    
    if ((numValue >= -180 && numValue <= -90) || (numValue >= 90 && numValue <= 180)) {
      if (lowerColName.includes('coord') || lowerColName.includes('geo')) {
        return true;
      }
    }
    
    return false;
  }

  // Modified function to check if a column is numeric AND suitable for conditional formatting
  function isNumericForFormatting(value, columnName) {
    if (!isNumeric(value)) return false;
    
    // Additional check: if the numeric value looks like a year, treat as categorical
    if (columnName) {
      const strValue = String(value).trim();
      if (/^\d{4}$/.test(strValue)) {
        const yearNum = parseInt(strValue, 10);
        if (yearNum >= 1900 && yearNum <= 2100) {
          return false;
        }
      }
      
      // Check for geographic coordinates
      if (isGeographicCoordinate(value, columnName)) {
        return false;
      }
    }
    
    return true;
  }

  function getZeroCenteredColor(value, maxAbs) {
    if (maxAbs === 0) {
      return "FFFFFF";
    }
    
    const intensity = Math.min(Math.abs(value) / maxAbs, 1);
    
    let r = 255;
    let g = 255;
    let b = 0;
    
    if (value > 0) {
      r = Math.round(255 * (1 - intensity));
      g = 255;
      b = Math.round(100 * (1 - intensity));
    } else if (value < 0) {
      r = 255;
      g = Math.round(255 * (1 - intensity));
      b = Math.round(100 * (1 - intensity));
    }
    
    return (
      "FF" +
      r.toString(16).padStart(2, "0") +
      g.toString(16).padStart(2, "0") +
      b.toString(16).padStart(2, "0")
    ).toUpperCase();
  }

  // Modified conditional formatting function - now skips geographic and categorical/time columns
  function applyConditionalFormattingToTable(worksheet, rows, headers, startRow, startCol, colWidths) {
    headers.forEach((header, colIndex) => {
      const columnName = header.fieldName || header.fieldId || `Column_${colIndex + 1}`;
      const firstValue = rows[0]?.[colIndex]?.formattedValue || rows[0]?.[colIndex]?.value;
      
      // Check if this column should skip conditional formatting
      let shouldSkip = shouldSkipConditionalFormatting(columnName, firstValue);
      
      if (shouldSkip) {
        return;
      }
      
      const numericValues = [];
      
      rows.forEach(row => {
        const value = row[colIndex]?.formattedValue || row[colIndex]?.value;
        if (isNumericForFormatting(value, columnName)) {
          let numValue = String(value).replace(/,/g, "").replace(/%/g, "");
          numericValues.push(parseFloat(numValue));
        }
      });
      
      if (numericValues.length === 0) return;
      
      const maxAbs = Math.max(...numericValues.map(v => Math.abs(v)));
      
      rows.forEach((row, rowIndex) => {
        const rawValue = row[colIndex]?.formattedValue || row[colIndex]?.value;
        
        if (!isNumericForFormatting(rawValue, columnName)) return;
        
        let numValue = String(rawValue).replace(/,/g, "").replace(/%/g, "");
        const value = parseFloat(numValue);
        
        const excelRow = startRow + rowIndex;
        const excelCol = startCol + colIndex;
        const cell = worksheet.getCell(excelRow + 1, excelCol + 1);
        
        const color = getZeroCenteredColor(value, maxAbs);
        
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: color }
        };
      });
    });
  }

  /* ── Filter Extraction - Get filter values per filter field ───────────── */
//   async function extractFilterValuesPerField(sheets, dashboard) {
//   const filterMap = new Map();
//   const ignoredFields = ["Measure Names", "Measure Values"];

//   // ── STEP 1: Build whitelist from dashboard.objects using param ──
//   const visualFilterZones = (dashboard.objects || [])
//     .filter(obj => obj.type === "filter" || obj.type === "parameter");

//   // Normalised whitelist: store actual field name as value
//   const visualFilterNames = new Set();

//   for (const obj of visualFilterZones) {
//     let fieldName = null;
//     // Extract from param like '[none:Webinar Name:nk]'
//     if (obj.param) {
//       const match = obj.param.match(/\[none:([^:]+):/);
//       if (match && match[1]) {
//         fieldName = match[1].trim();
//       }
//     }
//     if (fieldName) {
//       const norm = fieldName.toLowerCase().replace(/[\s_\-\[\]()]/g, "");
//       visualFilterNames.add(norm);
//       console.log(`[Filters] Whitelist: "${fieldName}" (norm: "${norm}")`);
//     } else {
//       // Fallback to obj.name (unlikely, but safe)
//       const name = obj.name || "";
//       if (name) {
//         const norm = name.toLowerCase().replace(/[\s_\-\[\]()]/g, "");
//         visualFilterNames.add(norm);
//       }
//     }
//   }

//   console.log(`[Filters] Whitelist size: ${visualFilterNames.size}`);

//   function isVisualFilter(fieldName) {
//     if (visualFilterNames.size === 0) return true;
//     const normField = fieldName.toLowerCase().replace(/[\s_\-\[\]()]/g, "");
//     for (const zoneName of visualFilterNames) {
//       if (zoneName.includes(normField) || normField.includes(zoneName)) {
//         return true;
//       }
//     }
//     return false;
//   }

//   async function addFilterToMap(filter, sourceName) {
//     if (ignoredFields.includes(filter.fieldName) || /^Month\(/i.test(filter.fieldName)) {
//       return;
//     }
//     if (!isVisualFilter(filter.fieldName)) {
//       console.log(`[Filters] Skipping non-visual: "${filter.fieldName}"`);
//       return;
//     }

//     if (!filterMap.has(filter.fieldName)) {
//       filterMap.set(filter.fieldName, { values: new Set(), worksheetNames: new Set() });
//     }
//     const filterData = filterMap.get(filter.fieldName);
//     if (sourceName) filterData.worksheetNames.add(sourceName);

//     const filterTypeNormalized = String(filter.filterType || "").toLowerCase();

//     if (filterTypeNormalized === "categorical") {
//       let appliedValues = (filter.appliedValues || []).map(v => v.formattedValue);
//       if (appliedValues.length === 0 && typeof filter.getDomainAsync === "function") {
//         try {
//           const domain = await filter.getDomainAsync("relevant");
//           appliedValues = (domain.values || []).map(v => v.formattedValue);
//         } catch (e) {
//           console.warn(`[Filters] getDomainAsync failed for "${filter.fieldName}":`, e);
//         }
//       }
//       appliedValues.forEach(v => filterData.values.add(v));
//     } else if (filterTypeNormalized === "range") {
//       const value = (filter.minValue?.formattedValue || "") + " - " + (filter.maxValue?.formattedValue || "");
//       filterData.values.add(value);
//     } else if (filterTypeNormalized === "relative-date" || filterTypeNormalized === "relativedate") {
//       const anchor = filter.anchorDate?.formattedValue || "";
//       const period = filter.periodType || "";
//       const rangeType = filter.rangeType || "";
//       const rangeN = filter.rangeN !== undefined ? filter.rangeN : "";
//       let value;
//       if (rangeType && period) {
//         value = `${rangeType}${rangeN ? " " + rangeN : ""} ${period}`.trim();
//       } else if (anchor) {
//         value = `Anchor: ${anchor}`;
//       } else {
//         value = "Relative Date Filter (active)";
//       }
//       filterData.values.add(value);
//     } else if (filterTypeNormalized === "hierarchical") {
//       const appliedValues = (filter.appliedValues || []).map(v => {
//         if (v.formattedValue) return v.formattedValue;
//         if (Array.isArray(v.levels)) return v.levels.join(" > ");
//         return String(v.value ?? v);
//       });
//       appliedValues.forEach(v => filterData.values.add(v));
//     } else {
//       if (filter.appliedValues && filter.appliedValues.length > 0) {
//         const appliedValues = filter.appliedValues.map(v => v.formattedValue || String(v.value ?? v));
//         appliedValues.forEach(v => filterData.values.add(v));
//       } else {
//         filterData.values.add(filter.filterType);
//       }
//     }
//   }

//   // ── Dashboard-level filters ──
//   if (dashboard && typeof dashboard.getFiltersAsync === "function") {
//     try {
//       const dashboardFilters = await dashboard.getFiltersAsync();
//       console.log(`[Filters] dashboard.getFiltersAsync() returned ${dashboardFilters.length} filter(s)`);
//       for (const filter of dashboardFilters) {
//         await addFilterToMap(filter, null);
//       }
//     } catch (e) {
//       console.warn("[Filters] dashboard.getFiltersAsync() failed:", e);
//     }
//   }

//   // ── Worksheet-level filters (supplementary) ──
//   for (const worksheet of sheets) {
//     let filters = [];
//     try {
//       filters = await worksheet.getFiltersAsync();
//     } catch (e) {
//       console.warn(`Could not get filters for ${worksheet.name}:`, e);
//       continue;
//     }
//     for (const filter of filters) {
//       await addFilterToMap(filter, worksheet.name);
//     }
//   }

//   // ── Convert to plain object ──
//   const result = {};
//   for (const [fieldName, data] of filterMap.entries()) {
//     result[fieldName] = Array.from(data.values);
//   }
//   console.log("[Filters] Final map:", result);
//   return result;
// }


  
//   async function extractFilterValuesPerField(sheets, dashboard) {
//   const filterMap  = new Map();
//   const ignoredFields = ["Measure Names", "Measure Values"];

//   /*
//    * THE APPROACH THAT ACTUALLY WORKS
//    * ──────────────────────────────────
//    * Every previous attempt tried to build a whitelist from dashboard.objects
//    * properties (obj.param, obj.fieldId, obj.name). ALL of these fail because:
//    *   - obj.param   → TWB XML attribute, does NOT exist at runtime in the API
//    *   - obj.fieldId → not populated on DashboardObject in the Extensions API
//    *   - obj.name    → contains the SOURCE WORKSHEET name, not the field name
//    *
//    * The correct approach uses a different signal entirely:
//    *
//    * A DASHBOARD-LEVEL Quick Filter card is applied to MULTIPLE worksheets.
//    * A WORKSHEET-LEVEL background filter is applied to only ONE worksheet.
//    *
//    * So: collect ALL filters from ALL worksheets, count how many worksheets
//    * each field name appears on. Fields that appear on 2+ worksheets are
//    * dashboard-level Quick Filter cards. Fields on only 1 worksheet are
//    * background filters — skip them.
//    *
//    * EDGE CASE: a filter that only applies to one chart but is still a
//    * visible Quick Filter card. Handle this by also including any field
//    * returned by dashboard.getFiltersAsync() (when available).
//    *
//    * FALLBACK: if ALL fields appear on only 1 worksheet (simple dashboard
//    * with one chart), fall back to showing all filters rather than nothing.
//    */

//   // Step 1 — collect raw filters from every worksheet, tracking which
//   // worksheets each fieldName appears on
//   const fieldWorksheetCount = new Map(); // fieldName → Set of worksheet names

//   for (const worksheet of sheets) {
//     let filters = [];
//     try {
//       filters = await worksheet.getFiltersAsync();
//     } catch (e) {
//       console.warn(`[Filters] Could not get filters for ${worksheet.name}:`, e);
//       continue;
//     }

//     filters.forEach(filter => {
//       if (ignoredFields.includes(filter.fieldName)) return;
//       if (/^Month\(/i.test(filter.fieldName)) return;

//       if (!fieldWorksheetCount.has(filter.fieldName)) {
//         fieldWorksheetCount.set(filter.fieldName, new Set());
//       }
//       fieldWorksheetCount.get(filter.fieldName).add(worksheet.name);
//     });
//   }

//   // Step 2 — also collect from dashboard.getFiltersAsync if available
//   // These are always dashboard-level regardless of count
//   const dashboardLevelFields = new Set();

//   if (dashboard && typeof dashboard.getFiltersAsync === "function") {
//     try {
//       const dashFilters = await dashboard.getFiltersAsync();
//       dashFilters.forEach(f => {
//         if (!ignoredFields.includes(f.fieldName) && !/^Month\(/i.test(f.fieldName)) {
//           dashboardLevelFields.add(f.fieldName);
//         }
//       });
//       console.log(`[Filters] dashboard.getFiltersAsync() returned ${dashFilters.length} filter(s)`);
//     } catch (e) {
//       console.warn("[Filters] dashboard.getFiltersAsync() failed:", e);
//     }
//   }

//   // Step 3 — decide which fields are "visual" (dashboard Quick Filter cards)
//   // A field is visual if it appears on 2+ worksheets OR came from dashboard.getFiltersAsync
//   const allCounts = [...fieldWorksheetCount.values()].map(s => s.size);
//   const maxCount  = allCounts.length > 0 ? Math.max(...allCounts) : 0;

//   function isVisualFilter(fieldName) {
//     // Always visual if dashboard.getFiltersAsync confirmed it
//     if (dashboardLevelFields.has(fieldName)) return true;

//     const count = fieldWorksheetCount.get(fieldName)?.size || 0;

//     // If ALL fields appear on only 1 worksheet (single-chart dashboard),
//     // fall back to showing all — can't distinguish background from visual
//     if (maxCount <= 1) return true;

//     // Visual = appears on 2 or more worksheets
//     return count >= 2;
//   }

//   // Step 4 — re-iterate all worksheets and build the filter map
//   // using only visual filters
//   async function addFilterToMap(filter, sourceName) {
//     if (ignoredFields.includes(filter.fieldName) || /^Month\(/i.test(filter.fieldName)) return;
//     if (!isVisualFilter(filter.fieldName)) {
//       console.log(`[Filters] Skipping worksheet-level filter: "${filter.fieldName}" (${fieldWorksheetCount.get(filter.fieldName)?.size || 0} worksheet(s))`);
//       return;
//     }

//     if (!filterMap.has(filter.fieldName)) {
//       filterMap.set(filter.fieldName, { values: new Set(), worksheetNames: new Set() });
//     }
//     const filterData = filterMap.get(filter.fieldName);
//     if (sourceName) filterData.worksheetNames.add(sourceName);

//     const ft = String(filter.filterType || "").toLowerCase();

//     if (ft === "categorical") {
//       let vals = (filter.appliedValues || []).map(v => v.formattedValue);
//       if (vals.length === 0 && typeof filter.getDomainAsync === "function") {
//         try {
//           const domain = await filter.getDomainAsync("relevant");
//           vals = (domain.values || []).map(v => v.formattedValue);
//         } catch (e) {
//           console.warn(`[Filters] getDomainAsync failed for "${filter.fieldName}":`, e);
//         }
//       }
//       vals.forEach(v => filterData.values.add(v));
//     } else if (ft === "range") {
//       filterData.values.add(
//         (filter.minValue?.formattedValue || "") + " - " + (filter.maxValue?.formattedValue || "")
//       );
//     } else if (ft === "relative-date" || ft === "relativedate") {
//       const period    = filter.periodType || "";
//       const rangeType = filter.rangeType  || "";
//       const rangeN    = filter.rangeN !== undefined ? filter.rangeN : "";
//       const anchor    = filter.anchorDate?.formattedValue || "";
//       let value;
//       if (rangeType && period) value = `${rangeType}${rangeN ? " " + rangeN : ""} ${period}`.trim();
//       else if (anchor)         value = `Anchor: ${anchor}`;
//       else                     value = "Relative Date Filter (active)";
//       filterData.values.add(value);
//     } else if (ft === "hierarchical") {
//       (filter.appliedValues || []).forEach(v => {
//         filterData.values.add(
//           v.formattedValue || (Array.isArray(v.levels) ? v.levels.join(" > ") : String(v.value ?? v))
//         );
//       });
//     } else {
//       if (filter.appliedValues?.length > 0) {
//         filter.appliedValues.forEach(v => filterData.values.add(v.formattedValue || String(v.value ?? v)));
//       } else {
//         filterData.values.add(filter.filterType);
//       }
//     }
//   }

//   // Re-run all worksheets now with the visual guard active
//   for (const worksheet of sheets) {
//     let filters = [];
//     try { filters = await worksheet.getFiltersAsync(); }
//     catch (e) { continue; }
//     for (const filter of filters) {
//       await addFilterToMap(filter, worksheet.name);
//     }
//   }

//   const result = {};
//   for (const [fieldName, data] of filterMap.entries()) {
//     result[fieldName] = Array.from(data.values);
//   }
//   console.log("[Filters] Final map (multi-worksheet fields only):", result);
//   return result;
// }

  async function extractFilterValuesPerField(sheets, dashboard) {
  const filterMap = new Map();
  const ignoredFields = ["Measure Names", "Measure Values"];

  // ── Helper: extract values from a filter and add to map ──
  async function addFilterToMap(filter, sourceName) {
    if (ignoredFields.includes(filter.fieldName) || /^Month\(/i.test(filter.fieldName)) {
      return;
    }

    if (!filterMap.has(filter.fieldName)) {
      filterMap.set(filter.fieldName, { values: new Set(), worksheetNames: new Set() });
    }
    const filterData = filterMap.get(filter.fieldName);
    if (sourceName) filterData.worksheetNames.add(sourceName);

    const ft = String(filter.filterType || "").toLowerCase();

    if (ft === "categorical") {
      let vals = (filter.appliedValues || []).map(v => v.formattedValue);
      if (vals.length === 0 && typeof filter.getDomainAsync === "function") {
        try {
          const domain = await filter.getDomainAsync("relevant");
          vals = (domain.values || []).map(v => v.formattedValue);
        } catch (e) {
          // silent fail
        }
      }
      vals.forEach(v => filterData.values.add(v));
    } else if (ft === "range") {
      const min = filter.minValue?.formattedValue || filter.minValue?.value || "";
      const max = filter.maxValue?.formattedValue || filter.maxValue?.value || "";
      filterData.values.add(min + " - " + max);
    } else if (ft === "relative-date" || ft === "relativedate") {
      const period    = filter.periodType || "";
      const rangeType = filter.rangeType  || "";
      const rangeN    = filter.rangeN !== undefined ? filter.rangeN : "";
      const anchor    = filter.anchorDate?.formattedValue || "";
      let value;
      if (rangeType && period) {
        value = `${rangeType}${rangeN ? " " + rangeN : ""} ${period}`.trim();
      } else if (anchor) {
        value = `Anchor: ${anchor}`;
      } else {
        value = "Relative Date Filter (active)";
      }
      filterData.values.add(value);
    } else if (ft === "hierarchical") {
      (filter.appliedValues || []).forEach(v => {
        const val = v.formattedValue || (Array.isArray(v.levels) ? v.levels.join(" > ") : String(v.value ?? v));
        filterData.values.add(val);
      });
    } else {
      if (filter.appliedValues && filter.appliedValues.length > 0) {
        filter.appliedValues.forEach(v => {
          filterData.values.add(v.formattedValue || String(v.value ?? v));
        });
      } else {
        filterData.values.add(filter.filterType);
      }
    }
  }

  // ── STEP 1: Get authoritative list from dashboard.getFiltersAsync ──
  const dashboardFilterFields = new Set();

  if (dashboard && typeof dashboard.getFiltersAsync === "function") {
    try {
      const dashFilters = await dashboard.getFiltersAsync();
      dashFilters.forEach(f => {
        if (!ignoredFields.includes(f.fieldName) && !/^Month\(/i.test(f.fieldName)) {
          dashboardFilterFields.add(f.fieldName);
        }
      });
    } catch (e) {
      console.warn("[Filters] dashboard.getFiltersAsync() failed:", e);
    }
  }

  // ── STEP 2: Process filters ──
  if (dashboardFilterFields.size > 0) {
    // Fast path: use dashboard filter list – one loop over worksheets
    for (const worksheet of sheets) {
      let filters = [];
      try { filters = await worksheet.getFiltersAsync(); } catch (e) { continue; }
      for (const filter of filters) {
        if (ignoredFields.includes(filter.fieldName) || /^Month\(/i.test(filter.fieldName)) continue;
        if (!dashboardFilterFields.has(filter.fieldName)) continue; // skip non-dashboard
        await addFilterToMap(filter, worksheet.name);
      }
    }
  } else {
    // Fallback: single pass, collect and process all filters, but skip using heuristic

    // Heuristic patterns for hidden filters
    const hiddenPatterns = [
      /Action\s*\(/,
      /Tooltip\s*\(/,
      /Context\s*\(/,
    ];

    for (const worksheet of sheets) {
      let filters = [];
      try { filters = await worksheet.getFiltersAsync(); } catch (e) { continue; }
      for (const filter of filters) {
        if (ignoredFields.includes(filter.fieldName) || /^Month\(/i.test(filter.fieldName)) continue;
        const isHidden = hiddenPatterns.some(p => p.test(filter.fieldName));
        if (isHidden) {
          continue;
        }
        await addFilterToMap(filter, worksheet.name);
      }
    }
  }

  // ── Convert to plain object ──
  const result = {};
  for (const [fieldName, data] of filterMap.entries()) {
    result[fieldName] = Array.from(data.values);
  }
  return result;
}

  /* ── Check if worksheet is a filter value table ───────────────────────── */
  function isFilterValueWorksheet(sheetName, summaryData) {
    // Check by name pattern
    if (/filter[_\- ]?\d+/i.test(sheetName) || 
        /values[_\- ]?\d+/i.test(sheetName) ||
        /_filter_\d+/i.test(sheetName)) {
      return true;
    }
    
    // Check by data structure: if it has a single column with numeric values 1,2,3...
    if (summaryData && summaryData.columns && summaryData.columns.length === 1) {
      const firstColumnName = summaryData.columns[0]?.fieldName || "";
      if (firstColumnName === "Values" || firstColumnName === "VALUE") {
        return true;
      }
    }
    
    return false;
  }

  /* ── Write Individual Filter Value Table (Simple format) ──────────────── */
  // function writeIndividualFilterTable(worksheet, filterName, filterValues, originRow, originCol, rangeTracker) {
  //   let r = originRow;
  //   const C = originCol;
    
  //   // Clean up filter name
  //   let cleanName = filterName.replace(/_(Filter|filter)_\d+$/, '');
  //   cleanName = cleanName.replace(/_(Values|values)_\d+$/, '');
    
  //   // Title row
  //   titleCell(worksheet, r, C, `📋 ${cleanName}`);
  //   worksheet.mergeCells(r + 1, C + 1, r + 1, C + 2);
  //   rangeTracker.update(r, C);
  //   rangeTracker.update(r, C + 1);
  //   r++;
    
  //   // Header row
  //   tableHeaderCell(worksheet, r, C, "SELECTED VALUE(S)");
  //   rangeTracker.update(r, C);
  //   r++;
    
  //   // Filter values as rows
  //   const values = Array.isArray(filterValues) ? filterValues : [filterValues];
  //   values.forEach((value, idx) => {
  //     tableDataCell(worksheet, r + idx, C, value, idx);
  //     rangeTracker.update(r + idx, C);
  //   });
    
  //   return 2 + values.length;
  // }
  function writeIndividualFilterTable(worksheet, filterName, filterValues, originRow, originCol, rangeTracker) {
    let r = originRow;
    const C = originCol;

    // Clean up filter name
    let cleanName = filterName.replace(/_(Filter|filter)_\d+$/, '');
    cleanName = cleanName.replace(/_(Values|values)_\d+$/, '');

    // ── Title row ──
    titleCell(worksheet, r, C, `📋 ${cleanName}`);
    rangeTracker.update(r, C);
    r++;

    // ── Header row ──
    tableHeaderCell(worksheet, r, C, "SELECTED VALUE(S)");
    rangeTracker.update(r, C);
    r++;

    // ── Filter value rows with optional row grouping ────────────────────────
    //
    // Filter tables can have many values — e.g. a "Webinar Name" filter with
    // 50 webinar options. Without grouping, this pushes all other tables down
    // by 50 rows, breaking the layout exactly like regular tables do.
    //
    // We apply the same expand/collapse logic as writeRegularTable:
    //   - First ROW_GROUP_THRESHOLD values are always visible
    //   - Values beyond the threshold are grouped (outlineLevel=1, hidden=true)
    //   - A note row tells the user how many values are hidden
    //
    const values       = Array.isArray(filterValues) ? filterValues : [filterValues];
    const totalValues  = values.length;
    const needsGrouping = totalValues > ROW_GROUP_THRESHOLD;

    values.forEach((value, idx) => {
      tableDataCell(worksheet, r, C, value, idx);
      rangeTracker.update(r, C);

      // Group overflow values beyond the threshold — same logic as writeRegularTable
      if (needsGrouping && idx >= ROW_GROUP_THRESHOLD) {
        const excelRow     = worksheet.getRow(r + 1); // ExcelJS is 1-indexed
        excelRow.outlineLevel = 1;
        excelRow.hidden       = true;
      }

      r++;
    });

    // ── Note row (only when grouping is active) ─────────────────────────────
    // Sits OUTSIDE the group (no outlineLevel) so it is always visible even
    // when collapsed — tells the user exactly how many values are hidden.
    if (needsGrouping) {
      const hiddenCount = totalValues - ROW_GROUP_THRESHOLD;
      const noteText    = `${hiddenCount} values are hidden — use the row group controls [+] / [-] on the left to expand or collapse`;

      const noteCell = worksheet.getCell(r + 1, C + 1);
      noteCell.value = noteText;
      noteCell.font      = { italic: true, size: 10, color: { argb: "FF888888" } };
      noteCell.alignment = { horizontal: "left", vertical: "center" };
      noteCell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };

      rangeTracker.update(r, C);

      // Set outline properties so [+] button appears ABOVE the group
      // (next to the visible values, not buried below hidden ones)
      worksheet.properties.outlineProperties = {
        summaryBelow: false,
        summaryRight: false,
      };

      r++;
    }

    return r - originRow;
  }
  /* ── ExcelJS Cell Styling Functions ───────────────────────────────────── */
  function setCellValue(worksheet, row, col, value, options = {}) {
    const cell = worksheet.getCell(row + 1, col + 1);
    
    if (typeof value === 'number') {
      cell.value = value;
    } else {
      cell.value = value;
    }
    
    cell.font = {
      bold: options.bold || false,
      size: options.size || 11,
      name: 'Calibri',
      italic: options.italic || false
    };
    
    if (options.color) {
      cell.font.color = { argb: options.color };
    }
    
    cell.alignment = {
      vertical: 'center',
      horizontal: options.align || 'left',
      wrapText: options.wrapText || false
    };
    
    if (options.bgColor) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: options.bgColor }
      };
    }
    
    if (options.border) {
      cell.border = options.border;
    }
  }

  const thinBorder = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' }
  };
  
  const thickBorder = {
    top: { style: 'medium' },
    left: { style: 'medium' },
    bottom: { style: 'medium' },
    right: { style: 'medium' }
  };

  function dashboardTitleCell(worksheet, row, col, value) {
    setCellValue(worksheet, row, col, value, {
      bold: true,
      size: 18,
      color: "FF1A73E8",
      align: "center",
      border: thickBorder
    });
  }

  function subtitleCell(worksheet, row, col, value) {
    setCellValue(worksheet, row, col, value, {
      bold: false,
      size: 11,
      color: "FF666666",
      align: "center"
    });
  }

  function titleCell(worksheet, row, col, value) {
    setCellValue(worksheet, row, col, value, {
      bold: true,
      size: 12,
      bgColor: "FFE8F0FE",
      align: "center",
      border: thickBorder
    });
  }

  function kpiLabelCell(worksheet, row, col, value) {
    setCellValue(worksheet, row, col, value, {
      bold: true,
      size: 11,
      bgColor: "FFF5F5F5",
      align: "left",
      border: thinBorder
    });
  }

  function kpiValueCell(worksheet, row, col, value) {
    let color = null;
    const valueStr = String(value);
    if (valueStr.includes('%')) {
      const numMatch = valueStr.match(/([+-]?\d+(?:\.\d+)?)/);
      if (numMatch) {
        const num = parseFloat(numMatch[1]);
        if (num > 0) color = "FF00AA00";
        if (num < 0) color = "FFFF0000";
      }
    }
    setCellValue(worksheet, row, col, value, {
      bold: true,
      size: 12,
      align: "right",
      color: color,
      border: thinBorder
    });
  }

  function tableHeaderCell(worksheet, row, col, value) {
    setCellValue(worksheet, row, col, value, {
      bold: true,
      size: 11,
      bgColor: "FF1A73E8",
      color: "FFFFFFFF",
      align: "center",
      border: thinBorder,
      wrapText: true
    });
  }

  function tableDataCell(worksheet, row, col, value, rowIndex = 0) {
    const bgColor = (rowIndex % 2 === 0) ? null : "FFF9F9F9";
    setCellValue(worksheet, row, col, value, {
      align: "left",
      size: 11,
      bgColor: bgColor,
      border: thinBorder,
      wrapText: true
    });
  }

  function writeDashboardTitle(worksheet, dashboardName, exportDate, originRow, originCol, rangeTracker) {
    let r = originRow;
    const C = originCol;
    
    dashboardTitleCell(worksheet, r, C, dashboardName);
    worksheet.mergeCells(r + 1, C + 1, r + 1, C + 5);
    rangeTracker.update(r, C);
    rangeTracker.update(r, C + 4);
    r++;
    
    subtitleCell(worksheet, r, C, `Exported on: ${exportDate}`);
    worksheet.mergeCells(r + 1, C + 1, r + 1, C + 5);
    rangeTracker.update(r, C);
    rangeTracker.update(r, C + 4);
    r++;
    
    r++;
    
    return r - originRow;
  }

  function buildLayoutMap(dashboardObjects) {
    const map = new Map();
    
    const positionableObjects = (dashboardObjects || []).filter(
      (obj) => (obj.type === "worksheet" || obj.type === "filter" || obj.type === "parameter") &&
               obj.position &&
               typeof obj.position.x === "number" &&
               typeof obj.position.y === "number"
    );

    if (positionableObjects.length === 0) return map;

    let minX = Infinity, minY = Infinity;
    positionableObjects.forEach((obj) => {
      if (obj.position.x < minX) minX = obj.position.x;
      if (obj.position.y < minY) minY = obj.position.y;
    });

    positionableObjects.forEach((obj) => {
      const px = obj.position;
      const gridCol = Math.round((px.x - minX) / PX_PER_COL);
      const gridRow = Math.round((px.y - minY) / PX_PER_ROW);
      const gridW = Math.max(2, Math.round((px.width || 180) / PX_PER_COL));
      const gridH = Math.max(3, Math.round((px.height || 60) / PX_PER_ROW));
      
      let displayName = "";
      if (obj.type === "worksheet") {
        displayName = (obj.title && obj.title.trim()) ? obj.title.trim() : obj.name;
      } else {
        displayName = (obj.name || "Filter").replace(/[_-]/g, " ");
      }

      map.set(obj.name || `filter_${gridRow}_${gridCol}`, {
        type: obj.type,
        gridRow: Math.max(0, gridRow),
        gridCol: Math.max(0, gridCol),
        gridW,
        gridH,
        displayName,
        originalName: obj.name
      });
    });

    return map;
  }

  function writeKPICardStacked(worksheet, visualName, columns, dataRow, originRow, originCol, rangeTracker) {
    let r = originRow;
    const C = originCol;
    
    titleCell(worksheet, r, C, visualName);
    worksheet.mergeCells(r + 1, C + 1, r + 1, C + 2);
    rangeTracker.update(r, C);
    rangeTracker.update(r, C + 1);
    r++;
    
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const cell = dataRow[i];
      
      let label = col.fieldName || col.fieldId || `Metric ${i + 1}`;
      label = label.replace(/^(SUM|AVG|COUNT|MIN|MAX|ATTR)_/gi, '');
      
      const value = cell?.formattedValue ?? (cell?.value !== undefined ? String(cell.value) : "—");
      
      kpiLabelCell(worksheet, r + i, C, label);
      kpiValueCell(worksheet, r + i, C + 1, value);
      
      rangeTracker.update(r + i, C);
      rangeTracker.update(r + i, C + 1);
    }
    
    return 1 + columns.length;
  }

  function writeRegularTable(worksheet, visualName, columns, rows, originRow, originCol, rangeTracker, tableIndex, allTablesInfo) {
    let r = originRow;
    const C = originCol;
    const numCols = columns.length;

    /* ── Title row ── */
    titleCell(worksheet, r, C, visualName);
    if (numCols > 1) {
      worksheet.mergeCells(r + 1, C + 1, r + 1, C + numCols);
    }
    rangeTracker.update(r, C);
    rangeTracker.update(r, C + numCols - 1);
    r++;

    /* ── Header row ── */
    const headerRow = r;
    columns.forEach((col, ci) => {
      let headerName = col.fieldName || col.fieldId || `Col${ci + 1}`;
      headerName = headerName.replace(/^(SUM|AVG|COUNT|MIN|MAX|ATTR)_/gi, '');
      tableHeaderCell(worksheet, r, C + ci, headerName);
      rangeTracker.update(r, C + ci);
    });
    r++;

    /* ── Data rows with optional row grouping ──────────────────────────────
     *
     * HOW ROW GROUPING WORKS IN EXCEL
     * ─────────────────────────────────
     * Excel supports "outline" grouping on rows. When rows are grouped:
     *   - A small [+] / [−] button appears on the left margin
     *   - Clicking [+] expands the group to show all rows
     *   - Clicking [−] collapses it back to hide overflow rows
     *   - The group can be set to collapsed by default
     *
     * We use outlineLevel = 1 (first/only level of grouping).
     * The first ROW_GROUP_THRESHOLD data rows are always visible (no grouping).
     * Rows beyond the threshold get outlineLevel = 1 + hidden = true.
     *
     * VISUAL RESULT
     * ─────────────
     * Table: Top 10 Salesperson (50 rows, threshold = 8)
     *
     *   [+] ▼ Title: Top 10 Salesperson
     *        │ Sales Person  │ SUM(Amount)  │
     *        │ Brien Boise   │ 305,490      │  ← row 1 (always visible)
     *        │ Van Tuxwell   │ 298,622      │  ← row 2 (always visible)
     *        │ ...           │ ...          │  ← rows 3-8 (always visible)
     *    [+] │ [+] 42 more rows — click [+] to expand
     *        │
     *       Next table starts here immediately — layout preserved ✓
     *
     * WHY THIS FIXES THE LAYOUT
     * ──────────────────────────
     * The collapsed rows take up ZERO height in Excel's visible layout.
     * So a 50-row table only occupies (threshold + 2) rows visually.
     * Charts and tables placed below it stay at their correct positions.
     *
     * ──────────────────────────────────────────────────────────────────── */
    const dataStartRow = r;
    const totalRows    = rows.length;
    const needsGrouping = totalRows > ROW_GROUP_THRESHOLD;

    rows.forEach((row, rowIdx) => {
      /* Write all cell values — same as before */
      row.forEach((cell, ci) => {
        const value = cell.formattedValue ?? (cell.value !== undefined ? String(cell.value) : "");
        tableDataCell(worksheet, r, C + ci, value, rowIdx);
        rangeTracker.update(r, C + ci);
      });

      /*
       * Apply row grouping for overflow rows (beyond the threshold).
       * outlineLevel: 1  — first (and only) level of grouping
       * hidden: true     — collapsed by default when file opens
       *
       * We do NOT group the first ROW_GROUP_THRESHOLD rows — they
       * are always visible so the user immediately sees data.
       */
      if (needsGrouping && rowIdx >= ROW_GROUP_THRESHOLD) {
        const excelRow = worksheet.getRow(r + 1); // ExcelJS is 1-indexed
        excelRow.outlineLevel = 1;
        excelRow.hidden       = true;
      }

      r++;
    });

    /*
     * If rows were grouped, add a single "summary note" row immediately
     * after the always-visible rows. This tells the user that more rows
     * exist and how to see them.
     *
     * The note row sits INSIDE the group (outlineLevel = 1, hidden = true)
     * so it only appears when the group is expanded — it doesn't clutter
     * the collapsed view.
     *
     * When collapsed, the user sees:
     *   Row 1-8: always visible data
     *   [+] ← the expand button on the left margin
     *   (next table starts here)
     */
    if (needsGrouping) {
      const hiddenCount  = totalRows - ROW_GROUP_THRESHOLD;
      // const noteText     = `▼ ${hiddenCount} more rows hidden — click [+] on the left to expand all ${totalRows} rows`;
      const noteText = `${hiddenCount} rows are hidden — use the row group controls [+] / [-] on the left to expand or collapse`;
      /* Write the note across all columns, merged */
      const noteCell = worksheet.getCell(r + 1, C + 1);
      noteCell.value = noteText;
      noteCell.font  = { italic: true, size: 10, color: { argb: "FF888888" } };
      noteCell.alignment = { horizontal: "left", vertical: "center" };
      noteCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };

      if (numCols > 1) {
        worksheet.mergeCells(r + 1, C + 1, r + 1, C + numCols);
      }

      rangeTracker.update(r, C);

      /*
       * The note row is NOT grouped — it stays visible when collapsed
       * so the user knows there are hidden rows. This is important UX:
       * without it, the user wouldn't know the table was truncated.
       */
      r++;
    }

    /* ── Apply conditional formatting to all data rows ── */
    applyConditionalFormattingToTable(worksheet, rows, columns, dataStartRow, C, {});

    /* ── Set worksheet outline settings ────────────────────────────────────
     *
     * summaryBelow: false — puts the [+] button ABOVE the group
     *   (so the expand button appears next to the always-visible rows,
     *    not below the hidden rows — more intuitive)
     *
     * summaryRight: false — [+] button on the left (Excel standard)
     */
    if (needsGrouping) {
      worksheet.properties.outlineProperties = {
        summaryBelow: false,
        summaryRight: false,
      };
    }

    if (allTablesInfo) {
      allTablesInfo.push({
        name: visualName,
        headerRow: headerRow,
        leftCol: C,
        rightCol: C + numCols - 1,
        bottomRow: r - 1
      });
    }

    return r - originRow;
  }

  /*
   * resolveCollisions(zones)
   * ═══════════════════════════════════════════════════════════════════════
   *
   * WHAT THIS FUNCTION DOES
   * ────────────────────────
   * After all items are given grid positions (row, col) from the Tableau
   * layout, some items may still overlap each other. This happens because
   * the pixel-to-grid conversion is approximate. This function scans for
   * every overlap and fixes it so no two items ever share the same cells.
   *
   * THE 5 BUGS THIS REPLACES
   * ─────────────────────────
   * Bug 1 — Bucket size of /5 merged unrelated rows
   *   Math.round(row / 5) * 5 put rows 0, 1, 2, 3, 4 all into bucket 0.
   *   Items from different rows got top-aligned onto each other.
   *   FIX: Use exact gridRow as the bucket key — only items truly at the
   *   same row are grouped together.
   *
   * Bug 2 — allocatedRows used raw data row count, not visual height
   *   A 50-row table with ROW_GROUP_THRESHOLD=8 visually takes only 10 rows
   *   (title + header + 8 visible + note). But allocatedRows was set to 52
   *   (the full raw count). resolveCollisions thought the table was 52 rows
   *   tall and pushed the next item down by 52 rows, leaving a massive gap.
   *   FIX: Compute visualHeight = min(rowCount, threshold + 3) for grouped
   *   tables. Use this for all spacing calculations.
   *
   * Bug 3 — Vertical push only checked adjacent group pairs
   *   After pushing group 2 down to clear group 1, it never rechecked
   *   whether group 2 now overlaps group 3. A chain of 3+ stacked items
   *   would only get the first pair fixed.
   *   FIX: After sorting all groups by row, run vertical push in a loop
   *   that propagates cascading pushes all the way down the chain.
   *
   * Bug 4 — Horizontal packing only within same bucket
   *   Two items from different row buckets placed side by side in the
   *   Tableau dashboard (e.g. a KPI and a table at slightly different
   *   pixel Y values) would never get their horizontal overlap checked.
   *   FIX: After placing all groups, do a full pairwise overlap scan
   *   across ALL items regardless of bucket.
   *
   * Bug 5 — currentRow offset applied AFTER collision resolution
   *   The dashboard title occupies the first N rows. All items are offset
   *   by this amount via adjustedItems AFTER resolveCollisions has already
   *   run. So collisions were checked on the wrong (pre-offset) coordinates.
   *   FIX: resolveCollisions works on the same 0-based grid coordinates
   *   used by placedItems — the offset is applied uniformly to all items
   *   so relative positions (and therefore collision checks) are correct.
   *   No change needed here — documenting so this is not broken again.
   */
  function resolveCollisions(zones) {
  if (!zones || zones.length === 0) return zones;

  // function getVisualHeight(zone) {
  //   // If the item is a regular table, we cap its height if it has many rows.
  //   if (zone.type === "worksheet" && !zone.isKPI) {
  //     // Prefer allocatedRows (set from rowCount), fallback to raw rowCount.
  //     const rawRows = zone.allocatedRows || zone.rowCount || 5;
  //     if (rawRows > ROW_GROUP_THRESHOLD + 2) {
  //       // Title + header + visible rows + note
  //       return ROW_GROUP_THRESHOLD + 3;
  //     }
  //     return rawRows;
  //   }
  //   // For filterValue and KPI items, use allocatedRows or rowCount.
  //   return zone.allocatedRows || zone.rowCount || 5;
  // }

  function getVisualHeight(zone) {
    return (zone.allocatedRows || zone.rowCount || 5) + ROW_GAP;
  }

  // ── Group by exact gridRow ──
  const rowGroups = new Map();
  zones.forEach(zone => {
    const key = zone.gridRow;
    if (!rowGroups.has(key)) rowGroups.set(key, []);
    rowGroups.get(key).push(zone);
  });

  // ── Horizontal packing within each group ──
  const processedGroups = [];
  for (const [, group] of rowGroups) {
    group.sort((a, b) => a.gridCol - b.gridCol);
    const minRow = Math.min(...group.map(z => z.gridRow));
    group.forEach(z => { z.gridRow = minRow; });
    let cursor = group[0].gridCol;
    for (const item of group) {
      if (item.gridCol < cursor) item.gridCol = cursor;
      cursor = item.gridCol + item.gridW + COL_GAP;
    }
    const groupBottom = minRow
      + Math.max(...group.map(z => getVisualHeight(z)))
      + ROW_GAP;
    processedGroups.push({ minRow, items: group, bottom: groupBottom });
  }

  // ── Cascade vertical pushes ──
  processedGroups.sort((a, b) => a.minRow - b.minRow);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < processedGroups.length - 1; i++) {
      const upper = processedGroups[i];
      const lower = processedGroups[i + 1];
      let horizontalOverlap = false;
      for (const u of upper.items) {
        for (const l of lower.items) {
          const uLeft = u.gridCol, uRight = u.gridCol + u.gridW;
          const lLeft = l.gridCol, lRight = l.gridCol + l.gridW;
          if (uLeft < lRight && uRight > lLeft) {
            horizontalOverlap = true;
            break;
          }
        }
        if (horizontalOverlap) break;
      }
      if (horizontalOverlap && lower.minRow < upper.bottom) {
        const pushBy = upper.bottom - lower.minRow;
        lower.items.forEach(z => { z.gridRow += pushBy; });
        lower.minRow += pushBy;
        lower.bottom += pushBy;
        changed = true;
      }
    }
  }

  // ── Full pairwise scan ──
  let fullPassChanged = true;
  const MAX_PASSES = 20;
  let pass = 0;
  while (fullPassChanged && pass < MAX_PASSES) {
    fullPassChanged = false;
    pass++;
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        const a = zones[i];
        const b = zones[j];
        const upper = a.gridRow <= b.gridRow ? a : b;
        const lower = a.gridRow <= b.gridRow ? b : a;
        const upperBottom = upper.gridRow + getVisualHeight(upper) + ROW_GAP;
        const colOverlap = upper.gridCol < lower.gridCol + lower.gridW &&
                           upper.gridCol + upper.gridW > lower.gridCol;
        const rowOverlap = lower.gridRow < upperBottom;
        if (colOverlap && rowOverlap) {
          const pushBy = upperBottom - lower.gridRow;
          lower.gridRow += pushBy;
          fullPassChanged = true;
        }
      }
    }
  }

  

  return zones;
}

  function applyAutoFilters(worksheet, allTablesInfo) {
    if (!allTablesInfo || allTablesInfo.length === 0) return;
    
    allTablesInfo.forEach(table => {
      const startCol = getExcelColumnName(table.leftCol);
      const endCol = getExcelColumnName(table.rightCol);
      const filterRange = `${startCol}${table.headerRow + 1}:${endCol}${table.bottomRow + 1}`;
      worksheet.autoFilter = filterRange;
    });
    
  }

  function setColumnWidths(worksheet, colWidths) {
    const maxColIdx = Object.keys(colWidths).length > 0 ? Math.max(...Object.keys(colWidths).map(Number)) : 0;
    
    for (let ci = 0; ci <= maxColIdx; ci++) {
      const width = colWidths[ci] || 12;
      worksheet.getColumn(ci + 1).width = Math.min(width + 2, 50);
    }
  }

  /* ── Main Export Logic ───────────────────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", () => {
    tableau.extensions.initializeAsync().then(() => {
      const dashboard = tableau.extensions.dashboardContent.dashboard;
      const sheets = dashboard.worksheets;

      const exportBtn = document.getElementById("export_button");
      if (exportBtn) {
        exportBtn.addEventListener("click", exportToExcel);
      }

      async function exportToExcel() {
        const btn = document.getElementById("export_button");
        btn.disabled = true;

        try {
          // Extract filter values per field (NOT combined)
          const filterValuesMap = await extractFilterValuesPerField(sheets, dashboard);
          
          // Build layout map for positioning
          const layoutMap = buildLayoutMap(dashboard.objects || []);

          /*
           * BUILD VISIBILITY MAP — Dynamic Zone Visibility (DZV) support
           *
           * dashboard.objects gives us every zone on the dashboard, each with
           * an isVisible property that reflects the current DZV state.
           * We build a name → isVisible lookup so we can skip sheets that
           * the user has hidden via DZV before clicking Export.
           *
           * Only zones of type "worksheet" are included — we ignore text boxes,
           * images, containers, and other non-data zones.
           *
           * Sheets NOT in this map (undefined) are treated as visible — this
           * covers sheets that exist in dashboard.worksheets but have no
           * corresponding zone (e.g. hidden-tab sheets used for filter values).
           */
          const visibilityMap = {};
          (dashboard.objects || [])
            .filter(obj => obj.type === "worksheet")
            .forEach(obj => {
              visibilityMap[obj.name] = obj.isVisible;
            });

          
          // Separate: Filter value worksheets vs Real data worksheets
          const filterValueItems = [];  // Small filter value tables
          const dataWorksheetItems = []; // Real data tables and KPIs

          const allSheetsData = await fetchAllSheetsData(sheets);
          for (const { sheet, data, error } of allSheetsData) {
            if (error) {
              continue;
            }

            /*
             * DYNAMIC ZONE VISIBILITY CHECK
             *
             * If the author has used DZV to hide this worksheet right now,
             * skip it entirely — don't fetch data, don't write to Excel.
             *
             * visibilityMap[sheet.name] === false  → explicitly hidden by DZV
             * visibilityMap[sheet.name] === true   → visible, include it
             * visibilityMap[sheet.name] === undefined → not in dashboard.objects
             *                                          (treat as visible)
             *
             * We only skip on an explicit false — anything else is included.
             * This ensures dashboards without DZV are completely unaffected.
             */
            if (visibilityMap[sheet.name] === false) {
              continue;
            }
            
            const summaryData = data;  // use the data we already fetched
            if (!summaryData || !summaryData.columns || summaryData.columns.length === 0) continue;
            if (!summaryData.data || summaryData.data.length === 0) continue;

            if (!summaryData.columns || summaryData.columns.length === 0) continue;
            if (!summaryData.data || summaryData.data.length === 0) continue;

            const layout = layoutMap.get(sheet.name);
            const visualName = (layout && layout.displayName) ? layout.displayName : sheet.name;
            
            // Check if this is a filter value worksheet
            // if (isFilterValueWorksheet(sheet.name, summaryData)) {
            //   // This is a small filter table - find matching filter values
            //   let matchedFilterName = null;
            //   let matchedValues = null;
              
            //   // Try to match by name pattern
            //   for (const [filterField, values] of Object.entries(filterValuesMap)) {
            //     const cleanFilterField = filterField.toLowerCase().replace(/[^a-z]/g, '');
            //     const cleanSheetName = sheet.name.toLowerCase().replace(/[^a-z]/g, '');
                
            //     if (cleanSheetName.includes(cleanFilterField) || cleanFilterField.includes(cleanSheetName)) {
            //       matchedFilterName = filterField;
            //       matchedValues = values;
            //       break;
            //     }
            //   }
              
            //   // If no match found, use the sheet name as filter name
            //   if (!matchedValues) {
            //     matchedFilterName = visualName;
            //     matchedValues = [`Values: ${summaryData.data.length} items`];
            //   }
              
            //   filterValueItems.push({
            //     type: "filterValue",
            //     name: sheet.name,
            //     visualName: visualName,
            //     filterName: matchedFilterName,
            //     values: matchedValues,
            //     layout: layout,
            //     rowCount: 2 + (Array.isArray(matchedValues) ? matchedValues.length : 1),
            //     originalData: summaryData
            //   });
              
            //   console.log(`[Filter Table] "${visualName}" - ${matchedValues.length} filter values`);
            // } else {
            //   // This is a real data worksheet
            //   const isKPI = isKPICard(sheet, summaryData);
              
            //   let item = {
            //     name: sheet.name,
            //     visualName: visualName,
            //     layout: layout,
            //     isKPI: isKPI,
            //     type: "worksheet"
            //   };
              
            //   if (isKPI) {
            //     item.columns = summaryData.columns;
            //     item.dataRow = summaryData.data[0];
            //     item.rowCount = 1 + summaryData.columns.length;
            //     console.log(`[KPI] "${visualName}"`);
            //   } else {
            //     item.columns = summaryData.columns;
            //     item.rows = summaryData.data;
            //     item.rowCount = 2 + item.rows.length;
            //     console.log(`[Table] "${visualName}" - ${summaryData.columns.length} cols, ${item.rows.length} rows`);
            //   }
              
            //   dataWorksheetItems.push(item);
            // }

            // ── Skip filter‑value worksheets entirely ──
if (isFilterValueWorksheet(sheet.name, summaryData)) {
  continue; // do NOT add to filterValueItems or dataWorksheetItems
}

// ── This is a real data worksheet (KPI or table) ──
const isKPI = isKPICard(sheet, summaryData);

let item = {
  name: sheet.name,
  visualName: visualName,
  layout: layout,
  isKPI: isKPI,
  type: "worksheet"
};

if (isKPI) {
  item.columns = summaryData.columns;
  item.dataRow = summaryData.data[0];
  item.rowCount = 1 + summaryData.columns.length;
} else {
  item.columns = summaryData.columns;
  item.rows = summaryData.data;
  item.rowCount = 2 + item.rows.length;
}

dataWorksheetItems.push(item);
          }

          /*
           * STANDALONE APPLIED FILTERS — surface any filters that have NO
           * dedicated filter-value worksheet on the dashboard.
           *
           * Mokkup-generated dashboards (e.g. Wastewater) expose each filter as
           * its own worksheet named like "Customer Type Filter_5 Values 5", which
           * isFilterValueWorksheet() detects and renders. Normal hand-built
           * dashboards (e.g. Webinar) do NOT — their filters (Lead Source,
           * Webinar Host, Webinar Name, ...) are already fetched into
           * filterValuesMap but had no worksheet to attach to, so without this
           * block they would silently never appear in the export.
           *
           * We add one filter-value item per unmatched field. Items already
           * rendered via a filter worksheet are skipped (dedupe by filterName).
           */
          const alreadyShownFilters = new Set(filterValueItems.map(it => it.filterName));

          /*
           * Collect the filters that have NO dedicated worksheet / no real zone
           * location. These are the ones we position ourselves.
           */
          const standaloneEntries = [];
          for (const [filterField, values] of Object.entries(filterValuesMap)) {
            if (alreadyShownFilters.has(filterField)) continue;
            // Even if no values resolved (e.g. domain unavailable), still list the
            // filter name so the export shows the full set of active filters.
            const displayValues = (values && values.length > 0) ? values : ["(All)"];
            standaloneEntries.push({ filterField, displayValues, rowCount: 2 + displayValues.length });
          }

          if (standaloneEntries.length > 0) {
            /*
             * TOP PLACEMENT — when we don't have a real dashboard location for a
             * filter, show it as a filter bar across the TOP. We give the bar its
             * own band at row 0 and push all existing content down by the bar's
             * height so nothing overlaps and the original relative layout of the
             * data is preserved (just shifted down as a block).
             */
            const barHeight = Math.max(...standaloneEntries.map(e => e.rowCount)) + ROW_GAP;

            let fallbackRow = barHeight; // for any pre-existing item lacking a real zone
            for (const it of [...filterValueItems, ...dataWorksheetItems]) {
              if (it.layout && typeof it.layout.gridRow === "number") {
                // clone so we never mutate the shared layoutMap entry
                it.layout = { ...it.layout, gridRow: it.layout.gridRow + barHeight };
              } else {
                // no zone info at all → stack below the bar in a single column
                it.layout = {
                  gridRow: fallbackRow,
                  gridCol: 0,
                  gridW: it.isKPI ? 5 : 12,
                  gridH: it.rowCount || 6,
                  displayName: it.visualName || it.name
                };
                fallbackRow += (it.rowCount || 6) + ROW_GAP;
              }
            }

            /*
             * Synthetic layout for each filter — routes through the SAME
             * `if (item.layout)` placement branch the original filter tables use
             * (gridW clamps to a min of 3 there). Laid left-to-right at row 0;
             * resolveCollisions handles final horizontal spacing exactly as it
             * does for real dashboard-zoned items.
             */
            let standaloneCol = 0;
            for (const { filterField, displayValues, rowCount } of standaloneEntries) {
              filterValueItems.push({
                type: "filterValue",
                name: filterField,
                visualName: filterField,
                filterName: filterField,
                values: displayValues,
                layout: {
                  gridRow: 0,
                  gridCol: standaloneCol,
                  gridW: 4,
                  gridH: rowCount,
                  displayName: filterField
                },
                rowCount: rowCount,
                originalData: null
              });
              standaloneCol += 4 + COL_GAP;
            }
          }

          // Combine filter value tables and data worksheets
          const allItems = [...filterValueItems, ...dataWorksheetItems];
          
          if (allItems.length === 0) {
            throw new Error("No data found in any worksheet.");
          }

          // Position all items
          const placedItems = allItems.map((item, idx) => {
            if (item.layout) {
              const l = item.layout;
              let calculatedWidth = l.gridW;
              
              if (item.type === "filterValue") {
                calculatedWidth = Math.max(l.gridW, 3);
              } else if (item.isKPI) {
                calculatedWidth = Math.max(l.gridW, Math.min(6, item.columns.length + 1));
              } else {
                calculatedWidth = Math.max(l.gridW, Math.min(25, item.columns.length + 1));
              }
              
              return {
                ...item,
                gridRow: l.gridRow,
                gridCol: l.gridCol,
                gridW: calculatedWidth,
                allocatedRows: item.rowCount,
              };
            } else {
              // Default positioning
              const itemsPerRow = 3;
              const rowIdx = Math.floor(idx / itemsPerRow);
              const colIdx = idx % itemsPerRow;
              const gridRow = rowIdx * (Math.max(8, item.rowCount) + ROW_GAP);
              const gridCol = colIdx * 12;
              const gridW = (item.type === "filterValue") ? 4 : (item.isKPI ? 5 : 12);
              
              return {
                ...item,
                gridRow: gridRow,
                gridCol: gridCol,
                gridW: gridW,
                allocatedRows: item.rowCount,
              };
            }
          });

          resolveCollisions(placedItems);
          // SNAP-OUT-OF-GROUPED-ROWS PASS
// Ensures no item starts inside another item's collapsed hidden rows.
// Excel hides entire rows — so an item in column 5 is still hidden
// if its row is collapsed by a table in column 1.
let snapChanged = true;
const MAX_SNAP_PASSES = 10;
let snapPass = 0;

while (snapChanged && snapPass < MAX_SNAP_PASSES) {
  snapChanged = false;
  snapPass++;

  for (const item of placedItems) {
    for (const other of placedItems) {
      if (item === other) continue;

      // Only care about items that have row grouping (large tables)
      const otherTotal = other.allocatedRows || other.rowCount || 0;
      if (otherTotal <= ROW_GROUP_THRESHOLD + 2) continue;

      // Where 'other's always-visible rows end
      const otherVisibleEnd = other.gridRow + ROW_GROUP_THRESHOLD + 3;

      // Where 'other's physical rows end (including hidden grouped rows)
      const otherPhysicalEnd = other.gridRow + otherTotal + ROW_GAP;

      // If 'item' starts inside 'other's hidden row range — snap it out
      if (item.gridRow >= otherVisibleEnd && item.gridRow < otherPhysicalEnd) {
        item.gridRow = otherPhysicalEnd;
        snapChanged = true;
      }
    }
  }
}


          // Create Excel workbook
          const workbook = new ExcelJS.Workbook();
          const sheetName = (dashboard.name || "Dashboard Export")
            .replace(/[\\\/\*\?\[\]:]/g, "")
            .slice(0, 31);
          const worksheet = workbook.addWorksheet(sheetName);
          
          const colWidths = {};
          const allTablesInfo = [];
          const tracker = makeRangeTracker();

          let currentRow = 0;
          const dashboardName = dashboard.name || "Dashboard Export";
          const exportDate = new Date().toLocaleString();
          const titleHeight = writeDashboardTitle(worksheet, dashboardName, exportDate, currentRow, 0, tracker);
          currentRow += titleHeight;

          colWidths[0] = Math.max(colWidths[0] || 0, 30);
          colWidths[1] = Math.max(colWidths[1] || 0, 20);
          colWidths[2] = Math.max(colWidths[2] || 0, 20);
          colWidths[3] = Math.max(colWidths[3] || 0, 20);
          colWidths[4] = Math.max(colWidths[4] || 0, 20);
          
          const adjustedItems = placedItems.map(item => ({
            ...item,
            gridRow: item.gridRow + currentRow
          }));
          

          // Write all items
          for (let i = 0; i < adjustedItems.length; i++) {
            const item = adjustedItems[i];
            
            if (item.type === "filterValue") {
              // Write individual filter value table
              writeIndividualFilterTable(
                worksheet,
                item.filterName,
                item.values,
                item.gridRow,
                item.gridCol,
                tracker
              );
              colWidths[item.gridCol] = Math.max(colWidths[item.gridCol] || 0, 35);
            } else if (item.isKPI) {
              writeKPICardStacked(
                worksheet, 
                item.visualName, 
                item.columns, 
                item.dataRow, 
                item.gridRow, 
                item.gridCol, 
                tracker
              );
              colWidths[item.gridCol] = Math.max(colWidths[item.gridCol] || 0, 22);
              colWidths[item.gridCol + 1] = Math.max(colWidths[item.gridCol + 1] || 0, 18);
            } else {
              writeRegularTable(
                worksheet, 
                item.visualName, 
                item.columns, 
                item.rows, 
                item.gridRow, 
                item.gridCol, 
                tracker,
                i,
                allTablesInfo
              );
              item.columns.forEach((col, ci) => {
                const excelColIdx = item.gridCol + ci;
                const nameLength = (col.fieldName ? col.fieldName.length + 1 : 7);
                colWidths[excelColIdx] = Math.max(colWidths[excelColIdx] || 0, Math.min(35, nameLength));
              });
            }
          }

          setColumnWidths(worksheet, colWidths);
          applyAutoFilters(worksheet, allTablesInfo);

          // Generate and download
          const buffer = await workbook.xlsx.writeBuffer();

          const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          const blob = new Blob([buffer], { type: XLSX_MIME });

          /*
           * FILENAME RESOLUTION
           * ─────────────────────────────────────────────────────────────────
           * Default: dashboard name (sheetName) with .xlsx appended.
           * Example: "Sales Dashboard.xlsx"
           *
           * The browser Save dialog pre-fills this name. The user can change
           * "Sales Dashboard" to anything they want (e.g. "xyz") and click
           * Save — the file is saved as "xyz.xlsx" automatically.
           *
           * Why this works without extra code:
           * The OS Save dialog preserves the .xlsx extension shown in the
           * filename field. As long as we pass "Sales Dashboard.xlsx" as
           * link.download, the dialog shows "Sales Dashboard.xlsx" and the
           * user only needs to change the name part — the extension stays.
           *
           * Defensive strip: if sheetName somehow already contains an
           * extension (e.g. "Dashboard.twb"), we remove it first so we
           * never end up with "Dashboard.twb.xlsx".
           */
          const cleanName = sheetName
            .replace(/\.[^.]+$/, "")   // strip any existing extension
            .replace(/[\.\s]+$/, "")   // strip trailing dots or spaces
            .trim() || "Dashboard";    // fallback if name becomes empty

          const fname = `${cleanName}.xlsx`;

          /*
           * DOWNLOAD TRIGGER
           * append to body → required for Tableau Desktop embedded webview
           * removeChild after click → keeps DOM clean
           * setTimeout revoke → gives browser time to start download
           *   before freeing the object URL from memory
           */
          const link    = document.createElement("a");
          link.href     = URL.createObjectURL(blob);
          link.download = fname;
          link.style.display = "none";

          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          setTimeout(() => URL.revokeObjectURL(link.href), 10000);


        } catch (err) {
          alert("Export failed. Check console (F12) for details.\n\n" + err.message);
        } finally {
          btn.disabled = false;
        }
      }

    }).catch((err) => {
      alert("Failed to connect to Tableau: " + err.message);
      if (document.getElementById("export_button")) {
        document.getElementById("export_button").disabled = true;
      }
    });
  });

})();