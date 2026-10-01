'use strict';

(() => {
  const GUIDE = window.QT_GUIDE;
  const STORAGE_KEY = 'qt-book1-enquiry-final-v4-test';
  const AUTH_KEY = 'qt-book1-enquiry-final-v4-test-auth';
  const main = document.getElementById('main');
  const saveStatus = document.getElementById('saveStatus');
  const nav = document.getElementById('primaryNav');
  const menuButton = document.getElementById('menuButton');
  const overlay = document.getElementById('focusOverlay');
  const focusTextarea = document.getElementById('focusTextarea');
  let focusBinding = null;
  let focusReturn = null;
  let statusTimer;
  let isLocked = Boolean(localStorage.getItem(AUTH_KEY));

  const blankState = () => ({
    schemaVersion: GUIDE.schemaVersion,
    firstOpened: new Date().toISOString(),
    lastOpened: new Date().toISOString(),
    hasVisited: false,
    lastLocation: 'journey',
    visited: {},
    records: {},
    previousGuideResponses: [],
    stopped: false
  });

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (stored && stored.schemaVersion === GUIDE.schemaVersion) {
        const records = stored.records || {};
        Object.values(records).forEach(record => {
          record.fields = record.fields || {};
          record.rows = record.rows || [];
          record.additionalRows = record.additionalRows || [];
          record.revisitNotes = record.revisitNotes || [];
          record.returnEnabled = Boolean(record.returnEnabled || record.reviewDate);
          record.lockedAt = record.lockedAt || '';
        });
        return { ...blankState(), ...stored, records, visited: stored.visited || {}, previousGuideResponses: stored.previousGuideResponses || [] };
      }
    } catch (_) {}
    return blankState();
  }

  let state = loadState();

  function save(announce = true) {
    state.lastOpened = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (announce) {
      clearTimeout(statusTimer);
      saveStatus.classList.add('visible');
      statusTimer = setTimeout(() => saveStatus.classList.remove('visible'), 1400);
    }
  }

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const dateText = value => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value)) : '';
  const now = () => new Date().toISOString();
  const allChapters = () => GUIDE.stages.flatMap(stage => stage.chapters.map(chapter => ({ stage, chapter })));
  const findChapter = n => allChapters().find(item => item.chapter.n === Number(n));

  function recordKey(context, activityId) { return `${context}:${activityId}`; }
  function makeRecord(context, activityId, definition, meta = {}) {
    return {
      schemaVersion: GUIDE.schemaVersion,
      context,
      activityId,
      stageId: meta.stageId || '',
      chapterNumber: meta.chapterNumber || null,
      chapterTitle: meta.chapterTitle || '',
      activityTitle: definition.title,
      kind: definition.kind,
      privateAccount: Boolean(definition.privateAccount),
      createdAt: now(),
      changedAt: now(),
      state: 'untouched',
      fields: definition.repeatable ? {} : Object.fromEntries((definition.fields || []).map((_, i) => [i, ''])),
      rows: definition.repeatable ? [Object.fromEntries((definition.fields || []).map((_, i) => [i, '']))] : [],
      additionalRows: [],
      note: '',
      reviewDate: '',
      returnEnabled: false,
      lockedAt: '',
      revisitNotes: []
    };
  }

  function getRecord(context, activityId, definition, meta) {
    const key = recordKey(context, activityId);
    if (!state.records[key]) state.records[key] = makeRecord(context, activityId, definition, meta);
    return state.records[key];
  }

  function hasContent(record) {
    const fields = Object.values(record.fields || {}).some(v => String(v).trim());
    const rows = [...(record.rows || []), ...(record.additionalRows || [])].some(row => Object.values(row).some(v => String(v).trim()));
    return fields || rows || Boolean((record.note || '').trim()) || Boolean(record.reviewDate) || (record.revisitNotes || []).some(n => n.text.trim());
  }

  function effectiveState(record) {
    if (record.state !== 'untouched') return record.state;
    return hasContent(record) ? 'saved' : 'untouched';
  }

  function stateLabel(value) {
    return ({ untouched: 'No position selected', saved: 'Written response', settled: 'Settled for now', unknown: 'I don’t know yet' })[value] || value;
  }

  function bytesToBase64(bytes) { return btoa(String.fromCharCode(...bytes)); }
  function base64ToBytes(value) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
  async function passwordHash(password, salt, iterations = 150000) {
    if (window.crypto?.subtle) {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
      return bytesToBase64(new Uint8Array(bits));
    }
    let hash = 2166136261;
    const text = `${bytesToBase64(salt)}:${password}`;
    for (let round = 0; round < 12000; round += 1) for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i) ^ round, 16777619) >>> 0;
    return `local-${hash.toString(16).padStart(8, '0')}`;
  }
  async function passwordMatches(password) {
    try {
      const auth = JSON.parse(localStorage.getItem(AUTH_KEY));
      return Boolean(auth?.salt && auth?.hash) && await passwordHash(password, base64ToBytes(auth.salt), auth.iterations) === auth.hash;
    } catch (_) { return false; }
  }
  async function storePassword(password) {
    const salt = window.crypto?.getRandomValues ? crypto.getRandomValues(new Uint8Array(16)) : Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
    const iterations = 150000;
    localStorage.setItem(AUTH_KEY, JSON.stringify({ salt: bytesToBase64(salt), hash: await passwordHash(password, salt, iterations), iterations }));
  }

  function route(target, replace = false) {
    const hash = `#${target}`;
    if (replace) history.replaceState(null, '', hash); else location.hash = hash;
    if (location.hash === hash) render();
  }

  function setCurrentNav(active) {
    nav.querySelectorAll('button').forEach(button => {
      if (button.dataset.route === active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function page(content, narrow = false) { main.innerHTML = `<div class="page${narrow ? ' narrow' : ''}">${content}</div>`; }
  function paragraphs(items) { return (items || []).map(p => `<p>${esc(p)}</p>`).join(''); }

  function welcome() {
    setCurrentNav('');
    if (state.hasVisited) {
      page(`<section class="hero"><div class="hero-copy"><span class="eyebrow">${esc(GUIDE.title)}</span><h1>Welcome back</h1><p class="lede">Your entries are stored in this browser on this device. You can return to your last place, look across the whole Book journey, or see your Stage positions in My Enquiry.</p><p>Your entries are saved automatically as you write. You can close the Guide whenever you need to and return later using the same browser and device.</p><div class="actions"><button class="button" data-go="${esc(state.lastLocation || 'journey')}">Resume where you left off</button><button class="button secondary" data-go="journey">View the journey</button><button class="button secondary" data-go="enquiry">Open My Enquiry</button></div></div></section>`);
    } else {
      page(`<section class="hero"><div class="hero-copy"><span class="eyebrow">Interactive Enquiry Guide</span><h1>${esc(GUIDE.title)}</h1><p class="lede">This Guide is designed to be used alongside <em>When Your Life Still Works — But No Longer Fits</em>. It does not repeat the Book’s teaching. It gives you somewhere to work with what the Book has already opened up.</p><section class="how-to" aria-labelledby="how-to-title"><h2 id="how-to-title">Here’s how the Guide works</h2><p>This is not a course to complete. The six Stages provide structure, but the journey is not a straight line: move forwards, backwards or revisit earlier material. Chapters are working spaces. Stage endings bring your own material together, and My Enquiry helps you see the bigger picture. The Guide does not interpret, score or judge what you write. Your entries are saved automatically, and you can begin again if the current Guide no longer feels useful.</p></section><p>Write as much or as little as you need. Skip a question, return later, or add a note when the questions do not capture what matters. If you are using the hosted Guide, bookmarking it may make it easier to return.</p><div class="notice"><strong>Before you begin — storage and backup.</strong> This is the hosted testing version of the Guide. Your entries are stored in this browser on this device; they are not stored in an online account or sent to Quietly Tough. If you use a different browser or device, your entries will not be there. Anyone who can use this browser profile may be able to open the Guide and see what you have written. Export a copy regularly if there is anything you would not want to lose. Clearing browser data, changing devices or other browser changes may remove your saved entries. Exported copies cannot currently be imported back into the Guide.</div><div class="actions"><button class="button" data-go="journey">View the journey</button><button class="button secondary" data-go="stage-fog-entry">Begin at Fog</button></div></div></section>`);
    }
  }

  function chapterStates(chapterNumber) {
    const records = Object.values(state.records).filter(r => r.chapterNumber === chapterNumber && (hasContent(r) || r.state !== 'untouched'));
    const labels = new Set();
    if (state.visited[`chapter-${chapterNumber}`]) labels.add('Visited');
    records.forEach(r => labels.add(stateLabel(effectiveState(r))));
    return [...labels];
  }

  function journey() {
    setCurrentNav('journey');
    const cards = GUIDE.stages.map(stage => `<section class="stage-card"><div class="stage-head"><span class="stage-number">${stage.number}</span><div><h2>${esc(stage.name)}</h2><p>${esc(stage.line)}. Chapters ${stage.chapters[0].n} to ${stage.chapters[2].n}.</p></div><button class="button small secondary" data-go="stage-${stage.id}-entry">Enter ${esc(stage.name)}</button></div><ol class="chapter-list">${stage.chapters.map(chapter => { const tags = chapterStates(chapter.n); const current = state.lastLocation === `chapter-${chapter.n}`; return `<li><button class="chapter-link" data-go="chapter-${chapter.n}"><span class="chapter-number">${chapter.n}</span><span>${esc(chapter.title)}</span><span class="state-tags">${current ? '<span class="tag current">Current place</span>' : ''}${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</span></button></li>`; }).join('')}</ol></section>`).join('');
    page(`<section class="journey-intro"><span class="eyebrow">Journey</span><h1>The Book has an order. Your life may not.</h1><p class="lede">The six stages offer a route for enquiry: notice before interpreting; make room to distinguish what is present; examine what matters when worthwhile things compete; bring judgement into contact with actual capacity; meet the world beyond your own thinking; and return when life changes.</p><p>Each stage contains three chapters. You may follow them in order or go directly to the chapter you need. Nothing here is locked, and nothing is marked complete.</p></section><div class="stage-grid">${cards}<section class="stage-card return-card"><div class="stage-head"><span class="stage-number">↩</span><div><h2>Book-close reflection</h2><p>A separate place to look across the six Stage positions and anything still waiting for your return.</p></div><button class="button small secondary" data-go="return-point">Open reflection</button></div></section></div>`);
  }

  function stageEntry(stage) {
    setCurrentNav('current');
    rememberLocation(`stage-${stage.id}-entry`);
    const def = { kind: 'Stage opening', title: 'Where you are as you begin', fields: [stageBaselinePrompts[stage.id]] };
    const record = getRecord(`stage-${stage.id}`, 'baseline', def, { stageId: stage.id });
    const key = recordKey(`stage-${stage.id}`, 'baseline');
    const baseline = record.lockedAt ? `<section class="snapshot"><span class="component-label">Fixed Stage-opening snapshot</span><h2>Where you were when you began this Stage</h2><p>${esc(record.fields[0] || 'No opening response was recorded.')}</p><p class="quiet">This snapshot is kept as it was when you moved into the Stage.</p></section>` : `<section class="activity baseline" data-record-section="${esc(key)}"><span class="component-label">Stage opening</span><h2>Where you are as you begin</h2>${renderField(key, 0, def.fields[0], record.fields[0] || '')}<p class="quiet">When you move into this Stage, this response becomes a fixed snapshot.</p></section>`;
    page(`<span class="eyebrow">Stage ${stage.number} · ${esc(stage.name)}</span><h1>${esc(stage.line)}</h1><div class="lede">${paragraphs(stage.entry)}</div>${baseline}<div class="chapter-nav"><button class="button secondary" data-go="journey">View the Journey</button><span></span><button class="button" data-enter-stage="${esc(stage.id)}" data-go="chapter-${stage.chapters[0].n}">Continue to Chapter ${stage.chapters[0].n}</button></div>`, true);
    bindInputs();
  }

  function transition(stage) {
    setCurrentNav('current');
    rememberLocation(`stage-${stage.id}-transition`);
    lockStageBaseline(stage.id);
    const def = { kind: 'Stage position', title: `Where I am after ${stage.name}`, fields: ['Looking across this Stage, where are you now?', 'What, if anything, do you want to carry forward from here?'] };
    const record = getRecord(`stage-${stage.id}`, 'transition', def, { stageId: stage.id });
    const key = recordKey(`stage-${stage.id}`, 'transition');
    const nextStage = GUIDE.stages[stage.number];
    page(`<span class="eyebrow">Stage ${stage.number} transition</span><h1>Looking across ${esc(stage.name)}</h1>${paragraphs(stage.transition.explored)}${renderStageAssembly(stage)}<section class="activity stage-position" data-record-section="${esc(key)}"><span class="component-label">Stage position</span><h2>Where you are now</h2>${renderField(key, 0, def.fields[0], record.fields[0] || '')}${renderField(key, 1, def.fields[1], record.fields[1] || '')}${renderStagePosition(key, record)}${renderReturnChoice(key, record)}</section><h2>Where the enquiry might move next</h2><p>${esc(stage.transition.next)}</p><div class="actions">${nextStage ? `<button class="button" data-go="stage-${nextStage.id}-entry">Continue to ${esc(nextStage.name)}</button>` : '<button class="button" data-go="return-point">Open the Book-close reflection</button>'}<button class="button secondary" data-go="journey">View the Journey</button><button class="button secondary" data-go="enquiry">Open My Enquiry</button><button class="button subtle" data-leave-guide>Leave the Guide for now</button></div>`, true);
    bindInputs();
  }

  function renderActivity(context, activityId, def, meta) {
    const record = getRecord(context, activityId, def, meta);
    const key = recordKey(context, activityId);
    const fields = def.repeatable ? renderRows(key, def, record) : (def.fields || []).map((label, index) => renderField(key, index, label, record.fields[index] || '')).join('');
    const quick = (def.quickOptions || []).length ? `<div class="choice-row" aria-label="Available observations">${def.quickOptions.map(option => `<button type="button" class="button small subtle" data-quick="${esc(option)}" data-record="${esc(key)}">${esc(option)}</button>`).join('')}</div>` : '';
    const extra = def.kind === 'Map' ? `${renderAdditionalRows(key, record)}<button type="button" class="button secondary small add-row" data-add-extra-row="${esc(key)}">Add another map row</button>` : '';
    const startingPoints = (def.startingPoints || []).length ? `<details class="starter-help"><summary>Need somewhere to start?</summary><ul>${def.startingPoints.map(prompt => `<li>${esc(prompt)}</li>`).join('')}</ul></details>` : '';
    return `<section class="activity${activityId === 'primary' ? '' : ' optional'}" data-record-section="${esc(key)}"><div class="activity-head"><div><span class="component-label">${esc(def.kind)}</span><h2>${def.privateAccount ? '<span class="tag">Personal account</span> ' : ''}${esc(def.title)}</h2></div></div>${paragraphs(def.intro)}${startingPoints}${fields}${def.repeatable ? `<button type="button" class="button secondary small add-row" data-add-row="${esc(key)}">Add another row</button>` : ''}${extra}${quick}<div class="section-memory"><span class="component-label">Add a note</span><label for="note-${slug(key)}">What, if anything, do you want to remember from this section?</label><textarea class="compact" id="note-${slug(key)}" data-record="${esc(key)}" data-part="note">${esc(record.note)}</textarea><div class="field-tools"><button type="button" class="text-button" data-expand="${esc(key)}" data-target-part="note" data-label="What, if anything, do you want to remember from this section?">Expand writing space</button></div></div>${def.experiment || def.ongoing ? renderReturnChoice(key, record) : ''}${def.outro ? `<p>${esc(def.outro)}</p>` : ''}</section>`;
  }

  function renderField(key, index, label, value, rowIndex = null) {
    const id = `field-${slug(key)}-${rowIndex === null ? '' : `${rowIndex}-`}${index}`;
    return `<div class="field"><label for="${id}">${esc(label)}</label><textarea id="${id}" data-record="${esc(key)}" data-part="${rowIndex === null ? 'field' : 'row'}" data-index="${index}"${rowIndex === null ? '' : ` data-row="${rowIndex}"`}>${esc(value)}</textarea><div class="field-tools"><button type="button" class="text-button" data-expand="${esc(key)}" data-target-part="${rowIndex === null ? 'field' : 'row'}" data-index="${index}"${rowIndex === null ? '' : ` data-row="${rowIndex}"`} data-label="${esc(label)}">Expand writing space</button></div></div>`;
  }

  function renderRows(key, def, record) {
    return record.rows.map((row, rowIndex) => `<div class="structured-row" style="--cols:${Math.min(def.fields.length, 3)}" aria-label="${esc(def.title)} row ${rowIndex + 1}">${def.fields.map((label, index) => renderField(key, index, label, row[index] || '', rowIndex)).join('')}${record.rows.length > 1 ? `<button type="button" class="text-button remove-row" data-remove-row="${esc(key)}" data-row="${rowIndex}">Remove this row</button>` : ''}</div>`).join('');
  }

  function renderAdditionalRows(key, record) {
    return (record.additionalRows || []).map((row, rowIndex) => `<div class="structured-row" style="--cols:1" aria-label="Additional map row ${rowIndex + 1}">${renderAdditionalField(key, rowIndex, row.value || '')}<button type="button" class="text-button remove-row" data-remove-extra-row="${esc(key)}" data-row="${rowIndex}">Remove this row</button></div>`).join('');
  }

  function renderAdditionalField(key, rowIndex, value) {
    const id = `extra-${slug(key)}-${rowIndex}`;
    return `<div class="field"><label for="${id}">Additional map row</label><textarea id="${id}" data-record="${esc(key)}" data-part="additionalRow" data-row="${rowIndex}">${esc(value)}</textarea><div class="field-tools"><button type="button" class="text-button" data-expand="${esc(key)}" data-target-part="additionalRow" data-row="${rowIndex}" data-label="Additional map row">Expand writing space</button></div></div>`;
  }

  function renderStagePosition(key, record) {
    const current = effectiveState(record);
    const controls = [['settled', 'Settled for now'], ['unknown', 'I don’t know yet']];
    return `<div class="position-choice"><span class="field-label">If either phrase helps, you can add it</span><div class="choice-row">${controls.map(([value, label]) => `<button type="button" class="state-button" data-set-state="${value}" data-record="${esc(key)}" aria-pressed="${current === value}">${esc(label)}</button>`).join('')}</div><p class="state-summary">You do not need to choose a label if your own words already say enough.</p></div>`;
  }

  function renderReturnChoice(key, record) {
    return `<fieldset class="return-choice"><legend>Would you like to come back to this?</legend><label class="check-label"><input type="checkbox" data-record="${esc(key)}" data-part="returnEnabled" ${record.returnEnabled ? 'checked' : ''}> Yes</label><div class="field return-date${record.returnEnabled ? '' : ' hidden'}"><label for="review-${slug(key)}">When would you like to return to this? <span class="quiet">(optional)</span></label><input type="date" id="review-${slug(key)}" data-record="${esc(key)}" data-part="reviewDate" value="${esc(record.reviewDate)}"></div></fieldset>`;
  }

  function chapterView(stage, chapter) {
    setCurrentNav('current');
    lockStageBaseline(stage.id);
    rememberLocation(`chapter-${chapter.n}`);
    state.visited[`chapter-${chapter.n}`] = now();
    save(false);
    const meta = { stageId: stage.id, chapterNumber: chapter.n, chapterTitle: chapter.title };
    const primaryDefinition = startingPoints[chapter.n] ? { ...chapter.primary, startingPoints: startingPoints[chapter.n] } : chapter.primary;
    const activities = [renderActivity(`chapter-${chapter.n}`, 'primary', primaryDefinition, meta)];
    if (chapter.optional) activities.push(renderActivity(`chapter-${chapter.n}`, 'optional', chapter.optional, meta));
    if (chapter.extra) activities.push(renderActivity(`chapter-${chapter.n}`, 'extra', chapter.extra, meta));
    const synthesis = renderSynthesis(stage, chapter, meta);
    const previous = chapter.n === 1 ? `stage-${stage.id}-entry` : `chapter-${chapter.n - 1}`;
    const next = chapter.n % 3 === 0 ? `stage-${stage.id}-transition` : `chapter-${chapter.n + 1}`;
    page(`<span class="eyebrow">Stage ${stage.number} · ${esc(stage.name)} · Chapter ${chapter.n}</span><h1>${esc(chapter.title)}</h1><div class="lede">${paragraphs(chapter.entry)}</div>${activities.join('')}<section class="landing"><span class="component-label">Take stock</span><h2>What is visible now?</h2><p>${esc(chapter.landing)}</p><p class="positions"><strong>Your possible next positions:</strong> ${esc(chapter.positions)}</p>${chapter.support ? `<div class="notice"><strong>When reflection is not enough.</strong> ${esc(chapter.support)}</div>` : ''}</section>${synthesis}<p class="autosave-note">Your entries are saved automatically.</p><div class="chapter-nav four"><button class="button secondary" data-go="${previous}">Previous</button><button class="button subtle stage-link" data-go="stage-${stage.id}-entry">Back to ${esc(stage.name)}</button><button class="button" data-go="${next}">${chapter.n % 3 === 0 ? `Look across ${esc(stage.name)}` : 'Next chapter'}</button><button class="button subtle leave-link" data-leave-guide>Leave the Guide for now</button></div>`, true);
    bindInputs();
  }

  const synthesisPrompts = {
    1: 'Looking across what you have noticed about change and fit, where do you think you are now?',
    2: 'Looking across what you have noticed about comfort, protection and constraint, where do you think you are now?',
    3: 'Looking across the different voices and signals you noticed, where do you think you are now?',
    4: 'Looking across what attention made visible, where do you think you are now?',
    5: 'Looking across the quiet no and what surrounds it, where do you think you are now?',
    6: 'Looking across what appeared when you made space, where do you think you are now?',
    7: 'Looking across the values, claims and trade-offs you noticed, where do you think you are now?',
    8: 'Looking across the intention and the conditions around it, where do you think you are now?',
    9: 'Looking across the doubt, evidence and context you noticed, where do you think you are now?',
    10: 'Looking across the demands and capacity you mapped, where do you think you are now?',
    11: 'Looking across what you noticed about rest and permission, where do you think you are now?',
    12: 'Looking across movement, pauses and endings, where do you think you are now?',
    13: 'Looking across the feelings, facts and choices you noticed, where do you think you are now?',
    14: 'Looking across the limit, pressure and consequences you noticed, where do you think you are now?',
    15: 'Looking across your intention, impact and the room around you, where do you think you are now?',
    16: 'Looking across the signals, conditions and possible returns you noticed, where do you think you are now?',
    17: 'Looking across what can and cannot be resolved here, where do you think you are now?',
    18: 'Looking across the pause and what it revealed, where do you think you are now?'
  };

  const stageBaselinePrompts = {
    fog: 'As you begin Fog, what feels most present for you?',
    filter: 'As you begin Filter, what feels most present or most difficult to distinguish?',
    focus: 'As you begin Focus, what is asking most clearly for your attention?',
    flow: 'As you begin Flow, what feels most present in your capacity, pace or use of energy?',
    rise: 'As you begin Rise, what feels most present in the world beyond your own thinking?',
    rhythm: 'As you begin Rhythm, what has changed or is asking to be revisited?'
  };

  const startingPoints = {
    1: ['You might begin with a recent moment when something familiar felt different.', 'What changed before you noticed the feeling?', 'What would someone close to the situation have seen?'],
    2: ['Think about one routine, role or request that feels easy to keep repeating.', 'What does it protect?', 'What does it make harder to notice or change?'],
    3: ['Start with one recent moment when your response surprised you.', 'What happened just before it?', 'Which part sounded familiar, and which part felt newer?'],
    5: ['Think of one recent moment when you nearly said no, or wished you had.', 'What did you do, avoid, postpone or keep carrying?', 'What made the answer difficult to hear?'],
    7: ['Begin with one decision where two worthwhile things compete.', 'What would each choice protect?', 'Who else is affected, and what might they see differently?'],
    10: ['Picture one demanding day rather than an average week.', 'Which effort was visible, and which effort stayed hidden?', 'What was restored, and what was only deferred?'],
    13: ['Start with one moment that still returns to you.', 'What are the facts you can name without interpreting them?', 'What changed between the first feeling and the next one?'],
    14: ['Think about the most recent time the limit was tested.', 'What happened before you noticed the pressure?', 'What did you do, avoid, postpone or keep carrying?'],
    17: ['You might begin with one sentence about what remains true.', 'What is still yours to decide, and what is not?', 'What would carrying this with help look like?'],
    18: ['Think about the last moment when a small pause might have helped.', 'What was happening around you?', 'What became possible—or stayed unchanged—after the pause?']
  };

  function renderSynthesis(stage, chapter, meta) {
    const definition = {
      kind: 'Chapter synthesis',
      title: 'Where am I now?',
      fields: [synthesisPrompts[chapter.n], 'What, if anything, do you want to do next with what you’ve noticed?']
    };
    const record = getRecord(`chapter-${chapter.n}`, 'synthesis', definition, meta);
    const key = recordKey(`chapter-${chapter.n}`, 'synthesis');
    return `<section class="activity synthesis" data-record-section="${esc(key)}"><div class="activity-head"><div><span class="component-label">Chapter synthesis</span><h2>Where am I now?</h2></div></div>${renderField(key, 0, definition.fields[0], record.fields[0] || '')}<div class="field"><label for="field-${slug(key)}-1">${esc(definition.fields[1])}</label><p class="field-guidance">You might want more evidence, a conversation, a small test, more time, or simply to leave this open. If something else fits better, write that instead.</p><textarea id="field-${slug(key)}-1" data-record="${esc(key)}" data-part="field" data-index="1">${esc(record.fields[1] || '')}</textarea><div class="field-tools"><button type="button" class="text-button" data-expand="${esc(key)}" data-target-part="field" data-index="1" data-label="${esc(definition.fields[1])}">Expand writing space</button></div></div>${renderReturnChoice(key, record)}</section>`;
  }

  function lockStageBaseline(stageId) {
    const stage = GUIDE.stages.find(item => item.id === stageId);
    if (!stage) return;
    const def = { kind: 'Stage opening', title: 'Where you are as you begin', fields: [stageBaselinePrompts[stageId]] };
    const record = getRecord(`stage-${stageId}`, 'baseline', def, { stageId });
    if (!record.lockedAt) { record.lockedAt = now(); record.changedAt = now(); save(false); }
  }

  function renderStageAssembly(stage) {
    const baseline = state.records[`stage-${stage.id}:baseline`];
    const chapters = stage.chapters.map(chapter => {
      const record = state.records[`chapter-${chapter.n}:synthesis`];
      return `<article class="assembly-item"><span class="eyebrow">Chapter ${chapter.n} · ${esc(chapter.title)}</span><h3>Where I am now</h3><p>${esc(record?.fields?.[0] || 'No Chapter position recorded.')}</p><h3>What I may want to do next</h3><p>${esc(record?.fields?.[1] || 'No next thought recorded.')}</p>${record?.returnEnabled && record.reviewDate ? `<p class="enquiry-meta">Return on ${esc(dateText(record.reviewDate))}</p>` : ''}<button class="text-button" data-go="chapter-${chapter.n}">Open Chapter ${chapter.n}</button></article>`;
    }).join('');
    return `<section class="stage-assembly"><span class="component-label">Your Stage so far</span><h2>The building blocks together</h2><article class="snapshot compact"><h3>Where you were when you began this Stage</h3><p>${esc(baseline?.fields?.[0] || 'No Stage-opening snapshot was recorded.')}</p></article><div class="assembly-grid">${chapters}</div></section>`;
  }

  function rememberLocation(location) {
    state.hasVisited = true;
    state.lastLocation = location;
    save(false);
  }

  function recordSummary(record) {
    const values = [...Object.values(record.fields || {}), ...(record.rows || []).flatMap(row => Object.values(row)), record.note || ''].filter(v => String(v).trim());
    return values.length ? String(values[0]).slice(0, 180) : 'No written response yet.';
  }

  function enquiry(view = 'journey') {
    setCurrentNav('enquiry');
    const content = view === 'return' ? renderReturnList() : renderStageJourney();
    page(`<span class="eyebrow">My Enquiry</span><h1>Your movement through the six Stages</h1><p class="lede">This brings together what you wrote at the beginning and end of each Stage. It uses your own words and does not interpret, summarise, score or judge them.</p><div class="tabs" role="tablist" aria-label="My Enquiry views"><button role="tab" aria-selected="${view === 'journey'}" data-enquiry-view="journey">Stage journey</button><button role="tab" aria-selected="${view === 'return'}" data-enquiry-view="return">Things to Return To</button></div><div class="enquiry-list">${content}</div>`, false);
    bindInputs();
  }

  function renderStageJourney() {
    const stages = GUIDE.stages.map(stage => {
      const baseline = state.records[`stage-${stage.id}:baseline`];
      const end = state.records[`stage-${stage.id}:transition`];
      return `<article class="enquiry-item stage-journey-item"><header><div><span class="eyebrow">Stage ${stage.number}</span><h2>${esc(stage.name)}</h2></div><button class="button small secondary" data-go="stage-${stage.id}-transition">Open Stage end</button></header><div class="stage-comparison"><div><strong>Where you were when you began this Stage</strong><p>${esc(baseline?.fields?.[0] || 'No Stage-opening snapshot recorded.')}</p></div><div><strong>Where you are now</strong><p>${esc(end?.fields?.[0] || 'No Stage-end position recorded.')}</p>${end && ['settled', 'unknown'].includes(end.state) ? `<p class="enquiry-meta">${esc(stateLabel(end.state))}</p>` : ''}</div><div><strong>What you want to carry forward</strong><p>${esc(end?.fields?.[1] || 'Nothing recorded yet.')}</p></div></div></article>`;
    }).join('');
    const close = state.records['return-point:return'];
    const closeLabels = ['What stands out now', 'How I understand the question now', 'What I want to carry forward', 'Anything else I wanted to capture'];
    const closeItem = close && hasContent(close) ? `<article class="enquiry-item book-close-summary"><span class="eyebrow">Book-close reflection</span><h2>Your final reflection</h2><div class="enquiry-material">${closeLabels.map((label, index) => String(close.fields?.[index] || '').trim() ? `<div><strong>${esc(label)}</strong><p>${esc(close.fields[index])}</p></div>` : '').join('')}</div><button class="button small secondary" data-go="return-point">Open Book-close reflection</button></article>` : '';
    return stages + closeItem;
  }

  function renderReturnList() {
    const items = Object.entries(state.records)
      .filter(([, record]) => record.returnEnabled && record.reviewDate)
      .sort((a, b) => a[1].reviewDate.localeCompare(b[1].reviewDate));
    if (!items.length) return `<div class="empty">Nothing has an active return date. Add or change a return date in a Chapter activity, Chapter synthesis or Stage end and it will appear here.</div>`;
    return items.map(([key, record]) => {
      const place = record.chapterNumber ? `Chapter ${record.chapterNumber} · ${record.chapterTitle}` : GUIDE.stages.find(stage => stage.id === record.stageId)?.name || 'Book-close reflection';
      const target = record.chapterNumber ? `chapter-${record.chapterNumber}` : record.context === 'return-point' ? 'return-point' : `stage-${record.stageId}-transition`;
      return `<article class="enquiry-item return-item"><div><span class="eyebrow">${esc(place)}</span><h3>${esc(record.activityTitle)}</h3><p>${esc(recordSummary(record))}</p></div><div class="return-actions"><div class="field"><label for="return-list-${slug(key)}">Return date</label><input type="date" id="return-list-${slug(key)}" data-record="${esc(key)}" data-part="reviewDate" value="${esc(record.reviewDate)}"></div><button class="button small secondary" data-go="${esc(target)}">Open</button><button class="button small subtle" data-clear-return="${esc(key)}">Remove date</button></div></article>`;
    }).join('');
  }

  function renderExistingRecord(key, record) {
    const def = findDefinition(record);
    if (!def) return `<p class="quiet">Open this item in its original context to edit it.</p>`;
    let body = def.repeatable ? renderRows(key, def, record) + `<button type="button" class="button secondary small add-row" data-add-row="${esc(key)}">Add another row</button>` : def.fields.map((label, i) => renderField(key, i, label, record.fields[i] || '')).join('');
    if (def.kind === 'Map') body += `${renderAdditionalRows(key, record)}<button type="button" class="button secondary small add-row" data-add-extra-row="${esc(key)}">Add another map row</button>`;
    return `${body}<div class="field"><label for="enquiry-note-${slug(key)}">Add a note</label><textarea class="compact" id="enquiry-note-${slug(key)}" data-record="${esc(key)}" data-part="note">${esc(record.note)}</textarea></div>`;
  }

  function findDefinition(record) {
    if (record.context === 'return-point') return { kind: 'Book-close reflection', title: 'Looking across the Book', fields: ['Looking back across your six Stage positions, what stands out to you now?', 'How do you understand the question you brought to this Book now?', 'What, if anything, do you want to carry forward from here?', 'Anything else you want to capture here?'] };
    if (record.context.startsWith('stage-')) {
      const stage = GUIDE.stages.find(s => s.id === record.stageId);
      if (!stage) return null;
      if (record.activityId === 'baseline') return { kind: 'Stage opening', title: 'Where you were when you began this Stage', fields: [stageBaselinePrompts[stage.id]] };
      if (record.activityId === 'transition') return { kind: 'Stage position', title: `Where I am after ${stage.name}`, fields: ['Looking across this Stage, where are you now?', 'What, if anything, do you want to carry forward from here?'] };
      return null;
    }
    const found = findChapter(record.chapterNumber);
    if (record.activityId === 'synthesis' && found) return { kind: 'Chapter synthesis', title: 'Where am I now?', fields: [synthesisPrompts[record.chapterNumber], 'What, if anything, do you want to do next with what you’ve noticed?'] };
    return found ? found.chapter[record.activityId] : null;
  }

  function dataPage() {
    setCurrentNav('data');
    const previous = state.previousGuideResponses || [];
    page(`<span class="eyebrow">Export and data</span><h1>Your Guide in this browser</h1><p class="lede">Your entries are stored in this browser on this device. They are not stored in an online account.</p><div class="notice"><strong>Access and backup.</strong> This testing version keeps your entries only in this browser on this device. They are not sent to Quietly Tough. A different browser or device will not have them. Anyone who can use this browser profile may be able to open the Guide and see what you have written. Export a copy regularly if there is anything you would not want to lose. Clearing browser data, changing devices or other browser changes may remove your saved entries. Exported copies cannot currently be imported back into the Guide.</div><div class="data-grid"><section class="data-panel"><h2>Export</h2><p>The plain-text export includes your saved activity material, Stage snapshots and positions, Chapter syntheses, return dates and Book-close reflection.</p><button class="button" data-export>Export my material</button></section>${passwordPanel()}<section class="data-panel full fresh-start"><h2>Begin again when the snapshot no longer fits</h2><p>The Guide is always a snapshot of your changing life. If that snapshot no longer feels useful, you can export anything you want to keep, clear the Guide and begin again from where you are now.</p><p>Some people may return to the same enquiry for a long time. Others may prefer a fresh start more often. There is no right pattern. Use the Guide in the way that fits your life.</p></section><section class="data-panel"><h2>Previous Guide responses</h2>${previous.length ? `<p>${previous.length} previous response record${previous.length === 1 ? '' : 's'} remains under its original label.</p><button class="button secondary" data-export-previous>Export previous responses</button><button class="button danger" data-delete-previous>Delete previous-response archive</button>` : '<p>No previous-response archive is held in this test Guide.</p>'}</section><section class="data-panel danger-zone"><h2>Clear this Guide and begin again</h2><p>This permanently removes every entry, note, Stage position, return date, saved place and current password belonging to this separate test Guide from this browser. It does not affect the existing live Guide.</p><button class="button danger" data-begin-reset>Clear the Guide</button></section></div>`, false);
  }

  function passwordPanel() {
    const hasPassword = Boolean(localStorage.getItem(AUTH_KEY));
    return `<section class="data-panel"><h2>Add a password to this Guide — optional</h2><p>This can help stop casual users of this browser from opening your entries. It is not a full security system.</p><p>The password remains on this browser and device. It is not sent to Quietly Tough, and Quietly Tough cannot see, recover or reset it. Your browser or password manager may offer to remember it.</p>${hasPassword ? `<form data-password-change><div class="field"><label for="current-password">Current password</label><input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required></div><div class="field"><label for="new-password">New password</label><input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="6" required></div><div class="field"><label for="confirm-new-password">Confirm new password</label><input id="confirm-new-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="6" required></div><div class="actions"><button class="button small" type="submit">Change password</button><button class="button small subtle" type="button" data-remove-password>Remove password</button></div></form>` : `<form data-password-add><div class="field"><label for="new-password">Choose a password</label><input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="6" required></div><div class="field"><label for="confirm-new-password">Confirm password</label><input id="confirm-new-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="6" required></div><button class="button small" type="submit">Add password</button></form>`}<p class="form-message" role="status" aria-live="polite"></p>${hasPassword ? '<p>If you know the current password, you can change or remove it without losing your entries.</p>' : ''}</section>`;
  }

  function returnPoint() {
    setCurrentNav('current');
    rememberLocation('return-point');
    const fields = ['Looking back across your six Stage positions, what stands out to you now?', 'How do you understand the question you brought to this Book now?', 'What, if anything, do you want to carry forward from here?', 'Anything else you want to capture here?'];
    const def = { kind: 'Book-close reflection', title: 'Looking across the Book', fields };
    const record = getRecord('return-point', 'return', def, {});
    const key = recordKey('return-point', 'return');
    page(`<span class="eyebrow">Book-close reflection</span><h1>Looking across your six Stage positions</h1><p class="lede">This is not a completion screen or a judgement about change. It brings your own saved material together so you can notice what stands out now.</p>${renderBookOverview()}<section class="activity book-close" data-record-section="${esc(key)}"><span class="component-label">Your reflection</span>${fields.map((label, index) => renderField(key, index, label, record.fields[index] || '')).join('')}</section><p class="lede">The judgement remains yours.</p><div class="actions"><button class="button secondary" data-go="journey">View the Journey</button><button class="button secondary" data-go="enquiry">Open My Enquiry</button><button class="button secondary" data-go="data">Export my material</button><button class="button subtle" data-leave-guide>Leave the Guide for now</button></div>`, true);
    bindInputs();
  }

  function renderBookOverview() {
    const stages = GUIDE.stages.map(stage => {
      const baseline = state.records[`stage-${stage.id}:baseline`];
      const end = state.records[`stage-${stage.id}:transition`];
      return `<article class="assembly-item"><span class="eyebrow">Stage ${stage.number}</span><h3>${esc(stage.name)}</h3><strong>Where you began</strong><p>${esc(baseline?.fields?.[0] || 'No snapshot recorded.')}</p><strong>Where you are now</strong><p>${esc(end?.fields?.[0] || 'No Stage-end position recorded.')}</p><strong>What you want to carry</strong><p>${esc(end?.fields?.[1] || 'Nothing recorded.')}</p></article>`;
    }).join('');
    const returns = Object.values(state.records).filter(record => record.returnEnabled && record.reviewDate).sort((a, b) => a.reviewDate.localeCompare(b.reviewDate));
    return `<section class="book-overview"><h2>Your Stage positions</h2><div class="assembly-grid">${stages}</div><h2>Things still waiting for your return</h2>${returns.length ? `<ul class="return-summary">${returns.map(record => `<li><strong>${esc(dateText(record.reviewDate))}</strong> — ${esc(record.activityTitle)}</li>`).join('')}</ul>` : '<p>Nothing currently has an active return date.</p>'}</section>`;
  }

  function lockScreen(message = '') {
    setCurrentNav('');
    page(`<section class="auth-screen"><span class="eyebrow">Interactive Enquiry Guide</span><h1>Open your Guide</h1><p>Enter the password you added for this Guide on this browser and device.</p><form data-unlock><div class="field"><label for="unlock-password">Password</label><input id="unlock-password" name="password" type="password" autocomplete="current-password" required autofocus></div><button class="button" type="submit">Open the Guide</button></form><p class="form-message" role="status" aria-live="polite">${esc(message)}</p><button class="text-button" data-go="forgot-password">Forgot your password?</button></section>`, true);
  }

  function forgotPassword() {
    setCurrentNav('');
    page(`<section class="auth-screen"><span class="eyebrow">Password help</span><h1>Forgot your password?</h1><p>Your Guide password is stored only on this device. It is not sent to us, and we cannot recover or reset it for you.</p><p>The entries already stored in this Guide are still in this browser on this device, but without the password you cannot open them through the Guide.</p><p>If you have an exported copy, keep it somewhere safe before continuing.</p><p>To use the Guide again, you will need to reset it and start again. Resetting will permanently delete the entries stored in this Guide in this browser on this device.</p><p>You can go back and try other passwords before deciding.</p><div class="actions"><button class="button danger" data-go="confirm-reset">Reset the Guide and start again</button><button class="button secondary" data-go="locked">Go back</button></div></section>`, true);
  }

  function confirmReset() {
    setCurrentNav('');
    page(`<section class="auth-screen danger-zone"><span class="eyebrow">Final confirmation</span><h1>Reset this Guide?</h1><p>Resetting will permanently delete all entries, notes, Stage positions, return dates and the current password stored in this Guide in this browser on this device.</p><p><strong>This cannot be undone.</strong></p><div class="actions"><button class="button danger" data-confirm-reset>Reset and start again</button><button class="button secondary" data-go="${isLocked ? 'forgot-password' : 'data'}">Go back</button></div></section>`, true);
  }

  function leaveGuide() {
    state.stopped = true;
    save(false);
    setCurrentNav('');
    page(`<section class="hero leave-screen"><div class="hero-copy"><span class="eyebrow">A stopping point</span><h1>You can leave the Guide here.</h1><p class="lede">Your entries are saved automatically in this browser on this device.</p><p>You can close this tab now. When you reopen the hosted Guide using the same browser and device, the Welcome Back screen will help you resume, view the Journey or open My Enquiry.</p><button class="button secondary" data-resume-session>Return to the Guide</button></div></section>`);
  }

  function resetGuide() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(AUTH_KEY);
    state = blankState();
    isLocked = false;
    route('welcome', true);
  }

  async function removePassword(button) {
    const form = button.closest('form');
    const message = form?.parentElement.querySelector('.form-message');
    if (!form || !await passwordMatches(form.currentPassword.value)) { if (message) message.textContent = 'Enter the correct current password before removing it.'; return; }
    localStorage.removeItem(AUTH_KEY);
    if (message) message.textContent = 'Password removed. Your entries have not been altered.';
    setTimeout(render, 900);
  }

  function bindInputs() {
    main.querySelectorAll('textarea').forEach(autoGrow);
  }

  function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(textarea.scrollHeight, 88)}px`;
  }

  function updateRecordFromInput(input) {
    const record = state.records[input.dataset.record];
    if (!record) return;
    if (input.dataset.part === 'field') record.fields[input.dataset.index] = input.value;
    else if (input.dataset.part === 'row') record.rows[Number(input.dataset.row)][input.dataset.index] = input.value;
    else if (input.dataset.part === 'additionalRow') record.additionalRows[Number(input.dataset.row)].value = input.value;
    else if (input.dataset.part === 'returnEnabled') {
      record.returnEnabled = input.checked;
      if (!input.checked) record.reviewDate = '';
      input.closest('.return-choice')?.querySelector('.return-date')?.classList.toggle('hidden', !input.checked);
    }
    else record[input.dataset.part] = input.value;
    record.changedAt = now();
    save();
  }

  function addRow(key) {
    const record = state.records[key];
    const def = findDefinition(record);
    if (!record || !def) return;
    const row = Object.fromEntries(def.fields.map((_, i) => [i, '']));
    record.rows.push(row);
    record.changedAt = now(); save(); render();
  }

  function addExtraRow(key) {
    const record = state.records[key];
    if (!record) return;
    record.additionalRows = record.additionalRows || [];
    record.additionalRows.push({ value: '' });
    record.changedAt = now(); save(); render();
  }

  function showStateInPlace(button, record) {
    const section = button.closest('[data-record-section]');
    if (!section) { render(); return; }
    section.querySelectorAll('[data-set-state]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.setState === record.state)));
  }

  function exportText(includePreviousOnly = false) {
    const lines = [`${GUIDE.title}`, 'Interactive Enquiry Guide export', `Exported: ${dateText(now())}`, ''];
    if (!includePreviousOnly) {
      GUIDE.stages.forEach(stage => {
        const stageRecords = Object.values(state.records).filter(r => r.stageId === stage.id && (hasContent(r) || r.state !== 'untouched'));
        if (!stageRecords.length) return;
        lines.push(`STAGE ${stage.number}: ${stage.name}`, '');
        stageRecords.sort((a,b) => (a.chapterNumber || 0) - (b.chapterNumber || 0)).forEach(record => appendRecord(lines, record));
      });
      const returnRecord = state.records['return-point:return'];
      if (returnRecord && (hasContent(returnRecord) || returnRecord.state !== 'untouched')) { lines.push('BOOK-CLOSE REFLECTION', ''); appendRecord(lines, returnRecord); }
    }
    if ((state.previousGuideResponses || []).length) {
      lines.push('PREVIOUS GUIDE RESPONSES', '');
      state.previousGuideResponses.forEach(item => { lines.push(item.chapterLabel || 'Original chapter not recorded', item.prompt || 'Original prompt not recorded', String(item.response || ''), ''); });
    }
    download(`${includePreviousOnly ? 'previous-guide-responses' : 'book-1-enquiry-export'}.txt`, lines.join('\n'));
  }

  function appendRecord(lines, record) {
    lines.push(record.chapterNumber ? `Chapter ${record.chapterNumber}: ${record.chapterTitle}` : record.activityTitle, record.privateAccount ? `${record.activityTitle} [Personal account]` : record.activityTitle);
    if (['settled', 'unknown'].includes(record.state)) lines.push(`Position: ${stateLabel(record.state)}`);
    lines.push(`Last changed: ${dateText(record.changedAt)}`);
    if (record.reviewDate) lines.push(`Return on: ${dateText(record.reviewDate)}`);
    const def = findDefinition(record);
    if (def) {
      if (def.repeatable) record.rows.forEach((row, rowIndex) => { if (!Object.values(row).some(v => String(v).trim())) return; lines.push(`Row ${rowIndex + 1}`); def.fields.forEach((label, i) => { if (String(row[i] || '').trim()) lines.push(`${label}: ${row[i]}`); }); });
      else def.fields.forEach((label, i) => { if (String(record.fields[i] || '').trim()) lines.push(`${label}: ${record.fields[i]}`); });
      (record.additionalRows || []).forEach((row, i) => { if (String(row.value || '').trim()) lines.push(`Additional map row ${i + 1}: ${row.value}`); });
    }
    if (record.note?.trim()) lines.push(`What I want to remember from this section: ${record.note}`);
    (record.revisitNotes || []).forEach(note => lines.push(`Revisit note — ${dateText(note.date)}: ${note.text}`));
    lines.push('');
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  function openFocus(button) {
    const selector = `[data-record="${CSS.escape(button.dataset.expand)}"][data-part="${button.dataset.targetPart}"]${button.dataset.index !== undefined ? `[data-index="${button.dataset.index}"]` : ''}${button.dataset.row !== undefined ? `[data-row="${button.dataset.row}"]` : ''}`;
    const source = main.querySelector(selector);
    if (!source) return;
    focusBinding = source;
    focusReturn = button;
    document.getElementById('focusTitle').textContent = state.records[button.dataset.expand]?.activityTitle || 'Writing space';
    document.getElementById('focusLabel').textContent = button.dataset.label;
    focusTextarea.value = source.value;
    overlay.hidden = false; document.body.classList.add('modal-open'); focusTextarea.focus();
  }

  function closeFocus() {
    if (focusBinding) { focusBinding.value = focusTextarea.value; autoGrow(focusBinding); updateRecordFromInput(focusBinding); }
    overlay.hidden = true; document.body.classList.remove('modal-open'); focusBinding = null;
    if (focusReturn) focusReturn.focus();
    focusReturn = null;
  }

  function render() {
    nav.classList.remove('open'); menuButton.setAttribute('aria-expanded', 'false');
    const raw = location.hash.slice(1) || (state.hasVisited ? 'welcome' : 'welcome');
    if (isLocked) {
      if (raw === 'forgot-password') forgotPassword();
      else if (raw === 'confirm-reset') confirmReset();
      else lockScreen();
      window.scrollTo(0, 0); main.focus({ preventScroll: true });
      return;
    }
    if (state.stopped) {
      state.stopped = false;
      save(false);
      history.replaceState(null, '', '#welcome');
      welcome();
      window.scrollTo(0, 0); main.focus({ preventScroll: true });
      return;
    }
    if (raw === 'welcome') welcome();
    else if (raw === 'journey') journey();
    else if (raw === 'current') route(state.lastLocation || 'journey', true);
    else if (raw === 'enquiry' || raw.startsWith('enquiry-')) enquiry(raw.split('-')[1] || 'journey');
    else if (raw === 'data') dataPage();
    else if (raw === 'forgot-password') forgotPassword();
    else if (raw === 'confirm-reset') confirmReset();
    else if (raw === 'locked') lockScreen();
    else if (raw === 'return-point') returnPoint();
    else if (/^chapter-\d+$/.test(raw)) { const found = findChapter(raw.split('-')[1]); found ? chapterView(found.stage, found.chapter) : journey(); }
    else {
      const match = raw.match(/^stage-([a-z]+)-(entry|transition)$/);
      const stage = match && GUIDE.stages.find(s => s.id === match[1]);
      if (!stage) journey(); else match[2] === 'entry' ? stageEntry(stage) : transition(stage);
    }
    window.scrollTo(0, 0); main.focus({ preventScroll: true });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.go) { if (button.dataset.enterStage) lockStageBaseline(button.dataset.enterStage); state.stopped = false; route(button.dataset.go); }
    else if (button.dataset.route) route(button.dataset.route);
    else if (button.dataset.enquiryView) route(`enquiry-${button.dataset.enquiryView}`);
    else if (button.dataset.addRow) addRow(button.dataset.addRow);
    else if (button.dataset.addExtraRow) addExtraRow(button.dataset.addExtraRow);
    else if (button.dataset.removeRow) { const record = state.records[button.dataset.removeRow]; if (record && confirm('Remove this row and everything written in it?')) { record.rows.splice(Number(button.dataset.row), 1); record.changedAt = now(); save(); render(); } }
    else if (button.dataset.removeExtraRow) { const record = state.records[button.dataset.removeExtraRow]; if (record && confirm('Remove this additional map row and everything written in it?')) { record.additionalRows.splice(Number(button.dataset.row), 1); record.changedAt = now(); save(); render(); } }
    else if (button.dataset.setState) { const record = state.records[button.dataset.record]; if (record) { record.state = record.state === button.dataset.setState ? 'untouched' : button.dataset.setState; record.changedAt = now(); save(); showStateInPlace(button, record); } }
    else if (button.dataset.quick) { const record = state.records[button.dataset.record]; if (record) { record.note = [record.note, button.dataset.quick].filter(Boolean).join('\n'); record.changedAt = now(); save(); const note = button.closest('[data-record-section]')?.querySelector('[data-part="note"]'); if (note) { note.value = record.note; autoGrow(note); } } }
    else if (button.dataset.expand) openFocus(button);
    else if (button.hasAttribute('data-export')) exportText(false);
    else if (button.hasAttribute('data-export-previous')) exportText(true);
    else if (button.hasAttribute('data-leave-guide')) leaveGuide();
    else if (button.hasAttribute('data-resume-session')) { state.stopped = false; save(false); route(state.lastLocation || 'journey', true); }
    else if (button.dataset.clearReturn) { const record = state.records[button.dataset.clearReturn]; if (record) { record.returnEnabled = false; record.reviewDate = ''; record.changedAt = now(); save(); render(); } }
    else if (button.hasAttribute('data-begin-reset')) route('confirm-reset');
    else if (button.hasAttribute('data-confirm-reset')) resetGuide();
    else if (button.hasAttribute('data-remove-password')) removePassword(button);
    else if (button.dataset.addRevisit) { const field = main.querySelector(`[data-revisit-draft="${CSS.escape(button.dataset.addRevisit)}"]`); const record = state.records[button.dataset.addRevisit]; if (field?.value.trim() && record) { record.revisitNotes.push({ date: now(), text: field.value.trim() }); record.changedAt = now(); save(); render(); } }
    else if (button.dataset.deleteRecord) { const record = state.records[button.dataset.deleteRecord]; if (record && confirm(`Delete “${record.activityTitle}” and all writing and revisit notes saved with it?`)) { delete state.records[button.dataset.deleteRecord]; save(); render(); } }
    else if (button.hasAttribute('data-delete-previous')) { if (confirm('Delete the complete Previous Guide responses archive from this test Guide?')) { state.previousGuideResponses = []; save(); render(); } }
  });

  document.addEventListener('input', event => {
    const input = event.target.closest('[data-record]');
    if (!input) return;
    if (input.tagName === 'TEXTAREA') autoGrow(input);
    updateRecordFromInput(input);
  });

  document.addEventListener('change', event => {
    if (event.target.matches('input[type="date"][data-record]') && location.hash === '#enquiry-return') render();
  });

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form.matches('[data-unlock], [data-password-add], [data-password-change]')) return;
    event.preventDefault();
    const message = form.parentElement.querySelector('.form-message');
    if (form.matches('[data-unlock]')) {
      if (await passwordMatches(form.password.value)) { isLocked = false; state.stopped = false; route('welcome', true); }
      else if (message) message.textContent = 'That password did not open the Guide. You can try again.';
      return;
    }
    const newPassword = form.newPassword.value;
    if (newPassword !== form.confirmPassword.value) { if (message) message.textContent = 'The two new passwords do not match.'; return; }
    if (form.matches('[data-password-change]') && !await passwordMatches(form.currentPassword.value)) { if (message) message.textContent = 'The current password is not correct.'; return; }
    await storePassword(newPassword);
    if (message) message.textContent = form.matches('[data-password-change]') ? 'Password changed. Your entries have not been altered.' : 'Password added. It will be required when the Guide is next opened.';
    setTimeout(render, 900);
  });

  menuButton.addEventListener('click', () => { const open = nav.classList.toggle('open'); menuButton.setAttribute('aria-expanded', String(open)); });
  document.getElementById('closeFocus').addEventListener('click', closeFocus);
  focusTextarea.addEventListener('input', () => { if (focusBinding) { focusBinding.value = focusTextarea.value; updateRecordFromInput(focusBinding); } });
  overlay.addEventListener('click', event => { if (event.target === overlay) closeFocus(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !overlay.hidden) closeFocus();
    if (event.key === 'Tab' && !overlay.hidden) {
      const focusable = [...overlay.querySelectorAll('button, textarea')];
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('hashchange', render);
  render();
})();
