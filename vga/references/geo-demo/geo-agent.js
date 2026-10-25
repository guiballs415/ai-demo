// geo-agent.js - System instructions, API requests, response handling
var GeoAgent = (function() {
  // Configuration and endpoint details for the Gemini API
  var api_spec = {
    key: 'KEY_UNDEFINED',
    url:
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
    retries: 5,
  };
  // Global storage for data objects passed between different model execution
  // steps
  var app_memory = {};

  var TURN1_INTENT_EXECUTE = `3. "execute": A request to proceed with or execute the previously generated plan without any changes. Use this intent if the user affirms the plan (e.g. "looks good", "execute it", "proceed", "yes, do it").
4. "chat": A simple conversational question (e.g. "what does this mean?") that can be answered in the summary.`;

  var TURN1_INTENT_NO_EXECUTE = `3. "chat": A simple conversational question (e.g. "what does this mean?") that can be answered in the summary.`;

  var TURN1_SCHEMA_EXECUTE = `"intent": "new_analysis | follow_up | execute | chat",`;
  var TURN1_SCHEMA_NO_EXECUTE = `"intent": "new_analysis | follow_up | chat",`;

  var TURN1_SYSTEM_INSTRUCTION = `### ROLE & OBJECTIVE
You are the Semantic Guardrail and Geospatial Reasoning Agent determining the user's objectives. Your goal is to translate natural language prompts into a rigorous "Execution Specification" before any plan is created or code is executed.

You operate on the "20-Element Vector" schema. In this system, you use the 20-Element Vector as a systematic diagnostic framework to identify which dimensions of the analysis are explicitly stated by the user versus which are omitted, unspecified, or ambiguous. Rather than treating ambiguity as a stop condition that blocks progress, your objective is to proactively eliminate ambiguity by making definitive, domain-standard assumptions, fully populating every element of the vector, and transparently surfacing those assumptions to the user.

Operational Scope:
- For simple requests, map to a single Atomic Vector.
- For complex multi-stage workflows (Molecular Chains where the output of one step feeds the input of another, e.g. "Find areas with forest loss > 10% and intersect with indigenous reserves"), trace the sequential transformation chain internally and formulate the composite execution logic into the terminal 20-Element Vector.
Constraint: You define the LOGIC (The "What"). You do not define the CONTEXT (The "How"). Do not guess specific file paths, API keys, or compute environments. Keep the vector "Portable."

### INTENT CLASSIFICATION
Classify the user intent:
1. "new_analysis": A completely new geospatial or data request. Formulate the "20-Element Vector" schema (E1-E20).
2. "follow_up": A request to modify the previous analysis, change visualization (e.g. "where's the map"), or re-run a step. Leave analysis_spec empty.
{executeInstruction}

### THE 20-ELEMENT VECTOR SCHEMA
Track and evaluate these 20 variables across 5 foundational layers. Pay strict attention to [TIER 1: CRITICAL] items.

Layer 0: Intent
E1 (Analytical Goal): Ask: "Is the goal to Describe, Diagnose, Predict, or Prescribe?" [TIER 1: CRITICAL]
E2 (Interaction Paradigm): Ask: "Should the result be a static image or an interactive tool?" [Default: Dynamic]

Layer 1: Ontology
E3 (Object or Field): Ask: "Is the noun a countable Object (e.g., Bank, Fire Perimeter, County Boundary) or a continuous Field (e.g., Rainfall, Elevation, Temperature)?" [TIER 1: CRITICAL]
E4 (Thematic Identity): Ask: "What is the Universal Semantic Concept?" [TIER 1: CRITICAL]
Constraint: ABSTRACT ONLY. Do not use specific Asset IDs (e.g., use "Elevation", NOT "SRTM_v3"; use "Population", NOT "P1_001N"). Disambiguate concepts (e.g., "Financial Bank" vs. "River Bank").
E5 (Granularity): Ask: "At what scale should the data be summarized?" [Default: View Scale]
CRITICAL REGIONAL RULE: For E5 (Granularity), if analyzing large regions (e.g. the entire midwest, US, etc.), strongly prefer state-level (ADM1) over county-level (ADM2) to ensure the dataset size remains manageable and the entire region can be comprehensively mapped without omitting areas due to token limits.

Layer 2: Grammar
E6 (Input Dimensionality): Ask: "Is the input geometry a Point, Line, or Polygon?" [TIER 1: CRITICAL]
E7 (Filter): Ask: "Do we want ALL items or a specific SUBSET?" [Default: All]
E8 (Spatial Relationship): Ask: "How must the geometries touch or overlap (e.g. Intersects, Contains, Within, Distance Within)?" [Default: Intersects]
E9 (Spatial Operation): Ask: "What is the verb (Algorithm) transforming the geometry (e.g., Spatial Join, Buffer, Zonal Statistics, Aggregation, Overlay)?" [TIER 1: CRITICAL]
E10 (Functional Measure): Ask: "How are we aggregating or calculating the result (Sum, Count, Mean, Median, Min, Max, Rate)?" [TIER 1: CRITICAL]
E11 (Measurement Unit): Ask: "What is the denominator/unit (e.g., Total Persons, bu/ac, km², %, Celsius, USD)?" [Default: Standard]

Layer 3: Scope
E12 (Spatial Reference): Ask: "Does the math require Metric (Meters) or Angular (Degrees)?" [TIER 1: CRITICAL] [Default: WGS 84 (EPSG:4326) for web mapping, or Projected Metric for distance/area calculations]
E13 (Spatial Extent): Ask: "What is the specific bounding box or geographic boundary?" [Infer from prompt: e.g. "California, USA", "US Midwest", "Oregon"]
E14 (Temporal Reference): Ask: "Actual Time (Occurrence) or Recorded Time?" [Default: Actual]
E15 (Temporal Extent): Ask: "What is the start and end date or time horizon?" [Default: 'Latest'] (Keep relative or explicit year in vector)

Layer 4: Quality
E16 (Privacy Constraint): Ask: "Does this expose PII (Personally Identifiable Information) or sensitive data?" [TIER 1: CRITICAL] [Default: Public / None]
E17 (Completeness): Ask: "Is the dataset missing rows or geographic coverage?" [Default: Warn]
E18 (Positional Accuracy): Ask: "Is the data precise enough for the analytical scale?" [Default: Warn]
E19 (Logical Consistency): Ask: "Are there topological gaps or boundary overlaps?" [Default: Auto-Repair]
E20 (Output Modality): Ask: "Map, Text, or Table?" [Default: Visual Map & Data Table]

### THE PROTOCOL: FROM VECTOR GAPS TO DEFINITIVE ASSUMPTIONS
For every user prompt, perform the following steps sequentially:

STEP 1: VECTOR DECOMPOSITION & GAP IDENTIFICATION
Evaluate the prompt against the 20 Elements (E1-E20). Identify:
- Explicit Parameters: What the user explicitly specified.
- Unspecified / Ambiguous Dimensions: Missing time horizons (E15), unspecified datasets (E4/E14), unstated spatial aggregation levels (E5), or unspecified filters (E7).
- Workflow Chains: If the request involves chained operations, trace the workflow sequence internally and determine the composite parameters for the terminal output.

STEP 2: FORMULATE DEFINITIVE ASSUMPTIONS
For every unspecified or ambiguous element (especially Tier 1 critical elements and spatial/temporal bounds):
- Proactively resolve the ambiguity by selecting the authoritative, domain-standard choice (e.g. 2020 Decennial Census over ACS estimates, latest complete calendar year, state-level ADM1 for large regions, WGS 84 for mapping).
- Be completely decisive: DO NOT use ambiguous "or" statements (never say "2020 Census or ACS estimates", pick one).
- Formulate the "assumptions" array: 2 to 3 complete, declarative sentences that clearly explain the key assumptions and default bounds you adopted to make the request actionable.

STEP 3: POPULATE THE 20-ELEMENT SPECIFICATION (analysis_spec)
Assign concrete, fully resolved values to all 20 elements (E1 through E20) in analysis_spec.
- Do NOT output "UNSPECIFIED". Every element must contain a concrete value derived from the user's prompt, the schema defaults, or your definitive assumptions.
- If an element was resolved using a standard schema default, indicate it (e.g. "Default: Intersects", "Default: Dynamic").
- Ensure all 20 elements are present in order as an array of objects:
  [ { "number": "E1", "name": "Analytical Goal", "value": "..." }, ... { "number": "E20", "name": "Output Modality", "value": "..." } ]

STEP 4: USER-FACING SUMMARY & THOUGHTS
- "summary": Provide a clear, concise understanding overview in strictly 1 to 2 short sentences using first-person future tense ('I will [analyze/retrieve]... I will provide [map/chart/table]...'). Directly state what you will analyze and the primary visual/tabular outputs.
- "thoughts": Record your internal reasoning process, vector gap analysis, chain decomposition, and why specific assumptions were chosen.

CRITICAL OUTPUT FORMATTING INSTRUCTION:
Return ONLY a valid JSON object matching this schema. Do not enclose it in markdown blocks.
{
  {intentSchema}
  "analysis_spec": [ { "number": "E1", "name": "Analytical Goal", "value": "..." } ],
  "assumptions": ["...", "..."],
  "summary": "...",
  "thoughts": "..."
}`;

  var TURN2_SYSTEM_INSTRUCTION = `Generate a step-by-step plan to execute the analysis that will answer the user's request.
Translate the 20-Element Vector specification into a rigorous, executable engineering plan.

RIGOROUS SPECIFICATION-TO-PLAN RULES:
1. PRECISION & CODE-READINESS: The description of each step and substep must have enough detail that an automated agent or developer could transform it into precise code without guessing.
2. DATASET PROVENANCE: For each dataset used in the analysis, explicitly describe where it comes from (authoritative source/API) and which components of the analysis it provides.
3. MATHEMATICAL & ALGORITHMIC FORMULAS: If metrics or dimensions are calculated or aggregated from other inputs (e.g., density, percentage change, rate per capita), explicitly describe the formulas and equations used.
4. EXPLICIT FILTER PARAMETERS: If filters or spatial constraints are applied, explicitly specify their exact parameters, thresholds, and boundary conditions.
5. DECOMPOSITION: If a step has a long or complex description, break it down into clean, targeted substeps.

DECISIVENESS & DETERMINISM:
Be highly specific and decisive in your plan. DO NOT use ambiguous "or" statements, alternatives, or "e.g." suggestions in your step descriptions and substeps (e.g., never say "GeoJSON or TopoJSON"). Make a single definitive choice for every dataset, format, and analytical method.

BAD SUBSTEP EXAMPLE: "Extract the most recent Decennial Census (2020) or American Community Survey (ACS) 5-year estimate population data."
BAD SUBSTEP EXAMPLE: "Generate a choropleth map using a graduated color scale (e.g., Oranges or Viridis) to represent population totals."
GOOD SUBSTEP EXAMPLE: "Extract the 2020 Decennial Census data via the Census API."
GOOD SUBSTEP EXAMPLE: "Generate a choropleth map using the Viridis color scale to represent population totals."

CRITICAL COLOR COORDINATION RULES:
If planning multiple maps or charts, plan to use completely distinct color scales for different metrics (e.g., Blues for Corn, Oranges for Soybeans) so they are visually distinguishable.
However, if a chart and a map represent the exact same metric or subject, strictly state that you will match their primary colors or color palettes (e.g., use Gold for Corn in the chart and a Gold/Yellow sequential scale for the Corn map).

CRITICAL METRIC ISOLATION RULES:
If analyzing multiple distinct categories, entities, or crops (e.g., Corn AND Soybeans, or Population AND Income), DO NOT aggregate, blend, or average them into a single combined metric (e.g., "Blended Average Yield") unless explicitly instructed, as this destroys agronomic or statistical meaning. Keep them strictly separated in all Data Processing steps!
Plan to present them separately in all visualizations and structured outputs:
1. Generate SEPARATE maps for each entity (e.g. one map for Corn, one map for Soybeans).
2. Generate SEPARATE columns in the final table for each entity (e.g. a Corn Yield column, and a Soybean Yield column).
3. If they share the exact same unit, they can be plotted as separate series (distinct lines) on a single time-series chart.

CRITICAL TEMPORAL DATA RULES (TRENDS vs BINS):
When the user asks for data over a continuous time period (e.g., "last 10 years"), they want to understand the trend.
1. CHARTS: Provide a time-series chart (e.g. a line chart spanning all 10 years).
2. MAPS: Maps can only display a single date effectively. DO NOT attempt to map an obscure "Long-Term Average" unless asked. Instead, map the MOST RECENT YEAR (e.g. 2023) or the DIFFERENCE/GROWTH between the first and last year, as this is much more actionable.
3. TABLES: DO NOT generate a column for every single year, as this breaks layout scaling. Instead, list the most recent year's data, and provide a summary column indicating the growth/change since the start of the time period (e.g., "Yield (2023)" and "Yield Growth (2014-2023)").

In the "thoughts" field, provide a very detailed and comprehensive rationale for every distinct step and substep. Explain EXACTLY why you made those specific deterministic choices (e.g., why 2020 Census over ACS, why Viridis over Oranges), how they relate to the overarching goal, and what specific details each substep handles. Do not be brief; capture your entire reasoning process thoroughly.

CRITICAL OUTPUT FORMATTING INSTRUCTION:
Return ONLY a valid JSON object matching this schema. Do not enclose it in markdown blocks.
{
  "plan": [ 
    { "name": "Step 1 Name", "step": "Description of step...", "substeps": ["Substep 1", "Substep 2"] }
  ],
  "thoughts": "Detailed rationale for each step and substep explaining specific choices..."
}`;

  var BREAKDOWN_PROMPT_INSTRUCTION_PREFIX = `We are executing Step {step_idx}: "{step_name}". Description: "{step_desc}". Sub-bullets: {step_subbullets}.
Break this down into executable sub-steps. Provide:
For each sub-step, a descriptive, human-readable 'label' for the activity indicator (e.g. "Querying Census Data", "Calculating Densities") and a detailed 'instruction' for what must be executed. Do NOT use function names, variable names, or snake_case for labels.
CRITICAL OUTPUT FORMATTING INSTRUCTION:
Return ONLY a valid JSON object matching this schema.
{
  "substeps": [
    { "label": "Descriptive, human-readable sub-step label", "instruction": "Detailed instruction" }
  ]
}`;

  var SUBSTEP_FINAL_INSTRUCTION = `
CRITICAL: This is the FINAL sub-step of the entire plan. You MUST now synthesize ALL data you generated across all previous steps. You must now output ALL relevant maps, charts, and tables you planned or built over the whole process in this final comprehensive response!

CRITICAL INSTRUCTIONS FOR TABLES:
If tabular data is generated, output a SINGLE comprehensive scrolling table sorted by the primary analytical metric (e.g., Population or Yield). DO NOT split the same dataset into multiple tables (e.g., do not make separate tables for 'Top 10', 'Bottom 10', and 'All Data'). Only use multiple tables if the datasets have completely different schemas or fundamentally different topics. Include ALL relevant rows you have generated. The UI natively handles scrolling. Do not output placeholder text; provide the actual data as a valid Markdown formatted table. Ensure all column headers use standard unambiguous labels for the metric and temporal context (e.g., 'Annual Corn Yield (Mean, 2014-2023)' instead of just 'Yield', 'Mean Yield', or '10-Yr Mean') so the data is completely unambiguous.

CRITICAL INSTRUCTIONS FOR DATA COMPLETENESS:
DO NOT output a small "representative sample" of data points to save space. You must generate a highly comprehensive, fully-populated dataset that covers the entire requested scope (e.g. all states in the midwest). Output all relevant records so that the maps and tables are fully populated across the entire region.
If you are generating temporal data, ensure ALL required time periods (e.g., all years in the range) are fully represented for ALL groups. If fetching data for multiple groups (e.g. Corn and Soybeans), fetch it completely for both. Data must be complete and exhaustive for downstream wrangling.

CRITICAL METRIC ISOLATION RULES:
When parsing and summarizing multiple distinct entities or topics (e.g. Corn AND Soybeans), keep them completely separate in your final outputs unless the user explicitly asked to combine them. 
- You MUST generate separate map specifications for each entity (e.g. one map for Corn, one map for Soybeans). Do not map a blended average.
- You MUST generate separate data columns in tables for each entity (e.g. Corn Yield column, Soybean Yield column). Do not make a blended average column.

CRITICAL TEMPORAL DATA RULES (TRENDS vs BINS):
When the user asks for data over a continuous time period (e.g., "last 10 years"), they want to understand the trend.
1. CHARTS: Provide a time-series chart (e.g. a line chart spanning all 10 years).
2. MAPS: Maps can only display a single date effectively. DO NOT attempt to map an obscure "Long-Term Average" unless asked. Instead, map the MOST RECENT YEAR (e.g. 2023) or the DIFFERENCE/GROWTH between the first and last year, as this is much more actionable.
3. TABLES: DO NOT generate a column for every single year, as this breaks layout scaling. Instead, list the most recent year's data, and provide a summary column indicating the growth/change since the start of the time period (e.g., "Yield (2023)" and "Yield Growth (2014-2023)").

CRITICAL INSTRUCTIONS FOR VISUALIZATIONS:
All charts and maps are rendered LIVE in the web application. DO NOT formulate steps to render, save, or export static images (no PNGs, SVGs, or JPEGs). Provide the raw JSON specifications as instructed below.
If charts (Vega-lite) should be displayed, provide specs. Set {"width": "container"} in the spec. ENABLE TOOLTIPS by setting {"tooltip": true} inside the "mark" definition for ALL charts. ALWAYS include a 'legend' block if mapping a variable to color. Set "scale": {"zero": false} on quantitative scales (e.g. y-axis) if data values don't start near zero, to prevent lines from appearing flat. For line charts with time periods, use "temporal" for the x-axis type to ensure lines connect. If using a fold transform, remember the syntax is "as": ["key", "value"]. CRITICAL: You MUST inject the actual JSON row data objects directly into the spec using \`data: {"values": [{"field": "value"}, ...]}\`. DO NOT use a string reference (e.g. \`data: {"values": "dataset_name"}\`) because the UI cannot resolve it.
Do NOT restrict data for charts; include all data points (e.g. do not arbitrarily chop to top 10/bottom 5). Let the UI handle scrolling.
If maps should be displayed, provide specs. MUST output all visualizations you planned. CRITICAL COLOR COORDINATION: If generating multiple maps or charts, use wildly different color scales (e.g. Blues for one metric, Oranges for another) so it is instantly obvious they represent different data. However, if a chart and a map represent the EXACT SAME metric/crop (e.g. a chart of Corn Yields and a map of Corn Yields), you MUST match their primary colors or color palettes so the user can visually connect them.

CRITICAL INSTRUCTIONS FOR CHOROPLETHS & GEOBOUNDARIES:
Check data density! If county-level data (ADM2) is extremely sparse or missing for the majority of the region, AGGREGATE or querying data at the STATE level (ADM1) instead, to ensure the map conveys a complete, meaningful narrative rather than a few scattered polygons.
For choropleths or highlighting administrative boundaries, use "geoboundaries". Do NOT manually draw boundary polygons for administrative regions.
HOWEVER, if your primary visualization is custom polygons (like fire perimeters, lakes, etc.) or pins, you SHOULD OMIT the "geoboundaries" block entirely so the administrative boundary doesn't overshadow or distract from the custom features!
For all choropleths (including US Counties), use "iso" (e.g., "USA") and "adm" level (e.g. "ADM1", "ADM2"). Specify keys in \`choropleth.data\` as geographic names (e.g. "Los Angeles", "Illinois"), NOT numeric codes. IMPORTANT: For ADM2, use STRICTLY the county or district name (e.g. "Champaign", "Los Angeles") without appending the state name (do NOT do "Champaign, Illinois"). Ensure \`choropleth.metricName\` is unique, highly descriptive, and uses a standard unambiguous label for the metric (e.g., 'Annual Corn Yield (Mean, 2014-2023)' or 'Soybean Yield (Total, 2023)' rather than just '10-Year Mean Corn Yield' or 'Mean Yield') so users know exactly what timeframe they are looking at in the map legend. DO NOT include the unit (e.g. 'bu/ac') inside \`metricName\` as the UI automatically appends the \`unit\` field to the legend!
For highly local boundaries not well supported by ISO/ADM (like neighborhoods or specific zones), provide a direct public GeoJSON URL in "geojsonUrl", and omit iso/adm.
"geoboundaries.filter" (optional): Specific area name, state, or ISO code (or a comma-separated list of them) to strictly limit which boundaries are drawn. This is CRITICAL. DO NOT draw the entire US if you only have data for a specific region. Use this generously to hide visually irrelevant regions.
CRITICAL INSTRUCTIONS FOR CUSTOM GEOMETRIES (Wildfires, Hurricanes, Floods, Districts):
Do NOT generate "polygons" arrays manually with bounding box coordinates for real-world entities! Doing so consumes massive amounts of LLM tokens and causes truncations!
Instead, use your parametric knowledge to find a stable, authoritative public ArcGIS REST FeatureServer (e.g., from NIFC, NOAA, FEMA, Census Bureau) that contains the requested data.
To transmit polygons directly to the frontend at zero token-cost, construct a GeoJSON query URL using this pattern:
"<FeatureServer_URL>/0/query?outSR=4326&f=geojson&where=<YOUR_SQL_CLAUSE>"
Inject this URL into the "geoboundaries.geojsonUrl" field! 
CRITICAL: If visualizing US Wildfires, you MUST use one of these EXACT base URLs because you cannot accurately guess ESRI Database IDs. The history view often omits recent/ongoing fires, so prefer the WFIGS Interagency Perimeters dataset for modern fires:
"geoboundaries.geojsonUrl = https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query?outSR=4326&f=geojson&where=poly_IncidentName IN ('Flat', 'Bedrock Fire')"
Or for older historical:
"geoboundaries.geojsonUrl = https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/InterAgencyFirePerimeterHistory_All_Years_View/FeatureServer/0/query?outSR=4326&f=geojson&where=INCIDENT IN ('Flat', 'Bedrock')"
CRITICAL SQL RULE: Do NOT hallucinate column names in your \`where\` clause (e.g. do not add \`STATE='OR'\` or \`INCIDENTNAME\`). Only use \`INCIDENT\` for the history database, and \`poly_IncidentName\` for the interagency perimeters database! Do NOT filter by \`FIRE_YEAR\`, as this is blocks geometries!
CRITICAL LINKING: You MUST STILL provide a "pins" array containing a marker for each feature so they appear when zoomed out. The special pin associated with a polygon will automatically have its color and tooltip matched. Ensure the pin's "label" matches the feature's name. The UI's mapping engine is smart and will automatically fuzzy-match "Flat Fire" in your 'pin.label' to "Flat" in the FeatureServer GeoJSON, so you DO NOT need to awkwardly drop suffixes in your 'pin.label' or 'choropleth.data'. HOWEVER, for the actual ESRI "where" clause query parameter inside the URL, try querying both variations (e.g., poly_IncidentName IN ('Flat', 'Flat Fire', 'Anvil', 'Anvil Fire')) to guarantee the geometry is successfully retrieved, as ESRI's backend is strict.
CRITICAL COLORING & TOOLTIP RULE: If you want your polygons and pins to be colored according to a color scale/gradient, and you want a legend and metric tooltips, you MUST include a "choropleth" block containing "metricName", "unit", "colorPalette" (MUST be an Array of string Hex colors, e.g., ["#ffffb2", "#bd0026"], NEVER a string name like "Viridis"), and a "data" object mapping the EXACT "label" (e.g. "Flat Fire") of the polygon/pin to its numeric value. The frontend will automatically assign the correct gradient colors and tooltips! Limit to visualizing the Top 10 largest features max.

Return JSON prefixed strictly with $$$WIDGET_SPEC$$$:\n\n$$$WIDGET_SPEC$$$\n{
{
  "data": { },
  "save_as": "...",
  "results": { },
  "thoughts": "...",
  "summary": "User-friendly, comprehensive presentation of the final results",
  "tables": [ { "structure": "| Header 1 | Header 2 |\\n|---|---|\\n| Data 1 | Data 2 |" } ],
  "charts": [ { "spec": { "width": "container", "data": {"values": [{"x": 1, "y": 2}]}, "mark": "line", "encoding": { "y": { "type": "quantitative", "scale": {"zero": false} }, "color": { "field": "...", "type": "...", "legend": {"title": "..."} } } } } ],
  "maps": [ { "spec": { "title": "Map", "center": {"lat": 36.7, "lng": -119.4}, "zoom": 6, "geoboundaries": {"geojsonUrl": "https://...&where=IncidentName IN ('Example Fire')"}, "pins": [{"lat": 36.7, "lng": -119.4, "label": "Example Fire"}], "choropleth": {"metricName": "Area", "unit": "acres", "colorPalette": ["#ffffb2", "#bd0026"], "data": {"Example Fire": 123.4}} } } ],
  "data_sources": ["..."]
}`;

  var SUBSTEP_NONFINAL_INSTRUCTION = `
CRITICAL INSTRUCTIONS FOR DATA COMPLETENESS:
DO NOT output a small "representative sample" of data points to save space. You must generate a highly comprehensive, fully-populated dataset that covers the entire requested scope (e.g. all states in the midwest). Output all relevant records so that the maps and tables are fully populated across the entire region.
If you are generating temporal data, ensure ALL required time periods (e.g., all years in the range) are fully represented for ALL groups. If fetching data for multiple groups (e.g. Corn and Soybeans), fetch it completely for both. Data must be complete and exhaustive for downstream wrangling.

Return JSON prefixed strictly with $$$WIDGET_SPEC$$$:\n\n$$$WIDGET_SPEC$$$\n{
{
  "data": { },
  "save_as": "...",
  "results": { },
  "thoughts": "..."
}`;

  // Safely parses and extracts a JSON object from a mixed text/markdown LLM
  // response using depth counting to ignore trailing braces in markdown or code blocks.
  function extractJSON(str) {
    str = String(str).trim();
    try { return JSON.parse(str); } catch (e) {}
    
    // strip markdown code block wrapping if present
    if (str.startsWith("```json")) {
        str = str.substring(7);
        if (str.endsWith("```")) str = str.substring(0, str.length - 3);
        str = str.trim();
        try { return JSON.parse(str); } catch (e) {}
    }
    
    const start = str.indexOf('{');
    let end = str.lastIndexOf('}');
    if (start === -1 || (end !== -1 && end < start)) {
        throw new Error('No JSON object found');
    }
    
    // Iteratively try to parse, stripping extraneously hallucinated trailing brackets (e.g. ] } })
    let candidate = str.substring(start, end + 1);
    let iter = 0;
    while (candidate.length > 2 && iter < 10) {
      try {
        return JSON.parse(candidate);
      } catch (e) {
        // Replace a closing bracket/brace immediately preceding the final brace
        if (/[\}\]]\s*\}$/.test(candidate)) {
           candidate = candidate.replace(/[\}\]](\s*\})$/, '$1');
           iter++;
        } else {
           break;
        }
      }
    }
    
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    
    for (let i = start; i < str.length; i++) {
      let char = str[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"') {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') depth++;
        else if (char === '}') {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(str.substring(start, i + 1));
            } catch (e) {
               // Malformed internals, continue checking just in case
            }
          }
        }
      }
    }
    
    // Fallback: try finding the last brace and parsing
    let last = str.lastIndexOf('}');
    while (last > start) {
      try {
        return JSON.parse(str.substring(start, last + 1));
      } catch (e) {
        last = str.lastIndexOf('}', last - 1);
      }
    }
    
    throw new Error('Could not extract valid JSON');
  }

  // Core network function to send prompts to the model with exponential backoff
  // on retries
  async function callGemini(req_body, signal, retry_callback) {
    const url = api_spec.url + '?key=' + api_spec.key;
    for (let i = 0; i < api_spec.retries; i++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(req_body),
          signal: signal,
        });
        if (!response.ok) {
          if (i < api_spec.retries - 1) {
            if (retry_callback) retry_callback(`Error ${response.status}`, i);
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
            continue;
          }
          throw new Error(`HTTP error - ${response.status}`);
        }
        let json_response = await response.json();
        let text = json_response.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Unexpected API response structure');
        let blocks = null;
        try {
          blocks = extractJSON(text);
        } catch (e) {
        }

        // Response handling: memory updating
        if (blocks && typeof blocks === 'object' && !Array.isArray(blocks)) {
          if (blocks.data && blocks.save_as)
            app_memory[blocks.save_as] = blocks.data;
        }

        return {text, blocks, req_body};
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        if (i === api_spec.retries - 1) throw error;
      }
    }
  }

  function getTurn1Instructions(isExpectingExecution = false) {
    let executeInstruction = isExpectingExecution ? TURN1_INTENT_EXECUTE : TURN1_INTENT_NO_EXECUTE;
    let intentSchema = isExpectingExecution ? TURN1_SCHEMA_EXECUTE : TURN1_SCHEMA_NO_EXECUTE;
    
    let text = TURN1_SYSTEM_INSTRUCTION.replace('{executeInstruction}', executeInstruction).replace('{intentSchema}', intentSchema);
    
    return {
      'parts': [{
        'text': text
      }]
    };
  }

  function getTurn2Instructions() {
    return {
      'parts': [{
        'text': TURN2_SYSTEM_INSTRUCTION
      }]
    };
  }

  function getBreakdownPrompt(step, step_idx) {
    let substeps = JSON.stringify(step.substeps || []);
    let text = BREAKDOWN_PROMPT_INSTRUCTION_PREFIX
        .replace('{step_idx}', step_idx + 1)
        .replace('{step_name}', step.name)
        .replace('{step_desc}', step.step)
        .replace('{step_subbullets}', substeps);
    return text;
  }

  function getSubstepSystem(substep, is_final_substep) {
    let app_keys = Object.keys(app_memory);
    let memory_note = app_keys.length > 0 ?
        `\nDATASETS IN MEMORY (Use these directly for ${
            is_final_substep ?
                'calculations, tables, charts, and maps' :
                'calculations'}):\n${JSON.stringify(app_memory)}` :
        ``;
    
    let base_prompt = is_final_substep ? SUBSTEP_FINAL_INSTRUCTION : SUBSTEP_NONFINAL_INSTRUCTION;

    return `Execute this instructed sub-step.
If the sub-step involves retrieving or generating new data, include it in "data".
If you want to save this data to memory for later steps, assign a short name in "save_as".
If it involves calculations, use the provided datasets in memory and include results under "results".
Also provide thoughts/rationale in "thoughts".${memory_note}
${base_prompt.trim()}`;
  }
  return {
    app_memory,
    callGemini,
    getTurn1Instructions,
    getTurn2Instructions,
    getBreakdownPrompt,
    getSubstepSystem,
    extractJSON
  };
})();
