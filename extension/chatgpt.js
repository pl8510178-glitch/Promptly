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
        .launcher{position:relative;display:flex;align-items:center;justify-content:center;gap:9px;min-width:148px;height:58px;padding:0 19px;border:2px solid #fff;border-radius:999px;background:#246447;color:#fff;box-shadow:0 8px 28px rgba(20,48,36,.34),0 0 0 2px #246447;font-size:15px;font-weight:750;letter-spacing:.1px;cursor:pointer;transition:transform .16s,background .16s,box-shadow .16s}
        .launcher::before{content:"";position:absolute;inset:-7px;border:2px solid rgba(52,115,90,.55);border-radius:999px;pointer-events:none;animation:attention-ring 2.4s ease-out 3}
        .launcher-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.18);font-size:19px;line-height:1}
        .launcher:hover{transform:translateY(-2px);background:#194d35;box-shadow:0 11px 30px rgba(20,48,36,.4),0 0 0 2px #194d35}
        button:focus-visible,textarea:focus-visible{outline:3px solid #84b897;outline-offset:3px}
        .panel{position:absolute;right:0;bottom:72px;width:min(360px,calc(100vw - 28px));padding:17px;border:1px solid #e3e8e5;border-radius:16px;background:#fff;color:#1c2932;box-shadow:0 18px 55px rgba(20,32,28,.22);}
        .panel[hidden]{display:none}
        .head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
        .brand{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:700;letter-spacing:-.2px}
        .mark{display:grid;place-items:center;width:28px;height:28px;border-radius:9px 9px 9px 3px;background:#e9f2ec;color:#34735a;font-size:18px}
        .close{width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:#66736e;font-size:19px;cursor:pointer}
        .close:hover{background:#f1f4f2}
        label{display:block;margin:0 0 8px;color:#52605a;font-size:12px;font-weight:650}
        textarea{display:block;width:100%;min-height:128px;max-height:38vh;resize:vertical;padding:11px 12px;border:1px solid #dce4df;border-radius:10px;background:#fff;color:#1c2932;font:13px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
        textarea::placeholder{color:#9aa59f}
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
        @media(max-width:520px){:host{right:14px!important;bottom:14px!important}.panel{width:min(360px,calc(100vw - 28px));right:0;bottom:70px}.launcher{min-width:142px;height:54px;padding:0 16px;font-size:14px}}
        @media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}
      </style>
      <section class="panel" aria-label="Promptly prompt refiner" hidden>
        <div class="head"><div class="brand"><span class="mark" aria-hidden="true">✳</span><span>Promptly</span></div><button class="close" type="button" aria-label="Close Promptly">×</button></div>
        <label for="rough-prompt">What do you want ChatGPT to do?</label>
        <textarea id="rough-prompt" maxlength="10000" placeholder="Write your rough prompt…"></textarea>
        <p class="hint">Promptly will refine this and send it in your current ChatGPT conversation.</p>
        <p class="status" role="status" aria-live="polite"></p>
        <button class="send" type="button"><span aria-hidden="true">✳</span><span>Refine &amp; send</span></button>
      </section>
      <button class="launcher" type="button" aria-label="Open Promptly prompt refiner" aria-expanded="false" title="Open Promptly"><span class="launcher-icon" aria-hidden="true">✳</span><span>Promptly</span></button>
    `;
    document.body.append(host);

    const panel = shadow.querySelector('.panel');
    const launcher = shadow.querySelector('.launcher');
    const close = shadow.querySelector('.close');
    const promptField = shadow.querySelector('textarea');
    const submit = shadow.querySelector('.send');
    const submitLabel = submit.querySelector('span:last-child');
    const status = shadow.querySelector('.status');

    function setOpen(open) {
      panel.hidden = !open;
      launcher.setAttribute('aria-expanded', String(open));
      launcher.setAttribute('aria-label', open ? 'Close Promptly prompt refiner' : 'Open Promptly prompt refiner');
      launcher.title = open ? 'Close Promptly' : 'Open Promptly';
      if (open) promptField.focus();
      else launcher.focus();
    }
    launcher.addEventListener('click', () => setOpen(panel.hidden));
    close.addEventListener('click', () => setOpen(false));
    shadow.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !panel.hidden) { event.stopPropagation(); setOpen(false); }
    });

    submit.addEventListener('click', async () => {
      const roughPrompt = promptField.value.trim();
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
