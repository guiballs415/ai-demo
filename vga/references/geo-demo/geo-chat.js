function renderMarkdownBold(text) {
  if (!text) return text;
  let escaped = text.replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");
  return escaped.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
}

var widget_spec = {
  placeholder_text: 'Enter prompt',
  min_prompt: 1,
  zippy_height: 720,
};

var table_spec = {
  visible_rows: 10,
};

// Maintains the chronological multi-turn context payload sent to the LLM
var chat_history = [];
var app_memory = {};
var current_abort_controller = null;
var latest_plan_blocks = null;

// Evaluates the model JSON and natively renders tables, Vega charts, or Leaflet
// maps into the UI
function render_visualizations(results_json, target_div) {
  let debug_text = '';

  if (results_json.tables) {
    function parse_md_table(md) {
      let rows = md.trim().split('\n');
      let first_row_idx = rows.findIndex(r => r.trim().startsWith('|'));
      if (first_row_idx === -1) return null;
      rows = rows.slice(first_row_idx);

      let data_row_count = 0;
      for (let row of rows) {
        row = row.trim();
        if (!row.startsWith('|') || !row.endsWith('|')) continue;
        if (/^\|[- :|]+\|$/.test(row)) continue;
        data_row_count++;
      }
      data_row_count -= 1;  // subtract header

      if (data_row_count < 1) return null;

      let max_height_style = '';
      if (data_row_count > table_spec.visible_rows) {
        let max_height =
            (table_spec.visible_rows * 37) + 38;  // approx 37px per row
        max_height_style = ` style="max-height: ${max_height}px;"`;
      }

      let html =
          `<div class="data-table-container"><div class="data-table-wrapper"${
              max_height_style}><table class="data-table">\n`;
      let isHead = true;
      for (let row of rows) {
        row = row.trim();
        if (!row.startsWith('|') || !row.endsWith('|')) continue;
        if (/^\|[- :|]+\|$/.test(row)) {
          isHead = false;
          continue;
        }
        let cols = row.split('|').slice(1, -1);
        html += '<tr>';
        cols.forEach(c => {
          c = c.replace(/\*\*/g, '').trim();
          if (isHead) {
            c = c.replace(/(\([^)]+\))/g, '<span style="white-space: nowrap;">$1</span>');
            html += `<th>${c}</th>`;
          } else {
            html += `<td>${c}</td>`;
          }
        });
        html += '</tr>\n';
      }
      html += '</table></div></div>';
      return html;
    }
    results_json.tables.forEach(t => {
      let html_table = null;
      if (typeof t.structure === 'string')
        html_table = parse_md_table(t.structure);
      if (html_table) {
        let div = document.createElement('div');
        div.innerHTML = html_table;
        target_div.appendChild(div);
      } else {
        let pre = document.createElement('pre');
        pre.className = 'text-paragraph pre-formatted';
        pre.textContent = typeof t.structure === 'string' ?
            t.structure :
            JSON.stringify(t.structure, null, 2);
        target_div.appendChild(pre);
      }
    });
  }
  if (results_json.charts && results_json.charts.length > 0) {
    if (!window.vegaEmbed)
      console.error('vegaEmbed not found');
    else {
      results_json.charts.forEach((c, idx) => {
        debug_text += `\n[Chart ${idx + 1} Spec]\n` +
            JSON.stringify(c.spec, null, 2) + `\n`;
        c.spec.width = 'container';
        let chart_div = document.createElement('div');
        chart_div.className = 'chart';
        target_div.appendChild(chart_div);
        vegaEmbed(chart_div, c.spec, {actions: true})
            .then(() => {
              scrollToBottom();
            })
            .catch(err => {
              let err_div = document.createElement('div');
              err_div.className = 'error-text text-paragraph';
              err_div.innerHTML = renderMarkdownBold('Chart Render Error: ' + err.message);
              target_div.appendChild(err_div);
            });
      });
    }
  }
  if (results_json.maps && results_json.maps.length > 0) {
    results_json.maps.forEach((m, idx) => {
      debug_text +=
          `\n[Map ${idx + 1} Spec]\n` + JSON.stringify(m.spec, null, 2) + `\n`;
      let map_wrapper = document.createElement('div');
      map_wrapper.className = 'map-container';
      target_div.appendChild(map_wrapper);
      if (typeof window.create_map === 'function') {
        window.create_map(m.spec, map_wrapper)
            .then(() => {
              scrollToBottom();
            })
            .catch(err => {
              let err_div = document.createElement('div');
              err_div.className = 'error-text text-paragraph';
              err_div.innerHTML = renderMarkdownBold('Map Render Error: ' + err.message);
              target_div.appendChild(err_div);
            });
      } else {
        map_wrapper.classList.add('pre-wrap-box');
        map_wrapper.textContent =
            'Map Spec:\n' + JSON.stringify(m.spec, null, 2);
      }
    });
  }
  return debug_text;
}

