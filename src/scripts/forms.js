const SUCCESS_MESSAGE = "Tu mensaje fue enviado correctamente. Te responderemos pronto.";
const ERROR_MESSAGE = "No se pudo enviar el formulario. Inténtalo nuevamente o escríbenos por WhatsApp.";
const TURNSTILE_SITE_KEY = document.documentElement.dataset.turnstileSiteKey || "";

function setOrigin(form) {
  form.querySelectorAll('input[name="pagina_origen"], input[name="página_origen"]').forEach((origin) => {
    origin.value = window.location.href;
  });
}

function setFeedback(feedback, state, message) {
  if (!feedback) return;
  feedback.dataset.state = state;
  feedback.textContent = message;
}

function setButtonState(button, sending) {
  if (!button) return;
  if (sending) {
    button.dataset.originalText = button.textContent;
    button.textContent = "Enviando...";
    button.disabled = true;
    return;
  }
  button.textContent = button.dataset.originalText || button.textContent;
  button.disabled = false;
}

function waitForTurnstile() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const check = () => {
      if (window.turnstile?.render) return resolve(window.turnstile);
      if (Date.now() >= deadline) return reject(new Error("No se pudo cargar la verificación de seguridad."));
      window.setTimeout(check, 50);
    };
    check();
  });
}

function centerTurnstileWidget(container, submitControl) {
  const upperField = container.previousElementSibling || submitControl.parentElement?.previousElementSibling;
  if (!upperField || !submitControl) return;

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const upperRect = upperField.getBoundingClientRect();
      const widgetRect = container.getBoundingClientRect();
      const buttonRect = submitControl.getBoundingClientRect();
      const targetCenter = (upperRect.bottom + buttonRect.top) / 2;
      const offset = Math.round(targetCenter - (widgetRect.top + widgetRect.height / 2));
      container.style.setProperty("transform", `translateY(${offset}px)`, "important");
    });
  });
}

async function mountTurnstile(form, feedback) {
  if (!TURNSTILE_SITE_KEY) throw new Error("La verificación de seguridad no está configurada.");
  const turnstile = await waitForTurnstile();
  const container = document.createElement("div");
  container.className = "turnstile-widget";
  container.style.setProperty("width", "100%", "important");
  container.style.setProperty("display", "flex", "important");
  container.style.setProperty("justify-content", "center", "important");
  container.style.setProperty("align-items", "center", "important");
  container.style.setProperty("text-align", "center", "important");
  container.setAttribute("aria-label", "Verificación de seguridad");
  const submitControl = form.querySelector('button[type="submit"], input[type="submit"]');
  const placeAfter = form.dataset.turnstilePlacement === "after";
  if (placeAfter) {
    container.style.setProperty("margin-top", "1.5rem", "important");
    form.appendChild(container);
  } else if (submitControl) {
    submitControl.before(container);
  } else {
    form.appendChild(container);
  }

  const tokenField = document.createElement("input");
  tokenField.type = "hidden";
  tokenField.name = "cf-turnstile-response";
  form.appendChild(tokenField);

  let widgetId;
  widgetId = turnstile.render(container, {
    sitekey: TURNSTILE_SITE_KEY,
    theme: form.dataset.turnstileTheme || "auto",
    size: form.dataset.turnstileSize || "normal",
    language: "es",
    callback(token) {
      tokenField.value = token;
      setFeedback(feedback, "", "");
    },
    "expired-callback"() {
      tokenField.value = "";
      setFeedback(feedback, "error", "La verificación venció. Complétala nuevamente.");
    },
    "error-callback"() {
      tokenField.value = "";
      setFeedback(feedback, "error", "No se pudo completar la verificación de seguridad.");
      window.setTimeout(() => {
        try {
          turnstile.reset(widgetId);
        } catch {
          // The user can retry after a provider-side rendering failure.
        }
      }, 800);
    }
  });
  if (!placeAfter) centerTurnstileWidget(container, submitControl);

  return { turnstile, widgetId, tokenField };
}

function resetTurnstile(widget) {
  if (!widget) return;
  widget.tokenField.value = "";
  try {
    widget.turnstile.reset(widget.widgetId);
  } catch {
    // A later page load will render a new widget if the provider is unavailable.
  }
}

function initMailForms() {
  if (!window.fetch) return;

  document.querySelectorAll("form[data-mail-form]").forEach((form) => {
    if (form.dataset.mailReady === "true") return;
    form.dataset.mailReady = "true";
    setOrigin(form);

    const feedback = form.querySelector(".form-feedback") || form.parentElement?.querySelector(":scope > .form-feedback");
    const widgetPromise = mountTurnstile(form, feedback).catch((error) => {
      setFeedback(feedback, "error", error?.message || ERROR_MESSAGE);
      return null;
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"], input[type="submit"]');
      setOrigin(form);
      setFeedback(feedback, "", "");
      setButtonState(button, true);

      try {
        const widget = await widgetPromise;
        if (!widget?.tokenField.value) {
          throw new Error("Completa la verificación de seguridad antes de enviar.");
        }

        const formData = new FormData(form);
        formData.set("cf-turnstile-response", widget.tokenField.value);
        const response = await fetch(form.action, {
          method: "POST",
          headers: { Accept: "application/json" },
          body: formData
        });
        const result = await response.json().catch(() => ({ success: false }));
        if (!response.ok || result.success !== true) {
          throw new Error(result.message || ERROR_MESSAGE);
        }

        form.reset();
        setOrigin(form);
        setFeedback(feedback, "success", SUCCESS_MESSAGE);
        form.dispatchEvent(new CustomEvent("mail-form:success"));
      } catch (error) {
        setFeedback(feedback, "error", error?.message || ERROR_MESSAGE);
      } finally {
        const widget = await widgetPromise;
        resetTurnstile(widget);
        setButtonState(button, false);
      }
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMailForms);
} else {
  initMailForms();
}
