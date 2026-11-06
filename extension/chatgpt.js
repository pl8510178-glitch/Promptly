(() => {
  if (window.__promptlyChatGPTReady) return;
  window.__promptlyChatGPTReady = true;

  const EDITOR_SELECTORS = [
    '#prompt-textarea',
    '[contenteditable="true"][role="textbox"]',
    'textarea'
  ];
  const textOf = editor => String(('value' in editor ? editor.value : editor.innerText || editor.textContent) || '').trim();
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
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

  function installControl() {
    const editor = findEditor();
    const sendButton = findSendButton();
    if (!editor || !sendButton?.parentElement || document.getElementById('promptly-chatgpt-control')) return;

    const host = document.createElement('span');
    host.id = 'promptly-chatgpt-control';
    host.style.cssText = 'display:inline-flex;align-items:center;flex:0 0 auto;margin-right:6px;vertical-align:middle;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        button{height:36px;padding:0 12px;border:0;border-radius:999px;background:#34735a;color:#fff;font:600 12px/1.1 system-ui,-apple-system,"Segoe UI",sans-serif;white-space:nowrap;cursor:pointer;transition:background .15s,transform .15s}
        button:hover{background:#285d48;transform:translateY(-1px)}
        button:focus-visible{outline:3px solid #9bc7a9;outline-offset:2px}
        button:disabled{opacity:.68;cursor:wait;transform:none}
        @media(max-width:600px){button{height:32px;padding:0 9px;font-size:11px}}
        .sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
      </style>
      <button type="button" aria-label="Refine this prompt with Promptly and send it to ChatGPT">✳ Refine &amp; send</button>
      <span class="sr" role="status" aria-live="polite"></span>`;
    const button = shadow.querySelector('button');
    const status = shadow.querySelector('[role="status"]');
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      const currentEditor = findEditor();
      const roughPrompt = currentEditor && textOf(currentEditor);
      if (!roughPrompt) {
        status.textContent = 'Type your rough prompt in ChatGPT first.';
        button.title = status.textContent;
        return;
      }
      if (roughPrompt.length > 10000) {
        status.textContent = 'Keep your request under 10,000 characters.';
        button.title = status.textContent;
        return;
      }

      button.disabled = true;
      button.textContent = 'Refining…';
      button.title = 'Promptly is refining your draft.';
      status.textContent = 'Promptly is refining your draft.';
      try {
        const result = await chrome.runtime.sendMessage({ type: 'PROMPTLY_REFINE_CHATGPT', request: roughPrompt });
        if (!result?.ok) throw new Error(result?.error || 'Promptly could not refine this request.');

        const editorNow = findEditor();
        if (!editorNow || normalize(textOf(editorNow)) !== normalize(roughPrompt)) {
          throw new Error('Your ChatGPT draft changed while Promptly was refining it. Review it and try again.');
        }

        setEditorText(editorNow, result.prompt);
        await new Promise(resolve => setTimeout(resolve, 120));
        const currentSendButton = findSendButton();
        if (!currentSendButton || currentSendButton.disabled) throw new Error('Prompt was refined, but ChatGPT is not ready to send it. Press ChatGPT’s send button.');
        currentSendButton.click();
        button.textContent = 'Sent ✓';
        button.title = 'Promptly refined and sent this prompt in the current conversation.';
        status.textContent = button.title;

      } catch (error) {
        button.textContent = 'Try again';
        button.title = error.message || 'Promptly could not refine this request.';
        status.textContent = button.title;
      } finally {
        button.disabled = false;
        setTimeout(() => {
          if (!button.isConnected) return;
          button.textContent = '✳ Refine & send';
        }, 1800);
      }
    });

    sendButton.parentElement.insertBefore(host, sendButton);
  }

  const observer = new MutationObserver(installControl);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  installControl();
})();
