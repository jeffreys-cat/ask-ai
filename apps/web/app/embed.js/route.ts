const SCRIPT = String.raw`
(function () {
  var script = document.currentScript;
  if (!script) return;

  var scriptUrl = new URL(script.src);
  var baseUrl = script.dataset.baseUrl || scriptUrl.origin;
  var zIndex = script.dataset.zIndex || "2147483000";
  var buttonLabel = script.dataset.buttonLabel || "Ask AI";
  var title = script.dataset.title || "Ask AI";
  var position = script.dataset.position || "bottom-right";
  var offsetX = script.dataset.offsetX || script.dataset.buttonOffsetX || "24px";
  var offsetY = script.dataset.offsetY || script.dataset.buttonOffsetY || "24px";
  var primaryColor = script.dataset.primaryColor || "#087f5b";
  var launcher = script.dataset.launcher || "default";
  var triggerSelector = script.dataset.trigger;
  var buttonClass = script.dataset.buttonClass;
  var buttonStyle = script.dataset.buttonStyle;
  var params = new URLSearchParams();
  var configKeys = ["projectId", "organizationId", "userId", "title", "placeholder", "brand", "primaryColor"];

  configKeys.forEach(function (key) {
    if (script.dataset[key]) params.set(key, script.dataset[key]);
  });
  if (!params.has("title")) params.set("title", title);
  if (!params.has("primaryColor")) params.set("primaryColor", primaryColor);

  var host = document.createElement("div");
  host.id = "ask-ai-embed-root";
  document.body.appendChild(host);

  function positionStyles(anchorPosition) {
    var normalized = String(anchorPosition || "bottom-right").toLowerCase();
    var vertical = normalized.indexOf("top") === 0 ? "top:" + offsetY : "bottom:" + offsetY;
    var horizontal = normalized.indexOf("left") > -1 ? "left:" + offsetX : "right:" + offsetX;
    return [vertical, horizontal];
  }

  var button = null;
  var shouldCreateDefaultLauncher = launcher !== "custom" && launcher !== "none";
  if (shouldCreateDefaultLauncher) {
    button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "Open " + buttonLabel);
    button.textContent = buttonLabel;
    if (buttonClass) button.className = buttonClass;
    button.style.cssText = [
      "position:fixed",
      positionStyles(position)[0],
      positionStyles(position)[1],
      "z-index:" + zIndex,
      "height:54px",
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "padding:0 22px",
      "border:0",
      "border-radius:999px",
      "background:" + primaryColor,
      "color:#fff",
      "box-shadow:0 14px 34px rgba(0,0,0,.22)",
      "font:600 15px/1.1 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "cursor:pointer"
    ].join(";");
    if (buttonStyle) button.style.cssText += ";" + buttonStyle;
  }

  var iframe = document.createElement("iframe");
  iframe.title = title;
  iframe.allow = "clipboard-write";
  iframe.src = baseUrl.replace(/\/$/, "") + "/embed?" + params.toString();
  iframe.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:" + (Number(zIndex) + 1),
    "width:100vw",
    "height:100vh",
    "border:0",
    "display:none",
    "background:transparent"
  ].join(";");

  function open() {
    iframe.style.display = "block";
    if (button) button.style.display = "none";
  }

  function close() {
    iframe.style.display = "none";
    if (button) button.style.display = "inline-flex";
  }

  function attachTrigger(selector, silent) {
    if (!selector) return false;
    var triggers = document.querySelectorAll(selector);
    if (!triggers.length) {
      if (!silent && window.console && console.warn) console.warn("ASK AI embed trigger not found:", selector);
      return false;
    }
    triggers.forEach(function (trigger) {
      trigger.addEventListener("click", function (event) {
        event.preventDefault();
        open();
      });
    });
    return true;
  }

  if (button) button.addEventListener("click", open);
  if (!attachTrigger(triggerSelector, document.readyState === "loading") && triggerSelector && document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      attachTrigger(triggerSelector);
    }, { once: true });
  }
  window.addEventListener("message", function (event) {
    if (event.source === iframe.contentWindow && event.data && event.data.type === "ask-ai:close") close();
  });

  window.AskAIEmbed = window.AskAIEmbed || {};
  window.AskAIEmbed.open = open;
  window.AskAIEmbed.close = close;
  window.AskAIEmbed.destroy = function () {
    host.remove();
  };

  if (button) host.appendChild(button);
  host.appendChild(iframe);
})();
`;

export function GET() {
  return new Response(SCRIPT, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
