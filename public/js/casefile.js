/**
 * The Night 2 case file: a form built from night2.json's caseFile questions.
 *
 * This module only handles the form on screen: building the fields, reading
 * what the player entered, and showing validation messages. Checking answers
 * against the hashes lives in answers.js; scoring lives in night2.js.
 *
 * Question types and their fields:
 *   text, ipv4, path   one text input
 *   checklist          a group of checkboxes
 *   mechanism-path     a radio group plus a path input
 *
 * Every field has a "?" button that shows its tip (the only hints on Night 2).
 * The tip is a toggled paragraph rather than a hover tooltip, so it works the
 * same with a mouse, a keyboard, a screen reader, and a touch screen.
 *
 * Security note: every label, option, and message is set with textContent.
 * Player input is never inserted into the page; it is only validated,
 * normalized, and hashed.
 */

import { el } from "./ui.js";
import { prepareResponse, isBlankResponse } from "./answers.js";

// Lengths the inputs accept; answers.js enforces the same limits.
const MAX_LENGTH = { text: 32, ipv4: 15, path: 200 };
const PLACEHOLDER = { text: "username", ipv4: "0.0.0.0", path: "/full/path" };

export function createCaseFile(container, questions, { onChange = () => {} } = {}) {
  const fieldIds = (q) => ({
    box: `cf-q-${q.id}`,
    input: `cf-${q.id}`,
    prompt: `cf-${q.id}-prompt`,
    help: `cf-${q.id}-help`,
    error: `cf-${q.id}-error`,
  });

  /* ---------- Building the fields ---------- */

  function textInput(id, type, describedBy, label) {
    const input = el("input", {
      className: "cf-input mono",
      attrs: {
        id,
        type: "text",
        maxlength: String(MAX_LENGTH[type] ?? MAX_LENGTH.path),
        autocomplete: "off",
        autocapitalize: "off",
        autocorrect: "off",
        spellcheck: "false",
        placeholder: PLACEHOLDER[type] ?? PLACEHOLDER.path,
        "aria-describedby": describedBy,
      },
    });
    if (type === "ipv4") input.setAttribute("inputmode", "decimal");
    if (label) input.setAttribute("aria-label", label);
    return input;
  }

  function helpButton(q, ids, labelText) {
    const button = el("button", {
      className: "cf-help-btn",
      text: "?",
      attrs: { type: "button", "aria-expanded": "false", "aria-controls": ids.help, "aria-label": `Tip for ${labelText}` },
    });
    button.addEventListener("click", () => {
      const help = document.getElementById(ids.help);
      const open = help.hidden;
      help.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    });
    return button;
  }

  function buildField(q, index) {
    const ids = fieldIds(q);
    const labelText = q.label;
    const describedBy = `${ids.prompt} ${ids.error}`;
    const num = el("span", { className: "cf-num mono", text: `${index + 1}.` });
    const prompt = el("p", { className: "cf-prompt", text: q.prompt, attrs: { id: ids.prompt } });
    const help = el("p", { className: "cf-help", text: q.help, attrs: { id: ids.help } });
    help.hidden = true;
    const error = el("p", { className: "cf-error", attrs: { id: ids.error } });
    error.hidden = true;

    // Single text field: a real <label for>.
    if (q.type === "text" || q.type === "ipv4" || q.type === "path") {
      const label = el("label", { className: "cf-label", attrs: { for: ids.input } }, [num, ` ${labelText}`]);
      const input = textInput(ids.input, q.type, describedBy);
      input.addEventListener("input", () => onFieldInput(q));
      input.addEventListener("change", () => validateField(q));
      return el("div", { className: "cf-field", attrs: { id: ids.box } }, [
        label,
        helpButton(q, ids, labelText),
        prompt,
        help,
        input,
        error,
      ]);
    }

    // Groups: a <fieldset> whose <legend> names the field.
    const legend = el("legend", { className: "cf-label" }, [num, ` ${labelText}`]);
    const children = [];
    if (q.type === "checklist") {
      children.push(
        el(
          "div",
          { className: "cf-options" },
          q.options.map((o) => {
            const box = el("input", { attrs: { type: "checkbox", name: ids.input, value: o.id } });
            box.addEventListener("change", () => onFieldInput(q));
            return el("label", { className: "cf-option" }, [box, el("span", { text: o.text })]);
          }),
        ),
      );
    } else if (q.type === "mechanism-path") {
      children.push(
        el(
          "div",
          { className: "cf-options", attrs: { role: "radiogroup", "aria-label": "Method" } },
          q.mechanisms.map((m) => {
            const radio = el("input", { attrs: { type: "radio", name: ids.input, value: m.id } });
            radio.addEventListener("change", () => onFieldInput(q));
            return el("label", { className: "cf-option" }, [radio, el("span", { text: m.text })]);
          }),
        ),
      );
      const pathId = `${ids.input}-path`;
      const pathInput = textInput(pathId, "path", ids.error);
      pathInput.addEventListener("input", () => onFieldInput(q));
      pathInput.addEventListener("change", () => validateField(q));
      children.push(el("label", { className: "cf-sublabel", text: q.pathLabel ?? "Full path", attrs: { for: pathId } }), pathInput);
    } else {
      throw new Error(`Unknown question type: ${q.type}`);
    }

    const fieldset = el("fieldset", { className: "cf-field cf-group", attrs: { id: ids.box, "aria-describedby": describedBy } }, [
      legend, // must be the fieldset's first child
      helpButton(q, ids, labelText),
      prompt,
      help,
      ...children,
      error,
    ]);
    return fieldset;
  }

  container.replaceChildren(...questions.map(buildField));

  /* ---------- Reading responses ---------- */

  function responseFor(q) {
    const { box, input } = fieldIds(q);
    const root = document.getElementById(box);
    switch (q.type) {
      case "checklist":
        return [...root.querySelectorAll('input[type="checkbox"]:checked')].map((node) => node.value);
      case "mechanism-path":
        return {
          mechanism: root.querySelector('input[type="radio"]:checked')?.value ?? "",
          path: document.getElementById(`${input}-path`).value,
        };
      default:
        return document.getElementById(input).value;
    }
  }

  function responses() {
    return Object.fromEntries(questions.map((q) => [q.id, responseFor(q)]));
  }

  /* ---------- Validation messages ---------- */

  function setError(q, message) {
    const ids = fieldIds(q);
    const error = document.getElementById(ids.error);
    error.textContent = message ?? "";
    error.hidden = !message;
    for (const node of document.getElementById(ids.box).querySelectorAll('input[type="text"]')) {
      if (message) node.setAttribute("aria-invalid", "true");
      else node.removeAttribute("aria-invalid");
    }
    document.getElementById(ids.box).classList.toggle("has-error", Boolean(message));
  }

  /** Show or clear this field's message. Returns the message, or null. */
  function validateField(q) {
    const { error } = prepareResponse(q, responseFor(q));
    setError(q, error ?? null);
    return error ?? null;
  }

  // While typing, only clear an existing error (don't nag mid-word).
  function onFieldInput(q) {
    const box = document.getElementById(fieldIds(q).box);
    if (box.classList.contains("has-error") && !prepareResponse(q, responseFor(q)).error) setError(q, null);
    onChange();
  }

  /** Validate every field. Returns the questions with invalid input, in order. */
  function validateAll() {
    return questions.filter((q) => validateField(q) !== null);
  }

  function focusField(q) {
    const root = document.getElementById(fieldIds(q).box);
    const target = root.querySelector('input[aria-invalid="true"]') ?? root.querySelector("input");
    target?.focus();
    root.scrollIntoView({ block: "nearest" });
  }

  function filledCount() {
    const all = responses();
    return questions.filter((q) => !isBlankResponse(q, all[q.id])).length;
  }

  function blankQuestions() {
    const all = responses();
    return questions.filter((q) => isBlankResponse(q, all[q.id]));
  }

  function setDisabled(disabled) {
    for (const node of container.querySelectorAll("input")) node.disabled = disabled;
  }

  function reset() {
    for (const node of container.querySelectorAll('input[type="text"]')) node.value = "";
    for (const node of container.querySelectorAll('input[type="checkbox"], input[type="radio"]')) node.checked = false;
    for (const q of questions) {
      setError(q, null);
      const ids = fieldIds(q);
      document.getElementById(ids.help).hidden = true;
      document.getElementById(ids.box).querySelector(".cf-help-btn").setAttribute("aria-expanded", "false");
    }
    setDisabled(false);
  }

  return { responses, validateAll, focusField, filledCount, blankQuestions, setDisabled, reset };
}

/** A readable version of a response, for the end-of-shift report. */
export function describeResponse(question, response) {
  switch (question.type) {
    case "checklist": {
      const chosen = question.options.filter((o) => (response ?? []).includes(o.id)).map((o) => o.text);
      return chosen.length ? chosen.join("; ") : "";
    }
    case "mechanism-path": {
      const mechanism = question.mechanisms.find((m) => m.id === response?.mechanism)?.text ?? "";
      const path = String(response?.path ?? "").trim();
      return [mechanism, path].filter(Boolean).join(", ");
    }
    default:
      return String(response ?? "").trim();
  }
}
