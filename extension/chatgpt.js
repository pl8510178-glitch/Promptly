(() => {
  if (window.__promptlyChatGPTReady) return;
  window.__promptlyChatGPTReady = true;

  const EDITOR_SELECTORS = [
    '#prompt-textarea',
    '[contenteditable="true"][role="textbox"]',
    'textarea'
  ];
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const textOf = editor => String(('value' in editor ? editor.value : editor.innerText || editor.textContent) || '').trim();
  const findEditor = () => EDITOR_SELECTORS.map(selector => document.querySelector(selector)).find(Boolean);
  const findSendButton = () => document.querySelector('button[data-testid="send-button"]') ||
    [...document.querySelectorAll('button')].find(button => /send prompt|send message/i.test(`${button.getAttribute('aria-label') || ''} ${button.title || ''}`));

  function setEditorText(editor, text) {
    editor.focus();
    if (editor.isContentEditable) {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
      if (textOf(editor) !== text.trim()) {
        editor.textContent = text;
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    } else {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), 'value')?.set;
      if (setter) setter.call(editor, text); else editor.value = text;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function installBubble() {
    if (!document.body || document.getElementById('promptly-chatgpt-bubble')) return;

    const host = document.createElement('div');
    host.id = 'promptly-chatgpt-bubble';
    host.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host{all:initial;color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
        *{box-sizing:border-box}
        .launcher{position:relative;display:grid;place-items:center;width:50px;height:50px;padding:0;border:2px solid #fff;border-radius:50%;background:#246447;color:#fff;box-shadow:0 7px 23px rgba(20,48,36,.38),0 0 0 2px #246447;font-size:25px;line-height:1;cursor:grab;touch-action:none;user-select:none;transition:transform .16s,background .16s,box-shadow .16s}
        .launcher::before{content:"";position:absolute;inset:-7px;border:2px solid rgba(52,115,90,.58);border-radius:50%;pointer-events:none;animation:attention-ring 2.4s ease-out 3}
        .launcher:active{cursor:grabbing}
        .launcher:hover{transform:scale(1.07);background:#194d35;box-shadow:0 10px 28px rgba(20,48,36,.44),0 0 0 2px #194d35}
        button:focus-visible,textarea:focus-visible{outline:3px solid #84b897;outline-offset:3px}
        .panel{position:fixed;left:0;top:0;width:min(360px,calc(100vw - 28px));padding:17px;border:1px solid #e3e8e5;border-radius:16px;background:#fff;color:#1c2932;box-shadow:0 18px 55px rgba(20,32,28,.22);}
        .panel[hidden]{display:none}
        .head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
        .brand{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:700;letter-spacing:-.2px}
        .mark{display:grid;place-items:center;width:28px;height:28px;border-radius:9px 9px 9px 3px;background:#e9f2ec;color:#34735a;font-size:18px}
        .close{width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:#66736e;font-size:19px;cursor:pointer}
        .close:hover{background:#f1f4f2}
        label{display:block;margin:0 0 8px;color:#52605a;font-size:12px;font-weight:650}
        textarea{display:block;width:100%;min-height:128px;max-height:38vh;resize:vertical;padding:11px 12px;border:1px solid #dce4df;border-radius:10px;background:#fff;color:#1c2932;font:13px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
        textarea::placeholder{color:#9aa59f}
        .voice-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:9px}
        .voice-button{display:flex;align-items:center;gap:7px;min-height:32px;padding:6px 10px;border:1px solid #dce4df;border-radius:8px;background:#f8faf8;color:#285d48;font-size:11px;font-weight:650;cursor:pointer}
        .voice-button:hover{background:#edf5ef;border-color:#b7d0bf}
        .voice-button[aria-pressed="true"]{border-color:#bd4a4a;background:#fff1f1;color:#a22e2e}
        .voice-key{color:#78857d;font:10px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace}
        .voice-privacy{margin:6px 1px 0;color:#7f8a84;font-size:9px;line-height:1.4}
        .hint{margin:7px 1px 12px;color:#89948e;font-size:10px;line-height:1.45}
        .status{min-height:18px;margin:0 0 8px;color:#54745f;font-size:11px;line-height:1.45}
        .status:empty{display:none}
        .send{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:42px;border:0;border-radius:9px;background:#34735a;color:#fff;font-size:12px;font-weight:700;cursor:pointer;transition:background .16s,transform .16s}
        .send:hover{transform:translateY(-1px);background:#285d48}
        .send:disabled{opacity:.65;cursor:wait;transform:none}
        .spinner{display:inline-block;animation:spin .8s linear infinite}
        .sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes attention-ring{0%{transform:scale(.96);opacity:.75}75%,100%{transform:scale(1.16);opacity:0}}
        @media(max-width:520px){.panel{width:min(360px,calc(100vw - 28px))}.launcher{width:48px;height:48px;font-size:23px}}
        @media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}
      </style>
      <section class="panel" aria-label="Promptly prompt refiner" hidden>
        <div class="head"><div class="brand"><span class="mark" aria-hidden="true">✳</span><span>Promptly</span></div><button class="close" type="button" aria-label="Close Promptly">×</button></div>
        <label for="rough-prompt">What do you want ChatGPT to do?</label>
        <textarea id="rough-prompt" maxlength="10000" placeholder="Write your rough prompt…"></textarea>
        <div class="voice-row"><button class="voice-button" type="button" aria-pressed="false"><span aria-hidden="true">🎙</span><span>Start voice input</span></button><span class="voice-key">Alt+Shift+P</span></div>
        <p class="voice-privacy">Voice recognition uses Chrome’s speech service and may process audio online.</p>
        <p class="hint">Promptly will refine this and send it in your current ChatGPT conversation.</p>
        <p class="status" role="status" aria-live="polite"></p>
        <button class="send" type="button"><span aria-hidden="true">✳</span><span>Refine &amp; send</span></button>
      </section>
      <button class="launcher" type="button" aria-label="Open Promptly prompt refiner. Drag to move." aria-expanded="false" title="Promptly — drag to move, click to open">✳</button>
    `;
    document.body.append(host);

    const panel = shadow.querySelector('.panel');
    const launcher = shadow.querySelector('.launcher');
    const close = shadow.querySelector('.close');
    const promptField = shadow.querySelector('textarea');
    const submit = shadow.querySelector('.send');
    const submitLabel = submit.querySelector('span:last-child');
    const status = shadow.querySelector('.status');
    const voiceButton = shadow.querySelector('.voice-button');
    const voiceButtonLabel = voiceButton.querySelector('span:last-child');
    let pointerStart = null;
    let dragged = false;
    let ignoreClick = false;
    let hasCustomPosition = false;
    let savedPosition = null;
    let recognition = null;
    let isListening = false;
    let voiceBase = '';
    let voiceError = false;
    let voiceCaptured = false;

    function clamp(value, low, high) { return Math.max(low, Math.min(value, high)); }
    function setBubblePosition(left, top, persist = false) {
      const rect = host.getBoundingClientRect();
      const maxLeft = Math.max(10, window.innerWidth - rect.width - 10);
      const maxTop = Math.max(10, window.innerHeight - rect.height - 10);
      const x = clamp(left, 10, maxLeft);
      const y = clamp(top, 10, maxTop);
      host.style.left = `${x}px`;
      host.style.top = `${y}px`;
      host.style.right = 'auto';
      host.style.bottom = 'auto';
      hasCustomPosition = true;
      savedPosition = { xRatio: maxLeft ? x / maxLeft : 1, yRatio: maxTop ? y / maxTop : 1 };
      if (persist) chrome.storage.local.set({ promptlyBubblePosition: savedPosition }).catch(() => {});
    }
    function placePanel() {
      if (panel.hidden) return;
      const anchor = host.getBoundingClientRect();
      const card = panel.getBoundingClientRect();
      const margin = 14;
      const maxLeft = Math.max(margin, window.innerWidth - card.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - card.height - margin);
      const left = clamp(anchor.right - card.width, margin, maxLeft);
      const above = anchor.top - card.height - 12;
      const top = clamp(above < margin ? anchor.bottom + 12 : above, margin, maxTop);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    }

    function setOpen(open) {
      if (!open && isListening) stopVoiceInput();
      panel.hidden = !open;
      launcher.setAttribute('aria-expanded', String(open));
      launcher.setAttribute('aria-label', open ? 'Close Promptly prompt refiner' : 'Open Promptly prompt refiner');
      launcher.title = open ? 'Close Promptly' : 'Open Promptly';
      if (open) { placePanel(); promptField.focus(); }
      else launcher.focus();
    }
    launcher.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      const rect = host.getBoundingClientRect();
      pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      dragged = false;
      launcher.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    launcher.addEventListener('pointermove', event => {
      if (!pointerStart || event.pointerId !== pointerStart.id) return;
      const dx = event.clientX - pointerStart.x;
      const dy = event.clientY - pointerStart.y;
      if (!dragged && Math.hypot(dx, dy) < 5) return;
      dragged = true;
      setBubblePosition(pointerStart.left + dx, pointerStart.top + dy);
      placePanel();
    });
    function finishDrag(event) {
      if (!pointerStart || event.pointerId !== pointerStart.id) return;
      if (launcher.hasPointerCapture(event.pointerId)) launcher.releasePointerCapture(event.pointerId);
      if (dragged) {
        ignoreClick = true;
        if (savedPosition) chrome.storage.local.set({ promptlyBubblePosition: savedPosition }).catch(() => {});
        setTimeout(() => { ignoreClick = false; }, 300);
      }
      pointerStart = null;
    }
    launcher.addEventListener('pointerup', finishDrag);
    launcher.addEventListener('pointercancel', finishDrag);
    launcher.addEventListener('click', () => {
      if (ignoreClick) { ignoreClick = false; return; }
      setOpen(panel.hidden);
    });
    close.addEventListener('click', () => setOpen(false));

    function updateVoiceButton(active) {
      isListening = active;
      voiceButton.setAttribute('aria-pressed', String(active));
      voiceButtonLabel.textContent = active ? 'Stop listening' : 'Start voice input';
    }
    function stopVoiceInput() {
      if (recognition && isListening) {
        status.textContent = 'Finishing voice input…';
        recognition.stop();
      }
    }
    function startVoiceInput() {
      if (isListening) { stopVoiceInput(); return; }
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setOpen(true);
        status.textContent = 'Voice input is not supported in this browser. Try the latest Chrome or type your prompt.';
        return;
      }
      setOpen(true);
      try {
        recognition = new SpeechRecognition();
        recognition.lang = document.documentElement.lang || navigator.language || 'en-US';
        recognition.continuous = true;
        recognition.interimResults = true;
        voiceBase = promptField.value.trim();
        voiceError = false;
        voiceCaptured = false;
        status.textContent = 'Listening… Press Alt+Shift+P again to stop. Review your prompt before sending.';
        updateVoiceButton(true);
        recognition.onresult = event => {
          let finalText = '';
          let interimText = '';
          for (let i = 0; i < event.results.length; i++) {
            const transcript = event.results[i][0]?.transcript || '';
            if (event.results[i].isFinal) finalText += `${transcript} `;
            else interimText += `${transcript} `;
          }
          const recognized = [voiceBase, finalText.trim(), interimText.trim()].filter(Boolean).join(' ');
          promptField.value = recognized.slice(0, 10000);
          voiceCaptured ||= Boolean(finalText.trim());
          if (interimText.trim()) status.textContent = `Listening… ${interimText.trim()}`;
        };
        recognition.onerror = event => {
          voiceError = true;
          const messages = {
            'not-allowed': 'Microphone access was blocked. Allow microphone access for ChatGPT in Chrome, then try again.',
            'service-not-allowed': 'Chrome blocked its speech recognition service.',
            'no-speech': 'No speech was detected. Press the shortcut and try again.',
            'audio-capture': 'No microphone is available. Check your microphone and try again.',
            'network': 'Chrome’s speech service could not be reached. Check your internet connection.'
          };
          status.textContent = messages[event.error] || `Voice input stopped (${event.error}).`;
        };
        recognition.onend = () => {
          const hadCapture = voiceCaptured;
          recognition = null;
          updateVoiceButton(false);
          if (!voiceError) status.textContent = hadCapture
            ? 'Voice added. Review or edit your prompt before sending.'
            : 'No speech was detected. Try again.';
        };
        recognition.start();
      } catch (error) {
        recognition = null;
        updateVoiceButton(false);
        status.textContent = error.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow microphone access for ChatGPT, then try again.'
          : 'Could not start voice input. Check your microphone permission and try again.';
      }
    }
    voiceButton.addEventListener('click', startVoiceInput);
    document.addEventListener('keydown', event => {
      if (event.code !== 'KeyP' || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      startVoiceInput();
    }, true);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && isListening) stopVoiceInput();
    });
    shadow.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !panel.hidden) { event.stopPropagation(); setOpen(false); }
      if (event.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        const rect = host.getBoundingClientRect();
        const step = 20;
        setBubblePosition(rect.left + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), rect.top + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0), true);
        placePanel();
      }
    });
    window.addEventListener('resize', () => {
      if (hasCustomPosition && savedPosition) {
        setBubblePosition(savedPosition.xRatio * Math.max(10, window.innerWidth - host.offsetWidth - 10), savedPosition.yRatio * Math.max(10, window.innerHeight - host.offsetHeight - 10));
      }
      placePanel();
    });
    chrome.storage.local.get('promptlyBubblePosition').then(({ promptlyBubblePosition }) => {
      if (!promptlyBubblePosition) return;
      const maxLeft = Math.max(10, window.innerWidth - host.offsetWidth - 10);
      const maxTop = Math.max(10, window.innerHeight - host.offsetHeight - 10);
      setBubblePosition((promptlyBubblePosition.xRatio ?? 1) * maxLeft, (promptlyBubblePosition.yRatio ?? 1) * maxTop);
    }).catch(() => {});

    submit.addEventListener('click', async () => {
      const roughPrompt = promptField.value.trim();
      if (isListening) stopVoiceInput();
      status.textContent = '';
      if (!roughPrompt) {
        status.textContent = 'Type a rough prompt first.';
        promptField.focus();
        return;
      }
      if (roughPrompt.length > 10000) {
        status.textContent = 'Keep your request under 10,000 characters.';
        return;
      }

      submit.disabled = true;
      submitLabel.innerHTML = '<span class="spinner" aria-hidden="true">◌</span> Refining…';
      status.textContent = 'Promptly is refining your request…';
      try {
        const result = await chrome.runtime.sendMessage({ type: 'PROMPTLY_REFINE_CHATGPT', request: roughPrompt });
        if (!result?.ok) throw new Error(result?.error || 'Promptly could not refine this request.');
        const editor = findEditor();
        if (!editor) throw new Error('Could not find ChatGPT’s message box. Reload ChatGPT and try again.');
        setEditorText(editor, result.prompt);
        await new Promise(resolve => setTimeout(resolve, 140));
        const sendButton = findSendButton();
        if (!sendButton || sendButton.disabled) throw new Error('The refined prompt is in ChatGPT. Press its Send button to continue.');
        sendButton.click();
        promptField.value = '';
        status.textContent = 'Refined and sent in this ChatGPT conversation. Ready for your next prompt.';
      } catch (error) {
        status.textContent = error.message || 'Promptly could not refine this request. Try again.';
      } finally {
        submit.disabled = false;
        submitLabel.textContent = 'Refine & send';
      }
    });
  }

  const observer = new MutationObserver(installBubble);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  installBubble();
})();