function add_div(div) {
  document.getElementById('chat').appendChild(div);
}

function add_prompt(text) {
  var container = document.createElement('div');
  var div = document.createElement('div');

  container.classList.add('prompt');
  container.appendChild(div);

  div.classList.add('bubble');
  div.innerHTML = renderMarkdownBold(text);

  add_div(container);
  scrollToBottom();
}

function add_text(text) {
  var div = document.createElement('div');
  div.classList.add('response');
  div.innerHTML = renderMarkdownBold(text);

  add_div(div);
  scrollToBottom();
  return div;
}

function scrollToBottom() {
  window.scrollTo({top: document.body.scrollHeight, behavior: 'smooth'});
}

// Main orchestrator function handling Turn 1 (Strategy), Turn 2 (Plan), and the
// Execution loops
async function send_user_prompt() {
  var send_btn_el = document.getElementById('send-btn');
  if (send_btn_el.classList.contains('stop-mode')) {
    if (current_abort_controller) current_abort_controller.abort();
    return;
  }

  var textarea = document.getElementById('user-textarea');
  var prompt_text = textarea.value.trim();
  if (!prompt_text) return;

  // Remove any active review buttons if the user enters a prompt directly
  let existing_btn_container = document.querySelector('.btn-container');
  let isExpectingExecution = false;
  if (existing_btn_container && existing_btn_container.parentElement) {
    isExpectingExecution = true;
    existing_btn_container.parentElement.remove();
  }

  if (prompt_history.length === 0 ||
      prompt_history[prompt_history.length - 1] !== prompt_text) {
    prompt_history.push(prompt_text);
  }
  history_index = prompt_history.length;
  current_input_draft = '';
  Object.keys(app_memory).forEach(k => delete app_memory[k]);
  if (typeof EaiaAgent !== "undefined" && EaiaAgent.app_memory) {
    Object.keys(EaiaAgent.app_memory).forEach(k => delete EaiaAgent.app_memory[k]);
  }

  let turn_transcript = '';
  function log_transcript(label, req, resp_text) {
    turn_transcript += `### ${label || 'Turn'}\n\n**Request**:\n\`\`\`json\n${
        JSON.stringify(
            req, null,
            2)}\n\`\`\`\n\n**Response**:\n\`\`\`\n${resp_text}\n\`\`\`\n\n`;
  }

  document.body.classList.add('prompt-active');
  document.body.classList.add('generation-in-progress'); document.getElementById('user-textarea').disabled = true;

  // extractJSON moved to Agent

  textarea.value = '';
  current_abort_controller = new AbortController();
  let active_send_btn = document.getElementById('send-btn');
  active_send_btn.classList.add('stop-mode');
  active_send_btn.setAttribute('data-tooltip', 'Cancel response');
  active_send_btn.classList.remove('disabled');

  add_prompt(prompt_text);

  chat_history.push({'role': 'user', 'parts': [{'text': prompt_text}]});

  var response_div = document.createElement('div');
  response_div.classList.add('response');

  function handle_abort_ui() {
    let spinners = response_div.querySelectorAll('.spinner');
    spinners.forEach(s => {
      s.className = 'unfinished-icon';
      let summary = s.closest('summary');
      if (summary) {
        summary.classList.remove('running');
        let details = summary.parentElement;
        if (details && details.tagName.toLowerCase() === 'details') {
          if (details.children.length === 1) {
            // It's an empty zippy with no body because it was cancelled too early
            summary.classList.add('no-hover');
            summary.classList.add('no-zippy');
            summary.classList.add('cursor-default');
          } else {
            summary.classList.remove('no-hover');
            summary.classList.add('cursor-pointer');
          }
        } else {
          summary.classList.remove('no-hover');
          summary.classList.add('cursor-pointer');
        }
        let label = summary.querySelector('.label-text');
        if (label && !label.textContent.includes('Cancelled')) {
          let txt = label.textContent;
          txt = txt.split('\u2002')[0];
          label.textContent = txt + ' - Response cancelled';
        }
      }
    });

    append_transcript_widget();

    scrollToBottom();
    document.body.classList.remove('generation-in-progress'); document.getElementById('user-textarea').disabled = false;
    document.getElementById('send-btn').classList.remove('stop-mode');
    document.getElementById('send-btn')
        .setAttribute('data-tooltip', 'Send request');
    handle_textarea_input();
  }

  function append_transcript_widget() {
    if (!turn_transcript) return;
    let transcript_step_div = document.createElement('div');
    transcript_step_div.className = 'step-result';
    let transcript_details = document.createElement('details');
    let transcript_summary = document.createElement('summary');
    transcript_summary.innerHTML =
        `<span class="transcript-icon"></span><span class="label-text">Execution trace</span>`;

    let transcript_wrapper = document.createElement('div');
    transcript_wrapper.className = 'transcript-wrapper';

    let copy_btn = document.createElement('button');
    copy_btn.className = 'copy-button';
    copy_btn.setAttribute('data-tooltip', 'Copy to clipboard');
    copy_btn.onclick = function(e) {
      navigator.clipboard.writeText(turn_transcript);
    };

    let transcript_pre = document.createElement('pre');
    transcript_pre.className = 'zippy-content';
    transcript_pre.textContent = turn_transcript;

    transcript_wrapper.appendChild(transcript_pre);
    transcript_wrapper.appendChild(copy_btn);

    transcript_details.appendChild(transcript_summary);
    transcript_details.appendChild(transcript_wrapper);
    transcript_step_div.appendChild(transcript_details);
    response_div.appendChild(transcript_step_div);

    transcript_details.addEventListener('toggle', () => {
      if (transcript_details.open) setTimeout(scrollToBottom, 50);
    });
  }

  let step1_div = document.createElement('div');
  step1_div.className = 'step-result';
  step1_div.innerHTML =
      `<details><summary class="running no-hover cursor-default"><span class="spinner"></span><span class="label-text">Analyzing input</span></summary></details>`;
  response_div.appendChild(step1_div);

  let content1_div = document.createElement('div');
  response_div.appendChild(content1_div);

  let step2_div = document.createElement('div');
  step2_div.className = 'step-result hidden';
  step2_div.innerHTML =
      `<details><summary class="running no-hover cursor-default"><span class="spinner"></span><span class="label-text">Creating plan</span></summary></details>`;
  response_div.appendChild(step2_div);

  let content_div = document.createElement('div');
  response_div.appendChild(content_div);

  add_div(response_div);
  scrollToBottom();

  // --- Turn 1: Understanding ---
  const turn1_instructions = EaiaAgent.getTurn1Instructions(isExpectingExecution);

  var request_turn1 = {
    'contents': chat_history,
    'systemInstruction': turn1_instructions,
    'generationConfig': {'response_mime_type': 'application/json'}
  };

  var error_message = null;
  var turn1_response_text = null;
  let orig_label_1 = 'Analyzing input';

  try {
    let result = await EaiaAgent.callGemini(
        request_turn1, current_abort_controller.signal, (errStr, i) => {
          let rtry = i === 0 ? 'retrying' : `retrying ${i + 1}x`;
          let details1 = step1_div.querySelector('summary');
          if (details1) {
            details1.innerHTML = `<span class="spinner"></span>${
                orig_label_1} - ${errStr}, ${rtry}`;
          }
        });
    turn1_response_text = result.text;
    log_transcript(
        'Turn 1 - Understanding stage', request_turn1, turn1_response_text);

    try {
      error_message = null;
    } catch (e) {
      error_message = e.message;
    }
  } catch (error) {
    if (error.name === 'AbortError') return handle_abort_ui();
    console.error('Gemini API Error:', error);
    error_message = 'Network error: ' + error.message;
  }

  if (error_message) {
    chat_history.pop();
    response_div.classList.add('error-text');
    response_div.innerHTML = renderMarkdownBold(error_message);
    scrollToBottom();
    document.body.classList.remove('generation-in-progress'); document.getElementById('user-textarea').disabled = false;
    document.getElementById('send-btn').classList.remove('stop-mode');
    document.getElementById('send-btn')
        .setAttribute('data-tooltip', 'Send request');
    handle_textarea_input();
    return;
  }

  // Append Turn 1 Response for context
  chat_history.push(
      {'role': 'model', 'parts': [{'text': turn1_response_text}]});

  let turn1_blocks = {};
  let details = document.createElement('details');
  let summary = document.createElement('summary');
  let pre1 = document.createElement('pre');
  let step1_summary = step1_div.querySelector('summary');
  try {
    turn1_blocks = EaiaAgent.extractJSON(turn1_response_text);

    pre1.textContent = turn1_blocks.thoughts || 'No thoughts provided.';
    pre1.className = 'zippy-content';
    let wrapper1 = document.createElement('div');
    wrapper1.className = 'transcript-wrapper';
    let copy_btn1 = document.createElement('button');
    copy_btn1.className = 'copy-button';
    copy_btn1.setAttribute('data-tooltip', 'Copy to clipboard');
    copy_btn1.onclick = function(e) {
      navigator.clipboard.writeText(pre1.textContent);
    };
    wrapper1.appendChild(pre1);
    wrapper1.appendChild(copy_btn1);

    let details1 = step1_div.querySelector('details');
    if (details1) {
      details1.appendChild(wrapper1);
    }

    step1_div.classList.remove('running');

    if (step1_summary) {
      step1_summary.innerHTML = `<span class="checkmark"></span>Understanding`;
      step1_summary.classList.remove('running');
      step1_summary.classList.remove('no-hover');
      step1_summary.classList.add('cursor-pointer');
    }

    if (turn1_blocks.intent !== 'execute') {
      let p = document.createElement('p');
      p.className = 'text-paragraph tighter-margin';
      p.innerHTML = renderMarkdownBold(turn1_blocks.summary || 'Summary missing.');
      content1_div.appendChild(p);

      if (turn1_blocks.assumptions && Array.isArray(turn1_blocks.assumptions) &&
          turn1_blocks.assumptions.length > 0) {
        let assoc = document.createElement('p');
        assoc.className = 'assumptions-header';
        assoc.textContent = `Defaults and assumptions:`;
        content1_div.appendChild(assoc);

        let ul = document.createElement('ul');
        ul.className = 'bulleted-list assumptions-list';
        turn1_blocks.assumptions.forEach(assm => {
          let li = document.createElement('li');
          li.innerHTML = renderMarkdownBold(assm);
          ul.appendChild(li);
        });
        content1_div.appendChild(ul);
      }
    }

    if (turn1_blocks.intent === 'chat') {
      if (step1_summary) step1_summary.innerHTML = `<span class="checkmark"></span>Conversation`;
      scrollToBottom();
      document.body.classList.remove('generation-in-progress'); document.getElementById('user-textarea').disabled = false;
      document.getElementById('send-btn').classList.remove('stop-mode');
      document.getElementById('send-btn')
          .setAttribute('data-tooltip', 'Send request');
      handle_textarea_input();
      return;
    }

    if (turn1_blocks.intent === 'new_analysis' &&
        (!turn1_blocks.analysis_spec ||
         turn1_blocks.analysis_spec.length === 0)) {
      if (step1_summary) step1_summary.innerHTML = `<span class="checkmark"></span>Request Rejected`;
      scrollToBottom();
      document.body.classList.remove('generation-in-progress'); document.getElementById('user-textarea').disabled = false;
      document.getElementById('send-btn').classList.remove('stop-mode');
      document.getElementById('send-btn')
          .setAttribute('data-tooltip', 'Send request');
      handle_textarea_input();
      return;
    }

    step2_div.classList.remove('hidden');

  } catch (e) {
    step1_div.className = 'step-result error-text';
    step1_div.innerHTML = renderMarkdownBold('Error parsing Turn 1 JSON: ' + turn1_response_text);
    scrollToBottom();
    document.body.classList.remove('generation-in-progress'); document.getElementById('user-textarea').disabled = false;
    document.getElementById('send-btn').classList.remove('stop-mode');
    document.getElementById('send-btn')
        .setAttribute('data-tooltip', 'Send request');
    handle_textarea_input();
    return;
  }

  scrollToBottom();

  var turn2_blocks = null;
  let force_execute = false;

  if (turn1_blocks.intent === 'execute') {
    if (step1_summary) step1_summary.innerHTML = `<span class="checkmark"></span>Execution Confirmed`;
    force_execute = true;
    step2_div.classList.add('hidden');

    var turn2_blocks = latest_plan_blocks;
    let last_plan_text = null;
    
    if (!turn2_blocks) {
      for (let i = chat_history.length - 1; i >= 0; i--) {
      if (chat_history[i].role === 'model' && chat_history[i].parts[0].text.includes('"plan"')) {
         try {
             let parsed = EaiaAgent.extractJSON(chat_history[i].parts[0].text);
             if (parsed && Array.isArray(parsed.plan)) {
                 turn2_blocks = parsed;
                 last_plan_text = chat_history[i].parts[0].text;
                 break;
             }
         } catch(e) {}
      }
    }
    if (!turn2_blocks) {
      turn2_blocks = { "plan": [] };
    }
    }
  }

  // --- Turn 2: Planning ---
  let plan_prompt_text =
      'Based on everything understood, generate a step-by-step plan to execute the analysis.';
  if (turn1_blocks.intent === 'follow_up') {
    plan_prompt_text =
        'The user is asking a follow-up to modify or visualize current results. Rely heavily on the existing data in memory. Generate a short, targeted plan to fulfill this modification.';
  }
  const turn2_instructions = EaiaAgent.getTurn2Instructions();

  let turn2_chat_history = chat_history.slice();
  if (!force_execute) {
    turn2_chat_history.push(
        {'role': 'user', 'parts': [{'text': plan_prompt_text}]});
  }

  var request_turn2 = {
    'contents': turn2_chat_history,
    'systemInstruction': turn2_instructions,
    'generationConfig': {'response_mime_type': 'application/json'}
  };

  var turn2_response_text = null;
  let orig_label_2 = 'Creating plan';

  try {
    if (!force_execute) {
      let result = await EaiaAgent.callGemini(
          request_turn2, current_abort_controller.signal, (errStr, i) => {
            let rtry = i === 0 ? 'retrying' : `retrying ${i + 1}x`;
            let details2 = step2_div.querySelector('summary');
            if (details2) details2.innerHTML = `<span class="spinner"></span>${orig_label_2} - ${errStr}, ${rtry}`;
          });
      turn2_response_text = result.text;
    log_transcript(
        'Turn 2 - Plan generation', request_turn2, turn2_response_text);

    try {
      // Extraction handled natively below
      error_message = null;
    } catch (e) {
      error_message = e.message;
    }
  } // End if(!force_execute)
  } catch (error) {
    if (error.name === 'AbortError') return handle_abort_ui();
    console.error('Gemini API Error:', error);
    error_message = 'Network error: ' + error.message;
  }

  if (error_message) {
    step2_div.className = 'step-result error-text';
    let summary2 = step2_div.querySelector('summary');
    if (summary2) summary2.textContent = error_message;
    scrollToBottom();
    document.body.classList.remove('generation-in-progress'); document.getElementById('user-textarea').disabled = false;
    return;
  }

  // Append Turn 2 (with plan user request and Plan generation)
  if (!force_execute) {
    chat_history = turn2_chat_history;
    chat_history.push(
        {'role': 'model', 'parts': [{'text': turn2_response_text}]});
  }

  try {
    if (!force_execute) {
      turn2_blocks = EaiaAgent.extractJSON(turn2_response_text);
      latest_plan_blocks = turn2_blocks;

      let step2_summary = step2_div.querySelector('summary');
    if (step2_summary) {
      step2_summary.classList.remove('running');
      step2_summary.classList.remove('no-hover');
      step2_summary.classList.add('cursor-pointer');
      step2_summary.innerHTML = `<span class="checkmark"></span>Strategic Plan`;
    }
    
    let pre2 = document.createElement('pre');
    pre2.textContent = turn2_blocks.thoughts || 'No thoughts provided.';
    pre2.className = 'zippy-content';
    let wrapper2 = document.createElement('div');
    wrapper2.className = 'transcript-wrapper';
    let copy_btn2 = document.createElement('button');
    copy_btn2.className = 'copy-button';
    copy_btn2.setAttribute('data-tooltip', 'Copy to clipboard');
    copy_btn2.onclick = function(e) {
      navigator.clipboard.writeText(pre2.textContent);
    };
    wrapper2.appendChild(pre2);
    wrapper2.appendChild(copy_btn2);

    let details2 = step2_div.querySelector('details');
    if (details2) {
      details2.appendChild(wrapper2);
    }

    if (turn2_blocks.plan && Array.isArray(turn2_blocks.plan) &&
        turn2_blocks.plan.length > 0) {
      let ol = document.createElement('ol');
      ol.className = 'numbered-list';
      turn2_blocks.plan.forEach((s) => {
        let li = document.createElement('li');

        let p = document.createElement('p');
        p.className = 'text-paragraph';
        p.classList.add('tight-margin');
        p.innerHTML = `<b>${s.name}:</b> ${renderMarkdownBold(s.step)}`;
        li.appendChild(p);

        if (s.substeps && s.substeps.length > 0) {
          let ul = document.createElement('ul');
          ul.className = 'bulleted-list';
          s.substeps.forEach(substep => {
            let inner_li = document.createElement('li');
            inner_li.innerHTML = renderMarkdownBold(substep);
            ul.appendChild(inner_li);
          });
          li.appendChild(ul);
        }
        ol.appendChild(li);
      });
      content_div.appendChild(ol);
    }
  }


    // Phase 1: Execution Breakdown
    let execution_context = chat_history.slice();

    async function call_gemini(
        req_body, step_element, target_context = execution_context) {
      let target_el = (step_element && step_element.querySelector &&
                       step_element.querySelector('summary')) ||
          step_element;
      let orig_label = target_el ? target_el.textContent.trim() : '';
      try {
        let result = await EaiaAgent.callGemini(
            req_body, current_abort_controller.signal, (errStr, i) => {
              if (target_el) {
                let rtry = i === 0 ? 'retrying' : `retrying ${i + 1}x`;
                target_el.innerHTML = `<span class="spinner"></span>${
                    orig_label} - ${errStr}, ${rtry}`;
              }
            });
        if (target_el) {
          target_el.innerHTML = `<span class="spinner"></span><span class="label-text">${orig_label}</span>`;
        }
        let text = result.text;
        log_transcript(
            `Execution Step - ${orig_label || 'Execution'}`, req_body, text);

        let blocks = result.blocks || EaiaAgent.extractJSON(text);
        if (target_context) {
          if (blocks && typeof blocks === 'object' && !Array.isArray(blocks)) {
            if (blocks.data && blocks.save_as)
              app_memory[blocks.save_as] = blocks.data;
            let context_safe_clone = {...blocks};
            if (context_safe_clone.maps)
              context_safe_clone.maps = '[REDACTED: Specs rendered to UI]';
            if (context_safe_clone.charts)
              context_safe_clone.charts = '[REDACTED: Specs rendered to UI]';
            if (context_safe_clone.tables)
              context_safe_clone.tables = '[REDACTED: Specs rendered to UI]';
            if (context_safe_clone.data)
              context_safe_clone.data = `[REDACTED: Saved to memory as ${
                  blocks.save_as || 'anonymous record'}]`;
            target_context.push({
              'role': 'model',
              'parts': [{'text': JSON.stringify(context_safe_clone)}]
            });
          } else {
            target_context.push({'role': 'model', 'parts': [{'text': text}]});
          }
        }
        return blocks;
      } catch (error) {
        if (error.name === 'AbortError') return 'ABORTED';
        console.error('Gemini API Error:', error);
        return null;
      }
    }

    async function execute_plan() {
      document.body.classList.add('generation-in-progress'); document.getElementById('user-textarea').disabled = true;
      let act_btn = document.getElementById('send-btn');
      if (act_btn) {
        act_btn.classList.add('stop-mode');
        act_btn.classList.remove('disabled');
        act_btn.setAttribute('data-tooltip', 'Cancel response');
      }

      try {
        if (turn2_blocks.plan && Array.isArray(turn2_blocks.plan)) {
          let plan_steps = turn2_blocks.plan && Array.isArray(turn2_blocks.plan) ?
              turn2_blocks.plan :
          [];
      for (let step_idx = 0; step_idx < plan_steps.length; step_idx++) {
        let step = plan_steps[step_idx];

        let breakdown_system_prompt =
            EaiaAgent.getBreakdownPrompt(step, step_idx);
        execution_context.push({
          'role': 'user',
          'parts': [{'text': `Break down Step ${step_idx + 1}: ${step.name}`}]
        });

        let breakdown_req = {
          'contents': execution_context,
          'systemInstruction': {'parts': [{'text': breakdown_system_prompt}]},
          'generationConfig': {'response_mime_type': 'application/json'}
        };

        let exec_step_div = document.createElement('div');
        exec_step_div.className = 'step-result';
        let initial_plan_label = `${step.name}\u2002...`;
        exec_step_div.innerHTML =
            `<details><summary class="running no-hover" style="cursor: default;"><span class="spinner"></span><span class="label-text">${
                initial_plan_label}</span></summary></details>`;
        response_div.appendChild(exec_step_div);
        scrollToBottom();

        let breakdown_json =
            await call_gemini(breakdown_req, exec_step_div.querySelector('summary') || exec_step_div);
        if (breakdown_json === 'ABORTED') return handle_abort_ui();
        if (!breakdown_json) {
          let cur_summary = exec_step_div.querySelector('summary');
          if (cur_summary) {
            cur_summary.classList.remove('running');
            cur_summary.classList.remove('no-hover');
            cur_summary.classList.add('cursor-pointer');
            let spinner = cur_summary.querySelector('.spinner');
            if (spinner) spinner.className = 'unfinished-icon';
          }
          continue;
        }

        let substeps = breakdown_json.substeps || [];
        let exec_details = exec_step_div.querySelector('details') ||
            document.createElement('details');
        if (!exec_details.parentNode) exec_step_div.appendChild(exec_details);
        let exec_summary = exec_details.querySelector('summary') ||
            document.createElement('summary');
        exec_summary.innerHTML =
            `<span class="spinner"></span><span class="label-text"></span>`;
        if (!exec_summary.parentNode) exec_details.appendChild(exec_summary);
        let exec_pre = document.createElement('pre');
        exec_pre.className = 'zippy-content';

        if (substeps.length === 0) {
          exec_pre.textContent =
              'No execution sub-steps required for this step.';
          exec_summary.classList.remove('running');
          exec_summary.classList.remove('no-hover');
          exec_summary.classList.add('cursor-pointer');
        } else {
          exec_summary.classList.add('running');
          exec_summary.classList.add('no-hover');
          exec_summary.classList.add('cursor-default');
        }

        let exec_wrapper = document.createElement('div');
        exec_wrapper.className = 'transcript-wrapper';
        let exec_copy_btn = document.createElement('button');
        exec_copy_btn.className = 'copy-button';
        exec_copy_btn.setAttribute('data-tooltip', 'Copy to clipboard');
        exec_copy_btn.onclick = function(e) {
          navigator.clipboard.writeText(exec_pre.textContent);
        };
        exec_wrapper.appendChild(exec_pre);
        exec_wrapper.appendChild(exec_copy_btn);

        exec_details.appendChild(exec_wrapper);

        for (let sub_idx = 0; sub_idx < substeps.length; sub_idx++) {
          let substep = substeps[sub_idx];
          let current_step_label =
              `${step.name}\u2002...\u2002${substep.label}`;
          let lb = exec_summary.querySelector('.label-text');
          if (lb) {
            lb.innerHTML = renderMarkdownBold(current_step_label);
          } else {
            exec_summary.innerHTML =
                `<span class="spinner"></span><span class="label-text">${
                    current_step_label}</span>`;
          }
          scrollToBottom();

          let is_final_substep =
              (step_idx === plan_steps.length - 1 &&
               sub_idx === substeps.length - 1);
          let substep_system =
              EaiaAgent.getSubstepSystem(substep, is_final_substep);

          // Optimization 4: Prune Context Window
          // Only send original chat history and model outputs, removing noisy
          // intermediate "Execute sub-step" pushes
          let pruned_context = execution_context.filter(msg => {
            let msgText = msg.parts[0].text;
            if (msg.role === 'user' && msgText.startsWith('Execute sub-step:'))
              return false;
            if (msg.role === 'user' && msgText.startsWith('Break down Step'))
              return false;
            return true;
          });

          let current_prompt = {
            'role': 'user',
            'parts': [{'text': `Execute sub-step: ${substep.instruction}`}]
          };
          pruned_context.push(current_prompt);

          // We still push to execution_context so `call_gemini` can append the
          // response to it for the main history
          execution_context.push(current_prompt);

          let substep_req = {
            'contents': pruned_context,
            'systemInstruction': {'parts': [{'text': substep_system}]},
            'generationConfig': {'response_mime_type': 'application/json'}
          };

          let substep_json = await call_gemini(substep_req, exec_summary);
          if (substep_json === 'ABORTED') return handle_abort_ui();

          if (substep_json) {
            let step_debug_text = '';
            if (is_final_substep) {
              if (substep_json.summary) {
                let p = document.createElement('p');
                p.className = 'text-paragraph';
                p.innerHTML = renderMarkdownBold(substep_json.summary);
                response_div.appendChild(p);
              }
              step_debug_text =
                  render_visualizations(substep_json, response_div);
              if (substep_json.data_sources &&
                  substep_json.data_sources.length > 0) {
                let src_header = document.createElement('div');
                src_header.className = 'text-paragraph';
                src_header.classList.add('header-spacing');
                src_header.textContent = 'Data Sources:';
                response_div.appendChild(src_header);

                let ul = document.createElement('ul');
                ul.className = 'bulleted-list';
                ul.classList.add('no-top-margin');
                substep_json.data_sources.forEach(src => {
                  let li = document.createElement('li');
                  li.className = 'text-paragraph';
                  li.innerHTML = renderMarkdownBold(src);
                  ul.appendChild(li);
                });
                response_div.appendChild(ul);
              }
            }

            let full_rationale =
                substep_json.thoughts || 'No details provided.';
            if (step_debug_text)
              full_rationale += '\n\n' + step_debug_text.trim();
            let text_block = `[${substep.label}]\n${full_rationale}\n`;
            exec_pre.textContent +=
                (exec_pre.textContent ? '\n' : '') + text_block;
          } else {
            let text_block = `[${substep.label}]\nError executing sub-step.\n`;
            exec_pre.textContent +=
                (exec_pre.textContent ? '\n' : '') + text_block;
          }
          if (sub_idx === 0) {
            exec_summary.classList.remove('running');
            exec_summary.classList.remove('no-hover');
            exec_summary.classList.add('cursor-pointer');
          }
          scrollToBottom();
        }

        exec_step_div.classList.remove('running');
        let final_step_label = `${breakdown_json.step_label || step.name}`;
        exec_summary.innerHTML =
            `<span class=\"checkmark\"></span><span class=\"label-text\">${
                final_step_label}</span>`;
      }
    }
    
    } catch (e) {
        let err = document.createElement('div');
        err.className = 'text-paragraph error-text';
        err.textContent = 'Error executing plan: ' + e.message;
        content_div.appendChild(err);
      }

      append_transcript_widget();
      document.body.classList.remove('generation-in-progress'); document.getElementById('user-textarea').disabled = false;
      let act_btn2 = document.getElementById('send-btn');
      if (act_btn2) {
        act_btn2.classList.remove('stop-mode');
        act_btn2.setAttribute('data-tooltip', 'Send request');
      }
      handle_textarea_input();
      scrollToBottom();
    }

    let modeParam = document.getElementById('workflow-mode');
    let mode = modeParam ? modeParam.value : 'execute';

    if (mode === 'review' && !force_execute) {
      let interact_container = document.createElement('div');
      interact_container.classList.add('top-margin-32');

      let btn_container = document.createElement('div');
      btn_container.className = 'btn-container';

      let btn1 = document.createElement('button');
      btn1.textContent = 'Looks good, do it';
      btn1.className = 'btn btn-primary';

      let btn2 = document.createElement('button');
      btn2.textContent = 'Revise plan / assumptions';
      btn2.className = 'btn btn-secondary';

      btn_container.appendChild(btn1);
      btn_container.appendChild(btn2);
      interact_container.appendChild(btn_container);

      content_div.appendChild(interact_container);
      scrollToBottom();
      
      btn1.onclick = () => {
        interact_container.remove();
        current_abort_controller = new AbortController();
        execute_plan();
      };
      
      btn2.onclick = () => {
        interact_container.innerHTML = '';
        let p_prompt = document.createElement('p');
        p_prompt.className = 'text-paragraph';
        p_prompt.classList.add('text-secondary');
        p_prompt.textContent = 'Describe changes to plan and assumptions ...';
        interact_container.appendChild(p_prompt);
        let userTextArea = document.getElementById('user-textarea');
        if (userTextArea) userTextArea.focus();
      };
      
      document.body.classList.remove('generation-in-progress'); document.getElementById('user-textarea').disabled = false;
      let act_btn3 = document.getElementById('send-btn');
      if (act_btn3) {
        act_btn3.classList.remove('stop-mode');
        act_btn3.setAttribute('data-tooltip', 'Send request');
      }
      handle_textarea_input();
    } else {
      await execute_plan();
    }

  } catch (e) {
    let err = document.createElement('div');
    err.className = 'text-paragraph error-text';
    err.textContent = 'Error parsing JSON or creating plan: ' + e.message;
    content_div.appendChild(err);
    
    document.querySelectorAll('.running').forEach(el => {
      el.classList.remove('running');
      let spinner = el.querySelector('.spinner');
      if (spinner) spinner.remove();
      el.classList.add('error-text');
    });

    append_transcript_widget();
    document.body.classList.remove('generation-in-progress'); document.getElementById('user-textarea').disabled = false;
    let act_btn = document.getElementById('send-btn');
    if (act_btn) {
      act_btn.classList.remove('stop-mode');
      act_btn.setAttribute('data-tooltip', 'Send request');
    }
    handle_textarea_input();
    scrollToBottom();
  }
}

