/**
 * The terminal on screen: scrollback, a prompt, and a command line.
 *
 * Why not xterm.js: it injects <style> elements at runtime, which our CSP
 * (style-src 'self') blocks. This small component does what the game needs
 * with plain DOM, styled entirely from style.css. See CLAUDE.md, "Security
 * decision".
 *
 * The command line is a real <input>, so screen readers, mobile keyboards,
 * and copy and paste all work normally. Every line of output is set with
 * textContent, never innerHTML.
 *
 * Keys in the command line:
 *   Enter         run the command
 *   Up / Down     step through earlier commands
 *   Tab           complete a command or path
 *   Esc, then Tab leave the terminal (Shift+Tab always leaves backwards)
 *   Ctrl+L        clear the screen
 *   Ctrl+C        cancel the line
 *
 * The component knows nothing about the game. The caller supplies:
 *   onCommand(text)   run a line; the caller prints the results
 *   onComplete(text)  returns { input, options } for Tab
 *   getHistory()      the commands typed so far, oldest first
 */

import { el } from "../ui.js";

// How many lines of one command's output are read aloud before summarizing.
const ANNOUNCE_LINES = 10;

export function createTerminal(
  { output, input, prompt, live, hint, keys },
  { onCommand, onComplete, getHistory, maxInput = 200, scrollbackLines = 2000 },
) {
  let historyIndex = null; // null while typing a new line; otherwise an index into history
  let draft = ""; // the unfinished line, kept while browsing history
  let tabLeaves = false; // set by Esc: the next Tab moves focus out
  let locked = false;
  let announceTimer = null;

  input.maxLength = maxInput;

  /* ---------- Output ---------- */

  function row(line) {
    // columns: an ls row of names. Narrow screens stack them one per line (see style.css).
    const node = el("div", { className: `term-row${line.kind ? ` is-${line.kind}` : ""}${line.columns ? " term-cols" : ""}` });
    if (line.parts) {
      for (const part of line.parts) {
        node.append(part.kind ? el("span", { className: `term-${part.kind}`, text: part.text }) : document.createTextNode(part.text));
      }
    } else {
      node.textContent = line.text;
    }
    return node;
  }

  function trim() {
    while (output.childElementCount > scrollbackLines) output.firstElementChild.remove();
  }

  function scrollToEnd() {
    output.scrollTop = output.scrollHeight;
  }

  /** Print lines ({ text, kind?, parts? }) at the bottom of the scrollback. */
  function print(lines) {
    if (!lines.length) return;
    const fragment = document.createDocumentFragment();
    for (const line of lines) fragment.append(row(line));
    output.append(fragment);
    trim();
    scrollToEnd();
  }

  /** Echo a command after its prompt, the way a real terminal leaves it on screen. */
  function echo(promptText, text) {
    output.append(
      el("div", { className: "term-row is-echo" }, [el("span", { className: "term-echo-prompt", text: promptText }), document.createTextNode(text)]),
    );
    trim();
    scrollToEnd();
  }

  function clear() {
    output.replaceChildren();
  }

  /**
   * Read results aloud through the live region. Long output is summarized so
   * a screen reader isn't stuck reading 400 log lines; the full text stays in
   * the scrollback, one Shift+Tab away.
   */
  function announce(lines) {
    const texts = lines.map((l) => l.text).filter((t) => t.trim() !== "");
    let message = texts.slice(0, ANNOUNCE_LINES).join("\n");
    if (texts.length > ANNOUNCE_LINES) {
      message += `\n…and ${texts.length - ANNOUNCE_LINES} more lines. Press Shift+Tab to read the full output.`;
    }
    if (!message) return;
    // Clear first so the same message twice in a row is still announced.
    clearTimeout(announceTimer);
    live.textContent = "";
    announceTimer = setTimeout(() => (live.textContent = message), 60);
  }

  /* ---------- Input ---------- */

  function setPrompt(text) {
    prompt.textContent = text;
  }

  function setInput(text) {
    input.value = text;
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }

  function browseHistory(step) {
    const history = getHistory();
    if (!history.length) return;
    if (historyIndex === null) {
      if (step > 0) return;
      draft = input.value;
      historyIndex = history.length;
    }
    historyIndex = Math.min(history.length, Math.max(0, historyIndex + step));
    if (historyIndex === history.length) {
      historyIndex = null;
      setInput(draft);
    } else {
      setInput(history[historyIndex]);
    }
  }

  function submit() {
    if (locked) return;
    const text = input.value;
    historyIndex = null;
    draft = "";
    setInput("");
    onCommand(text);
  }

  function completeLine() {
    const before = input.value;
    const { input: after, options } = onComplete(before);
    if (after !== before) {
      setInput(after);
      announce([{ text: `Completed: ${after}` }]);
    } else if (options.length) {
      // Nothing more to fill in: list the choices, like pressing Tab twice in bash.
      echo(prompt.textContent, before);
      const list = [{ text: options.join("  ") }];
      print(list);
      announce([{ text: `${options.length} matches: ${options.join(", ")}` }]);
    }
  }

  function setTabLeaves(on) {
    tabLeaves = on;
    hint.classList.toggle("is-active", on);
    if (on) announce([{ text: "Tab will now leave the terminal." }]);
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && !event.shiftKey && !tabLeaves) {
      event.preventDefault();
      if (!locked) completeLine();
      return;
    }
    if (event.key === "Tab") {
      setTabLeaves(false);
      return; // let the browser move focus
    }
    if (event.key === "Escape") {
      setTabLeaves(true);
      return;
    }
    if (tabLeaves) setTabLeaves(false);

    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      browseHistory(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      browseHistory(1);
    } else if (event.ctrlKey && (event.key === "l" || event.key === "L")) {
      event.preventDefault();
      clear();
    } else if (event.ctrlKey && (event.key === "c" || event.key === "C") && input.selectionStart === input.selectionEnd) {
      event.preventDefault();
      echo(prompt.textContent, `${input.value}^C`);
      historyIndex = null;
      setInput("");
    }
  });
  input.addEventListener("blur", () => setTabLeaves(false));

  // Clicking the scrollback puts you back on the command line, unless you're selecting text to copy.
  output.addEventListener("click", () => {
    if (!locked && !window.getSelection()?.toString()) input.focus({ preventScroll: true });
  });

  // On-screen keys for touch screens, where there's no Tab or arrow key.
  keys?.addEventListener("click", (event) => {
    const key = event.target.closest("button")?.dataset.key;
    if (!key || locked) return;
    if (key === "tab") completeLine();
    else if (key === "up") browseHistory(-1);
    else if (key === "down") browseHistory(1);
    input.focus({ preventScroll: true });
  });

  /** Stop accepting commands (for example, when the shift ends). */
  function lock(reason) {
    locked = true;
    input.disabled = true;
    input.placeholder = reason ?? "";
    for (const button of keys?.querySelectorAll("button") ?? []) button.disabled = true;
  }

  function reset() {
    locked = false;
    input.disabled = false;
    input.placeholder = "";
    for (const button of keys?.querySelectorAll("button") ?? []) button.disabled = false;
    historyIndex = null;
    draft = "";
    setInput("");
    setTabLeaves(false);
    clear();
    live.textContent = "";
  }

  return {
    print,
    echo,
    clear,
    announce,
    setPrompt,
    lock,
    reset,
    focus: () => input.focus({ preventScroll: true }),
  };
}