function handle_textarea_input() {
  var textarea = document.getElementById('user-textarea');
  var send_btn = document.getElementById('send-btn');
  if (textarea.value.trim().length >= widget_spec.min_prompt) {
    send_btn.classList.remove('disabled');
  } else {
    send_btn.classList.add('disabled');
  }
}

var prompt_history = [];
var history_index = 0;
var current_input_draft = '';

function handle_keydown(event) {
  var textarea = event.target;
  if (event.keyCode === 38) {  // Up arrow
    if (history_index > 0) {
      if (history_index === prompt_history.length) {
        current_input_draft = textarea.value;
      }
      history_index--;
      textarea.value = prompt_history[history_index];
      event.preventDefault();
      handle_textarea_input();
    }
  } else if (event.keyCode === 40) {  // Down arrow
    if (history_index < prompt_history.length) {
      history_index++;
      if (history_index === prompt_history.length) {
        textarea.value = current_input_draft;
      } else {
        textarea.value = prompt_history[history_index];
      }
      event.preventDefault();
      handle_textarea_input();
    }
  }
}

function handle_keypress(event) {
  if (event.keyCode === 13 && !event.shiftKey) {
    var textarea = document.getElementById('user-textarea');
    if (textarea.value.trim().length >= widget_spec.min_prompt) {
      event.preventDefault();
      send_user_prompt();
    }
  }
}

function initialize() {
  var textarea = document.getElementById('user-textarea');
  textarea.addEventListener('input', handle_textarea_input);
  textarea.addEventListener('keypress', handle_keypress);
  textarea.addEventListener('keydown', handle_keydown);
  document.getElementById('send-btn')
      .addEventListener('click', send_user_prompt);

  // Add global listener to collapse zippies on content click
  document.addEventListener('click', function(e) {
    var zippyContent = e.target.closest('.zippy-content');
    if (zippyContent) {
      // Only collapse if they didn't just select text
      if (window.getSelection().toString().length > 0) return;
      var details = zippyContent.closest('details');
      if (details) {
        details.removeAttribute('open');
      }
    }
  });

  // Add listener for example clicks
  var top_div = document.querySelector('.top');
  if (top_div) {
    top_div.addEventListener('click', function(e) {
      var target = e.target;
      if (target.closest('.example')) {
        if (document.body.classList.contains('generation-in-progress')) return;

        var text = target.closest('.example').textContent.trim();
        textarea.value = text;
        document.getElementById('send-btn').classList.remove('disabled');
        send_user_prompt();
      }
    });
  }
}
